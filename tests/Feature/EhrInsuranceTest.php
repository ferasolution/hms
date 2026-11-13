<?php

namespace Tests\Feature;

use App\Models\ChartAccessLog;
use App\Models\Invoice;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Hospital;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class EhrInsuranceTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    /** @var array<string, User> */
    private array $staff = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
        $this->tenant = Tenant::factory()->create(['slug' => 'mercy']);
        app(Hospital::class)->seedDefaults($this->tenant);
        foreach (['admin', 'doctor', 'nurse', 'receptionist', 'accountant', 'pharmacist'] as $role) {
            $this->staff[$role] = User::factory()->role($role)->create(['tenant_id' => $this->tenant->id]);
        }
    }

    private function as(string $role): static
    {
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();

        return $this->withHeaders(['X-Tenant' => 'mercy', 'Authorization' => 'Bearer '.$this->staff[$role]->createToken('t')->plainTextToken]);
    }

    private function patient(): int
    {
        return $this->as('receptionist')->postJson('/api/patients', ['first_name' => 'Grace', 'last_name' => 'Lee', 'date_of_birth' => '1975-02-01'])->json('id');
    }

    public function test_health_record_sections_and_permissions(): void
    {
        $id = $this->patient();

        $this->as('doctor')->postJson("/api/patients/{$id}/ehr/problems", ['name' => 'Type 2 diabetes', 'icd_code' => 'E11', 'status' => 'chronic'])->assertCreated();
        $this->as('nurse')->postJson("/api/patients/{$id}/ehr/allergies", ['allergen' => 'Penicillin', 'severity' => 'severe', 'reaction' => 'Rash'])->assertCreated();
        $med = $this->as('doctor')->postJson("/api/patients/{$id}/ehr/medications", ['name' => 'Metformin', 'dose' => '500 mg', 'frequency' => '1-0-1'])->assertCreated()->json('id');
        $this->as('nurse')->postJson("/api/patients/{$id}/ehr/immunizations", ['vaccine' => 'Influenza', 'given_on' => today()->toDateString()])->assertCreated();
        $this->as('receptionist')->postJson("/api/patients/{$id}/ehr/documents", ['title' => 'Referral letter', 'category' => 'referral', 'file_url' => 'https://example.com/r.pdf'])->assertCreated();
        $this->as('doctor')->putJson("/api/patients/{$id}/history", ['family' => 'Father: diabetes', 'social' => ['smoking' => 'never', 'occupation' => 'Teacher']])->assertOk();

        // Front desk and pharmacy can't change clinical sections.
        $this->as('receptionist')->postJson("/api/patients/{$id}/ehr/problems", ['name' => 'X'])->assertForbidden();
        $this->as('pharmacist')->postJson("/api/patients/{$id}/ehr/allergies", ['allergen' => 'X'])->assertForbidden();
        $this->as('nurse')->deleteJson("/api/ehr/medications/{$med}")->assertForbidden();

        $this->as('doctor')->patchJson("/api/ehr/medications/{$med}", ['status' => 'stopped'])->assertOk()->assertJsonPath('status', 'stopped');

        $this->as('doctor')->getJson("/api/patients/{$id}/ehr")->assertOk()
            ->assertJsonPath('problems.0.icd_code', 'E11')
            ->assertJsonPath('allergies.0.severity', 'severe')
            ->assertJsonPath('history.social.occupation', 'Teacher')
            ->assertJsonCount(1, 'documents')
            ->assertJsonPath('can.clinical', true);

        // Opening the chart shows alerts and is logged (once per 15 minutes per person).
        $this->as('doctor')->getJson("/api/patients/{$id}")->assertOk()
            ->assertJsonPath('alerts.allergies.0.allergen', 'Penicillin')
            ->assertJsonPath('alerts.problems.0.name', 'Type 2 diabetes');
        $this->as('doctor')->getJson("/api/patients/{$id}")->assertOk();
        $this->assertSame(1, ChartAccessLog::withoutGlobalScopes()->where('user_id', $this->staff['doctor']->id)->count());
        $this->as('admin')->getJson("/api/patients/{$id}/access-log")->assertOk()->assertJsonPath('data.0.user.id', $this->staff['doctor']->id);
        $this->as('doctor')->getJson("/api/patients/{$id}/access-log")->assertForbidden();
    }

    public function test_policy_preauth_claim_and_aging(): void
    {
        $id = $this->patient();

        $payer = $this->as('accountant')->postJson('/api/insurance/providers', ['name' => 'Summit Health', 'default_coverage' => 80, 'payment_terms_days' => 30])
            ->assertCreated()->json('id');
        $this->as('receptionist')->postJson('/api/insurance/providers', ['name' => 'Nope'])->assertForbidden();

        $policy = $this->as('receptionist')->postJson("/api/patients/{$id}/policies", [
            'insurance_provider_id' => $payer, 'policy_no' => 'SH-1001', 'copay' => 10,
            'valid_from' => today()->subYear()->toDateString(), 'valid_to' => today()->addYear()->toDateString(),
        ])->assertCreated()->assertJsonPath('coverage_percent', '80.00')->json('id');

        $this->as('doctor')->getJson("/api/patients/{$id}")->assertJsonPath('policy.provider.name', 'Summit Health')->assertJsonPath('patient.insurance_number', 'SH-1001');

        // Pre-authorization: approval needs the insurer's number.
        $pa = $this->as('receptionist')->postJson('/api/pre-authorizations', [
            'patient_id' => $id, 'patient_policy_id' => $policy, 'service' => 'Appendectomy', 'estimated_amount' => 2000,
        ])->assertCreated()->assertJsonPath('status', 'requested')->json('id');
        $this->as('accountant')->patchJson("/api/pre-authorizations/{$pa}", ['status' => 'approved'])->assertUnprocessable()->assertJsonValidationErrors('auth_no');
        $this->as('accountant')->patchJson("/api/pre-authorizations/{$pa}", ['status' => 'approved', 'auth_no' => 'PA-77'])->assertOk()->assertJsonPath('approved_amount', '2000.00');

        // A 200 bill: insurer pays 80% minus the 10 co-pay = 150.
        $invoice = $this->as('accountant')->postJson('/api/invoices', ['patient_id' => $id, 'items' => [['description' => 'Procedure', 'quantity' => 1, 'unit_price' => 200]]])
            ->assertCreated()->json('id');
        $this->as('receptionist')->getJson("/api/invoices/{$invoice}/coverage")->assertOk()->assertJsonPath('estimate.insurer', 150)->assertJsonPath('estimate.patient', 50);

        $claim = $this->as('accountant')->postJson('/api/claims', ['invoice_id' => $invoice, 'pre_authorization_id' => $pa])
            ->assertCreated()->assertJsonPath('amount_claimed', '150.00')->assertJsonPath('provider', 'Summit Health')->assertJsonPath('policy_no', 'SH-1001')->json('id');
        $this->as('accountant')->postJson('/api/claims', ['invoice_id' => $invoice])->assertUnprocessable();

        $this->travel(40)->days();
        $this->as('accountant')->getJson('/api/insurance/aging')->assertOk()
            ->assertJsonPath('rows.0.provider', 'Summit Health')
            ->assertJsonPath('rows.0.31_60', 150);

        $this->as('accountant')->patchJson("/api/claims/{$claim}", ['status' => 'rejected'])->assertUnprocessable()->assertJsonValidationErrors('rejection_reason');
        $this->as('accountant')->patchJson("/api/claims/{$claim}", ['status' => 'approved', 'amount_approved' => 140, 'claim_no' => 'CL-9'])->assertOk();
        $this->as('accountant')->patchJson("/api/claims/{$claim}", ['status' => 'paid'])->assertOk()->assertJsonPath('status', 'paid');

        $bill = Invoice::withoutGlobalScopes()->find($invoice);
        $this->assertSame('140.00', $bill->paid);
        $this->assertSame('partial', $bill->status);

        $this->as('admin')->putJson('/api/modules', ['modules' => ['insurance' => false]])->assertOk();
        $this->as('accountant')->getJson('/api/claims')->assertForbidden();
    }
}
