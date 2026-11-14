<?php

namespace App\Http\Controllers\Api\Hospital;

use App\Http\Controllers\Controller;
use App\Models\Admission;
use App\Models\Appointment;
use App\Models\Bed;
use App\Models\Encounter;
use App\Models\ErVisit;
use App\Models\Expense;
use App\Models\InvoicePayment;
use App\Models\LabOrder;
use App\Models\Patient;
use App\Models\StockMovement;
use App\Services\Hospital;
use App\Support\Csv;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Management reports for a date range: OPD, inpatient census, emergency,
 * lab turnaround, pharmacy, revenue and diagnoses. Blueprint §27.
 * Add ?format=csv to download any section as a spreadsheet.
 */
class ReportsController extends Controller
{
    public function __construct(protected Hospital $hospital) {}

    public function __invoke(Request $request, string $section = 'overview')
    {
        $data = $request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date'], 'format' => ['nullable', 'in:json,csv']]);
        $from = Carbon::parse($data['from'] ?? now()->startOfMonth())->startOfDay();
        $to = Carbon::parse($data['to'] ?? now())->endOfDay();
        $tenantId = $request->user()->tenant_id;

        $report = match ($section) {
            'overview' => $this->overview($from, $to),
            'opd' => $this->opd($from, $to),
            'inpatients' => $this->inpatients($from, $to),
            'emergency' => $this->emergency($from, $to),
            'lab' => $this->lab($from, $to),
            'pharmacy' => $this->pharmacy($from, $to),
            'revenue' => $this->revenue($from, $to, $tenantId),
            'diagnoses' => $this->diagnoses($from, $to),
            default => abort(404),
        };

        if (($data['format'] ?? 'json') === 'csv') {
            $rows = $report['rows'] ?? [];
            $head = $rows ? array_keys((array) $rows[0]) : ['empty'];

            return Csv::download("{$section}-{$from->toDateString()}-{$to->toDateString()}.csv", array_map(fn ($h) => ucfirst(str_replace('_', ' ', $h)), $head), collect($rows)->map(fn ($r) => array_values((array) $r)));
        }

        return response()->json(['from' => $from->toDateString(), 'to' => $to->toDateString(), 'currency' => $this->hospital->currency()] + $report);
    }

    protected function overview(Carbon $from, Carbon $to): array
    {
        $collected = (float) InvoicePayment::whereBetween('paid_at', [$from, $to])->sum('amount');
        $spent = (float) Expense::whereIn('status', ['approved', 'paid'])->whereDate('spent_on', '>=', $from)->whereDate('spent_on', '<=', $to)->sum('amount');

        return ['kpis' => [
            'new_patients' => Patient::whereBetween('created_at', [$from, $to])->count(),
            'opd_visits' => Appointment::whereBetween('scheduled_at', [$from, $to])->whereIn('status', ['completed', 'in_progress', 'checked_in'])->count(),
            'admissions' => Admission::whereBetween('admitted_at', [$from, $to])->count(),
            'discharges' => Admission::whereBetween('discharged_at', [$from, $to])->count(),
            'er_visits' => ErVisit::whereBetween('arrived_at', [$from, $to])->count(),
            'lab_orders' => LabOrder::whereBetween('created_at', [$from, $to])->where('status', '!=', 'cancelled')->count(),
            'collected' => round($collected, 2),
            'expenses' => round($spent, 2),
            'net' => round($collected - $spent, 2),
            'occupancy' => ($beds = Bed::count()) ? round(Bed::where('status', 'occupied')->count() / $beds * 100, 1) : null,
        ]];
    }

    protected function opd(Carbon $from, Carbon $to): array
    {
        $appts = Appointment::with(['doctor:id,name', 'department:id,name'])->whereBetween('scheduled_at', [$from, $to])->get();
        $rows = $appts->groupBy(fn ($a) => $a->doctor_id)->map(fn ($g) => [
            'doctor' => $g->first()->doctor?->name,
            'department' => $g->first()->department?->name,
            'booked' => $g->count(),
            'seen' => $g->where('status', 'completed')->count(),
            'no_show' => $g->where('status', 'no_show')->count(),
            'cancelled' => $g->where('status', 'cancelled')->count(),
        ])->sortByDesc('seen')->values();

        return [
            'rows' => $rows->all(),
            'by_day' => $appts->whereNotIn('status', ['cancelled', 'no_show'])->groupBy(fn ($a) => $a->scheduled_at->toDateString())->map->count(),
            'totals' => ['booked' => $appts->count(), 'seen' => $appts->where('status', 'completed')->count(), 'no_show_rate' => $appts->count() ? round($appts->where('status', 'no_show')->count() / $appts->count() * 100, 1) : 0],
        ];
    }

    protected function inpatients(Carbon $from, Carbon $to): array
    {
        $discharged = Admission::with('bed.ward')->whereBetween('discharged_at', [$from, $to])->get();
        $rows = $discharged->groupBy(fn ($a) => $a->bed?->ward?->name ?? '—')->map(fn ($g, $ward) => [
            'ward' => $ward,
            'discharges' => $g->count(),
            'average_stay_days' => round($g->avg(fn ($a) => max(1, $a->admitted_at->diffInHours($a->discharged_at, true) / 24)), 1),
            'deaths' => $g->where('discharge_type', 'deceased')->count(),
            'lama' => $g->where('discharge_type', 'lama')->count(),
        ])->values();

        return [
            'rows' => $rows->all(),
            'totals' => [
                'admissions' => Admission::whereBetween('admitted_at', [$from, $to])->count(),
                'discharges' => $discharged->count(),
                'in_hospital_now' => Admission::where('status', 'admitted')->count(),
                'average_stay_days' => $discharged->count() ? round($discharged->avg(fn ($a) => max(1, $a->admitted_at->diffInHours($a->discharged_at, true) / 24)), 1) : null,
                'mortality_rate' => $discharged->count() ? round($discharged->where('discharge_type', 'deceased')->count() / $discharged->count() * 100, 2) : 0,
            ],
        ];
    }

    protected function emergency(Carbon $from, Carbon $to): array
    {
        $visits = ErVisit::whereBetween('arrived_at', [$from, $to])->get();
        $rows = collect(range(1, 5))->map(fn ($l) => [
            'triage_level' => $l,
            'visits' => ($g = $visits->where('triage_level', $l))->count(),
            'average_minutes_in_department' => $g->whereNotNull('disposed_at')->count() ? (int) round($g->whereNotNull('disposed_at')->avg(fn ($v) => $v->arrived_at->diffInMinutes($v->disposed_at, true))) : null,
            'admitted' => $g->where('disposition', 'admitted')->count(),
        ]);

        return [
            'rows' => $rows->all(),
            'dispositions' => $visits->whereNotNull('disposition')->countBy('disposition'),
            'arrival_modes' => $visits->countBy('arrival_mode'),
            'totals' => ['visits' => $visits->count(), 'left_without_being_seen' => $visits->where('disposition', 'lwbs')->count()],
        ];
    }

    protected function lab(Carbon $from, Carbon $to): array
    {
        $orders = LabOrder::with('items.test')->whereBetween('created_at', [$from, $to])->where('status', '!=', 'cancelled')->get();
        $items = $orders->flatMap(fn ($o) => $o->items->map(fn ($i) => ['test' => $i->test?->name, 'order' => $o, 'item' => $i]));
        $rows = $items->groupBy('test')->map(fn ($g, $test) => [
            'test' => $test,
            'count' => $g->count(),
            'reported' => $g->filter(fn ($x) => $x['item']->reported_at)->count(),
            'average_turnaround_hours' => ($done = $g->filter(fn ($x) => $x['item']->reported_at))->count()
                ? round($done->avg(fn ($x) => $x['order']->created_at->diffInMinutes($x['item']->reported_at, true) / 60), 1) : null,
            'critical' => $g->filter(fn ($x) => $x['item']->flag === 'critical')->count(),
        ])->sortByDesc('count')->values();

        return ['rows' => $rows->all(), 'totals' => ['orders' => $orders->count(), 'tests' => $items->count(), 'urgent' => $orders->whereIn('priority', ['urgent', 'stat'])->count()]];
    }

    protected function pharmacy(Carbon $from, Carbon $to): array
    {
        $moves = StockMovement::with('medicine:id,name,strength,unit_price')->where('type', 'dispense')->whereBetween('created_at', [$from, $to])->get();
        $rows = $moves->groupBy('medicine_id')->map(fn ($g) => [
            'medicine' => trim(($g->first()->medicine?->name ?? '').' '.($g->first()->medicine?->strength ?? '')),
            'units' => abs((int) $g->sum('quantity')),
            'value' => round(abs((int) $g->sum('quantity')) * (float) ($g->first()->medicine?->unit_price ?? 0), 2),
        ])->sortByDesc('value')->values();

        return ['rows' => $rows->all(), 'totals' => ['units' => $rows->sum('units'), 'value' => round($rows->sum('value'), 2)]];
    }

    protected function revenue(Carbon $from, Carbon $to, int $tenantId): array
    {
        $rows = DB::table('invoice_items')->join('invoices', 'invoices.id', '=', 'invoice_items.invoice_id')
            ->where('invoices.tenant_id', $tenantId)->where('invoices.status', '!=', 'void')
            ->whereBetween('invoices.created_at', [$from, $to])
            ->selectRaw('invoice_items.category as category, count(*) as items, sum(invoice_items.amount) as billed')
            ->groupBy('invoice_items.category')->orderByDesc('billed')->get()
            ->map(fn ($r) => ['category' => $r->category, 'items' => (int) $r->items, 'billed' => round((float) $r->billed, 2)]);

        $payments = InvoicePayment::whereBetween('paid_at', [$from, $to])->get(['amount', 'method']);

        return [
            'rows' => $rows->all(),
            'by_method' => $payments->groupBy('method')->map(fn ($g) => round((float) $g->sum('amount'), 2)),
            'totals' => ['billed' => round($rows->sum('billed'), 2), 'collected' => round((float) $payments->sum('amount'), 2)],
        ];
    }

    protected function diagnoses(Carbon $from, Carbon $to): array
    {
        $rows = Encounter::whereBetween('created_at', [$from, $to])->whereNotNull('diagnosis')->get(['diagnosis', 'icd_code'])
            ->groupBy(fn ($e) => mb_strtolower(trim($e->icd_code ?: $e->diagnosis)))
            ->map(fn ($g) => ['diagnosis' => $g->first()->diagnosis, 'icd_code' => $g->first()->icd_code, 'cases' => $g->count()])
            ->sortByDesc('cases')->take(50)->values();

        return ['rows' => $rows->all()];
    }
}
