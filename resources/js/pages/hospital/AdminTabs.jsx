import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Skeleton, Toggle, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { dateTime } from '../../lib/format';

export const MODULES = [
    ['appointments', 'Appointments', 'Booking, doctor schedules and the waiting-room queue.'],
    ['opd', 'Consultations (OPD)', 'Doctor and nursing notes, vitals, diagnosis and plans.'],
    ['emergency', 'Emergency & ambulance', 'Triage board, ER visits, dispositions and ambulance dispatch.'],
    ['ipd', 'Inpatients (IPD)', 'Wards, beds, admissions, transfers and discharge.'],
    ['nursing', 'Ward nursing · eMAR', 'Medication charts, dose recording, nursing notes and fluid balance.'],
    ['pharmacy', 'Pharmacy', 'Medicine stock and dispensing prescriptions.'],
    ['lab', 'Lab & imaging', 'Test orders, sample collection and results.'],
    ['billing', 'Billing', 'Patient bills, payments and receipts.'],
    ['insurance', 'Insurance claims', 'Send bills to insurers and record what they pay.'],
    ['inventory', 'Store & purchasing', 'Stock, suppliers and purchase orders with two-person approval.'],
    ['hr', 'HR', 'Leave requests and daily attendance.'],
    ['finance', 'Finance', 'Expenses, approvals and the profit & loss view.'],
    ['reports', 'Reports', 'Census, OPD, emergency, lab, pharmacy and revenue reports.'],
    ['roster', 'Duty roster', 'Weekly staff shifts.'],
    ['portal', 'Patient portal', 'Patients sign in to see results and book visits.'],
];

export function ModulesTab({ tenant, me, refresh }) {
    const toast = useToast();
    const [mods, setMods] = useState(me.tenant.settings?.modules ?? {});
    async function flip(key, on) {
        const prev = mods;
        setMods({ ...mods, [key]: on });
        try { await api('modules', { method: 'PUT', tenant, body: { modules: { [key]: on } } }); await refresh(); toast(on ? 'Turned on' : 'Turned off'); } catch (e) { toast(e.message, 'error'); setMods(prev); }
    }
    return (
        <section className="rounded-2xl border border-rule bg-white">
            <div className="border-b border-rule px-5 py-4"><h2 className="text-lg font-bold">Modules</h2><p className="text-pencil">Turn off what your hospital doesn’t use. It disappears for everyone, and its data is kept.</p></div>
            <ul className="divide-y divide-rule">
                {MODULES.map(([k, l, h]) => <li key={k} className="px-5 py-3"><Toggle label={l} hint={h} checked={mods[k] !== false} onChange={(v) => flip(k, v)} /></li>)}
            </ul>
        </section>
    );
}

export function ActivityTab({ tenant }) {
    const [d, setD] = useState(null);
    const [page, setPage] = useState(1);
    const load = useCallback(() => api(`audit?page=${page}`, { tenant }).then(setD), [tenant, page]);
    useEffect(() => { load(); }, [load]);
    return (
        <section className="rounded-2xl border border-rule bg-white">
            <div className="border-b border-rule px-5 py-4"><h2 className="text-lg font-bold">Activity log</h2><p className="text-pencil">Who did what, and when. Kept for your records.</p></div>
            {!d ? <div className="p-5"><Skeleton className="h-40" /></div> : d.data.length === 0 ? <p className="px-5 py-10 text-center text-pencil">Nothing logged yet.</p> : (
                <>
                    <ul className="divide-y divide-rule">
                        {d.data.map((a) => (
                            <li key={a.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                                <span className="w-40 shrink-0 text-sm text-pencil">{dateTime(a.created_at)}</span>
                                <span className="min-w-0 flex-1"><span className="text-graphite">{a.description}</span><span className="block text-xs text-pencil">{a.user?.name ?? 'System'}{a.ip ? ` · ${a.ip}` : ''}</span></span>
                                <Badge>{a.action}</Badge>
                            </li>
                        ))}
                    </ul>
                    {d.meta.last_page > 1 && (
                        <div className="flex items-center justify-between border-t border-rule px-5 py-3">
                            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button>
                            <span className="text-sm text-pencil">Page {d.meta.page} of {d.meta.last_page}</span>
                            <Button size="sm" variant="secondary" disabled={page >= d.meta.last_page} onClick={() => setPage(page + 1)}>Older</Button>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
