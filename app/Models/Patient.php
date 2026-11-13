<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Patient extends Model
{
    use BelongsToTenant;

    // tenant_id is stamped by BelongsToTenant; controllers validate every field they pass in.
    protected $guarded = ['id', 'tenant_id'];

    /** Same as the column defaults, so new models carry them before a refresh. */
    protected $attributes = ['is_active' => true];

    protected function casts(): array
    {
        return ['date_of_birth' => 'date:Y-m-d', 'is_active' => 'boolean'];
    }

    protected $appends = ['name', 'age'];

    public function getNameAttribute(): string { return trim($this->first_name.' '.$this->last_name); }
    public function getAgeAttribute(): ?int { return $this->date_of_birth?->age; }
    public function user(): BelongsTo { return $this->belongsTo(User::class); }
    public function appointments(): HasMany { return $this->hasMany(Appointment::class); }
    public function encounters(): HasMany { return $this->hasMany(Encounter::class); }
    public function admissions(): HasMany { return $this->hasMany(Admission::class); }
    public function prescriptions(): HasMany { return $this->hasMany(Prescription::class); }
    public function labOrders(): HasMany { return $this->hasMany(LabOrder::class); }
    public function invoices(): HasMany { return $this->hasMany(Invoice::class); }
    public function policies(): HasMany { return $this->hasMany(PatientPolicy::class); }

    /** The policy bills are claimed against: primary first, then any valid one. */
    public function activePolicy(): ?PatientPolicy
    {
        return $this->policies()->with('provider')->where('status', 'active')->orderByDesc('is_primary')->latest('id')->get()
            ->first(fn (PatientPolicy $p) => $p->isValid());
    }
}
