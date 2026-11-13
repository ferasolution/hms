<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class LabOrderItem extends Model
{
    // tenant_id is stamped by BelongsToTenant; controllers validate every field they pass in.
    protected $guarded = ['id', 'tenant_id'];

    protected function casts(): array
    {
        return ['reported_at' => 'datetime'];
    }

    public $timestamps = false;

    public function order(): BelongsTo { return $this->belongsTo(LabOrder::class, 'lab_order_id'); }
    public function test(): BelongsTo { return $this->belongsTo(LabTest::class, 'lab_test_id'); }
    public function reporter(): BelongsTo { return $this->belongsTo(User::class, 'reported_by'); }
}
