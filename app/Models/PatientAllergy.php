<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PatientAllergy extends Model
{
    use BelongsToTenant;

    protected $guarded = ['id', 'tenant_id'];

    protected $attributes = ['type' => 'drug', 'severity' => 'moderate', 'status' => 'active'];

    public function recorder(): BelongsTo { return $this->belongsTo(User::class, 'recorded_by'); }
}
