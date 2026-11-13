<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PatientDocument extends Model
{
    use BelongsToTenant;

    protected $guarded = ['id', 'tenant_id'];

    protected $attributes = ['category' => 'other'];

    protected function casts(): array
    {
        return ['document_date' => 'date:Y-m-d'];
    }

    public function uploader(): BelongsTo { return $this->belongsTo(User::class, 'uploaded_by'); }
}
