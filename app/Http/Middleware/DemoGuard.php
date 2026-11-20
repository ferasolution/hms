<?php

namespace App\Http\Middleware;

use App\Services\DemoHospital;
use App\Tenancy\TenantManager;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * In the public demo hospital, everything can be tried except the few actions
 * that would lock other visitors out or change the hospital itself.
 */
class DemoGuard
{
    /** Method + path patterns (relative to /api) that are switched off in the demo. */
    protected const BLOCKED = [
        ['PATCH', 'auth/me'],
        ['POST', 'uploads'],
        ['POST', 'users'],
        ['PATCH', 'users/*'],
        ['PATCH', 'settings'],
        ['POST', 'billing/*'],
        ['POST', 'patients/*/portal'],
        ['DELETE', 'departments/*'],
        ['DELETE', 'wards/*'],
        ['DELETE', 'beds/*'],
        ['PATCH', 'hr/staff/*/employment'],
        ['PATCH', 'staff/*/profile'],
    ];

    public function __construct(protected TenantManager $tenants) {}

    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->isMethodSafe() && DemoHospital::isDemo($this->tenants->current())) {
            $path = preg_replace('#^api/#', '', $request->path());
            foreach (self::BLOCKED as [$method, $pattern]) {
                if ($request->isMethod($method) && fnmatch($pattern, $path)) {
                    return response()->json([
                        'message' => 'This is turned off in the demo hospital so it stays the same for everyone. Create your own free hospital to try it.',
                    ], 403);
                }
            }
        }

        return $next($request);
    }
}
