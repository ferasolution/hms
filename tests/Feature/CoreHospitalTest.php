<?php

namespace Tests\Feature;

use App\Models\Bed;
use App\Models\Expense;
use App\Models\InventoryItem;
use App\Models\Medicine;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Ward;
use App\Services\Hospital;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CoreHospitalTest extends TestCase
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
        foreach (['admin', 'doctor', 'nurse', 'receptionist', 'pharmacist', 'accountant', 'storekeeper', 'hr_manager'] as $role) {
            $this->staff[$role] = User::factory()->role($role)->create(['tenant_id' => $this->tenant->id]);
        }
    }

    private function as(string $role): static
    {
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();

        return $this->withHeaders(['X-Tenant' => 'mercy', 'Authorization' => 'Bearer '.$this->staff[$role]->createToken('t')->plainTextToken]);
    }

    private function freeBed(): Bed
    {
        $ward = Ward::withoutGlobalScopes()->where('tenant_id', $this->tenant->id)->where('type', 'general')->value('id');

        return Bed::withoutGlobalScopes()->where('ward_id', $ward)->where('status', 'available')->first();
    }

    public function test_emergency_arrival_triage_and_admission(): void
    {
        $visit = $this->as('receptionist')->postJson('/api/emergency/visits', ['unknown' => true, 'unknown_gender' => 'male', 'arrival_mode' => 'ambulance', 'chief_complaint' => 'Road traffic accident'])
            ->assertCreated()->assertJsonPath('patient.name', fn ($n) => str_starts_with($n, 'Unknown'))->json('id');

        $this->as('receptionist')->postJson("/api/emergency/visits/{$visit}/triage", ['triage_level' => 1])->assertForbidden();
        $this->as('nurse')->postJson("/api/emergency/visits/{$visit}/triage", ['triage_level' => 2, 'vitals' => ['pulse' => 130, 'gcs' => 13], 'pain_score' => 8])
            ->assertOk()->assertJsonPath('triage_level', 2);
        $this->assertDatabaseHas('user_notifications', ['user_id' => $this->staff['doctor']->id, 'type' => 'emergency']);

        $this->as('doctor')->patchJson("/api/emergency/visits/{$visit}", ['doctor_id' => $this->staff['doctor']->id, 'bay' => 'Resus 1'])->assertOk()->assertJsonPath('status', 'in_treatment');
        $this->as('doctor')->getJson('/api/emergency/board')->assertOk()->assertJsonPath('summary.critical', 1)->assertJsonPath('data.0.bay', 'Resus 1');

        $bed = $this->freeBed();
        $this->as('doctor')->postJson("/api/emergency/visits/{$visit}/dispose", ['disposition' => 'admitted'])->assertUnprocessable();
        $this->as('doctor')->postJson("/api/emergency/visits/{$visit}/dispose", ['disposition' => 'admitted', 'bed_id' => $bed->id])
            ->assertOk()->assertJsonPath('status', 'disposed')->assertJsonPath('disposition', 'admitted');
        $this->assertSame('occupied', $bed->fresh()->status);
        $this->as('doctor')->getJson('/api/emergency/board')->assertJsonPath('summary.in_department', 0);
        $this->as('admin')->getJson('/api/reports/emergency')->assertOk()->assertJsonPath('rows.1.visits', 1);
    }

    public function test_emar_with_allergy_check(): void
    {
        $this->travelTo(today()->setTime(7, 0));
        $pid = $this->as('receptionist')->postJson('/api/patients', ['first_name' => 'Ruth', 'last_name' => 'Gray'])->json('id');
        $this->as('nurse')->postJson("/api/patients/{$pid}/ehr/allergies", ['allergen' => 'Amoxicillin', 'severity' => 'severe'])->assertCreated();
        $adm = $this->as('nurse')->postJson('/api/admissions', ['patient_id' => $pid, 'bed_id' => $this->freeBed()->id])->assertCreated()->json('id');

        $amox = Medicine::withoutGlobalScopes()->where('tenant_id', $this->tenant->id)->where('name', 'Amoxicillin')->first();
        $this->as('nurse')->postJson("/api/admissions/{$adm}/medication-orders", ['medicine_name' => 'Paracetamol', 'dose' => '1 g', 'frequency' => 'QID'])->assertForbidden();
        $this->as('doctor')->postJson("/api/admissions/{$adm}/medication-orders", ['medicine_id' => $amox->id, 'dose' => '500 mg', 'frequency' => 'TDS'])->assertStatus(409);
        $order = $this->as('doctor')->postJson("/api/admissions/{$adm}/medication-orders", ['medicine_name' => 'Paracetamol', 'dose' => '1 g', 'frequency' => 'BD'])
            ->assertCreated()->assertJsonPath('times', ['08:00', '20:00'])->json('id');

        $this->travelTo(today()->setTime(8, 30));
        $this->as('nurse')->getJson('/api/nursing/due')->assertOk()->assertJsonPath('data.0.medicine', 'Paracetamol');
        $at = today()->toDateString().' 08:00';
        $this->as('nurse')->postJson("/api/medication-orders/{$order}/administer", ['scheduled_for' => $at, 'status' => 'held'])->assertUnprocessable()->assertJsonValidationErrors('reason');
        $this->as('nurse')->postJson("/api/medication-orders/{$order}/administer", ['scheduled_for' => $at, 'status' => 'given'])->assertCreated()->assertJsonPath('dose_given', '1 g');
        $this->as('nurse')->postJson("/api/medication-orders/{$order}/administer", ['scheduled_for' => $at, 'status' => 'given'])->assertUnprocessable();

        $this->as('nurse')->postJson("/api/admissions/{$adm}/nursing-notes", ['type' => 'handover', 'shift' => 'morning', 'body' => 'Stable, mobilising.', 'assessment' => ['falls_risk' => 'medium', 'pain' => 3]])->assertCreated();
        $this->as('nurse')->postJson("/api/admissions/{$adm}/fluids", ['direction' => 'intake', 'route' => 'iv', 'volume_ml' => 500])->assertCreated();
        $this->as('nurse')->postJson("/api/admissions/{$adm}/fluids", ['direction' => 'output', 'route' => 'urine', 'volume_ml' => 300])->assertCreated();

        $this->as('nurse')->getJson("/api/admissions/{$adm}/nursing")->assertOk()
            ->assertJsonPath('orders.0.doses.0.record.status', 'given')
            ->assertJsonPath('fluids.intake', 500)->assertJsonPath('fluids.output', 300)
            ->assertJsonPath('notes.0.assessment.falls_risk', 'medium')
            ->assertJsonPath('allergies.0.allergen', 'Amoxicillin');
    }

    public function test_purchase_order_needs_second_approver_and_receipt_updates_stock(): void
    {
        $supplier = $this->as('storekeeper')->postJson('/api/store/suppliers', ['name' => 'MedSupply Co'])->assertCreated()->json('id');
        $gloves = $this->as('storekeeper')->postJson('/api/store/items', ['name' => 'Nitrile gloves', 'category' => 'consumable', 'unit' => 'box', 'stock' => 5, 'reorder_level' => 10])
            ->assertCreated()->assertJsonPath('stock', 5)->json('id');
        $med = Medicine::withoutGlobalScopes()->where('tenant_id', $this->tenant->id)->where('name', 'Paracetamol')->first();

        $po = $this->as('storekeeper')->postJson('/api/store/orders', ['supplier_id' => $supplier, 'items' => [
            ['inventory_item_id' => $gloves, 'quantity' => 20, 'unit_cost' => 6],
            ['medicine_id' => $med->id, 'quantity' => 1000, 'unit_cost' => 0.05],
        ]])->assertCreated()->assertJsonPath('total', '170.00')->json();

        $this->as('storekeeper')->postJson("/api/store/orders/{$po['id']}/receive", ['items' => []])->assertUnprocessable();
        $this->as('admin')->postJson("/api/store/orders/{$po['id']}/approve")->assertOk()->assertJsonPath('status', 'approved');

        $line = collect($po['items'])->keyBy(fn ($l) => $l['inventory_item_id'] ? 'gloves' : 'med');
        $this->as('storekeeper')->postJson("/api/store/orders/{$po['id']}/receive", ['items' => [
            ['id' => $line['gloves']['id'], 'quantity' => 20],
            ['id' => $line['med']['id'], 'quantity' => 400, 'batch_no' => 'B-77', 'expiry_date' => now()->addYear()->toDateString()],
        ]])->assertOk()->assertJsonPath('status', 'partial');

        $this->assertSame(25, InventoryItem::withoutGlobalScopes()->find($gloves)->stock);
        $this->assertSame(400, $med->fresh()->stock);
        $this->assertSame('B-77', $med->fresh()->batch_no);
        $this->assertSame('140.00', Expense::withoutGlobalScopes()->where('purchase_order_id', $po['id'])->value('amount'));

        // Issue to a ward.
        $dept = \App\Models\Department::withoutGlobalScopes()->where('tenant_id', $this->tenant->id)->value('id');
        $this->as('storekeeper')->postJson("/api/store/items/{$gloves}/move", ['type' => 'issue', 'quantity' => 30, 'department_id' => $dept])->assertUnprocessable();
        $this->as('storekeeper')->postJson("/api/store/items/{$gloves}/move", ['type' => 'issue', 'quantity' => 5, 'department_id' => $dept])->assertOk()->assertJsonPath('stock', 20);

        // The approver of a PO can't be the person who raised it.
        $po2 = $this->as('admin')->postJson('/api/store/orders', ['supplier_id' => $supplier, 'items' => [['inventory_item_id' => $gloves, 'quantity' => 1, 'unit_cost' => 6]]])->json('id');
        $this->as('admin')->postJson("/api/store/orders/{$po2}/approve")->assertForbidden();
        $this->as('accountant')->postJson("/api/store/orders/{$po2}/approve")->assertOk();
    }

    public function test_leave_attendance_and_expenses(): void
    {
        $this->as('nurse')->postJson('/api/hr/leave', ['type' => 'annual', 'starts_on' => now()->addDays(10)->toDateString(), 'ends_on' => now()->addDays(12)->toDateString()])
            ->assertCreated()->assertJsonPath('days', 3);
        $this->as('nurse')->postJson('/api/hr/leave', ['type' => 'annual', 'starts_on' => now()->addDays(11)->toDateString(), 'ends_on' => now()->addDays(11)->toDateString()])
            ->assertUnprocessable();
        $this->as('nurse')->postJson('/api/hr/leave', ['type' => 'annual', 'starts_on' => now()->addDays(40)->toDateString(), 'ends_on' => now()->addDays(80)->toDateString()])
            ->assertUnprocessable();
        $leave = $this->as('hr_manager')->getJson('/api/hr/leave?status=pending')->assertOk()->json('data.0.id');
        $this->as('nurse')->patchJson("/api/hr/leave/{$leave}", ['status' => 'approved'])->assertForbidden();
        $this->as('hr_manager')->patchJson("/api/hr/leave/{$leave}", ['status' => 'approved'])->assertOk();
        $this->as('nurse')->getJson('/api/hr/leave')->assertJsonPath('balance.annual_left', 17);

        $this->as('doctor')->postJson('/api/hr/attendance/clock')->assertOk();
        $this->as('doctor')->postJson('/api/hr/attendance/clock')->assertOk()->assertJsonPath('check_out', fn ($v) => $v !== null);
        $this->as('doctor')->postJson('/api/hr/attendance/clock')->assertUnprocessable();
        $this->as('hr_manager')->getJson('/api/hr/attendance')->assertOk()->assertJsonPath('summary.absent', fn ($n) => $n >= 1);
        $this->as('nurse')->getJson('/api/hr/attendance')->assertForbidden();

        $exp = $this->as('accountant')->postJson('/api/finance/expenses', ['spent_on' => today()->toDateString(), 'category' => 'utilities', 'description' => 'Electricity', 'amount' => 900])
            ->assertCreated()->json('id');
        $this->as('accountant')->patchJson("/api/finance/expenses/{$exp}", ['status' => 'approved'])->assertForbidden();
        $this->as('accountant')->patchJson("/api/finance/expenses/{$exp}", ['status' => 'paid'])->assertUnprocessable();
        $this->as('admin')->patchJson("/api/finance/expenses/{$exp}", ['status' => 'approved'])->assertOk();
        $this->as('accountant')->patchJson("/api/finance/expenses/{$exp}", ['status' => 'paid', 'reference' => 'TX-1'])->assertOk();
        $this->as('accountant')->getJson('/api/finance/summary')->assertOk()->assertJsonPath('totals.expenses', 900);
        $this->as('admin')->getJson('/api/reports/overview')->assertOk()->assertJsonPath('kpis.expenses', 900);
        $this->as('doctor')->getJson('/api/finance/summary')->assertForbidden();
    }

    public function test_service_price_list_bills_patient(): void
    {
        $svc = $this->as('accountant')->postJson('/api/services', ['name' => 'Wound dressing', 'category' => 'nursing', 'price' => 15])->assertCreated()->json('id');
        $pid = $this->as('receptionist')->postJson('/api/patients', ['first_name' => 'Owen', 'last_name' => 'Hart'])->json('id');
        $this->as('nurse')->postJson("/api/patients/{$pid}/charges", ['service_id' => $svc, 'quantity' => 2])->assertCreated()->assertJsonPath('total', '30.00');
        $this->as('pharmacist')->postJson('/api/services', ['name' => 'X', 'price' => 1])->assertForbidden();
    }
}
