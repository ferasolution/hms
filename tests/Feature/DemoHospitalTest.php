<?php

namespace Tests\Feature;

use App\Models\Admission;
use App\Models\ErVisit;
use App\Models\Patient;
use App\Models\Tenant;
use App\Models\User;
use App\Services\DemoHospital;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DemoHospitalTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
        $this->artisan('hms:demo')->assertSuccessful();
    }

    private function demoLogin(string $role): string
    {
        $this->flushHeaders();

        return $this->withHeaders(['X-Tenant' => 'demo'])->postJson('/api/demo/login', ['role' => $role])
            ->assertOk()->assertJsonPath('user.role', $role)->json('token');
    }

    private function as(string $role): static
    {
        $token = $this->demoLogin($role);
        $this->app['auth']->forgetGuards();

        return $this->withHeaders(['X-Tenant' => 'demo', 'Authorization' => "Bearer {$token}"]);
    }

    public function test_demo_hospital_is_built_with_data_and_can_be_rebuilt(): void
    {
        $tenant = Tenant::where('slug', 'demo')->firstOrFail();
        $this->assertTrue(DemoHospital::isDemo($tenant));
        $this->assertGreaterThan(30, Patient::withoutGlobalScopes()->where('tenant_id', $tenant->id)->count());
        $this->assertGreaterThan(5, Admission::withoutGlobalScopes()->where('tenant_id', $tenant->id)->where('status', 'admitted')->count());
        $this->assertGreaterThan(3, ErVisit::withoutGlobalScopes()->where('tenant_id', $tenant->id)->where('status', '!=', 'disposed')->count());

        $this->getJson('/api/demo')->assertOk()->assertJsonPath('available', true)->assertJsonCount(10, 'accounts');

        // Rebuilding replaces everything rather than adding to it.
        $this->artisan('hms:demo')->assertSuccessful();
        $this->assertSame(1, Tenant::where('slug', 'demo')->count());
        $tenant = Tenant::where('slug', 'demo')->first();
        $this->assertSame(1, User::withoutGlobalScopes()->where('tenant_id', $tenant->id)->where('email', DemoHospital::email('admin'))->count());

        // Normal password sign-in works too.
        $this->flushHeaders();
        $this->withHeaders(['X-Tenant' => 'demo'])->postJson('/api/auth/login', ['email' => DemoHospital::email('nurse'), 'password' => DemoHospital::PASSWORD])->assertOk();
    }

    public function test_every_role_can_sign_in_and_open_its_screens(): void
    {
        $screens = [
            'admin' => ['dashboard', 'patients', 'appointments', 'emergency/board', 'admissions?status=admitted', 'ipd/board', 'store/items', 'store/orders', 'hr/attendance', 'finance/summary', 'reports/overview', 'reports/revenue', 'reports/emergency', 'reports/inpatients', 'reports/lab', 'reports/opd', 'reports/pharmacy', 'reports/diagnoses', 'invoices', 'claims', 'pre-authorizations', 'staff'],
            'doctor' => ['dashboard', 'appointments', 'emergency/board', 'nursing/due'],
            'nurse' => ['dashboard', 'nursing/due', 'emergency/board', 'hr/leave', 'hr/attendance/me'],
            'receptionist' => ['dashboard', 'appointments', 'patients', 'invoices', 'emergency/ambulances'],
            'pharmacist' => ['dashboard', 'pharmacy/medicines', 'pharmacy/prescriptions', 'store/items'],
            'lab_technician' => ['dashboard', 'lab/orders'],
            'accountant' => ['dashboard', 'invoices', 'claims', 'pre-authorizations', 'finance/expenses', 'finance/summary', 'reports/revenue'],
            'storekeeper' => ['dashboard', 'store/items', 'store/orders', 'store/suppliers'],
            'hr_manager' => ['dashboard', 'hr/leave?status=pending', 'hr/attendance'],
            'patient' => ['portal'],
        ];

        foreach ($screens as $role => $paths) {
            $client = $this->as($role);
            foreach ($paths as $path) {
                $res = $client->getJson("/api/{$path}");
                $this->assertSame(200, $res->status(), "{$role} → /api/{$path}: ".$res->getContent());
            }
        }

        $this->as('admin')->getJson('/api/emergency/board')->assertJsonPath('summary.critical', 2);
        $this->as('admin')->getJson('/api/finance/summary')->assertJsonPath('totals.income', fn ($v) => $v > 0);
        $admission = $this->as('nurse')->getJson('/api/nursing/due')->json('data.0.admission_id') ?? Admission::where('status', 'admitted')->value('id');
        $this->as('nurse')->getJson("/api/admissions/{$admission}/nursing")->assertOk()->assertJsonPath('orders.0.status', fn ($s) => in_array($s, ['active', 'completed'], true));
    }

    public function test_demo_blocks_actions_that_would_spoil_it_for_others(): void
    {
        $this->as('admin')->patchJson('/api/settings', ['name' => 'Hacked'])->assertForbidden();
        $this->as('admin')->patchJson('/api/auth/me', ['password' => 'newpassword123', 'password_confirmation' => 'newpassword123', 'current_password' => DemoHospital::PASSWORD])->assertForbidden();
        $this->as('admin')->postJson('/api/users', ['name' => 'X', 'email' => 'x@example.com', 'role' => 'doctor'])->assertForbidden();

        // Ordinary work still goes through.
        $this->as('receptionist')->postJson('/api/patients', ['first_name' => 'Test', 'last_name' => 'Visitor'])->assertCreated();
        $this->as('nurse')->postJson('/api/emergency/visits', ['unknown' => true, 'chief_complaint' => 'Demo arrival'])->assertCreated();

        // Other hospitals are not affected by the demo guard, and demo login only works on the demo.
        $this->flushHeaders();
        $this->withHeaders(['X-Tenant' => 'nope'])->postJson('/api/demo/login', ['role' => 'admin'])->assertNotFound();
    }
}
