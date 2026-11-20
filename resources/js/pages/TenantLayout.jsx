import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { api, session } from '../lib/api';
import { applyBrand, resetBrand } from '../lib/brand';
import Icon from '../components/Icon';
import { Avatar, IconButton, Skeleton } from '../components/ui';
import NotificationBell from '../components/NotificationBell';
import SearchPalette from '../components/SearchPalette';

import { ROLE_LABEL, TYPE_LABEL } from '../lib/hms';

// Which module each page belongs to (Settings → Modules can switch them off).
const MODULE_OF = { appointments: 'appointments', emergency: 'emergency', inpatients: 'ipd', nursing: 'nursing', pharmacy: 'pharmacy', lab: 'lab', billing: 'billing', insurance: 'insurance', store: 'inventory', hr: 'hr', finance: 'finance', reports: 'reports' };

export default function TenantLayout() {
    const { tenant } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const [me, setMe] = useState(null);
    const [drawer, setDrawer] = useState(false);
    const [searching, setSearching] = useState(false);

    // Ctrl/Cmd+K opens search from anywhere.
    useEffect(() => {
        const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearching((v) => !v); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const refresh = useCallback(() => api('auth/me', { tenant }).then((m) => {
        setMe(m);
        applyBrand(m.tenant.settings?.brand);
        return m;
    }), [tenant]);

    useEffect(() => {
        if (!session.token(tenant)) {
            navigate(`/${tenant}/login`, { replace: true });
            return;
        }
        refresh().catch(() => {
            session.clear(tenant);
            navigate(`/${tenant}/login`, { replace: true });
        });
        return () => resetBrand();
    }, [tenant, navigate, refresh]);

    useEffect(() => setDrawer(false), [location.pathname]);

    async function signOut() {
        await api('auth/logout', { method: 'POST', tenant }).catch(() => {});
        session.clear(tenant);
        navigate(`/${tenant}/login`);
    }

    if (!me) return <ShellSkeleton />;

    const role = me.user.role;
    const isAdmin = role === 'admin';
    const mods = me.tenant.settings?.modules ?? {};
    const on = (m) => !m || mods[m] !== false;
    const is = (...roles) => roles.includes(role);
    const canRegister = is('admin', 'receptionist', 'nurse', 'doctor');
    const ctx = { me, tenant, isAdmin, role, on, is, canRegister, refresh };

    const t = `/${tenant}`;
    const groups = role === 'patient' ? [
        { links: [{ to: t, label: 'My health', icon: 'activity', end: true }] },
    ] : [
        { links: [{ to: t, label: 'Overview', icon: 'home', end: true }] },
        { label: 'Patients', links: [
            { to: `${t}/patients`, label: 'Patients', icon: 'users' },
            is('admin', 'receptionist', 'doctor', 'nurse') && { to: `${t}/appointments`, label: is('doctor') ? 'My appointments' : 'Appointments', icon: 'calendar' },
            is('admin', 'receptionist', 'doctor', 'nurse') && { to: `${t}/emergency`, label: 'Emergency', icon: 'ambulance' },
            is('admin', 'receptionist', 'doctor', 'nurse') && { to: `${t}/inpatients`, label: 'Inpatients', icon: 'bed' },
            is('admin', 'doctor', 'nurse') && { to: `${t}/nursing`, label: 'Ward round · eMAR', icon: 'syringe' },
        ] },
        { label: 'Services', links: [
            is('admin', 'doctor', 'nurse', 'receptionist', 'lab_technician') && { to: `${t}/lab`, label: 'Lab & imaging', icon: 'flask' },
            is('admin', 'pharmacist') && { to: `${t}/pharmacy`, label: 'Pharmacy', icon: 'pill' },
            is('admin', 'accountant', 'receptionist') && { to: `${t}/billing`, label: 'Billing', icon: 'receipt' },
            is('admin', 'accountant', 'receptionist') && { to: `${t}/insurance`, label: 'Insurance', icon: 'shield' },
        ] },
        is('admin', 'storekeeper', 'pharmacist', 'accountant', 'hr_manager') && { label: 'Operations', links: [
            is('admin', 'storekeeper', 'pharmacist', 'accountant') && { to: `${t}/store`, label: 'Store & purchasing', icon: 'box' },
            is('admin', 'accountant') && { to: `${t}/finance`, label: 'Finance', icon: 'wallet' },
            is('admin', 'accountant') && { to: `${t}/reports`, label: 'Reports', icon: 'chart' },
        ] },
        { label: 'Team', links: [
            { to: `${t}/staff`, label: 'Staff & roster', icon: 'stethoscope' },
            { to: `${t}/hr`, label: is('admin', 'hr_manager') ? 'HR · leave & attendance' : 'My leave & attendance', icon: 'briefcase' },
        ] },
        isAdmin && { label: 'Manage', links: [
            { to: `${t}/people`, label: 'People & access', icon: 'users' },
            { to: `${t}/subscription`, label: 'Plan & billing', icon: 'wallet' },
            { to: `${t}/settings`, label: 'Settings', icon: 'settings' },
        ] },
    ].filter(Boolean).map((g) => ({ ...g, links: g.links.filter(Boolean).filter((l) => on(MODULE_OF[l.to.split('/')[2]])) })).filter((g) => g.links.length);

    const trialDays = me.tenant.status === 'trial' && me.tenant.trial_ends_at
        ? Math.max(0, Math.ceil((new Date(me.tenant.trial_ends_at) - Date.now()) / 86400000))
        : null;

    const logo = me.tenant.settings?.logo_url;
    const sidebar = (
        <div className="relative flex h-full flex-col overflow-hidden bg-[#06232c] text-white">
            <div className="pointer-events-none absolute -top-24 -left-20 h-72 w-72 rounded-full bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)] blur-[90px]" aria-hidden />
            <div className="pointer-events-none absolute bottom-0 -right-24 h-64 w-64 rounded-full bg-[#22d3ee]/10 blur-[90px]" aria-hidden />
            <div className="relative px-5 pt-6 pb-5">
                <div className="flex items-center gap-3">
                    {logo ? (
                        <img src={logo} alt="" className="h-11 w-11 shrink-0 rounded-xl bg-white object-contain p-1" />
                    ) : (
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#2dd4bf] to-[var(--color-ink)] text-white shadow-[0_8px_24px_-8px_rgba(45,212,191,.8)]">
                            <Icon name="hospital" size={21} />
                        </span>
                    )}
                    <div className="min-w-0">
                        <p className="truncate font-display text-[16px] leading-tight font-bold text-white">{me.tenant.name}</p>
                        <p className="text-[13px] text-white/50">{TYPE_LABEL[me.tenant.type] ?? 'Hospital'}</p>
                    </div>
                </div>
                <button type="button" onClick={() => setSearching(true)}
                    className="mt-5 flex h-10 w-full items-center gap-2 rounded-xl bg-white/[.06] px-3 text-left text-white/60 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white">
                    <Icon name="search" size={16} />
                    <span className="flex-1 truncate text-sm">Search patients…</span>
                    <kbd className="hidden rounded-md bg-white/10 px-1.5 text-[11px] lg:inline">Ctrl K</kbd>
                </button>
            </div>

            <nav className="relative flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Main">
                {groups.map((g, gi) => (
                    <div key={gi} className="space-y-0.5">
                        {g.label && <p className="px-3 pb-1.5 text-[11px] font-bold tracking-[.14em] text-white/35 uppercase">{g.label}</p>}
                        {g.links.map((l) => (
                            <NavLink key={l.to} to={l.to} end={l.end}
                                className={({ isActive }) => `group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[15px] font-semibold transition-colors ${isActive ? 'text-white' : 'text-white/60 hover:text-white'}`}>
                                {({ isActive }) => (
                                    <>
                                        {isActive && <motion.span layoutId="nav-active" transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                                            className="absolute inset-0 rounded-xl bg-gradient-to-r from-[color-mix(in_srgb,var(--color-ink)_75%,transparent)] to-white/[.06] shadow-[inset_0_0_0_1px_rgba(255,255,255,.08),0_8px_24px_-12px_var(--color-ink)]" />}
                                        <span className={`relative grid h-7 w-7 place-items-center rounded-lg transition ${isActive ? 'bg-white/15' : 'bg-white/[.04] group-hover:bg-white/10'}`}><Icon name={l.icon} size={18} /></span>
                                        <span className="relative flex-1">{l.label}</span>
                                        {l.badge > 0 && <span className="relative rounded-full bg-margin px-2 py-0.5 text-xs font-bold text-white tabular-nums">{l.badge}</span>}
                                    </>
                                )}
                            </NavLink>
                        ))}
                    </div>
                ))}
            </nav>

            {trialDays !== null && isAdmin && (
                <Link to={`/${tenant}/subscription`} className="relative mx-3 mb-3 block rounded-2xl bg-gradient-to-br from-white/[.09] to-white/[.03] p-4 ring-1 ring-white/10 transition hover:ring-white/25">
                    <p className="text-sm font-bold text-white">Free trial · {trialDays} {trialDays === 1 ? 'day' : 'days'} left</p>
                    <p className="text-xs text-white/55">Every module is unlocked</p>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-gradient-to-r from-[#2dd4bf] to-[#22d3ee]" style={{ width: `${Math.min(100, (trialDays / 14) * 100)}%` }} />
                    </div>
                </Link>
            )}

            <div className="relative flex items-center gap-2 border-t border-white/10 px-3 py-3">
                <Link to={`/${tenant}/profile`} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-white/5">
                    <Avatar name={me.user.name} size={36} />
                    <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-white">{me.user.name}</p>
                        <p className="text-xs text-white/50">{ROLE_LABEL[role] ?? role}</p>
                    </div>
                </Link>
                <IconButton icon="logout" label="Sign out" onClick={signOut} className="text-white/60 hover:bg-white/10 hover:text-white" />
            </div>
        </div>
    );

    const current = groups.flatMap((g) => g.links).filter((l) => location.pathname === l.to || (!l.end && location.pathname.startsWith(`${l.to}/`)) || (l.end && location.pathname === l.to))
        .sort((a, b) => b.to.length - a.to.length)[0];

    return (
        <div className="min-h-screen lg:grid lg:grid-cols-[17.5rem_1fr]">
            <aside className="sticky top-0 z-30 hidden h-screen lg:block print:hidden">{sidebar}</aside>

            <div className="min-w-0">
                <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-black/[.04] px-4 py-3 glass sm:px-8 lg:px-12 print:hidden">
                    <IconButton icon="menu" label="Open menu" className="lg:hidden" onClick={() => setDrawer(true)} />
                    <div className="min-w-0 flex-1">
                        <p className="truncate font-display font-bold text-ink-deep lg:hidden">{me.tenant.name}</p>
                        <p className="hidden items-center gap-2 text-sm text-pencil lg:flex">
                            <Icon name={current?.icon ?? 'home'} size={16} />
                            <span className="font-semibold text-graphite">{current?.label ?? 'Overview'}</span>
                            <span className="text-pencil/50">·</span>
                            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                        </p>
                    </div>
                    <IconButton icon="search" label="Search" className="lg:hidden" onClick={() => setSearching(true)} />
                    <NotificationBell tenant={tenant} align="right" />
                    <Link to={`/${tenant}/profile`} aria-label="Your profile" className="rounded-full ring-2 ring-white transition hover:ring-ink/30"><Avatar name={me.user.name} size={34} /></Link>
                </header>

                <AnimatePresence>
                    {drawer && (
                        <motion.div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                            <div className="absolute inset-0 bg-[#06232c]/50 backdrop-blur-sm" onClick={() => setDrawer(false)} />
                            <motion.aside initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', stiffness: 380, damping: 38 }} className="absolute inset-y-0 left-0 w-[19rem] max-w-[85vw] shadow-2xl">
                                <IconButton icon="x" label="Close menu" className="absolute top-4 right-3 z-10 text-white/70 hover:bg-white/10" onClick={() => setDrawer(false)} />
                                {sidebar}
                            </motion.aside>
                        </motion.div>
                    )}
                </AnimatePresence>

                <SearchPalette open={searching} onClose={() => setSearching(false)} tenant={tenant}
                    pages={groups.flatMap((g) => g.links).map((l) => ({ label: l.label, icon: l.icon, to: l.to })).concat([{ label: 'Your profile', icon: 'user', to: `/${tenant}/profile` }])} />

                <main className="min-w-0">
                    {me.tenant.settings?.demo && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-gradient-to-r from-[#04161c] via-[#0b3a44] to-[#04161c] px-4 py-2.5 text-sm text-white/85 sm:px-8 lg:px-12 print:hidden">
                            <span className="flex items-center gap-2 font-bold text-white"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2dd4bf] opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#2dd4bf]" /></span>Demo hospital</span>
                            <span className="hidden sm:inline">You are signed in as <b className="text-white">{me.user.name}</b>. Everything here is fictional and resets every night.</span>
                            <span className="ml-auto flex items-center gap-2">
                                <button type="button" onClick={signOut} className="rounded-lg px-2.5 py-1 font-semibold text-white/80 hover:bg-white/10 hover:text-white">Switch role</button>
                                <Link to="/register" className="rounded-lg bg-[#2dd4bf] px-3 py-1 font-bold text-[#04161c] hover:bg-[#5eead4]">Create your own hospital</Link>
                            </span>
                        </div>
                    )}
                    <motion.div key={location.pathname} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
                        className="mx-auto max-w-6xl px-4 py-8 sm:px-8 lg:px-12 lg:py-10 print:max-w-none print:p-0">
                        <Outlet context={ctx} />
                    </motion.div>
                </main>
            </div>
        </div>
    );
}

function ShellSkeleton() {
    return (
        <div className="min-h-screen lg:grid lg:grid-cols-[17.5rem_1fr]" role="status" aria-label="Loading">
            <aside className="hidden bg-[#06232c] p-5 opacity-95 lg:block [&_.animate-pulse]:bg-white/10">
                <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-xl" />
                    <div className="flex-1 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-16" /></div>
                </div>
                <div className="mt-8 space-y-3"><Skeleton className="h-9" /><Skeleton className="h-9" /><Skeleton className="h-9" /></div>
            </aside>
            <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-10 sm:px-8 lg:px-12">
                <Skeleton className="h-9 w-64" />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
                </div>
                <Skeleton className="h-64 rounded-xl" />
            </div>
        </div>
    );
}

export { ROLE_LABEL, TYPE_LABEL };

