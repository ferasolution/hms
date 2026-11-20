<?php

namespace App\Console\Commands;

use App\Services\DemoHospital;
use Illuminate\Console\Command;

class BuildDemo extends Command
{
    protected $signature = 'hms:demo {--remove : Delete the demo hospital instead of rebuilding it}';

    protected $description = 'Build (or reset) the public demo hospital with sample data and one sign-in per role';

    public function handle(DemoHospital $demo): int
    {
        if ($this->option('remove')) {
            $demo->wipe();
            $this->info('Demo hospital removed.');

            return self::SUCCESS;
        }

        $started = microtime(true);
        $tenant = $demo->rebuild();
        $this->info(sprintf('Demo hospital “%s” (/%s) ready in %.1fs. Password for every account: %s', $tenant->name, $tenant->slug, microtime(true) - $started, DemoHospital::PASSWORD));
        foreach (array_keys(DemoHospital::ACCOUNTS) as $role) {
            $this->line(str_pad($role, 16).DemoHospital::email($role));
        }

        return self::SUCCESS;
    }
}
