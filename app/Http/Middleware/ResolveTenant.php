<?php

namespace App\Http\Middleware;

use App\Models\Tenant;
use App\Tenancy\TenantManager;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Finds the tenant for this request, in order:
 *   1. subdomain of the central domain   (acme.hms.ferasolution.com)
 *   2. a tenant's custom domain          (learn.acme.com)
 *   3. the X-Tenant header               (works before wildcard DNS exists)
 */
class ResolveTenant
{
    public function __construct(protected TenantManager $tenants) {}

    public function handle(Request $request, Closure $next): Response
    {
        $tenant = $this->resolve($request);

        if (! $tenant) {
            return response()->json(['message' => 'Institute not found.'], 404);
        }

        if ($tenant->status === Tenant::STATUS_SUSPENDED) {
            return response()->json(['message' => 'This institute has been suspended.'], 403);
        }

        $this->tenants->set($tenant);

        // Appointment times are the hospital's wall-clock time.
        $previousTz = date_default_timezone_get();
        $tz = data_get($tenant->settings, 'timezone');
        if ($tz && in_array($tz, timezone_identifiers_list(), true)) {
            date_default_timezone_set($tz);
            config(['app.timezone' => $tz]);
        }

        try {
            return $next($request);
        } finally {
            $this->tenants->forget();
            date_default_timezone_set($previousTz);
            config(['app.timezone' => $previousTz]);
        }
    }

    protected function resolve(Request $request): ?Tenant
    {
        $host = strtolower($request->getHost());
        $central = strtolower((string) config('tenancy.central_domain'));

        if ($central !== '' && str_ends_with($host, '.'.$central)) {
            $slug = substr($host, 0, -strlen('.'.$central));

            return Tenant::where('slug', $slug)->first();
        }

        if ($central !== '' && $host !== $central) {
            $tenant = Tenant::where('custom_domain', $host)->first();

            if ($tenant) {
                return $tenant;
            }
        }

        $slug = $request->header(config('tenancy.header'));

        return $slug ? Tenant::where('slug', strtolower($slug))->first() : null;
    }
}
