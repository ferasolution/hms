import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { motion } from 'motion/react';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { ROLE_LABEL, time } from '../lib/hms';
import Icon from '../components/Icon';
import { Avatar, Skeleton, useToast } from '../components/ui';
import Announcements from '../components/Announcements';
import { AppointmentBadge } from './hospital/Appointments';
import MyHealth from './hospital/MyHealth';

const TILE_TINTS = ['from-teal-400 to-cyan-600', 'from-violet-400 to-indigo-600', 'from-amber-400 to-orange-600', 'from-emerald-400 to-teal-600'];

function greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
}

export default function Overview() {
    const { me, tenant, isAdmin, role, on } = useOutletContext();
    const toast = useToast();
    const [s, setS] = useState(null);

    useEffect(() => {
        if (role === 'patient') return;
        api('dashboard', { tenant }).then(setS).catch(() => setS({}));
    }, [tenant, role]);

    if (role === 'patient') return <MyHealth />;

    const firstName = me.user.name.replace(/^Dr\.?\s+/i, '').split(' ')[0];
    const cur = s?.currency ?? 'USD';
    const signInLink = `${window.location.origin}/${tenant}/login`;

    const steps = isAdmin && s ? [
        { done: true, label: 'Create your hospital' },
        { done: (s.staff?.doctor ?? 0) > 0, label: 'Add your doctors', to: `/${tenant}/people?new=1&role=doctor` },
        { done: (s.patients?.total ?? 0) > 0, label: 'Register a patient', to: `/${tenant}/patients?new=1` },
        { done: (s.beds?.total ?? 0) > 0, label: 'Set up wards and beds', to: `/${tenant}/inpatients` },
        { done: !!me.tenant.settings?.logo_url, label: 'Upload your logo', to: `/${tenant}/settings?tab=branding` },
        { done: !!me.tenant.settings?.address, label: 'Add address for bills', to: `/${tenant}/settings` },
    ] : [];
    const remaining = steps.filter((x) => !x.done).length;

    const tiles = [
        on('appointments') && { icon: 'calendar', label: role === 'doctor' ? 'My patients today' : 'Appointments today', value: s?.appointments_today?.total, sub: s ? `${s.appointments_today?.waiting ?? 0} waiting · ${s.appointments_today?.completed ?? 0} seen` : null, to: `/${tenant}/appointments` },
        on('ipd') && { icon: 'bed', label: role === 'doctor' ? 'My inpatients' : 'Beds occupied', value: s ? (role === 'doctor' ? s.inpatients : `${s.beds?.occupied ?? 0}/${s.beds?.total ?? 0}`) : undefined, sub: s ? `${s.beds?.available ?? 0} free` : null, to: `/${tenant}/inpatients` },
        on('lab') && ['admin', 'doctor', 'lab_technician'].includes(role) && { icon: 'flask', label: 'Lab pending', value: s?.lab?.pending, sub: s?.lab?.urgent ? `${s.lab.urgent} urgent` : 'None urgent', to: `/${tenant}/lab` },
        on('pharmacy') && ['admin', 'pharmacist'].includes(role) && { icon: 'pill', label: 'To dispense', value: s?.pharmacy?.pending, sub: s ? `${s.pharmacy?.low_stock ?? 0} low on stock` : null, to: `/${tenant}/pharmacy` },
        s?.finance && on('billing') && { icon: 'wallet', label: 'Collected today', value: money(s.finance.collected_today, cur), sub: `${money(s.finance.collected_month, cur)} this month`, to: `/${tenant}/billing` },
        s?.finance && on('billing') && role !== 'receptionist' && { icon: 'receipt', label: 'Outstanding', value: money(s.finance.outstanding, cur), sub: 'Unpaid bills', to: `/${tenant}/billing` },
        !['pharmacist', 'lab_technician', 'accountant'].includes(role) && { icon: 'users', label: 'Patients', value: s?.patients?.total, sub: s ? `${s.patients?.new_today ?? 0} new today` : null, to: `/${tenant}/patients` },
    ].filter(Boolean).slice(0, 4);

    const max = Math.max(1, ...(s?.visits_series ?? []).map((v) => v.count));

    return (
        <div>
            <motion.header initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
                className="relative overflow-hidden rounded-[1.75rem] bg-[#06232c] px-6 py-8 text-white shadow-[0_30px_60px_-30px_rgba(6,35,44,.7)] sm:px-10 sm:py-10">
                <div className="pointer-events-none absolute -top-24 -right-10 h-72 w-72 rounded-full bg-[color-mix(in_srgb,var(--color-ink)_70%,transparent)] blur-[80px] animate-[aurora_14s_ease-in-out_infinite]" aria-hidden />
                <div className="pointer-events-none absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-[#22d3ee]/20 blur-[80px] animate-[aurora_18s_ease-in-out_infinite_reverse]" aria-hidden />
                <svg viewBox="0 0 600 80" preserveAspectRatio="none" className="pointer-events-none absolute right-0 bottom-2 h-16 w-1/2 opacity-20" aria-hidden>
                    <motion.path d="M0 50 H220 L235 50 L245 20 L258 72 L270 8 L284 60 L294 50 H420 L430 50 L438 38 L448 58 L456 50 H600" fill="none" stroke="#5eead4" strokeWidth="2"
                        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2.4, ease: 'easeInOut', repeat: Infinity, repeatDelay: 1.5 }} />
                </svg>
                <div className="relative flex flex-wrap items-end justify-between gap-6">
                    <div>
                        <p className="text-sm font-semibold text-white/60">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · {ROLE_LABEL[role]}</p>
                        <h1 className="mt-2 text-3xl font-extrabold text-white sm:text-[2.6rem]">{greeting()}, <span className="text-gradient">{firstName}</span></h1>
                        <p className="mt-2 max-w-lg text-white/65">{s?.appointments_today ? `${s.appointments_today.waiting ?? 0} waiting now · ${s.appointments_today.total ?? 0} appointments today${s.beds?.total ? ` · ${s.beds.available} beds free` : ''}` : 'Here’s your hospital at a glance.'}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {['admin', 'receptionist', 'nurse', 'doctor'].includes(role) && <Link to={`/${tenant}/patients?new=1`} className="inline-flex h-11 items-center gap-2 rounded-xl bg-white/10 px-4 font-semibold text-white ring-1 ring-white/15 backdrop-blur transition hover:bg-white/15"><Icon name="plus" size={18} />Register patient</Link>}
                        {on('appointments') && ['admin', 'receptionist', 'nurse', 'doctor'].includes(role) && <Link to={`/${tenant}/appointments?book=1`} className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-[#14b8a6] to-[#06b6d4] px-4 font-bold text-white shadow-[0_10px_30px_-10px_rgba(20,184,166,.9)] transition hover:brightness-110"><Icon name="calendar" size={18} />Book appointment</Link>}
                    </div>
                </div>
            </motion.header>

            {isAdmin && s && remaining > 0 && (
                <section className="margin-line mt-8 overflow-hidden rounded-2xl border border-rule bg-white" aria-labelledby="gs">
                    <div className="ruled-faint px-6 py-6 pl-8 sm:px-8 sm:pl-10">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <h2 id="gs" className="text-xl font-bold">Get your hospital ready</h2>
                            <p className="text-sm text-pencil">{steps.length - remaining} of {steps.length} done</p>
                        </div>
                        <ol className="mt-4 grid gap-2 sm:grid-cols-2">
                            {steps.map((x, i) => (
                                <li key={x.label}>
                                    {x.done || !x.to ? (
                                        <span className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-pencil">
                                            <span className="grid h-7 w-7 place-items-center rounded-full bg-leaf text-white"><Icon name="check" size={16} strokeWidth={2.5} /></span>
                                            <span className="line-through decoration-pencil/40">{x.label}</span>
                                        </span>
                                    ) : (
                                        <Link to={x.to} className="group flex items-center gap-3 rounded-lg bg-white px-3 py-2.5 ring-1 ring-rule transition hover:ring-ink/40">
                                            <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-ink/25 font-bold text-ink">{i + 1}</span>
                                            <span className="flex-1 font-bold text-graphite">{x.label}</span>
                                            <Icon name="arrowRight" size={18} className="text-pencil transition group-hover:translate-x-0.5 group-hover:text-ink" />
                                        </Link>
                                    )}
                                </li>
                            ))}
                        </ol>
                        <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
                            <span className="text-pencil">Staff and patients sign in at</span>
                            <code className="rounded bg-ink-50 px-2 py-1">{signInLink}</code>
                            <button type="button" className="font-bold text-ink" onClick={() => navigator.clipboard?.writeText(signInLink).then(() => toast('Link copied'))}>Copy</button>
                        </div>
                    </div>
                </section>
            )}

            <section className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-label="Summary">
                {tiles.map((t, i) => (
                    <motion.div key={t.label} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.07, duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}>
                        <Link to={t.to} className="group relative block h-full overflow-hidden rounded-2xl border border-rule bg-white p-4 sm:p-5">
                            <span className={`absolute -top-8 -right-8 h-24 w-24 rounded-full bg-gradient-to-br ${TILE_TINTS[i % TILE_TINTS.length]} opacity-15 transition duration-500 group-hover:scale-150 group-hover:opacity-25`} aria-hidden />
                            <span className={`relative grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br ${TILE_TINTS[i % TILE_TINTS.length]} text-white shadow-md`}><Icon name={t.icon} size={19} /></span>
                            <p className="relative mt-3 text-sm font-semibold text-pencil">{t.label}</p>
                            {t.value === undefined ? <Skeleton className="mt-2 h-9 w-16" /> : <p className="relative mt-1 font-display text-3xl font-extrabold tabular-nums text-ink-deep sm:text-[2.1rem]">{t.value}</p>}
                            {t.sub && <p className="relative mt-1 hidden text-sm text-pencil sm:block">{t.sub}</p>}
                        </Link>
                    </motion.div>
                ))}
            </section>

            <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <div className="min-w-0 space-y-6">
                    {on('appointments') && !['pharmacist', 'lab_technician', 'accountant'].includes(role) && (
                        <section className="rounded-2xl border border-rule bg-white">
                            <div className="flex items-center justify-between border-b border-rule px-5 py-3.5">
                                <h2 className="text-lg font-bold">{role === 'doctor' ? 'Your queue' : 'Waiting room'}</h2>
                                <Link to={`/${tenant}/appointments`} className="text-sm font-bold text-ink hover:underline">All appointments</Link>
                            </div>
                            {!s ? <div className="space-y-3 p-5">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div> : !s.queue?.length ? (
                                <p className="px-5 py-10 text-center text-pencil">No one waiting right now.</p>
                            ) : (
                                <ul className="divide-y divide-rule">
                                    {s.queue.map((a) => (
                                        <li key={a.id}>
                                            <Link to={`/${tenant}/patients/${a.patient?.id}${role === 'doctor' ? `?note=${a.id}` : ''}`} className="flex items-center gap-3 px-5 py-3 hover:bg-paper">
                                                <span className="w-16 font-bold tabular-nums text-ink-deep">{time(a.scheduled_at)}</span>
                                                <Avatar name={a.patient?.name ?? '?'} size={32} />
                                                <span className="min-w-0 flex-1"><b className="text-graphite">{a.patient?.name}</b><span className="block truncate text-sm text-pencil">{role !== 'doctor' && a.doctor ? `${a.doctor.name} · ` : ''}{a.reason ?? (a.token_no ? `Token ${a.token_no}` : '')}</span></span>
                                                <AppointmentBadge status={a.status} />
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    )}
                    {s?.visits_series && (
                        <section className="rounded-2xl border border-rule bg-white p-5">
                            <h2 className="text-lg font-bold">Visits, last 14 days</h2>
                            <div className="mt-4 flex h-32 items-end gap-1.5" role="img" aria-label={`Visits per day: ${s.visits_series.map((v) => v.count).join(', ')}`}>
                                {s.visits_series.map((v) => (
                                    <div key={v.date} className="flex flex-1 flex-col items-center gap-1">
                                        <span className="text-[11px] tabular-nums text-pencil">{v.count || ''}</span>
                                        <div className="w-full rounded-t-md bg-gradient-to-t from-ink to-[#22d3ee]" style={{ height: `${Math.max(2, (v.count / max) * 100)}px` }} title={`${v.date}: ${v.count}`} />
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                </div>
                <div className="space-y-6">
                    <Announcements tenant={tenant} canPost={isAdmin} limit={4} compact />
                    {s?.staff && (
                        <section className="rounded-2xl border border-rule bg-white p-5">
                            <h2 className="text-lg font-bold">Staff</h2>
                            <ul className="mt-3 space-y-1.5">{Object.entries(s.staff).map(([r, n]) => <li key={r} className="flex justify-between"><span className="text-pencil">{ROLE_LABEL[r] ?? r}</span><b className="tabular-nums">{n}</b></li>)}</ul>
                            <Link to={`/${tenant}/people`} className="mt-3 inline-block text-sm font-bold text-ink hover:underline">Manage people</Link>
                        </section>
                    )}
                </div>
            </div>
        </div>
    );
}
