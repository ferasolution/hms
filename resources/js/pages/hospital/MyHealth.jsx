import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../../lib/api';
import { date, money } from '../../lib/format';
import { INVOICE_STATUS, RX_STATUS, shortDate, time, today } from '../../lib/hms';
import Icon from '../../components/Icon';
import { Badge, Button, EmptyState, Field, Modal, Skeleton, Tabs, useToast } from '../../components/ui';
import { LabOrderSummary } from './PatientChart';
import { AppointmentBadge } from './Appointments';

/** The patient portal: the patient's own records and online booking. */
export default function MyHealth() {
    const { tenant, me } = useOutletContext();
    const toast = useToast();
    const [d, setD] = useState(null);
    const [err, setErr] = useState(null);
    const [tab, setTab] = useState('visits');
    const [booking, setBooking] = useState(false);
    const load = useCallback(() => api('portal', { tenant }).then(setD).catch((e) => setErr(e.message)), [tenant]);
    useEffect(() => { load(); }, [load]);

    async function cancel(a) {
        try { await api(`portal/appointments/${a.id}/cancel`, { method: 'POST', tenant }); toast('Cancelled'); load(); } catch (e) { toast(e.message, 'error'); }
    }

    if (err) return <EmptyState icon="user" title="Your record isn’t linked yet">{err}</EmptyState>;
    if (!d) return <Skeleton className="h-96 rounded-2xl" />;

    return (
        <div>
            <header className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <p className="text-pencil">{me.tenant.name} · {d.patient.mrn}</p>
                    <h1 className="mt-1 text-3xl font-extrabold sm:text-4xl">Hello, {d.patient.first_name}</h1>
                </div>
                {me.tenant.settings?.modules?.appointments !== false && <Button icon="calendar" onClick={() => setBooking(true)}>Book a visit</Button>}
            </header>

            <section className="mt-8">
                <h2 className="text-lg font-bold">Upcoming appointments</h2>
                {d.upcoming.length === 0 ? <p className="mt-2 rounded-xl border border-dashed border-rule bg-white/60 px-4 py-6 text-center text-pencil">Nothing booked.</p> : (
                    <ul className="mt-2 grid gap-3 sm:grid-cols-2">
                        {d.upcoming.map((a) => (
                            <li key={a.id} className="rounded-2xl border border-rule bg-white p-4">
                                <p className="font-display text-lg font-bold text-ink-deep">{shortDate(a.scheduled_at)} · {time(a.scheduled_at)}</p>
                                <p className="text-pencil">{a.doctor?.name}{a.department ? ` · ${a.department.name}` : ''}</p>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <AppointmentBadge status={a.status} />
                                    {a.video_url && <Button size="sm" icon="video" as="a" href={a.video_url} target="_blank" rel="noreferrer">Join video visit</Button>}
                                    {a.status === 'scheduled' && <Button size="sm" variant="ghost" onClick={() => cancel(a)}>Cancel</Button>}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <Tabs className="mt-8" value={tab} onChange={setTab} tabs={[
                { value: 'visits', label: 'Visits' }, { value: 'rx', label: 'Prescriptions' }, { value: 'results', label: 'Test results' }, { value: 'bills', label: 'Bills' },
            ]} />
            <div className="mt-4">
                {tab === 'visits' && (d.visits.length === 0 ? <Empty text="No visits yet." /> : (
                    <ul className="space-y-3">
                        {d.visits.map((v) => (
                            <li key={v.id} className="rounded-2xl border border-rule bg-white p-4">
                                <p className="font-bold text-graphite">{date(v.created_at)} · {v.doctor?.name}</p>
                                {v.diagnosis && <p className="mt-1"><span className="text-pencil">Diagnosis:</span> {v.diagnosis}</p>}
                                {v.plan && <p className="mt-1 whitespace-pre-line"><span className="text-pencil">Advice:</span> {v.plan}</p>}
                                {v.follow_up_on && <p className="mt-1 text-sm text-ink"><Icon name="calendar" size={14} className="inline" /> Follow-up on {date(v.follow_up_on)}</p>}
                            </li>
                        ))}
                    </ul>
                ))}
                {tab === 'rx' && (d.prescriptions.length === 0 ? <Empty text="No prescriptions." /> : (
                    <ul className="space-y-3">
                        {d.prescriptions.map((rx) => (
                            <li key={rx.id} className="rounded-2xl border border-rule bg-white p-4">
                                <div className="flex items-center gap-2"><p className="flex-1 font-bold">{date(rx.created_at)} · {rx.doctor?.name}</p><Badge tone={RX_STATUS[rx.status][1]}>{RX_STATUS[rx.status][0]}</Badge></div>
                                <ul className="mt-2 space-y-1">{rx.items.map((i) => <li key={i.id}><b>{i.medicine_name}</b> <span className="text-pencil">{[i.dosage, i.frequency, i.duration_days && `for ${i.duration_days} days`, i.instructions].filter(Boolean).join(' · ')}</span></li>)}</ul>
                            </li>
                        ))}
                    </ul>
                ))}
                {tab === 'results' && (d.results.length === 0 ? <Empty text="No results yet." /> : (
                    <ul className="divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-white">{d.results.map((o) => <li key={o.id} className="px-5 py-3"><LabOrderSummary order={o} /></li>)}</ul>
                ))}
                {tab === 'bills' && (d.invoices.length === 0 ? <Empty text="No bills." /> : (
                    <ul className="divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-white">
                        {d.invoices.map((i) => (
                            <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                                <div className="min-w-0 flex-1"><b>{i.number}</b><span className="block text-sm text-pencil">{date(i.created_at)} · {i.items.length} item{i.items.length === 1 ? '' : 's'}</span></div>
                                <span className="tabular-nums">{money(i.total, i.currency)}</span>
                                {Number(i.total) - Number(i.paid) > 0 && <span className="text-sm font-bold text-margin">Due {money(Number(i.total) - Number(i.paid), i.currency)}</span>}
                                <Badge tone={INVOICE_STATUS[i.status][1]}>{INVOICE_STATUS[i.status][0]}</Badge>
                            </li>
                        ))}
                    </ul>
                ))}
            </div>
            {booking && <PortalBook tenant={tenant} onClose={() => setBooking(false)} onDone={() => { setBooking(false); toast('Booked — see you then'); load(); }} />}
        </div>
    );
}

function Empty({ text }) {
    return <p className="rounded-xl border border-dashed border-rule bg-white/60 px-4 py-10 text-center text-pencil">{text}</p>;
}

function PortalBook({ tenant, onClose, onDone }) {
    const [doctors, setDoctors] = useState([]);
    const [doctorId, setDoctorId] = useState('');
    const [day, setDay] = useState(today(1));
    const [slots, setSlots] = useState(null);
    const [slot, setSlot] = useState('');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => { api('doctors', { tenant }).then((r) => setDoctors(r.data)); }, [tenant]);
    useEffect(() => {
        setSlot('');
        if (!doctorId) return;
        setSlots(null);
        api(`appointments/slots?doctor_id=${doctorId}&date=${day}`, { tenant }).then((r) => setSlots(r.data)).catch(() => setSlots([]));
    }, [tenant, doctorId, day]);
    async function save() {
        setBusy(true);
        setError(null);
        try { await api('portal/appointments', { method: 'POST', tenant, body: { doctor_id: Number(doctorId), scheduled_at: slot, reason: reason || null } }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    const doctor = doctors.find((x) => String(x.id) === doctorId);
    return (
        <Modal open onClose={onClose} title="Book a visit" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!slot} onClick={save}>Book</Button></>}>
            <div className="space-y-4">
                <Field label="Doctor" name="doctor_id" as="select" error={error} value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                    <option value="">Choose…</option>{doctors.map((x) => <option key={x.id} value={x.id}>{x.name}{x.specialization ? ` · ${x.specialization}` : x.department ? ` · ${x.department.name}` : ''}</option>)}
                </Field>
                {doctor?.bio && <p className="text-sm text-pencil">{doctor.bio}</p>}
                <Field label="Day" name="day" type="date" min={today()} value={day} onChange={(e) => setDay(e.target.value)} />
                {doctorId && (slots === null ? <Skeleton className="h-12" /> : slots.length === 0 ? <p className="text-sm text-pencil">No free times on this day.</p> : (
                    <div className="flex flex-wrap gap-2">{slots.map((s) => <button key={s} type="button" aria-pressed={slot === s} onClick={() => setSlot(s)} className={`rounded-lg px-3 py-1.5 text-sm font-bold ring-1 ${slot === s ? 'bg-ink text-white ring-ink' : 'bg-white ring-rule'}`}>{time(s.replace(' ', 'T'))}</button>)}</div>
                ))}
                {error?.errors?.scheduled_at && <p className="text-sm text-margin">{error.errors.scheduled_at[0]}</p>}
                <Field label="Reason (optional)" name="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                {error && !Object.keys(error.errors ?? {}).length && <p className="text-margin">{error.message}</p>}
            </div>
        </Modal>
    );
}
