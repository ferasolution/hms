<?php

namespace App\Http\Controllers\Api\Hospital;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\Admission;
use App\Models\Appointment;
use App\Models\Encounter;
use App\Models\Invoice;
use App\Models\LabOrder;
use App\Models\Patient;
use App\Models\Prescription;
use App\Models\User;
use App\Services\Hospital;
use App\Support\Csv;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

/**
 * Patient registration and the patient chart (EMR).
 */
class PatientController extends Controller
{
    public function __construct(protected Hospital $hospital) {}

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', Rule::in(['active', 'inactive', 'admitted'])],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $patients = Patient::query()
            ->when($data['search'] ?? null, function ($q, $s) {
                $term = '%'.$s.'%';
                $parts = preg_split('/\s+/', trim($s), 2);
                $q->where(fn ($q) => $q->where('first_name', 'like', $term)->orWhere('last_name', 'like', $term)
                    ->orWhere('mrn', 'like', $term)->orWhere('phone', 'like', $term)->orWhere('email', 'like', $term)
                    ->when(count($parts) === 2, fn ($q) => $q->orWhere(fn ($q) => $q
                        ->where('first_name', 'like', $parts[0].'%')->where('last_name', 'like', $parts[1].'%'))));
            })
            ->when(($data['status'] ?? null) === 'active', fn ($q) => $q->where('is_active', true))
            ->when(($data['status'] ?? null) === 'inactive', fn ($q) => $q->where('is_active', false))
            ->when(($data['status'] ?? null) === 'admitted', fn ($q) => $q->whereIn('id', Admission::where('status', 'admitted')->select('patient_id')))
            ->latest('id')
            ->paginate(30);

        $admitted = Admission::where('status', 'admitted')->whereIn('patient_id', collect($patients->items())->pluck('id'))->pluck('patient_id')->flip();

        return response()->json([
            'data' => collect($patients->items())->map(fn (Patient $p) => $this->row($p) + ['admitted' => isset($admitted[$p->id])]),
            'meta' => ['total' => $patients->total(), 'page' => $patients->currentPage(), 'last_page' => $patients->lastPage()],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);

        $patient = DB::transaction(function () use ($data) {
            return Patient::create($data + ['mrn' => $this->hospital->nextMrn()]);
        });

        ActivityLog::record('patient.registered', "Registered patient {$patient->name} ({$patient->mrn})", ['patient_id' => $patient->id]);

        return response()->json($this->row($patient), 201);
    }

    /** The full chart. */
    public function show(Request $request, Patient $patient): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'patient' => $this->row($patient) + [
                'portal_account' => $patient->user_id ? User::find($patient->user_id)?->only('id', 'email', 'is_active') : null,
            ],
            'admission' => Admission::with(['bed.ward', 'doctor:id,name'])->where('patient_id', $patient->id)->where('status', 'admitted')->latest('id')->first(),
            'encounters' => Encounter::with('doctor:id,name')->where('patient_id', $patient->id)->latest('id')->limit(50)->get(),
            'appointments' => Appointment::with(['doctor:id,name', 'department:id,name'])->where('patient_id', $patient->id)->latest('scheduled_at')->limit(30)->get(),
            'admissions' => Admission::with(['bed.ward', 'doctor:id,name'])->where('patient_id', $patient->id)->latest('id')->limit(20)->get(),
            'prescriptions' => Prescription::with(['items', 'doctor:id,name'])->where('patient_id', $patient->id)->latest('id')->limit(30)->get(),
            'lab_orders' => LabOrder::with(['items.test', 'doctor:id,name'])->where('patient_id', $patient->id)->latest('id')->limit(30)->get(),
            'invoices' => $user->hasRole(User::ROLE_ADMIN, User::ROLE_RECEPTIONIST, User::ROLE_ACCOUNTANT)
                ? Invoice::where('patient_id', $patient->id)->latest('id')->limit(30)->get(['id', 'number', 'status', 'total', 'paid', 'currency', 'created_at'])
                : [],
        ]);
    }

    public function update(Request $request, Patient $patient): JsonResponse
    {
        $data = $this->validated($request, true);
        $patient->update($data);

        return response()->json($this->row($patient));
    }

    /** Give the patient a portal account to see their own records and book visits. */
    public function portal(Request $request, Patient $patient): JsonResponse
    {
        $tenantId = $request->user()->tenant_id;
        $data = $request->validate([
            'email' => ['required', 'email', 'max:255', Rule::unique('users', 'email')->where('tenant_id', $tenantId)],
            'password' => ['required', Password::min(8)],
        ]);
        abort_if($patient->user_id, 422, 'This patient already has a portal account.');

        $user = new User(['name' => $patient->name, 'email' => strtolower($data['email']), 'phone' => $patient->phone, 'password' => $data['password']]);
        $user->role = User::ROLE_PATIENT;
        $user->tenant_id = $tenantId;
        $user->save();

        $patient->user_id = $user->id;
        $patient->email ??= $user->email;
        $patient->save();

        ActivityLog::record('patient.portal', "Created a portal account for {$patient->name}", ['patient_id' => $patient->id]);

        return response()->json(['id' => $user->id, 'email' => $user->email], 201);
    }

    public function export(): \Symfony\Component\HttpFoundation\StreamedResponse
    {
        $rows = Patient::orderBy('id')->get()->map(fn (Patient $p) => [
            $p->mrn, $p->first_name, $p->last_name, $p->gender, $p->date_of_birth?->toDateString(), $p->phone, $p->email,
            $p->blood_group, $p->insurance_provider, $p->insurance_number, $p->is_active ? 'active' : 'inactive', $p->created_at?->toDateString(),
        ]);

        return Csv::download('patients.csv', ['MRN', 'First name', 'Last name', 'Gender', 'Date of birth', 'Phone', 'Email', 'Blood group', 'Insurance', 'Policy no.', 'Status', 'Registered'], $rows);
    }

    protected function validated(Request $request, bool $partial = false): array
    {
        $req = $partial ? 'sometimes' : 'required';

        return $request->validate([
            'first_name' => [$req, 'string', 'max:80'],
            'last_name' => [$req, 'string', 'max:80'],
            'gender' => ['nullable', Rule::in(['male', 'female', 'other'])],
            'date_of_birth' => ['nullable', 'date', 'before_or_equal:today'],
            'phone' => ['nullable', 'string', 'max:30'],
            'email' => ['nullable', 'email', 'max:255'],
            'address' => ['nullable', 'string', 'max:300'],
            'blood_group' => ['nullable', Rule::in(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])],
            'allergies' => ['nullable', 'string', 'max:2000'],
            'chronic_conditions' => ['nullable', 'string', 'max:2000'],
            'emergency_contact_name' => ['nullable', 'string', 'max:120'],
            'emergency_contact_phone' => ['nullable', 'string', 'max:30'],
            'insurance_provider' => ['nullable', 'string', 'max:120'],
            'insurance_number' => ['nullable', 'string', 'max:60'],
            'notes' => ['nullable', 'string', 'max:5000'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
    }

    public static function row(Patient $p): array
    {
        return $p->only([
            'id', 'mrn', 'first_name', 'last_name', 'name', 'gender', 'age', 'phone', 'email', 'address', 'blood_group',
            'allergies', 'chronic_conditions', 'emergency_contact_name', 'emergency_contact_phone',
            'insurance_provider', 'insurance_number', 'notes', 'is_active', 'user_id', 'created_at',
        ]) + ['date_of_birth' => $p->date_of_birth?->toDateString()];
    }
}
