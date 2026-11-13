import { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { APPT_STATUS, APPT_TYPES, localDay, patientLine, shortDate, time, today } from '../../lib/hms';
import Icon from '../../components/Icon';
import PatientPicker from '../../components/PatientPicker';
import { Avatar, Badge, Button, EmptyState, Field, Menu, Modal, PageHeader, Skeleton, useToast } from '../../components/ui';

export function useDoctors(tenant) {
    const [doctors, setDoctors] = useState([]);
    useEffect(() => { api('doctors', { tenant }).then((r) => setDoctors(r.data)).catch(() => {}); }, [tenant]);
    return doctors;
}

export default function Appointments() {
    const { tenant, me } = useOutletContext();
    const toast = useToast();
    const [params, setParams] = useSearchParams();
    const isDoctor = me.user.role === 'doctor';
    const [day, setDay] = useState(today());
    const [doctorId, setDoctorId] = useState('');
    const [d, setD] = useState(null);
    const [booking, setBooking] = useState(params.get('book') ? { patient: null } : null);
    const doctors = useDoctors(tenant);

    const load = useCallback(() => {
        const qs = new URLSearchParams({ date: day });
        if (doctorId) qs.set('doctor_id', doctorId);
        return api(`appointments?${qs}`, { tenant }).then(setD);
    }, [tenant, day, doctorId]);
    useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

    async function setStatus(a, status) {
        try { await api(`appointments/${a.id}`, { method: 'PATCH', tenant, body: { status } }); toast(APPT_STATUS[status][0]); load(); } catch (e) { toast(e.message, 'error'); }
    }

    const shift = (n) => { const dt = new Date(`${day}T12:00:00`); dt.setDate(dt.getDate() + n); setDay(dt.toISOString().slice(0, 10)); };

    return (
        <div>
            <PageHeader title={isDoctor ? 'My appointments' : 'Appointments'} description={isDoctor ? 'Your queue for the day. Open a patient to write the consultation note.' : 'Book visits, check patients in and run the waiting room.'}
                actions={<Button icon="plus" onClick={() => setBooking({ patient: null })}>Book appointment</Button>} />

            <div className="mt-8 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 rounded-xl bg-white p-1 ring-1 ring-rule">
                    <button type="button" aria-label="Previous day" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-ink-50" onClick={() => shift(-1)}><Icon name="arrowLeft" size={18} /></button>
                    <input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day" className="h-9 rounded-lg px-2 font-bold" />
                    <button type="button" aria-label="Next day" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-ink-50" onClick={() => shift(1)}><Icon name="arrowRight" size={18} /></button>
                </div>
                {day !== today() && <Button size="sm" variant="ghost" onClick={() => setDay(today())}>Today</Button>}
                {!isDoctor && (
                    <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} aria-label="Doctor" className="h-11 rounded-lg border border-rule bg-white px-3">
                        <option value="">All doctors</option>
                        {doctors.map((doc) => <option key={doc.id} value={doc.id}>{doc.name}{doc.department ? ` · ${doc.department.name}` : ''}</option>)}
                    </select>
                )}
            </div>

            {d && (
                <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[['Booked', d.data.filter((a) => a.status !== 'cancelled').length], ['Waiting', d.summary.checked_in], ['With doctor', d.summary.in_progress], ['Seen', d.summary.completed]].map(([l, v]) => (
                        <div key={l} className="rounded-2xl border border-rule bg-white p-4"><p className="text-sm text-pencil">{l}</p><p className="font-display text-2xl font-bold text-ink-deep">{v}</p></div>
                    ))}
                </div>
            )}

            <div className="mt-6">
                {!d ? <Skeleton className="h-64 rounded-2xl" /> : d.data.length === 0 ? (
                    <EmptyState icon="calendar" title={`Nothing booked for ${shortDate(day)}`} action={<Button icon="plus" onClick={() => setBooking({ patient: null })}>Book appointment</Button>}>
                        Walk-ins can be booked and checked in in one step.
                    </EmptyState>
                ) : (
                    <ul className="divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-white">
                        {d.data.map((a) => {
                            const [label, tone] = APPT_STATUS[a.status];
                            return (
                                <li key={a.id} className={`flex flex-wrap items-center gap-4 px-5 py-3.5 ${a.status === 'cancelled' ? 'opacity-60' : ''}`}>
                                    <div className="w-20 shrink-0">
                                        <p className="font-display text-lg font-bold text-ink-deep tabular-nums">{time(a.scheduled_at)}</p>
                                        {a.token_no && <p className="text-xs font-bold text-pencil">Token {a.token_no}</p>}
                                    </div>
                                    <Link to={`/${tenant}/patients/${a.patient?.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                                        <Avatar name={a.patient?.name ?? '?'} size={36} />
                                        <span className="min-w-0">
                                            <b className="text-graphite">{a.patient?.name}</b>
                                            <span className="block truncate text-sm text-pencil">{patientLine(a.patient)}{a.reason ? ` · ${a.reason}` : ''}</span>
                                        </span>
                                    </Link>
                                    {!isDoctor && <span className="hidden text-sm text-pencil lg:block">{a.doctor?.name}</span>}
                                    {a.type !== 'consultation' && <Badge>{APPT_TYPES[a.type]}</Badge>}
                                    <Badge tone={tone} dot>{label}</Badge>
                                    <div className="flex items-center gap-1">
                                        {a.status === 'scheduled' && !isDoctor && <Button size="sm" onClick={() => setStatus(a, 'checked_in')}>Check in</Button>}
                                        {['checked_in', 'in_progress'].includes(a.status) && (me.user.role === 'doctor' || me.user.role === 'admin') && (
                                            <Button size="sm" as={Link} to={`/${tenant}/patients/${a.patient?.id}?note=${a.id}`}>See patient</Button>
                                        )}
                                        {a.type === 'telemedicine' && a.video_url && <Button size="sm" variant="secondary" icon="video" as="a" href={a.video_url} target="_blank" rel="noreferrer">Join</Button>}
                                        <Menu items={[
                                            a.status !== 'completed' && { label: 'Mark completed', icon: 'check', onClick: () => setStatus(a, 'completed') },
                                            a.status === 'scheduled' && { label: 'Reschedule', icon: 'calendar', onClick: () => setBooking({ appointment: a, patient: a.patient }) },
                                            a.status === 'scheduled' && { label: 'No-show', icon: 'x', onClick: () => setStatus(a, 'no_show') },
                                            !['completed', 'cancelled'].includes(a.status) && { label: 'Cancel', icon: 'trash', danger: true, onClick: () => setStatus(a, 'cancelled') },
                                        ].filter(Boolean)} />
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {booking && (
                <BookDialog tenant={tenant} doctors={doctors} initial={booking} defaultDoctor={isDoctor ? me.user.id : null}
                    onClose={() => { setBooking(null); if (params.get('book')) setParams({}, { replace: true }); }}
                    onDone={(a) => { setBooking(null); toast(booking.appointment ? 'Rescheduled' : `Booked · token ${a.token_no ?? ''}`); setDay(localDay(a.scheduled_at)); load(); }} />
            )}
        </div>
    );
}

/** Pick doctor → day → free slot. Also used from the patient chart. */
export function BookDialog({ tenant, doctors, initial, defaultDoctor, onClose, onDone }) {
    const editing = initial.appointment;
    const [patient, setPatient] = useState(initial.patient ?? null);
    const [doctorId, setDoctorId] = useState(editing?.doctor?.id ?? defaultDoctor ?? '');
    const [day, setDay] = useState(editing ? localDay(editing.scheduled_at) : today());
    const [slots, setSlots] = useState(null);
    const [slot, setSlot] = useState('');
    const [custom, setCustom] = useState('');
    const [type, setType] = useState(editing?.type ?? 'consultation');
    const [reason, setReason] = useState(editing?.reason ?? '');
    const [videoUrl, setVideoUrl] = useState(editing?.video_url ?? '');
    const [walkIn, setWalkIn] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        setSlot('');
        if (!doctorId || !day) { setSlots(null); return; }
        api(`appointments/slots?doctor_id=${doctorId}&date=${day}`, { tenant }).then((r) => setSlots(r.data)).catch(() => setSlots([]));
    }, [tenant, doctorId, day]);

    const doctor = doctors.find((x) => String(x.id) === String(doctorId));
    const when = walkIn ? null : (slot || (custom ? `${day} ${custom}` : ''));

    async function save() {
        setBusy(true);
        setError(null);
        try {
            const body = { doctor_id: Number(doctorId), scheduled_at: walkIn ? localNow() : when, type, reason: reason || null, video_url: videoUrl || null };
            const a = editing
                ? await api(`appointments/${editing.id}`, { method: 'PATCH', tenant, body })
                : await api('appointments', { method: 'POST', tenant, body: { ...body, patient_id: patient?.id, walk_in: walkIn } });
            onDone(a);
        } catch (e) { setError(e); } finally { setBusy(false); }
    }

    return (
        <Modal open onClose={onClose} title={editing ? 'Reschedule' : 'Book an appointment'} size="lg"
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!patient || !doctorId || (!walkIn && !when)} onClick={save}>{walkIn ? 'Book & check in' : editing ? 'Save' : 'Book'}</Button></>}>
            <div className="space-y-5">
                {!editing && <PatientPicker tenant={tenant} value={patient} onChange={setPatient} error={error?.errors?.patient_id?.[0]} />}
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Doctor" name="doctor_id" as="select" error={error} value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                        <option value="">Choose…</option>
                        {doctors.map((x) => <option key={x.id} value={x.id}>{x.name}{x.specialization ? ` · ${x.specialization}` : x.department ? ` · ${x.department.name}` : ''}</option>)}
                    </Field>
                    <Field label="Visit type" name="type" as="select" value={type} onChange={(e) => setType(e.target.value)}>
                        {Object.entries(APPT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Field>
                </div>
                {doctor && Number(doctor.consultation_fee) > 0 && <p className="text-sm text-pencil">Consultation fee: <b>{doctor.consultation_fee}</b> (added to the bill at check-in)</p>}
                {!editing && (
                    <label className="flex items-center gap-2 font-bold text-graphite">
                        <input type="checkbox" className="h-5 w-5 accent-ink" checked={walkIn} onChange={(e) => setWalkIn(e.target.checked)} />
                        Walk-in: see now and check in
                    </label>
                )}
                {!walkIn && (
                    <div>
                        <Field label="Day" name="day" type="date" value={day} min={today()} onChange={(e) => setDay(e.target.value)} className="sm:w-56" />
                        <div className="mt-3">
                            {!doctorId ? <p className="text-sm text-pencil">Choose a doctor to see free times.</p> : slots === null ? <Skeleton className="h-16" /> : slots.length === 0 ? (
                                <p className="text-sm text-pencil">No free times on this day. Pick another day, or enter a time:</p>
                            ) : (
                                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Time">
                                    {slots.map((s) => (
                                        <button key={s} type="button" role="radio" aria-checked={slot === s} onClick={() => { setSlot(s); setCustom(''); }}
                                            className={`rounded-lg px-3 py-1.5 text-sm font-bold tabular-nums ring-1 ${slot === s ? 'bg-ink text-white ring-ink' : 'bg-white text-graphite ring-rule hover:ring-ink/40'}`}>
                                            {time(s.replace(' ', 'T'))}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {doctorId && <Field label="Or a specific time" name="scheduled_at" type="time" error={error} value={custom} onChange={(e) => { setCustom(e.target.value); setSlot(''); }} className="mt-3 sm:w-40" />}
                        </div>
                    </div>
                )}
                <Field label="Reason for visit" name="reason" error={error} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Fever for 3 days" />
                {type === 'telemedicine' && <Field label="Video link" name="video_url" error={error} value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://meet.google.com/…" hint="Zoom, Google Meet or Teams link the patient will use." />}
                {error && !Object.keys(error.errors ?? {}).length && <p className="text-margin">{error.message}</p>}
            </div>
        </Modal>
    );
}

function localNow() {
    const d = new Date(Date.now() + 60000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function AppointmentBadge({ status }) {
    const [label, tone] = APPT_STATUS[status] ?? [status, 'neutral'];
    return <Badge tone={tone} dot>{label}</Badge>;
}

export { shortDate };
