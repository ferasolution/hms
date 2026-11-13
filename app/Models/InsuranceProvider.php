<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class InsuranceProvider extends Model
{
    use BelongsToTenant;

    protected $guarded = ['id', 'tenant_id'];

    protected $attributes = ['type' => 'private', 'default_coverage' => 80, 'payment_terms_days' => 30, 'is_active' => true];

    protected function casts(): array
    {
        return ['default_coverage' => 'decimal:2', 'payment_terms_days' => 'integer', 'is_active' => 'boolean'];
    }

    public function policies(): HasMany { return $this->hasMany(PatientPolicy::class); }
    public function claims(): HasMany { return $this->hasMany(InsuranceClaim::class); }
}
