<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class InsuranceClaim extends Model
{
    use BelongsToTenant;

    // tenant_id is stamped by BelongsToTenant; controllers validate every field they pass in.
    protected $guarded = ['id', 'tenant_id'];

    /** Same as the column defaults, so new models carry them before a refresh. */
    protected $attributes = ['status' => 'submitted'];

    protected function casts(): array
    {
        return ['amount_claimed' => 'decimal:2', 'amount_approved' => 'decimal:2', 'submitted_at' => 'datetime', 'decided_at' => 'datetime', 'paid_at' => 'datetime'];
    }

    public function invoice(): BelongsTo { return $this->belongsTo(Invoice::class); }
    public function patient(): BelongsTo { return $this->belongsTo(Patient::class); }
    public function insurer(): BelongsTo { return $this->belongsTo(InsuranceProvider::class, 'insurance_provider_id'); }
    public function policy(): BelongsTo { return $this->belongsTo(PatientPolicy::class, 'patient_policy_id'); }
    public function preAuthorization(): BelongsTo { return $this->belongsTo(PreAuthorization::class); }
}
