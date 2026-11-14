<?php

namespace App\Http\Controllers\Api\Hospital;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\Expense;
use App\Models\InventoryItem;
use App\Models\InventoryMovement;
use App\Models\Medicine;
use App\Models\PurchaseOrder;
use App\Models\Service;
use App\Models\StockMovement;
use App\Models\Supplier;
use App\Models\User;
use App\Support\Csv;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Medical store and procurement: suppliers, consumables stock, issue to
 * departments, purchase orders with two-person approval, goods receipt.
 * Also the hospital's service price list. Blueprint §8.3, §15.1, §17.2.
 */
class StoreController extends Controller
{
    public const CATEGORIES = ['consumable', 'surgical', 'linen', 'reagent', 'equipment', 'stationery', 'housekeeping', 'other'];

    /* ------------------------------------------------------------ suppliers */

    public function suppliers(Request $request): JsonResponse
    {
        return response()->json(['data' => Supplier::query()->when(! $request->boolean('all'), fn ($q) => $q->where('is_active', true))->orderBy('name')->get()]);
    }

    public function storeSupplier(Request $request): JsonResponse
    {
        return response()->json(Supplier::create(array_filter($request->validate($this->supplierRules()), fn ($v) => $v !== null)), 201);
    }

    public function updateSupplier(Request $request, Supplier $supplier): JsonResponse
    {
        $supplier->update($request->validate($this->supplierRules(true)));

        return response()->json($supplier);
    }

    /* ------------------------------------------------------------ items */

    public function items(Request $request): JsonResponse
    {
        $data = $request->validate(['search' => ['nullable', 'string', 'max:100'], 'filter' => ['nullable', Rule::in(['low', 'inactive'])], 'category' => ['nullable', Rule::in(self::CATEGORIES)]]);
        $rows = InventoryItem::query()
            ->when($data['search'] ?? null, fn ($q, $s) => $q->where(fn ($q) => $q->where('name', 'like', "%{$s}%")->orWhere('code', 'like', "%{$s}%")))
            ->when($data['category'] ?? null, fn ($q, $c) => $q->where('category', $c))
            ->when(($data['filter'] ?? null) === 'low', fn ($q) => $q->whereColumn('stock', '<=', 'reorder_level'))
            ->where('is_active', ($data['filter'] ?? null) !== 'inactive')
            ->orderBy('name')->limit(1000)->get();

        return response()->json([
            'data' => $rows,
            'stats' => [
                'items' => InventoryItem::where('is_active', true)->count(),
                'low' => InventoryItem::where('is_active', true)->whereColumn('stock', '<=', 'reorder_level')->count(),
                'value' => round((float) InventoryItem::where('is_active', true)->selectRaw('sum(stock * unit_cost) as v')->value('v'), 2),
                'open_orders' => PurchaseOrder::whereIn('status', ['draft', 'approved', 'partial'])->count(),
            ],
        ]);
    }

    public function storeItem(Request $request): JsonResponse
    {
        $data = $request->validate($this->itemRules() + ['stock' => ['nullable', 'integer', 'min:0']]);
        $stock = (int) ($data['stock'] ?? 0);
        unset($data['stock']);
        $data = array_filter($data, fn ($v) => $v !== null);

        $item = DB::transaction(function () use ($data, $stock, $request) {
            $item = InventoryItem::create($data);
            if ($stock > 0) {
                $this->move($item, 'receive', $stock, 'Opening stock', null, null, $request->user()->id);
            }

            return $item;
        });

        return response()->json($item->fresh(), 201);
    }

    public function updateItem(Request $request, InventoryItem $item): JsonResponse
    {
        $item->update($request->validate($this->itemRules(true)));

        return response()->json($item);
    }

    /** Issue to a department, return, adjust a count or write off. */
    public function moveItem(Request $request, InventoryItem $item): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', Rule::in(['receive', 'issue', 'return', 'adjust', 'wastage'])],
            'quantity' => ['required', 'integer', 'not_in:0', 'between:-1000000,1000000'],
            'department_id' => ['required_if:type,issue', 'nullable', 'integer', Rule::exists('departments', 'id')->where('tenant_id', $request->user()->tenant_id)],
            'reference' => ['nullable', 'string', 'max:120'],
            'note' => ['nullable', 'string', 'max:300'],
        ]);
        $qty = match ($data['type']) {
            'issue', 'wastage' => -abs($data['quantity']),
            'receive', 'return' => abs($data['quantity']),
            default => $data['quantity'],
        };

        DB::transaction(fn () => $this->move($item, $data['type'], $qty, $data['reference'] ?? null, $data['note'] ?? null, $data['department_id'] ?? null, $request->user()->id));

        return response()->json($item->fresh());
    }

    public function movements(InventoryItem $item): JsonResponse
    {
        return response()->json(['data' => InventoryMovement::with(['user:id,name', 'department:id,name'])->where('inventory_item_id', $item->id)->latest('id')->limit(100)->get()]);
    }

    public function exportItems(): \Symfony\Component\HttpFoundation\StreamedResponse
    {
        $rows = InventoryItem::orderBy('name')->get()->map(fn ($i) => [$i->code, $i->name, $i->category, $i->unit, $i->stock, $i->reorder_level, $i->unit_cost, $i->location, $i->is_active ? 'active' : 'inactive']);

        return Csv::download('store-items.csv', ['Code', 'Name', 'Category', 'Unit', 'Stock', 'Reorder level', 'Unit cost', 'Location', 'Status'], $rows);
    }

    /* ------------------------------------------------------------ purchase orders */

    public function orders(Request $request): JsonResponse
    {
        $status = $request->validate(['status' => ['nullable', Rule::in(['draft', 'approved', 'partial', 'received', 'cancelled', 'open'])]])['status'] ?? 'open';

        return response()->json(['data' => PurchaseOrder::with(['supplier:id,name', 'items', 'creator:id,name', 'approver:id,name'])
            ->when($status === 'open', fn ($q) => $q->whereIn('status', ['draft', 'approved', 'partial']), fn ($q) => $q->where('status', $status))
            ->latest('id')->limit(200)->get()]);
    }

    public function storeOrder(Request $request): JsonResponse
    {
        $data = $request->validate([
            'supplier_id' => ['required', 'integer', Rule::exists('suppliers', 'id')->where('tenant_id', $request->user()->tenant_id)],
            'expected_on' => ['nullable', 'date'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.medicine_id' => ['nullable', 'integer'],
            'items.*.inventory_item_id' => ['nullable', 'integer'],
            'items.*.description' => ['nullable', 'string', 'max:200'],
            'items.*.quantity' => ['required', 'integer', 'min:1', 'max:1000000'],
            'items.*.unit_cost' => ['required', 'numeric', 'min:0'],
        ]);

        $po = DB::transaction(function () use ($data, $request) {
            $po = PurchaseOrder::create([
                'supplier_id' => $data['supplier_id'], 'expected_on' => $data['expected_on'] ?? null, 'notes' => $data['notes'] ?? null,
                'number' => $this->nextNumber(), 'created_by' => $request->user()->id,
            ]);
            $total = 0;
            foreach ($data['items'] as $row) {
                $med = ! empty($row['medicine_id']) ? Medicine::findOrFail($row['medicine_id']) : null;
                $inv = ! $med && ! empty($row['inventory_item_id']) ? InventoryItem::findOrFail($row['inventory_item_id']) : null;
                if (! $med && ! $inv) {
                    throw ValidationException::withMessages(['items' => 'Each line needs a medicine or a store item.']);
                }
                $po->items()->create([
                    'medicine_id' => $med?->id, 'inventory_item_id' => $inv?->id,
                    'description' => $row['description'] ?? ($med ? trim($med->name.' '.$med->strength) : $inv->name),
                    'quantity' => $row['quantity'], 'unit_cost' => $row['unit_cost'],
                ]);
                $total += $row['quantity'] * $row['unit_cost'];
            }
            $po->update(['total' => round($total, 2)]);

            return $po;
        });

        ActivityLog::record('store.po', "Raised purchase order {$po->number} ({$po->total})", ['purchase_order_id' => $po->id]);

        return response()->json($po->load(['supplier:id,name', 'items', 'creator:id,name']), 201);
    }

    /** Two-person rule: whoever raised the order can't approve it. */
    public function approveOrder(Request $request, PurchaseOrder $order): JsonResponse
    {
        abort_unless($order->status === 'draft', 422, 'Only draft orders can be approved.');
        abort_if($order->created_by === $request->user()->id, 403, 'Someone other than the person who raised this order must approve it.');

        $order->update(['status' => 'approved', 'approved_by' => $request->user()->id, 'approved_at' => now()]);
        ActivityLog::record('store.po.approved', "Approved purchase order {$order->number}", ['purchase_order_id' => $order->id]);

        return response()->json($order->load(['supplier:id,name', 'items', 'creator:id,name', 'approver:id,name']));
    }

    public function cancelOrder(PurchaseOrder $order): JsonResponse
    {
        abort_unless(in_array($order->status, ['draft', 'approved'], true), 422, 'Orders with received goods can’t be cancelled.');
        $order->update(['status' => 'cancelled']);

        return response()->json($order);
    }

    /** Goods receipt: stock goes up (pharmacy or store) and a supplier bill is queued in Finance. */
    public function receiveOrder(Request $request, PurchaseOrder $order): JsonResponse
    {
        abort_unless(in_array($order->status, ['approved', 'partial'], true), 422, 'Approve the order before receiving goods.');
        $data = $request->validate([
            'items' => ['required', 'array', 'min:1'],
            'items.*.id' => ['required', 'integer'],
            'items.*.quantity' => ['required', 'integer', 'min:0'],
            'items.*.batch_no' => ['nullable', 'string', 'max:60'],
            'items.*.expiry_date' => ['nullable', 'date'],
            'reference' => ['nullable', 'string', 'max:120'],
        ]);

        $value = 0;
        DB::transaction(function () use ($order, $data, $request, &$value) {
            $lines = $order->items()->get()->keyBy('id');
            foreach ($data['items'] as $row) {
                $line = $lines[$row['id']] ?? null;
                if (! $line || $row['quantity'] <= 0) {
                    continue;
                }
                $left = $line->quantity - $line->received_qty;
                if ($row['quantity'] > $left) {
                    throw ValidationException::withMessages(['items' => "Only {$left} of {$line->description} are still due."]);
                }
                $ref = $order->number.($data['reference'] ?? null ? ' · '.$data['reference'] : '');
                if ($line->medicine_id) {
                    $med = Medicine::lockForUpdate()->findOrFail($line->medicine_id);
                    $med->stock += $row['quantity'];
                    $med->fill(array_filter(['batch_no' => $row['batch_no'] ?? null, 'expiry_date' => $row['expiry_date'] ?? null]));
                    $med->save();
                    StockMovement::create(['medicine_id' => $med->id, 'user_id' => $request->user()->id, 'type' => 'purchase', 'quantity' => $row['quantity'], 'balance' => $med->stock, 'reference' => $ref]);
                } else {
                    $item = InventoryItem::lockForUpdate()->findOrFail($line->inventory_item_id);
                    $item->unit_cost = $line->unit_cost;
                    if (! empty($row['expiry_date'])) {
                        $item->expiry_date = $row['expiry_date'];
                    }
                    $this->move($item, 'receive', $row['quantity'], $ref, null, null, $request->user()->id);
                }
                $line->received_qty += $row['quantity'];
                $line->save();
                $value += $row['quantity'] * (float) $line->unit_cost;
            }
            $all = $order->items()->get();
            $order->status = $all->every(fn ($l) => $l->received_qty >= $l->quantity) ? 'received' : 'partial';
            $order->save();

            if ($value > 0) {
                Expense::create([
                    'supplier_id' => $order->supplier_id, 'purchase_order_id' => $order->id, 'spent_on' => today(),
                    'category' => $all->contains(fn ($l) => $l->medicine_id) ? 'pharmacy_stock' : 'supplies',
                    'description' => "Goods received on {$order->number}", 'amount' => round($value, 2),
                    'reference' => $data['reference'] ?? null, 'created_by' => $request->user()->id,
                ]);
            }
        });

        ActivityLog::record('store.grn', "Received goods on {$order->number} worth ".round($value, 2), ['purchase_order_id' => $order->id]);

        return response()->json($order->load(['supplier:id,name', 'items', 'creator:id,name', 'approver:id,name']));
    }

    /* ------------------------------------------------------------ service price list */

    public function services(Request $request): JsonResponse
    {
        return response()->json(['data' => Service::with('department:id,name')
            ->when(! $request->boolean('all'), fn ($q) => $q->where('is_active', true))->orderBy('category')->orderBy('name')->get()]);
    }

    public function storeService(Request $request): JsonResponse
    {
        return response()->json(Service::create(array_filter($request->validate($this->serviceRules($request)), fn ($v) => $v !== null)), 201);
    }

    public function updateService(Request $request, Service $service): JsonResponse
    {
        $service->update($request->validate($this->serviceRules($request, true)));

        return response()->json($service);
    }

    /* ------------------------------------------------------------ helpers */

    protected function move(InventoryItem $item, string $type, int $qty, ?string $reference, ?string $note, ?int $department, ?int $userId): void
    {
        $balance = $item->stock + $qty;
        if ($balance < 0) {
            throw ValidationException::withMessages(['quantity' => "Only {$item->stock} {$item->unit} of {$item->name} in stock."]);
        }
        $item->stock = $balance;
        $item->save();
        InventoryMovement::create([
            'inventory_item_id' => $item->id, 'department_id' => $department, 'type' => $type, 'quantity' => $qty,
            'balance' => $balance, 'reference' => $reference, 'note' => $note, 'user_id' => $userId,
        ]);
    }

    protected function nextNumber(): string
    {
        $prefix = 'PO-'.now()->format('ym').'-';
        $n = PurchaseOrder::where('number', 'like', $prefix.'%')->count() + 1;
        do {
            $number = $prefix.str_pad((string) $n++, 4, '0', STR_PAD_LEFT);
        } while (PurchaseOrder::where('number', $number)->exists());

        return $number;
    }

    protected function supplierRules(bool $partial = false): array
    {
        return [
            'name' => [$partial ? 'sometimes' : 'required', 'string', 'max:160'],
            'contact_person' => ['nullable', 'string', 'max:120'],
            'phone' => ['nullable', 'string', 'max:30'],
            'email' => ['nullable', 'email', 'max:255'],
            'address' => ['nullable', 'string', 'max:300'],
            'tax_id' => ['nullable', 'string', 'max:60'],
            'payment_terms_days' => ['nullable', 'integer', 'min:0', 'max:365'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    protected function itemRules(bool $partial = false): array
    {
        return [
            'name' => [$partial ? 'sometimes' : 'required', 'string', 'max:160'],
            'code' => ['nullable', 'string', 'max:40'],
            'category' => ['nullable', Rule::in(self::CATEGORIES)],
            'unit' => ['nullable', 'string', 'max:20'],
            'reorder_level' => ['nullable', 'integer', 'min:0'],
            'unit_cost' => ['nullable', 'numeric', 'min:0'],
            'location' => ['nullable', 'string', 'max:80'],
            'expiry_date' => ['nullable', 'date'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    protected function serviceRules(Request $request, bool $partial = false): array
    {
        return [
            'name' => [$partial ? 'sometimes' : 'required', 'string', 'max:160'],
            'code' => ['nullable', 'string', 'max:30'],
            'category' => ['nullable', Rule::in(['procedure', 'consultation', 'nursing', 'package', 'emergency', 'other'])],
            'department_id' => ['nullable', 'integer', Rule::exists('departments', 'id')->where('tenant_id', $request->user()->tenant_id)],
            'price' => [$partial ? 'sometimes' : 'required', 'numeric', 'min:0'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
