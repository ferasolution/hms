<?php

namespace App\Http\Controllers\Api\Hospital;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\InsuranceClaim;
use App\Models\Invoice;
use App\Models\InvoicePayment;
use App\Models\Patient;
use App\Services\Hospital;
use App\Support\Csv;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Patient billing: invoices (most lines are added automatically by
 * consultations, lab, pharmacy and room stays), payments and insurance claims.
 */
class InvoiceController extends Controller
{
    public const METHODS = ['cash', 'card', 'bank', 'insurance', 'online'];

    public function __construct(protected Hospital $hospital) {}

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'status' => ['nullable', Rule::in(['unpaid', 'partial', 'paid', 'void', 'open'])],
            'search' => ['nullable', 'string', 'max:100'],
            'patient_id' => ['nullable', 'integer'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $rows = Invoice::with('patient')
            ->when(($data['status'] ?? null) === 'open', fn ($q) => $q->whereIn('status', ['unpaid', 'partial']),
                fn ($q) => $q->when($data['status'] ?? null, fn ($q, $s) => $q->where('status', $s)))
            ->when($data['patient_id'] ?? null, fn ($q, $p) => $q->where('patient_id', $p))
            ->when($data['search'] ?? null, fn ($q, $s) => $q->where(fn ($q) => $q->where('number', 'like', "%{$s}%")
                ->orWhereIn('patient_id', Patient::where('first_name', 'like', "%{$s}%")->orWhere('last_name', 'like', "%{$s}%")->orWhere('mrn', 'like', "%{$s}%")->select('id'))))
            ->latest('id')->paginate(30);

        return response()->json([
            'data' => collect($rows->items())->map(fn (Invoice $i) => $this->row($i)),
            'meta' => ['total' => $rows->total(), 'page' => $rows->currentPage(), 'last_page' => $rows->lastPage()],
        ]);
    }

    public function summary(Request $request): JsonResponse
    {
        $data = $request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date']]);
        $from = Carbon::parse($data['from'] ?? now()->startOfMonth())->startOfDay();
        $to = Carbon::parse($data['to'] ?? now())->endOfDay();

        $payments = InvoicePayment::whereBetween('paid_at', [$from, $to]);
        $byMethod = (clone $payments)->selectRaw('method, sum(amount) as total')->groupBy('method')->pluck('total', 'method')->map(fn ($v) => round((float) $v, 2));

        $items = DB::table('invoice_items')->join('invoices', 'invoices.id', '=', 'invoice_items.invoice_id')
            ->where('invoices.tenant_id', $request->user()->tenant_id)->where('invoices.status', '!=', 'void')
            ->whereBetween('invoices.created_at', [$from, $to])
            ->selectRaw('invoice_items.category, sum(invoice_items.amount) as total')->groupBy('invoice_items.category')
            ->pluck('total', 'category')->map(fn ($v) => round((float) $v, 2));

        // Daily collections for the chart.
        $daily = (clone $payments)->get(['amount', 'paid_at'])->groupBy(fn ($p) => $p->paid_at->toDateString())->map(fn ($g) => round((float) $g->sum('amount'), 2));

        return response()->json([
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'collected' => round((float) (clone $payments)->sum('amount'), 2),
            'billed' => round((float) Invoice::where('status', '!=', 'void')->whereBetween('created_at', [$from, $to])->sum('total'), 2),
            'outstanding' => round((float) Invoice::whereIn('status', ['unpaid', 'partial'])->selectRaw('sum(total - paid) as due')->value('due'), 2),
            'open_invoices' => Invoice::whereIn('status', ['unpaid', 'partial'])->count(),
            'by_method' => $byMethod,
            'by_category' => $items,
            'daily' => $daily,
            'claims' => [
                'submitted' => InsuranceClaim::where('status', 'submitted')->count(),
                'pending_amount' => round((float) InsuranceClaim::where('status', 'submitted')->sum('amount_claimed'), 2),
            ],
            'currency' => $this->hospital->currency(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'patient_id' => ['required', 'integer'],
            'items' => ['required', 'array', 'min:1', 'max:100'],
            'items.*.category' => ['nullable', Rule::in(['consultation', 'lab', 'radiology', 'pharmacy', 'room', 'procedure', 'other'])],
            'items.*.description' => ['required', 'string', 'max:255'],
            'items.*.quantity' => ['required', 'numeric', 'min:0.01', 'max:100000'],
            'items.*.unit_price' => ['required', 'numeric', 'min:0', 'max:10000000'],
            'discount' => ['nullable', 'numeric', 'min:0'],
            'tax' => ['nullable', 'numeric', 'min:0'],
            'due_on' => ['nullable', 'date'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);
        $patient = Patient::findOrFail($data['patient_id']);

        $invoice = DB::transaction(function () use ($data, $patient, $request) {
            $invoice = Invoice::create([
                'patient_id' => $patient->id,
                'number' => $this->hospital->nextInvoiceNumber(),
                'currency' => $this->hospital->currency(),
                'discount' => $data['discount'] ?? 0,
                'tax' => $data['tax'] ?? 0,
                'due_on' => $data['due_on'] ?? null,
                'notes' => $data['notes'] ?? null,
                'created_by' => $request->user()->id,
            ]);
            foreach ($data['items'] as $item) {
                $invoice->items()->create([
                    'category' => $item['category'] ?? 'other',
                    'description' => $item['description'],
                    'quantity' => $item['quantity'],
                    'unit_price' => $item['unit_price'],
                    'amount' => round($item['quantity'] * $item['unit_price'], 2),
                ]);
            }

            return $this->hospital->recalculate($invoice);
        });

        return response()->json($this->full($invoice), 201);
    }

    public function show(Invoice $invoice): JsonResponse
    {
        return response()->json($this->full($invoice));
    }

    /** Discount, tax, notes, add/remove lines, or void. */
    public function update(Request $request, Invoice $invoice): JsonResponse
    {
        abort_if($invoice->status === 'void', 422, 'This invoice is void.');
        $data = $request->validate([
            'discount' => ['sometimes', 'numeric', 'min:0'],
            'tax' => ['sometimes', 'numeric', 'min:0'],
            'due_on' => ['nullable', 'date'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'void' => ['sometimes', 'boolean'],
            'add_items' => ['nullable', 'array', 'max:50'],
            'add_items.*.category' => ['nullable', Rule::in(['consultation', 'lab', 'radiology', 'pharmacy', 'room', 'procedure', 'other'])],
            'add_items.*.description' => ['required', 'string', 'max:255'],
            'add_items.*.quantity' => ['required', 'numeric', 'min:0.01'],
            'add_items.*.unit_price' => ['required', 'numeric', 'min:0'],
            'remove_item_ids' => ['nullable', 'array'],
            'remove_item_ids.*' => ['integer'],
        ]);

        $sensitive = ! empty($data['void']) || array_key_exists('discount', $data) || ! empty($data['remove_item_ids']);
        abort_if($sensitive && ! $request->user()->hasRole(\App\Models\User::ROLE_ADMIN, \App\Models\User::ROLE_ACCOUNTANT), 403, 'Only accounts or an admin can discount, remove lines or void a bill.');

        DB::transaction(function () use ($invoice, $data) {
            if (! empty($data['void'])) {
                abort_if((float) $invoice->paid > 0, 422, 'Refund the payments before voiding this invoice.');
                $invoice->status = 'void';
            }
            $invoice->fill(collect($data)->only(['discount', 'tax', 'due_on', 'notes'])->all());
            foreach ($data['add_items'] ?? [] as $item) {
                $invoice->items()->create([
                    'category' => $item['category'] ?? 'other', 'description' => $item['description'],
                    'quantity' => $item['quantity'], 'unit_price' => $item['unit_price'],
                    'amount' => round($item['quantity'] * $item['unit_price'], 2),
                ]);
            }
            if (! empty($data['remove_item_ids'])) {
                $invoice->items()->whereIn('id', $data['remove_item_ids'])->delete();
            }
            $invoice->save();
            $this->hospital->recalculate($invoice);
        });

        ActivityLog::record(! empty($data['void']) ? 'invoice.void' : 'invoice.updated', (! empty($data['void']) ? 'Voided ' : 'Updated ')."invoice {$invoice->number}", ['invoice_id' => $invoice->id]);

        return response()->json($this->full($invoice->fresh()));
    }

    public function pay(Request $request, Invoice $invoice): JsonResponse
    {
        abort_if($invoice->status === 'void', 422, 'This invoice is void.');
        $data = $request->validate([
            'amount' => ['required', 'numeric', 'min:0.01'],
            'method' => ['required', Rule::in(self::METHODS)],
            'reference' => ['nullable', 'string', 'max:120'],
            'paid_at' => ['nullable', 'date'],
        ]);
        abort_if($data['amount'] > $invoice->balance() + 0.009, 422, 'That is more than the balance due ('.number_format($invoice->balance(), 2).').');

        DB::transaction(function () use ($invoice, $data, $request) {
            InvoicePayment::create([
                'invoice_id' => $invoice->id,
                'amount' => $data['amount'],
                'method' => $data['method'],
                'reference' => $data['reference'] ?? null,
                'received_by' => $request->user()->id,
                'paid_at' => $data['paid_at'] ?? now(),
            ]);
            $this->hospital->recalculate($invoice);
        });

        ActivityLog::record('invoice.payment', "Received {$invoice->currency} {$data['amount']} on {$invoice->number} ({$data['method']})", ['invoice_id' => $invoice->id]);

        return response()->json($this->full($invoice->fresh()), 201);
    }

    public function destroyPayment(Invoice $invoice, InvoicePayment $payment): JsonResponse
    {
        abort_unless($payment->invoice_id === $invoice->id, 404);
        DB::transaction(function () use ($invoice, $payment) {
            $payment->delete();
            $this->hospital->recalculate($invoice);
        });
        ActivityLog::record('invoice.refund', "Removed a payment of {$payment->amount} from {$invoice->number}", ['invoice_id' => $invoice->id]);

        return response()->json($this->full($invoice->fresh()));
    }

    public function payments(Request $request): JsonResponse
    {
        $data = $request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date']]);
        $from = Carbon::parse($data['from'] ?? today())->startOfDay();
        $to = Carbon::parse($data['to'] ?? $from)->endOfDay();

        $rows = InvoicePayment::with(['invoice.patient', 'receiver:id,name'])->whereBetween('paid_at', [$from, $to])->latest('paid_at')->get();

        return response()->json(['data' => $rows, 'total' => round((float) $rows->sum('amount'), 2)]);
    }

    /* ------------------------------------------------------------ insurance */

    public function claims(Request $request): JsonResponse
    {
        $status = $request->validate(['status' => ['nullable', Rule::in(['submitted', 'approved', 'rejected', 'paid'])]])['status'] ?? null;

        return response()->json(['data' => InsuranceClaim::with(['patient', 'invoice:id,number,total,paid,currency,status'])
            ->when($status, fn ($q, $s) => $q->where('status', $s))->latest('id')->limit(200)->get()]);
    }

    public function storeClaim(Request $request): JsonResponse
    {
        $data = $request->validate([
            'invoice_id' => ['required', 'integer'],
            'provider' => ['nullable', 'string', 'max:120'],
            'policy_no' => ['nullable', 'string', 'max:60'],
            'claim_no' => ['nullable', 'string', 'max:60'],
            'amount_claimed' => ['nullable', 'numeric', 'min:0.01'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);
        $invoice = Invoice::with('patient')->findOrFail($data['invoice_id']);
        $provider = $data['provider'] ?? $invoice->patient->insurance_provider;
        abort_unless($provider, 422, 'Enter the insurance company.');

        $claim = InsuranceClaim::create([
            'invoice_id' => $invoice->id,
            'patient_id' => $invoice->patient_id,
            'provider' => $provider,
            'policy_no' => $data['policy_no'] ?? $invoice->patient->insurance_number,
            'claim_no' => $data['claim_no'] ?? null,
            'amount_claimed' => $data['amount_claimed'] ?? $invoice->balance(),
            'notes' => $data['notes'] ?? null,
        ]);

        return response()->json($claim->load(['patient', 'invoice:id,number,total,paid,currency,status']), 201);
    }

    /** Approve, reject, or mark paid (which records an insurance payment on the invoice). */
    public function updateClaim(Request $request, InsuranceClaim $claim): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', Rule::in(['submitted', 'approved', 'rejected', 'paid'])],
            'amount_approved' => ['nullable', 'numeric', 'min:0'],
            'claim_no' => ['nullable', 'string', 'max:60'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);
        abort_if($claim->status === 'paid', 422, 'This claim is already paid.');

        DB::transaction(function () use ($claim, $data, $request) {
            $claim->fill(collect($data)->except('status')->filter(fn ($v) => $v !== null)->all());
            $claim->status = $data['status'];
            $claim->save();

            if ($data['status'] === 'paid') {
                $invoice = $claim->invoice;
                $amount = min((float) ($claim->amount_approved ?? $claim->amount_claimed), $invoice->balance());
                if ($amount > 0) {
                    InvoicePayment::create([
                        'invoice_id' => $invoice->id, 'amount' => $amount, 'method' => 'insurance',
                        'reference' => $claim->claim_no ?: "Claim #{$claim->id}", 'received_by' => $request->user()->id, 'paid_at' => now(),
                    ]);
                    $this->hospital->recalculate($invoice);
                }
            }
        });

        return response()->json($claim->load(['patient', 'invoice:id,number,total,paid,currency,status']));
    }

    public function export(Request $request): \Symfony\Component\HttpFoundation\StreamedResponse
    {
        $rows = Invoice::with('patient')->latest('id')->limit(10000)->get()->map(fn (Invoice $i) => [
            $i->number, $i->created_at?->toDateString(), $i->patient?->mrn, $i->patient?->name, $i->status,
            $i->subtotal, $i->discount, $i->tax, $i->total, $i->paid, $i->balance(), $i->currency,
        ]);

        return Csv::download('invoices.csv', ['Invoice', 'Date', 'MRN', 'Patient', 'Status', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Balance', 'Currency'], $rows);
    }

    protected function row(Invoice $i): array
    {
        return $i->only('id', 'number', 'status', 'subtotal', 'discount', 'tax', 'total', 'paid', 'currency', 'due_on', 'created_at', 'admission_id') + [
            'balance' => $i->balance(),
            'patient' => $i->patient?->only('id', 'mrn', 'name', 'phone'),
        ];
    }

    protected function full(Invoice $i): array
    {
        $i->load(['patient', 'items', 'payments.receiver:id,name', 'claims']);

        return $this->row($i) + [
            'notes' => $i->notes,
            'patient' => \App\Http\Controllers\Api\Hospital\PatientController::row($i->patient),
            'items' => $i->items,
            'payments' => $i->payments,
            'claims' => $i->claims,
        ];
    }
}
