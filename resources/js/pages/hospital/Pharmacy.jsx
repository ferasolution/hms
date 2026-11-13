import { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api, download } from '../../lib/api';
import { date, dateTime, money } from '../../lib/format';
import { patientLine, RX_STATUS } from '../../lib/hms';
import Icon from '../../components/Icon';
import { Badge, Button, EmptyState, Field, IconButton, Modal, PageHeader, Skeleton, Tabs, useToast } from '../../components/ui';

export default function Pharmacy() {
    const { tenant, me } = useOutletContext();
    const toast = useToast();
    const canManage = ['admin', 'pharmacist'].includes(me.user.role);
    const currency = me.tenant.settings?.currency ?? 'USD';
    const [tab, setTab] = useState(canManage ? 'queue' : 'stock');

    return (
        <div>
            <PageHeader title="Pharmacy" description="Dispense prescriptions and keep stock." actions={canManage && tab === 'stock' && (
                <Button variant="secondary" icon="download" onClick={() => download('pharmacy/exports/medicines.csv', tenant, 'medicines.csv').catch((e) => toast(e.message, 'error'))}>Export stock</Button>
            )} />
            <Tabs className="mt-6" value={tab} onChange={setTab} tabs={[canManage && { value: 'queue', label: 'Prescriptions' }, { value: 'stock', label: 'Stock' }].filter(Boolean)} />
            <div className="mt-4">{tab === 'queue' ? <Queue tenant={tenant} currency={currency} /> : <Stock tenant={tenant} canManage={canManage} currency={currency} />}</div>
        </div>
    );
}

function Queue({ tenant, currency }) {
    const toast = useToast();
    const [status, setStatus] = useState('open');
    const [rows, setRows] = useState(null);
    const [dispensing, setDispensing] = useState(null);
    const load = useCallback(() => api(`pharmacy/prescriptions?status=${status}`, { tenant }).then((r) => setRows(r.data)), [tenant, status]);
    useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

    return (
        <div>
            <div className="flex gap-2">{[['open', 'To dispense'], ['dispensed', 'Dispensed'], ['cancelled', 'Cancelled']].map(([v, l]) => <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatus(v)} className={`rounded-full px-3.5 py-1.5 text-sm font-bold ring-1 ${status === v ? 'bg-ink-deep text-white ring-ink-deep' : 'bg-white text-graphite ring-rule'}`}>{l}</button>)}</div>
            <div className="mt-4">
                {!rows ? <Skeleton className="h-48 rounded-2xl" /> : rows.length === 0 ? <EmptyState icon="pill" title="Nothing waiting">New prescriptions from doctors appear here automatically.</EmptyState> : (
                    <ul className="space-y-3">
                        {rows.map((rx) => (
                            <li key={rx.id} className="rounded-2xl border border-rule bg-white p-5">
                                <div className="flex flex-wrap items-center gap-3">
                                    <Link to={`/${tenant}/patients/${rx.patient?.id}`} className="min-w-0 flex-1"><b className="text-graphite">{rx.patient?.name}</b><span className="block text-sm text-pencil">{patientLine(rx.patient)} · {rx.doctor?.name} · {dateTime(rx.created_at)}</span></Link>
                                    <Badge tone={RX_STATUS[rx.status][1]}>{RX_STATUS[rx.status][0]}</Badge>
                                    {['pending', 'partial'].includes(rx.status) && <Button size="sm" onClick={() => setDispensing(rx)}>Dispense</Button>}
                                </div>
                                {rx.patient?.allergies && <p className="mt-2 text-sm text-margin"><b>Allergies:</b> {rx.patient.allergies}</p>}
                                <ul className="mt-3 divide-y divide-rule rounded-xl bg-paper text-sm">
                                    {rx.items.map((i) => (
                                        <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                                            <b className="flex-1 text-graphite">{i.medicine_name}</b>
                                            <span className="text-pencil">{[i.dosage, i.frequency, i.duration_days && `${i.duration_days} d`].filter(Boolean).join(' · ')}</span>
                                            <span className="tabular-nums">{i.dispensed_qty}/{i.quantity}</span>
                                            {!i.medicine_id && <Badge tone="warning">Not in stock list</Badge>}
                                        </li>
                                    ))}
                                </ul>
                                {rx.notes && <p className="mt-2 text-sm text-pencil">{rx.notes}</p>}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            {dispensing && <DispenseDialog tenant={tenant} rx={dispensing} currency={currency} onClose={() => setDispensing(null)} onDone={() => { setDispensing(null); toast('Dispensed · added to the bill'); load(); }} />}
        </div>
    );
}

function DispenseDialog({ tenant, rx, currency, onClose, onDone }) {
    const toast = useToast();
    const [stock, setStock] = useState([]);
    const [rows, setRows] = useState(rx.items.map((i) => ({ id: i.id, quantity: Math.max(0, i.quantity - i.dispensed_qty), medicine_id: i.medicine_id ?? '' })));
    const [bill, setBill] = useState(true);
    const [busy, setBusy] = useState(false);
    useEffect(() => { api('pharmacy/medicines', { tenant }).then((r) => setStock(r.data)); }, [tenant]);
    const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
    const total = rows.reduce((sum, r) => sum + (Number(stock.find((m) => m.id === Number(r.medicine_id))?.unit_price) || 0) * (Number(r.quantity) || 0), 0);

    async function save() {
        setBusy(true);
        try {
            await api(`pharmacy/prescriptions/${rx.id}/dispense`, { method: 'POST', tenant, body: { bill, items: rows.map((r) => ({ id: r.id, quantity: Number(r.quantity) || 0, medicine_id: r.medicine_id ? Number(r.medicine_id) : null })) } });
            onDone();
        } catch (e) { toast(e.errors?.items?.[0] ?? e.message, 'error'); } finally { setBusy(false); }
    }

    return (
        <Modal open onClose={onClose} title={`Dispense for ${rx.patient?.name}`} size="lg"
            footer={<><span className="mr-auto font-bold tabular-nums">{money(total, currency)}</span><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Dispense</Button></>}>
            <div className="space-y-3">
                {rx.items.map((item, i) => {
                    const med = stock.find((m) => m.id === Number(rows[i].medicine_id));
                    return (
                        <div key={item.id} className="rounded-xl border border-rule p-3">
                            <p className="font-bold text-graphite">{item.medicine_name} <span className="font-normal text-pencil">· prescribed {item.quantity}, given {item.dispensed_qty}</span></p>
                            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_7rem]">
                                <select aria-label="Stock item" value={rows[i].medicine_id} onChange={(e) => set(i, 'medicine_id', e.target.value)} className="h-10 rounded-lg border border-rule bg-white px-3">
                                    <option value="">Choose stock item…</option>
                                    {stock.map((m) => <option key={m.id} value={m.id}>{m.name} {m.strength ?? ''} · {m.stock} in stock · {money(m.unit_price, currency)}</option>)}
                                </select>
                                <input aria-label="Quantity" type="number" min="0" value={rows[i].quantity} onChange={(e) => set(i, 'quantity', e.target.value)} className="h-10 rounded-lg border border-rule px-3" />
                            </div>
                            {med && Number(rows[i].quantity) > med.stock && <p className="mt-1 text-sm text-margin">Only {med.stock} in stock.</p>}
                        </div>
                    );
                })}
                <label className="flex items-center gap-2 font-bold text-graphite"><input type="checkbox" className="h-5 w-5 accent-ink" checked={bill} onChange={(e) => setBill(e.target.checked)} />Add to the patient’s bill</label>
            </div>
        </Modal>
    );
}

function Stock({ tenant, canManage, currency }) {
    const toast = useToast();
    const [filter, setFilter] = useState('');
    const [search, setSearch] = useState('');
    const [d, setD] = useState(null);
    const [editing, setEditing] = useState(null);
    const [adjusting, setAdjusting] = useState(null);
    const [history, setHistory] = useState(null);
    const load = useCallback(() => {
        const qs = new URLSearchParams();
        if (filter) qs.set('filter', filter);
        if (search.trim()) qs.set('search', search.trim());
        return api(`pharmacy/medicines?${qs}`, { tenant }).then(setD);
    }, [tenant, filter, search]);
    useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

    return (
        <div>
            {d && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[['Items', d.stats.items], ['Low stock', d.stats.low], ['Expiring in 90 days', d.stats.expiring], ['Stock value', money(d.stats.stock_value, currency)]].map(([l, v]) => (
                        <div key={l} className="rounded-2xl border border-rule bg-white p-4"><p className="text-sm text-pencil">{l}</p><p className={`font-display text-2xl font-bold ${(l === 'Low stock' || l.startsWith('Expiring')) && v ? 'text-margin' : 'text-ink-deep'}`}>{v}</p></div>
                    ))}
                </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
                {[['', 'All'], ['low', 'Low stock'], ['expiring', 'Expiring'], ['expired', 'Expired'], ['inactive', 'Inactive']].map(([v, l]) => <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)} className={`rounded-full px-3.5 py-1.5 text-sm font-bold ring-1 ${filter === v ? 'bg-ink-deep text-white ring-ink-deep' : 'bg-white text-graphite ring-rule'}`}>{l}</button>)}
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search medicine or batch" aria-label="Search medicines" className="ml-auto h-10 w-full rounded-lg border border-rule bg-white px-3 sm:w-64" />
                {canManage && <Button icon="plus" onClick={() => setEditing({})}>Add medicine</Button>}
            </div>
            <div className="mt-4">
                {!d ? <Skeleton className="h-48 rounded-2xl" /> : d.data.length === 0 ? <EmptyState icon="pill" title="No medicines here">{canManage ? 'Add medicines to your stock list.' : 'Nothing matches.'}</EmptyState> : (
                    <div className="overflow-x-auto rounded-2xl border border-rule bg-white">
                        <table className="w-full min-w-[42rem] text-left text-[15px]">
                            <thead className="border-b border-rule bg-paper text-sm text-pencil"><tr><th className="px-4 py-3">Medicine</th><th className="px-4 py-3">Batch · expiry</th><th className="px-4 py-3 text-right">Price</th><th className="px-4 py-3 text-right">Stock</th><th /></tr></thead>
                            <tbody className="divide-y divide-rule">
                                {d.data.map((m) => {
                                    const low = m.stock <= m.reorder_level;
                                    const expired = m.expiry_date && new Date(m.expiry_date) < new Date();
                                    return (
                                        <tr key={m.id}>
                                            <td className="px-4 py-2.5"><b className="text-graphite">{m.name} {m.strength}</b><span className="block text-sm text-pencil">{[m.generic_name, m.form, m.category].filter(Boolean).join(' · ')}</span></td>
                                            <td className="px-4 py-2.5 text-sm text-pencil">{m.batch_no ?? '—'}{m.expiry_date ? <span className={expired ? 'font-bold text-margin' : ''}> · {date(m.expiry_date)}</span> : ''}</td>
                                            <td className="px-4 py-2.5 text-right tabular-nums">{money(m.unit_price, currency)}</td>
                                            <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${low ? 'text-margin' : 'text-graphite'}`}>{m.stock}{low && <span className="block text-xs font-normal">reorder at {m.reorder_level}</span>}</td>
                                            <td className="px-2 py-2.5 text-right whitespace-nowrap">
                                                {canManage && <>
                                                    <Button size="sm" variant="secondary" onClick={() => setAdjusting(m)}>Stock</Button>
                                                    <IconButton icon="clock" label="History" onClick={() => setHistory(m)} />
                                                    <IconButton icon="edit" label="Edit" onClick={() => setEditing(m)} />
                                                </>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            {editing && <MedicineForm tenant={tenant} medicine={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); toast('Saved'); load(); }} />}
            {adjusting && <AdjustDialog tenant={tenant} medicine={adjusting} onClose={() => setAdjusting(null)} onDone={() => { setAdjusting(null); toast('Stock updated'); load(); }} />}
            {history && <HistoryDialog tenant={tenant} medicine={history} onClose={() => setHistory(null)} />}
        </div>
    );
}

function MedicineForm({ tenant, medicine, onClose, onDone }) {
    const keys = ['name', 'generic_name', 'form', 'strength', 'category', 'manufacturer', 'batch_no', 'expiry_date', 'unit_price', 'reorder_level'];
    const [f, setF] = useState({ ...Object.fromEntries(keys.map((k) => [k, medicine[k] ?? ''])), stock: '', is_active: medicine.is_active ?? true });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    async function save() {
        setBusy(true);
        setError(null);
        try {
            const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v]));
            body.unit_price = Number(f.unit_price || 0);
            if (body.reorder_level !== null) body.reorder_level = Number(body.reorder_level);
            if (medicine.id) delete body.stock; else body.stock = Number(f.stock || 0);
            await api(medicine.id ? `pharmacy/medicines/${medicine.id}` : 'pharmacy/medicines', { method: medicine.id ? 'PATCH' : 'POST', tenant, body });
            onDone();
        } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title={medicine.id ? 'Edit medicine' : 'Add a medicine'} size="lg"
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Brand / name" name="name" error={error} value={f.name} onChange={set('name')} />
                <Field label="Generic name" name="generic_name" error={error} value={f.generic_name} onChange={set('generic_name')} />
                <Field label="Form" name="form" error={error} value={f.form} onChange={set('form')} placeholder="tablet, syrup, injection…" />
                <Field label="Strength" name="strength" error={error} value={f.strength} onChange={set('strength')} placeholder="500 mg" />
                <Field label="Category" name="category" error={error} value={f.category} onChange={set('category')} />
                <Field label="Manufacturer" name="manufacturer" error={error} value={f.manufacturer} onChange={set('manufacturer')} />
                <Field label="Batch no." name="batch_no" error={error} value={f.batch_no} onChange={set('batch_no')} />
                <Field label="Expiry date" name="expiry_date" type="date" error={error} value={f.expiry_date?.slice?.(0, 10) ?? ''} onChange={set('expiry_date')} />
                <Field label="Price per unit" name="unit_price" type="number" min="0" step="0.01" error={error} value={f.unit_price} onChange={set('unit_price')} />
                <Field label="Reorder when stock reaches" name="reorder_level" type="number" min="0" error={error} value={f.reorder_level} onChange={set('reorder_level')} />
                {!medicine.id && <Field label="Opening stock" name="stock" type="number" min="0" error={error} value={f.stock} onChange={set('stock')} />}
                {medicine.id && <label className="flex items-center gap-2 font-bold text-graphite sm:col-span-2"><input type="checkbox" className="h-5 w-5 accent-ink" checked={!!f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />In use</label>}
            </div>
        </Modal>
    );
}

function AdjustDialog({ tenant, medicine, onClose, onDone }) {
    const [type, setType] = useState('purchase');
    const [quantity, setQuantity] = useState('');
    const [reference, setReference] = useState('');
    const [batch, setBatch] = useState('');
    const [expiry, setExpiry] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function save() {
        setBusy(true);
        setError(null);
        try { await api(`pharmacy/medicines/${medicine.id}/adjust`, { method: 'POST', tenant, body: { type, quantity: Number(quantity), reference: reference || null, note: note || null, batch_no: batch || null, expiry_date: expiry || null } }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title={`${medicine.name} ${medicine.strength ?? ''}`} description={`${medicine.stock} in stock now`}
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!quantity} onClick={save}>Save</Button></>}>
            <div className="space-y-4">
                <Field label="What happened" name="type" as="select" value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="purchase">Received stock (purchase)</option><option value="return">Returned by patient</option><option value="expired">Expired / damaged — write off</option><option value="adjust">Count correction (+ or −)</option>
                </Field>
                <Field label="Quantity" name="quantity" type="number" error={error} value={quantity} onChange={(e) => setQuantity(e.target.value)} hint={type === 'adjust' ? 'Use a minus sign to reduce.' : undefined} />
                {type === 'purchase' && <div className="grid gap-4 sm:grid-cols-2"><Field label="Batch no." name="batch_no" value={batch} onChange={(e) => setBatch(e.target.value)} /><Field label="Expiry" name="expiry_date" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div>}
                <Field label="Reference" name="reference" error={error} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Supplier invoice, PO number…" />
                <Field label="Note" name="note" error={error} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
        </Modal>
    );
}

function HistoryDialog({ tenant, medicine, onClose }) {
    const [rows, setRows] = useState(null);
    useEffect(() => { api(`pharmacy/medicines/${medicine.id}/movements`, { tenant }).then((r) => setRows(r.data)); }, [tenant, medicine.id]);
    return (
        <Modal open onClose={onClose} title={`Stock history · ${medicine.name}`} size="lg" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
            {!rows ? <Skeleton className="h-32" /> : rows.length === 0 ? <p className="text-pencil">No movements yet.</p> : (
                <ul className="divide-y divide-rule text-sm">
                    {rows.map((r) => (
                        <li key={r.id} className="flex items-center gap-3 py-2">
                            <span className="w-36 text-pencil">{dateTime(r.created_at)}</span>
                            <span className="flex-1"><b className="capitalize">{r.type}</b>{r.reference ? ` · ${r.reference}` : ''}{r.note ? ` · ${r.note}` : ''}<span className="block text-xs text-pencil">{r.user?.name}</span></span>
                            <span className={`font-bold tabular-nums ${r.quantity < 0 ? 'text-margin' : 'text-leaf'}`}>{r.quantity > 0 ? '+' : ''}{r.quantity}</span>
                            <span className="w-14 text-right tabular-nums text-pencil">{r.balance}</span>
                        </li>
                    ))}
                </ul>
            )}
        </Modal>
    );
}

export { Icon };
