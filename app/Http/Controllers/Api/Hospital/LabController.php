<?php

namespace App\Http\Controllers\Api\Hospital;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\LabOrder;
use App\Models\LabTest;
use App\Models\Patient;
use App\Models\User;
use App\Services\Hospital;
use App\Services\Notifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Laboratory and radiology: the test catalogue, orders, sample collection
 * and reporting results.
 */
class LabController extends Controller
{
    public function __construct(protected Hospital $hospital, protected Notifier $notifier) {}

    public function tests(Request $request): JsonResponse
    {
        return response()->json(['data' => LabTest::query()
            ->when(! $request->boolean('all'), fn ($q) => $q->where('is_active', true))
            ->orderBy('category')->orderBy('name')->get()]);
    }

    public function storeTest(Request $request): JsonResponse
    {
        return response()->json(LabTest::create($request->validate($this->testRules())), 201);
    }

    public function updateTest(Request $request, LabTest $test): JsonResponse
    {
        $test->update($request->validate($this->testRules(true)));

        return response()->json($test);
    }

    public function orders(Request $request): JsonResponse
    {
        $data = $request->validate([
            'status' => ['nullable', Rule::in(['ordered', 'collected', 'completed', 'cancelled', 'open'])],
            'search' => ['nullable', 'string', 'max:100'],
        ]);
        $status = $data['status'] ?? 'open';

        $rows = LabOrder::with(['patient', 'doctor:id,name', 'items.test', 'items.reporter:id,name'])
            ->when($status === 'open', fn ($q) => $q->whereIn('status', ['ordered', 'collected']), fn ($q) => $q->where('status', $status))
            ->when($data['search'] ?? null, fn ($q, $s) => $q->whereIn('patient_id', Patient::where('first_name', 'like', "%{$s}%")->orWhere('last_name', 'like', "%{$s}%")->orWhere('mrn', 'like', "%{$s}%")->select('id')))
            ->orderByRaw("case priority when 'stat' then 0 when 'urgent' then 1 else 2 end")
            ->latest('id')->limit(200)->get();

        return response()->json([
            'data' => $rows,
            'summary' => [
                'ordered' => LabOrder::where('status', 'ordered')->count(),
                'collected' => LabOrder::where('status', 'collected')->count(),
                'completed_today' => LabOrder::where('status', 'completed')->whereDate('completed_at', today())->count(),
            ],
        ]);
    }

    /** Order tests directly (walk-in lab patients, or doctors outside a consultation). */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'patient_id' => ['required', 'integer'],
            'lab_test_ids' => ['required', 'array', 'min:1', 'max:30'],
            'lab_test_ids.*' => ['integer'],
            'priority' => ['nullable', Rule::in(['routine', 'urgent', 'stat'])],
            'notes' => ['nullable', 'string', 'max:500'],
        ]);
        $patient = Patient::findOrFail($data['patient_id']);
        $tests = LabTest::whereIn('id', $data['lab_test_ids'])->where('is_active', true)->get();
        abort_if($tests->isEmpty(), 422, 'Choose at least one active test.');

        $order = DB::transaction(function () use ($data, $patient, $tests, $request) {
            $order = LabOrder::create([
                'patient_id' => $patient->id,
                'doctor_id' => $request->user()->hasRole(User::ROLE_DOCTOR) ? $request->user()->id : null,
                'priority' => $data['priority'] ?? 'routine',
                'notes' => $data['notes'] ?? null,
            ]);
            foreach ($tests as $test) {
                $order->items()->create(['lab_test_id' => $test->id]);
                $this->hospital->charge($patient, $test->category === 'radiology' ? 'radiology' : 'lab', $test->name, (float) $test->price, 1, $order);
            }

            return $order;
        });

        return response()->json($order->load(['patient', 'doctor:id,name', 'items.test']), 201);
    }

    public function collect(LabOrder $order): JsonResponse
    {
        abort_unless($order->status === 'ordered', 422, 'The sample is already collected.');
        $order->update(['status' => 'collected', 'collected_at' => now()]);

        return response()->json($order->load(['patient', 'doctor:id,name', 'items.test']));
    }

    /** Enter results. When every test has a result the order is complete. */
    public function report(Request $request, LabOrder $order): JsonResponse
    {
        abort_if($order->status === 'cancelled', 422, 'This order was cancelled.');
        $data = $request->validate([
            'items' => ['required', 'array', 'min:1'],
            'items.*.id' => ['required', 'integer'],
            'items.*.result' => ['nullable', 'string', 'max:2000'],
            'items.*.flag' => ['nullable', Rule::in(['normal', 'high', 'low', 'critical'])],
            'items.*.attachment_url' => ['nullable', 'url:http,https', 'max:500'],
        ]);

        DB::transaction(function () use ($order, $data, $request) {
            $items = $order->items()->get()->keyBy('id');
            foreach ($data['items'] as $row) {
                $item = $items[$row['id']] ?? null;
                if (! $item || (blank($row['result'] ?? null) && blank($row['attachment_url'] ?? null))) {
                    continue;
                }
                $item->fill(collect($row)->only(['result', 'flag', 'attachment_url'])->all());
                $item->reported_by = $request->user()->id;
                $item->reported_at = now();
                $item->save();
            }

            $done = $order->items()->get()->every(fn ($i) => $i->reported_at !== null);
            $order->status = $done ? 'completed' : ($order->status === 'ordered' ? 'collected' : $order->status);
            $order->collected_at ??= now();
            if ($done) {
                $order->completed_at = now();
            }
            $order->save();
        });

        $order->refresh();
        if ($order->status === 'completed') {
            $patient = $order->patient;
            $critical = $order->items()->where('flag', 'critical')->exists();
            if ($order->doctor_id) {
                $this->notifier->send($order->doctor_id, 'lab', ($critical ? '⚠ Critical result: ' : 'Results ready: ').$patient->name, 'Lab order #'.$order->id, '/patients/'.$patient->id);
            }
            if ($patient->user_id) {
                $this->notifier->send($patient->user_id, 'lab', 'Your test results are ready', null, '/my-health');
            }
            ActivityLog::record('lab.completed', "Reported lab order #{$order->id} for {$patient->name}", ['lab_order_id' => $order->id]);
        }

        return response()->json($order->load(['patient', 'doctor:id,name', 'items.test', 'items.reporter:id,name']));
    }

    public function cancel(LabOrder $order): JsonResponse
    {
        abort_if($order->status === 'completed', 422, 'A completed order can’t be cancelled.');
        $order->update(['status' => 'cancelled']);

        return response()->json(['status' => 'cancelled']);
    }

    public function show(LabOrder $order): JsonResponse
    {
        return response()->json($order->load(['patient', 'doctor:id,name', 'items.test', 'items.reporter:id,name']));
    }

    protected function testRules(bool $partial = false): array
    {
        return [
            'name' => [$partial ? 'sometimes' : 'required', 'string', 'max:160'],
            'code' => ['nullable', 'string', 'max:30'],
            'category' => ['sometimes', Rule::in(['lab', 'radiology'])],
            'sample_type' => ['nullable', 'string', 'max:40'],
            'unit' => ['nullable', 'string', 'max:30'],
            'normal_range' => ['nullable', 'string', 'max:120'],
            'price' => [$partial ? 'sometimes' : 'required', 'numeric', 'min:0', 'max:1000000'],
            'turnaround_hours' => ['nullable', 'integer', 'min:0', 'max:1000'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
