import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { FREQUENCIES, patientLine, ROUTES, time, today } from '../../lib/hms';
import { Badge, Button, Checkbox, EmptyState, Field, Modal, PageHeader, Skeleton, Tabs, useToast } from '../../components/ui';

const DOSE_TONE = { given: 'bg-leaf text-white', held: 'bg-amber-400 text-amber-950', refused: 'bg-orange-500 text-white', missed: 'bg-margin text-white' };
const NOTE_TYPES = { note: 'Progress note', handover: 'Shift handover', assessment: 'Assessment', care_plan: 'Care plan' };
const FLUID_ROUTES = { intake: { oral: 'Oral', iv: 'IV', ng: 'NG tube' }, output: { urine: 'Urine', drain: 'Drain', vomit: 'Vomit', stool: 'Stool', other: 'Other' } };

export default function Nursing() {
    const { tenant, me } = useOutletContext();
    const [params, setParams] = useSearchParams();
    const selected = params.get('a');
    const [list, setList] = useState(null);
    const [due, setDue] = useState(null);
    const [q, setQ] = useState('');

    const loadDue = useCallback(() => api('nursing/due', { tenant }).then((r) => setDue(r.data)).catch(() => setDue([])), [tenant]);
    useEffect(() => { api('admissions?status=admitted', { tenant }).then((r) => setList(r.data)); }, [tenant]);
    useEffect(() => { loadDue(); const i = setInterval(loadDue, 60000); return () => clearInterval(i); }, [loadDue]);

    const shown = (list ?? []).filter((a) => !q || `${a.patient?.name} ${a.patient?.mrn} ${a.bed?.number} ${a.bed?.ward?.name}`.toLowerCase().includes(q.toLowerCase()));
    const pick = (id) => setParams(id ? { a: String(id) } : {});

    return (
        <div>
            <PageHeader title="Ward round · eMAR" description="Medication charts, dose recording, nursing notes and fluid balance for admitted patients." />
            <div className="mt-6 grid gap-6 lg:grid-cols-[19rem_1fr]">
                <aside className="space-y-5">
                    <section className="rounded-2xl border border-rule bg-white p-4">
                        <h2 className="flex items-center justify-between font-display font-bold text-ink-deep">Medication round <span className="text-xs font-semibold text-pencil">±2 h</span></h2>
                        {!due ? <Skeleton className="mt-3 h-20 rounded-xl" /> : due.length === 0 ? <p className="mt-2 text-sm text-pencil">Nothing due right now.</p> : (
                            <ul className="mt-2 space-y-1.5">
                                {due.map((x) => (
                                    <li key={`${x.order_id}-${x.at}`}>
                                        <button type="button" onClick={() => pick(x.admission_id)} className={`w-full rounded-xl px-3 py-2 text-left text-sm ring-1 ${x.overdue ? 'bg-margin/5 ring-margin/25' : 'bg-paper ring-rule'} hover:ring-ink/30`}>
                                            <span className="flex justify-between"><b className="text-graphite">{x.patient?.name}</b><span className={`font-bold tabular-nums ${x.overdue ? 'text-margin' : 'text-ink'}`}>{x.at.slice(11)}</span></span>
                                            <span className="block text-pencil">{x.medicine} {x.dose} · {x.bed}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                    <section>
                        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find patient, bed or ward" aria-label="Find inpatient" className="h-10 w-full rounded-lg border border-rule bg-white px-3" />
                        <ul className="mt-2 max-h-[60vh] space-y-1 overflow-y-auto pr-1">
                            {!list ? <Skeleton className="h-40 rounded-xl" /> : shown.map((a) => (
                                <li key={a.id}>
                                    <button type="button" onClick={() => pick(a.id)} aria-current={String(a.id) === selected}
                                        className={`relative w-full rounded-xl px-3 py-2.5 text-left transition ${String(a.id) === selected ? 'text-white' : 'hover:bg-white'}`}>
                                        {String(a.id) === selected && <motion.span layoutId="nursing-pick" className="absolute inset-0 rounded-xl bg-ink-deep" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                                        <span className="relative block font-bold">{a.patient?.name}</span>
                                        <span className={`relative block text-sm ${String(a.id) === selected ? 'text-white/70' : 'text-pencil'}`}>{a.bed?.ward?.name} · {a.bed?.number}</span>
                                    </button>
                                </li>
                            ))}
                            {list && !shown.length && <li className="p-3 text-sm text-pencil">No admitted patients.</li>}
                        </ul>
                    </section>
                </aside>
                <main className="min-w-0">
                    {selected ? <Chart key={selected} tenant={tenant} me={me} id={selected} onChanged={loadDue} /> : <EmptyState icon="syringe" title="Choose a patient">Pick someone from the list or the medication round to open their chart.</EmptyState>}
                </main>
            </div>
        </div>
    );
}

function Chart({ tenant, me, id, onChanged }) {
    const toast = useToast();
    const canPrescribe = ['admin', 'doctor'].includes(me.user.role);
    const [day, setDay] = useState(today());
    const [d, setD] = useState(null);
    const [tab, setTab] = useState('mar');
    const [ordering, setOrdering] = useState(false);
    const [dose, setDose] = useState(null);

    const load = useCallback(() => api(`admissions/${id}/nursing?date=${day}`, { tenant }).then(setD).catch((e) => toast(e.message, 'error')), [tenant, id, day, toast]);
    useEffect(() => { load(); }, [load]);
    const refresh = () => { load(); onChanged(); };

    async function stop(o) {
        try { await api(`medication-orders/${o.id}/stop`, { method: 'POST', tenant }); toast('Order stopped'); refresh(); } catch (e) { toast(e.message, 'error'); }
    }

    if (!d) return <Skeleton className="h-96 rounded-2xl" />;
    const a = d.admission;

    return (
        <div>
            <div className="rounded-2xl bg-gradient-to-br from-ink-deep to-[#0f3d4a] p-5 text-white">
                <div className="flex flex-wrap items-start gap-4">
                    <div className="min-w-0 flex-1">
                        <Link to={`/${tenant}/patients/${a.patient?.id}`} className="font-display text-xl font-bold hover:underline">{a.patient?.name}</Link>
                        <p className="text-sm text-white/70">{patientLine(a.patient)} · {a.bed?.ward?.name} · bed {a.bed?.number} · since {dateTime(a.admitted_at)}</p>
                        {a.diagnosis && <p className="mt-1 text-sm">Dx: {a.diagnosis}</p>}
                        {a.doctor && <p className="text-sm text-white/70">Consultant: {a.doctor.name}</p>}
                    </div>
                    <div className="flex gap-3 text-center">
                        <div className="rounded-xl bg-white/10 px-3 py-2"><p className="text-xs text-white/60">Intake</p><p className="font-display text-lg font-bold tabular-nums">{d.fluids.intake} ml</p></div>
                        <div className="rounded-xl bg-white/10 px-3 py-2"><p className="text-xs text-white/60">Output</p><p className="font-display text-lg font-bold tabular-nums">{d.fluids.output} ml</p></div>
                        <div className="rounded-xl bg-white/10 px-3 py-2"><p className="text-xs text-white/60">Balance</p><p className="font-display text-lg font-bold tabular-nums">{d.fluids.intake - d.fluids.output > 0 ? '+' : ''}{d.fluids.intake - d.fluids.output}</p></div>
                    </div>
                </div>
                {d.allergies.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                        {d.allergies.map((x) => <span key={x.allergen} className="rounded-full bg-red-500/90 px-3 py-1 text-sm font-bold">⚠ {x.allergen} · {x.severity}</span>)}
                    </div>
                )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
                <Tabs value={tab} onChange={setTab} tabs={[{ value: 'mar', label: 'Medication chart' }, { value: 'notes', label: `Notes (${d.notes.length})` }, { value: 'fluids', label: 'Fluid balance' }]} />
                <input type="date" aria-label="Chart date" value={day} max={today(1)} onChange={(e) => e.target.value && setDay(e.target.value)} className="ml-auto h-10 rounded-lg border border-rule bg-white px-3" />
            </div>

            <div className="mt-4">
                {tab === 'mar' && (
                    <div>
                        {canPrescribe && <div className="mb-3 flex justify-end"><Button icon="plus" onClick={() => setOrdering(true)}>Prescribe</Button></div>}
                        {d.orders.length === 0 ? <EmptyState icon="pill" title="No medication orders">{canPrescribe ? 'Prescribe the first drug for this admission.' : 'The doctor has not prescribed anything yet.'}</EmptyState> : (
                            <ul className="space-y-3">
                                {d.orders.map((o) => (
                                    <li key={o.id} className={`rounded-2xl border bg-white p-4 ${o.status === 'active' ? 'border-rule' : 'border-dashed border-rule opacity-70'}`}>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <b className="text-graphite">{o.medicine_name}</b>
                                            <span className="text-sm text-graphite">{o.dose} · {ROUTES[o.route] ?? o.route} · <abbr title={FREQUENCIES[o.frequency]}>{o.frequency}</abbr></span>
                                            {o.status !== 'active' && <Badge>{o.status === 'stopped' ? 'Stopped' : 'Completed'}</Badge>}
                                            <span className="ml-auto text-xs text-pencil">{o.prescriber?.name}</span>
                                            {canPrescribe && o.status === 'active' && <Button size="sm" variant="ghost" onClick={() => stop(o)}>Stop</Button>}
                                        </div>
                                        {o.instructions && <p className="mt-1 text-sm text-pencil">{o.instructions}</p>}
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {o.doses.map((x) => {
                                                const r = x.record;
                                                const late = !r && new Date(x.at.replace(' ', 'T')) < new Date(Date.now() - 30 * 60000);
                                                return (
                                                    <button key={x.at} type="button" disabled={!!r || o.status !== 'active'} onClick={() => setDose({ order: o, at: x.at })}
                                                        title={r ? `${r.status} by ${r.user?.name ?? ''}${r.reason ? ` — ${r.reason}` : ''}` : 'Record this dose'}
                                                        className={`min-w-[5.5rem] rounded-xl px-3 py-2 text-left text-sm ring-1 transition ${r ? `${DOSE_TONE[r.status]} ring-transparent` : late ? 'bg-margin/5 text-margin ring-margin/30 hover:bg-margin/10' : 'bg-paper text-graphite ring-rule hover:ring-ink/40'}`}>
                                                        <span className="block font-bold tabular-nums">{x.at.slice(11)}</span>
                                                        <span className="block text-xs capitalize opacity-90">{r ? r.status : late ? 'Overdue' : 'Due'}</span>
                                                    </button>
                                                );
                                            })}
                                            {o.frequency === 'PRN' && o.status === 'active' && <Button size="sm" variant="secondary" onClick={() => setDose({ order: o, at: null })}>Give PRN dose</Button>}
                                            {!o.doses.length && o.frequency !== 'PRN' && <span className="text-sm text-pencil">No doses on this day.</span>}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
                {tab === 'notes' && <Notes tenant={tenant} admission={a} notes={d.notes} onDone={load} />}
                {tab === 'fluids' && <Fluids tenant={tenant} admission={a} fluids={d.fluids} onDone={load} />}
            </div>

            {ordering && <OrderDialog tenant={tenant} admission={a} onClose={() => setOrdering(false)} onDone={() => { setOrdering(false); toast('Prescribed'); refresh(); }} />}
            {dose && <DoseDialog tenant={tenant} {...dose} onClose={() => setDose(null)} onDone={() => { setDose(null); toast('Dose recorded'); refresh(); }} />}
        </div>
    );
}

function OrderDialog({ tenant, admission, onClose, onDone }) {
    const [meds, setMeds] = useState([]);
    const [f, setF] = useState({ medicine_id: '', medicine_name: '', dose: '', route: 'oral', frequency: 'BD', instructions: '', ends_at: '' });
    const [override, setOverride] = useState(false);
    const [alert, setAlert] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    useEffect(() => { api('pharmacy/medicines', { tenant }).then((r) => setMeds(r.data ?? [])).catch(() => {}); }, [tenant]);

    async function save() {
        setBusy(true); setError(null);
        const body = { ...f, medicine_id: f.medicine_id ? Number(f.medicine_id) : null, medicine_name: f.medicine_id ? null : f.medicine_name, instructions: f.instructions || null, ends_at: f.ends_at || null, override_allergy: override };
        try { await api(`admissions/${admission.id}/medication-orders`, { method: 'POST', tenant, body }); onDone(); } catch (e) {
            if (e.status === 409) setAlert(e.message); else setError(e);
        } finally { setBusy(false); }
    }

    return (
        <Modal open onClose={onClose} title="Prescribe" description={`${admission.patient?.name} · bed ${admission.bed?.number}`}
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={(!f.medicine_id && !f.medicine_name) || !f.dose || (alert && !override)} onClick={save}>{alert ? 'Prescribe anyway' : 'Prescribe'}</Button></>}>
            <div className="space-y-4">
                {alert && (
                    <div role="alert" className="rounded-xl bg-margin/5 p-3 ring-1 ring-margin/30">
                        <p className="font-bold text-margin">{alert}</p>
                        <div className="mt-2"><Checkbox label="I have reviewed the allergy and want to continue" checked={override} onChange={setOverride} /></div>
                    </div>
                )}
                <Field label="From pharmacy stock" name="medicine_id" as="select" value={f.medicine_id} onChange={(e) => { setAlert(null); setOverride(false); set('medicine_id')(e); }}>
                    <option value="">— Type a drug name instead —</option>
                    {meds.map((m) => <option key={m.id} value={m.id}>{m.name} {m.strength ?? ''} {m.stock != null ? `· ${m.stock} in stock` : ''}</option>)}
                </Field>
                {!f.medicine_id && <Field label="Drug name" name="medicine_name" error={error} value={f.medicine_name} onChange={(e) => { setAlert(null); setOverride(false); set('medicine_name')(e); }} placeholder="e.g. Ceftriaxone 1 g" />}
                <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Dose" name="dose" error={error} value={f.dose} onChange={set('dose')} placeholder="500 mg" />
                    <Field label="Route" name="route" as="select" value={f.route} onChange={set('route')}>{Object.entries(ROUTES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Field>
                    <Field label="Frequency" name="frequency" as="select" value={f.frequency} onChange={set('frequency')}>{Object.entries(FREQUENCIES).map(([k, l]) => <option key={k} value={k}>{k} · {l}</option>)}</Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Instructions" name="instructions" error={error} value={f.instructions} onChange={set('instructions')} placeholder="After food" />
                    <Field label="Stop on" name="ends_at" type="date" error={error} value={f.ends_at} onChange={set('ends_at')} hint="Leave empty to continue until stopped" />
                </div>
            </div>
        </Modal>
    );
}

function DoseDialog({ tenant, order, at, onClose, onDone }) {
    const [status, setStatus] = useState('given');
    const [doseGiven, setDoseGiven] = useState(order.dose);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function save() {
        setBusy(true); setError(null);
        try { await api(`medication-orders/${order.id}/administer`, { method: 'POST', tenant, body: { scheduled_for: at, status, dose_given: status === 'given' ? doseGiven : null, reason: reason || null } }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title={`${order.medicine_name} · ${order.dose}`} description={at ? `Scheduled ${at.slice(11)} · ${ROUTES[order.route] ?? order.route}` : 'As-needed dose'}
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Record</Button></>}>
            <div className="space-y-4">
                <div className="grid grid-cols-4 gap-2">
                    {['given', 'held', 'refused', 'missed'].map((s) => (
                        <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} className={`rounded-xl py-2.5 text-sm font-bold capitalize ring-1 ${status === s ? `${DOSE_TONE[s]} ring-transparent` : 'bg-white text-graphite ring-rule'}`}>{s}</button>
                    ))}
                </div>
                {status === 'given' ? <Field label="Dose given" name="dose_given" error={error} value={doseGiven} onChange={(e) => setDoseGiven(e.target.value)} />
                    : <Field label="Reason" name="reason" error={error} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Nil by mouth for theatre" />}
                {order.instructions && <p className="text-sm text-pencil">Instructions: {order.instructions}</p>}
            </div>
        </Modal>
    );
}

function Notes({ tenant, admission, notes, onDone }) {
    const toast = useToast();
    const hour = new Date().getHours();
    const [f, setF] = useState({ type: 'note', shift: hour < 14 ? 'morning' : hour < 21 ? 'evening' : 'night', body: '' });
    const [as, setAs] = useState({ falls_risk: '', pressure_risk: '', pain: '', mobility: '', news2: '' });
    const [busy, setBusy] = useState(false);
    async function save() {
        setBusy(true);
        const assessment = Object.fromEntries(Object.entries(as).filter(([, v]) => v !== '').map(([k, v]) => [k, ['pain', 'news2'].includes(k) ? Number(v) : v]));
        try {
            await api(`admissions/${admission.id}/nursing-notes`, { method: 'POST', tenant, body: { ...f, assessment: Object.keys(assessment).length ? assessment : null } });
            setF({ ...f, body: '' }); setAs({ falls_risk: '', pressure_risk: '', pain: '', mobility: '', news2: '' }); toast('Note saved'); onDone();
        } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
    }
    const sel = (k, opts) => (
        <select aria-label={k} value={as[k]} onChange={(e) => setAs({ ...as, [k]: e.target.value })} className="h-9 rounded-lg border border-rule bg-white px-2 text-sm">
            <option value="">{k.replace('_', ' ')}…</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
    );
    return (
        <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
            <ul className="space-y-3">
                {notes.length === 0 && <EmptyState icon="diary" title="No notes yet" />}
                {notes.map((n) => (
                    <li key={n.id} className="rounded-2xl border border-rule bg-white p-4">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                            <Badge tone={n.type === 'handover' ? 'published' : 'draft'}>{NOTE_TYPES[n.type] ?? n.type}</Badge>
                            {n.shift && <span className="capitalize text-pencil">{n.shift} shift</span>}
                            <span className="ml-auto text-pencil">{n.user?.name} · {dateTime(n.created_at)}</span>
                        </div>
                        <p className="mt-2 whitespace-pre-line text-graphite">{n.body}</p>
                        {n.assessment && (
                            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                                {Object.entries(n.assessment).map(([k, v]) => <span key={k} className="rounded-md bg-paper px-2 py-0.5 font-semibold ring-1 ring-rule">{k.replace('_', ' ')}: {v}</span>)}
                            </div>
                        )}
                    </li>
                ))}
            </ul>
            <div className="h-fit space-y-3 rounded-2xl border border-rule bg-white p-4 xl:sticky xl:top-20">
                <h3 className="font-display font-bold text-ink-deep">Add note</h3>
                <div className="grid grid-cols-2 gap-2">
                    <select aria-label="Note type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="h-10 rounded-lg border border-rule bg-white px-2">{Object.entries(NOTE_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                    <select aria-label="Shift" value={f.shift} onChange={(e) => setF({ ...f, shift: e.target.value })} className="h-10 rounded-lg border border-rule bg-white px-2"><option value="morning">Morning</option><option value="evening">Evening</option><option value="night">Night</option></select>
                </div>
                <textarea aria-label="Note" rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Observations, care given, concerns for the next shift…" className="w-full rounded-lg border border-rule px-3 py-2" />
                <div className="flex flex-wrap gap-2">
                    {sel('falls_risk', ['low', 'medium', 'high'])}
                    {sel('pressure_risk', ['low', 'medium', 'high'])}
                    {sel('mobility', ['independent', 'assisted', 'bedbound'])}
                    <input aria-label="Pain 0–10" type="number" min={0} max={10} value={as.pain} onChange={(e) => setAs({ ...as, pain: e.target.value })} placeholder="Pain" className="h-9 w-20 rounded-lg border border-rule px-2 text-sm" />
                    <input aria-label="NEWS2 score" type="number" min={0} max={20} value={as.news2} onChange={(e) => setAs({ ...as, news2: e.target.value })} placeholder="NEWS2" className="h-9 w-20 rounded-lg border border-rule px-2 text-sm" />
                </div>
                <Button className="w-full" busy={busy} disabled={!f.body.trim()} onClick={save}>Save note</Button>
            </div>
        </div>
    );
}

function Fluids({ tenant, admission, fluids, onDone }) {
    const toast = useToast();
    const [f, setF] = useState({ direction: 'intake', route: 'oral', volume_ml: '' });
    const [busy, setBusy] = useState(false);
    const byHour = useMemo(() => {
        const m = {};
        fluids.entries.forEach((e) => { const h = new Date(e.recorded_at).getHours(); m[h] ??= { in: 0, out: 0 }; m[h][e.direction === 'intake' ? 'in' : 'out'] += e.volume_ml; });
        return m;
    }, [fluids]);
    const max = Math.max(100, ...Object.values(byHour).flatMap((x) => [x.in, x.out]));

    async function save() {
        setBusy(true);
        try { await api(`admissions/${admission.id}/fluids`, { method: 'POST', tenant, body: { ...f, volume_ml: Number(f.volume_ml) } }); setF({ ...f, volume_ml: '' }); toast('Recorded'); onDone(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-rule bg-white p-4">
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-paper p-1 ring-1 ring-rule">
                    {['intake', 'output'].map((dir) => <button key={dir} type="button" aria-pressed={f.direction === dir} onClick={() => setF({ ...f, direction: dir, route: Object.keys(FLUID_ROUTES[dir])[0] })} className={`rounded-lg px-4 py-1.5 text-sm font-bold capitalize ${f.direction === dir ? 'bg-white text-ink-deep shadow-sm' : 'text-pencil'}`}>{dir}</button>)}
                </div>
                <select aria-label="Route" value={f.route} onChange={(e) => setF({ ...f, route: e.target.value })} className="h-10 rounded-lg border border-rule bg-white px-2">{Object.entries(FLUID_ROUTES[f.direction]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <input aria-label="Volume in ml" type="number" min={1} value={f.volume_ml} onChange={(e) => setF({ ...f, volume_ml: e.target.value })} placeholder="ml" className="h-10 w-28 rounded-lg border border-rule px-3" />
                <Button busy={busy} disabled={!f.volume_ml} onClick={save}>Add</Button>
            </div>
            <div className="rounded-2xl border border-rule bg-white p-4">
                <p className="mb-3 text-sm font-bold text-graphite">By hour <span className="font-normal text-pencil">· <span className="text-ink">■</span> intake <span className="text-amber-500">■</span> output</span></p>
                <div className="flex h-40 items-end gap-1">
                    {Array.from({ length: 24 }, (_, h) => (
                        <div key={h} className="flex flex-1 flex-col items-center justify-end gap-0.5" title={`${h}:00 · in ${byHour[h]?.in ?? 0} ml · out ${byHour[h]?.out ?? 0} ml`}>
                            <div className="flex w-full items-end justify-center gap-px" style={{ height: '100%' }}>
                                <motion.span initial={{ height: 0 }} animate={{ height: `${((byHour[h]?.in ?? 0) / max) * 100}%` }} className="w-1/2 rounded-t bg-ink" />
                                <motion.span initial={{ height: 0 }} animate={{ height: `${((byHour[h]?.out ?? 0) / max) * 100}%` }} className="w-1/2 rounded-t bg-amber-500" />
                            </div>
                            <span className="text-[10px] text-pencil">{h % 3 === 0 ? h : ''}</span>
                        </div>
                    ))}
                </div>
            </div>
            {fluids.entries.length > 0 && (
                <ul className="divide-y divide-rule rounded-2xl border border-rule bg-white">
                    {fluids.entries.map((e) => <li key={e.id} className="flex items-center gap-3 px-4 py-2 text-sm"><span className="tabular-nums text-pencil">{time(e.recorded_at)}</span><Badge tone={e.direction === 'intake' ? 'draft' : 'warning'}>{e.direction}</Badge><span className="capitalize">{e.route}</span><b className="ml-auto tabular-nums">{e.volume_ml} ml</b><span className="text-pencil">{e.user?.name}</span></li>)}
                </ul>
            )}
        </div>
    );
}
