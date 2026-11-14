<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class MedicationOrder extends Model
{
    use BelongsToTenant;

    protected $guarded = ['id', 'tenant_id'];

    protected $attributes = ['status' => 'active', 'route' => 'oral'];

    protected function casts(): array
    {
        return ['times' => 'array', 'starts_at' => 'datetime', 'ends_at' => 'datetime'];
    }

    public const FREQUENCIES = [
        'OD' => ['08:00'], 'BD' => ['08:00', '20:00'], 'TDS' => ['08:00', '14:00', '20:00'], 'QID' => ['06:00', '12:00', '18:00', '22:00'],
        'Q6H' => ['00:00', '06:00', '12:00', '18:00'], 'Q8H' => ['06:00', '14:00', '22:00'], 'HS' => ['21:00'], 'PRN' => [], 'STAT' => [],
    ];

    public function patient(): BelongsTo { return $this->belongsTo(Patient::class); }
    public function admission(): BelongsTo { return $this->belongsTo(Admission::class); }
    public function prescriber(): BelongsTo { return $this->belongsTo(User::class, 'ordered_by'); }
    public function administrations(): HasMany { return $this->hasMany(MedicationAdministration::class); }
}
