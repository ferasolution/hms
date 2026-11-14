import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../../lib/api';
import { date, money } from '../../lib/format';
import { EXPENSE_CATEGORIES, MONTHS, today } from '../../lib/hms';
import StatTiles from '../../components/StatTiles';
import { Badge, Button, EmptyState, Field, IconButton, Modal, PageHeader, Skeleton, Tabs, useToast } from '../../components/ui';
import { download } from './Store';

const EXP_STATUS = { pending: ['Awaiting approval', 'warning'], approved: ['Approved · to pay', 'draft'], paid: ['Paid', 'success'], rejected: ['Rejected', 'neutral'] };
const SERVICE_CATS = { procedure: 'Procedure', consultation: 'Consultation', nursing: 'Nursing', package: 'Package', emergency: 'Emergency', other: 'Other' };

export default function Finance() {
    const { tenant, me } = useOutletContext();
    const currency = me.tenant.settings?.currency ?? 'USD';
    const [tab, setTab] = useState('pl');
    return (
        <div>
            <PageHeader title="Finance" description="Money in, money out. Expenses need a second person to approve before they can be paid." />
            <Tabs className="mt-6" value={tab} onChange={setTab} tabs={[{ value: 'pl', label: 'Profit & loss' }, { value: 'expenses', label: 'Expenses' }, { value: 'services', label: 'Services & prices' }]} />
            <div className="mt-5">
                {tab === 'pl' && <ProfitLoss tenant={tenant} currency={currency} />}
                {tab === 'expenses' && <Expenses tenant={tenant} me={me} currency={currency} />}
                {tab === 'services' && <Services tenant={tenant} currency={currency} />}
            </div>
        </div>
    );
}

function ProfitLoss({ tenant, currency }) {
    const [year, setYear] = useState(new Date().getFullYear());
    const [d, setD] = useState(null);
    useEffect(() => { setD(null); api(`finance/summary?year=${year}`, { tenant }).then(setD); }, [tenant, year]);
    const max = d ? Math.max(1, ...d.months.flatMap((m) => [m.income, m.expenses])) : 1;
    const cats = d ? Object.entries(d.expense_by_category).sort((a, b) => b[1] - a[1]) : [];
    const catTotal = cats.reduce((s, [, v]) => s + v, 0) || 1;

    return (
        <div>
            <div className="flex items-center gap-2">
                <IconButton icon="chevronLeft" label="Previous year" onClick={() => setYear(year - 1)} />
                <b className="font-display text-lg text-ink-deep">{year}</b>
                <IconButton icon="chevronRight" label="Next year" onClick={() => setYear(year + 1)} />
            </div>
            <StatTiles className="mt-4" items={[
                { label: 'Collected', value: d ? money(d.totals.income, currency) : null, tone: 'success' },
                { label: 'Expenses', value: d ? money(d.totals.expenses, currency) : null },
                { label: 'Net', value: d ? money(d.totals.net, currency) : null, tone: d && d.totals.net < 0 ? 'danger' : 'ink' },
                { label: 'Awaiting approval', value: d?.pending_approval, sub: d ? `${money(d.to_pay, currency)} approved, unpaid` : null, tone: d?.pending_approval ? 'warning' : 'ink' },
            ]} />
            <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_20rem]">
                <section className="rounded-2xl border border-rule bg-white p-5">
                    <p className="text-sm font-bold text-graphite">Month by month <span className="font-normal text-pencil">· <span className="text-leaf">■</span> collected <span className="text-margin">■</span> spent</span></p>
                    {!d ? <Skeleton className="mt-4 h-56" /> : (
                        <div className="mt-4 flex h-56 items-end gap-2">
                            {d.months.map((m, i) => (
                                <div key={m.month} className="group relative flex flex-1 flex-col items-center gap-1">
                                    <div className="flex h-48 w-full items-end justify-center gap-0.5">
                                        <motion.span initial={{ height: 0 }} animate={{ height: `${(m.income / max) * 100}%` }} transition={{ delay: i * 0.03, duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }} className="w-[42%] rounded-t-md bg-leaf" />
                                        <motion.span initial={{ height: 0 }} animate={{ height: `${(m.expenses / max) * 100}%` }} transition={{ delay: i * 0.03 + 0.05, duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }} className="w-[42%] rounded-t-md bg-margin/80" />
                                    </div>
                                    <span className="text-xs text-pencil">{MONTHS[m.month - 1]}</span>
                                    <span className="pointer-events-none absolute -top-2 z-10 hidden -translate-y-full whitespace-nowrap rounded-lg bg-ink-deep px-2.5 py-1.5 text-xs text-white shadow-lg group-hover:block">
                                        In {money(m.income, currency)}<br />Out {money(m.expenses, currency)}<br /><b>Net {money(m.net, currency)}</b>
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
                <section className="rounded-2xl border border-rule bg-white p-5">
                    <p className="text-sm font-bold text-graphite">Where the money went</p>
                    {d && !cats.length && <p className="mt-3 text-sm text-pencil">No approved expenses this year.</p>}
                    <ul className="mt-3 space-y-3">
                        {cats.map(([k, v]) => (
                            <li key={k}>
                                <div className="flex justify-between text-sm"><span className="text-graphite">{EXPENSE_CATEGORIES[k] ?? k}</span><b className="tabular-nums">{money(v, currency)}</b></div>
                                <div className="mt-1 h-2 overflow-hidden rounded-full bg-paper"><motion.div initial={{ width: 0 }} animate={{ width: `${(v / catTotal) * 100}%` }} className="h-full rounded-full bg-ink" /></div>
                            </li>
                        ))}
                    </ul>
                </section>
            </div>
        </div>
    );
}

function Expenses({ tenant, me, currency }) {
    const toast = useToast();
    const [status, setStatus] = useState('');
    const [rows, setRows] = useState(null);
    const [adding, setAdding] = useState(false);
    const load = useCallback(() => api(`finance/expenses${status ? `?status=${status}` : ''}`, { tenant }).then((r) => setRows(r.data)), [tenant, status]);
    useEffect(() => { load(); }, [load]);

    async function act(e, s) {
        const reference = s === 'paid' ? window.prompt('Payment reference (cheque or transfer no.)') ?? '' : '';
        try { await api(`finance/expenses/${e.id}`, { method: 'PATCH', tenant, body: { status: s, reference: reference || null } }); toast(EXP_STATUS[s][0]); load(); } catch (err) { toast(err.message, 'error'); }
    }

    return (
        <div>
            <div className="flex flex-wrap items-center gap-2">
                {[['', 'All'], ['pending', 'To approve'], ['approved', 'To pay'], ['paid', 'Paid'], ['rejected', 'Rejected']].map(([v, l]) => <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatus(v)} className={`rounded-full px-3.5 py-1.5 text-sm font-bold ring-1 ${status === v ? 'bg-ink-deep text-white ring-ink-deep' : 'bg-white text-graphite ring-rule'}`}>{l}</button>)}
                <Button className="ml-auto" variant="secondary" icon="download" onClick={() => download('finance/exports/expenses.csv', tenant, 'expenses.csv').catch((e) => toast(e.message, 'error'))}>CSV</Button>
                <Button icon="plus" onClick={() => setAdding(true)}>Add expense</Button>
            </div>
            <div className="mt-4">
                {!rows ? <Skeleton className="h-48 rounded-2xl" /> : rows.length === 0 ? <EmptyState icon="wallet" title="No expenses here">Goods received on purchase orders are added here automatically.</EmptyState> : (
                    <div className="overflow-x-auto rounded-2xl border border-rule bg-white">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-paper text-pencil"><tr><th className="p-3">Date</th><th className="p-3">What</th><th className="p-3">Category</th><th className="p-3 text-right">Amount</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
                            <tbody className="divide-y divide-rule">
                                {rows.map((e) => (
                                    <tr key={e.id}>
                                        <td className="whitespace-nowrap p-3 text-pencil">{date(e.spent_on)}</td>
                                        <td className="p-3"><b className="text-graphite">{e.description}</b><span className="block text-xs text-pencil">{[e.supplier?.name, e.department?.name, `by ${e.creator?.name}`, e.approver && `approved by ${e.approver.name}`, e.reference].filter(Boolean).join(' · ')}</span></td>
                                        <td className="p-3 text-pencil">{EXPENSE_CATEGORIES[e.category] ?? e.category}</td>
                                        <td className="p-3 text-right font-bold tabular-nums">{money(e.amount, currency)}</td>
                                        <td className="p-3"><Badge tone={EXP_STATUS[e.status][1]}>{EXP_STATUS[e.status][0]}</Badge></td>
                                        <td className="whitespace-nowrap p-3 text-right">
                                            {e.status === 'pending' && (e.creator?.id === me.user.id ? <span className="text-xs text-pencil">Needs another approver</span> : <>
                                                <Button size="sm" onClick={() => act(e, 'approved')}>Approve</Button> <Button size="sm" variant="ghost" onClick={() => act(e, 'rejected')}>Reject</Button>
                                            </>)}
                                            {e.status === 'approved' && <Button size="sm" variant="secondary" onClick={() => act(e, 'paid')}>Mark paid</Button>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            {adding && <ExpenseDialog tenant={tenant} onClose={() => setAdding(false)} onDone={() => { setAdding(false); toast('Expense added · waiting for approval'); load(); }} />}
        </div>
    );
}

function ExpenseDialog({ tenant, onClose, onDone }) {
    const [f, setF] = useState({ spent_on: today(), category: 'utilities', description: '', amount: '', method: 'bank', reference: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    async function save() {
        setBusy(true); setError(null);
        try { await api('finance/expenses', { method: 'POST', tenant, body: { ...f, amount: Number(f.amount), reference: f.reference || null } }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title="Add expense" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!f.description || !f.amount} onClick={save}>Add</Button></>}>
            <div className="grid gap-3 sm:grid-cols-2">
                <Field className="sm:col-span-2" label="Description" name="description" error={error} value={f.description} onChange={set('description')} placeholder="Electricity — October" />
                <Field label="Amount" name="amount" type="number" step="0.01" min={0} error={error} value={f.amount} onChange={set('amount')} />
                <Field label="Date" name="spent_on" type="date" error={error} value={f.spent_on} onChange={set('spent_on')} />
                <Field label="Category" name="category" as="select" value={f.category} onChange={set('category')}>{Object.entries(EXPENSE_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Field>
                <Field label="Paid by" name="method" as="select" value={f.method} onChange={set('method')}><option value="bank">Bank transfer</option><option value="card">Card</option><option value="cash">Cash</option><option value="cheque">Cheque</option></Field>
                <Field className="sm:col-span-2" label="Bill / invoice no." name="reference" error={error} value={f.reference} onChange={set('reference')} />
            </div>
        </Modal>
    );
}

function Services({ tenant, currency }) {
    const toast = useToast();
    const [rows, setRows] = useState(null);
    const [editing, setEditing] = useState(null);
    const load = useCallback(() => api('services?all=1', { tenant }).then((r) => setRows(r.data)), [tenant]);
    useEffect(() => { load(); }, [load]);
    return (
        <div>
            <div className="flex items-center justify-between"><p className="text-sm text-pencil">Procedures, nursing services and packages that staff can add to a patient’s bill.</p><Button icon="plus" onClick={() => setEditing({})}>Add service</Button></div>
            <div className="mt-4">
                {!rows ? <Skeleton className="h-40 rounded-2xl" /> : rows.length === 0 ? <EmptyState icon="tag" title="No services yet" /> : (
                    <ul className="divide-y divide-rule rounded-2xl border border-rule bg-white">
                        {rows.map((s) => (
                            <li key={s.id} className={`flex items-center gap-3 px-4 py-3 ${s.is_active ? '' : 'opacity-50'}`}>
                                <div className="min-w-0 flex-1"><b className="text-graphite">{s.name}</b><span className="block text-xs text-pencil">{[s.code, SERVICE_CATS[s.category], s.department?.name].filter(Boolean).join(' · ')}</span></div>
                                <b className="tabular-nums text-ink-deep">{money(s.price, currency)}</b>
                                <IconButton icon="edit" label="Edit" onClick={() => setEditing(s)} />
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            {editing && <ServiceDialog tenant={tenant} service={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); toast('Saved'); load(); }} />}
        </div>
    );
}

function ServiceDialog({ tenant, service, onClose, onDone }) {
    const isNew = !service.id;
    const [f, setF] = useState({ name: service.name ?? '', code: service.code ?? '', category: service.category ?? 'procedure', price: service.price ?? '', is_active: service.is_active ?? true });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    async function save() {
        setBusy(true); setError(null);
        try { await api(isNew ? 'services' : `services/${service.id}`, { method: isNew ? 'POST' : 'PATCH', tenant, body: { ...f, code: f.code || null, price: Number(f.price) } }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title={isNew ? 'Add service' : service.name}
            footer={<>{!isNew && <Button variant="ghost" className="mr-auto" onClick={() => setF({ ...f, is_active: !f.is_active })}>{f.is_active ? 'Hide' : 'Show again'}</Button>}<Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!f.name || f.price === ''} onClick={save}>Save</Button></>}>
            <div className="grid gap-3 sm:grid-cols-2">
                <Field className="sm:col-span-2" label="Name" name="name" error={error} value={f.name} onChange={set('name')} placeholder="Wound dressing" />
                <Field label="Code" name="code" error={error} value={f.code} onChange={set('code')} placeholder="CPT / internal code" />
                <Field label="Category" name="category" as="select" value={f.category} onChange={set('category')}>{Object.entries(SERVICE_CATS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Field>
                <Field label="Price" name="price" type="number" step="0.01" min={0} error={error} value={f.price} onChange={set('price')} />
            </div>
        </Modal>
    );
}
