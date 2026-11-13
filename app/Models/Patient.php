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

    protected function casts(): array
    {
        return ['date_of_birth' => 'date', 'is_active' => 'boolean'];
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
}
