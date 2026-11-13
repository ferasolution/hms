import { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api, download } from '../../lib/api';
import { date, money } from '../../lib/format';
import PatientPicker from '../../components/PatientPicker';
import { Badge, Button, EmptyState, Field, IconButton, Modal, PageHeader, Skeleton, Tabs, useToast } from '../../components/ui';

export const CLAIM_STATUS = { submitted: ['Submitted', 'warning'], approved: ['Approved', 'draft'], rejected: ['Rejected', 'danger'], paid: ['Paid', 'success'] };
const PA_STATUS = { requested: ['Waiting', 'warning'], approved: ['Approved', 'success'], partial: ['Part approved', 'draft'], denied: ['Denied', 'danger'], expired: ['Expired', 'neutral'] };
const PAYER_TYPES = { private: 'Private insurer', government: 'Government scheme', corporate: 'Company / employer', tpa: 'Third-party administrator' };

export default function Insurance() {
    const { tenant, me } = useOutletContext();
    const toast = useToast();
    const role = me.user.role;
    const accounts = ['admin', 'accountant'].includes(role);
    const [tab, setTab] = useState(accounts ? 'claims' : 'preauth');
    const currency = me.tenant.settings?.currency ?? 'USD';
    return (
        <div>
            <PageHeader title="Insurance" description="Insurance companies, pre-authorizations, claims and what insurers still owe."
                actions={accounts && <Button variant="secondary" icon="download" onClick={() => download('exports/claims.csv', tenant, 'insurance-claims.csv').catch((e) => toast(e.message, 'error'))}>Export claims</Button>} />
            <Tabs className="mt-6" value={tab} onChange={setTab} tabs={[
                accounts && { value: 'claims', label: 'Claims' },
                { value: 'preauth', label: 'Pre-authorizations' },
                accounts && { value: 'aging', label: 'Aging report' },
                { value: 'payers', label: 'Insurance companies' },
            ].filter(Boolean)} />
            <div className="mt-4">
                {tab === 'claims' && <Claims tenant={tenant} currency={currency} />}
                {tab === 'preauth' && <PreAuths tenant={tenant} currency={currency} canDecide={accounts} />}
                {tab === 'aging' && <Aging tenant={tenant} />}
                {tab === 'payers' && <Payers tenant={tenant} canEdit={accounts} />}
            </div>
        </div>
    );
}

function Pills({ value, onChange, options }) {
    return <div className="flex flex-wrap gap-2">{options.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={`rounded-full px-3.5 py-1.5 text-sm font-bold ring-1 ${value === v ? 'bg-ink-deep text-white ring-ink-deep' : 'bg-white text-graphite ring-rule'}`}>{l}</button>)}</div>;
}

function Claims({ tenant, currency }) {
    const toast = useToast();
    const [status, setStatus] = useState('');
    const [search, setSearch] = useState('');
    const [rows, setRows] = useState(null);
    const [editing, setEditing] = useState(null);
    const load = useCallback(() => {
        const qs = new URLSearchParams();
        if (status) qs.set('status', status);
        if (search.trim()) qs.set('search', search.trim());
        return api(`claims?${qs}`, { tenant }).then((r) => setRows(r.data));
    }, [tenant, status, search]);
    useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
    return (
        <div>
            <div className="flex flex-wrap items-center gap-2">
                <Pills value={status} onChange={setStatus} options={[['', 'All'], ['submitted', 'Submitted'], ['approved', 'Approved'], ['paid', 'Paid'], ['rejected', 'Rejected']]} />
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Patient, MRN, claim or policy no." aria-label="Search claims" className="ml-auto h-10 w-full rounded-lg border border-rule bg-white px-3 sm:w-72" />
            </div>
            <p className="mt-3 text-sm text-pencil">To start a claim, open the bill (Billing → bill → Claim insurance).</p>
            <div className="mt-4">
                {!rows ? <Skeleton className="h-48 rounded-2xl" /> : rows.length === 0 ? <EmptyState icon="shield" title="No claims here">Claims you send to insurers appear here with their status and age.</EmptyState> : (
                    <div className="overflow-x-auto rounded-2xl border border-rule bg-white">
                        <table className="w-full min-w-[48rem] text-left">
                            <thead className="border-b border-rule bg-paper text-sm text-pencil"><tr><th className="px-4 py-3">Insurer · patient</th><th className="px-4 py-3">Bill</th><th className="px-4 py-3 text-right">Claimed</th><th className="px-4 py-3 text-right">Approved</th><th className="px-4 py-3">Status</th><th /></tr></thead>
                            <tbody className="divide-y divide-rule">
                                {rows.map((c) => (
                                    <tr key={c.id}>
                                        <td className="px-4 py-2.5"><b className="text-graphite">{c.insurer?.name ?? c.provider}</b><span className="block text-sm text-pencil">{c.patient?.first_name} {c.patient?.last_name} · {c.patient?.mrn}{c.policy_no ? ` · ${c.policy_no}` : ''}</span></td>
                                        <td className="px-4 py-2.5 text-sm"><Link to={`/${tenant}/billing/${c.invoice_id}`} className="font-bold text-ink hover:underline">{c.invoice?.number}</Link><span className="block text-pencil">{c.claim_no ? `Claim ${c.claim_no} · ` : ''}{date(c.submitted_at ?? c.created_at)}</span></td>
                                        <td className="px-4 py-2.5 text-right tabular-nums">{money(c.amount_claimed, c.invoice?.currency ?? currency)}</td>
                                        <td className="px-4 py-2.5 text-right tabular-nums">{c.amount_approved !== null ? money(c.amount_approved, c.invoice?.currency ?? currency) : '—'}</td>
                                        <td className="px-4 py-2.5"><Badge tone={CLAIM_STATUS[c.status][1]}>{CLAIM_STATUS[c.status][0]}</Badge>{c.age_days !== null && <span className={`ml-2 text-sm ${c.age_days > 60 ? 'font-bold text-margin' : 'text-pencil'}`}>{c.age_days} d</span>}{c.rejection_reason && <span className="block text-xs text-margin">{c.rejection_reason}</span>}</td>
                                        <td className="px-4 py-2.5 text-right">{c.status !== 'paid' && <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>Update</Button>}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            {editing && <ClaimUpdate tenant={tenant} claim={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); toast('Claim updated'); load(); }} />}
        </div>
    );
}

export function ClaimUpdate({ tenant, claim, onClose, onDone }) {
    const [status, setStatus] = useState(claim.status === 'submitted' ? 'approved' : claim.status === 'approved' ? 'paid' : claim.status);
    const [approved, setApproved] = useState(claim.amount_approved ?? claim.amount_claimed);
    const [claimNo, setClaimNo] = useState(claim.claim_no ?? '');
    const [reason, setReason] = useState(claim.rejection_reason ?? '');
    const [reference, setReference] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function save() {
        setBusy(true);
        setError(null);
        try {
            await api(`claims/${claim.id}`, { method: 'PATCH', tenant, body: {
                status, claim_no: claimNo || null, amount_approved: status === 'rejected' ? null : Number(approved),
                rejection_reason: status === 'rejected' ? reason : null, reference: reference || null,
            } });
            onDone();
        } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title={`Claim · ${claim.insurer?.name ?? claim.provider}`} description={`Claimed ${claim.amount_claimed}`}
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
            <div className="space-y-4">
                <Field label="Status" name="status" as="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="submitted">Submitted</option><option value="approved">Approved by insurer</option><option value="rejected">Rejected</option><option value="paid">Paid — record the payment on the bill</option>
                </Field>
                {status !== 'rejected' && <Field label="Approved amount" name="amount_approved" type="number" min="0" step="0.01" error={error} value={approved} onChange={(e) => setApproved(e.target.value)} />}
                {status === 'rejected' && <Field label="Reason given by the insurer" name="rejection_reason" as="textarea" rows={2} error={error} value={reason} onChange={(e) => setReason(e.target.value)} />}
                <Field label="Insurer’s claim number" name="claim_no" error={error} value={claimNo} onChange={(e) => setClaimNo(e.target.value)} />
                {status === 'paid' && <Field label="Payment reference" name="reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Remittance / transfer ID" />}
            </div>
        </Modal>
    );
}

function PreAuths({ tenant, currency, canDecide }) {
    const toast = useToast();
    const [status, setStatus] = useState('requested');
    const [rows, setRows] = useState(null);
    const [creating, setCreating] = useState(false);
    const [deciding, setDeciding] = useState(null);
    const load = useCallback(() => api(`pre-authorizations${status ? `?status=${status}` : ''}`, { tenant }).then((r) => setRows(r.data)), [tenant, status]);
    useEffect(() => { load(); }, [load]);
    return (
        <div>
            <div className="flex flex-wrap items-center gap-2">
                <Pills value={status} onChange={setStatus} options={[['requested', 'Waiting'], ['approved', 'Approved'], ['denied', 'Denied'], ['', 'All']]} />
                <Button icon="plus" className="ml-auto" onClick={() => setCreating(true)}>Request pre-authorization</Button>
            </div>
            <div className="mt-4"><PreAuthList rows={rows} tenant={tenant} currency={currency} canDecide={canDecide} onDecide={setDeciding} /></div>
            {creating && <PreAuthForm tenant={tenant} onClose={() => setCreating(false)} onDone={() => { setCreating(false); toast('Request saved'); load(); }} />}
            {deciding && <PreAuthDecision tenant={tenant} pa={deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); toast('Saved'); load(); }} />}
        </div>
    );
}

function PreAuthList({ rows, tenant, currency, canDecide, onDecide, showPatient = true }) {
    if (!rows) return <Skeleton className="h-40 rounded-2xl" />;
    if (!rows.length) return <p className="rounded-xl border border-dashed border-rule bg-white/60 px-4 py-8 text-center text-pencil">No pre-authorizations.</p>;
    return (
        <ul className="divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-white">
            {rows.map((pa) => (
                <li key={pa.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                        <b className="text-graphite">{pa.service}</b>
                        <span className="block text-sm text-pencil">{[showPatient && pa.patient && <Link key="p" to={`/${tenant}/patients/${pa.patient.id}`} className="font-bold text-ink hover:underline">{pa.patient.first_name} {pa.patient.last_name}</Link>, pa.policy?.provider?.name, pa.diagnosis, pa.auth_no && `Auth ${pa.auth_no}`, pa.valid_until && `valid to ${date(pa.valid_until)}`].filter(Boolean).reduce((acc, x, i) => (i ? [...acc, ' · ', x] : [x]), [])}</span>
                    </div>
                    <span className="tabular-nums">{money(pa.estimated_amount, currency)}{pa.approved_amount !== null && <span className="text-pencil"> → {money(pa.approved_amount, currency)}</span>}</span>
                    <Badge tone={PA_STATUS[pa.status][1]}>{PA_STATUS[pa.status][0]}</Badge>
                    {canDecide && <Button size="sm" variant="secondary" onClick={() => onDecide(pa)}>Update</Button>}
                </li>
            ))}
        </ul>
    );
}

function PreAuthForm({ tenant, patient: fixed, onClose, onDone }) {
    const [patient, setPatient] = useState(fixed ?? null);
    const [policies, setPolicies] = useState([]);
    const [f, setF] = useState({ patient_policy_id: '', service: '', diagnosis: '', icd_code: '', estimated_amount: '', notes: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (!patient) return;
        api(`patients/${patient.id}/policies`, { tenant }).then((r) => {
            const valid = r.data.filter((p) => p.valid);
            setPolicies(valid);
            setF((x) => ({ ...x, patient_policy_id: valid[0]?.id ?? '' }));
        });
    }, [tenant, patient]);
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    async function save() {
        setBusy(true);
        setError(null);
        try { await api('pre-authorizations', { method: 'POST', tenant, body: { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')), patient_id: patient.id, patient_policy_id: Number(f.patient_policy_id), estimated_amount: Number(f.estimated_amount) } }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title="Request pre-authorization" description="Ask the insurer to approve a procedure or admission before it happens." size="lg"
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!patient || !f.patient_policy_id} onClick={save}>Save request</Button></>}>
            <div className="space-y-4">
                {!fixed && <PatientPicker tenant={tenant} value={patient} onChange={setPatient} />}
                {patient && (policies.length === 0 ? <p className="text-sm text-margin">This patient has no active policy. Add one on the patient’s Insurance tab first.</p> : (
                    <Field label="Policy" name="patient_policy_id" as="select" error={error} value={f.patient_policy_id} onChange={set('patient_policy_id')}>
                        {policies.map((p) => <option key={p.id} value={p.id}>{p.provider?.name} · {p.policy_no}</option>)}
                    </Field>
                ))}
                <Field label="Procedure / service" name="service" error={error} value={f.service} onChange={set('service')} placeholder="e.g. Laparoscopic cholecystectomy, 3-day admission" />
                <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
                    <Field label="Diagnosis" name="diagnosis" error={error} value={f.diagnosis} onChange={set('diagnosis')} />
                    <Field label="ICD-10" name="icd_code" error={error} value={f.icd_code} onChange={set('icd_code')} />
                </div>
                <Field label="Estimated cost" name="estimated_amount" type="number" min="0" step="0.01" error={error} value={f.estimated_amount} onChange={set('estimated_amount')} className="sm:w-56" />
                <Field label="Notes" name="notes" as="textarea" rows={2} error={error} value={f.notes} onChange={set('notes')} />
            </div>
        </Modal>
    );
}

function PreAuthDecision({ tenant, pa, onClose, onDone }) {
    const [status, setStatus] = useState(pa.status === 'requested' ? 'approved' : pa.status);
    const [amount, setAmount] = useState(pa.approved_amount ?? pa.estimated_amount);
    const [authNo, setAuthNo] = useState(pa.auth_no ?? '');
    const [until, setUntil] = useState(pa.valid_until ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function save() {
        setBusy(true);
        try { await api(`pre-authorizations/${pa.id}`, { method: 'PATCH', tenant, body: { status, approved_amount: ['approved', 'partial'].includes(status) ? Number(amount) : null, auth_no: authNo || null, valid_until: until || null } }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title={`Pre-authorization · ${pa.service}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
            <div className="space-y-4">
                <Field label="Insurer’s answer" name="status" as="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                    {Object.entries(PA_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                </Field>
                {['approved', 'partial'].includes(status) && <>
                    <Field label="Authorization number" name="auth_no" error={error} value={authNo} onChange={(e) => setAuthNo(e.target.value)} />
                    <Field label="Approved amount" name="approved_amount" type="number" min="0" step="0.01" error={error} value={amount} onChange={(e) => setAmount(e.target.value)} />
                    <Field label="Valid until" name="valid_until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
                </>}
            </div>
        </Modal>
    );
}

function Aging({ tenant }) {
    const [d, setD] = useState(null);
    useEffect(() => { api('insurance/aging', { tenant }).then(setD); }, [tenant]);
    if (!d) return <Skeleton className="h-48 rounded-2xl" />;
    const cur = d.currency;
    return (
        <div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[['Owed by insurers', money(d.totals.open, cur)], ['Claimed in total', money(d.totals.claimed, cur)], ['Received', money(d.totals.paid, cur)], ['Approval rate', d.totals.approval_rate !== null ? `${d.totals.approval_rate}%` : '—']].map(([l, v]) => (
                    <div key={l} className="rounded-2xl border border-rule bg-white p-4"><p className="text-sm text-pencil">{l}</p><p className="font-display text-2xl font-bold text-ink-deep tabular-nums">{v}</p></div>
                ))}
            </div>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-rule bg-white">
                {d.rows.length === 0 ? <p className="p-8 text-center text-pencil">Nothing outstanding. Every claim is paid or closed.</p> : (
                    <table className="w-full min-w-[40rem] text-right tabular-nums">
                        <thead className="border-b border-rule bg-paper text-sm text-pencil"><tr><th className="px-4 py-3 text-left">Insurer</th><th className="px-4 py-3">Claims</th><th className="px-4 py-3">0–30 days</th><th className="px-4 py-3">31–60</th><th className="px-4 py-3">61–90</th><th className="px-4 py-3">90+</th><th className="px-4 py-3">Total</th></tr></thead>
                        <tbody className="divide-y divide-rule">
                            {d.rows.map((r) => (
                                <tr key={r.provider}>
                                    <td className="px-4 py-2.5 text-left font-bold">{r.provider}</td><td className="px-4 py-2.5">{r.count}</td>
                                    <td className="px-4 py-2.5">{money(r['0_30'], cur)}</td><td className="px-4 py-2.5">{money(r['31_60'], cur)}</td>
                                    <td className={`px-4 py-2.5 ${r['61_90'] > 0 ? 'text-amber-700' : ''}`}>{money(r['61_90'], cur)}</td><td className={`px-4 py-2.5 ${r['90_plus'] > 0 ? 'font-bold text-margin' : ''}`}>{money(r['90_plus'], cur)}</td>
                                    <td className="px-4 py-2.5 font-bold">{money(r.total, cur)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

function Payers({ tenant, canEdit }) {
    const toast = useToast();
    const [rows, setRows] = useState(null);
    const [editing, setEditing] = useState(null);
    const load = useCallback(() => api('insurance/providers?all=1', { tenant }).then((r) => setRows(r.data)), [tenant]);
    useEffect(() => { load(); }, [load]);
    return (
        <div>
            {canEdit && <div className="mb-4 flex justify-end"><Button icon="plus" onClick={() => setEditing({})}>Add insurance company</Button></div>}
            {!rows ? <Skeleton className="h-40 rounded-2xl" /> : rows.length === 0 ? <EmptyState icon="shield" title="No insurance companies yet">Add the insurers and schemes you work with.</EmptyState> : (
                <ul className="divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-white">
                    {rows.map((p) => (
                        <li key={p.id} className={`flex flex-wrap items-center gap-3 px-5 py-3 ${p.is_active ? '' : 'opacity-60'}`}>
                            <div className="min-w-0 flex-1"><b className="text-graphite">{p.name}</b>{p.code && <span className="ml-2 font-mono text-sm text-pencil">{p.code}</span>}
                                <span className="block text-sm text-pencil">{[PAYER_TYPES[p.type], `${Number(p.default_coverage)}% default cover`, `pays in ${p.payment_terms_days} days`, p.contact_person, p.phone].filter(Boolean).join(' · ')}</span></div>
                            <Badge>{p.active_policies} patients</Badge>
                            {p.open_claims > 0 && <Badge tone="warning">{p.open_claims} open claims</Badge>}
                            {canEdit && <IconButton icon="edit" label="Edit" onClick={() => setEditing(p)} />}
                        </li>
                    ))}
                </ul>
            )}
            {editing && <PayerForm tenant={tenant} payer={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); toast('Saved'); load(); }} />}
        </div>
    );
}

function PayerForm({ tenant, payer, onClose, onDone }) {
    const keys = ['name', 'code', 'type', 'contact_person', 'phone', 'email', 'address', 'default_coverage', 'payment_terms_days'];
    const [f, setF] = useState({ ...Object.fromEntries(keys.map((k) => [k, payer[k] ?? ''])), type: payer.type ?? 'private', default_coverage: payer.default_coverage ?? 80, payment_terms_days: payer.payment_terms_days ?? 30, is_active: payer.is_active ?? true });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    async function save() {
        setBusy(true);
        try {
            const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v]));
            body.default_coverage = Number(f.default_coverage);
            body.payment_terms_days = Number(f.payment_terms_days);
            await api(payer.id ? `insurance/providers/${payer.id}` : 'insurance/providers', { method: payer.id ? 'PATCH' : 'POST', tenant, body });
            onDone();
        } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title={payer.id ? 'Edit insurance company' : 'Add insurance company'} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" name="name" error={error} value={f.name} onChange={set('name')} className="sm:col-span-2" />
                <Field label="Code" name="code" error={error} value={f.code} onChange={set('code')} />
                <Field label="Type" name="type" as="select" value={f.type} onChange={set('type')}>{Object.entries(PAYER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Field>
                <Field label="Default coverage (%)" name="default_coverage" type="number" min="0" max="100" error={error} value={f.default_coverage} onChange={set('default_coverage')} />
                <Field label="Pays within (days)" name="payment_terms_days" type="number" min="0" error={error} value={f.payment_terms_days} onChange={set('payment_terms_days')} />
                <Field label="Contact person" name="contact_person" error={error} value={f.contact_person} onChange={set('contact_person')} />
                <Field label="Phone" name="phone" error={error} value={f.phone} onChange={set('phone')} />
                <Field label="Email" name="email" type="email" error={error} value={f.email} onChange={set('email')} />
                <Field label="Address" name="address" error={error} value={f.address} onChange={set('address')} />
                {payer.id && <label className="flex items-center gap-2 font-bold"><input type="checkbox" className="h-5 w-5 accent-ink" checked={!!f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />We work with them</label>}
            </div>
        </Modal>
    );
}

/** The Insurance tab on a patient's chart: policies, pre-authorizations and claims. */
export function PatientInsurance({ tenant, me, patient, onChange }) {
    const toast = useToast();
    const role = me.user.role;
    const canEdit = ['admin', 'accountant', 'receptionist'].includes(role);
    const [d, setD] = useState(null);
    const [policy, setPolicy] = useState(null);
    const [preauth, setPreauth] = useState(false);
    const load = useCallback(() => api(`patients/${patient.id}/policies`, { tenant }).then(setD), [tenant, patient.id]);
    useEffect(() => { load(); }, [load]);
    if (!d) return <Skeleton className="h-48 rounded-2xl" />;
    const currency = me.tenant.settings?.currency ?? 'USD';
    return (
        <div className="space-y-5">
            <section>
                <div className="mb-2 flex items-center justify-between"><h3 className="font-bold">Policies</h3>{canEdit && <Button size="sm" icon="plus" onClick={() => setPolicy({})}>Add policy</Button>}</div>
                {d.data.length === 0 ? <p className="rounded-xl border border-dashed border-rule bg-white/60 px-4 py-6 text-center text-pencil">No insurance on file — the patient pays themselves.</p> : (
                    <ul className="grid gap-3 sm:grid-cols-2">
                        {d.data.map((p) => (
                            <li key={p.id} className={`rounded-2xl border bg-white p-4 ${p.valid ? 'border-rule' : 'border-rule opacity-60'}`}>
                                <div className="flex items-start gap-2">
                                    <div className="min-w-0 flex-1"><b className="text-graphite">{p.provider?.name}</b>{p.is_primary && <span className="ml-2"><Badge tone="draft">Primary</Badge></span>}
                                        <p className="font-mono text-sm">{p.policy_no}{p.member_id ? ` · member ${p.member_id}` : ''}</p></div>
                                    {!p.valid && <Badge tone="danger">{p.status === 'active' ? 'Out of date' : p.status}</Badge>}
                                    {canEdit && <IconButton icon="edit" label="Edit policy" onClick={() => setPolicy(p)} />}
                                </div>
                                <p className="mt-2 text-sm text-pencil">{[p.plan_name, `${Number(p.coverage_percent)}% cover`, Number(p.copay) > 0 && `co-pay ${money(p.copay, currency)}`, p.annual_limit && `limit ${money(p.annual_limit, currency)}/yr`, p.relation !== 'self' && `holder: ${p.holder_name ?? ''} (${p.relation})`, (p.valid_from || p.valid_to) && `${p.valid_from ? date(p.valid_from) : '…'} – ${p.valid_to ? date(p.valid_to) : '…'}`].filter(Boolean).join(' · ')}</p>
                                {p.card_url && <a href={p.card_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm font-bold text-ink hover:underline">Insurance card</a>}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
            <section>
                <div className="mb-2 flex items-center justify-between"><h3 className="font-bold">Pre-authorizations</h3><Button size="sm" variant="secondary" icon="plus" disabled={!d.data.some((p) => p.valid)} onClick={() => setPreauth(true)}>Request</Button></div>
                <PreAuthList rows={d.pre_authorizations} tenant={tenant} currency={currency} canDecide={false} showPatient={false} />
            </section>
            {d.claims.length > 0 && (
                <section>
                    <h3 className="mb-2 font-bold">Claims</h3>
                    <ul className="divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-white">
                        {d.claims.map((c) => (
                            <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                                <span className="min-w-0 flex-1"><b>{c.provider}</b> <span className="text-sm text-pencil">· {c.invoice?.number} · {date(c.created_at)}</span></span>
                                <span className="tabular-nums">{money(c.amount_claimed, c.invoice?.currency ?? currency)}</span>
                                <Badge tone={CLAIM_STATUS[c.status][1]}>{CLAIM_STATUS[c.status][0]}</Badge>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
            {policy && <PolicyForm tenant={tenant} patient={patient} policy={policy} onClose={() => setPolicy(null)} onDone={() => { setPolicy(null); toast('Policy saved'); load(); onChange?.(); }} />}
            {preauth && <PreAuthForm tenant={tenant} patient={patient} onClose={() => setPreauth(false)} onDone={() => { setPreauth(false); toast('Request saved'); load(); }} />}
        </div>
    );
}

function PolicyForm({ tenant, patient, policy, onClose, onDone }) {
    const [payers, setPayers] = useState([]);
    const keys = ['insurance_provider_id', 'policy_no', 'member_id', 'group_no', 'plan_name', 'holder_name', 'relation', 'coverage_percent', 'copay', 'annual_limit', 'valid_from', 'valid_to', 'status'];
    const [f, setF] = useState({ ...Object.fromEntries(keys.map((k) => [k, policy[k] ?? ''])), relation: policy.relation ?? 'self', status: policy.status ?? 'active', is_primary: policy.is_primary ?? true });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => { api('insurance/providers', { tenant }).then((r) => setPayers(r.data)); }, [tenant]);
    const set = (k) => (e) => {
        const v = e.target.value;
        const payer = k === 'insurance_provider_id' ? payers.find((p) => String(p.id) === v) : null;
        setF({ ...f, [k]: v, ...(payer && !policy.id ? { coverage_percent: payer.default_coverage } : {}) });
    };
    async function save() {
        setBusy(true);
        setError(null);
        try {
            const body = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== '' && (policy.id || k !== 'status')));
            ['insurance_provider_id', 'coverage_percent', 'copay', 'annual_limit'].forEach((k) => { if (body[k] !== undefined) body[k] = Number(body[k]); });
            await api(policy.id ? `policies/${policy.id}` : `patients/${patient.id}/policies`, { method: policy.id ? 'PATCH' : 'POST', tenant, body });
            onDone();
        } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title={policy.id ? 'Edit policy' : 'Add insurance policy'} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Insurance company" name="insurance_provider_id" as="select" error={error} value={f.insurance_provider_id} onChange={set('insurance_provider_id')} className="sm:col-span-2">
                    <option value="">{payers.length ? 'Choose…' : 'Add insurance companies on the Insurance page first'}</option>
                    {payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Field>
                <Field label="Policy no." name="policy_no" error={error} value={f.policy_no} onChange={set('policy_no')} />
                <Field label="Member ID" name="member_id" error={error} value={f.member_id} onChange={set('member_id')} />
                <Field label="Group no." name="group_no" error={error} value={f.group_no} onChange={set('group_no')} />
                <Field label="Plan" name="plan_name" error={error} value={f.plan_name} onChange={set('plan_name')} />
                <Field label="Policy holder is the patient’s" name="relation" as="select" value={f.relation} onChange={set('relation')}>
                    <option value="self">Self</option><option value="spouse">Spouse</option><option value="child">Parent of a child</option><option value="parent">Child of a parent</option><option value="other">Other</option>
                </Field>
                {f.relation !== 'self' && <Field label="Policy holder name" name="holder_name" error={error} value={f.holder_name} onChange={set('holder_name')} />}
                <Field label="Coverage (%)" name="coverage_percent" type="number" min="0" max="100" error={error} value={f.coverage_percent} onChange={set('coverage_percent')} />
                <Field label="Co-pay per bill" name="copay" type="number" min="0" step="0.01" error={error} value={f.copay} onChange={set('copay')} />
                <Field label="Annual limit" name="annual_limit" type="number" min="0" step="0.01" error={error} value={f.annual_limit} onChange={set('annual_limit')} />
                <Field label="Valid from" name="valid_from" type="date" error={error} value={f.valid_from} onChange={set('valid_from')} />
                <Field label="Valid to" name="valid_to" type="date" error={error} value={f.valid_to} onChange={set('valid_to')} />
                {policy.id && <Field label="Status" name="status" as="select" value={f.status} onChange={set('status')}><option value="active">Active</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option></Field>}
                <label className="flex items-center gap-2 font-bold sm:col-span-2"><input type="checkbox" className="h-5 w-5 accent-ink" checked={!!f.is_primary} onChange={(e) => setF({ ...f, is_primary: e.target.checked })} />Primary policy (bills are claimed against it)</label>
            </div>
        </Modal>
    );
}
