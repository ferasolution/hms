<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Medicine extends Model
{
    use BelongsToTenant;

    // tenant_id is stamped by BelongsToTenant; controllers validate every field they pass in.
    protected $guarded = ['id', 'tenant_id'];

    protected function casts(): array
    {
        return ['expiry_date' => 'date', 'unit_price' => 'decimal:2', 'stock' => 'integer', 'reorder_level' => 'integer', 'is_active' => 'boolean'];
    }

    public function movements(): HasMany { return $this->hasMany(StockMovement::class); }
}
