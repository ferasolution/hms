import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { DISPOSITIONS, minutes, patientLine, TRIAGE } from '../../lib/hms';
import PatientPicker from '../../components/PatientPicker';
import StatTiles from '../../components/StatTiles';
import { Badge, Button, Checkbox, EmptyState, Field, Menu, Modal, PageHeader, Skeleton, Tabs, useToast } from '../../components/ui';
import { useDoctors } from './Appointments';
import { useFreeBeds } from './Inpatients';

const ARRIVAL = { walk_in: 'Walk-in', ambulance: 'Ambulance', referral: 'Referral', police: 'Police', other: 'Other' };
const STATUS = { waiting: ['Waiting', 'warning'], in_treatment: ['In treatment', 'published'], observation: ['Observation', 'draft'] };
const TRIP_STATUS = { requested: ['Requested', 'warning'], dispatched: ['Dispatched', 'draft'], on_scene: ['On scene', 'published'], transporting: ['Transporting', 'published'], completed: ['Completed', 'success'], cancelled: ['Cancelled', 'neutral'] };
const NEXT_TRIP = { dispatched: 'on_scene', on_scene: 'transporting', transporting: 'completed' };
const AMB_TYPES = { bls: 'Basic life support', als: 'Advanced life support', patient_transport: 'Patient transport' };

export default function Emergency() {
    const { tenant, me } = useOutletContext();
    const [tab, setTab] = useState('board');
    return (
        <div>
            <PageHeader title="Emergency" description="Live triage board, treatment, dispositions and ambulance dispatch." />
            <Tabs className="mt-6" value={tab} onChange={setTab} tabs={[{ value: 'board', label: 'Live board' }, { value: 'ambulance', label: 'Ambulance' }, { value: 'history', label: 'Closed visits' }]} />
            <div className="mt-5">
                {tab === 'board' && <Board tenant={tenant} me={me} />}
                {tab === 'ambulance' && <Ambulance tenant={tenant} me={me} />}
                {tab === 'history' && <History tenant={tenant} />}
            </div>
        </div>
    );
}

function TriageChip({ level, large }) {
    if (!level) return <span className={`inline-grid place-items-center rounded-xl bg-paper font-bold text-pencil ring-1 ring-dashed ring-rule ${large ? 'h-14 w-14 text-xs' : 'h-8 px-2 text-xs'}`}>Triage</span>;
    const [label, cls] = TRIAGE[level];
    return (
        <span title={label} className={`relative inline-grid place-items-center rounded-xl font-display font-extrabold ${cls} ${large ? 'h-14 w-14 text-2xl' : 'h-8 w-8 text-sm'}`}>
            {level}
            {level <= 2 && <span className="absolute inset-0 animate-ping rounded-xl bg-current opacity-20" aria-hidden />}
        </span>
    );
}

function Board({ tenant, me }) {
    const toast = useToast();
    const role = me.user.role;
    const canTriage = ['admin', 'doctor', 'nurse'].includes(role);
    const canDispose = ['admin', 'doctor'].includes(role);
    const [d, setD] = useState(null);
    const [arrival, setArrival] = useState(false);
    const [triaging, setTriaging] = useState(null);
    const [disposing, setDisposing] = useState(null);
    const [level, setLevel] = useState(null);
    const doctors = useDoctors(tenant);

    const load = useCallback(() => api('emergency/board', { tenant }).then(setD).catch((e) => toast(e.message, 'error')), [tenant, toast]);
    useEffect(() => { load(); const i = setInterval(load, 20000); return () => clearInterval(i); }, [load]);

    async function patch(v, body, msg) {
        try { await api(`emergency/visits/${v.id}`, { method: 'PATCH', tenant, body }); toast(msg); load(); } catch (e) { toast(e.message, 'error'); }
    }

    const s = d?.summary;
    const rows = (d?.data ?? []).filter((v) => level === null || (level === 0 ? !v.triage_level : v.triage_level === level));

    return (
        <div>
            <StatTiles items={[
                { label: 'In department', value: s?.in_department },
                { label: 'Awaiting triage', value: s?.awaiting_triage, tone: s?.awaiting_triage ? 'warning' : 'ink' },
                { label: 'Critical (1–2)', value: s?.critical, tone: s?.critical ? 'danger' : 'ink' },
                { label: 'Arrivals today', value: s?.arrivals_today },
                { label: 'Avg. time in ER today', value: s ? minutes(s.avg_los_minutes) : null },
            ]} />

            <div className="mt-5 flex flex-wrap items-center gap-2">
                <button type="button" aria-pressed={level === null} onClick={() => setLevel(null)} className={`rounded-full px-3.5 py-1.5 text-sm font-bold ring-1 ${level === null ? 'bg-ink-deep text-white ring-ink-deep' : 'bg-white text-graphite ring-rule'}`}>All</button>
                <button type="button" aria-pressed={level === 0} onClick={() => setLevel(0)} className={`rounded-full px-3.5 py-1.5 text-sm font-bold ring-1 ${level === 0 ? 'bg-ink-deep text-white ring-ink-deep' : 'bg-white text-graphite ring-rule'}`}>Not triaged</button>
                {[1, 2, 3, 4, 5].map((l) => (
                    <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)} className={`flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-sm font-bold ring-1 ${level === l ? 'bg-ink-deep text-white ring-ink-deep' : 'bg-white text-graphite ring-rule'}`}>
                        <span className={`grid h-6 w-6 place-items-center rounded-full text-xs ${TRIAGE[l][1]}`}>{l}</span>{TRIAGE[l][0]}
                        {s?.by_level?.[l] ? <span className="text-pencil">· {s.by_level[l]}</span> : null}
                    </button>
                ))}
                <Button className="ml-auto" icon="plus" onClick={() => setArrival(true)}>New arrival</Button>
            </div>

            <div className="mt-4">
                {!d ? <Skeleton className="h-64 rounded-2xl" /> : rows.length === 0 ? (
                    <EmptyState icon="ambulance" title="The department is clear">New arrivals appear here, sorted by triage level and waiting time.</EmptyState>
                ) : (
                    <motion.ul layout className="space-y-3">
                        <AnimatePresence initial={false}>
                            {rows.map((v) => (
                                <motion.li key={v.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }}
                                    className={`relative overflow-hidden rounded-2xl border bg-white p-4 sm:p-5 ${v.overdue ? 'border-red-300 shadow-[0_0_0_4px_rgba(239,68,68,.08)]' : 'border-rule'}`}>
                                    {v.triage_level && <span className={`absolute inset-y-0 left-0 w-1.5 ${TRIAGE[v.triage_level][1].split(' ')[0]}`} aria-hidden />}
                                    <div className="flex flex-wrap items-start gap-4">
                                        <TriageChip level={v.triage_level} large />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Link to={`/${tenant}/patients/${v.patient?.id}`} className="font-bold text-graphite hover:text-ink">{v.patient?.name}</Link>
                                                <span className="text-sm text-pencil">{patientLine(v.patient)}</span>
                                                <Badge tone={STATUS[v.status]?.[1]}>{STATUS[v.status]?.[0]}</Badge>
                                                {v.isolation && <Badge tone="danger">Isolation</Badge>}
                                                {v.arrival_mode !== 'walk_in' && <Badge>{ARRIVAL[v.arrival_mode]}</Badge>}
                                            </div>
                                            <p className="mt-1 text-[15px] text-graphite">{v.chief_complaint}</p>
                                            {v.red_flags && <p className="mt-1 text-sm font-semibold text-margin">⚠ {v.red_flags}</p>}
                                            {v.patient?.allergies && <p className="mt-1 text-sm text-margin">Allergies: {v.patient.allergies}</p>}
                                            {v.vitals && Object.keys(v.vitals).length > 0 && (
                                                <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                                                    {Object.entries(v.vitals).filter(([, x]) => x !== null && x !== '').map(([k, x]) => <span key={k} className="rounded-md bg-paper px-2 py-0.5 font-semibold text-graphite ring-1 ring-rule">{k.toUpperCase()} {x}</span>)}
                                                    {v.pain_score != null && <span className="rounded-md bg-paper px-2 py-0.5 font-semibold text-graphite ring-1 ring-rule">PAIN {v.pain_score}/10</span>}
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-right">
                                            <p className={`font-display text-xl font-extrabold tabular-nums ${v.overdue ? 'text-margin' : 'text-ink-deep'}`}>{minutes(v.minutes)}</p>
                                            <p className="text-xs text-pencil">{v.overdue ? 'Over target wait' : 'in department'}</p>
                                            {v.bay && <p className="mt-1 text-sm font-bold text-graphite">{v.bay}</p>}
                                            {v.doctor && <p className="text-sm text-pencil">{v.doctor.name}</p>}
                                        </div>
                                    </div>
                                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-rule pt-3">
                                        {canTriage && <Button size="sm" variant={v.triage_level ? 'secondary' : 'primary'} onClick={() => setTriaging(v)}>{v.triage_level ? 'Re-triage' : 'Triage now'}</Button>}
                                        {!v.doctor && role === 'doctor' && <Button size="sm" variant="secondary" onClick={() => patch(v, { doctor_id: me.user.id }, 'Assigned to you')}>Take patient</Button>}
                                        <select aria-label="Assign doctor" value={v.doctor?.id ?? ''} onChange={(e) => e.target.value && patch(v, { doctor_id: Number(e.target.value) }, 'Doctor assigned')} className="h-9 rounded-lg border border-rule bg-white px-2 text-sm">
                                            <option value="">Assign doctor…</option>{doctors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                                        </select>
                                        <input aria-label="Bay" defaultValue={v.bay ?? ''} placeholder="Bay / bed" onBlur={(e) => e.target.value !== (v.bay ?? '') && patch(v, { bay: e.target.value || null }, 'Bay updated')} className="h-9 w-28 rounded-lg border border-rule px-2 text-sm" />
                                        <Menu items={[
                                            v.status !== 'observation' && { label: 'Move to observation', onClick: () => patch(v, { status: 'observation' }, 'Under observation') },
                                            v.status !== 'in_treatment' && { label: 'Mark in treatment', onClick: () => patch(v, { status: 'in_treatment' }, 'In treatment') },
                                            { label: 'Open chart', onClick: () => window.location.assign(`/${tenant}/patients/${v.patient?.id}`) },
                                        ].filter(Boolean)} />
                                        {canDispose && <Button size="sm" className="ml-auto" onClick={() => setDisposing(v)}>Disposition</Button>}
                                    </div>
                                </motion.li>
                            ))}
                        </AnimatePresence>
                    </motion.ul>
                )}
            </div>

            {arrival && <ArrivalDialog tenant={tenant} onClose={() => setArrival(false)} onDone={() => { setArrival(false); toast('Arrival registered'); load(); }} />}
            {triaging && <TriageDialog tenant={tenant} visit={triaging} onClose={() => setTriaging(null)} onDone={() => { setTriaging(null); toast('Triage saved'); load(); }} />}
            {disposing && <DisposeDialog tenant={tenant} visit={disposing} onClose={() => setDisposing(null)} onDone={(r) => { setDisposing(null); toast(`${DISPOSITIONS[r.disposition]}`); load(); }} />}
        </div>
    );
}

function ArrivalDialog({ tenant, onClose, onDone, trip }) {
    const [mode, setMode] = useState('existing');
    const [patient, setPatient] = useState(null);
    const [f, setF] = useState({ first_name: '', last_name: '', phone: '', unknown_gender: '', arrival_mode: trip ? 'ambulance' : 'walk_in', chief_complaint: trip?.reason ?? '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

    async function save() {
        setBusy(true); setError(null);
        const body = { arrival_mode: f.arrival_mode, chief_complaint: f.chief_complaint, ambulance_trip_id: trip?.id };
        if (mode === 'existing') body.patient_id = patient?.id;
        else if (mode === 'unknown') { body.unknown = true; body.unknown_gender = f.unknown_gender || null; } else Object.assign(body, { first_name: f.first_name, last_name: f.last_name, phone: f.phone || null });
        try { onDone(await api('emergency/visits', { method: 'POST', tenant, body })); } catch (e) { setError(e); } finally { setBusy(false); }
    }

    return (
        <Modal open onClose={onClose} title="New emergency arrival" description="Register first, triage straight after. Unknown patients can be named later."
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!f.chief_complaint || (mode === 'existing' && !patient)} onClick={save}>Register arrival</Button></>}>
            <div className="space-y-4">
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-paper p-1 ring-1 ring-rule">
                    {[['existing', 'Known patient'], ['new', 'New patient'], ['unknown', 'Unidentified']].map(([v, l]) => (
                        <button key={v} type="button" aria-pressed={mode === v} onClick={() => setMode(v)} className={`rounded-lg py-2 text-sm font-bold ${mode === v ? 'bg-white text-ink-deep shadow-sm' : 'text-pencil'}`}>{l}</button>
                    ))}
                </div>
                {mode === 'existing' && <PatientPicker tenant={tenant} value={patient} onChange={setPatient} />}
                {mode === 'new' && (
                    <div className="grid gap-3 sm:grid-cols-3">
                        <Field label="First name" name="first_name" error={error} value={f.first_name} onChange={set('first_name')} />
                        <Field label="Last name" name="last_name" error={error} value={f.last_name} onChange={set('last_name')} />
                        <Field label="Phone" name="phone" error={error} value={f.phone} onChange={set('phone')} />
                    </div>
                )}
                {mode === 'unknown' && (
                    <Field label="Apparent sex" name="unknown_gender" as="select" value={f.unknown_gender} onChange={set('unknown_gender')} hint="Registered as “Unknown Patient” with a temporary MRN.">
                        <option value="">Not sure</option><option value="male">Male</option><option value="female">Female</option>
                    </Field>
                )}
                <Field label="Arrived by" name="arrival_mode" as="select" value={f.arrival_mode} onChange={set('arrival_mode')}>
                    {Object.entries(ARRIVAL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Field>
                <Field label="Chief complaint" name="chief_complaint" as="textarea" rows={2} error={error} value={f.chief_complaint} onChange={set('chief_complaint')} placeholder="e.g. Chest pain for 40 minutes, sweating" />
            </div>
        </Modal>
    );
}

function TriageDialog({ tenant, visit, onClose, onDone }) {
    const [level, setLevel] = useState(visit.triage_level ?? null);
    const [vitals, setVitals] = useState({ bp: '', pulse: '', temperature: '', spo2: '', respiration: '', gcs: '', sugar: '', ...(visit.vitals ?? {}) });
    const [pain, setPain] = useState(visit.pain_score ?? '');
    const [flags, setFlags] = useState(visit.red_flags ?? '');
    const [isolation, setIsolation] = useState(!!visit.isolation);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const V = [['bp', 'BP', '120/80'], ['pulse', 'Pulse', 'bpm'], ['spo2', 'SpO₂', '%'], ['respiration', 'Resp.', '/min'], ['temperature', 'Temp', '°F'], ['gcs', 'GCS', '3–15'], ['sugar', 'Glucose', 'mg/dL']];

    async function save() {
        setBusy(true); setError(null);
        const clean = Object.fromEntries(Object.entries(vitals).filter(([, x]) => x !== '' && x !== null).map(([k, x]) => [k, k === 'bp' ? x : Number(x)]));
        try {
            await api(`emergency/visits/${visit.id}/triage`, { method: 'POST', tenant, body: { triage_level: level, vitals: clean, pain_score: pain === '' ? null : Number(pain), red_flags: flags || null, isolation } });
            onDone();
        } catch (e) { setError(e); } finally { setBusy(false); }
    }

    return (
        <Modal open size="lg" onClose={onClose} title={`Triage · ${visit.patient?.name}`} description={visit.chief_complaint}
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!level} onClick={save}>Save triage</Button></>}>
            <div className="space-y-5">
                <div>
                    <p className="mb-2 text-sm font-bold text-graphite">Triage level (5-level acuity)</p>
                    <div className="grid grid-cols-5 gap-2">
                        {[1, 2, 3, 4, 5].map((l) => (
                            <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)}
                                className={`rounded-xl p-2 text-center ring-2 transition ${level === l ? `${TRIAGE[l][1]} ring-ink-deep scale-[1.03]` : 'bg-white ring-rule hover:ring-ink/30'}`}>
                                <span className="block font-display text-2xl font-extrabold">{l}</span>
                                <span className="block text-xs font-bold leading-tight">{TRIAGE[l][0]}</span>
                                <span className="block text-[11px] opacity-80">See in {TRIAGE[l][2]}</span>
                            </button>
                        ))}
                    </div>
                    {error?.errors?.triage_level && <p className="mt-1 text-sm text-margin">{error.errors.triage_level[0]}</p>}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {V.map(([k, l, ph]) => <Field key={k} label={l} name={`vitals.${k}`} error={error} value={vitals[k] ?? ''} placeholder={ph} inputMode={k === 'bp' ? 'text' : 'decimal'} onChange={(e) => setVitals({ ...vitals, [k]: e.target.value })} />)}
                    <Field label="Pain (0–10)" name="pain_score" error={error} value={pain} inputMode="numeric" onChange={(e) => setPain(e.target.value)} />
                </div>
                <Field label="Red flags" name="red_flags" value={flags} onChange={(e) => setFlags(e.target.value)} placeholder="e.g. Suspected stroke — onset 30 min" />
                <Checkbox label="Needs isolation" hint="Infectious or immunocompromised — shown on the board." checked={isolation} onChange={setIsolation} />
            </div>
        </Modal>
    );
}

function DisposeDialog({ tenant, visit, onClose, onDone }) {
    const [disposition, setDisposition] = useState('discharged');
    const [bedId, setBedId] = useState('');
    const [notes, setNotes] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const beds = useFreeBeds(tenant);

    async function save() {
        setBusy(true); setError(null);
        try { onDone(await api(`emergency/visits/${visit.id}/dispose`, { method: 'POST', tenant, body: { disposition, notes: notes || null, bed_id: disposition === 'admitted' ? Number(bedId) : null } })); } catch (e) { setError(e); } finally { setBusy(false); }
    }

    return (
        <Modal open onClose={onClose} title={`Disposition · ${visit.patient?.name}`} description={`In the department for ${minutes(visit.minutes)}`}
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={disposition === 'admitted' && !bedId} onClick={save}>Close visit</Button></>}>
            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                    {Object.entries(DISPOSITIONS).map(([k, l]) => (
                        <button key={k} type="button" aria-pressed={disposition === k} onClick={() => setDisposition(k)} className={`rounded-xl px-3 py-2.5 text-left text-sm font-bold ring-1 ${disposition === k ? 'bg-ink-deep text-white ring-ink-deep' : 'bg-white text-graphite ring-rule'}`}>{l}</button>
                    ))}
                </div>
                {disposition === 'admitted' && (
                    <Field label="Admit to bed" name="bed_id" as="select" error={error} value={bedId} onChange={(e) => setBedId(e.target.value)}>
                        <option value="">{beds === null ? 'Loading…' : beds.length ? 'Choose a free bed…' : 'No free beds'}</option>
                        {(beds ?? []).map((b) => <option key={b.id} value={b.id}>{b.ward.name} · {b.number}</option>)}
                    </Field>
                )}
                <Field label="Notes" name="notes" as="textarea" rows={3} error={error} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Diagnosis, advice, follow-up or where the patient was sent" />
            </div>
        </Modal>
    );
}

function History({ tenant }) {
    const [rows, setRows] = useState(null);
    useEffect(() => { api('emergency/history', { tenant }).then((r) => setRows(r.data)); }, [tenant]);
    if (!rows) return <Skeleton className="h-48 rounded-2xl" />;
    if (!rows.length) return <EmptyState icon="ambulance" title="No closed visits yet" />;
    return (
        <div className="overflow-x-auto rounded-2xl border border-rule bg-white">
            <table className="w-full text-left text-sm">
                <thead className="bg-paper text-pencil"><tr><th className="p-3">Level</th><th className="p-3">Patient</th><th className="p-3">Complaint</th><th className="p-3">Arrived</th><th className="p-3">Time in ER</th><th className="p-3">Outcome</th></tr></thead>
                <tbody className="divide-y divide-rule">
                    {rows.map((v) => (
                        <tr key={v.id}>
                            <td className="p-3"><TriageChip level={v.triage_level} /></td>
                            <td className="p-3"><Link className="font-bold text-graphite hover:text-ink" to={`/${tenant}/patients/${v.patient?.id}`}>{v.patient?.name}</Link><span className="block text-xs text-pencil">{v.patient?.mrn}</span></td>
                            <td className="max-w-xs p-3 text-graphite">{v.chief_complaint}</td>
                            <td className="whitespace-nowrap p-3 text-pencil">{dateTime(v.arrived_at)}</td>
                            <td className="p-3 tabular-nums">{minutes(v.minutes)}</td>
                            <td className="p-3"><Badge tone={v.disposition === 'deceased' ? 'danger' : v.disposition === 'admitted' ? 'published' : 'neutral'}>{DISPOSITIONS[v.disposition] ?? v.disposition}</Badge></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function Ambulance({ tenant, me }) {
    const toast = useToast();
    const isAdmin = me.user.role === 'admin';
    const [d, setD] = useState(null);
    const [call, setCall] = useState(false);
    const [adding, setAdding] = useState(false);
    const [arriving, setArriving] = useState(null);
    const load = useCallback(() => api('emergency/ambulances', { tenant }).then(setD), [tenant]);
    useEffect(() => { load(); const i = setInterval(load, 30000); return () => clearInterval(i); }, [load]);

    async function trip(t, body, msg) {
        try { await api(`emergency/trips/${t.id}`, { method: 'PATCH', tenant, body }); toast(msg); load(); } catch (e) { toast(e.message, 'error'); }
    }
    async function fleet(a, status) {
        try { await api(`emergency/ambulances/${a.id}`, { method: 'PATCH', tenant, body: { status } }); load(); } catch (e) { toast(e.message, 'error'); }
    }
    const free = (d?.data ?? []).filter((a) => a.status === 'available');

    return (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
            <section>
                <div className="flex items-center justify-between"><h2 className="font-display text-lg font-bold text-ink-deep">Calls & trips</h2><Button icon="phone" onClick={() => setCall(true)}>New call</Button></div>
                <div className="mt-3">
                    {!d ? <Skeleton className="h-40 rounded-2xl" /> : d.trips.length === 0 ? <EmptyState icon="ambulance" title="No calls in the last 24 hours" /> : (
                        <ul className="space-y-3">
                            {d.trips.map((t) => (
                                <li key={t.id} className="rounded-2xl border border-rule bg-white p-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <b className="text-graphite">{t.patient_name || 'Patient'}</b>
                                        <Badge tone={TRIP_STATUS[t.status][1]}>{TRIP_STATUS[t.status][0]}</Badge>
                                        {t.ambulance && <Badge>{t.ambulance.vehicle_no}</Badge>}
                                        <span className="ml-auto text-sm text-pencil">{dateTime(t.requested_at)}</span>
                                    </div>
                                    <p className="mt-1 text-sm text-graphite">📍 {t.pickup_address}{t.destination ? ` → ${t.destination}` : ''}</p>
                                    {t.reason && <p className="text-sm text-pencil">{t.reason}</p>}
                                    {t.caller_phone && <p className="text-sm text-pencil">Caller: {t.caller_name} {t.caller_phone}</p>}
                                    {!['completed', 'cancelled'].includes(t.status) && (
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {t.status === 'requested' && (
                                                <select aria-label="Dispatch ambulance" defaultValue="" onChange={(e) => e.target.value && trip(t, { status: 'dispatched', ambulance_id: Number(e.target.value) }, 'Dispatched')} className="h-9 rounded-lg border border-rule bg-white px-2 text-sm">
                                                    <option value="">{free.length ? 'Dispatch…' : 'No ambulance free'}</option>
                                                    {free.map((a) => <option key={a.id} value={a.id}>{a.vehicle_no} · {AMB_TYPES[a.type] ?? a.type}</option>)}
                                                </select>
                                            )}
                                            {NEXT_TRIP[t.status] && <Button size="sm" variant="secondary" onClick={() => trip(t, { status: NEXT_TRIP[t.status] }, TRIP_STATUS[NEXT_TRIP[t.status]][0])}>Mark {TRIP_STATUS[NEXT_TRIP[t.status]][0].toLowerCase()}</Button>}
                                            {t.status === 'transporting' && !t.er_visit_id && <Button size="sm" onClick={() => setArriving(t)}>Arrived · register in ER</Button>}
                                            <Button size="sm" variant="ghost" onClick={() => trip(t, { status: 'cancelled' }, 'Cancelled')}>Cancel</Button>
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </section>
            <aside>
                <div className="flex items-center justify-between"><h2 className="font-display text-lg font-bold text-ink-deep">Fleet</h2>{isAdmin && <Button size="sm" variant="secondary" icon="plus" onClick={() => setAdding(true)}>Add</Button>}</div>
                <ul className="mt-3 space-y-2">
                    {(d?.data ?? []).map((a) => (
                        <li key={a.id} className="flex items-center gap-3 rounded-xl border border-rule bg-white p-3">
                            <span className={`h-2.5 w-2.5 rounded-full ${a.status === 'available' ? 'bg-leaf' : a.status === 'on_trip' ? 'bg-amber-500' : 'bg-pencil'}`} aria-hidden />
                            <div className="min-w-0 flex-1"><b className="text-graphite">{a.vehicle_no}</b><span className="block text-xs text-pencil">{AMB_TYPES[a.type] ?? a.type}{a.driver_name ? ` · ${a.driver_name}` : ''}</span></div>
                            <select aria-label={`Status of ${a.vehicle_no}`} value={a.status} disabled={a.status === 'on_trip'} onChange={(e) => fleet(a, e.target.value)} className="h-8 rounded-lg border border-rule bg-white px-1.5 text-xs">
                                <option value="available">Available</option><option value="on_trip" disabled>On trip</option><option value="maintenance">Maintenance</option>
                            </select>
                        </li>
                    ))}
                    {d && !d.data.length && <li className="rounded-xl border border-dashed border-rule p-4 text-sm text-pencil">No ambulances yet.</li>}
                </ul>
            </aside>
            {call && <CallDialog tenant={tenant} free={free} onClose={() => setCall(false)} onDone={() => { setCall(false); toast('Call logged'); load(); }} />}
            {adding && <AmbulanceDialog tenant={tenant} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
            {arriving && <ArrivalDialog tenant={tenant} trip={arriving} onClose={() => setArriving(null)} onDone={() => { setArriving(null); toast('Registered in Emergency'); load(); }} />}
        </div>
    );
}

function CallDialog({ tenant, free, onClose, onDone }) {
    const [f, setF] = useState({ caller_name: '', caller_phone: '', patient_name: '', pickup_address: '', destination: '', reason: '', ambulance_id: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    async function save() {
        setBusy(true); setError(null);
        const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : k === 'ambulance_id' ? Number(v) : v]));
        try { await api('emergency/trips', { method: 'POST', tenant, body }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title="Ambulance call" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!f.pickup_address} onClick={save}>Log call</Button></>}>
            <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Caller name" name="caller_name" error={error} value={f.caller_name} onChange={set('caller_name')} />
                <Field label="Caller phone" name="caller_phone" error={error} value={f.caller_phone} onChange={set('caller_phone')} />
                <Field className="sm:col-span-2" label="Pick-up address" name="pickup_address" error={error} value={f.pickup_address} onChange={set('pickup_address')} />
                <Field label="Patient name" name="patient_name" error={error} value={f.patient_name} onChange={set('patient_name')} />
                <Field label="Destination" name="destination" error={error} value={f.destination} onChange={set('destination')} placeholder="This hospital" />
                <Field className="sm:col-span-2" label="What happened" name="reason" error={error} value={f.reason} onChange={set('reason')} />
                <Field className="sm:col-span-2" label="Dispatch now" name="ambulance_id" as="select" error={error} value={f.ambulance_id} onChange={set('ambulance_id')}>
                    <option value="">Later</option>{free.map((a) => <option key={a.id} value={a.id}>{a.vehicle_no}</option>)}
                </Field>
            </div>
        </Modal>
    );
}

function AmbulanceDialog({ tenant, onClose, onDone }) {
    const [f, setF] = useState({ vehicle_no: '', type: 'bls', driver_name: '', phone: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    async function save() {
        setBusy(true); setError(null);
        try { await api('emergency/ambulances', { method: 'POST', tenant, body: { ...f, driver_name: f.driver_name || null, phone: f.phone || null } }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title="Add ambulance" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!f.vehicle_no} onClick={save}>Add</Button></>}>
            <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Vehicle number" name="vehicle_no" error={error} value={f.vehicle_no} onChange={set('vehicle_no')} />
                <Field label="Type" name="type" as="select" value={f.type} onChange={set('type')}>{Object.entries(AMB_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Field>
                <Field label="Driver" name="driver_name" error={error} value={f.driver_name} onChange={set('driver_name')} />
                <Field label="Phone" name="phone" error={error} value={f.phone} onChange={set('phone')} />
            </div>
        </Modal>
    );
}
