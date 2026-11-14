<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PurchaseOrderItem extends Model
{
    public $timestamps = false;

    protected $guarded = ['id'];

    protected $attributes = ['received_qty' => 0, 'unit_cost' => 0];

    protected function casts(): array
    {
        return ['quantity' => 'integer', 'received_qty' => 'integer', 'unit_cost' => 'decimal:2'];
    }

    public function order(): BelongsTo { return $this->belongsTo(PurchaseOrder::class, 'purchase_order_id'); }
    public function medicine(): BelongsTo { return $this->belongsTo(Medicine::class); }
    public function item(): BelongsTo { return $this->belongsTo(InventoryItem::class, 'inventory_item_id'); }
}
