<?php

namespace App\Http\Controllers\Api\Hospital;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\ChartAccessLog;
use App\Models\Encounter;
use App\Models\Immunization;
use App\Models\Patient;
use App\Models\PatientAllergy;
use App\Models\PatientDocument;
use App\Models\PatientHistory;
use App\Models\PatientMedication;
use App\Models\PatientProblem;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * The longitudinal health record (EHR): problem list, allergies, current
 * medicines, immunizations, history, documents, vitals trend and who has
 * opened the chart.
 */
class EhrController extends Controller
{
    /** type => [model, who may write, owner column, validation rules] */
    protected function types(): array
    {
        $clinical = [User::ROLE_ADMIN, User::ROLE_DOCTOR, User::ROLE_NURSE];

        return [
            'problems' => [PatientProblem::class, $clinical, 'recorded_by', [
                'name' => ['required', 'string', 'max:200'],
                'icd_code' => ['nullable', 'string', 'max:20'],
                'status' => ['nullable', Rule::in(['active', 'chronic', 'resolved'])],
                'onset_date' => ['nullable', 'date', 'before_or_equal:today'],
                'resolved_date' => ['nullable', 'date'],
                'notes' => ['nullable', 'string', 'max:1000'],
            ]],
            'allergies' => [PatientAllergy::class, $clinical, 'recorded_by', [
                'allergen' => ['required', 'string', 'max:160'],
                'type' => ['nullable', Rule::in(['drug', 'food', 'environment', 'other'])],
                'reaction' => ['nullable', 'string', 'max:300'],
                'severity' => ['nullable', Rule::in(['mild', 'moderate', 'severe', 'life_threatening'])],
                'status' => ['nullable', Rule::in(['active', 'inactive'])],
            ]],
            'medications' => [PatientMedication::class, $clinical, 'recorded_by', [
                'name' => ['required', 'string', 'max:160'],
                'dose' => ['nullable', 'string', 'max:60'],
                'frequency' => ['nullable', 'string', 'max:60'],
                'route' => ['nullable', 'string', 'max:30'],
                'started_on' => ['nullable', 'date'],
                'stopped_on' => ['nullable', 'date'],
                'status' => ['nullable', Rule::in(['active', 'stopped'])],
                'notes' => ['nullable', 'string', 'max:500'],
            ]],
            'immunizations' => [Immunization::class, $clinical, 'given_by', [
                'vaccine' => ['required', 'string', 'max:160'],
                'dose_no' => ['nullable', 'integer', 'min:1', 'max:20'],
                'given_on' => ['required', 'date', 'before_or_equal:today'],
                'lot_no' => ['nullable', 'string', 'max:60'],
                'site' => ['nullable', 'string', 'max:40'],
                'next_due_on' => ['nullable', 'date'],
                'notes' => ['nullable', 'string', 'max:500'],
            ]],
            'documents' => [PatientDocument::class, [...$clinical, User::ROLE_RECEPTIONIST, User::ROLE_LAB], 'uploaded_by', [
                'title' => ['required', 'string', 'max:200'],
                'category' => ['nullable', Rule::in(['report', 'scan', 'referral', 'consent', 'discharge', 'id', 'insurance', 'other'])],
                'file_url' => ['required', 'url:http,https', 'max:500'],
                'document_date' => ['nullable', 'date'],
                'notes' => ['nullable', 'string', 'max:500'],
            ]],
        ];
    }

    public function show(Request $request, Patient $patient): JsonResponse
    {
        $vitals = Encounter::where('patient_id', $patient->id)->whereNotNull('vitals')->latest('id')->limit(30)->get(['id', 'vitals', 'created_at'])
            ->filter(fn ($e) => ! empty($e->vitals))->reverse()->values()
            ->map(fn ($e) => ['at' => $e->created_at] + $e->vitals);

        return response()->json([
            'problems' => PatientProblem::with('recorder:id,name')->where('patient_id', $patient->id)->orderByRaw("case status when 'resolved' then 1 else 0 end")->latest('id')->get(),
            'allergies' => PatientAllergy::with('recorder:id,name')->where('patient_id', $patient->id)->orderByRaw("case status when 'active' then 0 else 1 end")->latest('id')->get(),
            'medications' => PatientMedication::with('recorder:id,name')->where('patient_id', $patient->id)->orderByRaw("case status when 'active' then 0 else 1 end")->latest('id')->get(),
            'immunizations' => Immunization::with('giver:id,name')->where('patient_id', $patient->id)->latest('given_on')->get(),
            'history' => PatientHistory::with('editor:id,name')->where('patient_id', $patient->id)->first(),
            'documents' => PatientDocument::with('uploader:id,name')->where('patient_id', $patient->id)->latest('id')->get(),
            'vitals' => $vitals,
            'can' => [
                'clinical' => $request->user()->hasRole(User::ROLE_ADMIN, User::ROLE_DOCTOR, User::ROLE_NURSE),
                'documents' => $request->user()->hasRole(User::ROLE_ADMIN, User::ROLE_DOCTOR, User::ROLE_NURSE, User::ROLE_RECEPTIONIST, User::ROLE_LAB),
                'audit' => $request->user()->hasRole(User::ROLE_ADMIN),
            ],
        ]);
    }

    public function store(Request $request, Patient $patient, string $type): JsonResponse
    {
        [$class, $roles, $owner, $rules] = $this->resolve($type);
        abort_unless($request->user()->hasRole(...$roles), 403, 'You can’t change this part of the record.');

        $data = $request->validate($rules);
        $row = new $class($data);
        $row->patient_id = $patient->id;
        $row->{$owner} = $request->user()->id;
        $row->save();

        ActivityLog::record("ehr.{$type}", 'Added '.rtrim($type, 's')." to {$patient->name}'s record", ['patient_id' => $patient->id]);

        return response()->json($row->fresh(), 201);
    }

    public function update(Request $request, string $type, int $id): JsonResponse
    {
        [$class, $roles, , $rules] = $this->resolve($type);
        abort_unless($request->user()->hasRole(...$roles), 403, 'You can’t change this part of the record.');
        $row = $class::findOrFail($id);

        $partial = collect($rules)->map(fn ($r) => array_map(fn ($x) => $x === 'required' ? 'sometimes' : $x, $r))->all();
        $data = $request->validate($partial);
        if (($data['status'] ?? null) === 'resolved' && $row instanceof PatientProblem && empty($data['resolved_date'])) {
            $data['resolved_date'] = today();
        }
        if (($data['status'] ?? null) === 'stopped' && $row instanceof PatientMedication && empty($data['stopped_on'])) {
            $data['stopped_on'] = today();
        }
        $row->update($data);

        return response()->json($row->fresh());
    }

    public function destroy(Request $request, string $type, int $id): JsonResponse
    {
        [$class, $roles] = $this->resolve($type);
        abort_unless($request->user()->hasRole(User::ROLE_ADMIN, User::ROLE_DOCTOR) && $request->user()->hasRole(...$roles), 403, 'Only a doctor or admin can delete record entries.');
        $row = $class::findOrFail($id);
        $row->delete();
        ActivityLog::record("ehr.{$type}.deleted", 'Deleted a '.rtrim($type, 's').' entry', ['patient_id' => $row->patient_id]);

        return response()->json(null, 204);
    }

    public function saveHistory(Request $request, Patient $patient): JsonResponse
    {
        abort_unless($request->user()->hasRole(User::ROLE_ADMIN, User::ROLE_DOCTOR, User::ROLE_NURSE), 403);
        $data = $request->validate([
            'past_medical' => ['nullable', 'string', 'max:5000'],
            'surgical' => ['nullable', 'string', 'max:5000'],
            'family' => ['nullable', 'string', 'max:5000'],
            'obstetric' => ['nullable', 'string', 'max:5000'],
            'social' => ['nullable', 'array'],
            'social.smoking' => ['nullable', Rule::in(['never', 'former', 'current'])],
            'social.alcohol' => ['nullable', Rule::in(['none', 'occasional', 'regular'])],
            'social.occupation' => ['nullable', 'string', 'max:120'],
            'social.marital_status' => ['nullable', 'string', 'max:30'],
            'social.exercise' => ['nullable', 'string', 'max:120'],
            'social.diet' => ['nullable', 'string', 'max:120'],
            'social.notes' => ['nullable', 'string', 'max:1000'],
        ]);

        $history = PatientHistory::firstOrNew(['patient_id' => $patient->id]);
        $history->fill($data);
        $history->updated_by = $request->user()->id;
        $history->save();

        return response()->json($history->load('editor:id,name'));
    }

    /** Who opened this chart (admins only). */
    public function accessLog(Patient $patient): JsonResponse
    {
        return response()->json(['data' => ChartAccessLog::with('user:id,name,role')->where('patient_id', $patient->id)->latest('id')->limit(200)->get()]);
    }

    /** Called when a chart is opened. One entry per person per chart per 15 minutes. */
    public static function logAccess(Patient $patient, User $user, string $action = 'viewed'): void
    {
        $recent = ChartAccessLog::where('patient_id', $patient->id)->where('user_id', $user->id)->where('action', $action)
            ->where('created_at', '>=', now()->subMinutes(15))->exists();
        if (! $recent) {
            ChartAccessLog::create(['patient_id' => $patient->id, 'user_id' => $user->id, 'action' => $action, 'ip' => request()?->ip()]);
        }
    }

    protected function resolve(string $type): array
    {
        $types = $this->types();
        abort_unless(isset($types[$type]), 404);

        return $types[$type];
    }
}
