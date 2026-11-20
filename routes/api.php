<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BillingController;
use App\Http\Controllers\Api\Central\ConsoleController;
use App\Http\Controllers\Api\Central\PlatformController;
use App\Http\Controllers\Api\Hospital\AppointmentController;
use App\Http\Controllers\Api\Hospital\CommunityController;
use App\Http\Controllers\Api\Hospital\DashboardController;
use App\Http\Controllers\Api\Hospital\EncounterController;
use App\Http\Controllers\Api\Hospital\EhrController;
use App\Http\Controllers\Api\Hospital\EmergencyController;
use App\Http\Controllers\Api\Hospital\FinanceController;
use App\Http\Controllers\Api\Hospital\HrController;
use App\Http\Controllers\Api\Hospital\NursingController;
use App\Http\Controllers\Api\Hospital\ReportsController;
use App\Http\Controllers\Api\Hospital\StoreController;
use App\Http\Controllers\Api\Hospital\InpatientController;
use App\Http\Controllers\Api\Hospital\InsuranceController;
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
Route::get('demo', [\App\Http\Controllers\Api\DemoController::class, 'show']);

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
Route::middleware(['tenant', 'demo'])->group(function () {
    Route::get('tenant', [MetaController::class, 'tenant']);
    Route::post('auth/login', [AuthController::class, 'login'])->middleware('throttle:10,1');
    Route::post('demo/login', [\App\Http\Controllers\Api\DemoController::class, 'login'])->middleware('throttle:20,1');

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
        Route::middleware('role:admin,doctor,nurse,receptionist,pharmacist,lab_technician,accountant,storekeeper,hr_manager')->group(function () {
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

        // Health record (EHR). Writes are checked per section in EhrController.
        Route::middleware('role:admin,doctor,nurse,receptionist,pharmacist,lab_technician,accountant,storekeeper,hr_manager')->group(function () {
            Route::get('patients/{patient}/ehr', [EhrController::class, 'show']);
            Route::post('patients/{patient}/ehr/{type}', [EhrController::class, 'store'])->whereIn('type', ['problems', 'allergies', 'medications', 'immunizations', 'documents']);
            Route::patch('ehr/{type}/{id}', [EhrController::class, 'update'])->whereIn('type', ['problems', 'allergies', 'medications', 'immunizations', 'documents'])->whereNumber('id');
            Route::delete('ehr/{type}/{id}', [EhrController::class, 'destroy'])->whereIn('type', ['problems', 'allergies', 'medications', 'immunizations', 'documents'])->whereNumber('id');
            Route::put('patients/{patient}/history', [EhrController::class, 'saveHistory']);
            Route::get('patients/{patient}/access-log', [EhrController::class, 'accessLog'])->middleware('role:admin');
        });

        // Insurance: front desk records policies and asks for pre-authorization; accounts handle claims.
        Route::middleware('module:insurance')->group(function () {
            Route::middleware('role:admin,accountant,receptionist,doctor,nurse')->group(function () {
                Route::get('insurance/providers', [InsuranceController::class, 'providers']);
                Route::get('patients/{patient}/policies', [InsuranceController::class, 'policies']);
                Route::get('pre-authorizations', [InsuranceController::class, 'preAuthorizations']);
                Route::post('pre-authorizations', [InsuranceController::class, 'storePreAuthorization']);
            });
            Route::middleware('role:admin,accountant,receptionist')->group(function () {
                Route::post('patients/{patient}/policies', [InsuranceController::class, 'storePolicy']);
                Route::patch('policies/{policy}', [InsuranceController::class, 'updatePolicy']);
                Route::get('invoices/{invoice}/coverage', [InsuranceController::class, 'coverage'])->middleware('module:billing');
            });
            Route::middleware('role:admin,accountant')->group(function () {
                Route::post('insurance/providers', [InsuranceController::class, 'storeProvider']);
                Route::patch('insurance/providers/{provider}', [InsuranceController::class, 'updateProvider']);
                Route::patch('pre-authorizations/{preAuthorization}', [InsuranceController::class, 'updatePreAuthorization']);
                Route::get('claims', [InsuranceController::class, 'claims']);
                Route::post('claims', [InsuranceController::class, 'storeClaim']);
                Route::patch('claims/{claim}', [InsuranceController::class, 'updateClaim']);
                Route::get('insurance/aging', [InsuranceController::class, 'aging']);
                Route::get('exports/claims.csv', [InsuranceController::class, 'exportClaims']);
            });
        });

        // Emergency department and ambulance (blueprint §5)
        Route::middleware(['role:admin,doctor,nurse,receptionist', 'module:emergency'])->prefix('emergency')->group(function () {
            Route::get('board', [EmergencyController::class, 'board']);
            Route::get('history', [EmergencyController::class, 'history']);
            Route::post('visits', [EmergencyController::class, 'store']);
            Route::post('visits/{visit}/triage', [EmergencyController::class, 'triage'])->middleware('role:admin,doctor,nurse');
            Route::patch('visits/{visit}', [EmergencyController::class, 'update']);
            Route::post('visits/{visit}/dispose', [EmergencyController::class, 'dispose'])->middleware('role:admin,doctor');
            Route::get('ambulances', [EmergencyController::class, 'ambulances']);
            Route::post('ambulances', [EmergencyController::class, 'storeAmbulance'])->middleware('role:admin');
            Route::patch('ambulances/{ambulance}', [EmergencyController::class, 'updateAmbulance']);
            Route::post('trips', [EmergencyController::class, 'storeTrip']);
            Route::patch('trips/{trip}', [EmergencyController::class, 'updateTrip']);
        });

        // Ward nursing: eMAR, notes, fluid balance (blueprint §6.2)
        Route::middleware(['role:admin,doctor,nurse', 'module:nursing'])->group(function () {
            Route::get('nursing/due', [NursingController::class, 'due']);
            Route::get('admissions/{admission}/nursing', [NursingController::class, 'show']);
            Route::post('admissions/{admission}/medication-orders', [NursingController::class, 'storeOrder'])->middleware('role:admin,doctor');
            Route::post('medication-orders/{order}/stop', [NursingController::class, 'stopOrder'])->middleware('role:admin,doctor');
            Route::post('medication-orders/{order}/administer', [NursingController::class, 'administer']);
            Route::post('admissions/{admission}/nursing-notes', [NursingController::class, 'storeNote']);
            Route::post('admissions/{admission}/fluids', [NursingController::class, 'storeFluid']);
        });

        // Service price list (everyone on staff can see it; admin/accounts change it)
        Route::middleware('role:admin,doctor,nurse,receptionist,pharmacist,lab_technician,accountant,storekeeper,hr_manager')->get('services', [StoreController::class, 'services']);
        Route::middleware('role:admin,accountant')->group(function () {
            Route::post('services', [StoreController::class, 'storeService']);
            Route::patch('services/{service}', [StoreController::class, 'updateService']);
        });
        Route::post('patients/{patient}/charges', [InvoiceController::class, 'chargeService'])->middleware(['role:admin,receptionist,accountant,doctor,nurse', 'module:billing']);

        // Store & procurement (blueprint §8.3, §17.2). Orders need a second person to approve.
        Route::middleware(['role:admin,storekeeper,pharmacist,accountant', 'module:inventory'])->prefix('store')->group(function () {
            Route::get('suppliers', [StoreController::class, 'suppliers']);
            Route::get('items', [StoreController::class, 'items']);
            Route::get('items/{item}/movements', [StoreController::class, 'movements']);
            Route::get('orders', [StoreController::class, 'orders']);
            Route::get('exports/items.csv', [StoreController::class, 'exportItems']);
            Route::middleware('role:admin,storekeeper,pharmacist')->group(function () {
                Route::post('suppliers', [StoreController::class, 'storeSupplier']);
                Route::patch('suppliers/{supplier}', [StoreController::class, 'updateSupplier']);
                Route::post('items', [StoreController::class, 'storeItem']);
                Route::patch('items/{item}', [StoreController::class, 'updateItem']);
                Route::post('items/{item}/move', [StoreController::class, 'moveItem']);
                Route::post('orders', [StoreController::class, 'storeOrder']);
                Route::post('orders/{order}/receive', [StoreController::class, 'receiveOrder']);
            });
            Route::middleware('role:admin,accountant')->group(function () {
                Route::post('orders/{order}/approve', [StoreController::class, 'approveOrder']);
                Route::post('orders/{order}/cancel', [StoreController::class, 'cancelOrder']);
            });
        });

        // HR: everyone requests leave and clocks in; HR/admin decide (blueprint §19)
        Route::middleware(['role:admin,doctor,nurse,receptionist,pharmacist,lab_technician,accountant,storekeeper,hr_manager', 'module:hr'])->prefix('hr')->group(function () {
            Route::get('leave', [HrController::class, 'leave']);
            Route::post('leave', [HrController::class, 'requestLeave']);
            Route::patch('leave/{leave}', [HrController::class, 'decideLeave']);
            Route::get('attendance/me', [HrController::class, 'me']);
            Route::post('attendance/clock', [HrController::class, 'clock']);
            Route::middleware('role:admin,hr_manager')->group(function () {
                Route::get('attendance', [HrController::class, 'board']);
                Route::get('exports/attendance.csv', [HrController::class, 'export']);
                Route::patch('staff/{user}/employment', [HrController::class, 'updateEmployment']);
            });
        });

        // Finance (blueprint §17)
        Route::middleware(['role:admin,accountant', 'module:finance'])->prefix('finance')->group(function () {
            Route::get('expenses', [FinanceController::class, 'expenses']);
            Route::post('expenses', [FinanceController::class, 'storeExpense']);
            Route::patch('expenses/{expense}', [FinanceController::class, 'updateExpense']);
            Route::get('summary', [FinanceController::class, 'summary']);
            Route::get('exports/expenses.csv', [FinanceController::class, 'export']);
        });

        // Reports (blueprint §27)
        Route::get('reports/{section?}', ReportsController::class)->middleware(['role:admin,accountant', 'module:reports'])
            ->whereIn('section', ['overview', 'opd', 'inpatients', 'emergency', 'lab', 'pharmacy', 'revenue', 'diagnoses']);

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
