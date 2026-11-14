<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ErVisit extends Model
{
    use BelongsToTenant;

    protected $guarded = ['id', 'tenant_id'];

    protected $attributes = ['status' => 'waiting', 'arrival_mode' => 'walk_in', 'isolation' => false];

    protected function casts(): array
    {
        return ['arrived_at' => 'datetime', 'triaged_at' => 'datetime', 'disposed_at' => 'datetime', 'vitals' => 'array', 'isolation' => 'boolean', 'triage_level' => 'integer', 'pain_score' => 'integer'];
    }

    public function patient(): BelongsTo { return $this->belongsTo(Patient::class); }
    public function doctor(): BelongsTo { return $this->belongsTo(User::class, 'doctor_id'); }
    public function triager(): BelongsTo { return $this->belongsTo(User::class, 'triaged_by'); }
}
