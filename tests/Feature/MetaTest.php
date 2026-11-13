<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MetaTest extends TestCase
{
    use RefreshDatabase;

    public function test_plans_are_public(): void
    {
        $this->seed();

        $this->getJson('/api/plans')
            ->assertOk()
            ->assertJsonCount(4, 'data')
            ->assertJsonPath('data.0.slug', 'free')
            ->assertJsonPath('data.1.price_monthly', '99.00');
    }

    public function test_tenant_info_is_public_but_scoped(): void
    {
        Tenant::factory()->create(['slug' => 'acme', 'name' => 'Acme General', 'type' => 'hospital']);

        $this->withHeaders(['X-Tenant' => 'acme'])->getJson('/api/tenant')
            ->assertOk()
            ->assertJson(['name' => 'Acme General', 'type' => 'hospital'])
            ->assertJsonMissingPath('status');

        $this->withHeaders(['X-Tenant' => 'nope'])->getJson('/api/tenant')->assertNotFound();
    }

    public function test_dashboard_shows_each_role_its_own_numbers(): void
    {
        $acme = Tenant::factory()->create(['slug' => 'acme']);
        $admin = User::factory()->role('admin')->create(['tenant_id' => $acme->id]);
        $doctor = User::factory()->role('doctor')->create(['tenant_id' => $acme->id]);

        $this->withHeaders(['X-Tenant' => 'acme', 'Authorization' => 'Bearer '.$admin->createToken('t')->plainTextToken])
            ->getJson('/api/dashboard')
            ->assertOk()
            ->assertJsonPath('staff.doctor', 1)
            ->assertJsonPath('staff.admin', 1)
            ->assertJsonStructure(['appointments_today', 'beds', 'finance', 'visits_series']);

        $this->app['auth']->forgetGuards();

        $this->withHeaders(['X-Tenant' => 'acme', 'Authorization' => 'Bearer '.$doctor->createToken('t')->plainTextToken])
            ->getJson('/api/dashboard')
            ->assertOk()
            ->assertJsonMissingPath('finance')
            ->assertJsonMissingPath('staff');
    }
}
