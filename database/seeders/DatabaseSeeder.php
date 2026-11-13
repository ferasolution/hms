<?php

namespace Database\Seeders;

use App\Models\Plan;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Safe to run on production repeatedly: only creates/updates the plans.
     * Create the platform owner with: php artisan hms:super-admin
     */
    public function run(): void
    {
        $plans = [
            ['slug' => 'free', 'name' => 'Free', 'price_monthly' => 0, 'max_staff' => 5, 'max_beds' => 10, 'storage_mb' => 500],
            ['slug' => 'clinic', 'name' => 'Clinic', 'price_monthly' => 99, 'max_staff' => 25, 'max_beds' => 30, 'storage_mb' => 10240],
            ['slug' => 'hospital', 'name' => 'Hospital', 'price_monthly' => 249, 'max_staff' => 150, 'max_beds' => 200, 'storage_mb' => 51200],
            ['slug' => 'enterprise', 'name' => 'Enterprise', 'price_monthly' => 499, 'max_staff' => null, 'max_beds' => null, 'storage_mb' => 204800],
        ];

        foreach ($plans as $plan) {
            Plan::updateOrCreate(['slug' => $plan['slug']], $plan + ['currency' => 'USD', 'is_active' => true]);
        }
    }
}
