<?php

namespace App\Http\Controllers\Api\Hospital;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\Expense;
use App\Models\InvoicePayment;
use App\Services\Hospital;
use App\Support\Csv;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

/**
 * Finance: expenses with two-person approval, and income vs. expenses
 * (profit & loss) by month. Blueprint §17.1, §17.3.
 */
class FinanceController extends Controller
{
    public const CATEGORIES = ['salaries', 'utilities', 'supplies', 'pharmacy_stock', 'maintenance', 'rent', 'equipment', 'marketing', 'insurance', 'taxes', 'other'];

    public function __construct(protected Hospital $hospital) {}

    public function expenses(Request $request): JsonResponse
    {
        $data = $request->validate([
            'status' => ['nullable', Rule::in(['pending', 'approved', 'paid', 'rejected'])],
            'from' => ['nullable', 'date'], 'to' => ['nullable', 'date'],
            'category' => ['nullable', Rule::in(self::CATEGORIES)],
        ]);

        return response()->json(['data' => Expense::with(['supplier:id,name', 'department:id,name', 'creator:id,name', 'approver:id,name'])
            ->when($data['status'] ?? null, fn ($q, $s) => $q->where('status', $s))
            ->when($data['category'] ?? null, fn ($q, $c) => $q->where('category', $c))
            ->when($data['from'] ?? null, fn ($q, $f) => $q->whereDate('spent_on', '>=', $f))
            ->when($data['to'] ?? null, fn ($q, $t) => $q->whereDate('spent_on', '<=', $t))
            ->latest('spent_on')->latest('id')->limit(500)->get()]);
    }

    public function storeExpense(Request $request): JsonResponse
    {
        $tenantId = $request->user()->tenant_id;
        $data = $request->validate([
            'spent_on' => ['required', 'date'],
            'category' => ['required', Rule::in(self::CATEGORIES)],
            'description' => ['required', 'string', 'max:300'],
            'amount' => ['required', 'numeric', 'min:0.01', 'max:100000000'],
            'method' => ['nullable', Rule::in(['cash', 'bank', 'card', 'cheque'])],
            'reference' => ['nullable', 'string', 'max:120'],
            'supplier_id' => ['nullable', 'integer', Rule::exists('suppliers', 'id')->where('tenant_id', $tenantId)],
            'department_id' => ['nullable', 'integer', Rule::exists('departments', 'id')->where('tenant_id', $tenantId)],
        ]);

        $expense = Expense::create(array_filter($data, fn ($v) => $v !== null) + ['created_by' => $request->user()->id]);

        return response()->json($expense->load(['supplier:id,name', 'department:id,name', 'creator:id,name']), 201);
    }

    /** approve / reject (not by the person who entered it), then mark paid. */
    public function updateExpense(Request $request, Expense $expense): JsonResponse
    {
        $data = $request->validate(['status' => ['required', Rule::in(['approved', 'rejected', 'paid'])], 'reference' => ['nullable', 'string', 'max:120']]);
        $user = $request->user();

        if (in_array($data['status'], ['approved', 'rejected'], true)) {
            abort_unless($expense->status === 'pending', 422, 'This expense has already been decided.');
            abort_if($expense->created_by === $user->id, 403, 'Someone other than the person who entered this expense must approve it.');
            $expense->approved_by = $user->id;
            $expense->approved_at = now();
        } else {
            abort_unless($expense->status === 'approved', 422, 'Approve the expense before paying it.');
        }
        $expense->status = $data['status'];
        $expense->reference = $data['reference'] ?? $expense->reference;
        $expense->save();

        ActivityLog::record("finance.expense.{$data['status']}", "Expense {$expense->description} ({$expense->amount}) {$data['status']}", ['expense_id' => $expense->id]);

        return response()->json($expense->load(['supplier:id,name', 'department:id,name', 'creator:id,name', 'approver:id,name']));
    }

    /** Income (patient payments) vs. approved/paid expenses, per month, for a year. */
    public function summary(Request $request): JsonResponse
    {
        $year = (int) ($request->validate(['year' => ['nullable', 'integer', 'between:2000,2100']])['year'] ?? now()->year);
        $from = Carbon::create($year, 1, 1)->startOfDay();
        $to = $from->copy()->endOfYear();

        $income = InvoicePayment::whereBetween('paid_at', [$from, $to])->get(['amount', 'paid_at', 'method'])
            ->groupBy(fn ($p) => (int) $p->paid_at->format('n'))->map(fn ($g) => round((float) $g->sum('amount'), 2));
        $expenses = Expense::whereIn('status', ['approved', 'paid'])->whereYear('spent_on', $year)->get(['amount', 'spent_on', 'category']);
        $byMonth = $expenses->groupBy(fn ($e) => (int) $e->spent_on->format('n'))->map(fn ($g) => round((float) $g->sum('amount'), 2));

        $months = collect(range(1, 12))->map(fn ($m) => [
            'month' => $m,
            'income' => $income[$m] ?? 0,
            'expenses' => $byMonth[$m] ?? 0,
            'net' => round(($income[$m] ?? 0) - ($byMonth[$m] ?? 0), 2),
        ]);

        return response()->json([
            'year' => $year,
            'currency' => $this->hospital->currency(),
            'months' => $months,
            'totals' => ['income' => round($months->sum('income'), 2), 'expenses' => round($months->sum('expenses'), 2), 'net' => round($months->sum('net'), 2)],
            'expense_by_category' => $expenses->groupBy('category')->map(fn ($g) => round((float) $g->sum('amount'), 2)),
            'pending_approval' => Expense::where('status', 'pending')->count(),
            'to_pay' => round((float) Expense::where('status', 'approved')->sum('amount'), 2),
        ]);
    }

    public function export(Request $request): \Symfony\Component\HttpFoundation\StreamedResponse
    {
        $rows = Expense::with(['supplier:id,name', 'department:id,name'])->latest('spent_on')->get()->map(fn ($e) => [
            $e->spent_on->toDateString(), $e->category, $e->description, $e->amount, $e->status, $e->method, $e->reference, $e->supplier?->name, $e->department?->name,
        ]);

        return Csv::download('expenses.csv', ['Date', 'Category', 'Description', 'Amount', 'Status', 'Method', 'Reference', 'Supplier', 'Department'], $rows);
    }
}
