<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class LabOrder extends Model
{
    use BelongsToTenant;

    // tenant_id is stamped by BelongsToTenant; controllers validate every field they pass in.
    protected $guarded = ['id', 'tenant_id'];

    /** Same as the column defaults, so new models carry them before a refresh. */
    protected $attributes = ['status' => 'ordered', 'priority' => 'routine'];

    protected function casts(): array
    {
        return ['collected_at' => 'datetime', 'completed_at' => 'datetime'];
    }

    public function patient(): BelongsTo { return $this->belongsTo(Patient::class); }
    public function doctor(): BelongsTo { return $this->belongsTo(User::class, 'doctor_id'); }
    public function items(): HasMany { return $this->hasMany(LabOrderItem::class); }
}
