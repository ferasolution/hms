<?php

namespace App\Http\Controllers\Api\Hospital;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\Admission;
use App\Models\Bed;
use App\Models\Patient;
use App\Models\User;
use App\Models\Ward;
use App\Services\Billing;
use App\Services\Hospital;
use App\Services\Notifier;
use App\Tenancy\TenantManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Wards, beds, admissions, transfers and discharge (IPD).
 */
class InpatientController extends Controller
{
    public function __construct(protected Hospital $hospital, protected Billing $billing, protected TenantManager $tenants, protected Notifier $notifier) {}

    /** The bed board: every ward with its beds and who is in them. */
    public function board(): JsonResponse
    {
        $wards = Ward::with(['beds' => fn ($q) => $q->orderBy('number'), 'beds.currentAdmission.patient', 'beds.currentAdmission.doctor:id,name'])
            ->orderBy('name')->get();

        $beds = $wards->flatMap->beds;

        return response()->json([
            'wards' => $wards->map(fn (Ward $w) => [
                'id' => $w->id, 'name' => $w->name, 'type' => $w->type, 'floor' => $w->floor, 'daily_rate' => $w->daily_rate,
                'beds' => $w->beds->map(fn (Bed $b) => [
                    'id' => $b->id, 'number' => $b->number, 'status' => $b->status,
                    'admission' => $b->currentAdmission ? [
                        'id' => $b->currentAdmission->id,
                        'admitted_at' => $b->currentAdmission->admitted_at,
                        'diagnosis' => $b->currentAdmission->diagnosis,
                        'patient' => $b->currentAdmission->patient?->only('id', 'mrn', 'name', 'age', 'gender'),
                        'doctor' => $b->currentAdmission->doctor?->only('id', 'name'),
                    ] : null,
                ]),
            ]),
            'summary' => [
                'beds' => $beds->count(),
                'available' => $beds->where('status', 'available')->count(),
                'occupied' => $beds->where('status', 'occupied')->count(),
                'cleaning' => $beds->where('status', 'cleaning')->count(),
                'maintenance' => $beds->where('status', 'maintenance')->count(),
                'admitted_today' => Admission::whereDate('admitted_at', today())->count(),
                'discharged_today' => Admission::whereDate('discharged_at', today())->count(),
            ],
        ]);
    }

    public function storeWard(Request $request): JsonResponse
    {
        $data = $request->validate($this->wardRules() + ['beds' => ['nullable', 'integer', 'min:0', 'max:200'], 'prefix' => ['nullable', 'string', 'max:6']]);
        $count = (int) ($data['beds'] ?? 0);

        $ward = DB::transaction(function () use ($data, $count) {
            $ward = Ward::create(collect($data)->only(['name', 'type', 'floor', 'daily_rate'])->all());
            $this->addBeds($ward, $count, $data['prefix'] ?? strtoupper(substr($ward->name, 0, 1)));

            return $ward;
        });

        return response()->json($ward->load('beds'), 201);
    }

    public function updateWard(Request $request, Ward $ward): JsonResponse
    {
        $ward->update($request->validate($this->wardRules(true)));

        return response()->json($ward);
    }

    public function destroyWard(Ward $ward): JsonResponse
    {
        abort_if($ward->beds()->where('status', 'occupied')->exists(), 422, 'Move or discharge the patients in this ward first.');
        $ward->delete();

        return response()->json(null, 204);
    }

    public function storeBeds(Request $request, Ward $ward): JsonResponse
    {
        $data = $request->validate(['count' => ['required', 'integer', 'min:1', 'max:200'], 'prefix' => ['nullable', 'string', 'max:6']]);
        DB::transaction(fn () => $this->addBeds($ward, $data['count'], $data['prefix'] ?? strtoupper(substr($ward->name, 0, 1))));

        return response()->json($ward->load('beds'), 201);
    }

    public function updateBed(Request $request, Bed $bed): JsonResponse
    {
        $data = $request->validate([
            'number' => ['sometimes', 'string', 'max:20'],
            'status' => ['sometimes', Rule::in(['available', 'cleaning', 'maintenance'])],
        ]);
        abort_if(isset($data['status']) && $bed->status === 'occupied', 422, 'Discharge or transfer the patient first.');
        $bed->update($data);

        return response()->json($bed);
    }

    public function destroyBed(Bed $bed): JsonResponse
    {
        abort_if($bed->status === 'occupied', 422, 'This bed is occupied.');
        $bed->delete();

        return response()->json(null, 204);
    }

    public function admissions(Request $request): JsonResponse
    {
        $status = $request->validate(['status' => ['nullable', Rule::in(['admitted', 'discharged'])]])['status'] ?? 'admitted';

        $rows = Admission::with(['patient', 'bed.ward', 'doctor:id,name'])
            ->where('status', $status)
            ->when($request->user()->hasRole(User::ROLE_DOCTOR) && $request->boolean('mine'), fn ($q) => $q->where('doctor_id', $request->user()->id))
            ->latest($status === 'admitted' ? 'admitted_at' : 'discharged_at')->limit(200)->get();

        return response()->json(['data' => $rows]);
    }

    public function admit(Request $request): JsonResponse
    {
        $data = $request->validate([
            'patient_id' => ['required', 'integer'],
            'bed_id' => ['required', 'integer'],
            'doctor_id' => ['nullable', 'integer'],
            'admitted_at' => ['nullable', 'date'],
            'reason' => ['nullable', 'string', 'max:500'],
            'diagnosis' => ['nullable', 'string', 'max:500'],
        ]);

        $patient = Patient::findOrFail($data['patient_id']);
        abort_if(Admission::where('patient_id', $patient->id)->where('status', 'admitted')->exists(), 422, "{$patient->name} is already admitted.");
        $doctor = ! empty($data['doctor_id']) ? User::where('role', User::ROLE_DOCTOR)->findOrFail($data['doctor_id']) : null;

        $admission = DB::transaction(function () use ($data, $patient, $doctor) {
            $bed = Bed::lockForUpdate()->findOrFail($data['bed_id']);
            if ($bed->status !== 'available') {
                throw ValidationException::withMessages(['bed_id' => "Bed {$bed->number} is not available."]);
            }
            $bed->update(['status' => 'occupied']);

            return Admission::create([
                'patient_id' => $patient->id,
                'bed_id' => $bed->id,
                'doctor_id' => $doctor?->id,
                'admitted_at' => $data['admitted_at'] ?? now(),
                'reason' => $data['reason'] ?? null,
                'diagnosis' => $data['diagnosis'] ?? null,
            ]);
        });

        if ($doctor) {
            $this->notifier->send($doctor, 'admission', "Admitted under you: {$patient->name}", 'Bed '.$admission->bed->number.' · '.$admission->bed->ward->name, '/inpatients');
        }
        ActivityLog::record('admission.created', "Admitted {$patient->name} to bed {$admission->bed->number}", ['admission_id' => $admission->id]);

        return response()->json($admission->load(['patient', 'bed.ward', 'doctor:id,name']), 201);
    }

    public function transfer(Request $request, Admission $admission): JsonResponse
    {
        abort_unless($admission->status === 'admitted', 422, 'This patient has been discharged.');
        $data = $request->validate(['bed_id' => ['required', 'integer'], 'doctor_id' => ['nullable', 'integer']]);

        DB::transaction(function () use ($admission, $data) {
            $new = Bed::lockForUpdate()->findOrFail($data['bed_id']);
            if ($new->status !== 'available') {
                throw ValidationException::withMessages(['bed_id' => "Bed {$new->number} is not available."]);
            }
            // Charge the days spent in the old bed before moving.
            $this->chargeRoom($admission, now());
            Bed::whereKey($admission->bed_id)->update(['status' => 'cleaning']);
            $new->update(['status' => 'occupied']);
            $admission->bed_id = $new->id;
            if (! empty($data['doctor_id'])) {
                $admission->doctor_id = User::where('role', User::ROLE_DOCTOR)->findOrFail($data['doctor_id'])->id;
            }
            $admission->save();
        });

        return response()->json($admission->load(['patient', 'bed.ward', 'doctor:id,name']));
    }

    public function discharge(Request $request, Admission $admission): JsonResponse
    {
        abort_unless($admission->status === 'admitted', 422, 'Already discharged.');
        $data = $request->validate([
            'discharged_at' => ['nullable', 'date'],
            'discharge_type' => ['required', Rule::in(['recovered', 'referred', 'lama', 'deceased'])],
            'discharge_summary' => ['nullable', 'string', 'max:10000'],
            'diagnosis' => ['nullable', 'string', 'max:500'],
        ]);

        DB::transaction(function () use ($admission, $data) {
            $at = Carbon::parse($data['discharged_at'] ?? now());
            $this->chargeRoom($admission, $at);
            $admission->fill(collect($data)->only(['discharge_type', 'discharge_summary', 'diagnosis'])->filter(fn ($v) => $v !== null)->all());
            $admission->status = 'discharged';
            $admission->discharged_at = $at;
            $admission->save();
            Bed::whereKey($admission->bed_id)->update(['status' => 'cleaning']);
        });

        ActivityLog::record('admission.discharged', "Discharged {$admission->patient->name} ({$data['discharge_type']})", ['admission_id' => $admission->id]);

        return response()->json($admission->load(['patient', 'bed.ward', 'doctor:id,name']));
    }

    public function show(Admission $admission): JsonResponse
    {
        return response()->json($admission->load(['patient', 'bed.ward', 'doctor:id,name', 'encounters.doctor:id,name']));
    }

    /**
     * Room charges for nights in the current bed since admission or the last
     * transfer (a started day counts, minimum one).
     */
    protected function chargeRoom(Admission $admission, Carbon $until): void
    {
        $bed = Bed::with('ward')->find($admission->bed_id);
        if (! $bed?->ward || (float) $bed->ward->daily_rate <= 0) {
            return;
        }

        $alreadyBilled = \App\Models\InvoiceItem::where('source_type', $admission->getMorphClass())->where('source_id', $admission->id)->where('category', 'room')->sum('quantity');
        // A started day counts, with a two-hour grace so discharge at the same time of day isn't an extra day.
        $totalDays = max(1, (int) ceil(max(0, abs($admission->admitted_at->diffInMinutes($until)) - 120) / 1440));
        $days = $totalDays - (int) $alreadyBilled;

        if ($days > 0) {
            $this->hospital->charge($admission->patient, 'room', "{$bed->ward->name} — bed {$bed->number}", (float) $bed->ward->daily_rate, $days, $admission, $admission);
        }
    }

    protected function addBeds(Ward $ward, int $count, string $prefix): void
    {
        if ($count <= 0) {
            return;
        }
        $tenant = $this->tenants->current();
        $plan = $this->billing->effective($tenant)['plan'];
        $used = $this->billing->usage($tenant)['beds'];
        if ($plan?->max_beds !== null && $used + $count > $plan->max_beds) {
            throw ValidationException::withMessages(['beds' => "Your {$plan->name} plan allows {$plan->max_beds} beds. Upgrade on the Billing page to add more."]);
        }

        $existing = $ward->beds()->pluck('number')->flip();
        $n = 1;
        for ($i = 0; $i < $count; $i++) {
            do {
                $number = strtoupper($prefix).'-'.str_pad((string) $n++, 2, '0', STR_PAD_LEFT);
            } while (isset($existing[$number]));
            $ward->beds()->create(['number' => $number]);
        }
    }

    protected function wardRules(bool $partial = false): array
    {
        return [
            'name' => [$partial ? 'sometimes' : 'required', 'string', 'max:120'],
            'type' => [$partial ? 'sometimes' : 'required', Rule::in(Ward::TYPES)],
            'floor' => ['nullable', 'string', 'max:30'],
            'daily_rate' => ['nullable', 'numeric', 'min:0', 'max:1000000'],
        ];
    }
}
