<?php

namespace App\Services;

use App\Models\Admission;
use App\Models\Department;
use App\Models\InventoryItem;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\LabTest;
use App\Models\Medicine;
use App\Models\Patient;
use App\Models\Service;
use App\Models\Tenant;
use App\Models\Ward;
use App\Tenancy\TenantManager;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

/**
 * Shared hospital logic: record numbers, invoices and the starter catalogue
 * every new hospital gets.
 */
class Hospital
{
    public function __construct(protected TenantManager $tenants) {}

    public function currency(): string
    {
        return data_get($this->tenants->current()?->settings, 'currency') ?: 'USD';
    }

    /** Next medical record number for this hospital: MRN-000123. */
    public function nextMrn(): string
    {
        $last = Patient::query()->lockForUpdate()->orderByDesc('id')->value('mrn');
        $n = $last && preg_match('/(\d+)$/', $last, $m) ? (int) $m[1] + 1 : 1;

        do {
            $mrn = 'MRN-'.str_pad((string) $n++, 6, '0', STR_PAD_LEFT);
        } while (Patient::where('mrn', $mrn)->exists());

        return $mrn;
    }

    public function nextInvoiceNumber(): string
    {
        $prefix = 'INV-'.now()->format('ym').'-';
        $count = Invoice::where('number', 'like', $prefix.'%')->count() + 1;

        do {
            $number = $prefix.str_pad((string) $count++, 4, '0', STR_PAD_LEFT);
        } while (Invoice::where('number', $number)->exists());

        return $number;
    }

    /**
     * The patient's open bill: the admission's invoice while admitted, otherwise
     * today's unpaid OPD invoice, otherwise a new one.
     */
    public function openInvoice(Patient $patient, ?Admission $admission = null, ?int $userId = null): Invoice
    {
        $invoice = Invoice::where('patient_id', $patient->id)
            ->whereIn('status', ['unpaid', 'partial'])
            ->when($admission, fn ($q) => $q->where('admission_id', $admission->id),
                fn ($q) => $q->whereNull('admission_id')->whereDate('created_at', today()))
            ->latest('id')->first();

        if ($invoice) {
            return $invoice;
        }

        // An admitted patient's charges go on the admission bill.
        $admission ??= Admission::where('patient_id', $patient->id)->where('status', 'admitted')->latest('id')->first();
        if ($admission) {
            $existing = Invoice::where('admission_id', $admission->id)->whereIn('status', ['unpaid', 'partial'])->latest('id')->first();
            if ($existing) {
                return $existing;
            }
        }

        return Invoice::create([
            'patient_id' => $patient->id,
            'admission_id' => $admission?->id,
            'number' => $this->nextInvoiceNumber(),
            'status' => 'unpaid',
            'currency' => $this->currency(),
            'created_by' => $userId ?? auth()->id(),
        ]);
    }

    /** Add a line to the patient's open bill. Skipped when the amount is zero. */
    public function charge(Patient $patient, string $category, string $description, float $unitPrice, float $quantity = 1, ?Model $source = null, ?Admission $admission = null): ?Invoice
    {
        if ($unitPrice <= 0 || $quantity <= 0) {
            return null;
        }

        return DB::transaction(function () use ($patient, $category, $description, $unitPrice, $quantity, $source, $admission) {
            $invoice = $this->openInvoice($patient, $admission);
            $invoice->items()->create([
                'category' => $category,
                'description' => mb_substr($description, 0, 255),
                'quantity' => $quantity,
                'unit_price' => $unitPrice,
                'amount' => round($unitPrice * $quantity, 2),
                'source_type' => $source?->getMorphClass(),
                'source_id' => $source?->getKey(),
            ]);

            return $this->recalculate($invoice);
        });
    }

    public function recalculate(Invoice $invoice): Invoice
    {
        $subtotal = round((float) InvoiceItem::where('invoice_id', $invoice->id)->sum('amount'), 2);
        $paid = round((float) $invoice->payments()->sum('amount'), 2);
        $total = max(0, round($subtotal - (float) $invoice->discount + (float) $invoice->tax, 2));

        $invoice->subtotal = $subtotal;
        $invoice->total = $total;
        $invoice->paid = $paid;
        if ($invoice->status !== 'void') {
            $invoice->status = $paid <= 0 ? 'unpaid' : ($paid + 0.009 >= $total ? 'paid' : 'partial');
        }
        $invoice->save();

        return $invoice;
    }

    /** Departments, wards, lab tests and common medicines for a new hospital. */
    public function seedDefaults(Tenant $tenant): void
    {
        $this->tenants->runAs($tenant, function () {
            foreach ([
                ['General Medicine', 'MED'], ['Pediatrics', 'PED'], ['Obstetrics & Gynecology', 'OBG'], ['General Surgery', 'SUR'],
                ['Orthopedics', 'ORT'], ['Cardiology', 'CAR'], ['Emergency', 'ER'], ['Radiology', 'RAD'], ['Pathology', 'PAT'],
            ] as [$name, $code]) {
                Department::firstOrCreate(['name' => $name], ['code' => $code]);
            }

            foreach ([
                ['General Ward', 'general', 'Ground', 120, 10], ['Private Rooms', 'private', '1st', 300, 4],
                ['ICU', 'icu', '1st', 900, 4], ['Emergency', 'emergency', 'Ground', 200, 4],
            ] as [$name, $type, $floor, $rate, $beds]) {
                if (Ward::where('name', $name)->exists()) {
                    continue;
                }
                $ward = Ward::create(['name' => $name, 'type' => $type, 'floor' => $floor, 'daily_rate' => $rate]);
                $prefix = strtoupper(substr($type, 0, 1));
                for ($i = 1; $i <= $beds; $i++) {
                    $ward->beds()->create(['number' => $prefix.'-'.str_pad((string) $i, 2, '0', STR_PAD_LEFT)]);
                }
            }

            foreach ([
                ['Complete Blood Count', 'CBC', 'lab', 'Blood', null, null, 25],
                ['Fasting Blood Sugar', 'FBS', 'lab', 'Blood', 'mg/dL', '70–100', 10],
                ['HbA1c', 'HBA1C', 'lab', 'Blood', '%', '4.0–5.6', 35],
                ['Lipid Profile', 'LIPID', 'lab', 'Blood', null, null, 40],
                ['Liver Function Test', 'LFT', 'lab', 'Blood', null, null, 45],
                ['Renal Function Test', 'RFT', 'lab', 'Blood', null, null, 45],
                ['Thyroid Profile (TSH)', 'TSH', 'lab', 'Blood', 'mIU/L', '0.4–4.0', 30],
                ['Urinalysis', 'UA', 'lab', 'Urine', null, null, 15],
                ['Chest X-Ray', 'CXR', 'radiology', null, null, null, 60],
                ['Ultrasound Abdomen', 'USG-ABD', 'radiology', null, null, null, 120],
                ['ECG', 'ECG', 'radiology', null, null, null, 40],
            ] as [$name, $code, $cat, $sample, $unit, $range, $price]) {
                LabTest::firstOrCreate(['code' => $code], [
                    'name' => $name, 'category' => $cat, 'sample_type' => $sample, 'unit' => $unit,
                    'normal_range' => $range, 'price' => $price, 'turnaround_hours' => $cat === 'lab' ? 24 : 4,
                ]);
            }

            foreach ([
                ['Paracetamol', 'Acetaminophen', 'tablet', '500 mg', 'Analgesic', 0.10],
                ['Ibuprofen', 'Ibuprofen', 'tablet', '400 mg', 'NSAID', 0.15],
                ['Amoxicillin', 'Amoxicillin', 'capsule', '500 mg', 'Antibiotic', 0.40],
                ['Azithromycin', 'Azithromycin', 'tablet', '500 mg', 'Antibiotic', 1.20],
                ['Metformin', 'Metformin', 'tablet', '500 mg', 'Antidiabetic', 0.12],
                ['Amlodipine', 'Amlodipine', 'tablet', '5 mg', 'Antihypertensive', 0.20],
                ['Omeprazole', 'Omeprazole', 'capsule', '20 mg', 'Antacid', 0.25],
                ['Cetirizine', 'Cetirizine', 'tablet', '10 mg', 'Antihistamine', 0.10],
                ['Oral Rehydration Salts', 'ORS', 'sachet', '20.5 g', 'Electrolyte', 0.50],
                ['Normal Saline', 'Sodium chloride 0.9%', 'infusion', '500 ml', 'IV fluid', 2.50],
            ] as [$name, $generic, $form, $strength, $cat, $price]) {
                Medicine::firstOrCreate(['name' => $name, 'strength' => $strength], [
                    'generic_name' => $generic, 'form' => $form, 'category' => $cat, 'unit_price' => $price,
                    'stock' => 0, 'reorder_level' => 50,
                ]);
            }

            // Service price list: the ER registration fee and common bedside procedures.
            foreach ([
                ['Emergency registration & assessment', 'ER-01', 'emergency', 150],
                ['Wound dressing', 'PRC-01', 'nursing', 25],
                ['Suturing (simple)', 'PRC-02', 'procedure', 90],
                ['IV cannulation', 'NUR-01', 'nursing', 20],
                ['Nebulization', 'NUR-02', 'nursing', 15],
                ['Injection (IM / IV)', 'NUR-03', 'nursing', 10],
                ['Urinary catheterization', 'NUR-04', 'nursing', 35],
                ['Plaster cast', 'PRC-03', 'procedure', 120],
            ] as [$name, $code, $cat, $price]) {
                Service::firstOrCreate(['code' => $code], ['name' => $name, 'category' => $cat, 'price' => $price]);
            }

            // Main store starter list (stock starts at zero until the first delivery).
            foreach ([
                ['Nitrile gloves (M)', 'GLV-M', 'consumable', 'box', 20, 6.40],
                ['Syringe 5 ml', 'SYR-5', 'consumable', 'pcs', 500, 0.12],
                ['IV cannula 20G', 'CAN-20', 'consumable', 'pcs', 200, 0.65],
                ['Gauze swabs 10×10', 'GAU-10', 'surgical', 'pack', 50, 1.80],
                ['Surgical masks', 'MSK-S', 'consumable', 'box', 30, 4.50],
                ['Patient gown', 'LIN-GWN', 'linen', 'pcs', 60, 9.00],
                ['Bed sheet', 'LIN-SHT', 'linen', 'pcs', 80, 7.50],
                ['Hand sanitizer 500 ml', 'HSK-SAN', 'housekeeping', 'bottle', 40, 3.20],
            ] as [$name, $code, $cat, $unit, $reorder, $cost]) {
                InventoryItem::firstOrCreate(['code' => $code], ['name' => $name, 'category' => $cat, 'unit' => $unit, 'reorder_level' => $reorder, 'unit_cost' => $cost]);
            }
        });
    }
}
