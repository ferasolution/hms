<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\TenantResource;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Services\DemoHospital;
use App\Tenancy\TenantManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * One-click sign-in to the public demo hospital as any role.
 */
class DemoController extends Controller
{
    /** Public: is there a demo, and which accounts can be used? */
    public function show(): JsonResponse
    {
        $tenant = DemoHospital::tenant();

        return response()->json([
            'available' => DemoHospital::isDemo($tenant),
            'slug' => DemoHospital::SLUG,
            'name' => $tenant?->name,
            'password' => DemoHospital::PASSWORD,
            'accounts' => collect(DemoHospital::ACCOUNTS)->map(fn ($a, $role) => ['role' => $role, 'name' => $a[0], 'email' => DemoHospital::email($role)])->values(),
        ]);
    }

    public function login(Request $request, TenantManager $tenants): JsonResponse
    {
        $tenant = $tenants->current();
        abort_unless(DemoHospital::isDemo($tenant), 404);

        $data = $request->validate(['role' => ['required', Rule::in(array_keys(DemoHospital::ACCOUNTS))]]);
        $user = User::where('email', DemoHospital::email($data['role']))->where('is_active', true)->first();
        abort_unless($user, 404, 'The demo is being reset. Please try again in a minute.');

        // Keep the demo tidy: only a handful of live tokens per account.
        $user->tokens()->where('created_at', '<', now()->subDay())->delete();

        return response()->json([
            'tenant' => new TenantResource($tenant->load('plan')),
            'user' => new UserResource($user),
            'token' => $user->createToken('demo')->plainTextToken,
        ]);
    }
}
