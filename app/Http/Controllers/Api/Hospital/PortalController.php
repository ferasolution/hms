<?php

namespace App\Http\Controllers\Api\Hospital;

use App\Http\Controllers\Controller;
use App\Models\Appointment;
use App\Models\Encounter;
use App\Models\Invoice;
use App\Models\LabOrder;
use App\Models\Patient;
use App\Models\Prescription;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;

/**
 * The patient's own view: visits, prescriptions, results, bills and booking.
 */
class PortalController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $patient = $this->patient($request);

        return response()->json([
            'patient' => PatientController::row($patient),
            'upcoming' => Appointment::with(['doctor:id,name', 'department:id,name'])->where('patient_id', $patient->id)
                ->where('scheduled_at', '>=', now()->startOfDay())->whereIn('status', ['scheduled', 'checked_in'])
                ->orderBy('scheduled_at')->get()->map(fn ($a) => AppointmentController::row($a)),
            'past' => Appointment::with(['doctor:id,name', 'department:id,name'])->where('patient_id', $patient->id)
                ->where(fn ($q) => $q->where('scheduled_at', '<', now()->startOfDay())->orWhereNotIn('status', ['scheduled', 'checked_in']))
                ->latest('scheduled_at')->limit(30)->get()->map(fn ($a) => AppointmentController::row($a)),
            'visits' => Encounter::with('doctor:id,name')->where('patient_id', $patient->id)->latest('id')->limit(30)
                ->get(['id', 'doctor_id', 'type', 'diagnosis', 'plan', 'follow_up_on', 'vitals', 'created_at']),
            'prescriptions' => Prescription::with(['items', 'doctor:id,name'])->where('patient_id', $patient->id)->where('status', '!=', 'cancelled')->latest('id')->limit(30)->get(),
            'results' => LabOrder::with(['items.test'])->where('patient_id', $patient->id)->where('status', 'completed')->latest('completed_at')->limit(30)->get(),
            'invoices' => Invoice::with('items')->where('patient_id', $patient->id)->where('status', '!=', 'void')->latest('id')->limit(30)->get(),
        ]);
    }

    public function book(Request $request, AppointmentController $appointments): JsonResponse
    {
        $patient = $this->patient($request);
        $data = $request->validate([
            'doctor_id' => ['required', 'integer'],
            'scheduled_at' => ['required', 'date', 'after:now'],
            'reason' => ['nullable', 'string', 'max:500'],
            'type' => ['nullable', 'in:consultation,follow_up,telemedicine'],
        ]);

        $doctor = User::where('role', User::ROLE_DOCTOR)->where('is_active', true)->find($data['doctor_id']);
        if (! $doctor) {
            throw ValidationException::withMessages(['doctor_id' => 'Choose a doctor.']);
        }
        $at = Carbon::parse($data['scheduled_at'])->second(0);
        if (! in_array($at->format('Y-m-d H:i'), $appointments->freeSlots($doctor, $at->copy()), true)) {
            throw ValidationException::withMessages(['scheduled_at' => 'That time is no longer free. Please pick another.']);
        }
        abort_if(Appointment::where('patient_id', $patient->id)->where('scheduled_at', '>=', now())->where('status', 'scheduled')->count() >= 3, 422, 'You already have 3 upcoming appointments.');

        $appt = $appointments->book($patient, $doctor, $at, $data, $request->user());

        return response()->json(AppointmentController::row($appt->load(['doctor:id,name', 'department:id,name', 'patient'])), 201);
    }

    public function cancel(Request $request, Appointment $appointment): JsonResponse
    {
        $patient = $this->patient($request);
        abort_unless($appointment->patient_id === $patient->id, 404);
        abort_unless($appointment->status === 'scheduled', 422, 'Only upcoming appointments can be cancelled.');
        $appointment->update(['status' => 'cancelled']);

        return response()->json(['status' => 'cancelled']);
    }

    protected function patient(Request $request): Patient
    {
        $patient = Patient::where('user_id', $request->user()->id)->first();
        abort_unless($patient, 404, 'Your account is not linked to a patient record yet. Please contact the front desk.');

        return $patient;
    }
}
