<?php

namespace App\Http\Controllers\Api\Hospital;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\Admission;
use App\Models\FluidEntry;
use App\Models\Medicine;
use App\Models\MedicationAdministration;
use App\Models\MedicationOrder;
use App\Models\NursingNote;
use App\Models\PatientAllergy;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

/**
 * Ward nursing: inpatient medication orders and the eMAR, nursing notes and
 * handover, and fluid balance. Blueprint §6.2.
 */
class NursingController extends Controller
{
    /** Everything for one admission on one day. */
    public function show(Request $request, Admission $admission): JsonResponse
    {
        $day = Carbon::parse($request->query('date', today()->toDateString()))->startOfDay();
        $orders = MedicationOrder::with(['prescriber:id,name', 'administrations' => fn ($q) => $q->with('user:id,name')->where('recorded_at', '>=', $day->copy()->subDay())])
            ->where('admission_id', $admission->id)->orderByRaw("case status when 'active' then 0 else 1 end")->latest('id')->get();

        $fluids = FluidEntry::with('user:id,name')->where('admission_id', $admission->id)->whereBetween('recorded_at', [$day, $day->copy()->endOfDay()])->orderBy('recorded_at')->get();

        return response()->json([
            'admission' => $admission->load(['patient', 'bed.ward', 'doctor:id,name']),
            'allergies' => PatientAllergy::where('patient_id', $admission->patient_id)->where('status', 'active')->get(['allergen', 'severity', 'reaction']),
            'date' => $day->toDateString(),
            'orders' => $orders->map(fn (MedicationOrder $o) => $o->toArray() + ['doses' => $this->doses($o, $day)]),
            'notes' => NursingNote::with('user:id,name,role')->where('admission_id', $admission->id)->latest('id')->limit(60)->get(),
            'fluids' => [
                'entries' => $fluids,
                'intake' => (int) $fluids->where('direction', 'intake')->sum('volume_ml'),
                'output' => (int) $fluids->where('direction', 'output')->sum('volume_ml'),
            ],
        ]);
    }

    /** Doses due across the ward in the next/last two hours (the medication round). */
    public function due(): JsonResponse
    {
        $from = now()->subHours(2);
        $to = now()->addHours(2);
        $rows = [];

        $orders = MedicationOrder::with(['patient', 'admission.bed.ward', 'administrations' => fn ($q) => $q->where('recorded_at', '>=', today()->subDay())])
            ->where('status', 'active')->whereHas('admission', fn ($q) => $q->where('status', 'admitted'))->get();

        foreach ($orders as $o) {
            foreach ([today()->subDay(), today(), today()->addDay()] as $day) {
                foreach ($this->doses($o, $day) as $dose) {
                    $at = Carbon::parse($dose['at']);
                    if ($at->between($from, $to) && ! $dose['record']) {
                        $rows[] = [
                            'order_id' => $o->id, 'at' => $dose['at'], 'overdue' => $at->lt(now()->subMinutes(30)),
                            'medicine' => $o->medicine_name, 'dose' => $o->dose, 'route' => $o->route,
                            'patient' => $o->patient?->only('id', 'name', 'mrn'),
                            'bed' => $o->admission?->bed ? $o->admission->bed->ward?->name.' · '.$o->admission->bed->number : null,
                            'admission_id' => $o->admission_id,
                        ];
                    }
                }
            }
        }

        return response()->json(['data' => collect($rows)->sortBy('at')->values()]);
    }

    public function storeOrder(Request $request, Admission $admission): JsonResponse
    {
        abort_unless($admission->status === 'admitted', 422, 'This patient has been discharged.');
        $data = $request->validate([
            'medicine_id' => ['nullable', 'integer'],
            'medicine_name' => ['required_without:medicine_id', 'nullable', 'string', 'max:160'],
            'dose' => ['required', 'string', 'max:60'],
            'route' => ['nullable', Rule::in(['oral', 'iv', 'im', 'sc', 'inhaled', 'topical', 'sublingual', 'rectal', 'other'])],
            'frequency' => ['required', Rule::in(array_keys(MedicationOrder::FREQUENCIES))],
            'times' => ['nullable', 'array'],
            'times.*' => ['date_format:H:i'],
            'starts_at' => ['nullable', 'date'],
            'ends_at' => ['nullable', 'date', 'after:starts_at'],
            'instructions' => ['nullable', 'string', 'max:300'],
        ]);

        $medicine = ! empty($data['medicine_id']) ? Medicine::findOrFail($data['medicine_id']) : null;
        $name = $medicine ? trim($medicine->name.' '.$medicine->strength) : $data['medicine_name'];

        // Allergy check: warn unless the prescriber confirms.
        $clash = PatientAllergy::where('patient_id', $admission->patient_id)->where('status', 'active')->where('type', 'drug')->get()
            ->first(fn ($a) => stripos($name, $a->allergen) !== false || ($medicine?->generic_name && stripos($medicine->generic_name, $a->allergen) !== false));
        if ($clash && ! $request->boolean('override_allergy')) {
            abort(409, "Allergy alert: the patient is allergic to {$clash->allergen} ({$clash->severity}). Confirm to prescribe anyway.");
        }

        $order = MedicationOrder::create([
            'admission_id' => $admission->id,
            'patient_id' => $admission->patient_id,
            'medicine_id' => $medicine?->id,
            'medicine_name' => $name,
            'dose' => $data['dose'],
            'route' => $data['route'] ?? 'oral',
            'frequency' => $data['frequency'],
            'times' => $data['times'] ?? MedicationOrder::FREQUENCIES[$data['frequency']],
            'starts_at' => $data['starts_at'] ?? now(),
            'ends_at' => $data['ends_at'] ?? null,
            'instructions' => $data['instructions'] ?? null,
            'ordered_by' => $request->user()->id,
        ]);

        ActivityLog::record('nursing.order', "Ordered {$name} {$order->dose} {$order->frequency} for {$admission->patient->name}".($clash ? ' (allergy overridden)' : ''), ['admission_id' => $admission->id]);

        return response()->json($order, 201);
    }

    public function stopOrder(Request $request, MedicationOrder $order): JsonResponse
    {
        $order->update(['status' => 'stopped', 'ends_at' => now(), 'stopped_by' => $request->user()->id]);

        return response()->json($order);
    }

    /** Record a dose: given, held, refused or missed (with a reason unless given). */
    public function administer(Request $request, MedicationOrder $order): JsonResponse
    {
        abort_unless($order->status === 'active', 422, 'This order has been stopped.');
        $data = $request->validate([
            'scheduled_for' => ['nullable', 'date'],
            'status' => ['required', Rule::in(['given', 'held', 'refused', 'missed'])],
            'dose_given' => ['nullable', 'string', 'max:60'],
            'reason' => ['required_unless:status,given', 'nullable', 'string', 'max:300'],
        ]);

        if (! empty($data['scheduled_for'])) {
            $at = Carbon::parse($data['scheduled_for'])->second(0);
            abort_if(MedicationAdministration::where('medication_order_id', $order->id)->where('scheduled_for', $at)->exists(), 422, 'This dose is already recorded.');
            $data['scheduled_for'] = $at;
        }

        $rec = MedicationAdministration::create($data + [
            'medication_order_id' => $order->id,
            'recorded_at' => now(),
            'user_id' => $request->user()->id,
            'dose_given' => $data['dose_given'] ?? ($data['status'] === 'given' ? $order->dose : null),
        ]);

        if ($order->frequency === 'STAT' && $data['status'] === 'given') {
            $order->update(['status' => 'completed']);
        }

        return response()->json($rec->load('user:id,name'), 201);
    }

    public function storeNote(Request $request, Admission $admission): JsonResponse
    {
        $data = $request->validate([
            'type' => ['nullable', Rule::in(['note', 'handover', 'assessment', 'care_plan'])],
            'shift' => ['nullable', Rule::in(['morning', 'evening', 'night'])],
            'body' => ['required', 'string', 'max:10000'],
            'assessment' => ['nullable', 'array'],
            'assessment.falls_risk' => ['nullable', Rule::in(['low', 'medium', 'high'])],
            'assessment.pressure_risk' => ['nullable', Rule::in(['low', 'medium', 'high'])],
            'assessment.pain' => ['nullable', 'integer', 'between:0,10'],
            'assessment.mobility' => ['nullable', Rule::in(['independent', 'assisted', 'bedbound'])],
            'assessment.news2' => ['nullable', 'integer', 'between:0,20'],
        ]);

        $note = NursingNote::create($data + ['admission_id' => $admission->id, 'user_id' => $request->user()->id]);

        return response()->json($note->load('user:id,name,role'), 201);
    }

    public function storeFluid(Request $request, Admission $admission): JsonResponse
    {
        $data = $request->validate([
            'direction' => ['required', Rule::in(['intake', 'output'])],
            'route' => ['required', Rule::in(['oral', 'iv', 'ng', 'urine', 'drain', 'vomit', 'stool', 'other'])],
            'volume_ml' => ['required', 'integer', 'min:1', 'max:20000'],
            'recorded_at' => ['nullable', 'date'],
        ]);

        $entry = FluidEntry::create($data + ['admission_id' => $admission->id, 'recorded_at' => $data['recorded_at'] ?? now(), 'user_id' => $request->user()->id]);

        return response()->json($entry->load('user:id,name'), 201);
    }

    /**
     * Scheduled doses for an order on a day, each with its record if charted.
     *
     * @return array<int, array{at: string, record: ?array}>
     */
    protected function doses(MedicationOrder $o, Carbon $day): array
    {
        $records = $o->administrations->whereNotNull('scheduled_for')->keyBy(fn ($a) => $a->scheduled_for->format('Y-m-d H:i'));
        $out = [];
        foreach ($o->times ?? [] as $t) {
            $at = $day->copy()->setTimeFromTimeString($t);
            if ($at->lt($o->starts_at->copy()->startOfMinute()) || ($o->ends_at && $at->gt($o->ends_at)) || $o->status !== 'active' && ! isset($records[$at->format('Y-m-d H:i')])) {
                continue;
            }
            $rec = $records[$at->format('Y-m-d H:i')] ?? null;
            $out[] = ['at' => $at->format('Y-m-d H:i'), 'record' => $rec?->toArray()];
        }

        return $out;
    }
}
