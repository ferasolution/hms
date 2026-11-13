import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { date, dateTime, money } from '../../lib/format';
import { FLAG_TONE, INVOICE_STATUS, LAB_STATUS, RX_STATUS, shortDate, time, VITALS } from '../../lib/hms';
import Icon from '../../components/Icon';
import { Avatar, Badge, Button, Field, Modal, PageHeader, SlideOver, Skeleton, Tabs, useToast } from '../../components/ui';
import { PatientForm } from './Patients';
import { AppointmentBadge, BookDialog, useDoctors } from './Appointments';
import { AdmitDialog } from './Inpatients';

export default function PatientChart() {
    const { id } = useParams();
    const ctx = useOutletContext();
    const { tenant, me } = ctx;
    const toast = useToast();
    const [params, setParams] = useSearchParams();
    const [d, setD] = useState(null);
    const [tab, setTab] = useState('visits');
    const [editing, setEditing] = useState(false);
    const [noting, setNoting] = useState(params.get('note') ? { appointment_id: Number(params.get('note')) } : null);
    const [booking, setBooking] = useState(false);
    const [admitting, setAdmitting] = useState(false);
    const [portal, setPortal] = useState(false);
    const doctors = useDoctors(tenant);
    const role = me.user.role;
    const clinician = ['admin', 'doctor', 'nurse'].includes(role);
    const frontDesk = ['admin', 'receptionist', 'doctor', 'nurse'].includes(role);
    const billing = ['admin', 'receptionist', 'accountant'].includes(role);

    const load = useCallback(() => api(`patients/${id}`, { tenant }).then(setD).catch((e) => toast(e.message, 'error')), [tenant, id, toast]);
    useEffect(() => { load(); }, [load]);

    if (!d) return <Skeleton className="h-96 rounded-2xl" />;
    const p = d.patient;

    const tabs = [
        { value: 'visits', label: `Visits (${d.encounters.length})` },
        { value: 'appointments', label: 'Appointments' },
        { value: 'prescriptions', label: 'Prescriptions' },
        { value: 'labs', label: 'Lab & imaging' },
        { value: 'admissions', label: 'Admissions' },
        billing && { value: 'bills', label: 'Bills' },
    ].filter(Boolean);

    return (
        <div>
            <PageHeader back={{ to: `/${tenant}/patients`, label: 'Patients' }}
                title={<span className="flex items-center gap-3"><Avatar name={p.name} size={44} />{p.name}</span>}
                description={[p.mrn, p.age != null && `${p.age} years`, p.gender, p.blood_group && `Blood ${p.blood_group}`, p.phone].filter(Boolean).join(' · ')}
                actions={<>
                    {frontDesk && <Button variant="secondary" icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
                    {frontDesk && !d.admission && <Button variant="secondary" icon="bed" onClick={() => setAdmitting(true)}>Admit</Button>}
                    {frontDesk && <Button variant="secondary" icon="calendar" onClick={() => setBooking(true)}>Book</Button>}
                    {clinician && <Button icon="plus" onClick={() => setNoting({})}>{role === 'nurse' ? 'Record vitals' : 'New note'}</Button>}
                </>} />

            {(p.allergies || p.chronic_conditions) && (
                <div className="mt-6 flex flex-wrap gap-3">
                    {p.allergies && <div className="flex items-start gap-2 rounded-xl bg-margin/5 px-4 py-3 text-margin ring-1 ring-margin/20"><Icon name="alert" size={18} className="mt-0.5" /><span><b>Allergies:</b> {p.allergies}</span></div>}
                    {p.chronic_conditions && <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-amber-900 ring-1 ring-amber-600/20"><Icon name="activity" size={18} className="mt-0.5" /><span><b>Conditions:</b> {p.chronic_conditions}</span></div>}
                </div>
            )}

            {d.admission && (
                <Link to={`/${tenant}/inpatients`} className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-ink-deep px-4 py-3 text-white">
                    <Icon name="bed" size={20} />
                    <b>Admitted</b>
                    <span className="text-white/80">{d.admission.bed?.ward?.name} · bed {d.admission.bed?.number} · since {dateTime(d.admission.admitted_at)}{d.admission.doctor ? ` · ${d.admission.doctor.name}` : ''}</span>
                </Link>
            )}

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="min-w-0">
                    <Tabs value={tab} onChange={setTab} tabs={tabs} />
                    <div className="mt-4">
                        {tab === 'visits' && <Visits encounters={d.encounters} />}
                        {tab === 'appointments' && <Rows empty="No appointments yet." rows={d.appointments} render={(a) => (
                            <><div className="min-w-0 flex-1"><p className="font-bold text-graphite">{shortDate(a.scheduled_at, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · {time(a.scheduled_at)}</p><p className="text-sm text-pencil">{a.doctor?.name}{a.department ? ` · ${a.department.name}` : ''}{a.reason ? ` · ${a.reason}` : ''}</p></div><AppointmentBadge status={a.status} /></>
                        )} />}
                        {tab === 'prescriptions' && <Rows empty="No prescriptions yet." rows={d.prescriptions} render={(rx) => (
                            <div className="w-full">
                                <div className="flex flex-wrap items-center gap-2"><p className="flex-1 font-bold text-graphite">{date(rx.created_at)} · {rx.doctor?.name}</p><Badge tone={RX_STATUS[rx.status][1]}>{RX_STATUS[rx.status][0]}</Badge></div>
                                <ul className="mt-2 space-y-1 text-sm">{rx.items.map((i) => <li key={i.id}><b>{i.medicine_name}</b> <span className="text-pencil">{[i.dosage, i.frequency, i.duration_days && `${i.duration_days} days`, `qty ${i.quantity}`, i.instructions].filter(Boolean).join(' · ')}</span></li>)}</ul>
                            </div>
                        )} />}
                        {tab === 'labs' && <Rows empty="No tests ordered yet." rows={d.lab_orders} render={(o) => <LabOrderSummary order={o} />} />}
                        {tab === 'admissions' && <Rows empty="Never admitted." rows={d.admissions} render={(a) => (
                            <div className="w-full">
                                <div className="flex flex-wrap items-center gap-2"><p className="flex-1 font-bold text-graphite">{date(a.admitted_at)} → {a.discharged_at ? date(a.discharged_at) : 'now'}</p><Badge tone={a.status === 'admitted' ? 'published' : 'neutral'}>{a.status === 'admitted' ? 'In hospital' : `Discharged${a.discharge_type ? ` · ${a.discharge_type}` : ''}`}</Badge></div>
                                <p className="text-sm text-pencil">{a.bed?.ward?.name} · bed {a.bed?.number}{a.doctor ? ` · ${a.doctor.name}` : ''}{a.diagnosis ? ` · ${a.diagnosis}` : ''}</p>
                                {a.discharge_summary && <p className="mt-2 whitespace-pre-line text-sm text-graphite">{a.discharge_summary}</p>}
                            </div>
                        )} />}
                        {tab === 'bills' && <Rows empty="No bills yet." rows={d.invoices} render={(i) => (
                            <><Link to={`/${tenant}/billing/${i.id}`} className="min-w-0 flex-1 font-bold text-ink hover:underline">{i.number}<span className="block text-sm font-normal text-pencil">{date(i.created_at)}</span></Link>
                                <span className="tabular-nums">{money(i.total, i.currency)}</span><Badge tone={INVOICE_STATUS[i.status][1]}>{INVOICE_STATUS[i.status][0]}</Badge></>
                        )} />}
                    </div>
                </div>

                <aside className="space-y-4">
                    <Card title="Contact">
                        <Line label="Phone" value={p.phone} /><Line label="Email" value={p.email} /><Line label="Address" value={p.address} />
                        <Line label="Date of birth" value={p.date_of_birth && date(p.date_of_birth)} />
                    </Card>
                    <Card title="Emergency contact"><Line label={p.emergency_contact_name ?? 'Not recorded'} value={p.emergency_contact_phone} /></Card>
                    <Card title="Insurance"><Line label={p.insurance_provider ?? 'None'} value={p.insurance_number} /></Card>
                    {['admin', 'receptionist'].includes(role) && me.tenant.settings?.modules?.portal !== false && (
                        <Card title="Patient portal">
                            {p.portal_account ? <p className="text-sm text-pencil">Signs in as <b className="text-graphite">{p.portal_account.email}</b></p> : (
                                <><p className="text-sm text-pencil">Let the patient see results, prescriptions and bills, and book visits online.</p>
                                    <Button size="sm" variant="secondary" className="mt-3" onClick={() => setPortal(true)}>Create portal account</Button></>
                            )}
                        </Card>
                    )}
                    {p.notes && <Card title="Notes"><p className="text-sm whitespace-pre-line text-graphite">{p.notes}</p></Card>}
                </aside>
            </div>

            <PatientForm open={editing} tenant={tenant} patient={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); toast('Saved'); load(); }} />
            {noting && <EncounterForm tenant={tenant} me={me} patient={p} initial={noting} admission={d.admission} appointments={d.appointments}
                onClose={() => { setNoting(null); if (params.get('note')) setParams({}, { replace: true }); }}
                onDone={() => { setNoting(null); if (params.get('note')) setParams({}, { replace: true }); toast('Note saved'); setTab('visits'); load(); }} />}
            {booking && <BookDialog tenant={tenant} doctors={doctors} initial={{ patient: p }} defaultDoctor={role === 'doctor' ? me.user.id : null} onClose={() => setBooking(false)} onDone={() => { setBooking(false); toast('Booked'); load(); }} />}
            {admitting && <AdmitDialog tenant={tenant} doctors={doctors} patient={p} onClose={() => setAdmitting(false)} onDone={() => { setAdmitting(false); toast('Admitted'); load(); }} />}
            {portal && <PortalDialog tenant={tenant} patient={p} onClose={() => setPortal(false)} onDone={() => { setPortal(false); toast('Portal account created'); load(); }} />}
        </div>
    );
}

function Card({ title, children }) {
    return <section className="rounded-2xl border border-rule bg-white p-4"><h2 className="mb-2 text-sm font-bold text-pencil">{title}</h2><div className="space-y-1">{children}</div></section>;
}
function Line({ label, value }) {
    return <p className="text-sm"><span className="text-graphite">{label}</span>{value ? <span className="block text-pencil">{value}</span> : null}</p>;
}

function Rows({ rows, render, empty }) {
    if (!rows.length) return <p className="rounded-xl border border-dashed border-rule bg-white/60 px-4 py-10 text-center text-pencil">{empty}</p>;
    return <ul className="divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-white">{rows.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">{render(r)}</li>)}</ul>;
}

export function LabOrderSummary({ order }) {
    return (
        <div className="w-full">
            <div className="flex flex-wrap items-center gap-2">
                <p className="flex-1 font-bold text-graphite">{date(order.created_at)}{order.doctor ? ` · ${order.doctor.name}` : ''}</p>
                {order.priority !== 'routine' && <Badge tone="danger">{order.priority.toUpperCase()}</Badge>}
                <Badge tone={LAB_STATUS[order.status][1]}>{LAB_STATUS[order.status][0]}</Badge>
            </div>
            <ul className="mt-2 space-y-1.5 text-sm">
                {order.items.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-baseline gap-2">
                        <b className="text-graphite">{i.test?.name}</b>
                        {i.result ? <span className="text-graphite">{i.result}{i.test?.unit ? ` ${i.test.unit}` : ''}</span> : <span className="text-pencil">pending</span>}
                        {i.test?.normal_range && <span className="text-pencil">(ref {i.test.normal_range})</span>}
                        {i.flag && i.flag !== 'normal' && <Badge tone={FLAG_TONE[i.flag]}>{i.flag}</Badge>}
                        {i.attachment_url && <a href={i.attachment_url} target="_blank" rel="noreferrer" className="font-bold text-ink hover:underline">Report file</a>}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function Visits({ encounters }) {
    if (!encounters.length) return <p className="rounded-xl border border-dashed border-rule bg-white/60 px-4 py-10 text-center text-pencil">No visits recorded yet.</p>;
    return (
        <ol className="space-y-3">
            {encounters.map((e) => (
                <li key={e.id} className="rounded-2xl border border-rule bg-white p-5">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="flex-1 font-bold text-graphite">{dateTime(e.created_at)} · {e.doctor?.name}</p>
                        <Badge>{e.type.toUpperCase()}</Badge>
                    </div>
                    {e.vitals && Object.values(e.vitals).some((v) => v !== null && v !== '') && (
                        <div className="mt-3 flex flex-wrap gap-2">
                            {VITALS.filter(([k]) => e.vitals[k] != null && e.vitals[k] !== '').map(([k, l, unit]) => (
                                <span key={k} className="rounded-lg bg-paper px-2.5 py-1 text-sm ring-1 ring-rule"><span className="text-pencil">{l}</span> <b className="tabular-nums">{e.vitals[k]}</b> <span className="text-pencil">{unit}</span></span>
                            ))}
                        </div>
                    )}
                    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
                        {[['Complaints', e.complaints], ['Examination', e.examination], ['Diagnosis', e.diagnosis && `${e.diagnosis}${e.icd_code ? ` (${e.icd_code})` : ''}`], ['Plan', e.plan], ['Follow-up', e.follow_up_on && date(e.follow_up_on)]]
                            .filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="font-bold text-pencil">{k}</dt><dd className="whitespace-pre-line text-graphite">{v}</dd></div>)}
                    </dl>
                </li>
            ))}
        </ol>
    );
}

const BLANK_MED = { medicine_id: '', medicine_name: '', dosage: '', frequency: '', duration_days: '', quantity: '', instructions: '' };

/** The consultation note: vitals, findings, diagnosis, plan, prescription and test orders. */
export function EncounterForm({ tenant, me, patient, initial, admission, appointments = [], onClose, onDone }) {
    const prescribes = ['admin', 'doctor'].includes(me.user.role);
    const openAppts = appointments.filter((a) => ['scheduled', 'checked_in', 'in_progress'].includes(a.status));
    const [f, setF] = useState({ vitals: {}, complaints: '', examination: '', diagnosis: '', icd_code: '', plan: '', follow_up_on: '', appointment_id: initial.appointment_id ?? openAppts[0]?.id ?? '' });
    const [meds, setMeds] = useState([]);
    const [tests, setTests] = useState([]);
    const [catalogue, setCatalogue] = useState({ medicines: [], tests: [] });
    const [priority, setPriority] = useState('routine');
    const [complete, setComplete] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!prescribes) return;
        api('lab/tests', { tenant }).then((r) => setCatalogue((c) => ({ ...c, tests: r.data }))).catch(() => {});
        api('pharmacy/medicines', { tenant }).then((r) => setCatalogue((c) => ({ ...c, medicines: r.data }))).catch(() => {});
    }, [tenant, prescribes]);

    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    const setVital = (k) => (e) => setF({ ...f, vitals: { ...f.vitals, [k]: e.target.value } });
    const setMed = (i, k, v) => setMeds(meds.map((m, j) => (j === i ? { ...m, [k]: v } : m)));
    const testsByCat = useMemo(() => catalogue.tests.reduce((acc, t) => ({ ...acc, [t.category]: [...(acc[t.category] ?? []), t] }), {}), [catalogue.tests]);

    async function save() {
        setBusy(true);
        setError(null);
        const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null));
        try {
            await api('encounters', { method: 'POST', tenant, body: {
                patient_id: patient.id,
                appointment_id: f.appointment_id ? Number(f.appointment_id) : null,
                admission_id: admission?.id ?? null,
                vitals: clean(f.vitals),
                ...clean({ complaints: f.complaints, examination: f.examination, diagnosis: f.diagnosis, icd_code: f.icd_code, plan: f.plan, follow_up_on: f.follow_up_on }),
                medicines: meds.filter((m) => m.medicine_id || m.medicine_name).map((m) => clean({ ...m, medicine_id: m.medicine_id ? Number(m.medicine_id) : '', duration_days: m.duration_days ? Number(m.duration_days) : '', quantity: m.quantity ? Number(m.quantity) : '' })),
                lab_test_ids: tests,
                lab_priority: priority,
                complete_appointment: !!f.appointment_id && complete,
            } });
            onDone();
        } catch (e) { setError(e); } finally { setBusy(false); }
    }

    return (
        <SlideOver open onClose={onClose} title={prescribes ? 'Consultation note' : 'Vitals & nursing note'} description={`${patient.name} · ${patient.mrn}`}
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save note</Button></>}>
            <div className="space-y-6">
                {patient.allergies && <p className="rounded-lg bg-margin/5 px-3 py-2 text-sm text-margin ring-1 ring-margin/20"><b>Allergies:</b> {patient.allergies}</p>}
                {openAppts.length > 0 && (
                    <Field label="Appointment" name="appointment_id" as="select" value={f.appointment_id} onChange={set('appointment_id')}>
                        <option value="">Not linked to an appointment</option>
                        {openAppts.map((a) => <option key={a.id} value={a.id}>{shortDate(a.scheduled_at)} {time(a.scheduled_at)} · {a.doctor?.name}</option>)}
                    </Field>
                )}
                <fieldset>
                    <legend className="mb-2 font-bold text-graphite">Vitals</legend>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {VITALS.map(([k, l, unit, type]) => (
                            <Field key={k} label={`${l} (${unit})`} name={`vitals.${k}`} error={error} type={type ?? 'number'} step="any" inputMode={type ? 'text' : 'decimal'} placeholder={k === 'bp' ? '120/80' : ''} value={f.vitals[k] ?? ''} onChange={setVital(k)} />
                        ))}
                    </div>
                </fieldset>
                <Field label="Presenting complaints & history" name="complaints" as="textarea" rows={3} error={error} value={f.complaints} onChange={set('complaints')} />
                <Field label="Examination" name="examination" as="textarea" rows={3} error={error} value={f.examination} onChange={set('examination')} />
                {prescribes && (
                    <>
                        <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
                            <Field label="Diagnosis" name="diagnosis" error={error} value={f.diagnosis} onChange={set('diagnosis')} />
                            <Field label="ICD-10 code" name="icd_code" error={error} value={f.icd_code} onChange={set('icd_code')} placeholder="e.g. I10" />
                        </div>
                        <Field label="Plan & advice" name="plan" as="textarea" rows={3} error={error} value={f.plan} onChange={set('plan')} />
                        <Field label="Follow-up on" name="follow_up_on" type="date" error={error} value={f.follow_up_on} onChange={set('follow_up_on')} className="sm:w-56" />

                        <fieldset>
                            <legend className="mb-2 font-bold text-graphite">Prescription</legend>
                            <datalist id="med-list">{catalogue.medicines.map((m) => <option key={m.id} value={`${m.name} ${m.strength ?? ''}`.trim()} />)}</datalist>
                            <div className="space-y-3">
                                {meds.map((m, i) => (
                                    <div key={i} className="rounded-xl border border-rule p-3">
                                        <div className="flex gap-2">
                                            <input list="med-list" aria-label="Medicine" placeholder="Medicine" value={m.medicine_name}
                                                onChange={(e) => { const hit = catalogue.medicines.find((x) => `${x.name} ${x.strength ?? ''}`.trim() === e.target.value); setMeds(meds.map((row, j) => (j === i ? { ...row, medicine_name: e.target.value, medicine_id: hit?.id ?? '' } : row))); }}
                                                className="h-10 min-w-0 flex-1 rounded-lg border border-rule px-3" />
                                            <button type="button" aria-label="Remove" className="grid h-10 w-10 place-items-center rounded-lg text-pencil hover:bg-ink-50" onClick={() => setMeds(meds.filter((_, j) => j !== i))}><Icon name="x" size={18} /></button>
                                        </div>
                                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                                            <input aria-label="Dose" placeholder="Dose (500 mg)" value={m.dosage} onChange={(e) => setMed(i, 'dosage', e.target.value)} className="h-10 rounded-lg border border-rule px-3" />
                                            <input aria-label="Frequency" placeholder="1-0-1" value={m.frequency} onChange={(e) => setMed(i, 'frequency', e.target.value)} className="h-10 rounded-lg border border-rule px-3" />
                                            <input aria-label="Days" type="number" min="1" placeholder="Days" value={m.duration_days} onChange={(e) => setMed(i, 'duration_days', e.target.value)} className="h-10 rounded-lg border border-rule px-3" />
                                            <input aria-label="Quantity" type="number" min="1" placeholder="Qty" value={m.quantity} onChange={(e) => setMed(i, 'quantity', e.target.value)} className="h-10 rounded-lg border border-rule px-3" />
                                        </div>
                                        <input aria-label="Instructions" placeholder="Instructions (after meals…)" value={m.instructions} onChange={(e) => setMed(i, 'instructions', e.target.value)} className="mt-2 h-10 w-full rounded-lg border border-rule px-3" />
                                    </div>
                                ))}
                                <Button size="sm" variant="secondary" icon="plus" onClick={() => setMeds([...meds, BLANK_MED])}>Add medicine</Button>
                            </div>
                        </fieldset>

                        <fieldset>
                            <legend className="mb-2 font-bold text-graphite">Lab & imaging</legend>
                            {Object.entries(testsByCat).map(([cat, list]) => (
                                <div key={cat} className="mb-3">
                                    <p className="mb-1 text-xs font-bold text-pencil uppercase">{cat === 'radiology' ? 'Imaging' : 'Laboratory'}</p>
                                    <div className="flex flex-wrap gap-2">
                                        {list.map((t) => {
                                            const on = tests.includes(t.id);
                                            return <button key={t.id} type="button" aria-pressed={on} onClick={() => setTests(on ? tests.filter((x) => x !== t.id) : [...tests, t.id])}
                                                className={`rounded-full px-3 py-1 text-sm font-bold ring-1 ${on ? 'bg-ink text-white ring-ink' : 'bg-white text-graphite ring-rule hover:ring-ink/40'}`}>{t.name}</button>;
                                        })}
                                    </div>
                                </div>
                            ))}
                            {tests.length > 0 && (
                                <div className="flex gap-2">{['routine', 'urgent', 'stat'].map((pr) => <button key={pr} type="button" aria-pressed={priority === pr} onClick={() => setPriority(pr)} className={`rounded-lg px-3 py-1 text-sm font-bold ring-1 ${priority === pr ? 'bg-margin text-white ring-margin' : 'bg-white ring-rule'}`}>{pr === 'stat' ? 'STAT' : pr[0].toUpperCase() + pr.slice(1)}</button>)}</div>
                            )}
                        </fieldset>
                        {f.appointment_id && (
                            <label className="flex items-center gap-2 font-bold text-graphite"><input type="checkbox" className="h-5 w-5 accent-ink" checked={complete} onChange={(e) => setComplete(e.target.checked)} />Mark the appointment completed</label>
                        )}
                    </>
                )}
                {error && <p className="text-margin">{error.message}</p>}
            </div>
        </SlideOver>
    );
}

function PortalDialog({ tenant, patient, onClose, onDone }) {
    const [email, setEmail] = useState(patient.email ?? '');
    const [password, setPassword] = useState(() => `Care-${Math.random().toString(36).slice(2, 8)}-${Math.floor(1000 + Math.random() * 9000)}`);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function save() {
        setBusy(true);
        try { await api(`patients/${patient.id}/portal`, { method: 'POST', tenant, body: { email, password } }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title="Create a portal account" description={`Share these details with ${patient.name}. They sign in at ${window.location.origin}/${tenant}/login`}
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Create</Button></>}>
            <div className="space-y-4">
                <Field label="Email" name="email" type="email" error={error} value={email} onChange={(e) => setEmail(e.target.value)} />
                <Field label="Temporary password" name="password" error={error} value={password} onChange={(e) => setPassword(e.target.value)} hint="They can change it after signing in." />
            </div>
        </Modal>
    );
}
