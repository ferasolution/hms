<?php

namespace App\Http\Controllers\Api\Hospital;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\Admission;
use App\Models\Appointment;
use App\Models\Encounter;
use App\Models\LabOrder;
use App\Models\LabTest;
use App\Models\Medicine;
use App\Models\Patient;
use App\Models\Prescription;
use App\Models\User;
use App\Services\Hospital;
use App\Services\Notifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Consultation notes: vitals, history, diagnosis, plan — with the
 * prescription and lab orders written in the same step.
 */
class EncounterController extends Controller
{
    public function __construct(protected Hospital $hospital, protected Notifier $notifier) {}

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $this->validated($request);
        $patient = Patient::findOrFail($data['patient_id']);

        $appointment = ! empty($data['appointment_id']) ? Appointment::where('patient_id', $patient->id)->findOrFail($data['appointment_id']) : null;
        $admission = ! empty($data['admission_id']) ? Admission::where('patient_id', $patient->id)->findOrFail($data['admission_id']) : null;

        // Nurses record vitals and nursing notes; only doctors prescribe and order tests.
        $prescribes = $user->hasRole(User::ROLE_DOCTOR, User::ROLE_ADMIN);
        abort_if(! $prescribes && (! empty($data['medicines']) || ! empty($data['lab_test_ids'])), 403, 'Only doctors can prescribe or order tests.');

        $encounter = DB::transaction(function () use ($data, $patient, $appointment, $admission, $user) {
            $encounter = Encounter::create([
                'patient_id' => $patient->id,
                'doctor_id' => $user->id,
                'appointment_id' => $appointment?->id,
                'admission_id' => $admission?->id,
                'type' => $data['type'] ?? ($admission ? 'ipd' : 'opd'),
            ] + collect($data)->only(['vitals', 'complaints', 'examination', 'diagnosis', 'icd_code', 'plan', 'follow_up_on'])->all());

            $this->orders($encounter, $patient, $data, $user);

            if ($appointment && ! empty($data['complete_appointment'])) {
                $appointment->update(['status' => 'completed']);
            } elseif ($appointment && in_array($appointment->status, ['scheduled', 'checked_in'], true)) {
                $appointment->update(['status' => 'in_progress']);
            }

            return $encounter;
        });

        ActivityLog::record('encounter.created', "Clinical note for {$patient->name} by {$user->name}", ['encounter_id' => $encounter->id]);

        return response()->json($this->load($encounter), 201);
    }

    public function show(Encounter $encounter): JsonResponse
    {
        return response()->json($this->load($encounter));
    }

    public function update(Request $request, Encounter $encounter): JsonResponse
    {
        $user = $request->user();
        abort_unless($user->hasRole(User::ROLE_ADMIN) || $encounter->doctor_id === $user->id, 403, 'Only the author can edit this note.');
        abort_if($encounter->created_at->lt(now()->subDays(7)) && ! $user->hasRole(User::ROLE_ADMIN), 422, 'Notes older than 7 days are locked. Add a new note instead.');

        $data = $request->validate($this->rules(true));
        $encounter->update(collect($data)->only(['vitals', 'complaints', 'examination', 'diagnosis', 'icd_code', 'plan', 'follow_up_on'])->all());

        if (! empty($data['medicines']) || ! empty($data['lab_test_ids'])) {
            abort_unless($user->hasRole(User::ROLE_DOCTOR, User::ROLE_ADMIN), 403, 'Only doctors can prescribe or order tests.');
            DB::transaction(fn () => $this->orders($encounter, $encounter->patient, $data, $user));
        }

        return response()->json($this->load($encounter));
    }

    protected function orders(Encounter $encounter, Patient $patient, array $data, User $user): void
    {
        if (! empty($data['medicines'])) {
            $rx = Prescription::create([
                'patient_id' => $patient->id,
                'doctor_id' => $user->id,
                'encounter_id' => $encounter->id,
                'notes' => $data['prescription_notes'] ?? null,
            ]);
            foreach ($data['medicines'] as $m) {
                $medicine = ! empty($m['medicine_id']) ? Medicine::find($m['medicine_id']) : null;
                $rx->items()->create([
                    'medicine_id' => $medicine?->id,
                    'medicine_name' => $medicine ? trim($medicine->name.' '.$medicine->strength) : $m['medicine_name'],
                    'dosage' => $m['dosage'] ?? null,
                    'frequency' => $m['frequency'] ?? null,
                    'duration_days' => $m['duration_days'] ?? null,
                    'quantity' => $m['quantity'] ?? 1,
                    'instructions' => $m['instructions'] ?? null,
                ]);
            }
            $this->notifier->send($this->notifier->roleIds($patient->tenant_id, [User::ROLE_PHARMACIST]), 'pharmacy',
                "New prescription: {$patient->name}", count($data['medicines']).' item(s) from Dr. '.$user->name, '/pharmacy');
        }

        if (! empty($data['lab_test_ids'])) {
            $tests = LabTest::whereIn('id', $data['lab_test_ids'])->where('is_active', true)->get();
            if ($tests->isNotEmpty()) {
                $order = LabOrder::create([
                    'patient_id' => $patient->id,
                    'doctor_id' => $user->id,
                    'encounter_id' => $encounter->id,
                    'priority' => $data['lab_priority'] ?? 'routine',
                    'notes' => $data['lab_notes'] ?? null,
                ]);
                foreach ($tests as $test) {
                    $order->items()->create(['lab_test_id' => $test->id]);
                    $this->hospital->charge($patient, $test->category === 'radiology' ? 'radiology' : 'lab', $test->name, (float) $test->price, 1, $order);
                }
                $this->notifier->send($this->notifier->roleIds($patient->tenant_id, [User::ROLE_LAB]), 'lab',
                    "New test order: {$patient->name}", $tests->pluck('name')->implode(', '), '/lab');
            }
        }
    }

    protected function validated(Request $request): array
    {
        return $request->validate($this->rules(false));
    }

    protected function rules(bool $partial): array
    {
        return [
            'patient_id' => [$partial ? 'prohibited' : 'required', 'integer'],
            'appointment_id' => ['nullable', 'integer'],
            'admission_id' => ['nullable', 'integer'],
            'type' => ['nullable', Rule::in(['opd', 'ipd', 'emergency'])],
            'vitals' => ['nullable', 'array'],
            'vitals.bp' => ['nullable', 'string', 'max:20'],
            'vitals.pulse' => ['nullable', 'numeric', 'between:0,300'],
            'vitals.temperature' => ['nullable', 'numeric', 'between:25,115'],
            'vitals.spo2' => ['nullable', 'numeric', 'between:0,100'],
            'vitals.respiration' => ['nullable', 'numeric', 'between:0,100'],
            'vitals.weight' => ['nullable', 'numeric', 'between:0,700'],
            'vitals.height' => ['nullable', 'numeric', 'between:0,300'],
            'vitals.sugar' => ['nullable', 'numeric', 'between:0,2000'],
            'complaints' => ['nullable', 'string', 'max:5000'],
            'examination' => ['nullable', 'string', 'max:5000'],
            'diagnosis' => ['nullable', 'string', 'max:2000'],
            'icd_code' => ['nullable', 'string', 'max:20'],
            'plan' => ['nullable', 'string', 'max:5000'],
            'follow_up_on' => ['nullable', 'date'],
            'complete_appointment' => ['sometimes', 'boolean'],
            'medicines' => ['nullable', 'array', 'max:30'],
            'medicines.*.medicine_id' => ['nullable', 'integer'],
            'medicines.*.medicine_name' => ['required_without:medicines.*.medicine_id', 'nullable', 'string', 'max:160'],
            'medicines.*.dosage' => ['nullable', 'string', 'max:60'],
            'medicines.*.frequency' => ['nullable', 'string', 'max:60'],
            'medicines.*.duration_days' => ['nullable', 'integer', 'min:1', 'max:365'],
            'medicines.*.quantity' => ['nullable', 'integer', 'min:1', 'max:10000'],
            'medicines.*.instructions' => ['nullable', 'string', 'max:300'],
            'prescription_notes' => ['nullable', 'string', 'max:1000'],
            'lab_test_ids' => ['nullable', 'array', 'max:30'],
            'lab_test_ids.*' => ['integer'],
            'lab_priority' => ['nullable', Rule::in(['routine', 'urgent', 'stat'])],
            'lab_notes' => ['nullable', 'string', 'max:500'],
        ];
    }

    protected function load(Encounter $e): array
    {
        $e->load(['doctor:id,name', 'patient', 'prescriptions.items', 'labOrders.items.test']);

        return $e->toArray();
    }
}
