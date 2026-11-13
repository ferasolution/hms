<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Appointment extends Model
{
    use BelongsToTenant;

    // tenant_id is stamped by BelongsToTenant; controllers validate every field they pass in.
    protected $guarded = ['id', 'tenant_id'];

    protected function casts(): array
    {
        return ['scheduled_at' => 'datetime', 'checked_in_at' => 'datetime', 'duration_minutes' => 'integer', 'token_no' => 'integer'];
    }

    public const STATUSES = ['scheduled', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'];
    public const TYPES = ['consultation', 'follow_up', 'telemedicine', 'procedure'];

    public function patient(): BelongsTo { return $this->belongsTo(Patient::class); }
    public function doctor(): BelongsTo { return $this->belongsTo(User::class, 'doctor_id'); }
    public function department(): BelongsTo { return $this->belongsTo(Department::class); }
    public function encounter(): HasOne { return $this->hasOne(Encounter::class); }
}
