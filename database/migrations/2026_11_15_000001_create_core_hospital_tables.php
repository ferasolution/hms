<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Blueprint "Core hospital release": emergency & ambulance, nursing (eMAR,
 * notes, intake/output), service catalogue, stores & procurement, HR leave
 * & attendance, and expenses.
 */
return new class extends Migration
{
    public function up(): void
    {
        /* ---------------------------------------------------------- emergency */

        Schema::create('ambulances', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('vehicle_no', 30);
            $table->string('type', 10)->default('bls');            // bls | als | patient_transport
            $table->string('driver_name', 120)->nullable();
            $table->string('phone', 30)->nullable();
            $table->string('status', 20)->default('available');    // available | on_trip | maintenance
            $table->timestamps();
        });

        Schema::create('er_visits', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->string('arrival_mode', 20)->default('walk_in'); // walk_in | ambulance | referral | police | other
            $table->dateTime('arrived_at');
            $table->string('chief_complaint', 500);
            $table->unsignedTinyInteger('triage_level')->nullable(); // 1 resuscitation … 5 non-urgent
            $table->dateTime('triaged_at')->nullable();
            $table->foreignId('triaged_by')->nullable()->constrained('users')->nullOnDelete();
            $table->json('vitals')->nullable();
            $table->unsignedTinyInteger('pain_score')->nullable();
            $table->string('red_flags', 500)->nullable();
            $table->boolean('isolation')->default(false);
            $table->string('status', 20)->default('waiting');      // waiting | in_treatment | observation | disposed
            $table->foreignId('doctor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('bay', 30)->nullable();
            $table->string('disposition', 20)->nullable();         // discharged | admitted | transferred | referred | lwbs | lama | deceased
            $table->dateTime('disposed_at')->nullable();
            $table->text('disposition_notes')->nullable();
            $table->foreignId('admission_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
            $table->index(['tenant_id', 'status']);
        });

        Schema::create('ambulance_trips', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('ambulance_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('er_visit_id')->nullable()->constrained()->nullOnDelete();
            $table->string('caller_name', 120)->nullable();
            $table->string('caller_phone', 30)->nullable();
            $table->string('patient_name', 120)->nullable();
            $table->string('pickup_address', 300);
            $table->string('destination', 300)->nullable();
            $table->string('reason', 300)->nullable();
            $table->string('status', 20)->default('requested');    // requested | dispatched | on_scene | transporting | completed | cancelled
            $table->dateTime('requested_at');
            $table->dateTime('dispatched_at')->nullable();
            $table->dateTime('completed_at')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
        });

        /* ---------------------------------------------------------- nursing */

        Schema::create('medication_orders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('admission_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->foreignId('medicine_id')->nullable()->constrained()->nullOnDelete();
            $table->string('medicine_name', 160);
            $table->string('dose', 60);
            $table->string('route', 20)->default('oral');          // oral | iv | im | sc | inhaled | topical | other
            $table->string('frequency', 10);                       // OD | BD | TDS | QID | Q6H | Q8H | HS | PRN | STAT
            $table->json('times')->nullable();                     // ["08:00","20:00"]
            $table->dateTime('starts_at');
            $table->dateTime('ends_at')->nullable();
            $table->string('status', 20)->default('active');       // active | stopped | completed
            $table->string('instructions', 300)->nullable();
            $table->foreignId('ordered_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('stopped_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['admission_id', 'status']);
        });

        Schema::create('medication_administrations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('medication_order_id')->constrained()->cascadeOnDelete();
            $table->dateTime('scheduled_for')->nullable();         // null for PRN / STAT doses
            $table->string('status', 20);                          // given | held | refused | missed
            $table->dateTime('recorded_at');
            $table->string('dose_given', 60)->nullable();
            $table->string('reason', 300)->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
            $table->index(['medication_order_id', 'scheduled_for'], 'med_admin_order_scheduled_idx');
        });

        Schema::create('nursing_notes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('admission_id')->constrained()->cascadeOnDelete();
            $table->string('type', 20)->default('note');           // note | handover | assessment | care_plan
            $table->string('shift', 10)->nullable();               // morning | evening | night
            $table->text('body');
            $table->json('assessment')->nullable();                // falls_risk, pressure_risk, pain, mobility, news2
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
            $table->index(['admission_id', 'created_at']);
        });

        Schema::create('fluid_entries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('admission_id')->constrained()->cascadeOnDelete();
            $table->string('direction', 10);                       // intake | output
            $table->string('route', 20);                           // oral | iv | ng | urine | drain | vomit | stool | other
            $table->unsignedInteger('volume_ml');
            $table->dateTime('recorded_at');
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
        });

        /* ---------------------------------------------------------- service catalogue */

        Schema::create('services', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('department_id')->nullable()->constrained()->nullOnDelete();
            $table->string('name', 160);
            $table->string('code', 30)->nullable();
            $table->string('category', 20)->default('procedure');  // procedure | consultation | nursing | package | emergency | other
            $table->decimal('price', 12, 2)->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        /* ---------------------------------------------------------- stores & procurement */

        Schema::create('suppliers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('name', 160);
            $table->string('contact_person', 120)->nullable();
            $table->string('phone', 30)->nullable();
            $table->string('email')->nullable();
            $table->string('address', 300)->nullable();
            $table->string('tax_id', 60)->nullable();
            $table->unsignedSmallInteger('payment_terms_days')->default(30);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('inventory_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('name', 160);
            $table->string('code', 40)->nullable();
            $table->string('category', 30)->default('consumable'); // consumable | surgical | linen | reagent | equipment | stationery | housekeeping | other
            $table->string('unit', 20)->default('pcs');
            $table->integer('stock')->default(0);
            $table->unsignedInteger('reorder_level')->default(10);
            $table->decimal('unit_cost', 12, 2)->default(0);
            $table->string('location', 80)->nullable();
            $table->date('expiry_date')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('inventory_movements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('inventory_item_id')->constrained()->cascadeOnDelete();
            $table->foreignId('department_id')->nullable()->constrained()->nullOnDelete();
            $table->string('type', 20);                            // receive | issue | return | adjust | wastage
            $table->integer('quantity');
            $table->integer('balance');
            $table->string('reference', 120)->nullable();
            $table->string('note', 300)->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamp('created_at')->useCurrent();
        });

        Schema::create('purchase_orders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('supplier_id')->constrained()->restrictOnDelete();
            $table->string('number', 30);
            $table->string('status', 20)->default('draft');        // draft | approved | partial | received | cancelled
            $table->date('expected_on')->nullable();
            $table->decimal('total', 12, 2)->default(0);
            $table->string('notes', 1000)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->timestamps();
            $table->unique(['tenant_id', 'number']);
        });

        Schema::create('purchase_order_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('purchase_order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('medicine_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('inventory_item_id')->nullable()->constrained()->nullOnDelete();
            $table->string('description', 200);
            $table->unsignedInteger('quantity');
            $table->unsignedInteger('received_qty')->default(0);
            $table->decimal('unit_cost', 12, 2)->default(0);
        });

        /* ---------------------------------------------------------- HR */

        Schema::table('staff_profiles', function (Blueprint $table) {
            $table->string('employee_no', 30)->nullable();
            $table->date('joined_on')->nullable();
            $table->string('employment_type', 20)->nullable();     // full_time | part_time | contract | visiting | locum
            $table->unsignedSmallInteger('annual_leave_days')->default(20);
        });

        Schema::create('leave_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('type', 20);                            // annual | sick | casual | unpaid | maternity | paternity | study
            $table->date('starts_on');
            $table->date('ends_on');
            $table->unsignedSmallInteger('days');
            $table->string('reason', 500)->nullable();
            $table->string('status', 20)->default('pending');      // pending | approved | rejected | cancelled
            $table->foreignId('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->string('decision_note', 300)->nullable();
            $table->timestamps();
            $table->index(['tenant_id', 'status']);
        });

        Schema::create('attendances', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->date('date');
            $table->dateTime('check_in')->nullable();
            $table->dateTime('check_out')->nullable();
            $table->string('status', 20)->default('present');      // present | late | absent | leave | off
            $table->string('note', 300)->nullable();
            $table->timestamps();
            $table->unique(['user_id', 'date']);
        });

        /* ---------------------------------------------------------- finance */

        Schema::create('expenses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('supplier_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('purchase_order_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('department_id')->nullable()->constrained()->nullOnDelete();
            $table->date('spent_on');
            $table->string('category', 30);                        // salaries | utilities | supplies | pharmacy_stock | maintenance | rent | equipment | marketing | other
            $table->string('description', 300);
            $table->decimal('amount', 12, 2);
            $table->string('method', 20)->default('bank');         // cash | bank | card | cheque
            $table->string('reference', 120)->nullable();
            $table->string('status', 20)->default('pending');      // pending | approved | paid | rejected
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->timestamps();
            $table->index(['tenant_id', 'spent_on']);
        });
    }

    public function down(): void
    {
        Schema::table('staff_profiles', function (Blueprint $table) {
            $table->dropColumn(['employee_no', 'joined_on', 'employment_type', 'annual_leave_days']);
        });
        foreach (['expenses', 'attendances', 'leave_requests', 'purchase_order_items', 'purchase_orders', 'inventory_movements', 'inventory_items',
            'suppliers', 'services', 'fluid_entries', 'nursing_notes', 'medication_administrations', 'medication_orders', 'ambulance_trips', 'er_visits', 'ambulances'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
