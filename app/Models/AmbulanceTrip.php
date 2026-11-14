<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AmbulanceTrip extends Model
{
    use BelongsToTenant;

    protected $guarded = ['id', 'tenant_id'];

    protected $attributes = ['status' => 'requested'];

    protected function casts(): array
    {
        return ['requested_at' => 'datetime', 'dispatched_at' => 'datetime', 'completed_at' => 'datetime'];
    }

    public function ambulance(): BelongsTo { return $this->belongsTo(Ambulance::class); }
}
