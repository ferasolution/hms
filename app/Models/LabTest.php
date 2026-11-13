<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class LabTest extends Model
{
    use BelongsToTenant;

    // tenant_id is stamped by BelongsToTenant; controllers validate every field they pass in.
    protected $guarded = ['id', 'tenant_id'];

    /** Same as the column defaults, so new models carry them before a refresh. */
    protected $attributes = ['is_active' => true, 'category' => 'lab', 'price' => 0];

    protected function casts(): array
    {
        return ['price' => 'decimal:2', 'is_active' => 'boolean'];
    }

}
