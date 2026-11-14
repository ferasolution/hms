<?php

namespace App\Http\Controllers\Api\Hospital;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\Admission;
use App\Models\Ambulance;
use App\Models\AmbulanceTrip;
use App\Models\Bed;
use App\Models\ErVisit;
use App\Models\Patient;
use App\Models\Service;
use App\Models\User;
use App\Services\Hospital;
use App\Services\Notifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Emergency department: arrival, triage (5-level acuity), treatment board,
 * disposition, and the ambulance fleet and trips. Blueprint §5.
 */
class EmergencyController extends Controller
{
    /** Target time to be seen by a clinician, minutes, per triage level. */
    public const TARGET_MINUTES = [1 => 0, 2 => 10, 3 => 30, 4 => 60, 5 => 120];

    public function __construct(protected Hospital $hospital, protected Notifier $notifier) {}

    public function board(): JsonResponse
    {
        $active = ErVisit::with(['patient', 'doctor:id,name', 'triager:id,name'])
            ->where('status', '!=', 'disposed')
            ->orderByRaw('case when triage_level is null then 0 else triage_level end')
            ->orderBy('arrived_at')->get();

        $today = ErVisit::whereDate('arrived_at', today());
        $done = (clone $today)->whereNotNull('disposed_at')->get(['arrived_at', 'disposed_at']);

        return response()->json([
            'data' => $active->map(fn (ErVisit $v) => $this->row($v)),
            'summary' => [
                'in_department' => $active->count(),
                'awaiting_triage' => $active->whereNull('triage_level')->count(),
                'critical' => $active->whereIn('triage_level', [1, 2])->count(),
                'arrivals_today' => (clone $today)->count(),
                'avg_los_minutes' => $done->count() ? (int) round($done->avg(fn ($v) => $v->arrived_at->diffInMinutes($v->disposed_at, true))) : null,
                'by_level' => collect(range(1, 5))->mapWithKeys(fn ($l) => [$l => $active->where('triage_level', $l)->count()]),
            ],
        ]);
    }

    public function history(Request $request): JsonResponse
    {
        $rows = ErVisit::with(['patient', 'doctor:id,name'])->where('status', 'disposed')
            ->when($request->filled('date'), fn ($q) => $q->whereDate('arrived_at', $request->date('date')))
            ->latest('disposed_at')->limit(200)->get();

        return response()->json(['data' => $rows->map(fn ($v) => $this->row($v))]);
    }

    /** Arrival. Unknown patients get a temporary record that can be corrected later. */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'patient_id' => ['nullable', 'integer'],
            'unknown' => ['sometimes', 'boolean'],
            'unknown_gender' => ['nullable', Rule::in(['male', 'female', 'other'])],
            'first_name' => ['required_without_all:patient_id,unknown', 'nullable', 'string', 'max:80'],
            'last_name' => ['required_without_all:patient_id,unknown', 'nullable', 'string', 'max:80'],
            'phone' => ['nullable', 'string', 'max:30'],
            'arrival_mode' => ['nullable', Rule::in(['walk_in', 'ambulance', 'referral', 'police', 'other'])],
            'chief_complaint' => ['required', 'string', 'max:500'],
            'ambulance_trip_id' => ['nullable', 'integer'],
        ]);

        $visit = DB::transaction(function () use ($data) {
            if (! empty($data['patient_id'])) {
                $patient = Patient::findOrFail($data['patient_id']);
            } else {
                $unknown = ! empty($data['unknown']);
                $patient = Patient::create([
                    'mrn' => $this->hospital->nextMrn(),
                    'first_name' => $unknown ? 'Unknown' : $data['first_name'],
                    'last_name' => $unknown ? 'Patient '.now()->format('His') : $data['last_name'],
                    'gender' => $data['unknown_gender'] ?? null,
                    'phone' => $data['phone'] ?? null,
                    'notes' => $unknown ? 'Registered in the emergency department without identification. Update the name when known.' : null,
                ]);
            }
            abort_if(ErVisit::where('patient_id', $patient->id)->where('status', '!=', 'disposed')->exists(), 422, "{$patient->name} is already in the emergency department.");

            $visit = ErVisit::create([
                'patient_id' => $patient->id,
                'arrival_mode' => $data['arrival_mode'] ?? 'walk_in',
                'arrived_at' => now(),
                'chief_complaint' => $data['chief_complaint'],
            ]);

            if (! empty($data['ambulance_trip_id'])) {
                AmbulanceTrip::whereKey($data['ambulance_trip_id'])->update(['er_visit_id' => $visit->id]);
            }

            // The emergency attendance fee, if the hospital set one in the service list.
            $fee = Service::where('category', 'emergency')->where('is_active', true)->orderBy('id')->first();
            if ($fee) {
                $this->hospital->charge($patient, 'procedure', $fee->name, (float) $fee->price, 1, $visit);
            }

            return $visit;
        });

        ActivityLog::record('er.arrival', "Emergency arrival: {$visit->patient->name}", ['er_visit_id' => $visit->id]);

        return response()->json($this->row($visit->load('patient')), 201);
    }

    public function triage(Request $request, ErVisit $visit): JsonResponse
    {
        abort_if($visit->status === 'disposed', 422, 'This visit is closed.');
        $data = $request->validate([
            'triage_level' => ['required', 'integer', 'between:1,5'],
            'vitals' => ['nullable', 'array'],
            'vitals.bp' => ['nullable', 'string', 'max:20'],
            'vitals.pulse' => ['nullable', 'numeric', 'between:0,300'],
            'vitals.temperature' => ['nullable', 'numeric', 'between:25,115'],
            'vitals.spo2' => ['nullable', 'numeric', 'between:0,100'],
            'vitals.respiration' => ['nullable', 'numeric', 'between:0,100'],
            'vitals.gcs' => ['nullable', 'integer', 'between:3,15'],
            'vitals.sugar' => ['nullable', 'numeric', 'between:0,2000'],
            'pain_score' => ['nullable', 'integer', 'between:0,10'],
            'red_flags' => ['nullable', 'string', 'max:500'],
            'isolation' => ['sometimes', 'boolean'],
        ]);

        $visit->fill($data);
        $visit->triaged_at ??= now();
        $visit->triaged_by = $request->user()->id;
        $visit->save();

        if ($data['triage_level'] <= 2) {
            $this->notifier->send($this->notifier->roleIds($visit->tenant_id, [User::ROLE_DOCTOR]), 'emergency',
                "⚠ Level {$data['triage_level']} in Emergency: {$visit->patient->name}", $visit->chief_complaint, '/emergency');
        }

        return response()->json($this->row($visit->load(['patient', 'doctor:id,name', 'triager:id,name'])));
    }

    public function update(Request $request, ErVisit $visit): JsonResponse
    {
        abort_if($visit->status === 'disposed', 422, 'This visit is closed.');
        $data = $request->validate([
            'doctor_id' => ['nullable', 'integer'],
            'bay' => ['nullable', 'string', 'max:30'],
            'status' => ['sometimes', Rule::in(['waiting', 'in_treatment', 'observation'])],
            'chief_complaint' => ['sometimes', 'string', 'max:500'],
        ]);
        if (! empty($data['doctor_id'])) {
            User::where('role', User::ROLE_DOCTOR)->findOrFail($data['doctor_id']);
            $data['status'] ??= 'in_treatment';
        }
        $visit->update($data);

        return response()->json($this->row($visit->load(['patient', 'doctor:id,name', 'triager:id,name'])));
    }

    /** Discharge, admit (to a bed), transfer, refer, left without being seen, LAMA or death. */
    public function dispose(Request $request, ErVisit $visit): JsonResponse
    {
        abort_if($visit->status === 'disposed', 422, 'This visit is already closed.');
        $data = $request->validate([
            'disposition' => ['required', Rule::in(['discharged', 'admitted', 'transferred', 'referred', 'lwbs', 'lama', 'deceased'])],
            'notes' => ['nullable', 'string', 'max:5000'],
            'bed_id' => ['required_if:disposition,admitted', 'nullable', 'integer'],
        ]);

        DB::transaction(function () use ($visit, $data) {
            if ($data['disposition'] === 'admitted') {
                $bed = Bed::lockForUpdate()->findOrFail($data['bed_id']);
                if ($bed->status !== 'available') {
                    throw ValidationException::withMessages(['bed_id' => "Bed {$bed->number} is not available."]);
                }
                abort_if(Admission::where('patient_id', $visit->patient_id)->where('status', 'admitted')->exists(), 422, 'This patient is already admitted.');
                $bed->update(['status' => 'occupied']);
                $admission = Admission::create([
                    'patient_id' => $visit->patient_id, 'bed_id' => $bed->id, 'doctor_id' => $visit->doctor_id,
                    'admitted_at' => now(), 'reason' => 'From Emergency: '.$visit->chief_complaint,
                ]);
                $visit->admission_id = $admission->id;
            }
            $visit->disposition = $data['disposition'];
            $visit->disposition_notes = $data['notes'] ?? null;
            $visit->disposed_at = now();
            $visit->status = 'disposed';
            $visit->save();
        });

        ActivityLog::record('er.disposition', "Emergency visit for {$visit->patient->name}: {$data['disposition']}", ['er_visit_id' => $visit->id]);

        return response()->json($this->row($visit->load(['patient', 'doctor:id,name'])));
    }

    /* ------------------------------------------------------------ ambulance */

    public function ambulances(): JsonResponse
    {
        return response()->json([
            'data' => Ambulance::orderBy('vehicle_no')->get(),
            'trips' => AmbulanceTrip::with('ambulance:id,vehicle_no')->where(fn ($q) => $q->whereNotIn('status', ['completed', 'cancelled'])->orWhere('requested_at', '>=', now()->subDay()))
                ->latest('requested_at')->limit(100)->get(),
        ]);
    }

    public function storeAmbulance(Request $request): JsonResponse
    {
        return response()->json(Ambulance::create($request->validate([
            'vehicle_no' => ['required', 'string', 'max:30'],
            'type' => ['nullable', Rule::in(['bls', 'als', 'patient_transport'])],
            'driver_name' => ['nullable', 'string', 'max:120'],
            'phone' => ['nullable', 'string', 'max:30'],
        ])), 201);
    }

    public function updateAmbulance(Request $request, Ambulance $ambulance): JsonResponse
    {
        $ambulance->update($request->validate([
            'vehicle_no' => ['sometimes', 'string', 'max:30'],
            'type' => ['sometimes', Rule::in(['bls', 'als', 'patient_transport'])],
            'driver_name' => ['nullable', 'string', 'max:120'],
            'phone' => ['nullable', 'string', 'max:30'],
            'status' => ['sometimes', Rule::in(['available', 'on_trip', 'maintenance'])],
        ]));

        return response()->json($ambulance);
    }

    public function storeTrip(Request $request): JsonResponse
    {
        $data = $request->validate([
            'caller_name' => ['nullable', 'string', 'max:120'],
            'caller_phone' => ['nullable', 'string', 'max:30'],
            'patient_name' => ['nullable', 'string', 'max:120'],
            'pickup_address' => ['required', 'string', 'max:300'],
            'destination' => ['nullable', 'string', 'max:300'],
            'reason' => ['nullable', 'string', 'max:300'],
            'ambulance_id' => ['nullable', 'integer'],
        ]);

        $trip = DB::transaction(function () use ($data) {
            $trip = AmbulanceTrip::create($data + ['requested_at' => now()]);
            if (! empty($data['ambulance_id'])) {
                $this->dispatchTo($trip, $data['ambulance_id']);
            }

            return $trip;
        });

        return response()->json($trip->load('ambulance:id,vehicle_no'), 201);
    }

    public function updateTrip(Request $request, AmbulanceTrip $trip): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', Rule::in(['dispatched', 'on_scene', 'transporting', 'completed', 'cancelled'])],
            'ambulance_id' => ['nullable', 'integer'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);

        DB::transaction(function () use ($trip, $data) {
            if ($data['status'] === 'dispatched' && ! $trip->ambulance_id) {
                abort_if(empty($data['ambulance_id']), 422, 'Choose an ambulance.');
                $this->dispatchTo($trip, $data['ambulance_id']);
            }
            $trip->status = $data['status'];
            $trip->notes = $data['notes'] ?? $trip->notes;
            if (in_array($data['status'], ['completed', 'cancelled'], true)) {
                $trip->completed_at = now();
                if ($trip->ambulance_id) {
                    Ambulance::whereKey($trip->ambulance_id)->update(['status' => 'available']);
                }
            }
            $trip->save();
        });

        return response()->json($trip->load('ambulance:id,vehicle_no'));
    }

    protected function dispatchTo(AmbulanceTrip $trip, int $ambulanceId): void
    {
        $amb = Ambulance::lockForUpdate()->findOrFail($ambulanceId);
        if ($amb->status !== 'available') {
            throw ValidationException::withMessages(['ambulance_id' => "{$amb->vehicle_no} is not available."]);
        }
        $amb->update(['status' => 'on_trip']);
        $trip->ambulance_id = $amb->id;
        $trip->status = 'dispatched';
        $trip->dispatched_at = now();
        $trip->save();
    }

    protected function row(ErVisit $v): array
    {
        $waited = $v->arrived_at->diffInMinutes($v->disposed_at ?? now(), true);
        $target = $v->triage_level ? self::TARGET_MINUTES[$v->triage_level] : 15;

        return $v->only('id', 'arrival_mode', 'arrived_at', 'chief_complaint', 'triage_level', 'triaged_at', 'vitals', 'pain_score', 'red_flags', 'isolation',
            'status', 'bay', 'disposition', 'disposed_at', 'disposition_notes', 'admission_id') + [
            'minutes' => (int) $waited,
            'overdue' => $v->status === 'waiting' && ! $v->doctor_id && $waited > $target,
            'patient' => $v->patient ? $v->patient->only('id', 'mrn', 'name', 'age', 'gender', 'allergies') : null,
            'doctor' => $v->doctor?->only('id', 'name'),
            'triager' => $v->relationLoaded('triager') ? $v->triager?->only('id', 'name') : null,
        ];
    }
}
