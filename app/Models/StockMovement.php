<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class StockMovement extends Model
{
    use BelongsToTenant;

    // tenant_id is stamped by BelongsToTenant; controllers validate every field they pass in.
    protected $guarded = ['id', 'tenant_id'];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }

    public const UPDATED_AT = null;

    public function medicine(): BelongsTo { return $this->belongsTo(Medicine::class); }
    public function user(): BelongsTo { return $this->belongsTo(User::class); }
}
