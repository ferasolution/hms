<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Invoice extends Model
{
    use BelongsToTenant;

    // tenant_id is stamped by BelongsToTenant; controllers validate every field they pass in.
    protected $guarded = ['id', 'tenant_id'];

    /** Same as the column defaults, so new models carry them before a refresh. */
    protected $attributes = ['status' => 'unpaid', 'subtotal' => 0, 'discount' => 0, 'tax' => 0, 'total' => 0, 'paid' => 0];

    protected function casts(): array
    {
        return ['subtotal' => 'decimal:2', 'discount' => 'decimal:2', 'tax' => 'decimal:2', 'total' => 'decimal:2', 'paid' => 'decimal:2', 'due_on' => 'date:Y-m-d'];
    }

    public function patient(): BelongsTo { return $this->belongsTo(Patient::class); }
    public function items(): HasMany { return $this->hasMany(InvoiceItem::class); }
    public function payments(): HasMany { return $this->hasMany(InvoicePayment::class); }
    public function claims(): HasMany { return $this->hasMany(InsuranceClaim::class); }

    public function balance(): float { return round((float) $this->total - (float) $this->paid, 2); }
}
