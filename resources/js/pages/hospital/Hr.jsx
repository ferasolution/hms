import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../../lib/api';
import { date } from '../../lib/format';
import { LEAVE_TYPES, ROLE_LABEL, shortDate, time, today } from '../../lib/hms';
import StatTiles from '../../components/StatTiles';
import { Avatar, Badge, Button, EmptyState, Field, Modal, PageHeader, Skeleton, Tabs, useToast } from '../../components/ui';
import { download } from './Store';

const LEAVE_STATUS = { pending: ['Pending', 'warning'], approved: ['Approved', 'success'], rejected: ['Declined', 'danger'], cancelled: ['Cancelled', 'neutral'] };
const ATT = { present: ['Present', 'bg-leaf'], late: ['Late', 'bg-amber-500'], leave: ['On leave', 'bg-ink'], absent: ['Not in', 'bg-rule'], half_day: ['Half day', 'bg-amber-300'] };

export default function Hr() {
    const { tenant, me } = useOutletContext();
    const isHr = ['admin', 'hr_manager'].includes(me.user.role);
    const [tab, setTab] = useState('me');
    return (
        <div>
            <PageHeader title={isHr ? 'HR · leave & attendance' : 'My leave & attendance'} description={isHr ? 'Approve leave, see who is in today and export attendance.' : 'Clock in and out, request leave and see your balance.'} />
            <Tabs className="mt-6" value={tab} onChange={setTab} tabs={[{ value: 'me', label: 'Me' }, isHr && { value: 'leave', label: 'Leave requests' }, isHr && { value: 'board', label: 'Attendance' }].filter(Boolean)} />
            <div className="mt-5">
                {tab === 'me' && <Mine tenant={tenant} />}
                {tab === 'leave' && <LeaveQueue tenant={tenant} me={me} />}
                {tab === 'board' && <Board tenant={tenant} />}
            </div>
        </div>
    );
}

function Mine({ tenant }) {
    const toast = useToast();
    const [att, setAtt] = useState(null);
    const [leave, setLeave] = useState(null);
    const [asking, setAsking] = useState(false);
    const [busy, setBusy] = useState(false);
    const [now, setNow] = useState(new Date());
    const load = useCallback(() => {
        api('hr/attendance/me', { tenant }).then(setAtt);
        api('hr/leave?mine=1', { tenant }).then(setLeave);
    }, [tenant]);
    useEffect(() => { load(); const i = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(i); }, [load]);

    async function clock() {
        setBusy(true);
        try { const r = await api('hr/attendance/clock', { method: 'POST', tenant }); toast(r.check_out ? 'Clocked out — see you tomorrow' : r.status === 'late' ? 'Clocked in (late)' : 'Clocked in'); load(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
    }
    async function cancel(l) {
        try { await api(`hr/leave/${l.id}`, { method: 'PATCH', tenant, body: { status: 'cancelled' } }); toast('Request cancelled'); load(); } catch (e) { toast(e.message, 'error'); }
    }

    const t = att?.today;
    const state = !t?.check_in ? 'out' : !t?.check_out ? 'in' : 'done';
    const b = leave?.balance;

    return (
        <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
            <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-ink-deep via-[#123a63] to-[#0f4c4a] p-6 text-white">
                <motion.div aria-hidden className="absolute -right-16 -top-16 h-52 w-52 rounded-full bg-teal-300/20 blur-2xl" animate={{ scale: state === 'in' ? [1, 1.2, 1] : 1 }} transition={{ repeat: Infinity, duration: 3 }} />
                <p className="relative text-sm text-white/70">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
                <p className="relative mt-1 font-display text-5xl font-extrabold tabular-nums tracking-tight">{now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}<span className="text-2xl text-white/50">:{String(now.getSeconds()).padStart(2, '0')}</span></p>
                <div className="relative mt-4 space-y-1 text-sm">
                    <p>In: <b>{t?.check_in ? time(t.check_in) : '—'}</b>{t?.status === 'late' && <span className="ml-2 rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold text-amber-950">Late</span>}</p>
                    <p>Out: <b>{t?.check_out ? time(t.check_out) : '—'}</b></p>
                </div>
                <motion.button whileTap={{ scale: 0.96 }} type="button" disabled={busy || state === 'done' || !att} onClick={clock}
                    className={`relative mt-5 w-full rounded-2xl py-3.5 font-display text-lg font-bold transition ${state === 'out' ? 'bg-teal-300 text-ink-deep hover:bg-teal-200' : state === 'in' ? 'bg-white text-ink-deep hover:bg-white/90' : 'bg-white/10 text-white/60'}`}>
                    {state === 'out' ? 'Clock in' : state === 'in' ? 'Clock out' : 'Done for today'}
                </motion.button>
                {att?.month?.length > 0 && (
                    <div className="relative mt-5">
                        <p className="text-xs text-white/60">This month</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                            {att.month.map((d) => <span key={d.id} title={`${shortDate(d.date)} · ${d.status}`} className={`h-3 w-3 rounded-sm ${d.status === 'late' ? 'bg-amber-400' : 'bg-teal-300'}`} />)}
                        </div>
                    </div>
                )}
            </section>

            <section>
                <div className="grid grid-cols-3 gap-3">
                    {[['Annual entitlement', b?.annual_entitled], ['Used this year', b?.annual_used], ['Days left', b?.annual_left]].map(([l, v]) => (
                        <div key={l} className="rounded-2xl border border-rule bg-white p-4"><p className="text-sm text-pencil">{l}</p><p className="font-display text-2xl font-extrabold text-ink-deep">{v ?? '—'}</p></div>
                    ))}
                </div>
                <div className="mt-5 flex items-center justify-between"><h2 className="font-display text-lg font-bold text-ink-deep">My requests</h2><Button icon="plus" onClick={() => setAsking(true)}>Request leave</Button></div>
                <ul className="mt-3 space-y-2">
                    {!leave ? <Skeleton className="h-24 rounded-2xl" /> : leave.data.length === 0 ? <EmptyState icon="calendar" title="No leave requests yet" /> : leave.data.map((l) => (
                        <li key={l.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-rule bg-white p-4">
                            <div className="flex-1"><b className="text-graphite">{LEAVE_TYPES[l.type]} leave · {l.days} day{l.days === 1 ? '' : 's'}</b><span className="block text-sm text-pencil">{date(l.starts_on)} – {date(l.ends_on)}{l.reason ? ` · ${l.reason}` : ''}</span>{l.decision_note && <span className="block text-sm text-graphite">“{l.decision_note}” — {l.decider?.name}</span>}</div>
                            <Badge tone={LEAVE_STATUS[l.status][1]}>{LEAVE_STATUS[l.status][0]}</Badge>
                            {l.status === 'pending' && <Button size="sm" variant="ghost" onClick={() => cancel(l)}>Cancel</Button>}
                        </li>
                    ))}
                </ul>
            </section>
            {asking && <LeaveDialog tenant={tenant} left={b?.annual_left} onClose={() => setAsking(false)} onDone={() => { setAsking(false); toast('Request sent to HR'); load(); }} />}
        </div>
    );
}

function LeaveDialog({ tenant, left, onClose, onDone }) {
    const [f, setF] = useState({ type: 'annual', starts_on: today(1), ends_on: today(1), reason: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    const days = f.starts_on && f.ends_on ? Math.max(0, Math.round((new Date(f.ends_on) - new Date(f.starts_on)) / 86400000) + 1) : 0;
    async function save() {
        setBusy(true); setError(null);
        try { await api('hr/leave', { method: 'POST', tenant, body: { ...f, reason: f.reason || null } }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
    }
    return (
        <Modal open onClose={onClose} title="Request leave" description={f.type === 'annual' && left != null ? `${left} annual days left` : undefined}
            footer={<><span className="mr-auto text-sm font-bold text-graphite">{days} day{days === 1 ? '' : 's'}</span><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!days} onClick={save}>Send request</Button></>}>
            <div className="grid gap-3 sm:grid-cols-2">
                <Field className="sm:col-span-2" label="Type" name="type" as="select" value={f.type} onChange={set('type')}>{Object.entries(LEAVE_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Field>
                <Field label="From" name="starts_on" type="date" error={error} value={f.starts_on} onChange={set('starts_on')} />
                <Field label="To" name="ends_on" type="date" error={error} min={f.starts_on} value={f.ends_on} onChange={set('ends_on')} />
                <Field className="sm:col-span-2" label="Reason" name="reason" error={error} value={f.reason} onChange={set('reason')} />
                {error && !Object.keys(error.errors ?? {}).length && <p className="text-sm text-margin sm:col-span-2">{error.message}</p>}
            </div>
        </Modal>
    );
}

function LeaveQueue({ tenant, me }) {
    const toast = useToast();
    const [status, setStatus] = useState('pending');
    const [rows, setRows] = useState(null);
    const load = useCallback(() => api(`hr/leave${status ? `?status=${status}` : ''}`, { tenant }).then((r) => setRows(r.data)), [tenant, status]);
    useEffect(() => { load(); }, [load]);
    async function decide(l, s) {
        const note = s === 'rejected' ? window.prompt('Reason for declining (optional)') ?? '' : '';
        try { await api(`hr/leave/${l.id}`, { method: 'PATCH', tenant, body: { status: s, decision_note: note || null } }); toast(s === 'approved' ? 'Approved' : 'Declined'); load(); } catch (e) { toast(e.message, 'error'); }
    }
    return (
        <div>
            <div className="flex flex-wrap gap-2">
                {[['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Declined'], ['', 'All']].map(([v, l]) => <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatus(v)} className={`rounded-full px-3.5 py-1.5 text-sm font-bold ring-1 ${status === v ? 'bg-ink-deep text-white ring-ink-deep' : 'bg-white text-graphite ring-rule'}`}>{l}</button>)}
            </div>
            <ul className="mt-4 space-y-2">
                {!rows ? <Skeleton className="h-32 rounded-2xl" /> : rows.length === 0 ? <EmptyState icon="calendar" title="Nothing to review" /> : rows.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-rule bg-white p-4">
                        <Avatar name={l.user?.name} />
                        <div className="min-w-0 flex-1">
                            <b className="text-graphite">{l.user?.name}</b> <span className="text-sm text-pencil">{ROLE_LABEL[l.user?.role]}</span>
                            <span className="block text-sm text-graphite">{LEAVE_TYPES[l.type]} · {l.days} day{l.days === 1 ? '' : 's'} · {date(l.starts_on)} – {date(l.ends_on)}</span>
                            {l.reason && <span className="block text-sm text-pencil">{l.reason}</span>}
                        </div>
                        <Badge tone={LEAVE_STATUS[l.status][1]}>{LEAVE_STATUS[l.status][0]}</Badge>
                        {l.status === 'pending' && (l.user?.id === me.user.id
                            ? <span className="text-sm text-pencil">Another manager decides your own leave.</span>
                            : <><Button size="sm" onClick={() => decide(l, 'approved')}>Approve</Button><Button size="sm" variant="secondary" onClick={() => decide(l, 'rejected')}>Decline</Button></>)}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function Board({ tenant }) {
    const toast = useToast();
    const [day, setDay] = useState(today());
    const [d, setD] = useState(null);
    useEffect(() => { setD(null); api(`hr/attendance?date=${day}`, { tenant }).then(setD); }, [tenant, day]);
    const s = d?.summary ?? {};
    const month = day.slice(0, 7);
    return (
        <div>
            <div className="flex flex-wrap items-center gap-2">
                <input type="date" aria-label="Day" value={day} max={today()} onChange={(e) => e.target.value && setDay(e.target.value)} className="h-10 rounded-lg border border-rule bg-white px-3" />
                <Button className="ml-auto" variant="secondary" icon="download" onClick={() => download(`hr/exports/attendance.csv?month=${month}`, tenant, `attendance-${month}.csv`).catch((e) => toast(e.message, 'error'))}>Export {month}</Button>
            </div>
            <StatTiles className="mt-4" items={[
                { label: 'Present', value: d ? (s.present ?? 0) : null, tone: 'success' },
                { label: 'Late', value: d ? (s.late ?? 0) : null, tone: s.late ? 'warning' : 'ink' },
                { label: 'On leave', value: d ? (s.leave ?? 0) : null },
                { label: 'Not in', value: d ? (s.absent ?? 0) : null },
            ]} />
            <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {!d ? <Skeleton className="h-40 rounded-2xl sm:col-span-2" /> : d.data.map((r) => (
                    <li key={r.user.id} className="flex items-center gap-3 rounded-xl border border-rule bg-white p-3">
                        <Avatar name={r.user.name} size={34} />
                        <div className="min-w-0 flex-1"><b className="block truncate text-graphite">{r.user.name}</b><span className="text-xs text-pencil">{ROLE_LABEL[r.user.role]}{r.check_in ? ` · ${time(r.check_in)}${r.check_out ? `–${time(r.check_out)}` : ''}` : ''}{r.leave_type ? ` · ${LEAVE_TYPES[r.leave_type]}` : ''}</span></div>
                        <span className="flex items-center gap-1.5 text-xs font-bold text-graphite"><span className={`h-2.5 w-2.5 rounded-full ${ATT[r.status]?.[1] ?? 'bg-rule'}`} />{ATT[r.status]?.[0] ?? r.status}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
