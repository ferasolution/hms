import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api, download } from '../../lib/api';
import { date, dateTime, money } from '../../lib/format';
import { CHARGE_CATEGORIES, INVOICE_STATUS, PAY_METHODS, today } from '../../lib/hms';
import Icon from '../../components/Icon';
import PatientPicker from '../../components/PatientPicker';
import { Badge, Button, EmptyState, Field, IconButton, Modal, PageHeader, Skeleton, Tabs, useToast } from '../../components/ui';

export default function Invoices() {
    const { tenant, me } = useOutletContext();
    const toast = useToast();
    const navigate = useNavigate();
    const role = me.user.role;
    const canClaims = ['admin', 'accountant'].includes(role) && me.tenant.settings?.modules?.insurance !== false;
    const [tab, setTab] = useState('invoices');
    const [creating, setCreating] = useState(false);

    return (
        <div>
            <PageHeader title="Billing" description="Patient bills, payments and insurance claims. Consultations, tests, medicines and room stays are added automatically."
                actions={<>
                    {['admin', 'accountant'].includes(role) && <Button variant="secondary" icon="download" onClick={() => download('exports/invoices.csv', tenant, 'invoices.csv').catch((e) => toast(e.message, 'error'))}>Export</Button>}
                    <Button icon="plus" onClick={() => setCreating(true)}>New bill</Button>
                </>} />
            <Summary tenant={tenant} currency={me.tenant.settings?.currency ?? 'USD'} />
            <Tabs className="mt-6" value={tab} onChange={setTab} tabs={[{ value: 'invoices', label: 'Bills' }, { value: 'payments', label: 'Today’s collections' }, canClaims && { value: 'claims', label: 'Insurance claims' }].filter(Boolean)} />
            <div className="mt-4">
                {tab === 'invoices' && <InvoiceList tenant={tenant} />}
                {tab === 'payments' && <Collections tenant={tenant} />}
                {tab === 'claims' && <Claims tenant={tenant} />}
            </div>
            {creating && <NewInvoice tenant={tenant} onClose={() => setCreating(false)} onDone={(inv) => { setCreating(false); navigate(`/${tenant}/billing/${inv.id}`); }} />}
        </div>
    );
}

function Summary({ tenant, currency }) {
    const [s, setS] = useState(null);
    useEffect(() => { api('invoices/summary', { tenant }).then(setS).catch(() => {}); }, [tenant]);
    if (!s) return <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>;
    const cur = s.currency ?? currency;
    return (
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[['Collected this month', money(s.collected, cur)], ['Billed this month', money(s.billed, cur)], ['Outstanding', money(s.outstanding, cur)], ['Open bills', s.open_invoices]].map(([l, v]) => (
                <div key={l} className="rounded-2xl border border-rule bg-white p-4"><p className="text-sm text-pencil">{l}</p><p className="font-display text-2xl font-bold text-ink-deep tabular-nums">{v}</p></div>
            ))}
        </div>
    );
}

function InvoiceList({ tenant }) {
    const [status, setStatus] = useState('open');
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [d, setD] = useState(null);
    const load = useCallback(() => {
        const qs = new URLSearchParams({ page: String(page) });
        if (status) qs.set('status', status);
        if (search.trim()) qs.set('search', search.trim());
        return api(`invoices?${qs}`, { tenant }).then(setD);
    }, [tenant, status, search, page]);
    useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
    return (
        <div>
            <div className="flex flex-wrap items-center gap-2">
                {[['open', 'Unpaid'], ['paid', 'Paid'], ['void', 'Void'], ['', 'All']].map(([v, l]) => <button key={v} type="button" aria-pressed={status === v} onClick={() => { setStatus(v); setPage(1); }} className={`rounded-full px-3.5 py-1.5 text-sm font-bold ring-1 ${status === v ? 'bg-ink-deep text-white ring-ink-deep' : 'bg-white text-graphite ring-rule'}`}>{l}</button>)}
                <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Bill no., patient or MRN" aria-label="Search bills" className="ml-auto h-10 w-full rounded-lg border border-rule bg-white px-3 sm:w-64" />
            </div>
            <div className="mt-4">
                {!d ? <Skeleton className="h-48 rounded-2xl" /> : d.data.length === 0 ? <EmptyState icon="receipt" title="No bills here">Bills open automatically when a patient is checked in, tested or given medicine.</EmptyState> : (
                    <div className="overflow-x-auto rounded-2xl border border-rule bg-white">
                        <table className="w-full min-w-[40rem] text-left">
                            <thead className="border-b border-rule bg-paper text-sm text-pencil"><tr><th className="px-4 py-3">Bill</th><th className="px-4 py-3">Patient</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Due</th><th className="px-4 py-3" /></tr></thead>
                            <tbody className="divide-y divide-rule">
                                {d.data.map((i) => (
                                    <tr key={i.id} className="hover:bg-paper">
                                        <td className="px-4 py-2.5"><Link to={`/${tenant}/billing/${i.id}`} className="font-bold text-ink hover:underline">{i.number}</Link><span className="block text-sm text-pencil">{date(i.created_at)}{i.admission_id ? ' · inpatient' : ''}</span></td>
                                        <td className="px-4 py-2.5"><b className="text-graphite">{i.patient?.name}</b><span className="block text-sm text-pencil">{i.patient?.mrn}</span></td>
                                        <td className="px-4 py-2.5 text-right tabular-nums">{money(i.total, i.currency)}</td>
                                        <td className="px-4 py-2.5 text-right font-bold tabular-nums">{money(i.balance, i.currency)}</td>
                                        <td className="px-4 py-2.5 text-right"><Badge tone={INVOICE_STATUS[i.status][1]}>{INVOICE_STATUS[i.status][0]}</Badge></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {d.meta.last_page > 1 && (
                            <div className="flex items-center justify-between border-t border-rule px-5 py-3">
                                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                                <span className="text-sm text-pencil">Page {d.meta.page} of {d.meta.last_page}</span>
                                <Button size="sm" variant="secondary" disabled={page >= d.meta.last_page} onClick={() => setPage(page + 1)}>Next</Button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function Collections({ tenant }) {
    const [day, setDay] = useState(today());
    const [d, setD] = useState(null);
    useEffect(() => { api(`invoices/payments?from=${day}&to=${day}`, { tenant }).then(setD); }, [tenant, day]);
    const byMethod = (d?.data ?? []).reduce((acc, p) => ({ ...acc, [p.method]: (acc[p.method] ?? 0) + Number(p.amount) }), {});
    const cur = d?.data?.[0]?.invoice?.currency ?? 'USD';
    return (
        <div>
            <div className="flex flex-wrap items-center gap-3">
                <input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day" className="h-10 rounded-lg border border-rule bg-white px-3" />
                {d && <p className="font-bold">Total {money(d.total, cur)}</p>}
                {Object.entries(byMethod).map(([m, v]) => <Badge key={m}>{PAY_METHODS[m]} {money(v, cur)}</Badge>)}
                <Button size="sm" variant="ghost" icon="printer" className="ml-auto" onClick={() => window.print()}>Print</Button>
            </div>
            <div className="mt-4">
                {!d ? <Skeleton className="h-40 rounded-2xl" /> : d.data.length === 0 ? <p className="rounded-xl border border-dashed border-rule bg-white/60 px-4 py-10 text-center text-pencil">No payments on this day.</p> : (
                    <ul className="divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-white">
                        {d.data.map((p) => (
                            <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                                <span className="w-20 text-sm text-pencil">{new Date(p.paid_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                                <Link to={`/${tenant}/billing/${p.invoice_id}`} className="min-w-0 flex-1"><b className="text-graphite">{p.invoice?.patient?.first_name} {p.invoice?.patient?.last_name}</b><span className="block text-sm text-pencil">{p.invoice?.number} · {PAY_METHODS[p.method]}{p.reference ? ` · ${p.reference}` : ''} · by {p.receiver?.name}</span></Link>
                                <b className="tabular-nums">{money(p.amount, p.invoice?.currency)}</b>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

const CLAIM_STATUS = { submitted: ['Submitted', 'warning'], approved: ['Approved', 'draft'], rejected: ['Rejected', 'danger'], paid: ['Paid', 'success'] };

function Claims({ tenant }) {
    const toast = useToast();
    const [status, setStatus] = useState('');
    const [rows, setRows] = useState(null);
    const [editing, setEditing] = useState(null);
    const load = useCallback(() => api(`claims${status ? `?status=${status}` : ''}`, { tenant }).then((r) => setRows(r.data)), [tenant, status]);
    useEffect(() => { load(); }, [load]);
    return (
        <div>
            <div className="flex gap-2">{[['', 'All'], ['submitted', 'Submitted'], ['approved', 'Approved'], ['paid', 'Paid'], ['rejected', 'Rejected']].map(([v, l]) => <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatus(v)} className={`rounded-full px-3.5 py-1.5 text-sm font-bold ring-1 ${status === v ? 'bg-ink-deep text-white ring-ink-deep' : 'bg-white text-graphite ring-rule'}`}>{l}</button>)}</div>
            <p className="mt-3 text-sm text-pencil">Start a claim from a bill (Billing → open a bill → Claim insurance).</p>
            <div className="mt-4">
                {!rows ? <Skeleton className="h-40 rounded-2xl" /> : rows.length === 0 ? <p className="rounded-xl border border-dashed border-rule bg-white/60 px-4 py-10 text-center text-pencil">No claims.</p> : (
                    <ul className="divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-white">
                        {rows.map((c) => (
                            <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                                <div className="min-w-0 flex-1"><b className="text-graphite">{c.provider}</b> <span className="text-sm text-pencil">· {c.patient?.first_name} {c.patient?.last_name} · {c.invoice?.number}{c.claim_no ? ` · claim ${c.claim_no}` : ''}</span><span className="block text-sm text-pencil">{date(c.created_at)}{c.policy_no ? ` · policy ${c.policy_no}` : ''}</span></div>
                                <span className="tabular-nums">{money(c.amount_claimed, c.invoice?.currency)}{c.amount_approved !== null && c.amount_approved !== undefined ? <span className="text-pencil"> → {money(c.amount_approved, c.invoice?.currency)}</span> : ''}</span>
                                <Badge tone={CLAIM_STATUS[c.status][1]}>{CLAIM_STATUS[c.status][0]}</Badge>
                                {c.status !== 'paid' && <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>Update</Button>}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            {editing && <ClaimUpdate tenant={tenant} claim={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); toast('Claim updated'); load(); }} />}
        </div>
    );
}

function ClaimUpdate({ tenant, claim, onClose, onDone }) {
    const [status, setStatus] = useState(claim.status === 'submitted' ? 'approved' : claim.status);
    const [approved, setApproved] = useState(claim.amount_approved ?? claim.amount_claimed);
    const [claimNo, setClaimNo] = useState(claim.claim_no ?? '');
    const [notes, setNotes] = useState(claim.notes ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function save() {
        setBusy(true);
        try { await api(`claims/${claim.id}`, { method: 'PATCH', tenant, body: { status, amount_approved: status === 'rejected' ? 0 : Number(approved), claim_no: claimNo || null, notes: notes || null } }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title={`Claim · ${claim.provider}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
            <div className="space-y-4">
                <Field label="Status" name="status" as="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="submitted">Submitted</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="paid">Paid — record the payment on the bill</option>
                </Field>
                {status !== 'rejected' && <Field label="Approved amount" name="amount_approved" type="number" min="0" step="0.01" error={error} value={approved} onChange={(e) => setApproved(e.target.value)} />}
                <Field label="Claim number" name="claim_no" error={error} value={claimNo} onChange={(e) => setClaimNo(e.target.value)} />
                <Field label="Notes" name="notes" as="textarea" rows={2} error={error} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
        </Modal>
    );
}

const BLANK_LINE = { category: 'procedure', description: '', quantity: 1, unit_price: '' };

function NewInvoice({ tenant, onClose, onDone }) {
    const [patient, setPatient] = useState(null);
    const [lines, setLines] = useState([{ ...BLANK_LINE }]);
    const [discount, setDiscount] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const set = (i, k, v) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
    async function save() {
        setBusy(true);
        setError(null);
        try {
            const inv = await api('invoices', { method: 'POST', tenant, body: { patient_id: patient.id, discount: Number(discount || 0), items: lines.filter((l) => l.description).map((l) => ({ ...l, quantity: Number(l.quantity || 1), unit_price: Number(l.unit_price || 0) })) } });
            onDone(inv);
        } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title="New bill" description="For charges that aren’t added automatically: procedures, supplies, packages." size="lg"
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!patient || !lines.some((l) => l.description)} onClick={save}>Create bill</Button></>}>
            <div className="space-y-4">
                <PatientPicker tenant={tenant} value={patient} onChange={setPatient} />
                <LineEditor lines={lines} set={set} onAdd={() => setLines([...lines, { ...BLANK_LINE }])} onRemove={(i) => setLines(lines.filter((_, j) => j !== i))} />
                <Field label="Discount" name="discount" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} className="sm:w-48" />
                {error && <p className="text-margin">{error.message}</p>}
            </div>
        </Modal>
    );
}

function LineEditor({ lines, set, onAdd, onRemove }) {
    return (
        <div className="space-y-2">
            {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_5rem_7rem_2.5rem] gap-2 sm:grid-cols-[9rem_1fr_5rem_7rem_2.5rem]">
                    <select aria-label="Category" value={l.category} onChange={(e) => set(i, 'category', e.target.value)} className="col-span-4 h-10 rounded-lg border border-rule bg-white px-2 sm:col-span-1">
                        {Object.entries(CHARGE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <input aria-label="Description" placeholder="Description" value={l.description} onChange={(e) => set(i, 'description', e.target.value)} className="h-10 rounded-lg border border-rule px-3" />
                    <input aria-label="Quantity" type="number" min="1" value={l.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} className="h-10 rounded-lg border border-rule px-2" />
                    <input aria-label="Price" type="number" min="0" step="0.01" placeholder="Price" value={l.unit_price} onChange={(e) => set(i, 'unit_price', e.target.value)} className="h-10 rounded-lg border border-rule px-2" />
                    <IconButton icon="x" label="Remove line" onClick={() => onRemove(i)} />
                </div>
            ))}
            <Button size="sm" variant="secondary" icon="plus" onClick={onAdd}>Add line</Button>
        </div>
    );
}

export function InvoiceDetail() {
    const { id } = useParams();
    const { tenant, me } = useOutletContext();
    const toast = useToast();
    const role = me.user.role;
    const canAdjust = ['admin', 'accountant'].includes(role);
    const [inv, setInv] = useState(null);
    const [paying, setPaying] = useState(false);
    const [adding, setAdding] = useState(false);
    const [claiming, setClaiming] = useState(false);
    const load = useCallback(() => api(`invoices/${id}`, { tenant }).then(setInv).catch((e) => toast(e.message, 'error')), [tenant, id, toast]);
    useEffect(() => { load(); }, [load]);
    if (!inv) return <Skeleton className="h-96 rounded-2xl" />;

    const s = me.tenant.settings ?? {};
    const open = ['unpaid', 'partial'].includes(inv.status);

    async function patch(body, msg) {
        try { setInv(await api(`invoices/${inv.id}`, { method: 'PATCH', tenant, body })); toast(msg); } catch (e) { toast(e.message, 'error'); }
    }
    async function refund(p) {
        try { setInv(await api(`invoices/${inv.id}/payments/${p.id}`, { method: 'DELETE', tenant })); toast('Payment removed'); } catch (e) { toast(e.message, 'error'); }
    }

    return (
        <div>
            <div className="print:hidden">
                <PageHeader back={{ to: `/${tenant}/billing`, label: 'Billing' }} title={inv.number} description={`${inv.patient.name} · ${inv.patient.mrn}`}
                    actions={<>
                        <Button variant="secondary" icon="printer" onClick={() => window.print()}>Print</Button>
                        {open && canAdjust && me.tenant.settings?.modules?.insurance !== false && <Button variant="secondary" onClick={() => setClaiming(true)}>Claim insurance</Button>}
                        {inv.status !== 'void' && <Button variant="secondary" icon="plus" onClick={() => setAdding(true)}>Add charge</Button>}
                        {open && <Button icon="wallet" onClick={() => setPaying(true)}>Take payment</Button>}
                    </>} />
            </div>

            <article className="mt-6 rounded-2xl border border-rule bg-white p-6 sm:p-8 print:mt-0 print:border-0 print:p-0">
                <header className="flex flex-wrap items-start justify-between gap-4 border-b border-rule pb-5">
                    <div className="flex items-start gap-3">
                        {s.logo_url && <img src={s.logo_url} alt="" className="h-12 w-12 rounded-lg object-contain" />}
                        <div>
                            <p className="font-display text-xl font-bold text-ink-deep">{me.tenant.name}</p>
                            {s.address && <p className="text-sm text-pencil">{s.address}</p>}
                            <p className="text-sm text-pencil">{[s.support_phone, s.support_email].filter(Boolean).join(' · ')}</p>
                            {s.tax_id && <p className="text-sm text-pencil">Tax ID {s.tax_id}</p>}
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="font-display text-2xl font-bold">{inv.status === 'paid' ? 'Receipt' : 'Bill'}</p>
                        <p className="font-mono">{inv.number}</p>
                        <p className="text-sm text-pencil">{date(inv.created_at)}</p>
                        <div className="mt-1 print:hidden"><Badge tone={INVOICE_STATUS[inv.status][1]}>{INVOICE_STATUS[inv.status][0]}</Badge></div>
                    </div>
                </header>
                <section className="grid gap-1 py-4 text-sm sm:grid-cols-2">
                    <p><span className="text-pencil">Patient</span> <b>{inv.patient.name}</b> · {inv.patient.mrn}</p>
                    {inv.patient.insurance_provider && <p><span className="text-pencil">Insurance</span> {inv.patient.insurance_provider} {inv.patient.insurance_number}</p>}
                    {inv.patient.phone && <p><span className="text-pencil">Phone</span> {inv.patient.phone}</p>}
                </section>
                <table className="w-full text-left">
                    <thead className="border-y border-rule text-sm text-pencil"><tr><th className="py-2">Item</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Price</th><th className="py-2 text-right">Amount</th>{canAdjust && inv.status !== 'void' && <th className="print:hidden" />}</tr></thead>
                    <tbody className="divide-y divide-rule">
                        {inv.items.map((it) => (
                            <tr key={it.id}>
                                <td className="py-2"><span className="text-graphite">{it.description}</span><span className="block text-xs text-pencil">{CHARGE_CATEGORIES[it.category] ?? it.category}</span></td>
                                <td className="py-2 text-right tabular-nums">{Number(it.quantity)}</td>
                                <td className="py-2 text-right tabular-nums">{money(it.unit_price, inv.currency)}</td>
                                <td className="py-2 text-right tabular-nums">{money(it.amount, inv.currency)}</td>
                                {canAdjust && inv.status !== 'void' && <td className="w-10 text-right print:hidden"><IconButton icon="trash" label="Remove line" onClick={() => patch({ remove_item_ids: [it.id] }, 'Line removed')} /></td>}
                            </tr>
                        ))}
                    </tbody>
                </table>
                <dl className="ml-auto mt-4 w-full max-w-xs space-y-1 text-right tabular-nums">
                    <div className="flex justify-between"><dt className="text-pencil">Subtotal</dt><dd>{money(inv.subtotal, inv.currency)}</dd></div>
                    {Number(inv.discount) > 0 && <div className="flex justify-between"><dt className="text-pencil">Discount</dt><dd>−{money(inv.discount, inv.currency)}</dd></div>}
                    {Number(inv.tax) > 0 && <div className="flex justify-between"><dt className="text-pencil">Tax</dt><dd>{money(inv.tax, inv.currency)}</dd></div>}
                    <div className="flex justify-between border-t border-rule pt-1 font-bold"><dt>Total</dt><dd>{money(inv.total, inv.currency)}</dd></div>
                    <div className="flex justify-between"><dt className="text-pencil">Paid</dt><dd>{money(inv.paid, inv.currency)}</dd></div>
                    <div className="flex justify-between text-lg font-bold"><dt>Balance due</dt><dd>{money(inv.balance, inv.currency)}</dd></div>
                </dl>
                {inv.payments.length > 0 && (
                    <section className="mt-6">
                        <h2 className="text-sm font-bold text-pencil">Payments</h2>
                        <ul className="mt-1 divide-y divide-rule text-sm">
                            {inv.payments.map((p) => (
                                <li key={p.id} className="flex items-center gap-3 py-1.5">
                                    <span className="flex-1">{dateTime(p.paid_at)} · {PAY_METHODS[p.method]}{p.reference ? ` · ${p.reference}` : ''}<span className="text-pencil print:hidden"> · {p.receiver?.name}</span></span>
                                    <b className="tabular-nums">{money(p.amount, inv.currency)}</b>
                                    {canAdjust && <span className="print:hidden"><IconButton icon="x" label="Remove payment" onClick={() => refund(p)} /></span>}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
                {inv.claims?.length > 0 && <p className="mt-4 text-sm text-pencil print:hidden">Insurance claims: {inv.claims.map((c) => `${c.provider} (${c.status})`).join(', ')}</p>}
                {s.invoice_footer && <p className="mt-8 border-t border-rule pt-4 text-center text-sm text-pencil">{s.invoice_footer}</p>}
            </article>

            {canAdjust && inv.status !== 'void' && (
                <div className="mt-4 flex flex-wrap gap-2 print:hidden">
                    <Button size="sm" variant="ghost" onClick={() => { const v = window.prompt('Discount amount', inv.discount); if (v !== null) patch({ discount: Number(v) || 0 }, 'Discount saved'); }}>Set discount</Button>
                    {Number(inv.paid) === 0 && <Button size="sm" variant="ghost" className="text-margin" onClick={() => patch({ void: true }, 'Bill voided')}>Void bill</Button>}
                </div>
            )}

            {paying && <PayDialog tenant={tenant} inv={inv} onClose={() => setPaying(false)} onDone={(next) => { setPaying(false); setInv(next); toast(next.status === 'paid' ? 'Paid in full' : 'Payment recorded'); }} />}
            {adding && <AddCharge tenant={tenant} inv={inv} onClose={() => setAdding(false)} onDone={(next) => { setAdding(false); setInv(next); toast('Added'); }} />}
            {claiming && <ClaimDialog tenant={tenant} inv={inv} onClose={() => setClaiming(false)} onDone={() => { setClaiming(false); toast('Claim submitted'); load(); }} />}
        </div>
    );
}

function PayDialog({ tenant, inv, onClose, onDone }) {
    const [amount, setAmount] = useState(inv.balance);
    const [method, setMethod] = useState('cash');
    const [reference, setReference] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function save() {
        setBusy(true);
        try { onDone(await api(`invoices/${inv.id}/payments`, { method: 'POST', tenant, body: { amount: Number(amount), method, reference: reference || null } })); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title="Take payment" description={`Balance ${money(inv.balance, inv.currency)}`}
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Record payment</Button></>}>
            <div className="space-y-4">
                <Field label="Amount" name="amount" type="number" min="0.01" step="0.01" error={error} value={amount} onChange={(e) => setAmount(e.target.value)} />
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Method">
                    {Object.entries(PAY_METHODS).map(([k, v]) => <button key={k} type="button" role="radio" aria-checked={method === k} onClick={() => setMethod(k)} className={`rounded-lg px-3 py-1.5 text-sm font-bold ring-1 ${method === k ? 'bg-ink text-white ring-ink' : 'bg-white ring-rule'}`}>{v}</button>)}
                </div>
                {method !== 'cash' && <Field label="Reference" name="reference" error={error} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Card slip, transfer ID…" />}
                {error && !Object.keys(error.errors ?? {}).length && <p className="text-margin">{error.message}</p>}
            </div>
        </Modal>
    );
}

function AddCharge({ tenant, inv, onClose, onDone }) {
    const [lines, setLines] = useState([{ ...BLANK_LINE }]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const set = (i, k, v) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
    async function save() {
        setBusy(true);
        try { onDone(await api(`invoices/${inv.id}`, { method: 'PATCH', tenant, body: { add_items: lines.filter((l) => l.description).map((l) => ({ ...l, quantity: Number(l.quantity || 1), unit_price: Number(l.unit_price || 0) })) } })); } catch (e) { setError(e.message); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title="Add charges" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Add</Button></>}>
            <LineEditor lines={lines} set={set} onAdd={() => setLines([...lines, { ...BLANK_LINE }])} onRemove={(i) => setLines(lines.filter((_, j) => j !== i))} />
            {error && <p className="mt-2 text-margin">{error}</p>}
        </Modal>
    );
}

function ClaimDialog({ tenant, inv, onClose, onDone }) {
    const [provider, setProvider] = useState(inv.patient.insurance_provider ?? '');
    const [policy, setPolicy] = useState(inv.patient.insurance_number ?? '');
    const [amount, setAmount] = useState(inv.balance);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function save() {
        setBusy(true);
        try { await api('claims', { method: 'POST', tenant, body: { invoice_id: inv.id, provider, policy_no: policy || null, amount_claimed: Number(amount) } }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title="Claim insurance" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Submit claim</Button></>}>
            <div className="space-y-4">
                <Field label="Insurance company" name="provider" error={error} value={provider} onChange={(e) => setProvider(e.target.value)} />
                <Field label="Policy / member no." name="policy_no" error={error} value={policy} onChange={(e) => setPolicy(e.target.value)} />
                <Field label="Amount claimed" name="amount_claimed" type="number" min="0.01" step="0.01" error={error} value={amount} onChange={(e) => setAmount(e.target.value)} />
                {error && !Object.keys(error.errors ?? {}).length && <p className="text-margin">{error.message}</p>}
            </div>
        </Modal>
    );
}

export { Icon };
