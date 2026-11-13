<?php

namespace App\Http\Controllers\Api\Hospital;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\Announcement;
use App\Models\Patient;
use App\Models\User;
use App\Models\UserNotification;
use App\Services\Notifier;
use App\Tenancy\TenantManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Notifications (the bell), announcements, search, module switches and the audit log.
 */
class CommunityController extends Controller
{
    public const MODULES = ['appointments', 'opd', 'ipd', 'pharmacy', 'lab', 'billing', 'insurance', 'roster', 'portal'];

    public function __construct(protected Notifier $notifier, protected TenantManager $tenants) {}

    public function notifications(Request $request): JsonResponse
    {
        $uid = $request->user()->id;

        return response()->json([
            'unread' => UserNotification::where('user_id', $uid)->whereNull('read_at')->count(),
            'data' => UserNotification::where('user_id', $uid)->latest('id')->limit(40)
                ->get(['id', 'type', 'title', 'body', 'url', 'read_at', 'created_at']),
        ]);
    }

    public function readNotifications(Request $request): JsonResponse
    {
        $ids = $request->validate(['ids' => ['nullable', 'array'], 'ids.*' => ['integer']])['ids'] ?? null;

        UserNotification::where('user_id', $request->user()->id)->whereNull('read_at')
            ->when($ids, fn ($q) => $q->whereIn('id', $ids))
            ->update(['read_at' => now()]);

        return response()->json(['unread' => UserNotification::where('user_id', $request->user()->id)->whereNull('read_at')->count()]);
    }

    public function announcements(Request $request): JsonResponse
    {
        $user = $request->user();
        $audiences = $this->audiencesFor($user);

        $items = Announcement::with('author')
            ->where(function ($q) use ($audiences, $user) {
                $q->where(fn ($q) => $q->where('tenant_id', $this->tenants->id())->whereIn('audience', $audiences));
                if ($user->hasRole(User::ROLE_ADMIN)) {
                    $q->orWhereNull('tenant_id');
                }
            })
            ->orderByDesc('pinned')->latest('id')->limit(30)->get();

        return response()->json(['data' => $items->map(fn (Announcement $a) => [
            'id' => $a->id, 'title' => $a->title, 'body' => $a->body, 'audience' => $a->audience, 'pinned' => $a->pinned,
            'created_at' => $a->created_at, 'platform' => $a->tenant_id === null,
            'author' => $a->author?->only('id', 'name'),
            'can_delete' => $a->tenant_id !== null && ($user->hasRole(User::ROLE_ADMIN) || $a->user_id === $user->id),
        ])]);
    }

    public function storeAnnouncement(Request $request): JsonResponse
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:200'],
            'body' => ['required', 'string', 'max:5000'],
            'audience' => ['required', Rule::in(Announcement::AUDIENCES)],
            'pinned' => ['sometimes', 'boolean'],
        ]);

        $a = new Announcement($data);
        $a->tenant_id = $this->tenants->id();
        $a->user_id = $request->user()->id;
        $a->save();

        $roles = match ($data['audience']) {
            'everyone' => User::TENANT_ROLES,
            'staff' => User::STAFF_ROLES,
            'doctors' => [User::ROLE_DOCTOR],
            'nurses' => [User::ROLE_NURSE],
            'patients' => [User::ROLE_PATIENT],
            default => [User::ROLE_ADMIN],
        };
        $ids = array_values(array_diff($this->notifier->roleIds($a->tenant_id, $roles), [$request->user()->id]));
        $this->notifier->send($ids, 'announcement', $data['title'], Str::limit($data['body'], 140), '/', $a->tenant_id);

        return response()->json(['id' => $a->id], 201);
    }

    public function destroyAnnouncement(Request $request, Announcement $announcement): JsonResponse
    {
        abort_unless($announcement->tenant_id === $this->tenants->id(), 404);
        abort_unless($request->user()->hasRole(User::ROLE_ADMIN) || $announcement->user_id === $request->user()->id, 403);
        $announcement->delete();

        return response()->json(null, 204);
    }

    /** Ctrl+K: patients and staff. */
    public function search(Request $request): JsonResponse
    {
        $q = trim((string) $request->validate(['q' => ['required', 'string', 'min:2', 'max:100']])['q']);
        $user = $request->user();
        abort_unless($user->isStaff(), 403);
        $term = "%{$q}%";

        return response()->json([
            'patients' => Patient::where(fn ($w) => $w->where('first_name', 'like', $term)->orWhere('last_name', 'like', $term)
                ->orWhere('mrn', 'like', $term)->orWhere('phone', 'like', $term))->limit(8)->get()
                ->map(fn ($p) => $p->only('id', 'mrn', 'name', 'age', 'gender', 'phone')),
            'staff' => User::whereIn('role', User::STAFF_ROLES)->where(fn ($w) => $w->where('name', 'like', $term)->orWhere('email', 'like', $term))
                ->limit(6)->get(['id', 'name', 'role', 'email']),
        ]);
    }

    public function modules(Request $request): JsonResponse
    {
        $data = $request->validate(['modules' => ['required', 'array'], 'modules.*' => ['boolean']]);
        $tenant = $this->tenants->current();
        $settings = $tenant->settings ?? [];
        $settings['modules'] = array_merge($settings['modules'] ?? [], array_intersect_key($data['modules'], array_flip(self::MODULES)));
        $tenant->settings = $settings;
        $tenant->save();

        ActivityLog::record('settings.modules', 'Changed which modules are on', $settings['modules']);

        return response()->json(['modules' => $settings['modules']]);
    }

    public function audit(Request $request): JsonResponse
    {
        $logs = ActivityLog::with('user')->where('tenant_id', $this->tenants->id())->latest('id')->paginate(50);

        return response()->json([
            'data' => collect($logs->items())->map(fn ($l) => [
                'id' => $l->id, 'action' => $l->action, 'description' => $l->description, 'created_at' => $l->created_at,
                'ip' => $l->ip, 'user' => $l->user?->only('id', 'name', 'role'),
            ]),
            'meta' => ['total' => $logs->total(), 'page' => $logs->currentPage(), 'last_page' => $logs->lastPage()],
        ]);
    }

    protected function audiencesFor(User $user): array
    {
        $list = ['everyone'];
        if ($user->isStaff()) {
            $list[] = 'staff';
        }
        $list[] = match ($user->role) {
            User::ROLE_DOCTOR => 'doctors',
            User::ROLE_NURSE => 'nurses',
            User::ROLE_PATIENT => 'patients',
            User::ROLE_ADMIN => 'admins',
            default => 'staff',
        };
        if ($user->hasRole(User::ROLE_ADMIN)) {
            $list = Announcement::AUDIENCES;
        }

        return array_values(array_unique($list));
    }
}
