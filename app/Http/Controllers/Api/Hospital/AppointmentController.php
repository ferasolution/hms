<?php

namespace App\Http\Controllers\Api\Hospital;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\Appointment;
use App\Models\InvoiceItem;
use App\Models\Patient;
use App\Models\StaffProfile;
use App\Models\User;
use App\Services\Hospital;
use App\Services\Notifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Booking, the front-desk queue and doctor schedules.
 */
class AppointmentController extends Controller
{
    public function __construct(protected Hospital $hospital, protected Notifier $notifier) {}

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'date' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:date'],
            'doctor_id' => ['nullable', 'integer'],
            'status' => ['nullable', Rule::in(Appointment::STATUSES)],
            'patient_id' => ['nullable', 'integer'],
        ]);
        $user = $request->user();
        $from = Carbon::parse($data['date'] ?? today())->startOfDay();
        $to = Carbon::parse($data['to'] ?? $from)->endOfDay();

        $doctorId = $user->hasRole(User::ROLE_DOCTOR) && empty($data['doctor_id']) ? $user->id : ($data['doctor_id'] ?? null);

        $rows = Appointment::with(['patient', 'doctor:id,name', 'department:id,name'])
            ->when(empty($data['patient_id']), fn ($q) => $q->whereBetween('scheduled_at', [$from, $to]))
            ->when($data['patient_id'] ?? null, fn ($q, $p) => $q->where('patient_id', $p))
            ->when($doctorId, fn ($q, $d) => $q->where('doctor_id', $d))
            ->when($data['status'] ?? null, fn ($q, $s) => $q->where('status', $s))
            ->orderBy('scheduled_at')->limit(500)->get();

        $counts = $rows->countBy('status');

        return response()->json([
            'data' => $rows->map(fn ($a) => $this->row($a)),
            'summary' => collect(Appointment::STATUSES)->mapWithKeys(fn ($s) => [$s => (int) ($counts[$s] ?? 0)]),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'patient_id' => ['required', 'integer'],
            'doctor_id' => ['required', 'integer'],
            'scheduled_at' => ['required', 'date'],
            'type' => ['nullable', Rule::in(Appointment::TYPES)],
            'reason' => ['nullable', 'string', 'max:500'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'video_url' => ['nullable', 'url:http,https', 'max:500'],
            'walk_in' => ['sometimes', 'boolean'],
        ]);

        $patient = Patient::findOrFail($data['patient_id']);
        $doctor = $this->doctor($data['doctor_id']);
        $at = Carbon::parse($data['scheduled_at']);
        if (! empty($data['walk_in'])) {
            // Seen now: take the next free minute so walk-ins never clash.
            $at = now()->second(0);
            while (Appointment::where('doctor_id', $doctor->id)->where('scheduled_at', $at)->whereNotIn('status', ['cancelled', 'no_show'])->exists()) {
                $at->addMinute();
            }
        }
        $appt = $this->book($patient, $doctor, $at, $data, $request->user());

        if (! empty($data['walk_in'])) {
            $this->checkIn($appt);
        }

        return response()->json($this->row($appt->load(['patient', 'doctor:id,name', 'department:id,name'])), 201);
    }

    public function update(Request $request, Appointment $appointment): JsonResponse
    {
        $user = $request->user();
        abort_if($user->hasRole(User::ROLE_DOCTOR) && $appointment->doctor_id !== $user->id, 403, 'This is another doctor’s appointment.');

        $data = $request->validate([
            'status' => ['sometimes', Rule::in(Appointment::STATUSES)],
            'scheduled_at' => ['sometimes', 'date'],
            'doctor_id' => ['sometimes', 'integer'],
            'type' => ['sometimes', Rule::in(Appointment::TYPES)],
            'reason' => ['nullable', 'string', 'max:500'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'video_url' => ['nullable', 'url:http,https', 'max:500'],
        ]);

        if (isset($data['scheduled_at']) || isset($data['doctor_id'])) {
            $doctor = isset($data['doctor_id']) ? $this->doctor($data['doctor_id']) : $appointment->doctor;
            $at = Carbon::parse($data['scheduled_at'] ?? $appointment->scheduled_at)->second(0);
            $this->ensureFree($doctor, $at, $appointment->id);
            $appointment->doctor_id = $doctor->id;
            $appointment->scheduled_at = $at;
            $appointment->department_id = $doctor->staffProfile?->department_id;
        }

        $appointment->fill(collect($data)->only(['type', 'reason', 'notes', 'video_url'])->all());
        $status = $data['status'] ?? null;
        $appointment->save();

        if ($status === 'checked_in' && $appointment->status !== 'checked_in') {
            $this->checkIn($appointment);
        } elseif ($status) {
            $appointment->status = $status;
            $appointment->save();
        }

        if ($status === 'cancelled' && $appointment->patient?->user_id) {
            $this->notifier->send($appointment->patient->user_id, 'appointment', 'Appointment cancelled',
                'Your appointment on '.$appointment->scheduled_at->toDayDateTimeString().' was cancelled.', '/appointments');
        }

        return response()->json($this->row($appointment->load(['patient', 'doctor:id,name', 'department:id,name'])));
    }

    /** Free times for a doctor on a day. */
    public function slots(Request $request): JsonResponse
    {
        $data = $request->validate(['doctor_id' => ['required', 'integer'], 'date' => ['required', 'date']]);
        $doctor = $this->doctor($data['doctor_id']);

        return response()->json(['data' => $this->freeSlots($doctor, Carbon::parse($data['date']))]);
    }

    /* ------------------------------------------------------------ shared with the patient portal */

    public function book(Patient $patient, User $doctor, Carbon $at, array $data, User $by): Appointment
    {
        $at = $at->copy()->second(0);
        $this->ensureFree($doctor, $at);
        $profile = $doctor->staffProfile;

        $token = Appointment::where('doctor_id', $doctor->id)->whereDate('scheduled_at', $at->toDateString())->max('token_no') + 1;

        $appt = Appointment::create([
            'patient_id' => $patient->id,
            'doctor_id' => $doctor->id,
            'department_id' => $profile?->department_id,
            'scheduled_at' => $at,
            'duration_minutes' => $profile?->slot_minutes ?: 15,
            'type' => $data['type'] ?? 'consultation',
            'reason' => $data['reason'] ?? null,
            'notes' => $data['notes'] ?? null,
            'video_url' => $data['video_url'] ?? null,
            'token_no' => $token,
            'created_by' => $by->id,
        ]);

        $this->notifier->send($doctor, 'appointment', "New appointment: {$patient->name}",
            $at->toDayDateTimeString().($appt->reason ? " · {$appt->reason}" : ''), '/appointments');
        ActivityLog::record('appointment.booked', "Booked {$patient->name} with Dr. {$doctor->name} for ".$at->toDayDateTimeString(), ['appointment_id' => $appt->id]);

        return $appt;
    }

    public function freeSlots(User $doctor, Carbon $date): array
    {
        $profile = $doctor->staffProfile;
        $minutes = max(5, (int) ($profile?->slot_minutes ?: 15));
        $schedule = $profile?->schedule;
        $hours = $schedule === null
            ? ($date->isSunday() ? null : ['09:00', '17:00'])
            : ($schedule[(string) $date->dayOfWeekIso] ?? null);

        if (! $hours || count($hours) < 2) {
            return [];
        }

        $taken = Appointment::where('doctor_id', $doctor->id)->whereDate('scheduled_at', $date->toDateString())
            ->whereNotIn('status', ['cancelled', 'no_show'])->pluck('scheduled_at')
            ->map(fn ($d) => $d->format('H:i'))->flip();

        $slots = [];
        $t = $date->copy()->setTimeFromTimeString($hours[0]);
        $end = $date->copy()->setTimeFromTimeString($hours[1]);
        while ($t->copy()->addMinutes($minutes)->lte($end)) {
            if ($t->isFuture() && ! isset($taken[$t->format('H:i')])) {
                $slots[] = $t->format('Y-m-d H:i');
            }
            $t->addMinutes($minutes);
        }

        return $slots;
    }

    protected function ensureFree(User $doctor, Carbon $at, ?int $ignore = null): void
    {
        $clash = Appointment::where('doctor_id', $doctor->id)
            ->where('scheduled_at', $at->copy()->second(0))
            ->whereNotIn('status', ['cancelled', 'no_show'])
            ->when($ignore, fn ($q) => $q->where('id', '!=', $ignore))
            ->exists();

        if ($clash) {
            throw ValidationException::withMessages(['scheduled_at' => 'Dr. '.$doctor->name.' already has an appointment at this time.']);
        }
    }

    /** Arrived at the front desk: queue them and bill the consultation once. */
    protected function checkIn(Appointment $appt): void
    {
        $appt->status = 'checked_in';
        $appt->checked_in_at = now();
        $appt->save();

        $billed = InvoiceItem::where('source_type', $appt->getMorphClass())->where('source_id', $appt->id)->exists();
        $fee = (float) (StaffProfile::where('user_id', $appt->doctor_id)->value('consultation_fee') ?? 0);
        if (! $billed && $fee > 0) {
            $this->hospital->charge($appt->patient, 'consultation', 'Consultation — Dr. '.$appt->doctor?->name, $fee, 1, $appt);
        }
    }

    protected function doctor(int $id): User
    {
        $doctor = User::where('id', $id)->where('role', User::ROLE_DOCTOR)->where('is_active', true)->first();
        if (! $doctor) {
            throw ValidationException::withMessages(['doctor_id' => 'Choose an active doctor.']);
        }

        return $doctor;
    }

    public static function row(Appointment $a): array
    {
        return [
            'id' => $a->id,
            'scheduled_at' => $a->scheduled_at,
            'duration_minutes' => $a->duration_minutes,
            'type' => $a->type,
            'status' => $a->status,
            'token_no' => $a->token_no,
            'reason' => $a->reason,
            'notes' => $a->notes,
            'video_url' => $a->video_url,
            'checked_in_at' => $a->checked_in_at,
            'patient' => $a->patient ? $a->patient->only('id', 'mrn', 'name', 'age', 'gender', 'phone') : null,
            'doctor' => $a->doctor?->only('id', 'name'),
            'department' => $a->department?->only('id', 'name'),
        ];
    }
}
