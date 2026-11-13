<?php

namespace App\Http\Controllers\Api\Hospital;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\Medicine;
use App\Models\Prescription;
use App\Models\StockMovement;
use App\Services\Hospital;
use App\Support\Csv;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Medicine inventory and dispensing prescriptions.
 */
class PharmacyController extends Controller
{
    public function __construct(protected Hospital $hospital) {}

    public function medicines(Request $request): JsonResponse
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'filter' => ['nullable', Rule::in(['low', 'expiring', 'expired', 'inactive'])],
        ]);

        $rows = Medicine::query()
            ->when($data['search'] ?? null, fn ($q, $s) => $q->where(fn ($q) => $q->where('name', 'like', "%{$s}%")->orWhere('generic_name', 'like', "%{$s}%")->orWhere('batch_no', 'like', "%{$s}%")))
            ->when(($data['filter'] ?? null) === 'low', fn ($q) => $q->whereColumn('stock', '<=', 'reorder_level')->where('is_active', true))
            ->when(($data['filter'] ?? null) === 'expiring', fn ($q) => $q->whereBetween('expiry_date', [today(), today()->addDays(90)]))
            ->when(($data['filter'] ?? null) === 'expired', fn ($q) => $q->where('expiry_date', '<', today()))
            ->when(($data['filter'] ?? null) === 'inactive', fn ($q) => $q->where('is_active', false), fn ($q) => $q->when(($data['filter'] ?? null) !== 'expired', fn ($q) => $q->where('is_active', true)))
            ->orderBy('name')->limit(500)->get();

        return response()->json([
            'data' => $rows,
            'stats' => [
                'items' => Medicine::where('is_active', true)->count(),
                'low' => Medicine::where('is_active', true)->whereColumn('stock', '<=', 'reorder_level')->count(),
                'expiring' => Medicine::whereBetween('expiry_date', [today(), today()->addDays(90)])->count(),
                'stock_value' => round((float) Medicine::where('is_active', true)->selectRaw('sum(stock * unit_price) as v')->value('v'), 2),
                'pending_prescriptions' => Prescription::whereIn('status', ['pending', 'partial'])->count(),
            ],
        ]);
    }

    public function storeMedicine(Request $request): JsonResponse
    {
        $data = $request->validate($this->medicineRules());
        $stock = (int) ($data['stock'] ?? 0);
        unset($data['stock']);

        $medicine = DB::transaction(function () use ($data, $stock, $request) {
            $m = Medicine::create($data + ['stock' => 0]);
            if ($stock > 0) {
                $this->move($m, 'purchase', $stock, 'Opening stock', null, $request->user()->id);
            }

            return $m;
        });

        return response()->json($medicine->fresh(), 201);
    }

    public function updateMedicine(Request $request, Medicine $medicine): JsonResponse
    {
        $data = $request->validate($this->medicineRules(true));
        unset($data['stock']); // stock changes only through movements
        $medicine->update($data);

        return response()->json($medicine);
    }

    /** Receive stock, write off, or correct a count. */
    public function adjust(Request $request, Medicine $medicine): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', Rule::in(['purchase', 'adjust', 'return', 'expired'])],
            'quantity' => ['required', 'integer', 'not_in:0', 'between:-100000,100000'],
            'reference' => ['nullable', 'string', 'max:120'],
            'note' => ['nullable', 'string', 'max:300'],
            'batch_no' => ['nullable', 'string', 'max:60'],
            'expiry_date' => ['nullable', 'date'],
        ]);

        $qty = in_array($data['type'], ['expired'], true) ? -abs($data['quantity']) : ($data['type'] === 'purchase' ? abs($data['quantity']) : $data['quantity']);

        DB::transaction(function () use ($medicine, $data, $qty, $request) {
            $this->move($medicine, $data['type'], $qty, $data['reference'] ?? null, $data['note'] ?? null, $request->user()->id);
            if (! empty($data['batch_no']) || ! empty($data['expiry_date'])) {
                $medicine->update(array_filter(['batch_no' => $data['batch_no'] ?? null, 'expiry_date' => $data['expiry_date'] ?? null]));
            }
        });

        return response()->json($medicine->fresh());
    }

    public function movements(Medicine $medicine): JsonResponse
    {
        return response()->json(['data' => StockMovement::with('user:id,name')->where('medicine_id', $medicine->id)->latest('id')->limit(100)->get()]);
    }

    public function prescriptions(Request $request): JsonResponse
    {
        $status = $request->validate(['status' => ['nullable', Rule::in(['open', 'dispensed', 'cancelled'])]])['status'] ?? 'open';

        $rows = Prescription::with(['patient', 'doctor:id,name', 'items.medicine:id,name,stock,unit_price'])
            ->when($status === 'open', fn ($q) => $q->whereIn('status', ['pending', 'partial']), fn ($q) => $q->where('status', $status))
            ->latest('id')->limit(100)->get();

        return response()->json(['data' => $rows]);
    }

    /**
     * Hand over medicines. Quantities per item; stock goes down and the patient's
     * bill gets the pharmacy lines.
     */
    public function dispense(Request $request, Prescription $prescription): JsonResponse
    {
        abort_if(in_array($prescription->status, ['dispensed', 'cancelled'], true), 422, 'This prescription is already closed.');

        $data = $request->validate([
            'items' => ['required', 'array', 'min:1'],
            'items.*.id' => ['required', 'integer'],
            'items.*.quantity' => ['required', 'integer', 'min:0', 'max:10000'],
            'items.*.medicine_id' => ['nullable', 'integer'],
            'bill' => ['sometimes', 'boolean'],
        ]);

        DB::transaction(function () use ($prescription, $data, $request) {
            $items = $prescription->items()->get()->keyBy('id');
            $patient = $prescription->patient;

            foreach ($data['items'] as $row) {
                $item = $items[$row['id']] ?? null;
                if (! $item || $row['quantity'] <= 0) {
                    continue;
                }
                // The pharmacist can match a free-text item to stock.
                if (! $item->medicine_id && ! empty($row['medicine_id'])) {
                    $item->medicine_id = Medicine::findOrFail($row['medicine_id'])->id;
                }
                $medicine = $item->medicine_id ? Medicine::lockForUpdate()->find($item->medicine_id) : null;
                if (! $medicine) {
                    throw ValidationException::withMessages(["items" => "Pick a stock item for {$item->medicine_name} before dispensing."]);
                }
                if ($medicine->stock < $row['quantity']) {
                    throw ValidationException::withMessages(["items" => "Only {$medicine->stock} of {$medicine->name} in stock."]);
                }

                $this->move($medicine, 'dispense', -$row['quantity'], 'Rx #'.$prescription->id, $patient?->name, $request->user()->id);
                $item->dispensed_qty += $row['quantity'];
                $item->save();

                if (($data['bill'] ?? true) && $patient) {
                    $this->hospital->charge($patient, 'pharmacy', trim($medicine->name.' '.$medicine->strength), (float) $medicine->unit_price, $row['quantity'], $prescription);
                }
            }

            $fresh = $prescription->items()->get();
            $prescription->status = $fresh->every(fn ($i) => $i->dispensed_qty >= $i->quantity) ? 'dispensed'
                : ($fresh->sum('dispensed_qty') > 0 ? 'partial' : 'pending');
            $prescription->dispensed_by = $request->user()->id;
            $prescription->dispensed_at = now();
            $prescription->save();
        });

        ActivityLog::record('pharmacy.dispensed', "Dispensed prescription #{$prescription->id}", ['prescription_id' => $prescription->id]);

        return response()->json($prescription->fresh(['patient', 'doctor:id,name', 'items.medicine:id,name,stock,unit_price']));
    }

    public function cancel(Prescription $prescription): JsonResponse
    {
        abort_if($prescription->status === 'dispensed', 422, 'A dispensed prescription can’t be cancelled.');
        $prescription->update(['status' => 'cancelled']);

        return response()->json(['status' => 'cancelled']);
    }

    public function export(): \Symfony\Component\HttpFoundation\StreamedResponse
    {
        $rows = Medicine::orderBy('name')->get()->map(fn (Medicine $m) => [
            $m->name, $m->generic_name, $m->form, $m->strength, $m->category, $m->batch_no, $m->expiry_date?->toDateString(),
            $m->unit_price, $m->stock, $m->reorder_level, $m->is_active ? 'active' : 'inactive',
        ]);

        return Csv::download('medicines.csv', ['Name', 'Generic', 'Form', 'Strength', 'Category', 'Batch', 'Expiry', 'Unit price', 'Stock', 'Reorder level', 'Status'], $rows);
    }

    protected function move(Medicine $m, string $type, int $qty, ?string $reference, ?string $note, ?int $userId): void
    {
        $balance = $m->stock + $qty;
        if ($balance < 0) {
            throw ValidationException::withMessages(['quantity' => "Stock can’t go below zero (currently {$m->stock})."]);
        }
        $m->stock = $balance;
        $m->save();

        StockMovement::create([
            'medicine_id' => $m->id, 'user_id' => $userId, 'type' => $type, 'quantity' => $qty,
            'balance' => $balance, 'reference' => $reference, 'note' => $note,
        ]);
    }

    protected function medicineRules(bool $partial = false): array
    {
        return [
            'name' => [$partial ? 'sometimes' : 'required', 'string', 'max:160'],
            'generic_name' => ['nullable', 'string', 'max:160'],
            'form' => ['nullable', 'string', 'max:30'],
            'strength' => ['nullable', 'string', 'max:40'],
            'category' => ['nullable', 'string', 'max:60'],
            'manufacturer' => ['nullable', 'string', 'max:120'],
            'batch_no' => ['nullable', 'string', 'max:60'],
            'expiry_date' => ['nullable', 'date'],
            'unit_price' => [$partial ? 'sometimes' : 'required', 'numeric', 'min:0', 'max:1000000'],
            'stock' => ['nullable', 'integer', 'min:0', 'max:10000000'],
            'reorder_level' => ['nullable', 'integer', 'min:0', 'max:1000000'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
