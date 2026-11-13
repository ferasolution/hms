import { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../../lib/api';
import { money } from '../../lib/format';
import { ROLE_LABEL, SHIFTS, shortDate, today, WEEKDAYS } from '../../lib/hms';
import { Avatar, Badge, Button, EmptyState, Field, IconButton, Modal, PageHeader, Skeleton, Tabs, useToast } from '../../components/ui';

export default function Staff() {
    const { tenant, me } = useOutletContext();
    const isAdmin = me.user.role === 'admin';
    const mods = me.tenant.settings?.modules ?? {};
    const [tab, setTab] = useState('directory');
    return (
        <div>
            <PageHeader title="Staff" description="Doctors and staff, departments, clinic hours and the duty roster."
                actions={isAdmin && <Button as={Link} to={`/${tenant}/people?new=1&role=doctor`} icon="plus">Add staff</Button>} />
            <Tabs className="mt-6" value={tab} onChange={setTab} tabs={[
                { value: 'directory', label: 'Directory' },
                mods.roster !== false && { value: 'roster', label: 'Duty roster' },
                { value: 'departments', label: 'Departments' },
            ].filter(Boolean)} />
            <div className="mt-4">
                {tab === 'directory' && <Directory tenant={tenant} me={me} />}
                {tab === 'roster' && <Roster tenant={tenant} isAdmin={isAdmin} />}
                {tab === 'departments' && <Departments tenant={tenant} isAdmin={isAdmin} />}
            </div>
        </div>
    );
}

function Directory({ tenant, me }) {
    const toast = useToast();
    const [role, setRole] = useState('');
    const [rows, setRows] = useState(null);
    const [editing, setEditing] = useState(null);
    const load = useCallback(() => api(`staff${role ? `?role=${role}` : ''}`, { tenant }).then((r) => setRows(r.data)), [tenant, role]);
    useEffect(() => { load(); }, [load]);
    const currency = me.tenant.settings?.currency ?? 'USD';
    return (
        <div>
            <div className="flex flex-wrap gap-2">{[['', 'Everyone'], ['doctor', 'Doctors'], ['nurse', 'Nurses'], ['receptionist', 'Front desk'], ['pharmacist', 'Pharmacy'], ['lab_technician', 'Lab'], ['accountant', 'Accounts'], ['admin', 'Admins']].map(([v, l]) => <button key={v} type="button" aria-pressed={role === v} onClick={() => setRole(v)} className={`rounded-full px-3.5 py-1.5 text-sm font-bold ring-1 ${role === v ? 'bg-ink-deep text-white ring-ink-deep' : 'bg-white text-graphite ring-rule'}`}>{l}</button>)}</div>
            <div className="mt-4">
                {!rows ? <Skeleton className="h-48 rounded-2xl" /> : rows.length === 0 ? <EmptyState icon="users" title="No staff here yet">Add staff accounts on the People page.</EmptyState> : (
                    <ul className="grid gap-3 sm:grid-cols-2">
                        {rows.map((s) => {
                            const canEdit = me.user.role === 'admin' || me.user.id === s.id;
                            return (
                                <li key={s.id} className={`rounded-2xl border border-rule bg-white p-4 ${s.is_active ? '' : 'opacity-60'}`}>
                                    <div className="flex items-start gap-3">
                                        <Avatar name={s.name} size={40} />
                                        <div className="min-w-0 flex-1">
                                            <p className="font-bold text-graphite">{s.name}</p>
                                            <p className="text-sm text-pencil">{[ROLE_LABEL[s.role], s.specialization, s.department?.name].filter(Boolean).join(' · ')}</p>
                                            {s.role === 'doctor' && (
                                                <p className="mt-1 text-sm text-pencil">{Number(s.consultation_fee) > 0 ? `${money(s.consultation_fee, currency)} · ` : ''}{s.slot_minutes} min slots · {scheduleLine(s.schedule)}</p>
                                            )}
                                            <p className="mt-1 text-sm text-pencil">{[s.phone, s.email].filter(Boolean).join(' · ')}</p>
                                        </div>
                                        {canEdit && <IconButton icon="edit" label="Edit profile" onClick={() => setEditing(s)} />}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
            {editing && <ProfileForm tenant={tenant} staff={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); toast('Saved'); load(); }} />}
        </div>
    );
}

function scheduleLine(schedule) {
    if (!schedule) return 'Mon–Sat 9:00–17:00';
    const days = Object.keys(schedule).sort();
    if (!days.length) return 'No clinic hours';
    return days.map((d) => `${WEEKDAYS[d].slice(0, 3)} ${schedule[d][0]}–${schedule[d][1]}`).join(', ');
}

export function ProfileForm({ tenant, staff, onClose, onDone }) {
    const [departments, setDepartments] = useState([]);
    const [f, setF] = useState({
        department_id: staff.department?.id ?? '', specialization: staff.specialization ?? '', qualification: staff.qualification ?? '',
        license_no: staff.license_no ?? '', consultation_fee: staff.consultation_fee ?? 0, slot_minutes: staff.slot_minutes ?? 15, bio: staff.bio ?? '',
    });
    const [hours, setHours] = useState(() => {
        const s = staff.schedule ?? { 1: ['09:00', '17:00'], 2: ['09:00', '17:00'], 3: ['09:00', '17:00'], 4: ['09:00', '17:00'], 5: ['09:00', '17:00'], 6: ['09:00', '17:00'] };
        return Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, s[d] ? { on: true, from: s[d][0], to: s[d][1] } : { on: false, from: '09:00', to: '17:00' }]));
    });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => { api('departments', { tenant }).then((r) => setDepartments(r.data)); }, [tenant]);
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    const isDoctor = staff.role === 'doctor';

    async function save() {
        setBusy(true);
        setError(null);
        try {
            await api(`staff/${staff.id}/profile`, { method: 'PATCH', tenant, body: {
                ...f, department_id: f.department_id ? Number(f.department_id) : null, consultation_fee: Number(f.consultation_fee || 0), slot_minutes: Number(f.slot_minutes),
                ...(isDoctor ? { schedule: Object.fromEntries(Object.entries(hours).filter(([, h]) => h.on).map(([d, h]) => [d, [h.from, h.to]])) } : {}),
            } });
            onDone();
        } catch (e) { setError(e); } finally { setBusy(false); }
    }

    return (
        <Modal open onClose={onClose} title={staff.name} description={ROLE_LABEL[staff.role]} size="lg"
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
            <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Department" name="department_id" as="select" error={error} value={f.department_id} onChange={set('department_id')}>
                        <option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </Field>
                    <Field label={isDoctor ? 'Speciality' : 'Position'} name="specialization" error={error} value={f.specialization} onChange={set('specialization')} />
                    <Field label="Qualifications" name="qualification" error={error} value={f.qualification} onChange={set('qualification')} placeholder="MBBS, MD" />
                    <Field label="License / registration no." name="license_no" error={error} value={f.license_no} onChange={set('license_no')} />
                    {isDoctor && <Field label="Consultation fee" name="consultation_fee" type="number" min="0" step="0.01" error={error} value={f.consultation_fee} onChange={set('consultation_fee')} />}
                    {isDoctor && <Field label="Appointment length" name="slot_minutes" as="select" value={f.slot_minutes} onChange={set('slot_minutes')}>{[5, 10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}</Field>}
                </div>
                {isDoctor && (
                    <fieldset>
                        <legend className="mb-2 font-bold text-graphite">Clinic hours</legend>
                        <div className="space-y-2">
                            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                                <div key={d} className="flex flex-wrap items-center gap-3">
                                    <label className="flex w-32 items-center gap-2"><input type="checkbox" className="h-5 w-5 accent-ink" checked={hours[d].on} onChange={(e) => setHours({ ...hours, [d]: { ...hours[d], on: e.target.checked } })} />{WEEKDAYS[d]}</label>
                                    {hours[d].on ? <>
                                        <input type="time" aria-label={`${WEEKDAYS[d]} from`} value={hours[d].from} onChange={(e) => setHours({ ...hours, [d]: { ...hours[d], from: e.target.value } })} className="h-9 rounded-lg border border-rule px-2" />
                                        <span className="text-pencil">to</span>
                                        <input type="time" aria-label={`${WEEKDAYS[d]} to`} value={hours[d].to} onChange={(e) => setHours({ ...hours, [d]: { ...hours[d], to: e.target.value } })} className="h-9 rounded-lg border border-rule px-2" />
                                    </> : <span className="text-sm text-pencil">Off</span>}
                                </div>
                            ))}
                        </div>
                    </fieldset>
                )}
                <Field label="Short bio" name="bio" as="textarea" rows={2} error={error} value={f.bio} onChange={set('bio')} />
                {error && !Object.keys(error.errors ?? {}).length && <p className="text-margin">{error.message}</p>}
            </div>
        </Modal>
    );
}

function addDays(ymd, n) {
    const d = new Date(`${ymd}T12:00:00`);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
}

function Roster({ tenant, isAdmin }) {
    const toast = useToast();
    const [from, setFrom] = useState(today());
    const [d, setD] = useState(null);
    const [adding, setAdding] = useState(false);
    const load = useCallback(() => api(`roster?from=${from}`, { tenant }).then(setD), [tenant, from]);
    useEffect(() => { load(); }, [load]);
    async function remove(s) { try { await api(`roster/${s.id}`, { method: 'DELETE', tenant }); load(); } catch (e) { toast(e.message, 'error'); } }
    const days = d ? [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(d.from, i)) : [];
    return (
        <div>
            <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setFrom(addDays(d?.from ?? from, -7))}>Previous week</Button>
                <Button size="sm" variant="secondary" onClick={() => setFrom(addDays(d?.from ?? from, 7))}>Next week</Button>
                {d && <p className="font-bold">{shortDate(d.from)} – {shortDate(d.to)}</p>}
                {isAdmin && <Button size="sm" icon="plus" className="ml-auto" onClick={() => setAdding(true)}>Assign shifts</Button>}
            </div>
            <div className="mt-4">
                {!d ? <Skeleton className="h-48 rounded-2xl" /> : (
                    <div className="grid gap-3 md:grid-cols-7">
                        {days.map((day) => (
                            <section key={day} className={`rounded-2xl border bg-white p-3 ${day === today() ? 'border-ink' : 'border-rule'}`}>
                                <h3 className="text-sm font-bold">{shortDate(day)}</h3>
                                <ul className="mt-2 space-y-1.5">
                                    {d.data.filter((s) => s.date === day).map((s) => (
                                        <li key={s.id} className="flex items-start gap-1 rounded-lg bg-paper px-2 py-1 text-sm">
                                            <span className="min-w-0 flex-1"><b className="block truncate">{s.user?.name}</b><span className="text-pencil">{SHIFTS[s.shift]}{s.department ? ` · ${s.department.name}` : ''}</span></span>
                                            {isAdmin && <button type="button" aria-label="Remove shift" className="text-pencil hover:text-margin" onClick={() => remove(s)}>×</button>}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        ))}
                    </div>
                )}
            </div>
            {adding && <ShiftDialog tenant={tenant} from={d?.from ?? from} onClose={() => setAdding(false)} onDone={(n) => { setAdding(false); toast(`${n} shift${n === 1 ? '' : 's'} added`); load(); }} />}
        </div>
    );
}

function ShiftDialog({ tenant, from, onClose, onDone }) {
    const [staff, setStaff] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [who, setWho] = useState([]);
    const [dates, setDates] = useState([]);
    const [shift, setShift] = useState('morning');
    const [dept, setDept] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => { api('staff', { tenant }).then((r) => setStaff(r.data.filter((s) => s.is_active))); api('departments', { tenant }).then((r) => setDepartments(r.data)); }, [tenant]);
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(from, i));
    const toggle = (list, setList, v) => setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
    async function save() {
        setBusy(true);
        try { const r = await api('roster', { method: 'POST', tenant, body: { user_ids: who, dates, shift, department_id: dept ? Number(dept) : null } }); onDone(r.created); } catch (e) { setError(e.message); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title="Assign shifts" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!who.length || !dates.length} onClick={save}>Assign</Button></>}>
            <div className="space-y-4">
                <div><p className="mb-1.5 text-sm font-bold">Days</p><div className="flex flex-wrap gap-2">{days.map((d) => <button key={d} type="button" aria-pressed={dates.includes(d)} onClick={() => toggle(dates, setDates, d)} className={`rounded-lg px-3 py-1.5 text-sm font-bold ring-1 ${dates.includes(d) ? 'bg-ink text-white ring-ink' : 'bg-white ring-rule'}`}>{shortDate(d)}</button>)}</div></div>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Shift" name="shift" as="select" value={shift} onChange={(e) => setShift(e.target.value)}>{Object.entries(SHIFTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Field>
                    <Field label="Department" name="department_id" as="select" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Field>
                </div>
                <div><p className="mb-1.5 text-sm font-bold">Staff</p>
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-rule">
                        {staff.map((s) => <label key={s.id} className="flex items-center gap-2 border-b border-rule px-3 py-2 last:border-0"><input type="checkbox" className="h-5 w-5 accent-ink" checked={who.includes(s.id)} onChange={() => toggle(who, setWho, s.id)} /><b>{s.name}</b><span className="text-sm text-pencil">{ROLE_LABEL[s.role]}{s.department ? ` · ${s.department.name}` : ''}</span></label>)}
                    </div>
                </div>
                {error && <p className="text-margin">{error}</p>}
            </div>
        </Modal>
    );
}

function Departments({ tenant, isAdmin }) {
    const toast = useToast();
    const [rows, setRows] = useState(null);
    const [editing, setEditing] = useState(null);
    const load = useCallback(() => api('departments', { tenant }).then((r) => setRows(r.data)), [tenant]);
    useEffect(() => { load(); }, [load]);
    return (
        <div>
            {isAdmin && <div className="mb-4 flex justify-end"><Button icon="plus" onClick={() => setEditing({})}>Add department</Button></div>}
            {!rows ? <Skeleton className="h-40 rounded-2xl" /> : (
                <ul className="divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-white">
                    {rows.map((d) => (
                        <li key={d.id} className={`flex items-center gap-3 px-5 py-3 ${d.is_active ? '' : 'opacity-60'}`}>
                            <div className="min-w-0 flex-1"><b className="text-graphite">{d.name}</b>{d.code && <span className="ml-2 font-mono text-sm text-pencil">{d.code}</span>}{d.description && <span className="block text-sm text-pencil">{d.description}</span>}</div>
                            <Badge>{d.staff_count} staff</Badge>
                            {isAdmin && <IconButton icon="edit" label="Edit" onClick={() => setEditing(d)} />}
                        </li>
                    ))}
                </ul>
            )}
            {editing && <DepartmentForm tenant={tenant} dept={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); toast('Saved'); load(); }} />}
        </div>
    );
}

function DepartmentForm({ tenant, dept, onClose, onDone }) {
    const toast = useToast();
    const [f, setF] = useState({ name: dept.name ?? '', code: dept.code ?? '', description: dept.description ?? '', is_active: dept.is_active ?? true });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function save() {
        setBusy(true);
        try { await api(dept.id ? `departments/${dept.id}` : 'departments', { method: dept.id ? 'PATCH' : 'POST', tenant, body: { ...f, code: f.code || null, description: f.description || null } }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    async function remove() { try { await api(`departments/${dept.id}`, { method: 'DELETE', tenant }); onDone(); } catch (e) { toast(e.message, 'error'); } }
    return (
        <Modal open onClose={onClose} title={dept.id ? 'Edit department' : 'Add department'}
            footer={<>{dept.id && <Button variant="ghost" className="mr-auto text-margin" onClick={remove}>Delete</Button>}<Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
            <div className="space-y-4">
                <Field label="Name" name="name" error={error} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                <Field label="Code" name="code" error={error} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
                <Field label="Description" name="description" error={error} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
                {dept.id && <label className="flex items-center gap-2 font-bold"><input type="checkbox" className="h-5 w-5 accent-ink" checked={!!f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />Active</label>}
            </div>
        </Modal>
    );
}
