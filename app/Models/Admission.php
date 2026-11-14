<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Admission extends Model
{
    use BelongsToTenant;

    // tenant_id is stamped by BelongsToTenant; controllers validate every field they pass in.
    protected $guarded = ['id', 'tenant_id'];

    /** Same as the column defaults, so new models carry them before a refresh. */
    protected $attributes = ['status' => 'admitted'];

    protected function casts(): array
    {
        return ['admitted_at' => 'datetime', 'discharged_at' => 'datetime'];
    }

    public function patient(): BelongsTo { return $this->belongsTo(Patient::class); }
    public function bed(): BelongsTo { return $this->belongsTo(Bed::class); }
    public function doctor(): BelongsTo { return $this->belongsTo(User::class, 'doctor_id'); }
    public function encounters(): HasMany { return $this->hasMany(Encounter::class); }
    public function medicationOrders(): HasMany { return $this->hasMany(MedicationOrder::class); }
    public function nursingNotes(): HasMany { return $this->hasMany(NursingNote::class); }
}
