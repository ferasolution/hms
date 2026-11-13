<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BillingController;
use App\Http\Controllers\Api\Central\ConsoleController;
use App\Http\Controllers\Api\Central\PlatformController;
use App\Http\Controllers\Api\Hospital\AppointmentController;
use App\Http\Controllers\Api\Hospital\CommunityController;
use App\Http\Controllers\Api\Hospital\DashboardController;
use App\Http\Controllers\Api\Hospital\EncounterController;
use App\Http\Controllers\Api\Hospital\InpatientController;
use App\Http\Controllers\Api\Hospital\InvoiceController;
use App\Http\Controllers\Api\Hospital\LabController;
use App\Http\Controllers\Api\Hospital\PatientController;
use App\Http\Controllers\Api\Hospital\PharmacyController;
use App\Http\Controllers\Api\Hospital\PortalController;
use App\Http\Controllers\Api\Hospital\StaffController;
use App\Http\Controllers\Api\MetaController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Api\TenantRegistrationController;
use App\Http\Controllers\Api\UploadController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\DeployController;
use App\Http\Controllers\InstallController;
use Illuminate\Support\Facades\Route;

// First-run web installer (works only while the server has no .env). No
// throttle here: the cache table it would need does not exist yet.
Route::get('install', [InstallController::class, 'status']);
Route::post('install', [InstallController::class, 'install']);

// Post-deploy hook for FTP deploys (see DeployController). Needs DEPLOY_TOKEN.
Route::post('deploy-hook', DeployController::class);

/*
|--------------------------------------------------------------------------
| Central (platform) routes — no tenant
|--------------------------------------------------------------------------
*/
Route::get('plans', [MetaController::class, 'plans']);

Route::post('register-hospital', [TenantRegistrationController::class, 'store'])
    ->middleware('throttle:5,1');
Route::post('register-institute', [TenantRegistrationController::class, 'store'])
    ->middleware('throttle:5,1');

Route::prefix('platform')->group(function () {
    Route::get('setup', [PlatformController::class, 'setupStatus']);
    Route::post('setup', [PlatformController::class, 'setup'])->middleware('throttle:5,1');
    Route::post('login', [PlatformController::class, 'login'])->middleware('throttle:10,1');

    Route::middleware(['auth:sanctum', 'role:super_admin'])->group(function () {
        Route::get('me', [PlatformController::class, 'me']);
        Route::get('stats', [PlatformController::class, 'stats']);
        Route::get('overview', [ConsoleController::class, 'overview']);
        Route::get('tenants', [ConsoleController::class, 'tenants']);
        Route::get('tenants/{tenant}', [ConsoleController::class, 'tenant']);
        Route::patch('tenants/{tenant}', [ConsoleController::class, 'updateTenant']);
        Route::post('tenants/{tenant}/impersonate', [ConsoleController::class, 'impersonate']);
        Route::get('subscriptions', [ConsoleController::class, 'subscriptions']);
        Route::post('subscriptions/{subscription}/approve', [ConsoleController::class, 'approveSubscription']);
        Route::post('subscriptions/{subscription}/reject', [ConsoleController::class, 'rejectSubscription']);
        Route::get('payments', [ConsoleController::class, 'payments']);
        Route::get('users', [ConsoleController::class, 'users']);
        Route::post('users/{user}/reset-password', [ConsoleController::class, 'resetPassword']);
        Route::patch('users/{user}', [ConsoleController::class, 'updateUser']);
        Route::get('activity', [ConsoleController::class, 'activity']);
        Route::get('health', [ConsoleController::class, 'health']);
        Route::get('plans', [ConsoleController::class, 'plans']);
        Route::post('plans', [ConsoleController::class, 'createPlan']);
        Route::patch('plans/{plan}', [ConsoleController::class, 'updatePlan']);
        Route::get('announcements', [ConsoleController::class, 'announcements']);
        Route::post('announcements', [ConsoleController::class, 'broadcast']);
        Route::get('exports/institutes.csv', [ConsoleController::class, 'exportTenants']);
        Route::get('exports/users.csv', [ConsoleController::class, 'exportUsers']);
        Route::get('settings', [ConsoleController::class, 'settings']);
        Route::put('settings', [ConsoleController::class, 'updateSettings']);
    });
});

/*
|--------------------------------------------------------------------------
| Hospital routes — tenant resolved from subdomain, custom domain or X-Tenant
|--------------------------------------------------------------------------
| Roles: admin · doctor · nurse · receptionist · pharmacist · lab_technician · accountant · patient
*/
Route::middleware('tenant')->group(function () {
    Route::get('tenant', [MetaController::class, 'tenant']);
    Route::post('auth/login', [AuthController::class, 'login'])->middleware('throttle:10,1');

    Route::middleware(['auth:sanctum', 'role'])->group(function () {
        Route::get('auth/me', [AuthController::class, 'me']);
        Route::post('auth/logout', [AuthController::class, 'logout']);
        Route::patch('auth/me', [SettingsController::class, 'updateProfile']);
        Route::get('dashboard', DashboardController::class);

        Route::get('notifications', [CommunityController::class, 'notifications']);
        Route::post('notifications/read', [CommunityController::class, 'readNotifications']);
        Route::get('announcements', [CommunityController::class, 'announcements']);
        Route::post('announcements', [CommunityController::class, 'storeAnnouncement'])->middleware('role:admin');
        Route::delete('announcements/{announcement}', [CommunityController::class, 'destroyAnnouncement']);
        Route::get('search', [CommunityController::class, 'search'])->middleware('throttle:60,1');
        Route::post('uploads', [UploadController::class, 'store'])->middleware('throttle:20,1');

        // Directory used for booking (patients too).
        Route::get('departments', [StaffController::class, 'departments']);
        Route::get('doctors', [StaffController::class, 'doctors']);
        Route::get('appointments/slots', [AppointmentController::class, 'slots'])->middleware('module:appointments');

        // Patient portal
        Route::middleware(['role:patient', 'module:portal'])->prefix('portal')->group(function () {
            Route::get('/', [PortalController::class, 'show']);
            Route::post('appointments', [PortalController::class, 'book'])->middleware(['throttle:10,1', 'module:appointments']);
            Route::post('appointments/{appointment}/cancel', [PortalController::class, 'cancel']);
        });

        // Everyone who works at the hospital
        Route::middleware('role:admin,doctor,nurse,receptionist,pharmacist,lab_technician,accountant')->group(function () {
            Route::get('patients', [PatientController::class, 'index']);
            Route::get('patients/{patient}', [PatientController::class, 'show']);
            Route::get('staff', [StaffController::class, 'staff']);
            Route::patch('staff/{user}/profile', [StaffController::class, 'updateProfile']);
            Route::get('roster', [StaffController::class, 'roster'])->middleware('module:roster');
            Route::get('lab/tests', [LabController::class, 'tests']);
            Route::get('pharmacy/medicines', [PharmacyController::class, 'medicines'])->middleware('module:pharmacy');
        });

        // Clinical and front desk
        Route::middleware('role:admin,doctor,nurse,receptionist')->group(function () {
            Route::post('patients', [PatientController::class, 'store']);
            Route::patch('patients/{patient}', [PatientController::class, 'update']);

            Route::middleware('module:appointments')->group(function () {
                Route::get('appointments', [AppointmentController::class, 'index']);
                Route::post('appointments', [AppointmentController::class, 'store']);
                Route::patch('appointments/{appointment}', [AppointmentController::class, 'update']);
            });

            Route::middleware('module:ipd')->group(function () {
                Route::get('ipd/board', [InpatientController::class, 'board']);
                Route::get('admissions', [InpatientController::class, 'admissions']);
                Route::get('admissions/{admission}', [InpatientController::class, 'show']);
                Route::post('admissions', [InpatientController::class, 'admit']);
                Route::post('admissions/{admission}/transfer', [InpatientController::class, 'transfer']);
                Route::post('admissions/{admission}/discharge', [InpatientController::class, 'discharge']);
                Route::patch('beds/{bed}', [InpatientController::class, 'updateBed']);
            });
        });

        Route::middleware('role:admin,receptionist')->group(function () {
            Route::post('patients/{patient}/portal', [PatientController::class, 'portal'])->middleware('module:portal');
        });

        // Doctors and nurses: clinical notes
        Route::middleware(['role:admin,doctor,nurse', 'module:opd'])->group(function () {
            Route::post('encounters', [EncounterController::class, 'store']);
            Route::get('encounters/{encounter}', [EncounterController::class, 'show']);
            Route::patch('encounters/{encounter}', [EncounterController::class, 'update']);
        });

        // Laboratory and radiology
        Route::middleware('module:lab')->group(function () {
            Route::middleware('role:admin,doctor,lab_technician,receptionist,nurse')->group(function () {
                Route::get('lab/orders', [LabController::class, 'orders']);
                Route::get('lab/orders/{order}', [LabController::class, 'show']);
                Route::post('lab/orders', [LabController::class, 'store']);
            });
            Route::middleware('role:admin,lab_technician')->group(function () {
                Route::post('lab/tests', [LabController::class, 'storeTest']);
                Route::patch('lab/tests/{test}', [LabController::class, 'updateTest']);
                Route::post('lab/orders/{order}/collect', [LabController::class, 'collect']);
                Route::post('lab/orders/{order}/report', [LabController::class, 'report']);
                Route::post('lab/orders/{order}/cancel', [LabController::class, 'cancel']);
            });
        });

        // Pharmacy
        Route::middleware(['role:admin,pharmacist', 'module:pharmacy'])->prefix('pharmacy')->group(function () {
            Route::post('medicines', [PharmacyController::class, 'storeMedicine']);
            Route::patch('medicines/{medicine}', [PharmacyController::class, 'updateMedicine']);
            Route::post('medicines/{medicine}/adjust', [PharmacyController::class, 'adjust']);
            Route::get('medicines/{medicine}/movements', [PharmacyController::class, 'movements']);
            Route::get('prescriptions', [PharmacyController::class, 'prescriptions']);
            Route::post('prescriptions/{prescription}/dispense', [PharmacyController::class, 'dispense']);
            Route::post('prescriptions/{prescription}/cancel', [PharmacyController::class, 'cancel']);
            Route::get('exports/medicines.csv', [PharmacyController::class, 'export']);
        });

        // Billing
        Route::middleware(['role:admin,accountant,receptionist', 'module:billing'])->group(function () {
            Route::get('invoices', [InvoiceController::class, 'index']);
            Route::get('invoices/summary', [InvoiceController::class, 'summary']);
            Route::get('invoices/payments', [InvoiceController::class, 'payments']);
            Route::post('invoices', [InvoiceController::class, 'store']);
            Route::get('invoices/{invoice}', [InvoiceController::class, 'show']);
            Route::patch('invoices/{invoice}', [InvoiceController::class, 'update']);
            Route::post('invoices/{invoice}/payments', [InvoiceController::class, 'pay']);
        });
        Route::middleware(['role:admin,accountant', 'module:billing'])->group(function () {
            Route::delete('invoices/{invoice}/payments/{payment}', [InvoiceController::class, 'destroyPayment']);
            Route::get('exports/invoices.csv', [InvoiceController::class, 'export']);
            Route::middleware('module:insurance')->group(function () {
                Route::get('claims', [InvoiceController::class, 'claims']);
                Route::post('claims', [InvoiceController::class, 'storeClaim']);
                Route::patch('claims/{claim}', [InvoiceController::class, 'updateClaim']);
            });
        });

        // Hospital administration
        Route::middleware('role:admin')->group(function () {
            Route::get('users', [UserController::class, 'index']);
            Route::post('users', [UserController::class, 'store']);
            Route::patch('users/{user}', [UserController::class, 'update']);
            Route::patch('settings', [SettingsController::class, 'update']);
            Route::put('modules', [CommunityController::class, 'modules']);
            Route::get('audit', [CommunityController::class, 'audit']);
            Route::get('exports/patients.csv', [PatientController::class, 'export']);

            Route::post('departments', [StaffController::class, 'storeDepartment']);
            Route::patch('departments/{department}', [StaffController::class, 'updateDepartment']);
            Route::delete('departments/{department}', [StaffController::class, 'destroyDepartment']);
            Route::post('roster', [StaffController::class, 'storeShift'])->middleware('module:roster');
            Route::delete('roster/{shift}', [StaffController::class, 'destroyShift'])->middleware('module:roster');

            Route::middleware('module:ipd')->group(function () {
                Route::post('wards', [InpatientController::class, 'storeWard']);
                Route::patch('wards/{ward}', [InpatientController::class, 'updateWard']);
                Route::delete('wards/{ward}', [InpatientController::class, 'destroyWard']);
                Route::post('wards/{ward}/beds', [InpatientController::class, 'storeBeds']);
                Route::delete('beds/{bed}', [InpatientController::class, 'destroyBed']);
            });

            Route::get('billing', [BillingController::class, 'show']);
            Route::post('billing/subscribe', [BillingController::class, 'subscribe'])->middleware('throttle:10,1');
        });
    });
});
