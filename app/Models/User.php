<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use BelongsToTenant, HasApiTokens, HasFactory, Notifiable;

    public const ROLE_SUPER_ADMIN = 'super_admin';
    public const ROLE_ADMIN = 'admin';
    public const ROLE_DOCTOR = 'doctor';
    public const ROLE_NURSE = 'nurse';
    public const ROLE_RECEPTIONIST = 'receptionist';
    public const ROLE_PHARMACIST = 'pharmacist';
    public const ROLE_LAB = 'lab_technician';
    public const ROLE_ACCOUNTANT = 'accountant';
    public const ROLE_PATIENT = 'patient';

    /** Roles a hospital admin is allowed to assign. */
    public const TENANT_ROLES = [
        self::ROLE_ADMIN, self::ROLE_DOCTOR, self::ROLE_NURSE, self::ROLE_RECEPTIONIST,
        self::ROLE_PHARMACIST, self::ROLE_LAB, self::ROLE_ACCOUNTANT, self::ROLE_PATIENT,
    ];

    /** Everyone who works at the hospital (counts toward the plan's staff limit). */
    public const STAFF_ROLES = [
        self::ROLE_ADMIN, self::ROLE_DOCTOR, self::ROLE_NURSE, self::ROLE_RECEPTIONIST,
        self::ROLE_PHARMACIST, self::ROLE_LAB, self::ROLE_ACCOUNTANT,
    ];

    // tenant_id and role are set explicitly in code, never mass-assigned from requests.
    protected $fillable = ['name', 'email', 'password', 'phone', 'avatar'];

    protected $hidden = ['password', 'remember_token'];

    protected $attributes = [
        'role' => self::ROLE_PATIENT,
        'is_active' => true,
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'last_login_at' => 'datetime',
            'password' => 'hashed',
            'is_active' => 'boolean',
        ];
    }

    public function isSuperAdmin(): bool
    {
        return $this->role === self::ROLE_SUPER_ADMIN && is_null($this->tenant_id);
    }

    public function hasRole(string ...$roles): bool
    {
        return in_array($this->role, $roles, true);
    }

    public function isStaff(): bool
    {
        return in_array($this->role, self::STAFF_ROLES, true);
    }

    public function staffProfile(): HasOne
    {
        return $this->hasOne(StaffProfile::class);
    }

    /** The patient record linked to a patient-portal account. */
    public function patient(): HasOne
    {
        return $this->hasOne(Patient::class);
    }
}
