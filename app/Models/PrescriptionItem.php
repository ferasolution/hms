<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class PrescriptionItem extends Model
{
    // tenant_id is stamped by BelongsToTenant; controllers validate every field they pass in.
    protected $guarded = ['id', 'tenant_id'];

    /** Same as the column defaults, so new models carry them before a refresh. */
    protected $attributes = ['dispensed_qty' => 0, 'quantity' => 1];

    protected function casts(): array
    {
        return ['quantity' => 'integer', 'dispensed_qty' => 'integer', 'duration_days' => 'integer'];
    }

    public $timestamps = false;

    public function prescription(): BelongsTo { return $this->belongsTo(Prescription::class); }
    public function medicine(): BelongsTo { return $this->belongsTo(Medicine::class); }
}
