<?php

namespace App\Services;

use App\Models\Admission;
use App\Models\Ambulance;
use App\Models\AmbulanceTrip;
use App\Models\Appointment;
use App\Models\Attendance;
use App\Models\Bed;
use App\Models\Department;
use App\Models\DutyShift;
use App\Models\Encounter;
use App\Models\ErVisit;
use App\Models\Expense;
use App\Models\FluidEntry;
use App\Models\Immunization;
use App\Models\InsuranceClaim;
use App\Models\InsuranceProvider;
use App\Models\InventoryItem;
use App\Models\InventoryMovement;
use App\Models\Invoice;
use App\Models\InvoicePayment;
use App\Models\LabOrder;
use App\Models\LabTest;
use App\Models\LeaveRequest;
use App\Models\MedicationAdministration;
use App\Models\MedicationOrder;
use App\Models\Medicine;
use App\Models\NursingNote;
use App\Models\Patient;
use App\Models\PatientAllergy;
use App\Models\PatientHistory;
use App\Models\PatientMedication;
use App\Models\PatientPolicy;
use App\Models\PatientProblem;
use App\Models\Plan;
use App\Models\PreAuthorization;
use App\Models\Prescription;
use App\Models\PurchaseOrder;
use App\Models\StaffProfile;
use App\Models\StockMovement;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Ward;
use App\Tenancy\TenantManager;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Builds (or rebuilds) the public demo hospital: one account per role and a
 * few months of realistic, made-up activity so every screen has something on it.
 *
 * Every sign-in uses DemoHospital::PASSWORD. Patients and staff are fictional.
 */
class DemoHospital
{
    public const SLUG = 'demo';

    public const PASSWORD = 'demo1234';

    public const DOMAIN = 'hospitalos.demo';

    public const TIMEZONE = 'America/New_York';

    /** The accounts shown on the "Try the demo" panel, one per role. */
    public const ACCOUNTS = [
        'admin' => ['Olivia Bennett', 'admin'],
        'doctor' => ['Dr. Sarah Mitchell', 'doctor'],
        'nurse' => ['Grace Lee', 'nurse'],
        'receptionist' => ['Chloe Adams', 'reception'],
        'pharmacist' => ['Ryan Patel', 'pharmacy'],
        'lab_technician' => ['Sofia Martinez', 'lab'],
        'accountant' => ['Rachel Diaz', 'accounts'],
        'storekeeper' => ['Jason Park', 'store'],
        'hr_manager' => ['Laura Kim', 'hr'],
        'patient' => ['Ava Brooks', 'patient'],
    ];

    protected Tenant $tenant;

    /** @var array<string, User> */
    protected array $u = [];

    /** @var array<int, User> */
    protected array $doctors = [];

    /** @var array<int, User> */
    protected array $nurses = [];

    /** @var array<string, Department> */
    protected array $dept = [];

    /** @var array<int, Patient> */
    protected array $patients = [];

    protected Carbon $now;

    protected int $seq = 0;

    public function __construct(protected TenantManager $tenants, protected Hospital $hospital) {}

    public static function email(string $role): string
    {
        return self::ACCOUNTS[$role][1].'@'.self::DOMAIN;
    }

    public static function tenant(): ?Tenant
    {
        return Tenant::where('slug', self::SLUG)->first();
    }

    public static function isDemo(?Tenant $tenant): bool
    {
        return $tenant !== null && (bool) data_get($tenant->settings, 'demo');
    }

    /** Wipes the demo hospital (if any) and builds a fresh one. */
    public function rebuild(): Tenant
    {
        $this->wipe();

        $previousTz = date_default_timezone_get();
        date_default_timezone_set(self::TIMEZONE);
        config(['app.timezone' => self::TIMEZONE]);
        mt_srand(2026);

        try {
            $this->now = Carbon::now();
            $this->tenant = Tenant::create([
                'name' => 'Mercy General Hospital',
                'slug' => self::SLUG,
                'type' => 'hospital',
                'plan_id' => Plan::where('slug', 'hospital')->value('id') ?? Plan::value('id'),
                'status' => Tenant::STATUS_ACTIVE,
                'plan_ends_at' => $this->now->copy()->addYears(10),
                'settings' => [
                    'demo' => true,
                    'timezone' => self::TIMEZONE,
                    'currency' => 'USD',
                    'tagline' => 'Caring for Riverside since 1962',
                    'phone' => '(555) 010-2000',
                    'address' => '1200 Riverside Avenue, Springfield, VA',
                ],
            ]);

            $this->hospital->seedDefaults($this->tenant);
            $this->tenants->runAs($this->tenant, function () {
                DB::transaction(function () {
                    $this->staff();
                    $this->patientsAndRecords();
                    $this->stock();
                    $this->history();
                    $this->today();
                    $this->inpatients();
                    $this->emergency();
                    $this->insurance();
                    $this->store();
                    $this->people();
                    $this->money();
                });
            });
        } finally {
            date_default_timezone_set($previousTz);
            config(['app.timezone' => $previousTz]);
        }

        return $this->tenant;
    }

    /** Deletes every row belonging to the demo hospital. */
    public function wipe(): void
    {
        $tenant = self::tenant();
        if (! $tenant) {
            return;
        }

        Schema::disableForeignKeyConstraints();
        try {
            $children = [
                'prescription_items' => ['prescription_id', 'prescriptions'],
                'lab_order_items' => ['lab_order_id', 'lab_orders'],
                'invoice_items' => ['invoice_id', 'invoices'],
                'purchase_order_items' => ['purchase_order_id', 'purchase_orders'],
            ];
            foreach ($children as $table => [$fk, $parent]) {
                if (Schema::hasTable($table)) {
                    DB::table($table)->whereIn($fk, DB::table($parent)->where('tenant_id', $tenant->id)->select('id'))->delete();
                }
            }
            DB::table('personal_access_tokens')->where('tokenable_type', (new User)->getMorphClass())
                ->whereIn('tokenable_id', DB::table('users')->where('tenant_id', $tenant->id)->select('id'))->delete();

            foreach (Schema::getTableListing() as $table) {
                $table = str_contains($table, '.') ? substr($table, strrpos($table, '.') + 1) : $table;
                if (! in_array($table, ['tenants', 'users'], true) && Schema::hasColumn($table, 'tenant_id')) {
                    DB::table($table)->where('tenant_id', $tenant->id)->delete();
                }
            }
            DB::table('users')->where('tenant_id', $tenant->id)->delete();
            DB::table('tenants')->where('id', $tenant->id)->delete();
        } finally {
            Schema::enableForeignKeyConstraints();
        }
    }

    // ------------------------------------------------------------------ helpers

    protected function pick(array $items): mixed
    {
        return $items[mt_rand(0, count($items) - 1)];
    }

    protected function chance(int $percent): bool
    {
        return mt_rand(1, 100) <= $percent;
    }

    protected function at(Carbon $day, string $time): Carbon
    {
        [$h, $m] = explode(':', $time);

        return $day->copy()->setTime((int) $h, (int) $m);
    }

    protected function user(string $role, string $name, string $email, array $profile = []): User
    {
        $user = new User(['name' => $name, 'email' => $email, 'password' => self::PASSWORD]);
        $user->tenant_id = $this->tenant->id;
        $user->role = $role;
        $user->is_active = true;
        $user->email_verified_at = $this->now;
        $user->save();

        if ($role !== User::ROLE_PATIENT) {
            $this->seq++;
            StaffProfile::create($profile + [
                'user_id' => $user->id,
                'employee_no' => 'EMP-'.str_pad((string) (1000 + $this->seq), 4, '0', STR_PAD_LEFT),
                'joined_on' => $this->now->copy()->subMonths(mt_rand(4, 90))->toDateString(),
                'employment_type' => 'full_time',
                'annual_leave_days' => 20,
            ]);
        }

        return $user;
    }

    /** Creates an invoice dated $when with the given lines and payments. */
    protected function bill(Patient $patient, Carbon $when, array $lines, float $paidShare, ?Admission $admission = null, string $method = 'card', ?Carbon $paidAt = null): Invoice
    {
        $invoice = Invoice::create([
            'patient_id' => $patient->id, 'admission_id' => $admission?->id,
            'number' => 'INV-'.$when->format('ym').'-'.str_pad((string) (Invoice::where('number', 'like', 'INV-'.$when->format('ym').'-%')->count() + 1), 4, '0', STR_PAD_LEFT),
            'currency' => 'USD', 'created_by' => $this->u['receptionist']->id, 'due_on' => $when->copy()->addDays(30)->toDateString(),
            'created_at' => $when, 'updated_at' => $when,
        ]);
        foreach ($lines as [$category, $description, $price, $qty]) {
            $invoice->items()->create(['category' => $category, 'description' => $description, 'quantity' => $qty, 'unit_price' => $price, 'amount' => round($price * $qty, 2)]);
        }
        $this->hospital->recalculate($invoice);
        $invoice->refresh();
        if ($paidShare > 0) {
            InvoicePayment::create([
                'invoice_id' => $invoice->id, 'amount' => round((float) $invoice->total * $paidShare, 2), 'method' => $method,
                'reference' => $method === 'cash' ? null : 'TX-'.mt_rand(100000, 999999),
                'received_by' => $this->u['receptionist']->id, 'paid_at' => $paidAt ?? $when->copy()->addMinutes(mt_rand(10, 90)),
            ]);
            $this->hospital->recalculate($invoice);
        }

        return $invoice->refresh();
    }

    // ------------------------------------------------------------------ builders

    protected function staff(): void
    {
        $this->dept = Department::all()->keyBy('code')->all();

        $this->u['admin'] = $this->user('admin', 'Olivia Bennett', self::email('admin'), ['qualification' => 'MHA']);

        foreach ([
            ['doctor', 'Dr. Sarah Mitchell', 'CAR', 'Cardiology', 'MD, FACC', 250],
            ['daniel.reyes', 'Dr. Daniel Reyes', 'MED', 'Internal Medicine', 'MD', 150],
            ['priya.nair', 'Dr. Priya Nair', 'PED', 'Pediatrics', 'MD, FAAP', 160],
            ['james.carter', 'Dr. James Carter', 'ORT', 'Orthopedic Surgery', 'MD', 220],
            ['emily.watson', 'Dr. Emily Watson', 'ER', 'Emergency Medicine', 'MD, FACEP', 200],
            ['michael.chen', 'Dr. Michael Chen', 'SUR', 'General Surgery', 'MD, FACS', 230],
        ] as [$handle, $name, $code, $spec, $qual, $fee]) {
            $this->doctors[] = $this->user('doctor', $name, "{$handle}@".self::DOMAIN, [
                'department_id' => $this->dept[$code]->id ?? null, 'specialization' => $spec, 'qualification' => $qual,
                'license_no' => 'VA-'.mt_rand(100000, 999999), 'consultation_fee' => $fee, 'slot_minutes' => 20,
                'bio' => "{$spec} specialist at Mercy General.",
            ]);
        }
        $this->u['doctor'] = $this->doctors[0];

        foreach ([['nurse', 'Grace Lee'], ['hannah.brooks', 'Hannah Brooks'], ['marcus.johnson', 'Marcus Johnson']] as $k => [$handle, $name]) {
            $this->nurses[] = $this->user('nurse', $name, "{$handle}@".self::DOMAIN, ['department_id' => $this->dept[$k === 2 ? 'ER' : 'MED']->id ?? null, 'qualification' => 'RN, BSN']);
        }
        $this->u['nurse'] = $this->nurses[0];

        foreach (['receptionist', 'pharmacist', 'lab_technician', 'accountant', 'storekeeper', 'hr_manager'] as $role) {
            $this->u[$role] = $this->user($role, self::ACCOUNTS[$role][0], self::email($role), [
                'department_id' => $role === 'lab_technician' ? ($this->dept['PAT']->id ?? null) : null,
                'qualification' => ['pharmacist' => 'PharmD', 'lab_technician' => 'MLS (ASCP)', 'accountant' => 'CPA'][$role] ?? null,
            ]);
        }
    }

    protected function patientsAndRecords(): void
    {
        $people = [
            ['Ava', 'Brooks', 'female', '1991-04-12'], ['Noah', 'Hill', 'male', '1958-09-03'], ['Mia', 'Cole', 'female', '1987-01-27'],
            ['Liam', 'Reed', 'male', '1999-06-15'], ['Emma', 'Turner', 'female', '1972-11-08'], ['Ethan', 'Ward', 'male', '1965-02-19'],
            ['Sophia', 'Price', 'female', '2016-08-30'], ['Lucas', 'Gray', 'male', '1980-12-02'], ['Isabella', 'Ross', 'female', '1949-03-22'],
            ['Mason', 'Hayes', 'male', '2011-05-09'], ['Charlotte', 'Foster', 'female', '1995-10-17'], ['Logan', 'Bryant', 'male', '1976-07-04'],
            ['Amelia', 'Hughes', 'female', '1983-09-25'], ['Jackson', 'Long', 'male', '1953-01-11'], ['Harper', 'Fisher', 'female', '2019-02-14'],
            ['Aiden', 'Perry', 'male', '1990-03-30'], ['Evelyn', 'Russell', 'female', '1961-06-06'], ['Carter', 'Griffin', 'male', '1988-08-21'],
            ['Abigail', 'Diaz', 'female', '1979-04-03'], ['Wyatt', 'Myers', 'male', '1969-10-29'], ['Ella', 'Ford', 'female', '2002-12-12'],
            ['Owen', 'Hart', 'male', '1945-05-18'], ['Scarlett', 'Stone', 'female', '1993-07-07'], ['Henry', 'Wells', 'male', '1971-11-23'],
            ['Grace', 'Porter', 'female', '1985-02-02'], ['Leo', 'Barnes', 'male', '2008-09-09'], ['Chloe', 'Mason', 'female', '1998-01-31'],
            ['Jack', 'Hunt', 'male', '1956-04-26'], ['Zoe', 'King', 'female', '1992-06-19'], ['Levi', 'Rose', 'male', '1984-03-13'],
            ['Lily', 'Spencer', 'female', '1967-12-05'], ['Sebastian', 'Cruz', 'male', '1974-08-16'], ['Nora', 'Black', 'female', '2013-10-10'],
            ['Julian', 'Webb', 'male', '1960-05-01'], ['Hazel', 'Fox', 'female', '1951-07-28'], ['Caleb', 'Lane', 'male', '1997-11-11'],
        ];
        $streets = ['Maple Ave', 'Oak Street', 'Pine Ridge Rd', 'Cedar Lane', 'Riverside Dr', 'Elm Court', 'Willow Way', 'Hillcrest Blvd'];
        $bloods = ['O+', 'A+', 'B+', 'O-', 'A-', 'AB+', 'B-'];
        $allergyText = [0 => 'Penicillin', 4 => 'Sulfa drugs', 8 => 'Latex', 13 => 'Aspirin', 20 => 'Peanuts'];

        foreach ($people as $i => [$first, $last, $gender, $dob]) {
            $this->patients[] = Patient::create([
                'mrn' => 'MRN-'.str_pad((string) (210 + $i * 3), 6, '0', STR_PAD_LEFT),
                'first_name' => $first, 'last_name' => $last, 'gender' => $gender, 'date_of_birth' => $dob,
                'phone' => sprintf('(555) 01%d-%04d', $i % 10, 1000 + $i * 37),
                'email' => strtolower($first.'.'.$last).'@example.com',
                'address' => (100 + $i * 17).' '.$streets[$i % count($streets)].', Springfield, VA',
                'blood_group' => $bloods[$i % count($bloods)],
                'allergies' => $allergyText[$i] ?? null,
                'emergency_contact_name' => $this->pick(['Michael', 'Jennifer', 'David', 'Laura', 'Robert', 'Karen']).' '.$last,
                'emergency_contact_phone' => sprintf('(555) 02%d-%04d', $i % 10, 2000 + $i * 41),
                'created_at' => $this->now->copy()->subDays(mt_rand(10, 300)),
            ]);
        }

        // The portal patient.
        $portal = $this->user('patient', 'Ava Brooks', self::email('patient'));
        $this->patients[0]->update(['user_id' => $portal->id]);
        $this->u['patient'] = $portal;

        // A rich chart for Ava and some basics for others.
        $ava = $this->patients[0];
        $doc = $this->u['doctor']->id;
        foreach ([['Type 2 diabetes mellitus', 'E11.9', '2019-03-01'], ['Essential hypertension', 'I10', '2020-07-15'], ['Mild intermittent asthma', 'J45.20', '2008-01-01']] as [$n, $c, $d]) {
            PatientProblem::create(['patient_id' => $ava->id, 'name' => $n, 'icd_code' => $c, 'onset_date' => $d, 'recorded_by' => $doc]);
        }
        PatientProblem::create(['patient_id' => $ava->id, 'name' => 'Acute bronchitis', 'icd_code' => 'J20.9', 'status' => 'resolved', 'onset_date' => $this->now->copy()->subMonths(5)->toDateString(), 'resolved_date' => $this->now->copy()->subMonths(4)->toDateString(), 'recorded_by' => $doc]);
        foreach ([['Metformin', '500 mg', 'BD', 'oral'], ['Amlodipine', '5 mg', 'OD', 'oral'], ['Salbutamol inhaler', '2 puffs', 'PRN', 'inhaled']] as [$n, $dose, $f, $r]) {
            PatientMedication::create(['patient_id' => $ava->id, 'name' => $n, 'dose' => $dose, 'frequency' => $f, 'route' => $r, 'started_on' => '2021-01-10', 'recorded_by' => $doc]);
        }
        foreach ([['Influenza (seasonal)', 1, 2], ['COVID-19 booster', 3, 9], ['Tdap', 1, 30]] as [$v, $n, $monthsAgo]) {
            Immunization::create(['patient_id' => $ava->id, 'vaccine' => $v, 'dose_no' => $n, 'given_on' => $this->now->copy()->subMonths($monthsAgo)->toDateString(), 'site' => 'Left deltoid', 'given_by' => $this->u['nurse']->id]);
        }
        PatientHistory::create([
            'patient_id' => $ava->id, 'past_medical' => 'Gestational diabetes (2017). Childhood asthma.', 'surgical' => 'Appendectomy (2010).',
            'family' => 'Father: type 2 diabetes, MI at 61. Mother: hypertension.',
            'social' => ['smoking' => 'never', 'alcohol' => 'occasional', 'occupation' => 'Teacher', 'exercise' => '3 times a week'], 'updated_by' => $doc,
        ]);

        $allergies = [0 => ['Penicillin', 'Hives, throat swelling', 'severe'], 4 => ['Sulfonamides', 'Rash', 'moderate'], 8 => ['Latex', 'Contact dermatitis', 'mild'], 13 => ['Aspirin', 'Wheezing', 'moderate'], 20 => ['Peanuts', 'Anaphylaxis', 'severe']];
        foreach ($allergies as $i => [$a, $r, $s]) {
            PatientAllergy::create(['patient_id' => $this->patients[$i]->id, 'allergen' => $a, 'type' => $a === 'Peanuts' ? 'food' : ($a === 'Latex' ? 'environment' : 'drug'), 'reaction' => $r, 'severity' => $s, 'recorded_by' => $doc]);
        }
        foreach ([1 => ['Coronary artery disease', 'I25.10'], 5 => ['Chronic kidney disease, stage 3', 'N18.3'], 8 => ['Osteoarthritis of knee', 'M17.9'], 13 => ['COPD', 'J44.9'], 16 => ['Hypothyroidism', 'E03.9'], 21 => ['Atrial fibrillation', 'I48.91']] as $i => [$n, $c]) {
            PatientProblem::create(['patient_id' => $this->patients[$i]->id, 'name' => $n, 'icd_code' => $c, 'onset_date' => $this->now->copy()->subYears(mt_rand(1, 8))->toDateString(), 'recorded_by' => $doc]);
        }
    }

    protected function stock(): void
    {
        $plan = [
            'Paracetamol' => [1840, 'PCM-2611'], 'Ibuprofen' => [920, 'IBU-2604'], 'Amoxicillin' => [36, 'AMX-2588'], 'Azithromycin' => [310, 'AZI-2597'],
            'Metformin' => [1250, 'MET-2612'], 'Amlodipine' => [640, 'AML-2609'], 'Omeprazole' => [18, 'OME-2571'], 'Cetirizine' => [480, 'CET-2602'],
            'Oral Rehydration Salts' => [210, 'ORS-2590'], 'Normal Saline' => [96, 'NS-2615'],
        ];
        foreach (Medicine::all() as $m) {
            [$qty, $batch] = $plan[$m->name] ?? [200, 'B-'.mt_rand(1000, 9999)];
            $expiry = $m->name === 'Azithromycin' ? $this->now->copy()->addDays(45) : $this->now->copy()->addMonths(mt_rand(8, 26));
            $m->update(['stock' => $qty, 'batch_no' => $batch, 'expiry_date' => $expiry->toDateString(), 'manufacturer' => $this->pick(['Riverside Pharma', 'Novaline Labs', 'Westbrook Generics'])]);
            StockMovement::create(['medicine_id' => $m->id, 'user_id' => $this->u['pharmacist']->id, 'type' => 'purchase', 'quantity' => $qty + 400, 'balance' => $qty + 400, 'reference' => 'PO-2026-00'.mt_rand(40, 70), 'created_at' => $this->now->copy()->subDays(40)]);
        }
    }

    /** Ninety days of outpatient visits, lab work, prescriptions and bills, plus a year of inpatient stays. */
    protected function history(): void
    {
        $dx = [
            ['Upper respiratory tract infection', 'J06.9', 'Sore throat and runny nose for 3 days'], ['Essential hypertension', 'I10', 'Follow-up for blood pressure'],
            ['Type 2 diabetes mellitus', 'E11.9', 'Diabetes review, home sugars 150–180'], ['Acute bronchitis', 'J20.9', 'Productive cough for a week'],
            ['Low back pain', 'M54.5', 'Lower back pain after lifting'], ['Gastroesophageal reflux disease', 'K21.9', 'Heartburn after meals'],
            ['Urinary tract infection', 'N39.0', 'Burning on urination'], ['Migraine', 'G43.909', 'Recurrent throbbing headache'],
            ['Allergic rhinitis', 'J30.9', 'Sneezing and itchy eyes'], ['Sprain of ankle', 'S93.409A', 'Twisted ankle playing soccer'],
            ['Anxiety disorder', 'F41.9', 'Feeling anxious, poor sleep'], ['Hyperlipidemia', 'E78.5', 'Cholesterol follow-up'],
        ];
        $rx = ['Paracetamol' => ['1 tab', 'TDS', 5, 15], 'Amoxicillin' => ['1 cap', 'TDS', 7, 21], 'Ibuprofen' => ['1 tab', 'BD', 5, 10], 'Omeprazole' => ['1 cap', 'OD', 14, 14], 'Cetirizine' => ['1 tab', 'OD', 10, 10], 'Azithromycin' => ['1 tab', 'OD', 3, 3]];
        $meds = Medicine::all()->keyBy('name');
        $tests = LabTest::all()->keyBy('code');
        $results = ['CBC' => ['WBC 7.2, Hb 13.6, Plt 245', 'normal'], 'FBS' => ['142 mg/dL', 'high'], 'HBA1C' => ['7.4 %', 'high'], 'LIPID' => ['LDL 162 mg/dL', 'high'], 'TSH' => ['2.1 mIU/L', 'normal'], 'UA' => ['Nitrite +, leukocytes ++', 'high'], 'RFT' => ['Creatinine 0.9 mg/dL', 'normal'], 'CXR' => ['No acute cardiopulmonary findings', 'normal']];

        for ($d = 90; $d >= 1; $d--) {
            $day = $this->now->copy()->subDays($d)->startOfDay();
            if ($day->isSunday()) {
                continue;
            }
            $visits = $day->isSaturday() ? 1 : mt_rand(1, 3);
            for ($v = 0; $v < $visits; $v++) {
                $patient = $this->pick(array_slice($this->patients, 1));
                $doctor = $this->pick(array_slice($this->doctors, 0, 4));
                $at = $this->at($day, sprintf('%02d:%02d', mt_rand(8, 16), $this->pick([0, 20, 40])));
                $status = $this->chance(8) ? 'no_show' : 'completed';
                $appt = Appointment::create([
                    'patient_id' => $patient->id, 'doctor_id' => $doctor->id, 'department_id' => $doctor->staffProfile?->department_id ?? StaffProfile::where('user_id', $doctor->id)->value('department_id'),
                    'scheduled_at' => $at, 'duration_minutes' => 20, 'type' => $this->chance(30) ? 'follow_up' : 'consultation', 'status' => $status,
                    'token_no' => $v + 1, 'reason' => null, 'created_by' => $this->u['receptionist']->id, 'checked_in_at' => $status === 'completed' ? $at->copy()->subMinutes(10) : null,
                    'created_at' => $at->copy()->subDays(mt_rand(0, 5)),
                ]);
                if ($status !== 'completed') {
                    continue;
                }
                [$diag, $icd, $complaint] = $this->pick($dx);
                $enc = Encounter::create([
                    'patient_id' => $patient->id, 'doctor_id' => $doctor->id, 'appointment_id' => $appt->id, 'type' => 'opd',
                    'vitals' => ['bp' => mt_rand(110, 150).'/'.mt_rand(70, 95), 'pulse' => mt_rand(62, 98), 'temperature' => round(mt_rand(972, 1004) / 10, 1), 'spo2' => mt_rand(95, 99), 'weight' => mt_rand(55, 98)],
                    'complaints' => $complaint, 'examination' => 'Alert and oriented. Chest clear. Abdomen soft.', 'diagnosis' => $diag, 'icd_code' => $icd,
                    'plan' => 'Medication as prescribed. Return if symptoms worsen.', 'created_at' => $at->copy()->addMinutes(15),
                ]);
                $fee = (float) (StaffProfile::where('user_id', $doctor->id)->value('consultation_fee') ?: 150);
                $lines = [['consultation', 'Consultation · '.$doctor->name, $fee, 1]];

                if ($this->chance(70)) {
                    $name = $this->pick(array_keys($rx));
                    [$dose, $freq, $days, $qty] = $rx[$name];
                    $p = Prescription::create(['patient_id' => $patient->id, 'doctor_id' => $doctor->id, 'encounter_id' => $enc->id, 'status' => 'dispensed', 'dispensed_by' => $this->u['pharmacist']->id, 'dispensed_at' => $at->copy()->addMinutes(40), 'created_at' => $at->copy()->addMinutes(16)]);
                    $med = $meds[$name] ?? null;
                    $p->items()->create(['medicine_id' => $med?->id, 'medicine_name' => trim($name.' '.($med->strength ?? '')), 'dosage' => $dose, 'frequency' => $freq, 'duration_days' => $days, 'quantity' => $qty, 'dispensed_qty' => $qty]);
                    if ($med) {
                        StockMovement::create(['medicine_id' => $med->id, 'user_id' => $this->u['pharmacist']->id, 'type' => 'dispense', 'quantity' => -$qty, 'balance' => $med->stock, 'reference' => 'RX-'.$p->id, 'created_at' => $at->copy()->addMinutes(40)]);
                        $lines[] = ['pharmacy', trim($name.' '.($med->strength ?? '')).' × '.$qty, (float) $med->unit_price, $qty];
                    }
                }
                if ($this->chance(45)) {
                    $code = $this->pick(array_keys($results));
                    $test = $tests[$code] ?? null;
                    if ($test) {
                        $o = LabOrder::create(['patient_id' => $patient->id, 'doctor_id' => $doctor->id, 'encounter_id' => $enc->id, 'status' => 'completed', 'priority' => $this->chance(15) ? 'urgent' : 'routine', 'collected_at' => $at->copy()->addMinutes(30), 'completed_at' => $at->copy()->addHours(mt_rand(2, 20)), 'created_at' => $at->copy()->addMinutes(17)]);
                        $o->items()->create(['lab_test_id' => $test->id, 'result' => $results[$code][0], 'flag' => $results[$code][1], 'reported_by' => $this->u['lab_technician']->id, 'reported_at' => $o->completed_at]);
                        $lines[] = [$test->category === 'radiology' ? 'radiology' : 'lab', $test->name, (float) $test->price, 1];
                    }
                }
                $insured = $patient->id % 3 === 0;
                $this->bill($patient, $at->copy()->addMinutes(18), $lines, $insured ? 0.2 : ($this->chance(90) ? 1 : 0.5), method: $this->pick(['card', 'card', 'cash', 'bank']));
            }
        }

        // A year of discharged inpatient stays, so census, revenue and P&L have history.
        $wards = Ward::all()->keyBy('type');
        $reasons = [['Community-acquired pneumonia', 'J18.9'], ['Acute appendicitis', 'K35.80'], ['Chest pain, NSTEMI ruled out', 'R07.9'], ['Cellulitis of leg', 'L03.115'], ['Diabetic ketoacidosis', 'E11.10'], ['Fracture of femur', 'S72.90XA'], ['Acute pyelonephritis', 'N10'], ['Heart failure exacerbation', 'I50.9']];
        $start = $this->now->copy()->startOfYear();
        for ($m = $start->copy(); $m->lt($this->now->copy()->subDays(10)); $m->addDays(mt_rand(9, 13))) {
            $patient = $this->pick($this->patients);
            [$reason, $icd] = $this->pick($reasons);
            $ward = $this->chance(20) ? $wards['icu'] : ($this->chance(30) ? $wards['private'] : $wards['general']);
            $bed = Bed::where('ward_id', $ward->id)->inRandomOrder()->first();
            $in = $m->copy()->setTime(mt_rand(9, 20), 0);
            $days = mt_rand(2, 7);
            $out = $in->copy()->addDays($days)->setTime(11, 0);
            $adm = Admission::create(['patient_id' => $patient->id, 'bed_id' => $bed->id, 'doctor_id' => $this->pick($this->doctors)->id, 'status' => 'discharged', 'admitted_at' => $in, 'discharged_at' => $out, 'reason' => $reason, 'diagnosis' => $reason, 'discharge_type' => $this->chance(4) ? 'lama' : 'recovered', 'discharge_summary' => "Admitted with {$reason}. Treated and improved. Discharged home with follow-up in OPD in 1 week.", 'created_at' => $in]);
            Encounter::create(['patient_id' => $patient->id, 'doctor_id' => $adm->doctor_id, 'admission_id' => $adm->id, 'type' => 'ipd', 'diagnosis' => $reason, 'icd_code' => $icd, 'plan' => 'IV therapy and monitoring.', 'created_at' => $in->copy()->addHour()]);
            $this->bill($patient, $out, [
                ['room', "{$ward->name} · {$days} days", (float) $ward->daily_rate, $days],
                ['procedure', 'Nursing care & monitoring', 80, $days],
                ['pharmacy', 'Inpatient medicines', mt_rand(180, 900), 1],
                ['lab', 'Inpatient investigations', mt_rand(150, 600), 1],
            ], $this->chance(85) ? 1 : 0.6, $adm, $this->pick(['card', 'bank', 'insurance']), $out->copy()->addDays(mt_rand(0, 20)));
        }
    }

    protected function today(): void
    {
        $day = $this->now->copy()->startOfDay();
        $tomorrow = $day->copy()->addDay();
        if ($tomorrow->isSunday()) {
            $tomorrow->addDay();
        }
        $reasons = ['Annual physical', 'Chest tightness on exertion', 'Diabetes follow-up', 'Child with fever and cough', 'Knee pain after a fall', 'Blood pressure review', 'Rash on both arms', 'Post-operative review', 'Palpitations', 'Vaccination visit'];
        $slots = ['08:00', '08:20', '08:40', '09:00', '09:20', '09:40', '10:00', '10:20', '11:00', '11:40', '13:00', '13:40', '14:20', '15:00', '15:40', '16:20'];
        $token = 0;

        foreach ($slots as $k => $time) {
            $doctor = $this->doctors[$k % 4];
            $patient = $this->patients[($k * 5 + 3) % count($this->patients)];
            if ($k === 2) {
                $patient = $this->patients[0];
                $doctor = $this->doctors[0];
            }
            $at = $this->at($day, $time);
            $minsFromNow = $this->now->diffInMinutes($at, false);
            $status = match (true) {
                $minsFromNow < -60 => $k === 5 ? 'no_show' : 'completed',
                $minsFromNow < -20 => 'in_progress',
                $minsFromNow < 30 => 'checked_in',
                default => 'scheduled',
            };
            $appt = Appointment::create([
                'patient_id' => $patient->id, 'doctor_id' => $doctor->id, 'department_id' => StaffProfile::where('user_id', $doctor->id)->value('department_id'),
                'scheduled_at' => $at, 'duration_minutes' => 20, 'type' => $k % 4 === 1 ? 'follow_up' : 'consultation', 'status' => $status,
                'token_no' => ++$token, 'reason' => $reasons[$k % count($reasons)], 'created_by' => $this->u['receptionist']->id,
                'checked_in_at' => in_array($status, ['completed', 'in_progress', 'checked_in'], true) ? $at->copy()->subMinutes(12) : null,
            ]);
            if ($status === 'completed') {
                Encounter::create(['patient_id' => $patient->id, 'doctor_id' => $doctor->id, 'appointment_id' => $appt->id, 'type' => 'opd', 'vitals' => ['bp' => '128/82', 'pulse' => 76, 'temperature' => 98.4, 'spo2' => 98], 'complaints' => $appt->reason, 'diagnosis' => 'Essential hypertension', 'icd_code' => 'I10', 'plan' => 'Continue current medicines. Review in 3 months.', 'created_at' => $at->copy()->addMinutes(15)]);
            }
        }
        foreach (['09:00', '10:20', '11:40', '14:00', '15:20'] as $k => $time) {
            Appointment::create(['patient_id' => $this->patients[($k * 7 + 2) % count($this->patients)]->id, 'doctor_id' => $this->doctors[$k % 4]->id, 'scheduled_at' => $this->at($tomorrow, $time), 'duration_minutes' => 20, 'status' => 'scheduled', 'type' => 'consultation', 'reason' => $reasons[($k + 3) % count($reasons)], 'created_by' => $this->u['receptionist']->id]);
        }
        Appointment::create(['patient_id' => $this->patients[0]->id, 'doctor_id' => $this->doctors[0]->id, 'scheduled_at' => $this->at($day->copy()->addDays(9), '10:00'), 'duration_minutes' => 20, 'status' => 'scheduled', 'type' => 'follow_up', 'reason' => 'HbA1c review', 'created_by' => $this->u['receptionist']->id]);

        // Today's lab and pharmacy work.
        $tests = LabTest::all()->keyBy('code');
        foreach ([[1, 'stat', 'ordered', ['CBC', 'RFT']], [2, 'urgent', 'collected', ['CBC']], [9, 'routine', 'ordered', ['LIPID', 'FBS']], [14, 'routine', 'collected', ['UA']], [6, 'urgent', 'ordered', ['CXR']]] as [$i, $prio, $status, $codes]) {
            $o = LabOrder::create(['patient_id' => $this->patients[$i]->id, 'doctor_id' => $this->doctors[$i % 4]->id, 'status' => $status, 'priority' => $prio, 'collected_at' => $status === 'collected' ? $this->now->copy()->subMinutes(40) : null, 'created_at' => $this->now->copy()->subMinutes(mt_rand(20, 150))]);
            foreach ($codes as $c) {
                $o->items()->create(['lab_test_id' => $tests[$c]->id]);
            }
        }
        $crit = LabOrder::create(['patient_id' => $this->patients[5]->id, 'doctor_id' => $this->doctors[1]->id, 'status' => 'completed', 'priority' => 'stat', 'collected_at' => $this->now->copy()->subHours(3), 'completed_at' => $this->now->copy()->subHours(2), 'created_at' => $this->now->copy()->subHours(3)->subMinutes(10)]);
        $crit->items()->create(['lab_test_id' => $tests['RFT']->id, 'result' => 'Potassium 6.4 mmol/L, Creatinine 2.8 mg/dL', 'flag' => 'critical', 'reported_by' => $this->u['lab_technician']->id, 'reported_at' => $this->now->copy()->subHours(2)]);

        $meds = Medicine::all()->keyBy('name');
        foreach ([[3, ['Amoxicillin', 'Paracetamol']], [7, ['Metformin']], [11, ['Omeprazole', 'Cetirizine']], [17, ['Ibuprofen']]] as $k => [$i, $names]) {
            $p = Prescription::create(['patient_id' => $this->patients[$i]->id, 'doctor_id' => $this->doctors[$k % 4]->id, 'status' => 'pending', 'notes' => $k === 0 ? 'Complete the full antibiotic course.' : null, 'created_at' => $this->now->copy()->subMinutes(15 + $k * 25)]);
            foreach ($names as $n) {
                $m = $meds[$n];
                $p->items()->create(['medicine_id' => $m->id, 'medicine_name' => trim($m->name.' '.$m->strength), 'dosage' => '1 tab', 'frequency' => $n === 'Metformin' ? 'BD' : 'TDS', 'duration_days' => $n === 'Metformin' ? 30 : 5, 'quantity' => $n === 'Metformin' ? 60 : 15]);
            }
        }
    }

    protected function inpatients(): void
    {
        $beds = Bed::with('ward')->get()->keyBy('number');
        $stays = [
            ['G-01', 2, 'Community-acquired pneumonia', 3, [['Ceftriaxone', '1 g', 'iv', 'BD'], ['Paracetamol', '1 g', 'oral', 'QID'], ['Salbutamol nebulizer', '2.5 mg', 'inhaled', 'PRN']]],
            ['G-02', 5, 'Acute kidney injury', 2, [['Normal Saline', '1 L', 'iv', 'Q8H'], ['Calcium gluconate', '10 ml', 'iv', 'STAT']]],
            ['G-03', 9, 'Fracture of right hip, post ORIF', 4, [['Enoxaparin', '40 mg', 'sc', 'OD'], ['Morphine', '2 mg', 'iv', 'PRN'], ['Paracetamol', '1 g', 'oral', 'QID']]],
            ['G-05', 12, 'Cellulitis of left leg', 1, [['Cefazolin', '1 g', 'iv', 'Q8H'], ['Ibuprofen', '400 mg', 'oral', 'TDS']]],
            ['G-07', 19, 'Diabetic foot ulcer', 6, [['Insulin glargine', '18 units', 'sc', 'HS'], ['Metformin', '500 mg', 'oral', 'BD']]],
            ['P-01', 16, 'Elective laparoscopic cholecystectomy', 1, [['Ondansetron', '4 mg', 'iv', 'TDS'], ['Paracetamol', '1 g', 'oral', 'QID']]],
            ['I-01', 1, 'NSTEMI', 2, [['Aspirin', '75 mg', 'oral', 'OD'], ['Atorvastatin', '80 mg', 'oral', 'HS'], ['Heparin infusion', '1000 units/h', 'iv', 'Q6H']]],
            ['I-02', 21, 'Heart failure exacerbation', 3, [['Furosemide', '40 mg', 'iv', 'BD'], ['Amlodipine', '5 mg', 'oral', 'OD']]],
        ];
        $today = $this->now->copy()->startOfDay();

        foreach ($stays as $k => [$bedNo, $pi, $reason, $daysIn, $orders]) {
            $bed = $beds[$bedNo] ?? null;
            if (! $bed) {
                continue;
            }
            $patient = $this->patients[$pi];
            $in = $this->now->copy()->subDays($daysIn)->setTime(mt_rand(10, 19), 30);
            $doctor = $k >= 6 ? $this->doctors[0] : $this->doctors[[1, 1, 3, 1, 5, 5][$k]];
            $adm = Admission::create(['patient_id' => $patient->id, 'bed_id' => $bed->id, 'doctor_id' => $doctor->id, 'status' => 'admitted', 'admitted_at' => $in, 'reason' => $reason, 'diagnosis' => $reason, 'created_at' => $in]);
            $bed->update(['status' => 'occupied']);
            Encounter::create(['patient_id' => $patient->id, 'doctor_id' => $doctor->id, 'admission_id' => $adm->id, 'type' => 'ipd', 'vitals' => ['bp' => '134/84', 'pulse' => 88, 'temperature' => 99.1, 'spo2' => 95], 'complaints' => $reason, 'diagnosis' => $reason, 'plan' => 'Admit. IV treatment and close monitoring.', 'created_at' => $in->copy()->addMinutes(30)]);
            $this->hospital->charge($patient, 'room', "{$bed->ward->name} · bed {$bed->number}", (float) $bed->ward->daily_rate, $daysIn, $adm, $adm);

            foreach ($orders as [$name, $dose, $route, $freq]) {
                $times = MedicationOrder::FREQUENCIES[$freq] ?? [];
                $order = MedicationOrder::create([
                    'admission_id' => $adm->id, 'patient_id' => $patient->id, 'medicine_id' => Medicine::where('name', $name)->value('id'),
                    'medicine_name' => $name, 'dose' => $dose, 'route' => $route, 'frequency' => $freq, 'times' => $times,
                    'starts_at' => $in->copy()->addHour(), 'status' => $freq === 'STAT' ? 'completed' : 'active', 'ordered_by' => $doctor->id,
                    'instructions' => $route === 'iv' ? 'Infuse over 30 minutes' : null,
                ]);
                // Doses recorded for yesterday and for today's past times.
                foreach ([$today->copy()->subDay(), $today] as $day) {
                    foreach ($times as $t) {
                        $at = $this->at($day, $t);
                        if ($at->lt($order->starts_at) || $at->gt($this->now->copy()->subMinutes(20))) {
                            continue;
                        }
                        $status = $this->chance(92) ? 'given' : $this->pick(['held', 'refused']);
                        MedicationAdministration::create(['medication_order_id' => $order->id, 'scheduled_for' => $at, 'status' => $status, 'recorded_at' => $at->copy()->addMinutes(mt_rand(0, 25)), 'dose_given' => $status === 'given' ? $dose : null, 'reason' => $status === 'held' ? 'Patient nil by mouth for scan' : ($status === 'refused' ? 'Patient declined, nausea' : null), 'user_id' => $this->pick($this->nurses)->id]);
                    }
                }
                if ($freq === 'STAT') {
                    MedicationAdministration::create(['medication_order_id' => $order->id, 'scheduled_for' => null, 'status' => 'given', 'recorded_at' => $in->copy()->addHours(2), 'dose_given' => $dose, 'user_id' => $this->nurses[0]->id]);
                }
            }

            NursingNote::create(['admission_id' => $adm->id, 'type' => 'handover', 'shift' => 'night', 'body' => $this->pick(['Settled overnight, slept well. Observations stable.', 'Restless early in the night, settled after analgesia. Obs within range.', 'Afebrile overnight. Tolerating oral fluids. Mobilising to bathroom with assistance.']), 'assessment' => ['falls_risk' => $this->pick(['low', 'medium', 'high']), 'pain' => mt_rand(1, 6), 'news2' => mt_rand(0, 5), 'mobility' => $this->pick(['independent', 'assisted'])], 'user_id' => $this->nurses[1]->id, 'created_at' => $today->copy()->setTime(6, 45)]);
            if ($this->now->hour >= 10) {
                NursingNote::create(['admission_id' => $adm->id, 'type' => 'note', 'shift' => 'morning', 'body' => 'Seen on ward round by '.$doctor->name.'. Plan continued. Family updated.', 'user_id' => $this->nurses[0]->id, 'created_at' => $today->copy()->setTime(10, 15)]);
            }
            foreach ([['intake', 'iv', 500, '07:00'], ['intake', 'oral', 250, '08:30'], ['output', 'urine', 350, '09:00'], ['intake', 'oral', 200, '12:00'], ['output', 'urine', 300, '13:30']] as [$dir, $r, $ml, $t]) {
                $at = $this->at($today, $t);
                if ($at->lt($this->now)) {
                    FluidEntry::create(['admission_id' => $adm->id, 'direction' => $dir, 'route' => $r, 'volume_ml' => $ml, 'recorded_at' => $at, 'user_id' => $this->nurses[0]->id]);
                }
            }
        }

        foreach (['G-04', 'P-03'] as $no) {
            $beds[$no]?->update(['status' => 'cleaning']);
        }
        $beds['G-10']?->update(['status' => 'maintenance']);
    }

    protected function emergency(): void
    {
        foreach ([['AMB-101', 'als', 'Tony Alvarez', 'available'], ['AMB-102', 'bls', 'Kevin Moore', 'on_trip'], ['AMB-103', 'patient_transport', 'Dana Scott', 'maintenance']] as [$no, $type, $driver, $status]) {
            $amb[$no] = Ambulance::create(['vehicle_no' => $no, 'type' => $type, 'driver_name' => $driver, 'phone' => '(555) 010-77'.substr($no, -2), 'status' => $status]);
        }

        $er = Bed::where('number', 'like', 'E-%')->orderBy('number')->get()->values();
        $board = [
            [1, 1, 'ambulance', 'Crushing chest pain radiating to left arm, sweating', 9, 'in_treatment', $this->doctors[4], 'Resus 1', ['bp' => '88/56', 'pulse' => 128, 'spo2' => 91, 'gcs' => 14], 'STEMI pathway activated'],
            [null, 2, 'walk_in', 'Sudden slurred speech and right arm weakness', 22, 'in_treatment', $this->doctors[4], 'Bay 2', ['bp' => '182/104', 'pulse' => 96, 'spo2' => 97, 'sugar' => 132], 'Stroke — onset 40 min'],
            [24, 3, 'walk_in', 'High fever and productive cough for 4 days', 48, 'observation', $this->doctors[1], 'Bay 4', ['temperature' => 102.8, 'pulse' => 108, 'spo2' => 94], null],
            [27, null, 'walk_in', 'Laceration to the forearm from broken glass', 6, 'waiting', null, null, null, null],
            [3, 4, 'walk_in', 'Twisted ankle playing soccer, unable to bear weight', 71, 'waiting', null, null, ['pain' => 6], null],
            [33, 3, 'referral', 'Child with vomiting and diarrhoea since last night', 35, 'waiting', null, null, ['temperature' => 100.9, 'pulse' => 124], null],
        ];
        foreach ($board as $k => [$pi, $level, $mode, $complaint, $mins, $status, $doctor, $bay, $vitals, $flags]) {
            if ($pi === null) {
                $patient = Patient::create(['mrn' => 'MRN-'.str_pad((string) (900 + $k), 6, '0', STR_PAD_LEFT), 'first_name' => 'Unknown', 'last_name' => 'Patient', 'gender' => 'male', 'notes' => 'Unidentified on arrival. Name to be updated.']);
            } else {
                $patient = $this->patients[$pi];
            }
            $arrived = $this->now->copy()->subMinutes($mins);
            $pain = $vitals['pain'] ?? null;
            unset($vitals['pain']);
            $visit = ErVisit::create([
                'patient_id' => $patient->id, 'arrival_mode' => $mode, 'arrived_at' => $arrived, 'chief_complaint' => $complaint,
                'triage_level' => $level, 'triaged_at' => $level ? $arrived->copy()->addMinutes(4) : null, 'triaged_by' => $level ? $this->nurses[2]->id : null,
                'vitals' => $vitals ?: null, 'pain_score' => $pain ?? ($level && $level <= 2 ? 8 : null), 'red_flags' => $flags, 'isolation' => $k === 2,
                'status' => $status, 'doctor_id' => $doctor?->id, 'bay' => $bay,
            ]);
            if ($k === 0) {
                AmbulanceTrip::create(['ambulance_id' => $amb['AMB-101']->id, 'er_visit_id' => $visit->id, 'caller_name' => 'Linda Hill', 'caller_phone' => '(555) 013-4471', 'patient_name' => $patient->name ?? 'Noah Hill', 'pickup_address' => '418 Oak Street, Springfield', 'destination' => 'Mercy General ER', 'reason' => 'Chest pain, collapsed at home', 'status' => 'completed', 'requested_at' => $arrived->copy()->subMinutes(24), 'dispatched_at' => $arrived->copy()->subMinutes(22), 'completed_at' => $arrived]);
            }
        }
        AmbulanceTrip::create(['ambulance_id' => $amb['AMB-102']->id, 'caller_name' => 'Officer R. Grant', 'caller_phone' => '(555) 019-0042', 'patient_name' => 'Adult male, approx. 30', 'pickup_address' => 'I-64 eastbound near exit 118', 'destination' => 'Mercy General ER', 'reason' => 'Motorcycle collision, conscious', 'status' => 'transporting', 'requested_at' => $this->now->copy()->subMinutes(26), 'dispatched_at' => $this->now->copy()->subMinutes(24)]);
        AmbulanceTrip::create(['caller_name' => 'Patricia Wells', 'caller_phone' => '(555) 016-2290', 'patient_name' => 'Henry Wells', 'pickup_address' => '23 Willow Way, Springfield', 'reason' => 'Elderly father, fall at home, hip pain', 'status' => 'requested', 'requested_at' => $this->now->copy()->subMinutes(3)]);

        // Last two weeks of closed visits.
        $outcomes = ['discharged', 'discharged', 'discharged', 'discharged', 'admitted', 'referred', 'lwbs', 'discharged'];
        $complaints = ['Abdominal pain', 'Shortness of breath', 'Fall with wrist pain', 'Allergic reaction', 'Asthma attack', 'Kidney stone pain', 'Head injury, no LOC', 'Dehydration', 'Severe migraine', 'Chest pain, atypical'];
        $service = \App\Models\Service::where('category', 'emergency')->first();
        for ($i = 0; $i < 34; $i++) {
            $arrived = $this->now->copy()->subDays(mt_rand(1, 14))->setTime(mt_rand(0, 23), mt_rand(0, 59));
            $level = $this->pick([2, 3, 3, 3, 4, 4, 4, 5, 5]);
            $patient = $this->pick($this->patients);
            $disposition = $this->pick($outcomes);
            ErVisit::create([
                'patient_id' => $patient->id, 'arrival_mode' => $this->chance(25) ? 'ambulance' : 'walk_in', 'arrived_at' => $arrived, 'chief_complaint' => $this->pick($complaints),
                'triage_level' => $level, 'triaged_at' => $arrived->copy()->addMinutes(5), 'triaged_by' => $this->nurses[2]->id, 'status' => 'disposed',
                'doctor_id' => $this->doctors[4]->id, 'disposition' => $disposition, 'disposed_at' => $arrived->copy()->addMinutes(mt_rand(50, 260) - $level * 6),
                'disposition_notes' => $disposition === 'discharged' ? 'Treated and discharged with advice. OPD follow-up.' : null,
            ]);
            if ($service && $disposition !== 'lwbs') {
                $this->bill($patient, $arrived, [['procedure', $service->name, (float) $service->price, 1]], 1, method: 'card');
            }
        }
    }

    protected function insurance(): void
    {
        $providers = [];
        foreach ([['Summit Health', 'SMH', 'private', 80, 'Janet Ruiz'], ['BlueRidge Mutual', 'BRM', 'private', 70, 'Tom Fields'], ['Keystone Care', 'KSC', 'corporate', 90, 'Alan Price'], ['Liberty State Health Plan', 'LSHP', 'government', 100, 'Claims desk']] as [$n, $c, $t, $cov, $contact]) {
            $providers[] = InsuranceProvider::create(['name' => $n, 'code' => $c, 'type' => $t, 'default_coverage' => $cov, 'contact_person' => $contact, 'phone' => '(800) 555-0'.mt_rand(100, 999), 'email' => 'claims@'.strtolower($c).'.example.com', 'payment_terms_days' => 30]);
        }

        $policies = [];
        foreach ($this->patients as $i => $patient) {
            if ($i !== 0 && $i % 3 !== 0 && $i % 5 !== 0) {
                continue;
            }
            $prov = $i === 0 ? $providers[0] : $providers[$i % 4];
            $policies[$i] = PatientPolicy::create([
                'patient_id' => $patient->id, 'insurance_provider_id' => $prov->id, 'policy_no' => $prov->code.'-'.mt_rand(10000000, 99999999),
                'member_id' => 'M'.mt_rand(1000000, 9999999), 'group_no' => 'G'.mt_rand(1000, 9999), 'plan_name' => $i === 0 ? 'Summit Health PPO Gold' : $this->pick(['PPO', 'HMO Plus', 'Standard', 'Family Select']),
                'holder_name' => $patient->first_name.' '.$patient->last_name, 'coverage_percent' => $prov->default_coverage, 'copay' => $this->pick([20, 25, 30, 40]),
                'annual_limit' => $this->pick([50000, 100000, 250000]), 'valid_from' => $this->now->copy()->startOfYear()->toDateString(), 'valid_to' => $this->now->copy()->endOfYear()->toDateString(),
            ]);
            $patient->update(['insurance_provider' => $prov->name, 'insurance_number' => $policies[$i]->policy_no]);
        }

        // Claims on bills of insured patients.
        $states = ['submitted', 'submitted', 'submitted', 'approved', 'approved', 'paid', 'paid', 'paid', 'paid', 'paid', 'rejected'];
        $n = 0;
        foreach ($policies as $i => $policy) {
            $invoice = Invoice::where('patient_id', $this->patients[$i]->id)->whereIn('status', ['unpaid', 'partial'])->orderByDesc('total')->first();
            if (! $invoice || $n >= count($states)) {
                continue;
            }
            $status = $states[$n++];
            $claimed = round((float) $invoice->total * $policy->coverage_percent / 100, 2);
            $submitted = Carbon::parse($invoice->created_at)->addDay();
            InsuranceClaim::create([
                'invoice_id' => $invoice->id, 'patient_id' => $invoice->patient_id, 'insurance_provider_id' => $policy->insurance_provider_id, 'patient_policy_id' => $policy->id,
                'provider' => $policy->provider?->name ?? InsuranceProvider::find($policy->insurance_provider_id)->name, 'policy_no' => $policy->policy_no,
                'claim_no' => 'CLM-'.$submitted->format('ym').'-'.str_pad((string) $n, 4, '0', STR_PAD_LEFT), 'amount_claimed' => $claimed,
                'amount_approved' => in_array($status, ['approved', 'paid'], true) ? $claimed : null, 'status' => $status,
                'rejection_reason' => $status === 'rejected' ? 'Service not covered under plan; resubmit with prior authorization.' : null,
                'submitted_at' => $submitted, 'decided_at' => $status !== 'submitted' ? $submitted->copy()->addDays(6) : null, 'paid_at' => $status === 'paid' ? $submitted->copy()->addDays(14) : null,
                'created_at' => $submitted,
            ]);
            if ($status === 'paid') {
                InvoicePayment::create(['invoice_id' => $invoice->id, 'amount' => min($claimed, (float) $invoice->total - (float) $invoice->paid), 'method' => 'insurance', 'reference' => 'EFT-'.mt_rand(100000, 999999), 'received_by' => $this->u['accountant']->id, 'paid_at' => $submitted->copy()->addDays(14)]);
                $this->hospital->recalculate($invoice);
            }
        }

        foreach ([[1, 'Coronary angiography', 'NSTEMI', 'I21.4', 4200, 'approved'], [9, 'Total hip replacement', 'Osteoarthritis of hip', 'M16.9', 18500, 'requested'], [21, 'Echocardiogram', 'Heart failure', 'I50.9', 650, 'approved'], [15, 'MRI lumbar spine', 'Low back pain with radiculopathy', 'M54.16', 1400, 'requested']] as [$i, $svc, $dx, $icd, $est, $status]) {
            if (! isset($policies[$i])) {
                continue;
            }
            PreAuthorization::create(['patient_id' => $this->patients[$i]->id, 'patient_policy_id' => $policies[$i]->id, 'admission_id' => Admission::where('patient_id', $this->patients[$i]->id)->where('status', 'admitted')->value('id'), 'service' => $svc, 'diagnosis' => $dx, 'icd_code' => $icd, 'estimated_amount' => $est, 'approved_amount' => $status === 'approved' ? $est : null, 'auth_no' => $status === 'approved' ? 'PA-'.mt_rand(100000, 999999) : null, 'status' => $status, 'valid_until' => $this->now->copy()->addDays(30)->toDateString(), 'requested_by' => $this->u['accountant']->id, 'decided_at' => $status === 'approved' ? $this->now->copy()->subDay() : null]);
        }
    }

    protected function store(): void
    {
        $suppliers = [];
        foreach ([['MedSupply Co', 'Karen Holt', 30], ['Atlantic Surgical', 'Brian Cole', 45], ['Riverside Pharma Distributors', 'Nina Shah', 30], ['CleanCare Linen Services', 'Omar Lewis', 15]] as [$n, $c, $terms]) {
            $suppliers[] = Supplier::create(['name' => $n, 'contact_person' => $c, 'phone' => '(555) 014-'.mt_rand(1000, 9999), 'email' => 'orders@'.strtolower(preg_replace('/[^a-z]/i', '', $n)).'.example.com', 'address' => mt_rand(10, 900).' Industrial Pkwy, Richmond, VA', 'payment_terms_days' => $terms]);
        }

        $levels = ['GLV-M' => 6, 'SYR-5' => 1840, 'CAN-20' => 140, 'GAU-10' => 22, 'MSK-S' => 64, 'LIN-GWN' => 118, 'LIN-SHT' => 190, 'HSK-SAN' => 31];
        $locations = ['consumable' => 'Main store · A', 'surgical' => 'Main store · B', 'linen' => 'Linen room', 'housekeeping' => 'Housekeeping store'];
        foreach (InventoryItem::all() as $item) {
            $stock = $levels[$item->code] ?? 50;
            $item->update(['stock' => $stock, 'location' => ($locations[$item->category] ?? 'Main store').mt_rand(1, 4)]);
            InventoryMovement::create(['inventory_item_id' => $item->id, 'type' => 'receive', 'quantity' => $stock + 60, 'balance' => $stock + 60, 'reference' => 'Opening stock', 'user_id' => $this->u['storekeeper']->id, 'created_at' => $this->now->copy()->subDays(60)]);
            InventoryMovement::create(['inventory_item_id' => $item->id, 'department_id' => $this->dept['MED']->id ?? null, 'type' => 'issue', 'quantity' => -60, 'balance' => $stock, 'reference' => 'REQ-'.mt_rand(300, 399), 'user_id' => $this->u['storekeeper']->id, 'created_at' => $this->now->copy()->subDays(mt_rand(2, 20))]);
        }

        $items = InventoryItem::all()->keyBy('code');
        $meds = Medicine::all()->keyBy('name');
        $orders = [
            [0, 'draft', 2, [['inv', 'GLV-M', 40, 6.40], ['inv', 'MSK-S', 20, 4.50]], 'storekeeper'],
            [2, 'approved', 5, [['med', 'Amoxicillin', 1000, 0.08], ['med', 'Omeprazole', 600, 0.06]], 'pharmacist'],
            [1, 'partial', 9, [['inv', 'GAU-10', 100, 1.80], ['inv', 'CAN-20', 300, 0.65]], 'storekeeper'],
            [3, 'received', 21, [['inv', 'LIN-SHT', 120, 7.50], ['inv', 'LIN-GWN', 80, 9.00]], 'storekeeper'],
            [0, 'received', 34, [['inv', 'SYR-5', 2000, 0.12], ['inv', 'HSK-SAN', 40, 3.20]], 'storekeeper'],
            [2, 'received', 47, [['med', 'Paracetamol', 3000, 0.02], ['med', 'Metformin', 2000, 0.03]], 'pharmacist'],
        ];
        foreach ($orders as $k => [$si, $status, $daysAgo, $lines, $by]) {
            $at = $this->now->copy()->subDays($daysAgo)->setTime(10, 0);
            $po = PurchaseOrder::create(['supplier_id' => $suppliers[$si]->id, 'number' => 'PO-'.$at->format('Y').'-'.str_pad((string) (80 + $k), 4, '0', STR_PAD_LEFT), 'status' => $status, 'expected_on' => $at->copy()->addDays(5)->toDateString(), 'created_by' => $this->u[$by]->id, 'approved_by' => $status === 'draft' ? null : $this->u['accountant']->id, 'approved_at' => $status === 'draft' ? null : $at->copy()->addHours(3), 'created_at' => $at]);
            $total = 0;
            foreach ($lines as $j => [$kind, $ref, $qty, $cost]) {
                $received = match ($status) { 'received' => $qty, 'partial' => $j === 0 ? $qty : 0, default => 0 };
                $po->items()->create([
                    'inventory_item_id' => $kind === 'inv' ? $items[$ref]->id : null, 'medicine_id' => $kind === 'med' ? $meds[$ref]->id : null,
                    'description' => $kind === 'inv' ? $items[$ref]->name : trim($meds[$ref]->name.' '.$meds[$ref]->strength),
                    'quantity' => $qty, 'received_qty' => $received, 'unit_cost' => $cost,
                ]);
                $total += $qty * $cost;
            }
            $po->update(['total' => round($total, 2)]);
            if (in_array($status, ['received', 'partial'], true)) {
                Expense::create(['supplier_id' => $suppliers[$si]->id, 'purchase_order_id' => $po->id, 'spent_on' => $at->copy()->addDays(4)->toDateString(), 'category' => $lines[0][0] === 'med' ? 'pharmacy_stock' : 'supplies', 'description' => "Goods received · {$po->number}", 'amount' => round($status === 'partial' ? $lines[0][2] * $lines[0][3] : $total, 2), 'method' => 'bank', 'status' => $daysAgo > 20 ? 'paid' : 'approved', 'created_by' => $this->u['storekeeper']->id, 'approved_by' => $this->u['accountant']->id, 'approved_at' => $at->copy()->addDays(5)]);
            }
        }
    }

    protected function people(): void
    {
        $staff = User::whereIn('role', User::STAFF_ROLES)->get();
        $today = $this->now->copy()->startOfDay();

        // Attendance for the last four weeks.
        for ($d = 28; $d >= 0; $d--) {
            $day = $today->copy()->subDays($d);
            if ($day->isWeekend()) {
                continue;
            }
            foreach ($staff as $s) {
                if ($this->chance(5)) {
                    continue;
                }
                $in = $this->at($day, '08:'.str_pad((string) mt_rand(30, 59), 2, '0', STR_PAD_LEFT));
                if ($this->chance(12)) {
                    $in = $this->at($day, '09:'.str_pad((string) mt_rand(16, 45), 2, '0', STR_PAD_LEFT));
                }
                if ($d === 0 && $in->gt($this->now)) {
                    continue;
                }
                $out = $d === 0 ? null : $this->at($day, mt_rand(17, 18).':'.str_pad((string) mt_rand(0, 59), 2, '0', STR_PAD_LEFT));
                Attendance::create(['user_id' => $s->id, 'date' => $day->toDateString(), 'check_in' => $in, 'check_out' => $out, 'status' => $in->format('H:i') > '09:15' ? 'late' : 'present']);
            }
        }

        $leave = [
            [$this->nurses[0], 'annual', 34, 3, 'pending', 'Family visit for the holidays'],
            [$this->doctors[1], 'study', 12, 2, 'pending', 'ACP internal medicine conference'],
            [$this->doctors[2], 'annual', -20, 5, 'approved', 'Vacation'],
            [$this->u['pharmacist'], 'sick', -9, 1, 'approved', 'Flu'],
            [$this->nurses[1], 'annual', 6, 2, 'approved', 'Moving house'],
            [$this->u['storekeeper'], 'casual', -3, 1, 'rejected', 'Personal errand'],
        ];
        foreach ($leave as [$user, $type, $offset, $days, $status, $reason]) {
            $start = $today->copy()->addDays($offset);
            LeaveRequest::create(['user_id' => $user->id, 'type' => $type, 'starts_on' => $start->toDateString(), 'ends_on' => $start->copy()->addDays($days - 1)->toDateString(), 'days' => $days, 'reason' => $reason, 'status' => $status, 'decided_by' => $status === 'pending' ? null : $this->u['hr_manager']->id, 'decided_at' => $status === 'pending' ? null : $this->now->copy()->subDays(max(1, -$offset)), 'decision_note' => $status === 'rejected' ? 'Store stock count scheduled that day.' : null, 'created_at' => $this->now->copy()->subDays(mt_rand(2, 30))]);
        }

        // This week's roster.
        $monday = $today->copy()->startOfWeek();
        foreach (array_merge($this->doctors, $this->nurses) as $k => $person) {
            for ($d = 0; $d < 7; $d++) {
                if (($d + $k) % 7 >= 5) {
                    continue;
                }
                DutyShift::create(['user_id' => $person->id, 'department_id' => StaffProfile::where('user_id', $person->id)->value('department_id'), 'date' => $monday->copy()->addDays($d)->toDateString(), 'shift' => $k % 3 === 2 ? 'night' : ($k % 3 === 1 ? 'evening' : 'morning')]);
            }
        }
    }

    protected function money(): void
    {
        $monthly = [
            ['salaries', 'Staff payroll', 52000, 4000], ['utilities', 'Electricity & water', 4200, 900], ['rent', 'Building lease', 9500, 0],
            ['maintenance', 'Equipment service contracts', 1800, 1200], ['insurance', 'Malpractice & property insurance', 2600, 0], ['marketing', 'Community health campaign', 900, 600],
        ];
        $month = $this->now->copy()->startOfYear();
        while ($month->lte($this->now)) {
            $current = $month->isSameMonth($this->now);
            foreach ($monthly as [$cat, $desc, $base, $spread]) {
                $on = $month->copy()->day(min(25, $current ? max(1, $this->now->day - 1) : 25));
                if ($current && $cat === 'salaries' && $this->now->day < 25) {
                    continue;
                }
                Expense::create(['spent_on' => $on->toDateString(), 'category' => $cat, 'description' => $desc.' · '.$month->format('M Y'), 'amount' => $base + mt_rand(0, $spread), 'method' => 'bank', 'reference' => 'ACH-'.mt_rand(100000, 999999), 'status' => 'paid', 'created_by' => $this->u['accountant']->id, 'approved_by' => $this->u['admin']->id, 'approved_at' => $on]);
            }
            $month->addMonth();
        }
        foreach ([['utilities', 'Medical gas refill (oxygen)', 1840, 'pending', 'accountant'], ['equipment', 'Replacement infusion pump', 2650, 'pending', 'storekeeper'], ['maintenance', 'Elevator annual inspection', 780, 'approved', 'accountant']] as [$cat, $desc, $amt, $status, $by]) {
            Expense::create(['spent_on' => $this->now->copy()->subDays(mt_rand(1, 4))->toDateString(), 'category' => $cat, 'description' => $desc, 'amount' => $amt, 'method' => 'bank', 'status' => $status, 'created_by' => $this->u[$by]->id, 'approved_by' => $status === 'approved' ? $this->u['admin']->id : null, 'approved_at' => $status === 'approved' ? $this->now->copy()->subDay() : null]);
        }
    }
}
