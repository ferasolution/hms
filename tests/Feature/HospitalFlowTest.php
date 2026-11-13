<?php

namespace Tests\Feature;

use App\Models\Bed;
use App\Models\Department;
use App\Models\Invoice;
use App\Models\LabTest;
use App\Models\Medicine;
use App\Models\Patient;
use App\Models\Tenant;
use App\Models\User;
use App\Models\UserNotification;
use App\Services\Hospital;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class HospitalFlowTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    /** @var array<string, User> */
    private array $staff = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
        $this->tenant = Tenant::factory()->create(['slug' => 'mercy', 'name' => 'Mercy General']);
        app(Hospital::class)->seedDefaults($this->tenant);
        foreach (['admin', 'receptionist', 'nurse', 'pharmacist', 'lab_technician', 'accountant'] as $role) {
            $this->staff[$role] = User::factory()->role($role)->create(['tenant_id' => $this->tenant->id]);
        }
    }

    private function as(User|string $user): static
    {
        $user = is_string($user) ? $this->staff[$user] : $user;
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();

        return $this->withHeaders(['X-Tenant' => 'mercy', 'Authorization' => 'Bearer '.$user->createToken('t')->plainTextToken]);
    }

    private function scoped(string $model)
    {
        return $model::withoutGlobalScopes()->where('tenant_id', $this->tenant->id);
    }

    public function test_a_patient_goes_from_front_desk_to_paid_bill(): void
    {
        $this->travelTo(today()->setTime(10, 0));
        $cardiology = $this->scoped(Department::class)->where('name', 'Cardiology')->first();

        // Admin adds a doctor with a consultation fee.
        $doctorId = $this->as('admin')->postJson('/api/users', [
            'name' => 'Dr. Sarah Mitchell', 'email' => 'sarah@mercy.test', 'role' => 'doctor', 'password' => 'password1',
            'department_id' => $cardiology->id, 'specialization' => 'Cardiologist', 'consultation_fee' => 50,
        ])->assertCreated()->json('data.id') ?? User::where('email', 'sarah@mercy.test')->value('id');
        $doctor = User::withoutGlobalScopes()->find($doctorId);

        $this->as('receptionist')->getJson('/api/doctors')->assertOk()
            ->assertJsonPath('data.0.name', 'Dr. Sarah Mitchell')
            ->assertJsonPath('data.0.department.name', 'Cardiology');

        // Front desk registers a walk-in patient and checks them in.
        $patientId = $this->as('receptionist')->postJson('/api/patients', [
            'first_name' => 'James', 'last_name' => 'Walker', 'gender' => 'male', 'date_of_birth' => '1980-04-12',
            'phone' => '+1 555 0100', 'blood_group' => 'O+', 'allergies' => 'Penicillin',
        ])->assertCreated()->assertJsonPath('mrn', 'MRN-000001')->json('id');

        $appt = $this->as('receptionist')->postJson('/api/appointments', [
            'patient_id' => $patientId, 'doctor_id' => $doctor->id, 'scheduled_at' => now()->addHour()->format('Y-m-d H:i'),
            'reason' => 'Chest pain',
        ])->assertCreated()->assertJsonPath('status', 'scheduled')->assertJsonPath('token_no', 1)->json('id');
        $this->as('receptionist')->patchJson("/api/appointments/{$appt}", ['status' => 'checked_in'])->assertOk()->assertJsonPath('status', 'checked_in');
        $this->as('receptionist')->patchJson("/api/appointments/{$appt}", ['status' => 'checked_in'])->assertOk(); // no double charge

        // The same slot can't be double-booked.
        $this->as('receptionist')->postJson('/api/appointments', [
            'patient_id' => $patientId, 'doctor_id' => $doctor->id, 'scheduled_at' => now()->addHour()->format('Y-m-d H:i'),
        ])->assertUnprocessable()->assertJsonValidationErrors('scheduled_at');

        $invoice = $this->scoped(Invoice::class)->where('patient_id', $patientId)->first();
        $this->assertSame('50.00', $invoice->total);

        // Walk-ins are seen now and never clash with each other.
        $walkIn = $this->as('receptionist')->postJson('/api/patients', ['first_name' => 'Mia', 'last_name' => 'Cole'])->json('id');
        $this->as('receptionist')->postJson('/api/appointments', ['patient_id' => $walkIn, 'doctor_id' => $doctor->id, 'scheduled_at' => now()->format('Y-m-d H:i'), 'walk_in' => true])
            ->assertCreated()->assertJsonPath('status', 'checked_in');
        $this->as('receptionist')->postJson('/api/appointments', ['patient_id' => $walkIn, 'doctor_id' => $doctor->id, 'scheduled_at' => now()->format('Y-m-d H:i'), 'walk_in' => true])
            ->assertCreated()->assertJsonPath('token_no', 3);

        // The doctor sees their queue and writes the note with a prescription and tests.
        $this->as($doctor)->getJson('/api/appointments')->assertOk()->assertJsonCount(3, 'data')->assertJsonPath('data.2.patient.name', 'James Walker');
        $med = $this->scoped(Medicine::class)->where('name', 'Amlodipine')->first();
        $tests = $this->scoped(LabTest::class)->whereIn('code', ['CBC', 'ECG'])->pluck('id')->all();

        $this->as($doctor)->postJson('/api/encounters', [
            'patient_id' => $patientId, 'appointment_id' => $appt,
            'vitals' => ['bp' => '150/95', 'pulse' => 88, 'temperature' => 98.6, 'spo2' => 97],
            'complaints' => 'Chest tightness on exertion', 'diagnosis' => 'Hypertension', 'icd_code' => 'I10',
            'medicines' => [
                ['medicine_id' => $med->id, 'dosage' => '5 mg', 'frequency' => '1-0-0', 'duration_days' => 30, 'quantity' => 30],
                ['medicine_name' => 'Aspirin 75 mg', 'frequency' => '0-0-1', 'quantity' => 30],
            ],
            'lab_test_ids' => $tests, 'lab_priority' => 'urgent', 'complete_appointment' => true,
        ])->assertCreated()->assertJsonCount(1, 'prescriptions')->assertJsonCount(1, 'lab_orders');

        $this->as($doctor)->getJson("/api/patients/{$patientId}")->assertOk()
            ->assertJsonPath('appointments.0.status', 'completed')
            ->assertJsonPath('encounters.0.diagnosis', 'Hypertension')
            ->assertJsonPath('invoices', []); // doctors don't see bills

        // Lab bills on order.
        $this->assertSame('115.00', $invoice->fresh()->total); // 50 + CBC 25 + ECG 40

        // Nurses can record vitals but not prescribe; pharmacists can't write notes.
        $this->as('nurse')->postJson('/api/encounters', ['patient_id' => $patientId, 'vitals' => ['pulse' => 80]])->assertCreated();
        $this->as('nurse')->postJson('/api/encounters', ['patient_id' => $patientId, 'medicines' => [['medicine_name' => 'X']]])->assertForbidden();
        $this->as('pharmacist')->postJson('/api/encounters', ['patient_id' => $patientId])->assertForbidden();
        $this->as($doctor)->getJson('/api/invoices')->assertForbidden();

        // Pharmacy: receive stock, then dispense. The free-text item is matched to stock.
        $this->as('pharmacist')->postJson("/api/pharmacy/medicines/{$med->id}/adjust", ['type' => 'purchase', 'quantity' => 100, 'reference' => 'PO-1'])
            ->assertOk()->assertJsonPath('stock', 100);
        $aspirinId = $this->as('pharmacist')->postJson('/api/pharmacy/medicines', ['name' => 'Aspirin', 'strength' => '75 mg', 'unit_price' => 0.05, 'stock' => 10])
            ->assertCreated()->assertJsonPath('stock', 10)->json('id');
        $rx = $this->as('pharmacist')->getJson('/api/pharmacy/prescriptions')->assertOk()->json('data.0');
        $this->as('pharmacist')->postJson("/api/pharmacy/prescriptions/{$rx['id']}/dispense", ['items' => [
            ['id' => $rx['items'][0]['id'], 'quantity' => 30],
            ['id' => $rx['items'][1]['id'], 'quantity' => 30, 'medicine_id' => $aspirinId],
        ]])->assertUnprocessable(); // only 10 aspirin
        $this->as('pharmacist')->postJson("/api/pharmacy/prescriptions/{$rx['id']}/dispense", ['items' => [
            ['id' => $rx['items'][0]['id'], 'quantity' => 30],
            ['id' => $rx['items'][1]['id'], 'quantity' => 10, 'medicine_id' => $aspirinId],
        ]])->assertOk()->assertJsonPath('status', 'partial');
        $this->assertSame(70, $med->fresh()->stock);
        $this->assertSame('121.50', $invoice->fresh()->total); // + 30 × 0.20 + 10 × 0.05

        // Lab: collect and report; the doctor gets a critical-result alert.
        $order = $this->as('lab_technician')->getJson('/api/lab/orders')->assertOk()->json('data.0');
        $this->as('lab_technician')->postJson("/api/lab/orders/{$order['id']}/collect")->assertOk()->assertJsonPath('status', 'collected');
        $this->as('lab_technician')->postJson("/api/lab/orders/{$order['id']}/report", ['items' => [
            ['id' => $order['items'][0]['id'], 'result' => 'Hb 9.1 g/dL', 'flag' => 'critical'],
            ['id' => $order['items'][1]['id'], 'result' => 'Sinus rhythm', 'flag' => 'normal'],
        ]])->assertOk()->assertJsonPath('status', 'completed');
        $this->assertTrue(UserNotification::where('user_id', $doctor->id)->where('title', 'like', '%Critical%')->exists());

        // Admit, then discharge two days later: room charges are added.
        $generalWard = \App\Models\Ward::withoutGlobalScopes()->where('tenant_id', $this->tenant->id)->where('type', 'general')->value('id');
        $bed = $this->scoped(Bed::class)->where('status', 'available')->where('ward_id', $generalWard)->first();
        $admission = $this->as('nurse')->postJson('/api/admissions', [
            'patient_id' => $patientId, 'bed_id' => $bed->id, 'doctor_id' => $doctor->id, 'diagnosis' => 'Hypertensive urgency',
        ])->assertCreated()->json('id');
        $this->assertSame('occupied', $bed->fresh()->status);
        $this->as('nurse')->postJson('/api/admissions', ['patient_id' => $patientId, 'bed_id' => $bed->id])->assertUnprocessable();

        $this->travel(2)->days();
        $this->as($doctor)->postJson("/api/admissions/{$admission}/discharge", [
            'discharge_type' => 'recovered', 'discharge_summary' => 'BP controlled.',
        ])->assertOk()->assertJsonPath('status', 'discharged');
        $this->assertSame('cleaning', $bed->fresh()->status);

        $roomBill = $this->scoped(Invoice::class)->where('patient_id', $patientId)->whereNotNull('admission_id')->first();
        $this->assertSame('240.00', $roomBill->total); // 2 days × 120

        // Accounts take payment.
        $this->as('accountant')->postJson("/api/invoices/{$invoice->id}/payments", ['amount' => 500, 'method' => 'card'])->assertUnprocessable();
        $this->as('accountant')->postJson("/api/invoices/{$invoice->id}/payments", ['amount' => 121.50, 'method' => 'card', 'reference' => 'VISA-4417'])
            ->assertCreated()->assertJsonPath('status', 'paid')->assertJsonPath('balance', 0);
        $this->as('accountant')->getJson('/api/invoices/summary')->assertOk()->assertJsonPath('collected', 121.5)->assertJsonPath('outstanding', 240);

        // Insurance pays the room bill.
        $claim = $this->as('accountant')->postJson('/api/claims', ['invoice_id' => $roomBill->id, 'provider' => 'BlueCross', 'policy_no' => 'BC-1'])
            ->assertCreated()->assertJsonPath('amount_claimed', '240.00')->json('id');
        $this->as('accountant')->patchJson("/api/claims/{$claim}", ['status' => 'paid', 'amount_approved' => 240])->assertOk();
        $this->assertSame('paid', $roomBill->fresh()->status);
    }

    public function test_patient_portal_shows_own_records_and_books(): void
    {
        $doctor = User::factory()->role('doctor')->create(['tenant_id' => $this->tenant->id, 'name' => 'Dr. Lee']);
        $patientId = $this->as('receptionist')->postJson('/api/patients', ['first_name' => 'Ava', 'last_name' => 'Brooks'])->json('id');
        $other = $this->as('receptionist')->postJson('/api/patients', ['first_name' => 'Noah', 'last_name' => 'Hill'])->json('id');
        $this->as('receptionist')->postJson("/api/patients/{$patientId}/portal", ['email' => 'ava@example.com', 'password' => 'password1'])->assertCreated();

        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $token = $this->withHeaders(['X-Tenant' => 'mercy'])->postJson('/api/auth/login', ['email' => 'ava@example.com', 'password' => 'password1'])
            ->assertOk()->assertJsonPath('user.role', 'patient')->json('token');
        $this->withHeaders(['Authorization' => "Bearer {$token}"]);

        $this->getJson('/api/portal')->assertOk()->assertJsonPath('patient.name', 'Ava Brooks');
        $this->getJson("/api/patients/{$other}")->assertForbidden();
        $this->getJson('/api/appointments')->assertForbidden();

        $day = now()->addDays(2)->isSunday() ? now()->addDays(3) : now()->addDays(2);
        $slots = $this->getJson("/api/appointments/slots?doctor_id={$doctor->id}&date=".$day->toDateString())->assertOk()->json('data');
        $this->assertNotEmpty($slots);

        $this->postJson('/api/portal/appointments', ['doctor_id' => $doctor->id, 'scheduled_at' => $slots[0], 'reason' => 'Check-up'])
            ->assertCreated()->assertJsonPath('doctor.name', 'Dr. Lee');
        $this->postJson('/api/portal/appointments', ['doctor_id' => $doctor->id, 'scheduled_at' => $slots[0]])
            ->assertUnprocessable()->assertJsonValidationErrors('scheduled_at');
        $this->getJson('/api/portal')->assertJsonCount(1, 'upcoming');
    }

    public function test_modules_can_be_switched_off(): void
    {
        $this->as('admin')->putJson('/api/modules', ['modules' => ['pharmacy' => false]])->assertOk();
        $this->as('pharmacist')->getJson('/api/pharmacy/prescriptions')->assertForbidden();
        $this->as('admin')->getJson('/api/lab/orders')->assertOk();
    }

    public function test_doctor_schedule_controls_slots(): void
    {
        $doctor = User::factory()->role('doctor')->create(['tenant_id' => $this->tenant->id]);
        $this->as('admin')->patchJson("/api/staff/{$doctor->id}/profile", [
            'slot_minutes' => 30, 'consultation_fee' => 80, 'schedule' => ['1' => ['09:00', '11:00']],
        ])->assertOk()->assertJsonPath('slot_minutes', 30);

        $monday = now()->next('Monday');
        $this->as('receptionist')->getJson("/api/appointments/slots?doctor_id={$doctor->id}&date=".$monday->toDateString())
            ->assertOk()->assertJsonCount(4, 'data');
        $this->as('receptionist')->getJson("/api/appointments/slots?doctor_id={$doctor->id}&date=".$monday->copy()->addDay()->toDateString())
            ->assertOk()->assertJsonCount(0, 'data');

        // Another doctor can't edit this profile.
        $other = User::factory()->role('doctor')->create(['tenant_id' => $this->tenant->id]);
        $this->as($other)->patchJson("/api/staff/{$doctor->id}/profile", ['consultation_fee' => 1])->assertForbidden();
    }
}
