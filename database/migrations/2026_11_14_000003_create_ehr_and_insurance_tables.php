<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        /* ---------------------------------------------------------- EHR */

        Schema::create('patient_problems', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->string('name', 200);
            $table->string('icd_code', 20)->nullable();
            $table->string('status', 20)->default('active');       // active | chronic | resolved
            $table->date('onset_date')->nullable();
            $table->date('resolved_date')->nullable();
            $table->string('notes', 1000)->nullable();
            $table->foreignId('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['patient_id', 'status']);
        });

        Schema::create('patient_allergies', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->string('allergen', 160);
            $table->string('type', 20)->default('drug');           // drug | food | environment | other
            $table->string('reaction', 300)->nullable();
            $table->string('severity', 20)->default('moderate');   // mild | moderate | severe | life_threatening
            $table->string('status', 20)->default('active');       // active | inactive
            $table->foreignId('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['patient_id', 'status']);
        });

        // What the patient takes regularly (not one-off prescriptions).
        Schema::create('patient_medications', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->string('name', 160);
            $table->string('dose', 60)->nullable();
            $table->string('frequency', 60)->nullable();
            $table->string('route', 30)->nullable();
            $table->date('started_on')->nullable();
            $table->date('stopped_on')->nullable();
            $table->string('status', 20)->default('active');       // active | stopped
            $table->string('notes', 500)->nullable();
            $table->foreignId('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('immunizations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->string('vaccine', 160);
            $table->unsignedTinyInteger('dose_no')->nullable();
            $table->date('given_on');
            $table->string('lot_no', 60)->nullable();
            $table->string('site', 40)->nullable();
            $table->date('next_due_on')->nullable();
            $table->string('notes', 500)->nullable();
            $table->foreignId('given_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        // One row per patient: past medical, surgical, family, social and obstetric history.
        Schema::create('patient_histories', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->unique()->constrained()->cascadeOnDelete();
            $table->text('past_medical')->nullable();
            $table->text('surgical')->nullable();
            $table->text('family')->nullable();
            $table->json('social')->nullable();                    // smoking, alcohol, occupation, exercise, diet, marital_status
            $table->text('obstetric')->nullable();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('patient_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->string('title', 200);
            $table->string('category', 30)->default('other');      // report | scan | referral | consent | discharge | id | insurance | other
            $table->string('file_url', 500);
            $table->date('document_date')->nullable();
            $table->string('notes', 500)->nullable();
            $table->foreignId('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        // Who opened which chart, for privacy audits.
        Schema::create('chart_access_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('action', 30)->default('viewed');
            $table->string('ip', 45)->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->index(['patient_id', 'created_at']);
        });

        /* ---------------------------------------------------------- insurance */

        Schema::create('insurance_providers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('name', 160);
            $table->string('code', 30)->nullable();
            $table->string('type', 20)->default('private');        // private | government | corporate | tpa
            $table->string('contact_person', 120)->nullable();
            $table->string('phone', 30)->nullable();
            $table->string('email')->nullable();
            $table->string('address', 300)->nullable();
            $table->decimal('default_coverage', 5, 2)->default(80); // percent
            $table->unsignedSmallInteger('payment_terms_days')->default(30);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->unique(['tenant_id', 'name']);
        });

        Schema::create('patient_policies', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->foreignId('insurance_provider_id')->constrained()->restrictOnDelete();
            $table->string('policy_no', 60);
            $table->string('member_id', 60)->nullable();
            $table->string('group_no', 60)->nullable();
            $table->string('plan_name', 120)->nullable();
            $table->string('holder_name', 120)->nullable();
            $table->string('relation', 20)->default('self');       // self | spouse | child | parent | other
            $table->decimal('coverage_percent', 5, 2)->default(80);
            $table->decimal('copay', 10, 2)->default(0);
            $table->decimal('annual_limit', 12, 2)->nullable();
            $table->date('valid_from')->nullable();
            $table->date('valid_to')->nullable();
            $table->boolean('is_primary')->default(true);
            $table->string('status', 20)->default('active');       // active | expired | cancelled
            $table->string('card_url', 500)->nullable();
            $table->timestamps();
            $table->index(['patient_id', 'status']);
        });

        Schema::create('pre_authorizations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_policy_id')->constrained()->cascadeOnDelete();
            $table->foreignId('admission_id')->nullable()->constrained()->nullOnDelete();
            $table->string('service', 255);                        // procedure / admission / test requested
            $table->string('diagnosis', 255)->nullable();
            $table->string('icd_code', 20)->nullable();
            $table->decimal('estimated_amount', 12, 2);
            $table->decimal('approved_amount', 12, 2)->nullable();
            $table->string('auth_no', 60)->nullable();
            $table->string('status', 20)->default('requested');    // requested | approved | partial | denied | expired
            $table->date('valid_until')->nullable();
            $table->string('notes', 1000)->nullable();
            $table->foreignId('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->timestamps();
            $table->index(['tenant_id', 'status']);
        });

        Schema::table('insurance_claims', function (Blueprint $table) {
            $table->foreignId('insurance_provider_id')->nullable()->after('patient_id')->constrained()->nullOnDelete();
            $table->foreignId('patient_policy_id')->nullable()->after('insurance_provider_id')->constrained()->nullOnDelete();
            $table->foreignId('pre_authorization_id')->nullable()->after('patient_policy_id')->constrained()->nullOnDelete();
            $table->string('rejection_reason', 500)->nullable()->after('notes');
            $table->timestamp('submitted_at')->nullable();
            $table->timestamp('decided_at')->nullable();
            $table->timestamp('paid_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('insurance_claims', function (Blueprint $table) {
            $table->dropConstrainedForeignId('pre_authorization_id');
            $table->dropConstrainedForeignId('patient_policy_id');
            $table->dropConstrainedForeignId('insurance_provider_id');
            $table->dropColumn(['rejection_reason', 'submitted_at', 'decided_at', 'paid_at']);
        });
        foreach (['pre_authorizations', 'patient_policies', 'insurance_providers', 'chart_access_logs', 'patient_documents',
            'patient_histories', 'immunizations', 'patient_medications', 'patient_allergies', 'patient_problems'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
