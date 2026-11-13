<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Invoice;
use App\Models\InvoicePayment;
use App\Models\Patient;
use App\Models\Plan;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PlatformConsoleTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private Tenant $tenant;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
        $this->owner = User::factory()->superAdmin()->create(['email' => 'owner@example.com']);
        $this->tenant = Tenant::factory()->create(['slug' => 'acme', 'name' => 'Acme General', 'trial_ends_at' => now()->addDays(10)]);
        $this->admin = User::factory()->role('admin')->create(['tenant_id' => $this->tenant->id]);
    }

    private function asOwner(): static
    {
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();

        return $this->withToken($this->owner->createToken('p')->plainTextToken);
    }

    private function asAdmin(?User $user = null): static
    {
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();

        return $this->withHeaders(['X-Tenant' => 'acme', 'Authorization' => 'Bearer '.($user ?? $this->admin)->createToken('t')->plainTextToken]);
    }

    public function test_owner_sees_everything_and_tenants_see_nothing(): void
    {
        User::factory()->count(3)->role('doctor')->create(['tenant_id' => $this->tenant->id]);
        $other = Tenant::factory()->create(['slug' => 'other']);
        User::factory()->count(2)->create(['tenant_id' => $other->id]);

        $this->asOwner()->getJson('/api/platform/overview')->assertOk()
            ->assertJsonPath('tenants.total', 2)
            ->assertJsonPath('people.doctors', 3)
            ->assertJsonCount(30, 'signups');

        $this->asOwner()->getJson('/api/platform/users?search=')->assertOk()->assertJsonPath('meta.total', 6);
        $this->asOwner()->getJson("/api/platform/users?tenant_id={$other->id}")->assertJsonPath('meta.total', 2);
        $this->asOwner()->getJson("/api/platform/tenants/{$this->tenant->id}")->assertOk()
            ->assertJsonPath('tenant.name', 'Acme General')
            ->assertJsonPath('effective.source', 'trial')
            ->assertJsonPath('usage.staff', 4)
            ->assertJsonPath('admins.0.id', $this->admin->id);
        $this->asOwner()->getJson('/api/platform/health')->assertOk()->assertJsonPath('checks.database.ok', true);

        foreach (['overview', 'tenants', 'users', 'payments', 'subscriptions', 'activity', 'health', 'settings'] as $path) {
            $this->asAdmin()->getJson("/api/platform/{$path}")->assertForbidden();
        }
    }

    public function test_trial_gets_top_plan_then_falls_back_to_free_limits(): void
    {
        // During the trial: Enterprise, unlimited.
        $this->asAdmin()->getJson('/api/billing')->assertOk()
            ->assertJsonPath('current.source', 'trial')
            ->assertJsonPath('current.plan.slug', 'enterprise');

        // After the trial: Free plan, 10 beds max.
        $this->tenant->update(['trial_ends_at' => now()->subDay()]);
        $this->asAdmin()->getJson('/api/billing')->assertJsonPath('current.source', 'free')->assertJsonPath('current.plan.slug', 'free');

        $this->asAdmin()->postJson('/api/wards', ['name' => 'General', 'type' => 'general', 'beds' => 8])->assertCreated();
        $this->asAdmin()->postJson('/api/wards', ['name' => 'ICU', 'type' => 'icu', 'beds' => 3])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('beds');

        // Nothing already there is locked.
        $this->asAdmin()->getJson('/api/ipd/board')->assertOk()->assertJsonPath('summary.beds', 8);
    }

    public function test_staff_limit_on_free_plan(): void
    {
        $this->tenant->update(['trial_ends_at' => now()->subDay()]);
        User::factory()->count(4)->role('nurse')->create(['tenant_id' => $this->tenant->id]);

        $this->asAdmin()->postJson('/api/users', ['name' => 'X', 'email' => 'x@example.com', 'role' => 'doctor', 'password' => 'password1'])
            ->assertUnprocessable()->assertJsonValidationErrors('role');

        // Patient portal accounts are not limited.
        $this->asAdmin()->postJson('/api/users', ['name' => 'P', 'email' => 'p@example.com', 'role' => 'patient', 'password' => 'password1'])
            ->assertCreated();
    }

    public function test_subscription_payment_approval_upgrades_the_plan(): void
    {
        $this->tenant->update(['trial_ends_at' => now()->subDay()]);
        $basic = Plan::where('slug', 'clinic')->first();

        $this->asOwner()->putJson('/api/platform/settings', ['payments' => ['wise' => 'billing@ferasolution.com']])->assertOk();
        $this->asAdmin()->getJson('/api/billing')->assertJsonPath('pay_to.wise', 'billing@ferasolution.com');

        $this->asAdmin()->postJson('/api/billing/subscribe', [
            'plan_id' => $basic->id, 'months' => 3, 'payment_method' => 'wise', 'payment_reference' => 'TX-99',
        ])->assertCreated();

        // Only one pending at a time.
        $this->asAdmin()->postJson('/api/billing/subscribe', [
            'plan_id' => $basic->id, 'months' => 1, 'payment_method' => 'bank', 'payment_reference' => 'TX-100',
        ])->assertUnprocessable();

        $subs = $this->asOwner()->getJson('/api/platform/subscriptions?status=pending')->assertOk()
            ->assertJsonPath('summary.pending', 1)
            ->assertJsonPath('data.0.tenant.name', 'Acme General')
            ->assertJsonPath('data.0.amount', '297.00');

        $this->asOwner()->postJson('/api/platform/subscriptions/'.$subs->json('data.0.id').'/approve')->assertOk()->assertJsonPath('status', 'active');

        $this->tenant->refresh();
        $this->assertSame('active', $this->tenant->status);
        $this->assertSame($basic->id, $this->tenant->plan_id);
        $this->assertTrue($this->tenant->plan_ends_at->between(now()->addMonths(3)->subDay(), now()->addMonths(3)->addDay()));

        $this->asAdmin()->getJson('/api/billing')->assertJsonPath('current.source', 'paid')->assertJsonPath('current.plan.slug', 'clinic');
        $this->asOwner()->getJson('/api/platform/overview')->assertJsonPath('revenue.subscriptions_total', 297)->assertJsonPath('tenants.paying', 1);
    }

    public function test_owner_changes_plan_and_suspends(): void
    {
        $pro = Plan::where('slug', 'hospital')->first();

        $this->asOwner()->patchJson("/api/platform/tenants/{$this->tenant->id}", [
            'plan_id' => $pro->id, 'plan_ends_at' => now()->addYear()->toDateString(), 'status' => 'active',
        ])->assertOk()->assertJsonPath('effective.source', 'paid');

        $this->asOwner()->patchJson("/api/platform/tenants/{$this->tenant->id}", ['status' => 'suspended'])->assertOk();
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $this->withHeaders(['X-Tenant' => 'acme'])->postJson('/api/auth/login', ['email' => $this->admin->email, 'password' => 'password'])->assertForbidden();

        $this->assertTrue(ActivityLog::where('action', 'tenant.updated')->exists());
    }

    public function test_support_sign_in_is_short_lived_and_logged(): void
    {
        $res = $this->asOwner()->postJson("/api/platform/tenants/{$this->tenant->id}/impersonate")->assertOk()
            ->assertJsonPath('slug', 'acme')
            ->assertJsonPath('admin.id', $this->admin->id);

        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $this->withHeaders(['X-Tenant' => 'acme', 'Authorization' => 'Bearer '.$res->json('token')])
            ->getJson('/api/auth/me')->assertOk()->assertJsonPath('user.id', $this->admin->id);

        $this->assertTrue(ActivityLog::where('action', 'support.impersonate')->where('tenant_id', $this->tenant->id)->exists());

        $this->travel(3)->hours();
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $this->withHeaders(['X-Tenant' => 'acme', 'Authorization' => 'Bearer '.$res->json('token')])
            ->getJson('/api/auth/me')->assertUnauthorized();
    }

    public function test_owner_sees_patient_payments_from_every_hospital(): void
    {
        $patient = new Patient(['first_name' => 'Emily', 'last_name' => 'Carter', 'mrn' => 'MRN-000001']);
        $patient->tenant_id = $this->tenant->id;
        $patient->save();
        $invoice = new Invoice(['patient_id' => $patient->id, 'number' => 'INV-1', 'total' => 120, 'paid' => 120, 'status' => 'paid', 'currency' => 'USD']);
        $invoice->tenant_id = $this->tenant->id;
        $invoice->save();
        $payment = new InvoicePayment(['invoice_id' => $invoice->id, 'amount' => 120, 'method' => 'card', 'reference' => 'REF-1', 'paid_at' => now()]);
        $payment->tenant_id = $this->tenant->id;
        $payment->save();

        $this->asOwner()->getJson('/api/platform/payments')->assertOk()
            ->assertJsonPath('data.0.tenant.slug', 'acme')
            ->assertJsonPath('data.0.reference', 'REF-1')
            ->assertJsonPath('data.0.patient.name', 'Emily Carter')
            ->assertJsonPath('summary.volume.0.amount', 120.0);
    }

    public function test_activity_records_logins_and_signups(): void
    {
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $this->withHeaders(['X-Tenant' => 'acme'])->postJson('/api/auth/login', ['email' => $this->admin->email, 'password' => 'password'])->assertOk();
        $this->assertNotNull($this->admin->fresh()->last_login_at);

        $this->postJson('/api/register-hospital', [
            'hospital_name' => 'New Clinic', 'slug' => 'new-clinic', 'type' => 'clinic',
            'name' => 'Head', 'email' => 'head@example.com', 'password' => 'password1', 'password_confirmation' => 'password1',
        ])->assertCreated();

        $this->asOwner()->getJson('/api/platform/activity')->assertOk()
            ->assertJsonPath('data.0.action', 'tenant.registered')
            ->assertJsonPath('data.1.action', 'auth.login');
    }

    public function test_owner_resets_a_password_and_signs_the_user_out(): void
    {
        $student = User::factory()->create(['tenant_id' => $this->tenant->id, 'email' => 'jacob@example.com']);
        $oldToken = $student->createToken('phone')->plainTextToken;

        $res = $this->asOwner()->postJson("/api/platform/users/{$student->id}/reset-password")->assertOk();
        $temp = $res->json('password');
        $this->assertMatchesRegularExpression('/^[A-Z][a-z]+-[A-Z][a-z]+-\d{4}$/', $temp);
        $this->assertStringEndsWith('/acme/login', $res->json('sign_in_url'));

        // Old sessions are gone; the new password works.
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $this->withHeaders(['X-Tenant' => 'acme', 'Authorization' => "Bearer {$oldToken}"])->getJson('/api/auth/me')->assertUnauthorized();
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $this->withHeaders(['X-Tenant' => 'acme'])->postJson('/api/auth/login', ['email' => 'jacob@example.com', 'password' => $temp])->assertOk();

        // A chosen password is accepted too.
        $this->asOwner()->postJson("/api/platform/users/{$student->id}/reset-password", ['password' => 'chosen-pass-1'])->assertJsonPath('password', 'chosen-pass-1');

        $this->assertTrue(ActivityLog::where('action', 'support.password_reset')->exists());

        // Institute admins cannot use the owner endpoint, and the owner account is not resettable here.
        $this->asAdmin()->postJson("/api/platform/users/{$student->id}/reset-password")->assertForbidden();
        $this->asOwner()->postJson("/api/platform/users/{$this->owner->id}/reset-password")->assertUnprocessable();
    }

    public function test_owner_can_disable_and_restore_a_user(): void
    {
        $student = User::factory()->create(['tenant_id' => $this->tenant->id, 'email' => 'olivia@example.com']);

        $this->asOwner()->patchJson("/api/platform/users/{$student->id}", ['is_active' => false])->assertOk()->assertJsonPath('is_active', false);
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $this->withHeaders(['X-Tenant' => 'acme'])->postJson('/api/auth/login', ['email' => 'olivia@example.com', 'password' => 'password'])->assertUnprocessable();

        $this->asOwner()->patchJson("/api/platform/users/{$student->id}", ['is_active' => true])->assertOk();
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $this->withHeaders(['X-Tenant' => 'acme'])->postJson('/api/auth/login', ['email' => 'olivia@example.com', 'password' => 'password'])->assertOk();
    }

    public function test_old_local_payment_methods_are_no_longer_accepted(): void
    {
        $basic = Plan::where('slug', 'clinic')->first();
        $this->asAdmin()->postJson('/api/billing/subscribe', [
            'plan_id' => $basic->id, 'months' => 1, 'payment_method' => 'jazzcash', 'payment_reference' => 'X',
        ])->assertUnprocessable()->assertJsonValidationErrors('payment_method');
    }
}
