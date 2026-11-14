<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class InventoryItem extends Model
{
    use BelongsToTenant;

    protected $guarded = ['id', 'tenant_id'];

    protected $attributes = ['category' => 'consumable', 'unit' => 'pcs', 'stock' => 0, 'reorder_level' => 10, 'unit_cost' => 0, 'is_active' => true];

    protected function casts(): array
    {
        return ['unit_cost' => 'decimal:2', 'stock' => 'integer', 'reorder_level' => 'integer', 'expiry_date' => 'date:Y-m-d', 'is_active' => 'boolean'];
    }

    public function movements(): HasMany { return $this->hasMany(InventoryMovement::class); }
}
