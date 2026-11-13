<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Not tenant-scoped: platform-wide announcements have no tenant. Every query
 * filters by tenant explicitly (see AnnouncementController).
 */
class Announcement extends Model
{
    public const AUDIENCES = ['everyone', 'staff', 'doctors', 'nurses', 'patients', 'admins'];

    protected $fillable = ['audience', 'title', 'body', 'pinned'];

    protected function casts(): array
    {
        return ['pinned' => 'boolean'];
    }

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id')->withoutGlobalScope('tenant');
    }
}
