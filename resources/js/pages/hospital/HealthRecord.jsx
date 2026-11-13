import { useCallback, useEffect, useState } from 'react';
import { api, upload } from '../../lib/api';
import { date, dateTime } from '../../lib/format';
import { ROLE_LABEL, VITALS } from '../../lib/hms';
import Icon from '../../components/Icon';
import { Badge, Button, Field, IconButton, Modal, Skeleton, useToast } from '../../components/ui';

const SEVERITY = { mild: ['Mild', 'neutral'], moderate: ['Moderate', 'warning'], severe: ['Severe', 'danger'], life_threatening: ['Life-threatening', 'danger'] };
const PROBLEM_STATUS = { active: ['Active', 'warning'], chronic: ['Chronic', 'draft'], resolved: ['Resolved', 'neutral'] };
const DOC_CATEGORIES = { report: 'Report', scan: 'Scan / image', referral: 'Referral', consent: 'Consent form', discharge: 'Discharge summary', id: 'ID document', insurance: 'Insurance', other: 'Other' };

const FORMS = {
    problems: { title: 'Problem', fields: [['name', 'Condition', 'text', true], ['icd_code', 'ICD-10 code'], ['status', 'Status', { active: 'Active', chronic: 'Chronic', resolved: 'Resolved' }], ['onset_date', 'Since', 'date'], ['notes', 'Notes', 'textarea']] },
    allergies: { title: 'Allergy', fields: [['allergen', 'Allergic to', 'text', true], ['type', 'Type', { drug: 'Medicine', food: 'Food', environment: 'Environment', other: 'Other' }], ['severity', 'Severity', { mild: 'Mild', moderate: 'Moderate', severe: 'Severe', life_threatening: 'Life-threatening' }], ['reaction', 'Reaction'], ['status', 'Status', { active: 'Active', inactive: 'No longer allergic' }]] },
    medications: { title: 'Regular medicine', fields: [['name', 'Medicine', 'text', true], ['dose', 'Dose'], ['frequency', 'How often'], ['route', 'Route'], ['started_on', 'Started', 'date'], ['status', 'Status', { active: 'Taking', stopped: 'Stopped' }], ['notes', 'Notes', 'textarea']] },
    immunizations: { title: 'Vaccination', fields: [['vaccine', 'Vaccine', 'text', true], ['dose_no', 'Dose no.', 'number'], ['given_on', 'Given on', 'date', true], ['lot_no', 'Lot no.'], ['site', 'Site'], ['next_due_on', 'Next dose due', 'date'], ['notes', 'Notes', 'textarea']] },
};

/** The patient's longitudinal record (EHR). */
export default function HealthRecord({ tenant, patientId, onChange }) {
    const toast = useToast();
    const [d, setD] = useState(null);
    const [editing, setEditing] = useState(null);
    const [history, setHistory] = useState(false);
    const [doc, setDoc] = useState(false);
    const [audit, setAudit] = useState(false);
    const load = useCallback(() => api(`patients/${patientId}/ehr`, { tenant }).then(setD), [tenant, patientId]);
    useEffect(() => { load(); }, [load]);

    if (!d) return <Skeleton className="h-64 rounded-2xl" />;
    const can = d.can.clinical;
    const saved = () => { setEditing(null); toast('Saved'); load(); onChange?.(); };

    async function remove(type, row) {
        try { await api(`ehr/${type}/${row.id}`, { method: 'DELETE', tenant }); toast('Removed'); load(); onChange?.(); } catch (e) { toast(e.message, 'error'); }
    }

    const section = (type, title, rows, render, empty) => (
        <section className="rounded-2xl border border-rule bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-rule px-5 py-3">
                <h3 className="font-bold">{title}</h3>
                {can && <Button size="sm" variant="ghost" icon="plus" onClick={() => setEditing({ type, row: {} })}>Add</Button>}
            </div>
            {rows.length === 0 ? <p className="px-5 py-4 text-sm text-pencil">{empty}</p> : (
                <ul className="divide-y divide-rule">
                    {rows.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5">
                            <div className="min-w-0 flex-1">{render(r)}</div>
                            {can && <IconButton icon="edit" label="Edit" onClick={() => setEditing({ type, row: r })} />}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );

    const h = d.history;
    const social = h?.social ?? {};

    return (
        <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
                {section('problems', 'Problem list', d.problems, (p) => (
                    <><b className={p.status === 'resolved' ? 'text-pencil line-through' : 'text-graphite'}>{p.name}</b>{p.icd_code && <span className="ml-2 font-mono text-sm text-pencil">{p.icd_code}</span>}
                        <span className="ml-2"><Badge tone={PROBLEM_STATUS[p.status][1]}>{PROBLEM_STATUS[p.status][0]}</Badge></span>
                        <span className="block text-sm text-pencil">{[p.onset_date && `since ${date(p.onset_date)}`, p.resolved_date && `resolved ${date(p.resolved_date)}`, p.notes].filter(Boolean).join(' · ')}</span></>
                ), 'No problems recorded.')}
                {section('allergies', 'Allergies', d.allergies, (a) => (
                    <><b className={a.status === 'inactive' ? 'text-pencil line-through' : 'text-graphite'}>{a.allergen}</b> <span className="text-sm text-pencil">({a.type})</span>
                        <span className="ml-2"><Badge tone={SEVERITY[a.severity][1]}>{SEVERITY[a.severity][0]}</Badge></span>
                        {a.reaction && <span className="block text-sm text-pencil">{a.reaction}</span>}</>
                ), 'No known allergies recorded.')}
                {section('medications', 'Regular medicines', d.medications, (m) => (
                    <><b className={m.status === 'stopped' ? 'text-pencil line-through' : 'text-graphite'}>{m.name}</b> <span className="text-sm text-pencil">{[m.dose, m.frequency, m.route].filter(Boolean).join(' · ')}</span>
                        <span className="block text-sm text-pencil">{m.status === 'stopped' ? `Stopped ${m.stopped_on ? date(m.stopped_on) : ''}` : m.started_on ? `Since ${date(m.started_on)}` : 'Taking'}</span></>
                ), 'No regular medicines recorded.')}
                {section('immunizations', 'Vaccinations', d.immunizations, (v) => (
                    <><b className="text-graphite">{v.vaccine}</b>{v.dose_no && <span className="text-sm text-pencil"> · dose {v.dose_no}</span>}
                        <span className="block text-sm text-pencil">{date(v.given_on)}{v.giver ? ` · ${v.giver.name}` : ''}{v.next_due_on ? ` · next due ${date(v.next_due_on)}` : ''}</span></>
                ), 'No vaccinations recorded.')}
            </div>

            <section className="rounded-2xl border border-rule bg-white">
                <div className="flex items-center justify-between border-b border-rule px-5 py-3">
                    <h3 className="font-bold">History</h3>
                    {can && <Button size="sm" variant="ghost" icon="edit" onClick={() => setHistory(true)}>Edit</Button>}
                </div>
                {!h ? <p className="px-5 py-4 text-sm text-pencil">No history recorded yet.</p> : (
                    <dl className="grid gap-3 px-5 py-4 text-sm sm:grid-cols-[10rem_1fr]">
                        {[['Past medical', h.past_medical], ['Surgical', h.surgical], ['Family', h.family], ['Obstetric', h.obstetric],
                            ['Social', [social.smoking && `Smoking: ${social.smoking}`, social.alcohol && `Alcohol: ${social.alcohol}`, social.occupation, social.marital_status, social.exercise && `Exercise: ${social.exercise}`, social.diet && `Diet: ${social.diet}`, social.notes].filter(Boolean).join(' · ')]]
                            .filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="font-bold text-pencil">{k}</dt><dd className="whitespace-pre-line text-graphite">{v}</dd></div>)}
                        <p className="text-xs text-pencil sm:col-span-2">Updated {dateTime(h.updated_at)}{h.editor ? ` by ${h.editor.name}` : ''}</p>
                    </dl>
                )}
            </section>

            {d.vitals.length > 1 && <VitalsTrend rows={d.vitals} />}

            <section className="rounded-2xl border border-rule bg-white">
                <div className="flex items-center justify-between border-b border-rule px-5 py-3">
                    <h3 className="font-bold">Documents & scans</h3>
                    {d.can.documents && <Button size="sm" variant="ghost" icon="upload" onClick={() => setDoc(true)}>Upload</Button>}
                </div>
                {d.documents.length === 0 ? <p className="px-5 py-4 text-sm text-pencil">No documents yet.</p> : (
                    <ul className="divide-y divide-rule">
                        {d.documents.map((x) => (
                            <li key={x.id} className="flex items-center gap-3 px-5 py-2.5">
                                <Icon name="file" size={18} className="text-pencil" />
                                <a href={x.file_url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 font-bold text-ink hover:underline">{x.title}<span className="block text-sm font-normal text-pencil">{DOC_CATEGORIES[x.category]} · {date(x.document_date ?? x.created_at)}{x.uploader ? ` · ${x.uploader.name}` : ''}</span></a>
                                {can && <IconButton icon="trash" label="Remove document" onClick={() => remove('documents', x)} />}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {d.can.audit && <button type="button" className="text-sm font-bold text-ink hover:underline" onClick={() => setAudit(true)}>Who opened this chart?</button>}

            {editing && <EntryForm tenant={tenant} patientId={patientId} type={editing.type} row={editing.row} onClose={() => setEditing(null)} onDone={saved} onRemove={editing.row.id ? () => { setEditing(null); remove(editing.type, editing.row); } : null} />}
            {history && <HistoryForm tenant={tenant} patientId={patientId} history={h} onClose={() => setHistory(false)} onDone={() => { setHistory(false); toast('History saved'); load(); }} />}
            {doc && <DocumentForm tenant={tenant} patientId={patientId} onClose={() => setDoc(false)} onDone={() => { setDoc(false); toast('Uploaded'); load(); }} />}
            {audit && <AccessLog tenant={tenant} patientId={patientId} onClose={() => setAudit(false)} />}
        </div>
    );
}

function VitalsTrend({ rows }) {
    const [key, setKey] = useState(() => VITALS.find(([k]) => rows.some((r) => r[k] != null && r[k] !== '' && k !== 'bp'))?.[0] ?? 'pulse');
    const numeric = (r) => (key === 'bp' ? Number(String(r.bp ?? '').split('/')[0]) : Number(r[key]));
    const points = rows.filter((r) => r[key] != null && r[key] !== '' && !Number.isNaN(numeric(r)));
    const vals = points.map(numeric);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const W = 600; const H = 140;
    const x = (i) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * (W - 40) + 20);
    const y = (v) => (max === min ? H / 2 : H - 20 - ((v - min) / (max - min)) * (H - 40));
    const [label, , unit] = VITALS.find(([k]) => k === key);
    return (
        <section className="rounded-2xl border border-rule bg-white p-5">
            <div className="flex flex-wrap items-center gap-2">
                <h3 className="flex-1 font-bold">Vitals trend</h3>
                {VITALS.filter(([k]) => rows.some((r) => r[k] != null && r[k] !== '')).map(([k, l]) => (
                    <button key={k} type="button" aria-pressed={key === k} onClick={() => setKey(k)} className={`rounded-full px-3 py-1 text-sm font-bold ring-1 ${key === k ? 'bg-ink text-white ring-ink' : 'bg-white ring-rule'}`}>{l}</button>
                ))}
            </div>
            {points.length === 0 ? <p className="mt-3 text-sm text-pencil">No readings.</p> : (
                <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-36 w-full" role="img" aria-label={`${label} readings: ${points.map((p) => (key === 'bp' ? p.bp : p[key])).join(', ')} ${unit}`}>
                    <polyline fill="none" stroke="var(--color-ink)" strokeWidth="2.5" points={points.map((p, i) => `${x(i)},${y(numeric(p))}`).join(' ')} />
                    {points.map((p, i) => (
                        <g key={i}>
                            <circle cx={x(i)} cy={y(numeric(p))} r="4" fill="var(--color-ink)"><title>{`${date(p.at)}: ${key === 'bp' ? p.bp : p[key]} ${unit}`}</title></circle>
                            {(i === 0 || i === points.length - 1) && <text x={x(i)} y={y(numeric(p)) - 9} textAnchor="middle" fontSize="12" fill="currentColor">{key === 'bp' ? p.bp : p[key]}</text>}
                        </g>
                    ))}
                </svg>
            )}
        </section>
    );
}

function EntryForm({ tenant, patientId, type, row, onClose, onDone, onRemove }) {
    const spec = FORMS[type];
    const [f, setF] = useState(() => Object.fromEntries(spec.fields.map(([k]) => [k, row[k] != null ? String(row[k]).slice(0, k.endsWith('_on') || k.endsWith('_date') ? 10 : undefined) : ''])));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function save() {
        setBusy(true);
        setError(null);
        const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '').map(([k, v]) => [k, k === 'dose_no' ? Number(v) : v]));
        try {
            await api(row.id ? `ehr/${type}/${row.id}` : `patients/${patientId}/ehr/${type}`, { method: row.id ? 'PATCH' : 'POST', tenant, body });
            onDone();
        } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title={`${row.id ? 'Edit' : 'Add'} ${spec.title.toLowerCase()}`}
            footer={<>{onRemove && <Button variant="ghost" className="mr-auto text-margin" onClick={onRemove}>Delete</Button>}<Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
            <div className="grid gap-4 sm:grid-cols-2">
                {spec.fields.map(([k, label, kind]) => typeof kind === 'object' ? (
                    <Field key={k} label={label} name={k} as="select" error={error} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
                        <option value="">—</option>{Object.entries(kind).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Field>
                ) : (
                    <Field key={k} label={label} name={k} error={error} as={kind === 'textarea' ? 'textarea' : 'input'} rows={kind === 'textarea' ? 2 : undefined} type={kind === 'date' || kind === 'number' ? kind : 'text'}
                        className={kind === 'textarea' || k === 'name' || k === 'allergen' || k === 'vaccine' ? 'sm:col-span-2' : ''} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
                ))}
            </div>
        </Modal>
    );
}

function HistoryForm({ tenant, patientId, history, onClose, onDone }) {
    const s = history?.social ?? {};
    const [f, setF] = useState({ past_medical: history?.past_medical ?? '', surgical: history?.surgical ?? '', family: history?.family ?? '', obstetric: history?.obstetric ?? '' });
    const [social, setSocial] = useState({ smoking: s.smoking ?? '', alcohol: s.alcohol ?? '', occupation: s.occupation ?? '', marital_status: s.marital_status ?? '', exercise: s.exercise ?? '', diet: s.diet ?? '', notes: s.notes ?? '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function save() {
        setBusy(true);
        const clean = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v]));
        try { await api(`patients/${patientId}/history`, { method: 'PUT', tenant, body: { ...clean(f), social: clean(social) } }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    const t = (k, label) => <Field label={label} name={k} as="textarea" rows={2} error={error} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />;
    return (
        <Modal open onClose={onClose} title="Medical history" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
            <div className="space-y-4">
                {t('past_medical', 'Past medical history')}
                {t('surgical', 'Surgical history')}
                {t('family', 'Family history')}
                {t('obstetric', 'Obstetric / gynaecological history')}
                <fieldset className="grid gap-4 sm:grid-cols-2">
                    <legend className="mb-2 font-bold">Social history</legend>
                    <Field label="Smoking" name="social.smoking" as="select" value={social.smoking} onChange={(e) => setSocial({ ...social, smoking: e.target.value })}><option value="">—</option><option value="never">Never</option><option value="former">Former</option><option value="current">Current</option></Field>
                    <Field label="Alcohol" name="social.alcohol" as="select" value={social.alcohol} onChange={(e) => setSocial({ ...social, alcohol: e.target.value })}><option value="">—</option><option value="none">None</option><option value="occasional">Occasional</option><option value="regular">Regular</option></Field>
                    {[['occupation', 'Occupation'], ['marital_status', 'Marital status'], ['exercise', 'Exercise'], ['diet', 'Diet']].map(([k, l]) => <Field key={k} label={l} name={`social.${k}`} error={error} value={social[k]} onChange={(e) => setSocial({ ...social, [k]: e.target.value })} />)}
                    <Field label="Notes" name="social.notes" as="textarea" rows={2} className="sm:col-span-2" value={social.notes} onChange={(e) => setSocial({ ...social, notes: e.target.value })} />
                </fieldset>
            </div>
        </Modal>
    );
}

function DocumentForm({ tenant, patientId, onClose, onDone }) {
    const toast = useToast();
    const [f, setF] = useState({ title: '', category: 'report', document_date: '', notes: '', file_url: '' });
    const [uploading, setUploading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function pick(file) {
        if (!file) return;
        setUploading(true);
        try {
            const r = await upload(file, file.type === 'application/pdf' ? 'pdf' : 'image', tenant);
            setF((x) => ({ ...x, file_url: r.url, title: x.title || file.name.replace(/\.[^.]+$/, '') }));
        } catch (e) { toast(e.message, 'error'); } finally { setUploading(false); }
    }
    async function save() {
        setBusy(true);
        try { await api(`patients/${patientId}/ehr/documents`, { method: 'POST', tenant, body: Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')) }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title="Upload a document" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!f.file_url} onClick={save}>Save</Button></>}>
            <div className="space-y-4">
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-rule px-4 py-8 font-bold text-ink hover:border-ink/40">
                    <Icon name="upload" size={20} />{uploading ? 'Uploading…' : f.file_url ? 'File attached — choose another' : 'Choose a PDF or image'}
                    <input type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
                </label>
                <Field label="Title" name="title" error={error} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Type" name="category" as="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{Object.entries(DOC_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Field>
                    <Field label="Date of document" name="document_date" type="date" value={f.document_date} onChange={(e) => setF({ ...f, document_date: e.target.value })} />
                </div>
            </div>
        </Modal>
    );
}

function AccessLog({ tenant, patientId, onClose }) {
    const [rows, setRows] = useState(null);
    useEffect(() => { api(`patients/${patientId}/access-log`, { tenant }).then((r) => setRows(r.data)); }, [tenant, patientId]);
    return (
        <Modal open onClose={onClose} title="Chart access log" description="Every time someone opened this patient’s chart (once per 15 minutes per person)." size="lg" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
            {!rows ? <Skeleton className="h-32" /> : (
                <ul className="divide-y divide-rule text-sm">
                    {rows.map((r) => <li key={r.id} className="flex gap-3 py-2"><span className="w-40 text-pencil">{dateTime(r.created_at)}</span><span className="flex-1"><b>{r.user?.name ?? 'Unknown'}</b> <span className="text-pencil">{ROLE_LABEL[r.user?.role] ?? ''}</span></span><span className="text-pencil">{r.ip}</span></li>)}
                </ul>
            )}
        </Modal>
    );
}
