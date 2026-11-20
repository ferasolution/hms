<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Reset the public demo hospital every night (needs the Laravel scheduler cron on the server).
Schedule::command('hms:demo')->dailyAt('04:00')->when(fn () => config('app.demo_enabled', true));
