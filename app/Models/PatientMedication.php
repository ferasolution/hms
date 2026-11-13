<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PatientMedication extends Model
{
    use BelongsToTenant;

    protected $guarded = ['id', 'tenant_id'];

    protected $attributes = ['status' => 'active'];

    protected function casts(): array
    {
        return ['started_on' => 'date:Y-m-d', 'stopped_on' => 'date:Y-m-d'];
    }

    public function recorder(): BelongsTo { return $this->belongsTo(User::class, 'recorded_by'); }
}
