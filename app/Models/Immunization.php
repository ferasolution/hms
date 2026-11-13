<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Immunization extends Model
{
    use BelongsToTenant;

    protected $guarded = ['id', 'tenant_id'];

    protected function casts(): array
    {
        return ['given_on' => 'date:Y-m-d', 'next_due_on' => 'date:Y-m-d', 'dose_no' => 'integer'];
    }

    public function giver(): BelongsTo { return $this->belongsTo(User::class, 'given_by'); }
}
