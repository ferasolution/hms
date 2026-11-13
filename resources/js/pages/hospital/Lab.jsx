import { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api, upload } from '../../lib/api';
import { dateTime, money } from '../../lib/format';
import { FLAG_TONE, LAB_STATUS, patientLine } from '../../lib/hms';
import PatientPicker from '../../components/PatientPicker';
import { Badge, Button, EmptyState, Field, IconButton, Modal, PageHeader, Skeleton, Tabs, useToast } from '../../components/ui';

export default function Lab() {
    const { tenant, me } = useOutletContext();
    const role = me.user.role;
    const canReport = ['admin', 'lab_technician'].includes(role);
    const currency = me.tenant.settings?.currency ?? 'USD';
    const [tab, setTab] = useState('orders');
    return (
        <div>
            <PageHeader title="Lab & imaging" description={canReport ? 'Collect samples, enter results and keep the test list up to date.' : 'Test orders and results.'} />
            <Tabs className="mt-6" value={tab} onChange={setTab} tabs={[{ value: 'orders', label: 'Orders' }, { value: 'tests', label: 'Test list & prices' }]} />
            <div className="mt-4">{tab === 'orders' ? <Orders tenant={tenant} canReport={canReport} currency={currency} /> : <Tests tenant={tenant} canManage={canReport} currency={currency} />}</div>
        </div>
    );
}

function Orders({ tenant, canReport, currency }) {
    const toast = useToast();
    const [status, setStatus] = useState('open');
    const [search, setSearch] = useState('');
    const [d, setD] = useState(null);
    const [reporting, setReporting] = useState(null);
    const [ordering, setOrdering] = useState(false);
    const load = useCallback(() => {
        const qs = new URLSearchParams({ status });
        if (search.trim()) qs.set('search', search.trim());
        return api(`lab/orders?${qs}`, { tenant }).then(setD);
    }, [tenant, status, search]);
    useEffect(() => { const t = setTimeout(load, 200); const i = setInterval(load, 30000); return () => { clearTimeout(t); clearInterval(i); }; }, [load]);

    async function act(o, action) {
        try { await api(`lab/orders/${o.id}/${action}`, { method: 'POST', tenant }); toast(action === 'collect' ? 'Sample collected' : 'Cancelled'); load(); } catch (e) { toast(e.message, 'error'); }
    }

    return (
        <div>
            {d && (
                <div className="mb-4 grid grid-cols-3 gap-3">
                    {[['Awaiting sample', d.summary.ordered], ['In the lab', d.summary.collected], ['Reported today', d.summary.completed_today]].map(([l, v]) => <div key={l} className="rounded-2xl border border-rule bg-white p-4"><p className="text-sm text-pencil">{l}</p><p className="font-display text-2xl font-bold text-ink-deep">{v}</p></div>)}
                </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
                {[['open', 'Open'], ['completed', 'Reported'], ['cancelled', 'Cancelled']].map(([v, l]) => <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatus(v)} className={`rounded-full px-3.5 py-1.5 text-sm font-bold ring-1 ${status === v ? 'bg-ink-deep text-white ring-ink-deep' : 'bg-white text-graphite ring-rule'}`}>{l}</button>)}
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Patient name or MRN" aria-label="Search orders" className="ml-auto h-10 w-full rounded-lg border border-rule bg-white px-3 sm:w-64" />
                <Button icon="plus" onClick={() => setOrdering(true)}>Order tests</Button>
            </div>
            <div className="mt-4">
                {!d ? <Skeleton className="h-48 rounded-2xl" /> : d.data.length === 0 ? <EmptyState icon="flask" title="No orders here">Tests ordered by doctors appear here automatically.</EmptyState> : (
                    <ul className="space-y-3">
                        {d.data.map((o) => (
                            <li key={o.id} className="rounded-2xl border border-rule bg-white p-5">
                                <div className="flex flex-wrap items-center gap-3">
                                    <Link to={`/${tenant}/patients/${o.patient?.id}`} className="min-w-0 flex-1"><b className="text-graphite">{o.patient?.name}</b><span className="block text-sm text-pencil">{patientLine(o.patient)} · #{o.id} · {dateTime(o.created_at)}{o.doctor ? ` · ${o.doctor.name}` : ''}</span></Link>
                                    {o.priority !== 'routine' && <Badge tone="danger">{o.priority.toUpperCase()}</Badge>}
                                    <Badge tone={LAB_STATUS[o.status][1]}>{LAB_STATUS[o.status][0]}</Badge>
                                    {canReport && o.status === 'ordered' && <Button size="sm" variant="secondary" onClick={() => act(o, 'collect')}>Sample collected</Button>}
                                    {canReport && ['ordered', 'collected'].includes(o.status) && <Button size="sm" onClick={() => setReporting(o)}>Enter results</Button>}
                                    {canReport && o.status === 'completed' && <Button size="sm" variant="ghost" onClick={() => setReporting(o)}>Amend</Button>}
                                    {canReport && ['ordered', 'collected'].includes(o.status) && <IconButton icon="x" label="Cancel order" onClick={() => act(o, 'cancel')} />}
                                </div>
                                <ul className="mt-3 flex flex-wrap gap-2 text-sm">
                                    {o.items.map((i) => (
                                        <li key={i.id} className="rounded-lg bg-paper px-2.5 py-1 ring-1 ring-rule">
                                            <b>{i.test?.name}</b>{i.result && <span className="text-graphite"> · {i.result}{i.test?.unit ? ` ${i.test.unit}` : ''}</span>}
                                            {i.flag && i.flag !== 'normal' && <span className="ml-1"><Badge tone={FLAG_TONE[i.flag]}>{i.flag}</Badge></span>}
                                        </li>
                                    ))}
                                </ul>
                                {o.notes && <p className="mt-2 text-sm text-pencil">{o.notes}</p>}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            {reporting && <ReportDialog tenant={tenant} order={reporting} onClose={() => setReporting(null)} onDone={() => { setReporting(null); toast('Results saved'); load(); }} />}
            {ordering && <OrderDialog tenant={tenant} currency={currency} onClose={() => setOrdering(false)} onDone={() => { setOrdering(false); toast('Ordered · added to the bill'); load(); }} />}
        </div>
    );
}

function ReportDialog({ tenant, order, onClose, onDone }) {
    const toast = useToast();
    const [rows, setRows] = useState(order.items.map((i) => ({ id: i.id, result: i.result ?? '', flag: i.flag ?? '', attachment_url: i.attachment_url ?? '' })));
    const [busy, setBusy] = useState(false);
    const [uploading, setUploading] = useState(null);
    const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

    async function attach(i, file) {
        if (!file) return;
        setUploading(i);
        try { const r = await upload(file, file.type === 'application/pdf' ? 'pdf' : 'image', tenant); set(i, 'attachment_url', r.url); } catch (e) { toast(e.message, 'error'); } finally { setUploading(null); }
    }
    async function save() {
        setBusy(true);
        try {
            await api(`lab/orders/${order.id}/report`, { method: 'POST', tenant, body: { items: rows.map((r) => ({ id: r.id, result: r.result || null, flag: r.flag || null, attachment_url: r.attachment_url || null })) } });
            onDone();
        } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
    }

    return (
        <Modal open onClose={onClose} title={`Results · ${order.patient?.name}`} description={`Order #${order.id}`} size="lg"
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save results</Button></>}>
            <div className="space-y-4">
                {order.items.map((item, i) => (
                    <div key={item.id} className="rounded-xl border border-rule p-3">
                        <p className="font-bold text-graphite">{item.test?.name}{item.test?.normal_range && <span className="font-normal text-pencil"> · ref {item.test.normal_range} {item.test.unit ?? ''}</span>}</p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_9rem]">
                            <textarea aria-label="Result" rows={item.test?.category === 'radiology' ? 4 : 2} value={rows[i].result} onChange={(e) => set(i, 'result', e.target.value)} placeholder={item.test?.category === 'radiology' ? 'Findings and impression' : 'Value or findings'} className="rounded-lg border border-rule px-3 py-2" />
                            <select aria-label="Flag" value={rows[i].flag} onChange={(e) => set(i, 'flag', e.target.value)} className="h-10 rounded-lg border border-rule bg-white px-3">
                                <option value="">No flag</option><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option><option value="critical">Critical</option>
                            </select>
                        </div>
                        <div className="mt-2 flex items-center gap-3 text-sm">
                            <label className="cursor-pointer font-bold text-ink">{uploading === i ? 'Uploading…' : rows[i].attachment_url ? 'Replace file' : 'Attach report (PDF or image)'}
                                <input type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => attach(i, e.target.files?.[0])} />
                            </label>
                            {rows[i].attachment_url && <a href={rows[i].attachment_url} target="_blank" rel="noreferrer" className="text-pencil underline">View file</a>}
                        </div>
                    </div>
                ))}
            </div>
        </Modal>
    );
}

function OrderDialog({ tenant, currency, onClose, onDone }) {
    const [patient, setPatient] = useState(null);
    const [tests, setTests] = useState([]);
    const [chosen, setChosen] = useState([]);
    const [priority, setPriority] = useState('routine');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => { api('lab/tests', { tenant }).then((r) => setTests(r.data)); }, [tenant]);
    const total = tests.filter((t) => chosen.includes(t.id)).reduce((s, t) => s + Number(t.price), 0);
    async function save() {
        setBusy(true);
        try { await api('lab/orders', { method: 'POST', tenant, body: { patient_id: patient.id, lab_test_ids: chosen, priority } }); onDone(); } catch (e) { setError(e.message); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title="Order tests" size="lg"
            footer={<><span className="mr-auto font-bold tabular-nums">{money(total, currency)}</span><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!patient || !chosen.length} onClick={save}>Order</Button></>}>
            <div className="space-y-4">
                <PatientPicker tenant={tenant} value={patient} onChange={setPatient} />
                <div className="flex flex-wrap gap-2">
                    {tests.map((t) => {
                        const on = chosen.includes(t.id);
                        return <button key={t.id} type="button" aria-pressed={on} onClick={() => setChosen(on ? chosen.filter((x) => x !== t.id) : [...chosen, t.id])} className={`rounded-full px-3 py-1 text-sm font-bold ring-1 ${on ? 'bg-ink text-white ring-ink' : 'bg-white text-graphite ring-rule'}`}>{t.name} · {money(t.price, currency)}</button>;
                    })}
                </div>
                <div className="flex gap-2">{['routine', 'urgent', 'stat'].map((p) => <button key={p} type="button" aria-pressed={priority === p} onClick={() => setPriority(p)} className={`rounded-lg px-3 py-1 text-sm font-bold ring-1 ${priority === p ? 'bg-margin text-white ring-margin' : 'bg-white ring-rule'}`}>{p === 'stat' ? 'STAT' : p[0].toUpperCase() + p.slice(1)}</button>)}</div>
                {error && <p className="text-margin">{error}</p>}
            </div>
        </Modal>
    );
}

function Tests({ tenant, canManage, currency }) {
    const toast = useToast();
    const [rows, setRows] = useState(null);
    const [editing, setEditing] = useState(null);
    const load = useCallback(() => api('lab/tests?all=1', { tenant }).then((r) => setRows(r.data)), [tenant]);
    useEffect(() => { load(); }, [load]);
    return (
        <div>
            {canManage && <div className="mb-4 flex justify-end"><Button icon="plus" onClick={() => setEditing({ category: 'lab' })}>Add test</Button></div>}
            {!rows ? <Skeleton className="h-48 rounded-2xl" /> : (
                <ul className="divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-white">
                    {rows.map((t) => (
                        <li key={t.id} className={`flex flex-wrap items-center gap-3 px-5 py-3 ${t.is_active ? '' : 'opacity-60'}`}>
                            <div className="min-w-0 flex-1"><b className="text-graphite">{t.name}</b>{t.code && <span className="ml-2 font-mono text-sm text-pencil">{t.code}</span>}<span className="block text-sm text-pencil">{[t.category === 'radiology' ? 'Imaging' : 'Lab', t.sample_type, t.normal_range && `ref ${t.normal_range} ${t.unit ?? ''}`, t.turnaround_hours && `${t.turnaround_hours} h`].filter(Boolean).join(' · ')}</span></div>
                            <span className="font-bold tabular-nums">{money(t.price, currency)}</span>
                            {canManage && <IconButton icon="edit" label="Edit" onClick={() => setEditing(t)} />}
                        </li>
                    ))}
                </ul>
            )}
            {editing && <TestForm tenant={tenant} test={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); toast('Saved'); load(); }} />}
        </div>
    );
}

function TestForm({ tenant, test, onClose, onDone }) {
    const keys = ['name', 'code', 'category', 'sample_type', 'unit', 'normal_range', 'price', 'turnaround_hours'];
    const [f, setF] = useState({ ...Object.fromEntries(keys.map((k) => [k, test[k] ?? ''])), is_active: test.is_active ?? true });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    async function save() {
        setBusy(true);
        try {
            const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v]));
            body.price = Number(f.price || 0);
            if (body.turnaround_hours !== null) body.turnaround_hours = Number(body.turnaround_hours);
            await api(test.id ? `lab/tests/${test.id}` : 'lab/tests', { method: test.id ? 'PATCH' : 'POST', tenant, body });
            onDone();
        } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title={test.id ? 'Edit test' : 'Add a test'}
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" name="name" error={error} value={f.name} onChange={set('name')} className="sm:col-span-2" />
                <Field label="Code" name="code" error={error} value={f.code} onChange={set('code')} />
                <Field label="Type" name="category" as="select" value={f.category} onChange={set('category')}><option value="lab">Laboratory</option><option value="radiology">Imaging</option></Field>
                <Field label="Sample" name="sample_type" error={error} value={f.sample_type} onChange={set('sample_type')} placeholder="Blood, urine…" />
                <Field label="Unit" name="unit" error={error} value={f.unit} onChange={set('unit')} />
                <Field label="Normal range" name="normal_range" error={error} value={f.normal_range} onChange={set('normal_range')} />
                <Field label="Price" name="price" type="number" min="0" step="0.01" error={error} value={f.price} onChange={set('price')} />
                <Field label="Turnaround (hours)" name="turnaround_hours" type="number" min="0" error={error} value={f.turnaround_hours} onChange={set('turnaround_hours')} />
                {test.id && <label className="flex items-center gap-2 font-bold text-graphite"><input type="checkbox" className="h-5 w-5 accent-ink" checked={!!f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />Offered</label>}
            </div>
        </Modal>
    );
}
