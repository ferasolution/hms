import { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../../lib/api';
import { dateTime, money } from '../../lib/format';
import { BED_STATUS, patientLine, WARD_TYPES } from '../../lib/hms';
import Icon from '../../components/Icon';
import PatientPicker from '../../components/PatientPicker';
import { Badge, Button, EmptyState, Field, IconButton, Menu, Modal, PageHeader, Skeleton, Tabs, useToast } from '../../components/ui';
import { useDoctors } from './Appointments';

export default function Inpatients() {
    const { tenant, me } = useOutletContext();
    const toast = useToast();
    const isAdmin = me.user.role === 'admin';
    const [tab, setTab] = useState('board');
    const [board, setBoard] = useState(null);
    const [list, setList] = useState(null);
    const [admitting, setAdmitting] = useState(null);
    const [discharging, setDischarging] = useState(null);
    const [transferring, setTransferring] = useState(null);
    const [ward, setWard] = useState(null);
    const doctors = useDoctors(tenant);

    const load = useCallback(() => {
        api('ipd/board', { tenant }).then(setBoard);
        api(`admissions?status=${tab === 'discharged' ? 'discharged' : 'admitted'}`, { tenant }).then((r) => setList(r.data));
    }, [tenant, tab]);
    useEffect(() => { load(); }, [load]);

    async function bedStatus(bed, status) {
        try { await api(`beds/${bed.id}`, { method: 'PATCH', tenant, body: { status } }); load(); } catch (e) { toast(e.message, 'error'); }
    }

    return (
        <div>
            <PageHeader title="Inpatients" description="Bed board, admissions, transfers and discharge."
                actions={<>
                    {isAdmin && <Button variant="secondary" icon="plus" onClick={() => setWard({})}>Add ward</Button>}
                    <Button icon="bed" onClick={() => setAdmitting({})}>Admit patient</Button>
                </>} />

            {board && (
                <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[['Beds', board.summary.beds], ['Occupied', board.summary.occupied], ['Free', board.summary.available], ['Admitted today', board.summary.admitted_today]].map(([l, v]) => (
                        <div key={l} className="rounded-2xl border border-rule bg-white p-4"><p className="text-sm text-pencil">{l}</p><p className="font-display text-2xl font-bold text-ink-deep">{v}</p></div>
                    ))}
                </div>
            )}

            <Tabs className="mt-6" value={tab} onChange={setTab} tabs={[{ value: 'board', label: 'Bed board' }, { value: 'admitted', label: 'In hospital' }, { value: 'discharged', label: 'Discharged' }]} />

            <div className="mt-4">
                {tab === 'board' ? (!board ? <Skeleton className="h-64 rounded-2xl" /> : board.wards.length === 0 ? (
                    <EmptyState icon="bed" title="No wards yet" action={isAdmin && <Button icon="plus" onClick={() => setWard({})}>Add ward</Button>}>Add wards and beds to start admitting patients.</EmptyState>
                ) : (
                    <div className="space-y-5">
                        {board.wards.map((w) => (
                            <section key={w.id} className="rounded-2xl border border-rule bg-white p-5">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h2 className="flex-1 text-lg font-bold">{w.name} <span className="text-sm font-normal text-pencil">· {WARD_TYPES[w.type]}{w.floor ? ` · ${w.floor} floor` : ''}{Number(w.daily_rate) > 0 ? ` · ${money(w.daily_rate, me.tenant.settings?.currency ?? 'USD')}/day` : ''}</span></h2>
                                    <span className="text-sm text-pencil">{w.beds.filter((b) => b.status === 'available').length} of {w.beds.length} free</span>
                                    {isAdmin && <IconButton icon="edit" label="Edit ward" onClick={() => setWard(w)} />}
                                </div>
                                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                                    {w.beds.map((b) => (
                                        <div key={b.id} className={`rounded-xl p-3 ring-1 ${BED_STATUS[b.status][1]}`}>
                                            <div className="flex items-center gap-1">
                                                <p className="flex-1 font-bold">{b.number}</p>
                                                {b.status !== 'occupied' && (
                                                    <Menu label={`Bed ${b.number}`} items={[
                                                        b.status === 'available' && { label: 'Admit here', icon: 'bed', onClick: () => setAdmitting({ bed: b, ward: w }) },
                                                        b.status !== 'available' && { label: 'Mark ready', icon: 'check', onClick: () => bedStatus(b, 'available') },
                                                        b.status !== 'cleaning' && { label: 'Needs cleaning', icon: 'sparkle', onClick: () => bedStatus(b, 'cleaning') },
                                                        b.status !== 'maintenance' && { label: 'Out of service', icon: 'alert', onClick: () => bedStatus(b, 'maintenance') },
                                                    ].filter(Boolean)} />
                                                )}
                                            </div>
                                            {b.admission ? (
                                                <Link to={`/${tenant}/patients/${b.admission.patient?.id}`} className="mt-1 block">
                                                    <p className="truncate font-bold">{b.admission.patient?.name}</p>
                                                    <p className="truncate text-xs opacity-80">{b.admission.diagnosis ?? patientLine(b.admission.patient)}</p>
                                                </Link>
                                            ) : <p className="mt-1 text-sm">{BED_STATUS[b.status][0]}</p>}
                                        </div>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                )) : (!list ? <Skeleton className="h-48 rounded-2xl" /> : list.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-rule bg-white/60 px-4 py-10 text-center text-pencil">{tab === 'admitted' ? 'No one is admitted.' : 'No discharges yet.'}</p>
                ) : (
                    <ul className="divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-white">
                        {list.map((a) => (
                            <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                                <Link to={`/${tenant}/patients/${a.patient?.id}`} className="min-w-0 flex-1">
                                    <b className="text-graphite">{a.patient?.name}</b>
                                    <span className="block text-sm text-pencil">{a.bed?.ward?.name} · bed {a.bed?.number} · in {dateTime(a.admitted_at)}{a.discharged_at ? ` · out ${dateTime(a.discharged_at)}` : ''}{a.doctor ? ` · ${a.doctor.name}` : ''}</span>
                                </Link>
                                {a.diagnosis && <span className="text-sm text-pencil">{a.diagnosis}</span>}
                                {a.status === 'admitted' ? <>
                                    <Button size="sm" variant="secondary" onClick={() => setTransferring(a)}>Transfer</Button>
                                    <Button size="sm" onClick={() => setDischarging(a)}>Discharge</Button>
                                </> : <Badge>{a.discharge_type ?? 'Discharged'}</Badge>}
                            </li>
                        ))}
                    </ul>
                ))}
            </div>

            {admitting && <AdmitDialog tenant={tenant} doctors={doctors} bed={admitting.bed} ward={admitting.ward} onClose={() => setAdmitting(null)} onDone={() => { setAdmitting(null); toast('Admitted'); load(); }} />}
            {discharging && <DischargeDialog tenant={tenant} admission={discharging} onClose={() => setDischarging(null)} onDone={() => { setDischarging(null); toast('Discharged · room charges added to the bill'); load(); }} />}
            {transferring && <TransferDialog tenant={tenant} admission={transferring} doctors={doctors} onClose={() => setTransferring(null)} onDone={() => { setTransferring(null); toast('Transferred'); load(); }} />}
            {ward && <WardForm tenant={tenant} ward={ward} onClose={() => setWard(null)} onDone={() => { setWard(null); toast('Saved'); load(); }} />}
        </div>
    );
}

function useFreeBeds(tenant) {
    const [beds, setBeds] = useState(null);
    useEffect(() => {
        api('ipd/board', { tenant }).then((b) => setBeds(b.wards.flatMap((w) => w.beds.filter((x) => x.status === 'available').map((x) => ({ ...x, ward: w })))));
    }, [tenant]);
    return beds;
}

export function AdmitDialog({ tenant, doctors, patient: fixedPatient, bed: fixedBed, ward, onClose, onDone }) {
    const [patient, setPatient] = useState(fixedPatient ?? null);
    const [bedId, setBedId] = useState(fixedBed?.id ?? '');
    const [doctorId, setDoctorId] = useState('');
    const [reason, setReason] = useState('');
    const [diagnosis, setDiagnosis] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const beds = useFreeBeds(tenant);

    async function save() {
        setBusy(true);
        setError(null);
        try {
            await api('admissions', { method: 'POST', tenant, body: { patient_id: patient.id, bed_id: Number(bedId), doctor_id: doctorId ? Number(doctorId) : null, reason: reason || null, diagnosis: diagnosis || null } });
            onDone();
        } catch (e) { setError(e); } finally { setBusy(false); }
    }

    return (
        <Modal open onClose={onClose} title="Admit a patient" description={fixedBed ? `${ward?.name} · bed ${fixedBed.number}` : undefined}
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!patient || !bedId} onClick={save}>Admit</Button></>}>
            <div className="space-y-4">
                {!fixedPatient && <PatientPicker tenant={tenant} value={patient} onChange={setPatient} />}
                {!fixedBed && (
                    <Field label="Bed" name="bed_id" as="select" error={error} value={bedId} onChange={(e) => setBedId(e.target.value)}>
                        <option value="">{beds === null ? 'Loading…' : beds.length ? 'Choose a free bed…' : 'No free beds'}</option>
                        {(beds ?? []).map((b) => <option key={b.id} value={b.id}>{b.ward.name} · {b.number}</option>)}
                    </Field>
                )}
                <Field label="Admitting doctor" name="doctor_id" as="select" error={error} value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                    <option value="">—</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Field>
                <Field label="Reason for admission" name="reason" error={error} value={reason} onChange={(e) => setReason(e.target.value)} />
                <Field label="Provisional diagnosis" name="diagnosis" error={error} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
                {error && !Object.keys(error.errors ?? {}).length && <p className="text-margin">{error.message}</p>}
            </div>
        </Modal>
    );
}

function DischargeDialog({ tenant, admission, onClose, onDone }) {
    const [type, setType] = useState('recovered');
    const [summary, setSummary] = useState('');
    const [diagnosis, setDiagnosis] = useState(admission.diagnosis ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function save() {
        setBusy(true);
        try { await api(`admissions/${admission.id}/discharge`, { method: 'POST', tenant, body: { discharge_type: type, discharge_summary: summary || null, diagnosis: diagnosis || null } }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title={`Discharge ${admission.patient?.name}`} size="lg"
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Discharge</Button></>}>
            <div className="space-y-4">
                <Field label="Outcome" name="discharge_type" as="select" error={error} value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="recovered">Recovered / improved</option><option value="referred">Referred elsewhere</option><option value="lama">Left against medical advice</option><option value="deceased">Deceased</option>
                </Field>
                <Field label="Final diagnosis" name="diagnosis" error={error} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
                <Field label="Discharge summary" name="discharge_summary" as="textarea" rows={8} error={error} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Course in hospital, procedures, medicines on discharge, follow-up advice" />
                <p className="text-sm text-pencil"><Icon name="receipt" size={16} className="inline" /> Room charges for the stay are added to the patient’s bill.</p>
            </div>
        </Modal>
    );
}

function TransferDialog({ tenant, admission, doctors, onClose, onDone }) {
    const beds = useFreeBeds(tenant);
    const [bedId, setBedId] = useState('');
    const [doctorId, setDoctorId] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function save() {
        setBusy(true);
        try { await api(`admissions/${admission.id}/transfer`, { method: 'POST', tenant, body: { bed_id: Number(bedId), doctor_id: doctorId ? Number(doctorId) : null } }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title={`Transfer ${admission.patient?.name}`} description={`Now in ${admission.bed?.ward?.name} · bed ${admission.bed?.number}`}
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!bedId} onClick={save}>Transfer</Button></>}>
            <div className="space-y-4">
                <Field label="New bed" name="bed_id" as="select" error={error} value={bedId} onChange={(e) => setBedId(e.target.value)}>
                    <option value="">Choose…</option>{(beds ?? []).map((b) => <option key={b.id} value={b.id}>{b.ward.name} · {b.number}</option>)}
                </Field>
                <Field label="Hand over to doctor (optional)" name="doctor_id" as="select" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                    <option value="">Keep current doctor</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Field>
            </div>
        </Modal>
    );
}

function WardForm({ tenant, ward, onClose, onDone }) {
    const toast = useToast();
    const [f, setF] = useState({ name: ward.name ?? '', type: ward.type ?? 'general', floor: ward.floor ?? '', daily_rate: ward.daily_rate ?? '', beds: ward.id ? '' : 10, prefix: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    async function save() {
        setBusy(true);
        setError(null);
        try {
            if (ward.id) {
                await api(`wards/${ward.id}`, { method: 'PATCH', tenant, body: { name: f.name, type: f.type, floor: f.floor || null, daily_rate: Number(f.daily_rate || 0) } });
                if (Number(f.beds) > 0) await api(`wards/${ward.id}/beds`, { method: 'POST', tenant, body: { count: Number(f.beds), prefix: f.prefix || undefined } });
            } else {
                await api('wards', { method: 'POST', tenant, body: { name: f.name, type: f.type, floor: f.floor || null, daily_rate: Number(f.daily_rate || 0), beds: Number(f.beds || 0), prefix: f.prefix || undefined } });
            }
            onDone();
        } catch (e) { setError(e); } finally { setBusy(false); }
    }
    async function remove() {
        try { await api(`wards/${ward.id}`, { method: 'DELETE', tenant }); onDone(); } catch (e) { toast(e.message, 'error'); }
    }
    return (
        <Modal open onClose={onClose} title={ward.id ? `Edit ${ward.name}` : 'Add a ward'}
            footer={<>{ward.id && <Button variant="ghost" className="mr-auto text-margin" onClick={remove}>Delete ward</Button>}<Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
            <div className="space-y-4">
                <Field label="Name" name="name" error={error} value={f.name} onChange={set('name')} placeholder="e.g. Male Medical Ward" />
                <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Type" name="type" as="select" error={error} value={f.type} onChange={set('type')}>{Object.entries(WARD_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Field>
                    <Field label="Floor" name="floor" error={error} value={f.floor} onChange={set('floor')} />
                    <Field label="Charge per day" name="daily_rate" type="number" min="0" step="0.01" error={error} value={f.daily_rate} onChange={set('daily_rate')} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={ward.id ? 'Add beds' : 'Number of beds'} name="beds" type="number" min="0" max="200" error={error} value={f.beds} onChange={set('beds')} />
                    <Field label="Bed label prefix" name="prefix" error={error} value={f.prefix} onChange={set('prefix')} placeholder="e.g. M → M-01, M-02" />
                </div>
            </div>
        </Modal>
    );
}
