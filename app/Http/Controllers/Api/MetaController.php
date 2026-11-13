<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Plan;
use App\Tenancy\TenantManager;
use Illuminate\Http\JsonResponse;

/**
 * Small read-only endpoints the web app needs for its public pages.
 */
class MetaController extends Controller
{
    /** Public: plans for the pricing section. */
    public function plans(): JsonResponse
    {
        $plans = Plan::where('is_active', true)
            ->orderBy('price_monthly')
            ->get(['name', 'slug', 'price_monthly', 'currency', 'max_staff', 'max_beds', 'storage_mb']);

        return response()->json(['data' => $plans]);
    }

    /** Public (inside tenant middleware): name and type for the hospital's sign-in page. */
    public function tenant(TenantManager $tenants): JsonResponse
    {
        $tenant = $tenants->current();

        return response()->json([
            'name' => $tenant->name,
            'slug' => $tenant->slug,
            'type' => $tenant->type,
            'settings' => (object) collect($tenant->settings ?? [])->only(['brand', 'logo_url', 'welcome_message', 'support_email', 'support_phone', 'address'])->all(),
        ]);
    }
}
