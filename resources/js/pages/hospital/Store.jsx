import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api, session } from '../../lib/api';
import { date, dateTime, money } from '../../lib/format';
import { STORE_CATEGORIES } from '../../lib/hms';
import StatTiles from '../../components/StatTiles';
import { Badge, Button, EmptyState, Field, IconButton, Modal, PageHeader, Skeleton, Tabs, useToast } from '../../components/ui';

const PO_STATUS = { draft: ['Awaiting approval', 'warning'], approved: ['Approved', 'draft'], partial: ['Part received', 'published'], received: ['Received', 'success'], cancelled: ['Cancelled', 'neutral'] };
const MOVE = { issue: 'Issue to department', return: 'Return from department', receive: 'Receive (no PO)', adjust: 'Stock count adjustment', wastage: 'Write off / wastage' };

export async function download(path, tenant, filename) {
    const res = await fetch(`/api/${path}`, { headers: { 'X-Tenant': tenant, Authorization: `Bearer ${session.token(tenant)}` } });
    if (!res.ok) throw new Error('Download failed');
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
}

export default function Store() {
    const { tenant, me } = useOutletContext();
    const role = me.user.role;
    const currency = me.tenant.settings?.currency ?? 'USD';
    const [tab, setTab] = useState('items');
    return (
        <div>
            <PageHeader title="Store & purchasing" description="Consumables and equipment stock, suppliers and purchase orders. Every order needs a second person to approve it." />
            <Tabs className="mt-6" value={tab} onChange={setTab} tabs={[{ value: 'items', label: 'Stock' }, { value: 'orders', label: 'Purchase orders' }, { value: 'suppliers', label: 'Suppliers' }]} />
            <div className="mt-5">
                {tab === 'items' && <Items tenant={tenant} role={role} currency={currency} />}
                {tab === 'orders' && <Orders tenant={tenant} me={me} currency={currency} />}
                {tab === 'suppliers' && <Suppliers tenant={tenant} role={role} />}
            </div>
        </div>
    );
}

const canStock = (role) => ['admin', 'storekeeper', 'pharmacist'].includes(role);

function Items({ tenant, role, currency }) {
    const toast = useToast();
    const [d, setD] = useState(null);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('');
    const [editing, setEditing] = useState(null);
    const [moving, setMoving] = useState(null);
    const [history, setHistory] = useState(null);
    const load = useCallback(() => {
        const qs = new URLSearchParams();
        if (search.trim()) qs.set('search', search.trim());
        if (filter) qs.set('filter', filter);
        return api(`store/items?${qs}`, { tenant }).then(setD);
    }, [tenant, search, filter]);
    useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

    return (
        <div>
            <StatTiles items={[
                { label: 'Items in stock list', value: d?.stats.items },
                { label: 'At or below reorder level', value: d?.stats.low, tone: d?.stats.low ? 'warning' : 'ink' },
                { label: 'Stock value', value: d ? money(d.stats.value, currency) : null },
                { label: 'Open purchase orders', value: d?.stats.open_orders },
            ]} />
            <div className="mt-5 flex flex-wrap items-center gap-2">
                {[['', 'All'], ['low', 'Reorder'], ['inactive', 'Archived']].map(([v, l]) => <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)} className={`rounded-full px-3.5 py-1.5 text-sm font-bold ring-1 ${filter === v ? 'bg-ink-deep text-white ring-ink-deep' : 'bg-white text-graphite ring-rule'}`}>{l}</button>)}
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Item name or code" aria-label="Search stock" className="ml-auto h-10 w-full rounded-lg border border-rule bg-white px-3 sm:w-64" />
                <Button variant="secondary" icon="download" onClick={() => download('store/exports/items.csv', tenant, 'store-items.csv').catch((e) => toast(e.message, 'error'))}>CSV</Button>
                {canStock(role) && <Button icon="plus" onClick={() => setEditing({})}>Add item</Button>}
            </div>
            <div className="mt-4">
                {!d ? <Skeleton className="h-64 rounded-2xl" /> : d.data.length === 0 ? <EmptyState icon="box" title="Nothing here yet">Add gloves, syringes, linen, reagents and equipment you want to track.</EmptyState> : (
                    <div className="overflow-x-auto rounded-2xl border border-rule bg-white">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-paper text-pencil"><tr><th className="p-3">Item</th><th className="p-3">Category</th><th className="p-3 text-right">In stock</th><th className="p-3 text-right">Reorder at</th><th className="p-3 text-right">Unit cost</th><th className="p-3">Location</th><th className="p-3" /></tr></thead>
                            <tbody className="divide-y divide-rule">
                                {d.data.map((i) => {
                                    const low = i.stock <= i.reorder_level;
                                    return (
                                        <tr key={i.id} className="hover:bg-paper/60">
                                            <td className="p-3"><b className="text-graphite">{i.name}</b>{i.code && <span className="block text-xs text-pencil">{i.code}</span>}</td>
                                            <td className="p-3 text-pencil">{STORE_CATEGORIES[i.category] ?? i.category}</td>
                                            <td className="p-3 text-right"><span className={`font-bold tabular-nums ${low ? 'text-margin' : 'text-graphite'}`}>{i.stock}</span> <span className="text-pencil">{i.unit}</span>{low && <span className="ml-1"><Badge tone="warning">Reorder</Badge></span>}</td>
                                            <td className="p-3 text-right tabular-nums text-pencil">{i.reorder_level}</td>
                                            <td className="p-3 text-right tabular-nums">{money(i.unit_cost, currency)}</td>
                                            <td className="p-3 text-pencil">{i.location}{i.expiry_date && <span className="block text-xs">exp {date(i.expiry_date)}</span>}</td>
                                            <td className="p-3"><div className="flex items-center justify-end gap-1">
                                                {canStock(role) && <Button size="sm" variant="secondary" onClick={() => setMoving(i)}>Move stock</Button>}
                                                <IconButton icon="clock" label="History" onClick={() => setHistory(i)} />
                                                {canStock(role) && <IconButton icon="edit" label="Edit" onClick={() => setEditing(i)} />}
                                            </div></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            {editing && <ItemDialog tenant={tenant} item={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); toast('Saved'); load(); }} />}
            {moving && <MoveDialog tenant={tenant} item={moving} onClose={() => setMoving(null)} onDone={() => { setMoving(null); toast('Stock updated'); load(); }} />}
            {history && <HistoryDialog tenant={tenant} item={history} onClose={() => setHistory(null)} />}
        </div>
    );
}

function ItemDialog({ tenant, item, onClose, onDone }) {
    const isNew = !item.id;
    const [f, setF] = useState({ name: item.name ?? '', code: item.code ?? '', category: item.category ?? 'consumable', unit: item.unit ?? 'pcs', reorder_level: item.reorder_level ?? 10, unit_cost: item.unit_cost ?? '', location: item.location ?? '', expiry_date: item.expiry_date ?? '', stock: '', is_active: item.is_active ?? true });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    async function save() {
        setBusy(true); setError(null);
        const body = { ...f, code: f.code || null, location: f.location || null, expiry_date: f.expiry_date || null, unit_cost: f.unit_cost === '' ? null : Number(f.unit_cost), reorder_level: Number(f.reorder_level || 0) };
        if (isNew) body.stock = f.stock === '' ? 0 : Number(f.stock); else delete body.stock;
        try { await api(isNew ? 'store/items' : `store/items/${item.id}`, { method: isNew ? 'POST' : 'PATCH', tenant, body }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title={isNew ? 'Add store item' : `Edit ${item.name}`}
            footer={<>{!isNew && <Button variant="ghost" className="mr-auto" onClick={() => setF({ ...f, is_active: !f.is_active })}>{f.is_active ? 'Archive' : 'Restore'}</Button>}<Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!f.name} onClick={save}>Save</Button></>}>
            <div className="grid gap-3 sm:grid-cols-2">
                <Field className="sm:col-span-2" label="Name" name="name" error={error} value={f.name} onChange={set('name')} />
                <Field label="Code / SKU" name="code" error={error} value={f.code} onChange={set('code')} />
                <Field label="Category" name="category" as="select" value={f.category} onChange={set('category')}>{Object.entries(STORE_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Field>
                <Field label="Unit" name="unit" error={error} value={f.unit} onChange={set('unit')} placeholder="box, pcs, pack" />
                <Field label="Reorder level" name="reorder_level" type="number" min={0} error={error} value={f.reorder_level} onChange={set('reorder_level')} />
                <Field label="Unit cost" name="unit_cost" type="number" step="0.01" min={0} error={error} value={f.unit_cost} onChange={set('unit_cost')} />
                <Field label="Location" name="location" error={error} value={f.location} onChange={set('location')} placeholder="Main store · shelf B2" />
                <Field label="Expiry" name="expiry_date" type="date" error={error} value={f.expiry_date} onChange={set('expiry_date')} />
                {isNew && <Field label="Opening stock" name="stock" type="number" min={0} error={error} value={f.stock} onChange={set('stock')} />}
                {!f.is_active && <p className="text-sm text-margin sm:col-span-2">This item will be archived when you save.</p>}
            </div>
        </Modal>
    );
}

function useDepartments(tenant) {
    const [rows, setRows] = useState([]);
    useEffect(() => { api('departments', { tenant }).then((r) => setRows(r.data ?? r)).catch(() => {}); }, [tenant]);
    return rows;
}

function MoveDialog({ tenant, item, onClose, onDone }) {
    const departments = useDepartments(tenant);
    const [f, setF] = useState({ type: 'issue', quantity: '', department_id: '', reference: '', note: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    async function save() {
        setBusy(true); setError(null);
        try { await api(`store/items/${item.id}/move`, { method: 'POST', tenant, body: { type: f.type, quantity: Number(f.quantity), department_id: f.department_id ? Number(f.department_id) : null, reference: f.reference || null, note: f.note || null } }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title={`Move stock · ${item.name}`} description={`${item.stock} ${item.unit ?? ''} in stock now`}
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!f.quantity || (f.type === 'issue' && !f.department_id)} onClick={save}>Save</Button></>}>
            <div className="space-y-3">
                <Field label="What happened" name="type" as="select" value={f.type} onChange={set('type')}>{Object.entries(MOVE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Field>
                <Field label={f.type === 'adjust' ? 'Change (+ or −)' : 'Quantity'} name="quantity" type="number" error={error} value={f.quantity} onChange={set('quantity')} />
                {['issue', 'return'].includes(f.type) && (
                    <Field label="Department" name="department_id" as="select" error={error} value={f.department_id} onChange={set('department_id')}>
                        <option value="">Choose…</option>{departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </Field>
                )}
                <Field label="Reference" name="reference" error={error} value={f.reference} onChange={set('reference')} placeholder="Requisition or delivery note no." />
                <Field label="Note" name="note" error={error} value={f.note} onChange={set('note')} />
            </div>
        </Modal>
    );
}

function HistoryDialog({ tenant, item, onClose }) {
    const [rows, setRows] = useState(null);
    useEffect(() => { api(`store/items/${item.id}/movements`, { tenant }).then((r) => setRows(r.data)); }, [tenant, item.id]);
    return (
        <Modal open size="lg" onClose={onClose} title={`Stock history · ${item.name}`}>
            {!rows ? <Skeleton className="h-40" /> : rows.length === 0 ? <p className="text-pencil">No movements yet.</p> : (
                <table className="w-full text-left text-sm">
                    <thead className="text-pencil"><tr><th className="py-2">When</th><th>Type</th><th className="text-right">Qty</th><th className="text-right">Balance</th><th className="pl-3">Where / ref</th></tr></thead>
                    <tbody className="divide-y divide-rule">
                        {rows.map((m) => <tr key={m.id}><td className="py-2 text-pencil">{dateTime(m.created_at)}</td><td className="capitalize">{m.type}</td><td className={`text-right font-bold tabular-nums ${m.quantity < 0 ? 'text-margin' : 'text-leaf'}`}>{m.quantity > 0 ? '+' : ''}{m.quantity}</td><td className="text-right tabular-nums">{m.balance}</td><td className="pl-3 text-pencil">{[m.department?.name, m.reference, m.user?.name].filter(Boolean).join(' · ')}</td></tr>)}
                    </tbody>
                </table>
            )}
        </Modal>
    );
}

function Orders({ tenant, me, currency }) {
    const toast = useToast();
    const role = me.user.role;
    const [status, setStatus] = useState('open');
    const [rows, setRows] = useState(null);
    const [creating, setCreating] = useState(false);
    const [receiving, setReceiving] = useState(null);
    const load = useCallback(() => api(`store/orders?status=${status}`, { tenant }).then((r) => setRows(r.data)), [tenant, status]);
    useEffect(() => { load(); }, [load]);

    async function act(po, action) {
        try { await api(`store/orders/${po.id}/${action}`, { method: 'POST', tenant }); toast(action === 'approve' ? 'Approved' : 'Cancelled'); load(); } catch (e) { toast(e.message, 'error'); }
    }
    const approver = ['admin', 'accountant'].includes(role);

    return (
        <div>
            <div className="flex flex-wrap items-center gap-2">
                {[['open', 'Open'], ['received', 'Received'], ['cancelled', 'Cancelled']].map(([v, l]) => <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatus(v)} className={`rounded-full px-3.5 py-1.5 text-sm font-bold ring-1 ${status === v ? 'bg-ink-deep text-white ring-ink-deep' : 'bg-white text-graphite ring-rule'}`}>{l}</button>)}
                {canStock(role) && <Button className="ml-auto" icon="plus" onClick={() => setCreating(true)}>New purchase order</Button>}
            </div>
            <div className="mt-4">
                {!rows ? <Skeleton className="h-48 rounded-2xl" /> : rows.length === 0 ? <EmptyState icon="receipt" title="No purchase orders here" /> : (
                    <ul className="space-y-3">
                        {rows.map((po) => (
                            <li key={po.id} className="rounded-2xl border border-rule bg-white p-5">
                                <div className="flex flex-wrap items-center gap-2">
                                    <b className="font-display text-ink-deep">{po.number}</b>
                                    <span className="text-graphite">{po.supplier?.name}</span>
                                    <Badge tone={PO_STATUS[po.status][1]}>{PO_STATUS[po.status][0]}</Badge>
                                    <span className="ml-auto font-display text-lg font-bold tabular-nums text-ink-deep">{money(po.total, currency)}</span>
                                </div>
                                <p className="mt-1 text-sm text-pencil">Raised by {po.creator?.name} · {dateTime(po.created_at)}{po.approver ? ` · approved by ${po.approver.name}` : ''}{po.expected_on ? ` · expected ${date(po.expected_on)}` : ''}</p>
                                <ul className="mt-3 flex flex-wrap gap-2 text-sm">
                                    {po.items.map((l) => <li key={l.id} className="rounded-lg bg-paper px-2.5 py-1 ring-1 ring-rule"><b>{l.description}</b> · {l.received_qty}/{l.quantity} @ {money(l.unit_cost, currency)}</li>)}
                                </ul>
                                {po.notes && <p className="mt-2 text-sm text-pencil">{po.notes}</p>}
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {po.status === 'draft' && approver && (po.creator?.id === me.user.id
                                        ? <span className="text-sm text-pencil">Someone else must approve an order you raised.</span>
                                        : <Button size="sm" onClick={() => act(po, 'approve')}>Approve</Button>)}
                                    {['approved', 'partial'].includes(po.status) && canStock(role) && <Button size="sm" onClick={() => setReceiving(po)}>Receive goods</Button>}
                                    {['draft', 'approved'].includes(po.status) && approver && <Button size="sm" variant="ghost" onClick={() => act(po, 'cancel')}>Cancel</Button>}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            {creating && <OrderDialog tenant={tenant} currency={currency} onClose={() => setCreating(false)} onDone={() => { setCreating(false); toast('Purchase order raised · waiting for approval'); load(); }} />}
            {receiving && <ReceiveDialog tenant={tenant} po={receiving} onClose={() => setReceiving(null)} onDone={() => { setReceiving(null); toast('Goods received · stock updated'); load(); }} />}
        </div>
    );
}

function OrderDialog({ tenant, currency, onClose, onDone }) {
    const [suppliers, setSuppliers] = useState([]);
    const [items, setItems] = useState([]);
    const [meds, setMeds] = useState([]);
    const [supplier, setSupplier] = useState('');
    const [expected, setExpected] = useState('');
    const [notes, setNotes] = useState('');
    const [lines, setLines] = useState([{ ref: '', quantity: 1, unit_cost: '' }]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        api('store/suppliers', { tenant }).then((r) => setSuppliers(r.data));
        api('store/items', { tenant }).then((r) => setItems(r.data));
        api('pharmacy/medicines', { tenant }).then((r) => setMeds(r.data ?? [])).catch(() => {});
    }, [tenant]);
    const setLine = (i, k, v) => setLines(lines.map((l, j) => {
        if (j !== i) return l;
        const next = { ...l, [k]: v };
        if (k === 'ref' && v && l.unit_cost === '') {
            const [kind, id] = v.split(':');
            const src = (kind === 'i' ? items : meds).find((x) => String(x.id) === id);
            next.unit_cost = kind === 'i' ? (src?.unit_cost ?? '') : (src?.cost_price ?? src?.unit_price ?? '');
        }
        return next;
    }));
    const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0);

    async function save() {
        setBusy(true); setError(null);
        const body = {
            supplier_id: Number(supplier), expected_on: expected || null, notes: notes || null,
            items: lines.filter((l) => l.ref).map((l) => { const [kind, id] = l.ref.split(':'); return { [kind === 'i' ? 'inventory_item_id' : 'medicine_id']: Number(id), quantity: Number(l.quantity), unit_cost: Number(l.unit_cost || 0) }; }),
        };
        try { await api('store/orders', { method: 'POST', tenant, body }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }

    return (
        <Modal open size="lg" onClose={onClose} title="New purchase order" description="An admin or accountant other than you approves it before goods can be received."
            footer={<><span className="mr-auto font-display text-lg font-bold text-ink-deep">{money(total, currency)}</span><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!supplier || !lines.some((l) => l.ref)} onClick={save}>Raise order</Button></>}>
            <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Supplier" name="supplier_id" as="select" error={error} value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                        <option value="">{suppliers.length ? 'Choose…' : 'Add a supplier first'}</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Field>
                    <Field label="Expected delivery" name="expected_on" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
                </div>
                <div className="space-y-2">
                    {lines.map((l, i) => (
                        <div key={i} className="grid grid-cols-[1fr_5.5rem_7rem_2.5rem] items-center gap-2">
                            <select aria-label="Item" value={l.ref} onChange={(e) => setLine(i, 'ref', e.target.value)} className="h-10 rounded-lg border border-rule bg-white px-2">
                                <option value="">Choose item…</option>
                                {items.length > 0 && <optgroup label="Store">{items.map((x) => <option key={`i${x.id}`} value={`i:${x.id}`}>{x.name} ({x.stock} {x.unit})</option>)}</optgroup>}
                                {meds.length > 0 && <optgroup label="Pharmacy">{meds.map((x) => <option key={`m${x.id}`} value={`m:${x.id}`}>{x.name} {x.strength ?? ''} ({x.stock})</option>)}</optgroup>}
                            </select>
                            <input aria-label="Quantity" type="number" min={1} value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} className="h-10 rounded-lg border border-rule px-2" />
                            <input aria-label="Unit cost" type="number" min={0} step="0.01" value={l.unit_cost} onChange={(e) => setLine(i, 'unit_cost', e.target.value)} placeholder="Unit cost" className="h-10 rounded-lg border border-rule px-2" />
                            <IconButton icon="x" label="Remove line" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [{ ref: '', quantity: 1, unit_cost: '' }])} />
                        </div>
                    ))}
                    {error?.errors?.items && <p className="text-sm text-margin">{error.errors.items[0]}</p>}
                    <Button size="sm" variant="secondary" icon="plus" onClick={() => setLines([...lines, { ref: '', quantity: 1, unit_cost: '' }])}>Add line</Button>
                </div>
                <Field label="Notes" name="notes" as="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
        </Modal>
    );
}

function ReceiveDialog({ tenant, po, onClose, onDone }) {
    const [rows, setRows] = useState(po.items.map((l) => ({ id: l.id, quantity: Math.max(0, l.quantity - l.received_qty), batch_no: '', expiry_date: '', med: !!l.medicine_id, line: l })));
    const [reference, setReference] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
    async function save() {
        setBusy(true); setError(null);
        try {
            await api(`store/orders/${po.id}/receive`, { method: 'POST', tenant, body: { reference: reference || null, items: rows.map((r) => ({ id: r.id, quantity: Number(r.quantity || 0), batch_no: r.batch_no || null, expiry_date: r.expiry_date || null })) } });
            onDone();
        } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open size="lg" onClose={onClose} title={`Receive · ${po.number}`} description={`${po.supplier?.name} · stock and a pending expense are created automatically`}
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Receive</Button></>}>
            <div className="space-y-3">
                {rows.map((r, i) => (
                    <div key={r.id} className="rounded-xl border border-rule p-3">
                        <p className="font-bold text-graphite">{r.line.description} <span className="font-normal text-pencil">· {r.line.received_qty} of {r.line.quantity} received</span></p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-3">
                            <input aria-label="Quantity received" type="number" min={0} value={r.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} className="h-10 rounded-lg border border-rule px-2" />
                            <input aria-label="Batch number" value={r.batch_no} onChange={(e) => set(i, 'batch_no', e.target.value)} placeholder={r.med ? 'Batch no.' : 'Batch (optional)'} className="h-10 rounded-lg border border-rule px-2" />
                            <input aria-label="Expiry date" type="date" value={r.expiry_date} onChange={(e) => set(i, 'expiry_date', e.target.value)} className="h-10 rounded-lg border border-rule px-2" />
                        </div>
                    </div>
                ))}
                {error?.errors?.items && <p className="text-sm text-margin">{error.errors.items[0]}</p>}
                {error && !error.errors?.items && <p className="text-sm text-margin">{error.message}</p>}
                <Field label="Delivery note / invoice no." name="reference" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
        </Modal>
    );
}

function Suppliers({ tenant, role }) {
    const toast = useToast();
    const [rows, setRows] = useState(null);
    const [editing, setEditing] = useState(null);
    const load = useCallback(() => api('store/suppliers?all=1', { tenant }).then((r) => setRows(r.data)), [tenant]);
    useEffect(() => { load(); }, [load]);
    return (
        <div>
            {canStock(role) && <div className="mb-4 flex justify-end"><Button icon="plus" onClick={() => setEditing({})}>Add supplier</Button></div>}
            {!rows ? <Skeleton className="h-40 rounded-2xl" /> : rows.length === 0 ? <EmptyState icon="building" title="No suppliers yet" /> : (
                <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {rows.map((s) => (
                        <li key={s.id} className={`rounded-2xl border border-rule bg-white p-4 ${s.is_active ? '' : 'opacity-60'}`}>
                            <div className="flex items-start gap-2"><b className="flex-1 text-graphite">{s.name}</b>{canStock(role) && <IconButton icon="edit" label="Edit" onClick={() => setEditing(s)} />}</div>
                            <p className="text-sm text-pencil">{[s.contact_person, s.phone, s.email].filter(Boolean).join(' · ')}</p>
                            {s.address && <p className="text-sm text-pencil">{s.address}</p>}
                            {s.payment_terms_days != null && <p className="mt-1 text-xs font-semibold text-graphite">Pays in {s.payment_terms_days} days</p>}
                        </li>
                    ))}
                </ul>
            )}
            {editing && <SupplierDialog tenant={tenant} supplier={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); toast('Saved'); load(); }} />}
        </div>
    );
}

function SupplierDialog({ tenant, supplier, onClose, onDone }) {
    const isNew = !supplier.id;
    const keys = ['name', 'contact_person', 'phone', 'email', 'address', 'tax_id', 'payment_terms_days'];
    const [f, setF] = useState(Object.fromEntries(keys.map((k) => [k, supplier[k] ?? ''])));
    const [active, setActive] = useState(supplier.is_active ?? true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function save() {
        setBusy(true); setError(null);
        const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : k === 'payment_terms_days' ? Number(v) : v]));
        if (!isNew) body.is_active = active;
        try { await api(isNew ? 'store/suppliers' : `store/suppliers/${supplier.id}`, { method: isNew ? 'POST' : 'PATCH', tenant, body }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    const L = { name: 'Company name', contact_person: 'Contact person', phone: 'Phone', email: 'Email', address: 'Address', tax_id: 'Tax ID', payment_terms_days: 'Payment terms (days)' };
    return (
        <Modal open onClose={onClose} title={isNew ? 'Add supplier' : supplier.name}
            footer={<>{!isNew && <Button variant="ghost" className="mr-auto" onClick={() => setActive(!active)}>{active ? 'Deactivate' : 'Reactivate'}</Button>}<Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!f.name} onClick={save}>Save</Button></>}>
            <div className="grid gap-3 sm:grid-cols-2">
                {keys.map((k) => <Field key={k} className={k === 'name' || k === 'address' ? 'sm:col-span-2' : ''} label={L[k]} name={k} type={k === 'payment_terms_days' ? 'number' : k === 'email' ? 'email' : 'text'} error={error} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />)}
                {!active && <p className="text-sm text-margin sm:col-span-2">This supplier will be hidden from new orders.</p>}
            </div>
        </Modal>
    );
}
