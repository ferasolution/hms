<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class MedicationAdministration extends Model
{
    use BelongsToTenant;

    protected $guarded = ['id', 'tenant_id'];

    protected function casts(): array
    {
        return ['scheduled_for' => 'datetime', 'recorded_at' => 'datetime'];
    }

    public function order(): BelongsTo { return $this->belongsTo(MedicationOrder::class, 'medication_order_id'); }
    public function user(): BelongsTo { return $this->belongsTo(User::class); }
}
