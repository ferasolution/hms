<?php

namespace App\Http\Controllers\Api\Hospital;

use App\Http\Controllers\Controller;
use App\Models\Admission;
use App\Models\Appointment;
use App\Models\Bed;
use App\Models\Invoice;
use App\Models\InvoicePayment;
use App\Models\LabOrder;
use App\Models\Medicine;
use App\Models\Patient;
use App\Models\Prescription;
use App\Models\User;
use App\Services\Hospital;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The overview screen. Each role sees the numbers that matter to their day.
 */
class DashboardController extends Controller
{
    public function __invoke(Request $request, Hospital $hospital): JsonResponse
    {
        $user = $request->user();
        $role = $user->role;
        $out = ['role' => $role, 'currency' => $hospital->currency()];

        if ($role === User::ROLE_PATIENT) {
            return response()->json($out);
        }

        $todayAppts = Appointment::whereDate('scheduled_at', today())
            ->when($role === User::ROLE_DOCTOR, fn ($q) => $q->where('doctor_id', $user->id));

        $out['appointments_today'] = [
            'total' => (clone $todayAppts)->whereNotIn('status', ['cancelled'])->count(),
            'waiting' => (clone $todayAppts)->where('status', 'checked_in')->count(),
            'completed' => (clone $todayAppts)->where('status', 'completed')->count(),
        ];
        $out['queue'] = (clone $todayAppts)->with(['patient', 'doctor:id,name'])
            ->whereIn('status', ['scheduled', 'checked_in', 'in_progress'])
            ->orderByRaw("case status when 'in_progress' then 0 when 'checked_in' then 1 else 2 end")
            ->orderBy('scheduled_at')->limit(12)->get()
            ->map(fn ($a) => AppointmentController::row($a));

        $beds = Bed::selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');
        $out['beds'] = [
            'total' => (int) $beds->sum(),
            'occupied' => (int) ($beds['occupied'] ?? 0),
            'available' => (int) ($beds['available'] ?? 0),
        ];
        $out['inpatients'] = Admission::where('status', 'admitted')
            ->when($role === User::ROLE_DOCTOR, fn ($q) => $q->where('doctor_id', $user->id))->count();

        $out['patients'] = [
            'total' => Patient::count(),
            'new_today' => Patient::whereDate('created_at', today())->count(),
        ];

        $out['lab'] = [
            'pending' => LabOrder::whereIn('status', ['ordered', 'collected'])->count(),
            'urgent' => LabOrder::whereIn('status', ['ordered', 'collected'])->whereIn('priority', ['urgent', 'stat'])->count(),
        ];
        $out['pharmacy'] = [
            'pending' => Prescription::whereIn('status', ['pending', 'partial'])->count(),
            'low_stock' => Medicine::where('is_active', true)->whereColumn('stock', '<=', 'reorder_level')->count(),
        ];

        if ($user->hasRole(User::ROLE_ADMIN, User::ROLE_ACCOUNTANT, User::ROLE_RECEPTIONIST)) {
            $out['finance'] = [
                'collected_today' => round((float) InvoicePayment::whereDate('paid_at', today())->sum('amount'), 2),
                'collected_month' => round((float) InvoicePayment::where('paid_at', '>=', now()->startOfMonth())->sum('amount'), 2),
                'outstanding' => round((float) Invoice::whereIn('status', ['unpaid', 'partial'])->selectRaw('sum(total - paid) as due')->value('due'), 2),
            ];
            // Visits per day, last 14 days.
            $since = today()->subDays(13);
            $visits = Appointment::where('scheduled_at', '>=', $since)->whereNotIn('status', ['cancelled', 'no_show'])->pluck('scheduled_at')
                ->countBy(fn ($d) => $d->toDateString());
            $out['visits_series'] = collect(range(13, 0))->map(fn ($ago) => [
                'date' => today()->subDays($ago)->toDateString(),
                'count' => (int) ($visits[today()->subDays($ago)->toDateString()] ?? 0),
            ])->values();
        }

        if ($user->hasRole(User::ROLE_ADMIN)) {
            $out['staff'] = User::whereIn('role', User::STAFF_ROLES)->where('is_active', true)
                ->selectRaw('role, count(*) as total')->groupBy('role')->pluck('total', 'role')->map(fn ($n) => (int) $n);
        }

        return response()->json($out);
    }
}
