<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ChartAccessLog extends Model
{
    use BelongsToTenant;

    protected $guarded = ['id', 'tenant_id'];

    protected $attributes = ['action' => 'viewed'];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }

    public const UPDATED_AT = null;

    public function user(): BelongsTo { return $this->belongsTo(User::class); }
}
