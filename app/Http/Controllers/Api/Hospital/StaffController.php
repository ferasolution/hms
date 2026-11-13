<?php

namespace App\Http\Controllers\Api\Hospital;

use App\Http\Controllers\Controller;
use App\Models\Department;
use App\Models\DutyShift;
use App\Models\StaffProfile;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

/**
 * Departments, doctor directory and profiles, and the duty roster.
 */
class StaffController extends Controller
{
    /* ------------------------------------------------------------ departments */

    public function departments(): JsonResponse
    {
        $counts = StaffProfile::whereNotNull('department_id')->selectRaw('department_id, count(*) as total')->groupBy('department_id')->pluck('total', 'department_id');

        return response()->json(['data' => Department::orderBy('name')->get()->map(fn ($d) => $d->toArray() + ['staff_count' => (int) ($counts[$d->id] ?? 0)])]);
    }

    public function storeDepartment(Request $request): JsonResponse
    {
        $data = $request->validate($this->departmentRules($request));

        return response()->json(Department::create($data), 201);
    }

    public function updateDepartment(Request $request, Department $department): JsonResponse
    {
        $department->update($request->validate($this->departmentRules($request, $department)));

        return response()->json($department);
    }

    public function destroyDepartment(Department $department): JsonResponse
    {
        $department->delete();

        return response()->json(null, 204);
    }

    /* ------------------------------------------------------------ doctors and staff */

    /** Active doctors with their department, fee and schedule (for booking). */
    public function doctors(Request $request): JsonResponse
    {
        $doctors = User::with('staffProfile.department:id,name')
            ->where('role', User::ROLE_DOCTOR)->where('is_active', true)
            ->when($request->integer('department_id'), fn ($q, $d) => $q->whereIn('id', StaffProfile::where('department_id', $d)->select('user_id')))
            ->orderBy('name')->get();

        return response()->json(['data' => $doctors->map(fn (User $u) => $this->staffRow($u))]);
    }

    /** Everyone who works here, with their profile. */
    public function staff(Request $request): JsonResponse
    {
        $users = User::with('staffProfile.department:id,name')
            ->whereIn('role', User::STAFF_ROLES)
            ->when($request->filled('role'), fn ($q) => $q->where('role', $request->string('role')))
            ->orderBy('name')->get();

        return response()->json(['data' => $users->map(fn (User $u) => $this->staffRow($u) + ['email' => $u->email, 'phone' => $u->phone, 'is_active' => (bool) $u->is_active])]);
    }

    public function updateProfile(Request $request, User $user): JsonResponse
    {
        abort_unless($user->isStaff(), 422, 'Profiles are for staff accounts.');
        $me = $request->user();
        abort_unless($me->hasRole(User::ROLE_ADMIN) || $me->id === $user->id, 403, 'You can only edit your own profile.');

        $data = $request->validate([
            'department_id' => ['nullable', 'integer', Rule::exists('departments', 'id')->where('tenant_id', $me->tenant_id)],
            'specialization' => ['nullable', 'string', 'max:120'],
            'qualification' => ['nullable', 'string', 'max:200'],
            'license_no' => ['nullable', 'string', 'max:60'],
            'consultation_fee' => ['nullable', 'numeric', 'min:0', 'max:1000000'],
            'slot_minutes' => ['nullable', 'integer', Rule::in([5, 10, 15, 20, 30, 45, 60])],
            'schedule' => ['nullable', 'array'],
            'schedule.*' => ['nullable', 'array', 'size:2'],
            'schedule.*.*' => ['date_format:H:i'],
            'bio' => ['nullable', 'string', 'max:1000'],
        ]);

        if (array_key_exists('schedule', $data) && $data['schedule'] !== null) {
            $data['schedule'] = collect($data['schedule'])
                ->filter(fn ($h, $day) => in_array((int) $day, range(1, 7), true) && $h && $h[0] < $h[1])
                ->mapWithKeys(fn ($h, $day) => [(string) $day => [$h[0], $h[1]]])->all();
        }

        $profile = StaffProfile::firstOrNew(['user_id' => $user->id]);
        $profile->fill($data);
        $profile->save();

        return response()->json($this->staffRow($user->load('staffProfile.department:id,name')));
    }

    /* ------------------------------------------------------------ roster */

    public function roster(Request $request): JsonResponse
    {
        $data = $request->validate(['from' => ['nullable', 'date'], 'department_id' => ['nullable', 'integer'], 'mine' => ['sometimes', 'boolean']]);
        $from = Carbon::parse($data['from'] ?? today())->startOfWeek();
        $to = $from->copy()->addDays(6);
        $user = $request->user();

        $shifts = DutyShift::with(['user:id,name,role', 'department:id,name'])
            ->whereBetween('date', [$from->toDateString(), $to->toDateString()])
            ->when($data['department_id'] ?? null, fn ($q, $d) => $q->where('department_id', $d))
            ->when(! empty($data['mine']), fn ($q) => $q->where('user_id', $user->id))
            ->orderBy('date')->get();

        return response()->json([
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'data' => $shifts->map(fn ($s) => [
                'id' => $s->id, 'date' => $s->date->toDateString(), 'shift' => $s->shift, 'notes' => $s->notes,
                'user' => $s->user?->only('id', 'name', 'role'), 'department' => $s->department?->only('id', 'name'),
            ]),
        ]);
    }

    public function storeShift(Request $request): JsonResponse
    {
        $tenantId = $request->user()->tenant_id;
        $data = $request->validate([
            'user_ids' => ['required', 'array', 'min:1', 'max:100'],
            'user_ids.*' => ['integer'],
            'dates' => ['required', 'array', 'min:1', 'max:31'],
            'dates.*' => ['date'],
            'shift' => ['required', Rule::in(DutyShift::SHIFTS)],
            'department_id' => ['nullable', 'integer', Rule::exists('departments', 'id')->where('tenant_id', $tenantId)],
            'notes' => ['nullable', 'string', 'max:300'],
        ]);

        $users = User::whereIn('id', $data['user_ids'])->whereIn('role', User::STAFF_ROLES)->pluck('id');
        $created = 0;
        foreach ($users as $uid) {
            foreach ($data['dates'] as $date) {
                $shift = DutyShift::firstOrCreate(
                    ['user_id' => $uid, 'date' => Carbon::parse($date)->toDateString(), 'shift' => $data['shift']],
                    ['department_id' => $data['department_id'] ?? null, 'notes' => $data['notes'] ?? null],
                );
                $created += $shift->wasRecentlyCreated ? 1 : 0;
            }
        }

        return response()->json(['created' => $created], 201);
    }

    public function destroyShift(DutyShift $shift): JsonResponse
    {
        $shift->delete();

        return response()->json(null, 204);
    }

    protected function staffRow(User $u): array
    {
        $p = $u->staffProfile;

        return [
            'id' => $u->id,
            'name' => $u->name,
            'role' => $u->role,
            'department' => $p?->department?->only('id', 'name'),
            'specialization' => $p?->specialization,
            'qualification' => $p?->qualification,
            'license_no' => $p?->license_no,
            'consultation_fee' => $p?->consultation_fee ?? '0.00',
            'slot_minutes' => $p?->slot_minutes ?? 15,
            'schedule' => $p?->schedule,
            'bio' => $p?->bio,
        ];
    }

    protected function departmentRules(Request $request, ?Department $department = null): array
    {
        return [
            'name' => [$department ? 'sometimes' : 'required', 'string', 'max:120',
                Rule::unique('departments', 'name')->where('tenant_id', $request->user()->tenant_id)->ignore($department?->id)],
            'code' => ['nullable', 'string', 'max:20'],
            'description' => ['nullable', 'string', 'max:500'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
