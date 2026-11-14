<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Attendance extends Model
{
    use BelongsToTenant;

    protected $guarded = ['id', 'tenant_id'];

    protected $attributes = ['status' => 'present'];

    protected function casts(): array
    {
        return ['date' => 'date:Y-m-d', 'check_in' => 'datetime', 'check_out' => 'datetime'];
    }

    public function user(): BelongsTo { return $this->belongsTo(User::class); }
}
