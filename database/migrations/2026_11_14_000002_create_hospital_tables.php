<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('departments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('name', 120);
            $table->string('code', 20)->nullable();
            $table->string('description', 500)->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->unique(['tenant_id', 'name']);
        });

        // Extra details for staff accounts (doctors, nurses, etc.).
        Schema::create('staff_profiles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->foreignId('department_id')->nullable()->constrained()->nullOnDelete();
            $table->string('specialization', 120)->nullable();
            $table->string('qualification', 200)->nullable();
            $table->string('license_no', 60)->nullable();
            $table->decimal('consultation_fee', 10, 2)->default(0);
            $table->unsignedSmallInteger('slot_minutes')->default(15);
            $table->json('schedule')->nullable();                  // {"1": ["09:00","13:00"], ...} weekday => [start, end]
            $table->string('bio', 1000)->nullable();
            $table->timestamps();
        });

        Schema::create('patients', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete(); // patient portal account
            $table->string('mrn', 30);                             // medical record number
            $table->string('first_name', 80);
            $table->string('last_name', 80);
            $table->string('gender', 10)->nullable();              // male | female | other
            $table->date('date_of_birth')->nullable();
            $table->string('phone', 30)->nullable();
            $table->string('email')->nullable();
            $table->string('address', 300)->nullable();
            $table->string('blood_group', 5)->nullable();
            $table->text('allergies')->nullable();
            $table->text('chronic_conditions')->nullable();
            $table->string('emergency_contact_name', 120)->nullable();
            $table->string('emergency_contact_phone', 30)->nullable();
            $table->string('insurance_provider', 120)->nullable();
            $table->string('insurance_number', 60)->nullable();
            $table->text('notes')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->unique(['tenant_id', 'mrn']);
            $table->index(['tenant_id', 'last_name']);
        });

        Schema::create('appointments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->foreignId('doctor_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('department_id')->nullable()->constrained()->nullOnDelete();
            $table->dateTime('scheduled_at');
            $table->unsignedSmallInteger('duration_minutes')->default(15);
            $table->string('type', 20)->default('consultation');   // consultation | follow_up | telemedicine | procedure
            $table->string('status', 20)->default('scheduled');    // scheduled | checked_in | in_progress | completed | cancelled | no_show
            $table->unsignedSmallInteger('token_no')->nullable();
            $table->string('reason', 500)->nullable();
            $table->string('notes', 1000)->nullable();
            $table->string('video_url', 500)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('checked_in_at')->nullable();
            $table->timestamps();
            $table->index(['tenant_id', 'scheduled_at']);
            $table->index(['doctor_id', 'scheduled_at']);
        });

        Schema::create('wards', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('name', 120);
            $table->string('type', 20)->default('general');        // general | private | semi_private | icu | emergency | maternity | pediatric
            $table->string('floor', 30)->nullable();
            $table->decimal('daily_rate', 10, 2)->default(0);
            $table->timestamps();
        });

        Schema::create('beds', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('ward_id')->constrained()->cascadeOnDelete();
            $table->string('number', 20);
            $table->string('status', 20)->default('available');    // available | occupied | cleaning | maintenance
            $table->timestamps();
            $table->unique(['ward_id', 'number']);
        });

        Schema::create('admissions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->foreignId('bed_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('doctor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('status', 20)->default('admitted');     // admitted | discharged
            $table->dateTime('admitted_at');
            $table->dateTime('discharged_at')->nullable();
            $table->string('reason', 500)->nullable();
            $table->string('diagnosis', 500)->nullable();
            $table->string('discharge_type', 20)->nullable();      // recovered | referred | lama | deceased
            $table->text('discharge_summary')->nullable();
            $table->timestamps();
            $table->index(['tenant_id', 'status']);
        });

        // A consultation, ward round or emergency visit: the clinical note.
        Schema::create('encounters', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->foreignId('doctor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('appointment_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('admission_id')->nullable()->constrained()->nullOnDelete();
            $table->string('type', 20)->default('opd');            // opd | ipd | emergency
            $table->json('vitals')->nullable();                    // bp, pulse, temperature, spo2, respiration, weight, height
            $table->text('complaints')->nullable();
            $table->text('examination')->nullable();
            $table->text('diagnosis')->nullable();
            $table->string('icd_code', 20)->nullable();
            $table->text('plan')->nullable();
            $table->date('follow_up_on')->nullable();
            $table->timestamps();
            $table->index(['patient_id', 'created_at']);
        });

        Schema::create('medicines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('name', 160);
            $table->string('generic_name', 160)->nullable();
            $table->string('form', 30)->nullable();                // tablet | capsule | syrup | injection | ...
            $table->string('strength', 40)->nullable();
            $table->string('category', 60)->nullable();
            $table->string('manufacturer', 120)->nullable();
            $table->string('batch_no', 60)->nullable();
            $table->date('expiry_date')->nullable();
            $table->decimal('unit_price', 10, 2)->default(0);
            $table->integer('stock')->default(0);
            $table->unsignedInteger('reorder_level')->default(10);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->index(['tenant_id', 'name']);
        });

        Schema::create('stock_movements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('medicine_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('type', 20);                            // purchase | dispense | adjust | return | expired
            $table->integer('quantity');                           // + in, - out
            $table->integer('balance');
            $table->string('reference', 120)->nullable();
            $table->string('note', 300)->nullable();
            $table->timestamp('created_at')->useCurrent();
        });

        Schema::create('prescriptions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->foreignId('doctor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('encounter_id')->nullable()->constrained()->nullOnDelete();
            $table->string('status', 20)->default('pending');      // pending | partial | dispensed | cancelled
            $table->string('notes', 1000)->nullable();
            $table->foreignId('dispensed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('dispensed_at')->nullable();
            $table->timestamps();
            $table->index(['tenant_id', 'status']);
        });

        Schema::create('prescription_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('prescription_id')->constrained()->cascadeOnDelete();
            $table->foreignId('medicine_id')->nullable()->constrained()->nullOnDelete();
            $table->string('medicine_name', 160);
            $table->string('dosage', 60)->nullable();              // 500 mg
            $table->string('frequency', 60)->nullable();           // 1-0-1, twice daily
            $table->unsignedSmallInteger('duration_days')->nullable();
            $table->unsignedInteger('quantity')->default(1);
            $table->unsignedInteger('dispensed_qty')->default(0);
            $table->string('instructions', 300)->nullable();
        });

        Schema::create('lab_tests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('name', 160);
            $table->string('code', 30)->nullable();
            $table->string('category', 20)->default('lab');        // lab | radiology
            $table->string('sample_type', 40)->nullable();
            $table->string('unit', 30)->nullable();
            $table->string('normal_range', 120)->nullable();
            $table->decimal('price', 10, 2)->default(0);
            $table->unsignedSmallInteger('turnaround_hours')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('lab_orders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->foreignId('doctor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('encounter_id')->nullable()->constrained()->nullOnDelete();
            $table->string('status', 20)->default('ordered');      // ordered | collected | completed | cancelled
            $table->string('priority', 10)->default('routine');    // routine | urgent | stat
            $table->string('notes', 500)->nullable();
            $table->timestamp('collected_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();
            $table->index(['tenant_id', 'status']);
        });

        Schema::create('lab_order_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('lab_order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('lab_test_id')->constrained()->restrictOnDelete();
            $table->string('result', 2000)->nullable();
            $table->string('flag', 10)->nullable();                // normal | high | low | critical
            $table->string('attachment_url', 500)->nullable();
            $table->foreignId('reported_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('reported_at')->nullable();
        });

        Schema::create('invoices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->foreignId('admission_id')->nullable()->constrained()->nullOnDelete();
            $table->string('number', 30);
            $table->string('status', 20)->default('unpaid');       // unpaid | partial | paid | void
            $table->decimal('subtotal', 12, 2)->default(0);
            $table->decimal('discount', 12, 2)->default(0);
            $table->decimal('tax', 12, 2)->default(0);
            $table->decimal('total', 12, 2)->default(0);
            $table->decimal('paid', 12, 2)->default(0);
            $table->string('currency', 3)->default('USD');
            $table->date('due_on')->nullable();
            $table->string('notes', 1000)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->unique(['tenant_id', 'number']);
            $table->index(['tenant_id', 'status']);
        });

        Schema::create('invoice_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('invoice_id')->constrained()->cascadeOnDelete();
            $table->string('category', 20)->default('other');      // consultation | lab | pharmacy | room | procedure | other
            $table->string('description', 255);
            $table->decimal('quantity', 10, 2)->default(1);
            $table->decimal('unit_price', 12, 2)->default(0);
            $table->decimal('amount', 12, 2)->default(0);
            $table->nullableMorphs('source');                      // the appointment, lab order or prescription billed
        });

        Schema::create('invoice_payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('invoice_id')->constrained()->cascadeOnDelete();
            $table->decimal('amount', 12, 2);
            $table->string('method', 20)->default('cash');         // cash | card | bank | insurance | online
            $table->string('reference', 120)->nullable();
            $table->foreignId('received_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('paid_at');
            $table->timestamps();
            $table->index(['tenant_id', 'paid_at']);
        });

        Schema::create('insurance_claims', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('invoice_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->string('provider', 120);
            $table->string('policy_no', 60)->nullable();
            $table->string('claim_no', 60)->nullable();
            $table->decimal('amount_claimed', 12, 2);
            $table->decimal('amount_approved', 12, 2)->nullable();
            $table->string('status', 20)->default('submitted');    // submitted | approved | rejected | paid
            $table->string('notes', 1000)->nullable();
            $table->timestamps();
            $table->index(['tenant_id', 'status']);
        });

        Schema::create('duty_shifts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('department_id')->nullable()->constrained()->nullOnDelete();
            $table->date('date');
            $table->string('shift', 10);                           // morning | evening | night | on_call
            $table->string('notes', 300)->nullable();
            $table->timestamps();
            $table->unique(['user_id', 'date', 'shift']);
            $table->index(['tenant_id', 'date']);
        });
    }

    public function down(): void
    {
        foreach (['duty_shifts', 'insurance_claims', 'invoice_payments', 'invoice_items', 'invoices', 'lab_order_items', 'lab_orders', 'lab_tests',
            'prescription_items', 'prescriptions', 'stock_movements', 'medicines', 'encounters', 'admissions', 'beds', 'wards',
            'appointments', 'patients', 'staff_profiles', 'departments'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
