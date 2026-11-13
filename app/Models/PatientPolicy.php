<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PatientPolicy extends Model
{
    use BelongsToTenant;

    protected $guarded = ['id', 'tenant_id'];

    protected $attributes = ['relation' => 'self', 'coverage_percent' => 80, 'copay' => 0, 'is_primary' => true, 'status' => 'active'];

    protected function casts(): array
    {
        return ['coverage_percent' => 'decimal:2', 'copay' => 'decimal:2', 'annual_limit' => 'decimal:2', 'valid_from' => 'date:Y-m-d', 'valid_to' => 'date:Y-m-d', 'is_primary' => 'boolean'];
    }

    public function patient(): BelongsTo { return $this->belongsTo(Patient::class); }
    public function provider(): BelongsTo { return $this->belongsTo(InsuranceProvider::class, 'insurance_provider_id'); }

    /** Active and inside its validity dates. */
    public function isValid(?\DateTimeInterface $on = null): bool
    {
        $on = $on ? \Illuminate\Support\Carbon::instance($on) : today();

        return $this->status === 'active'
            && (! $this->valid_from || $this->valid_from->lte($on))
            && (! $this->valid_to || $this->valid_to->gte($on));
    }
}
