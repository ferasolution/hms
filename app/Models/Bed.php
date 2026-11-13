<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Bed extends Model
{
    use BelongsToTenant;

    // tenant_id is stamped by BelongsToTenant; controllers validate every field they pass in.
    protected $guarded = ['id', 'tenant_id'];

    /** Same as the column defaults, so new models carry them before a refresh. */
    protected $attributes = ['status' => 'available'];

    public const STATUSES = ['available', 'occupied', 'cleaning', 'maintenance'];

    public function ward(): BelongsTo { return $this->belongsTo(Ward::class); }
    public function currentAdmission(): HasOne { return $this->hasOne(Admission::class)->where('status', 'admitted'); }
}
