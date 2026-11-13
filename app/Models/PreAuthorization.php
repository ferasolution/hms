<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PreAuthorization extends Model
{
    use BelongsToTenant;

    protected $guarded = ['id', 'tenant_id'];

    protected $attributes = ['status' => 'requested'];

    protected function casts(): array
    {
        return ['estimated_amount' => 'decimal:2', 'approved_amount' => 'decimal:2', 'valid_until' => 'date:Y-m-d', 'decided_at' => 'datetime'];
    }

    public function patient(): BelongsTo { return $this->belongsTo(Patient::class); }
    public function policy(): BelongsTo { return $this->belongsTo(PatientPolicy::class, 'patient_policy_id'); }
    public function requester(): BelongsTo { return $this->belongsTo(User::class, 'requested_by'); }
}
