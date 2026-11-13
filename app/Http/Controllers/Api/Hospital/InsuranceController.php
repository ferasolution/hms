<?php

namespace App\Http\Controllers\Api\Hospital;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\InsuranceClaim;
use App\Models\InsuranceProvider;
use App\Models\Invoice;
use App\Models\InvoicePayment;
use App\Models\Patient;
use App\Models\PatientPolicy;
use App\Models\PreAuthorization;
use App\Models\User;
use App\Services\Hospital;
use App\Support\Csv;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Insurance companies (payers), patient policies, pre-authorizations,
 * claims and the claims aging report.
 */
class InsuranceController extends Controller
{
    public function __construct(protected Hospital $hospital) {}

    /* ------------------------------------------------------------ insurance companies */

    public function providers(Request $request): JsonResponse
    {
        $rows = InsuranceProvider::query()
            ->when(! $request->boolean('all'), fn ($q) => $q->where('is_active', true))
            ->withCount(['policies as active_policies' => fn ($q) => $q->where('status', 'active')])
            ->orderBy('name')->get();

        $open = InsuranceClaim::whereIn('status', ['submitted', 'approved'])->selectRaw('insurance_provider_id, count(*) as n, sum(amount_claimed) as amount')
            ->groupBy('insurance_provider_id')->get()->keyBy('insurance_provider_id');

        return response()->json(['data' => $rows->map(fn ($p) => $p->toArray() + [
            'open_claims' => (int) ($open[$p->id]->n ?? 0),
            'open_amount' => round((float) ($open[$p->id]->amount ?? 0), 2),
        ])]);
    }

    public function storeProvider(Request $request): JsonResponse
    {
        return response()->json(InsuranceProvider::create($request->validate($this->providerRules($request))), 201);
    }

    public function updateProvider(Request $request, InsuranceProvider $provider): JsonResponse
    {
        $provider->update($request->validate($this->providerRules($request, $provider)));

        return response()->json($provider);
    }

    /* ------------------------------------------------------------ patient policies */

    public function policies(Patient $patient): JsonResponse
    {
        $policies = PatientPolicy::with('provider:id,name,phone')->where('patient_id', $patient->id)->orderByDesc('is_primary')->latest('id')->get();

        return response()->json([
            'data' => $policies->map(fn ($p) => $p->toArray() + ['valid' => $p->isValid()]),
            'pre_authorizations' => PreAuthorization::with(['policy.provider:id,name', 'requester:id,name'])->where('patient_id', $patient->id)->latest('id')->get(),
            'claims' => InsuranceClaim::with('invoice:id,number,total,paid,currency,status')->where('patient_id', $patient->id)->latest('id')->get(),
        ]);
    }

    public function storePolicy(Request $request, Patient $patient): JsonResponse
    {
        $data = array_filter($request->validate($this->policyRules($request)), fn ($v) => $v !== null);
        $provider = InsuranceProvider::findOrFail($data['insurance_provider_id']);

        $policy = DB::transaction(function () use ($data, $patient, $provider) {
            if ($data['is_primary'] ?? true) {
                PatientPolicy::where('patient_id', $patient->id)->update(['is_primary' => false]);
            }
            $policy = new PatientPolicy($data + ['coverage_percent' => $provider->default_coverage]);
            $policy->patient_id = $patient->id;
            $policy->save();

            // Keep the quick fields on the patient in step with the primary policy.
            if ($policy->is_primary) {
                $patient->update(['insurance_provider' => $provider->name, 'insurance_number' => $policy->policy_no]);
            }

            return $policy;
        });

        ActivityLog::record('insurance.policy', "Added {$provider->name} policy {$policy->policy_no} for {$patient->name}", ['patient_id' => $patient->id]);

        return response()->json($policy->load('provider:id,name,phone'), 201);
    }

    public function updatePolicy(Request $request, PatientPolicy $policy): JsonResponse
    {
        $rules = collect($this->policyRules($request))->map(fn ($r) => array_map(fn ($x) => $x === 'required' ? 'sometimes' : $x, $r))->all();
        $rules['status'] = ['sometimes', Rule::in(['active', 'expired', 'cancelled'])];
        $data = $request->validate($rules);
        foreach (['coverage_percent', 'copay', 'relation'] as $k) {
            if (array_key_exists($k, $data) && $data[$k] === null) {
                unset($data[$k]);
            }
        }

        DB::transaction(function () use ($policy, $data) {
            if (! empty($data['is_primary'])) {
                PatientPolicy::where('patient_id', $policy->patient_id)->where('id', '!=', $policy->id)->update(['is_primary' => false]);
            }
            $policy->update($data);
        });

        return response()->json($policy->load('provider:id,name,phone'));
    }

    /* ------------------------------------------------------------ pre-authorization */

    public function preAuthorizations(Request $request): JsonResponse
    {
        $status = $request->validate(['status' => ['nullable', Rule::in(['requested', 'approved', 'partial', 'denied', 'expired'])]])['status'] ?? null;

        return response()->json(['data' => PreAuthorization::with(['patient', 'policy.provider:id,name', 'requester:id,name'])
            ->when($status, fn ($q, $s) => $q->where('status', $s))->latest('id')->limit(300)->get()]);
    }

    public function storePreAuthorization(Request $request): JsonResponse
    {
        $data = $request->validate([
            'patient_id' => ['required', 'integer'],
            'patient_policy_id' => ['required', 'integer'],
            'admission_id' => ['nullable', 'integer'],
            'service' => ['required', 'string', 'max:255'],
            'diagnosis' => ['nullable', 'string', 'max:255'],
            'icd_code' => ['nullable', 'string', 'max:20'],
            'estimated_amount' => ['required', 'numeric', 'min:0.01'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);
        $patient = Patient::findOrFail($data['patient_id']);
        $policy = PatientPolicy::where('patient_id', $patient->id)->findOrFail($data['patient_policy_id']);
        if (! $policy->isValid()) {
            throw ValidationException::withMessages(['patient_policy_id' => 'This policy is not active today.']);
        }

        $pa = new PreAuthorization($data);
        $pa->requested_by = $request->user()->id;
        $pa->save();

        ActivityLog::record('insurance.preauth', "Requested pre-authorization for {$patient->name}: {$pa->service}", ['pre_authorization_id' => $pa->id]);

        return response()->json($pa->load(['patient', 'policy.provider:id,name', 'requester:id,name']), 201);
    }

    public function updatePreAuthorization(Request $request, PreAuthorization $preAuthorization): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', Rule::in(['requested', 'approved', 'partial', 'denied', 'expired'])],
            'approved_amount' => ['nullable', 'numeric', 'min:0'],
            'auth_no' => ['nullable', 'string', 'max:60'],
            'valid_until' => ['nullable', 'date'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);
        if (in_array($data['status'], ['approved', 'partial'], true) && empty($data['auth_no']) && ! $preAuthorization->auth_no) {
            throw ValidationException::withMessages(['auth_no' => 'Enter the authorization number from the insurer.']);
        }
        if ($data['status'] === 'approved' && ! isset($data['approved_amount'])) {
            $data['approved_amount'] = $preAuthorization->estimated_amount;
        }

        $preAuthorization->fill($data);
        if ($data['status'] !== 'requested') {
            $preAuthorization->decided_at ??= now();
        }
        $preAuthorization->save();

        return response()->json($preAuthorization->load(['patient', 'policy.provider:id,name', 'requester:id,name']));
    }

    /* ------------------------------------------------------------ claims */

    /** What the insurer and the patient owe on a bill under the patient's active policy. */
    public function coverage(Invoice $invoice): JsonResponse
    {
        $policy = $invoice->patient?->activePolicy();

        return response()->json(['policy' => $policy?->load('provider:id,name'), 'estimate' => $this->estimate($invoice, $policy)]);
    }

    public function claims(Request $request): JsonResponse
    {
        $data = $request->validate([
            'status' => ['nullable', Rule::in(['submitted', 'approved', 'rejected', 'paid'])],
            'insurance_provider_id' => ['nullable', 'integer'],
            'search' => ['nullable', 'string', 'max:100'],
        ]);

        $rows = InsuranceClaim::with(['patient', 'insurer:id,name', 'invoice:id,number,total,paid,currency,status'])
            ->when($data['status'] ?? null, fn ($q, $s) => $q->where('status', $s))
            ->when($data['insurance_provider_id'] ?? null, fn ($q, $p) => $q->where('insurance_provider_id', $p))
            ->when($data['search'] ?? null, fn ($q, $s) => $q->where(fn ($q) => $q->where('claim_no', 'like', "%{$s}%")->orWhere('policy_no', 'like', "%{$s}%")
                ->orWhereIn('patient_id', Patient::where('first_name', 'like', "%{$s}%")->orWhere('last_name', 'like', "%{$s}%")->orWhere('mrn', 'like', "%{$s}%")->select('id'))))
            ->latest('id')->limit(300)->get();

        return response()->json(['data' => $rows->map(fn ($c) => $this->claimRow($c))]);
    }

    public function storeClaim(Request $request): JsonResponse
    {
        $data = $request->validate([
            'invoice_id' => ['required', 'integer'],
            'insurance_provider_id' => ['nullable', 'integer'],
            'patient_policy_id' => ['nullable', 'integer'],
            'pre_authorization_id' => ['nullable', 'integer'],
            'provider' => ['nullable', 'string', 'max:120'],
            'policy_no' => ['nullable', 'string', 'max:60'],
            'claim_no' => ['nullable', 'string', 'max:60'],
            'amount_claimed' => ['nullable', 'numeric', 'min:0.01'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);
        $invoice = Invoice::with('patient')->findOrFail($data['invoice_id']);
        abort_if($invoice->status === 'void', 422, 'This bill is void.');
        abort_if(InsuranceClaim::where('invoice_id', $invoice->id)->whereIn('status', ['submitted', 'approved'])->exists(), 422, 'This bill already has an open claim.');

        $policy = ! empty($data['patient_policy_id'])
            ? PatientPolicy::where('patient_id', $invoice->patient_id)->findOrFail($data['patient_policy_id'])
            : $invoice->patient->activePolicy();

        $provider = match (true) {
            ! empty($data['insurance_provider_id']) => InsuranceProvider::findOrFail($data['insurance_provider_id']),
            $policy !== null => $policy->provider,
            ! empty($data['provider']) => InsuranceProvider::firstOrCreate(['name' => trim($data['provider'])]),
            ! empty($invoice->patient->insurance_provider) => InsuranceProvider::firstOrCreate(['name' => trim($invoice->patient->insurance_provider)]),
            default => null,
        };
        if (! $provider) {
            throw ValidationException::withMessages(['insurance_provider_id' => 'Add the patient’s insurance policy, or choose the insurance company.']);
        }

        $amount = $data['amount_claimed'] ?? $this->estimate($invoice, $policy)['insurer'];
        abort_if($amount <= 0, 422, 'Nothing to claim on this bill.');

        $claim = InsuranceClaim::create([
            'invoice_id' => $invoice->id,
            'patient_id' => $invoice->patient_id,
            'insurance_provider_id' => $provider->id,
            'patient_policy_id' => $policy?->id,
            'pre_authorization_id' => $data['pre_authorization_id'] ?? null,
            'provider' => $provider->name,
            'policy_no' => $data['policy_no'] ?? $policy?->policy_no ?? $invoice->patient->insurance_number,
            'claim_no' => $data['claim_no'] ?? null,
            'amount_claimed' => round($amount, 2),
            'notes' => $data['notes'] ?? null,
            'submitted_at' => now(),
        ]);

        ActivityLog::record('insurance.claim', "Claimed {$invoice->currency} {$claim->amount_claimed} from {$provider->name} for {$invoice->number}", ['claim_id' => $claim->id]);

        return response()->json($this->claimRow($claim->load(['patient', 'insurer:id,name', 'invoice:id,number,total,paid,currency,status'])), 201);
    }

    /** submitted → approved / rejected → paid (records the insurer's payment on the bill). */
    public function updateClaim(Request $request, InsuranceClaim $claim): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', Rule::in(['submitted', 'approved', 'rejected', 'paid'])],
            'amount_approved' => ['nullable', 'numeric', 'min:0'],
            'claim_no' => ['nullable', 'string', 'max:60'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'rejection_reason' => ['nullable', 'string', 'max:500'],
            'reference' => ['nullable', 'string', 'max:120'],
        ]);
        abort_if($claim->status === 'paid', 422, 'This claim is already paid.');
        if ($data['status'] === 'rejected' && empty($data['rejection_reason'])) {
            throw ValidationException::withMessages(['rejection_reason' => 'Enter the reason the insurer gave.']);
        }

        DB::transaction(function () use ($claim, $data, $request) {
            $claim->fill(collect($data)->only(['amount_approved', 'claim_no', 'notes', 'rejection_reason'])->filter(fn ($v) => $v !== null)->all());
            $claim->status = $data['status'];
            if (in_array($data['status'], ['approved', 'rejected'], true)) {
                $claim->decided_at = now();
            }
            if ($data['status'] === 'rejected') {
                $claim->amount_approved = 0;
            }

            if ($data['status'] === 'paid') {
                $claim->decided_at ??= now();
                $claim->paid_at = now();
                $invoice = $claim->invoice;
                $amount = min((float) ($claim->amount_approved ?? $claim->amount_claimed), $invoice->balance());
                $claim->amount_approved ??= $amount;
                if ($amount > 0) {
                    InvoicePayment::create([
                        'invoice_id' => $invoice->id, 'amount' => $amount, 'method' => 'insurance',
                        'reference' => $data['reference'] ?? ($claim->claim_no ?: "Claim #{$claim->id}"), 'received_by' => $request->user()->id, 'paid_at' => now(),
                    ]);
                    $this->hospital->recalculate($invoice);
                }
            }
            $claim->save();
        });

        ActivityLog::record("insurance.claim.{$data['status']}", "Claim #{$claim->id} ({$claim->provider}) marked {$data['status']}", ['claim_id' => $claim->id]);

        return response()->json($this->claimRow($claim->load(['patient', 'insurer:id,name', 'invoice:id,number,total,paid,currency,status'])));
    }

    /** Open claims by insurer and how long they have been waiting. */
    public function aging(): JsonResponse
    {
        $open = InsuranceClaim::with('insurer:id,name')->whereIn('status', ['submitted', 'approved'])->get();
        $buckets = ['0_30' => [0, 30], '31_60' => [31, 60], '61_90' => [61, 90], '90_plus' => [91, PHP_INT_MAX]];

        $rows = $open->groupBy(fn ($c) => $c->insurance_provider_id ?? 0)->map(function ($claims) use ($buckets) {
            $row = ['provider' => $claims->first()->insurer?->name ?? $claims->first()->provider, 'count' => $claims->count(), 'total' => 0.0];
            foreach ($buckets as $key => [$min, $max]) {
                $row[$key] = round((float) $claims->filter(function ($c) use ($min, $max) {
                    $days = (int) ($c->submitted_at ?? $c->created_at)->diffInDays(now(), true);

                    return $days >= $min && $days <= $max;
                })->sum(fn ($c) => (float) ($c->amount_approved ?? $c->amount_claimed)), 2);
                $row['total'] += $row[$key];
            }
            $row['total'] = round($row['total'], 2);

            return $row;
        })->sortByDesc('total')->values();

        $all = InsuranceClaim::query();

        return response()->json([
            'rows' => $rows,
            'totals' => [
                'open' => round((float) $rows->sum('total'), 2),
                'claimed' => round((float) (clone $all)->sum('amount_claimed'), 2),
                'paid' => round((float) InsuranceClaim::where('status', 'paid')->sum('amount_approved'), 2),
                'rejected' => InsuranceClaim::where('status', 'rejected')->count(),
                'approval_rate' => ($decided = InsuranceClaim::whereIn('status', ['approved', 'paid', 'rejected'])->count())
                    ? round(InsuranceClaim::whereIn('status', ['approved', 'paid'])->count() / $decided * 100, 1) : null,
            ],
            'currency' => $this->hospital->currency(),
        ]);
    }

    public function exportClaims(): \Symfony\Component\HttpFoundation\StreamedResponse
    {
        $rows = InsuranceClaim::with(['patient', 'invoice:id,number,currency'])->latest('id')->get()->map(fn ($c) => [
            $c->id, $c->claim_no, $c->provider, $c->policy_no, $c->patient?->mrn, $c->patient?->name, $c->invoice?->number,
            $c->amount_claimed, $c->amount_approved, $c->status, optional($c->submitted_at)->toDateString(), optional($c->paid_at)->toDateString(), $c->rejection_reason,
        ]);

        return Csv::download('insurance-claims.csv', ['#', 'Claim no.', 'Insurer', 'Policy', 'MRN', 'Patient', 'Bill', 'Claimed', 'Approved', 'Status', 'Submitted', 'Paid', 'Rejection reason'], $rows);
    }

    /* ------------------------------------------------------------ helpers */

    /** @return array{covered: float, insurer: float, patient: float, coverage_percent: float, copay: float} */
    protected function estimate(Invoice $invoice, ?PatientPolicy $policy): array
    {
        $total = (float) $invoice->total;
        if (! $policy) {
            return ['covered' => 0.0, 'insurer' => round($invoice->balance(), 2), 'patient' => 0.0, 'coverage_percent' => 100.0, 'copay' => 0.0];
        }
        $pct = (float) $policy->coverage_percent;
        $copay = (float) $policy->copay;
        $insurer = max(0, round($total * $pct / 100 - $copay, 2));
        $insurer = min($insurer, max(0, $invoice->balance()));
        if ($policy->annual_limit !== null) {
            $used = (float) InsuranceClaim::where('patient_policy_id', $policy->id)->whereIn('status', ['submitted', 'approved', 'paid'])
                ->whereYear('created_at', now()->year)->sum('amount_claimed');
            $insurer = min($insurer, max(0, (float) $policy->annual_limit - $used));
        }

        return ['covered' => $insurer, 'insurer' => $insurer, 'patient' => round($total - $insurer, 2), 'coverage_percent' => $pct, 'copay' => $copay];
    }

    protected function claimRow(InsuranceClaim $c): array
    {
        $since = $c->submitted_at ?? $c->created_at;

        return $c->toArray() + [
            'age_days' => in_array($c->status, ['submitted', 'approved'], true) && $since ? (int) $since->diffInDays(now(), true) : null,
        ];
    }

    protected function providerRules(Request $request, ?InsuranceProvider $provider = null): array
    {
        return [
            'name' => [$provider ? 'sometimes' : 'required', 'string', 'max:160',
                Rule::unique('insurance_providers', 'name')->where('tenant_id', $request->user()->tenant_id)->ignore($provider?->id)],
            'code' => ['nullable', 'string', 'max:30'],
            'type' => ['nullable', Rule::in(['private', 'government', 'corporate', 'tpa'])],
            'contact_person' => ['nullable', 'string', 'max:120'],
            'phone' => ['nullable', 'string', 'max:30'],
            'email' => ['nullable', 'email', 'max:255'],
            'address' => ['nullable', 'string', 'max:300'],
            'default_coverage' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'payment_terms_days' => ['nullable', 'integer', 'min:0', 'max:365'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    protected function policyRules(Request $request): array
    {
        return [
            'insurance_provider_id' => ['required', 'integer', Rule::exists('insurance_providers', 'id')->where('tenant_id', $request->user()->tenant_id)],
            'policy_no' => ['required', 'string', 'max:60'],
            'member_id' => ['nullable', 'string', 'max:60'],
            'group_no' => ['nullable', 'string', 'max:60'],
            'plan_name' => ['nullable', 'string', 'max:120'],
            'holder_name' => ['nullable', 'string', 'max:120'],
            'relation' => ['nullable', Rule::in(['self', 'spouse', 'child', 'parent', 'other'])],
            'coverage_percent' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'copay' => ['nullable', 'numeric', 'min:0'],
            'annual_limit' => ['nullable', 'numeric', 'min:0'],
            'valid_from' => ['nullable', 'date'],
            'valid_to' => ['nullable', 'date', 'after_or_equal:valid_from'],
            'is_primary' => ['sometimes', 'boolean'],
            'card_url' => ['nullable', 'url:http,https', 'max:500'],
        ];
    }
}
