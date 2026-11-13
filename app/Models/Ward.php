<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Ward extends Model
{
    use BelongsToTenant;

    // tenant_id is stamped by BelongsToTenant; controllers validate every field they pass in.
    protected $guarded = ['id', 'tenant_id'];

    protected function casts(): array
    {
        return ['daily_rate' => 'decimal:2'];
    }

    public const TYPES = ['general', 'private', 'semi_private', 'icu', 'emergency', 'maternity', 'pediatric'];

    public function beds(): HasMany { return $this->hasMany(Bed::class); }
}
