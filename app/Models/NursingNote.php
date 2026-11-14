<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class NursingNote extends Model
{
    use BelongsToTenant;

    protected $guarded = ['id', 'tenant_id'];

    protected $attributes = ['type' => 'note'];

    protected function casts(): array
    {
        return ['assessment' => 'array'];
    }

    public function user(): BelongsTo { return $this->belongsTo(User::class); }
}
