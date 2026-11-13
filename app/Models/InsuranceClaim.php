<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class InsuranceClaim extends Model
{
    use BelongsToTenant;

    // tenant_id is stamped by BelongsToTenant; controllers validate every field they pass in.
    protected $guarded = ['id', 'tenant_id'];

    /** Same as the column defaults, so new models carry them before a refresh. */
    protected $attributes = ['status' => 'submitted'];

    protected function casts(): array
    {
        return ['amount_claimed' => 'decimal:2', 'amount_approved' => 'decimal:2'];
    }

    public function invoice(): BelongsTo { return $this->belongsTo(Invoice::class); }
    public function patient(): BelongsTo { return $this->belongsTo(Patient::class); }
}
