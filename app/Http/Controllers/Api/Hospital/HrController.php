<?php

namespace App\Http\Controllers\Api\Hospital;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\Attendance;
use App\Models\LeaveRequest;
use App\Models\StaffProfile;
use App\Models\User;
use App\Services\Notifier;
use App\Support\Csv;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

/**
 * HR: employment details, leave requests with approval, and daily attendance.
 * Blueprint §19.
 */
class HrController extends Controller
{
    public const LEAVE_TYPES = ['annual', 'sick', 'casual', 'unpaid', 'maternity', 'paternity', 'study'];

    public function __construct(protected Notifier $notifier) {}

    protected function isHr(User $u): bool
    {
        return $u->hasRole(User::ROLE_ADMIN, User::ROLE_HR);
    }

    /* ------------------------------------------------------------ leave */

    public function leave(Request $request): JsonResponse
    {
        $user = $request->user();
        $all = $this->isHr($user) && ! $request->boolean('mine');
        $status = $request->validate(['status' => ['nullable', Rule::in(['pending', 'approved', 'rejected', 'cancelled'])]])['status'] ?? null;

        $rows = LeaveRequest::with(['user:id,name,role', 'decider:id,name'])
            ->when(! $all, fn ($q) => $q->where('user_id', $user->id))
            ->when($status, fn ($q, $s) => $q->where('status', $s))
            ->latest('id')->limit(300)->get();

        return response()->json(['data' => $rows, 'balance' => $this->balance($user)]);
    }

    public function requestLeave(Request $request): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', Rule::in(self::LEAVE_TYPES)],
            'starts_on' => ['required', 'date'],
            'ends_on' => ['required', 'date', 'after_or_equal:starts_on'],
            'reason' => ['nullable', 'string', 'max:500'],
        ]);
        $user = $request->user();
        $days = (int) Carbon::parse($data['starts_on'])->diffInDays(Carbon::parse($data['ends_on'])) + 1;
        abort_if($days > 180, 422, 'That is longer than 180 days.');

        $overlap = LeaveRequest::where('user_id', $user->id)->whereIn('status', ['pending', 'approved'])
            ->whereDate('starts_on', '<=', $data['ends_on'])->whereDate('ends_on', '>=', $data['starts_on'])->exists();
        abort_if($overlap, 422, 'You already have leave on some of these days.');

        if ($data['type'] === 'annual') {
            $left = $this->balance($user)['annual_left'];
            abort_if($days > $left, 422, "You have {$left} annual leave days left this year.");
        }

        $leave = LeaveRequest::create($data + ['user_id' => $user->id, 'days' => $days]);
        $this->notifier->send($this->notifier->roleIds($user->tenant_id, [User::ROLE_HR, User::ROLE_ADMIN]), 'hr', "Leave request: {$user->name}", "{$days} day(s) of {$data['type']} leave from {$data['starts_on']}", '/hr');

        return response()->json($leave->load('user:id,name,role'), 201);
    }

    public function decideLeave(Request $request, LeaveRequest $leave): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate(['status' => ['required', Rule::in(['approved', 'rejected', 'cancelled'])], 'decision_note' => ['nullable', 'string', 'max:300']]);

        if ($data['status'] === 'cancelled') {
            abort_unless($leave->user_id === $user->id || $this->isHr($user), 403);
            abort_unless(in_array($leave->status, ['pending', 'approved'], true), 422, 'This request is closed.');
        } else {
            abort_unless($this->isHr($user), 403, 'Only HR or an admin can decide leave.');
            abort_if($leave->user_id === $user->id, 403, 'Someone else must approve your own leave.');
            abort_unless($leave->status === 'pending', 422, 'This request has already been decided.');
        }

        $leave->update($data + ['decided_by' => $user->id, 'decided_at' => now()]);
        $this->notifier->send($leave->user_id, 'hr', "Leave {$data['status']}", "{$leave->days} day(s) from {$leave->starts_on->toDateString()}", '/hr');
        ActivityLog::record("hr.leave.{$data['status']}", "Leave for {$leave->user->name} {$data['status']}", ['leave_id' => $leave->id]);

        return response()->json($leave->load(['user:id,name,role', 'decider:id,name']));
    }

    protected function balance(User $user): array
    {
        $entitled = (int) (StaffProfile::where('user_id', $user->id)->value('annual_leave_days') ?? 20);
        $used = (int) LeaveRequest::where('user_id', $user->id)->where('type', 'annual')->whereIn('status', ['pending', 'approved'])
            ->whereYear('starts_on', now()->year)->sum('days');

        return ['annual_entitled' => $entitled, 'annual_used' => $used, 'annual_left' => max(0, $entitled - $used)];
    }

    /* ------------------------------------------------------------ attendance */

    public function me(Request $request): JsonResponse
    {
        $u = $request->user();

        return response()->json([
            'today' => Attendance::where('user_id', $u->id)->whereDate('date', today())->first(),
            'month' => Attendance::where('user_id', $u->id)->whereDate('date', '>=', now()->startOfMonth())->orderBy('date')->get(),
        ]);
    }

    /** Clock in or out for today. Late after the start time set in HR settings (default 09:15). */
    public function clock(Request $request): JsonResponse
    {
        $u = $request->user();
        $row = Attendance::where('user_id', $u->id)->whereDate('date', today())->first()
            ?? new Attendance(['user_id' => $u->id, 'date' => today()]);
        if (! $row->check_in) {
            $row->check_in = now();
            $late = data_get(app(\App\Tenancy\TenantManager::class)->current()?->settings, 'hr.late_after', '09:15');
            $row->status = now()->format('H:i') > $late ? 'late' : 'present';
        } else {
            abort_if($row->check_out !== null, 422, 'You have already clocked out today.');
            $row->check_out = now();
        }
        $row->save();

        return response()->json($row);
    }

    /** Who is in today, on leave or not yet in. */
    public function board(Request $request): JsonResponse
    {
        $day = Carbon::parse($request->query('date', today()->toDateString()))->toDateString();
        $staff = User::whereIn('role', User::STAFF_ROLES)->where('is_active', true)->orderBy('name')->get(['id', 'name', 'role']);
        $rows = Attendance::whereDate('date', $day)->get()->keyBy('user_id');
        $onLeave = LeaveRequest::where('status', 'approved')->whereDate('starts_on', '<=', $day)->whereDate('ends_on', '>=', $day)->pluck('type', 'user_id');

        $data = $staff->map(fn ($s) => [
            'user' => $s,
            'check_in' => $rows[$s->id]->check_in ?? null,
            'check_out' => $rows[$s->id]->check_out ?? null,
            'status' => isset($onLeave[$s->id]) ? 'leave' : ($rows[$s->id]->status ?? 'absent'),
            'leave_type' => $onLeave[$s->id] ?? null,
        ]);

        return response()->json([
            'date' => $day,
            'data' => $data,
            'summary' => $data->countBy('status'),
        ]);
    }

    public function export(Request $request): \Symfony\Component\HttpFoundation\StreamedResponse
    {
        $month = Carbon::parse($request->query('month', now()->format('Y-m')).'-01');
        $rows = Attendance::with('user:id,name,role')->whereDate('date', '>=', $month)->whereDate('date', '<=', $month->copy()->endOfMonth())
            ->orderBy('date')->get()->map(fn ($a) => [$a->date->toDateString(), $a->user?->name, $a->user?->role, $a->status, $a->check_in?->format('H:i'), $a->check_out?->format('H:i')]);

        return Csv::download('attendance-'.$month->format('Y-m').'.csv', ['Date', 'Name', 'Role', 'Status', 'In', 'Out'], $rows);
    }

    /** Employment details (HR/admin only). */
    public function updateEmployment(Request $request, User $user): JsonResponse
    {
        abort_unless($this->isHr($request->user()), 403);
        abort_unless($user->isStaff(), 422, 'Employment details are for staff accounts.');
        $data = $request->validate([
            'employee_no' => ['nullable', 'string', 'max:30'],
            'joined_on' => ['nullable', 'date'],
            'employment_type' => ['nullable', Rule::in(['full_time', 'part_time', 'contract', 'visiting', 'locum'])],
            'annual_leave_days' => ['nullable', 'integer', 'min:0', 'max:60'],
        ]);
        $profile = StaffProfile::firstOrNew(['user_id' => $user->id]);
        $profile->fill(array_filter($data, fn ($v) => $v !== null));
        $profile->save();

        return response()->json($profile);
    }
}
