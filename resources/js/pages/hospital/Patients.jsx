import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { api, download } from '../../lib/api';
import { BLOOD_GROUPS, patientLine } from '../../lib/hms';
import { date } from '../../lib/format';
import Icon from '../../components/Icon';
import { Avatar, Badge, Button, EmptyState, Field, PageHeader, SlideOver, Skeleton, useToast } from '../../components/ui';

export default function Patients() {
    const { tenant, me, canRegister } = useOutletContext();
    const [params, setParams] = useSearchParams();
    const navigate = useNavigate();
    const toast = useToast();
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('');
    const [page, setPage] = useState(1);
    const [d, setD] = useState(null);
    const [adding, setAdding] = useState(!!params.get('new'));

    const load = useCallback(() => {
        const qs = new URLSearchParams({ page: String(page) });
        if (search.trim()) qs.set('search', search.trim());
        if (status) qs.set('status', status);
        return api(`patients?${qs}`, { tenant }).then(setD);
    }, [tenant, search, status, page]);
    useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

    return (
        <div>
            <PageHeader title="Patients" description="Register patients and open their chart."
                actions={<>
                    {me.user.role === 'admin' && <Button variant="secondary" icon="download" onClick={() => download('exports/patients.csv', tenant, 'patients.csv').catch((e) => toast(e.message, 'error'))}>Export</Button>}
                    {canRegister && <Button icon="plus" onClick={() => setAdding(true)}>Register patient</Button>}
                </>} />

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-2">
                    {[['', 'All'], ['admitted', 'Admitted'], ['inactive', 'Inactive']].map(([v, l]) => (
                        <button key={v} type="button" aria-pressed={status === v} onClick={() => { setStatus(v); setPage(1); }}
                            className={`rounded-full px-3.5 py-1.5 text-sm font-bold ring-1 ${status === v ? 'bg-ink-deep text-white ring-ink-deep' : 'bg-white text-graphite ring-rule'}`}>{l}</button>
                    ))}
                </div>
                <label className="relative block sm:w-80">
                    <span className="sr-only">Search patients</span>
                    <Icon name="search" size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-pencil" />
                    <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Name, MRN, phone or email"
                        className="h-11 w-full rounded-lg border border-rule bg-white pr-3 pl-10 focus:border-ink focus:ring-4 focus:ring-ink/10 focus:outline-none" />
                </label>
            </div>

            <div className="mt-6">
                {!d ? <Skeleton className="h-64 rounded-2xl" /> : d.data.length === 0 ? (
                    <EmptyState icon="users" title={search ? 'No patient matches that search' : 'No patients yet'}
                        action={canRegister && <Button icon="plus" onClick={() => setAdding(true)}>Register patient</Button>}>
                        {search ? 'Try the MRN or phone number.' : 'Register your first patient to start booking visits.'}
                    </EmptyState>
                ) : (
                    <div className="overflow-hidden rounded-2xl border border-rule bg-white">
                        <table className="w-full text-left">
                            <thead className="hidden border-b border-rule bg-paper text-sm text-pencil md:table-header-group">
                                <tr><th className="px-5 py-3">Patient</th><th className="px-5 py-3">MRN</th><th className="px-5 py-3">Phone</th><th className="px-5 py-3">Registered</th><th /></tr>
                            </thead>
                            <tbody className="divide-y divide-rule">
                                {d.data.map((p) => (
                                    <tr key={p.id} className="block cursor-pointer px-5 py-3 hover:bg-paper md:table-row md:px-0" onClick={() => navigate(`/${tenant}/patients/${p.id}`)}>
                                        <td className="md:px-5 md:py-3">
                                            <Link to={`/${tenant}/patients/${p.id}`} className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                                                <Avatar name={p.name} size={36} />
                                                <span><b className="text-graphite">{p.name}</b><span className="block text-sm text-pencil">{[p.age != null && `${p.age} y`, p.gender, p.blood_group].filter(Boolean).join(' · ')}</span></span>
                                            </Link>
                                        </td>
                                        <td className="hidden font-mono text-sm md:table-cell md:px-5">{p.mrn}</td>
                                        <td className="hidden text-pencil md:table-cell md:px-5">{p.phone ?? '—'}</td>
                                        <td className="hidden text-pencil md:table-cell md:px-5">{date(p.created_at)}</td>
                                        <td className="md:px-5 md:text-right">
                                            {p.admitted && <Badge tone="published" dot>Admitted</Badge>}
                                            {!p.is_active && <Badge>Inactive</Badge>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {d.meta.last_page > 1 && (
                            <div className="flex items-center justify-between border-t border-rule px-5 py-3">
                                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                                <span className="text-sm text-pencil">Page {d.meta.page} of {d.meta.last_page} · {d.meta.total} patients</span>
                                <Button size="sm" variant="secondary" disabled={page >= d.meta.last_page} onClick={() => setPage(page + 1)}>Next</Button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <PatientForm open={adding} tenant={tenant} onClose={() => { setAdding(false); if (params.get('new')) setParams({}, { replace: true }); }}
                onSaved={(p) => { setAdding(false); toast(`${p.name} registered · ${p.mrn}`); navigate(`/${tenant}/patients/${p.id}`); }} />
        </div>
    );
}

const EMPTY = {
    first_name: '', last_name: '', gender: '', date_of_birth: '', phone: '', email: '', address: '', blood_group: '',
    allergies: '', chronic_conditions: '', emergency_contact_name: '', emergency_contact_phone: '', insurance_provider: '', insurance_number: '', notes: '',
};

export function PatientForm({ open, tenant, patient, onClose, onSaved }) {
    const [f, setF] = useState(EMPTY);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (open) { setF(patient ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, patient[k] ?? ''])) : EMPTY); setError(null); }
    }, [open, patient]);
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

    async function save(e) {
        e?.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v]));
            const p = await api(patient ? `patients/${patient.id}` : 'patients', { method: patient ? 'PATCH' : 'POST', tenant, body });
            onSaved(p);
        } catch (err) { setError(err); } finally { setBusy(false); }
    }

    return (
        <SlideOver open={open} onClose={onClose} title={patient ? 'Edit patient' : 'Register a patient'} description={patient ? patient.mrn : 'A medical record number is given automatically.'}
            footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>{patient ? 'Save' : 'Register'}</Button></>}>
            <form onSubmit={save} className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="First name" name="first_name" error={error} value={f.first_name} onChange={set('first_name')} autoFocus />
                    <Field label="Last name" name="last_name" error={error} value={f.last_name} onChange={set('last_name')} />
                    <Field label="Date of birth" name="date_of_birth" type="date" error={error} value={f.date_of_birth} onChange={set('date_of_birth')} />
                    <Field label="Sex" name="gender" as="select" error={error} value={f.gender} onChange={set('gender')}>
                        <option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option>
                    </Field>
                    <Field label="Phone" name="phone" type="tel" error={error} value={f.phone} onChange={set('phone')} />
                    <Field label="Email" name="email" type="email" error={error} value={f.email} onChange={set('email')} />
                </div>
                <Field label="Address" name="address" error={error} value={f.address} onChange={set('address')} />
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Blood group" name="blood_group" as="select" error={error} value={f.blood_group} onChange={set('blood_group')}>
                        <option value="">Unknown</option>{BLOOD_GROUPS.map((b) => <option key={b}>{b}</option>)}
                    </Field>
                </div>
                <Field label="Allergies" name="allergies" as="textarea" rows={2} error={error} value={f.allergies} onChange={set('allergies')} placeholder="e.g. Penicillin, peanuts" />
                <Field label="Long-term conditions" name="chronic_conditions" as="textarea" rows={2} error={error} value={f.chronic_conditions} onChange={set('chronic_conditions')} placeholder="e.g. Type 2 diabetes, asthma" />
                <fieldset className="grid gap-4 sm:grid-cols-2">
                    <legend className="mb-2 font-bold text-graphite">Emergency contact</legend>
                    <Field label="Name" name="emergency_contact_name" error={error} value={f.emergency_contact_name} onChange={set('emergency_contact_name')} />
                    <Field label="Phone" name="emergency_contact_phone" error={error} value={f.emergency_contact_phone} onChange={set('emergency_contact_phone')} />
                </fieldset>
                <fieldset className="grid gap-4 sm:grid-cols-2">
                    <legend className="mb-2 font-bold text-graphite">Insurance</legend>
                    <Field label="Insurance company" name="insurance_provider" error={error} value={f.insurance_provider} onChange={set('insurance_provider')} />
                    <Field label="Member / policy no." name="insurance_number" error={error} value={f.insurance_number} onChange={set('insurance_number')} />
                </fieldset>
                <Field label="Notes" name="notes" as="textarea" rows={2} error={error} value={f.notes} onChange={set('notes')} />
                <button type="submit" className="hidden" />
            </form>
        </SlideOver>
    );
}

export { patientLine };
