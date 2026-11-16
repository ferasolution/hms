import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useInView, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';
import { api } from '../lib/api';
import Icon from '../components/Icon';
import { Logo } from '../components/ui';
import { CountUp, EASE, MaskedLines, Reveal } from '../components/landing/Reveal';

const HealthScene = lazy(() => import('../components/landing/HealthScene'));

const hasWebGL = () => {
    try {
        const c = document.createElement('canvas');
        return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch {
        return false;
    }
};

const ALL_MODULES = [
    ['users', 'Patient records & EHR'], ['calendar', 'Appointments & queue'], ['stethoscope', 'Consultations (OPD)'],
    ['ambulance', 'Emergency & ambulance'], ['bed', 'Inpatients & bed board'], ['syringe', 'Ward nursing · eMAR'],
    ['flask', 'Lab & imaging'], ['pill', 'Pharmacy'], ['receipt', 'Billing'], ['shield', 'Insurance & claims'],
    ['box', 'Store & purchasing'], ['briefcase', 'HR · leave & attendance'], ['wallet', 'Finance & expenses'],
    ['chart', 'Reports & analytics'], ['heart', 'Patient portal'],
];

const SUITES = [
    {
        key: 'clinical', label: 'Clinical care', icon: 'stethoscope', grad: 'from-teal-400 to-cyan-500', url: 'patients/ava-brooks',
        title: 'One chart that follows the patient everywhere.',
        text: 'Problems, allergies, medicines, vaccinations, history, documents and vitals — the doctor sees everything in one place and writes one note.',
        points: ['EHR with problem list & allergies', 'Appointments, walk-in tokens & waiting room', 'One OPD note: vitals, ICD-10, Rx and tests', 'Patient portal for results & bookings'],
    },
    {
        key: 'acute', label: 'Emergency & wards', icon: 'ambulance', grad: 'from-rose-400 to-orange-500', url: 'emergency',
        title: 'Triage, treat and admit — without losing a minute.',
        text: 'A live 5-level triage board with waiting timers, critical alerts to doctors, admit straight to a free bed, and a medication chart nurses actually use.',
        points: ['Live triage board & ambulance dispatch', 'Unknown-patient registration', 'Bed board, transfers & discharge', 'eMAR with allergy check & dose recording'],
    },
    {
        key: 'diagnostics', label: 'Lab & pharmacy', icon: 'flask', grad: 'from-violet-400 to-fuchsia-500', url: 'lab',
        title: 'Orders arrive instantly. Results come straight back.',
        text: 'Urgent and STAT first, results with flags and reports, critical values alerted to the doctor. Pharmacy dispenses against real stock by batch and expiry.',
        points: ['Lab & imaging worklist by priority', 'Critical-value alerts', 'Prescription queue & dispensing', 'Batch, expiry & low-stock warnings'],
    },
    {
        key: 'revenue', label: 'Revenue cycle', icon: 'receipt', grad: 'from-emerald-400 to-lime-500', url: 'finance',
        title: 'Every service billed. Every claim followed up.',
        text: 'Charges are added as care happens, insurance shares are worked out for you, expenses go through approval, and the P&L builds itself.',
        points: ['Auto-billing & service price list', 'Policies, pre-auth & claims', 'Expenses with two-person approval', 'Profit & loss and 8 ready reports'],
    },
    {
        key: 'ops', label: 'Operations & people', icon: 'box', grad: 'from-sky-400 to-indigo-500', url: 'store',
        title: 'Stock, suppliers and staff — under control.',
        text: 'Purchase orders need a second approver, goods received update stock by themselves, and staff clock in, request leave and see their roster.',
        points: ['Store stock & department issues', 'Suppliers & purchase orders', 'Leave balances & attendance', 'Duty roster & departments'],
    },
];

const JOURNEY = [
    ['Arrival', 'Registered at the front desk in under a minute — or triaged on the Emergency board the moment they come through the door.', 'ambulance'],
    ['Doctor', 'Vitals, history and diagnosis in one note, with medicines and tests ordered in the same step.', 'stethoscope'],
    ['Lab & pharmacy', 'Orders appear at both counters instantly. Results and critical values flow back to the doctor.', 'flask'],
    ['Ward & nursing', 'Admitted to a free bed. Nurses record every dose, note and fluid on the eMAR.', 'syringe'],
    ['Billing & insurance', 'One bill with everything on it. The insurer’s share is claimed, the patient pays the rest.', 'receipt'],
    ['Management', 'Finance, stock and staffing roll up into live reports for the people who run the hospital.', 'chart'],
];

const SAFETY = [
    ['alert', 'Allergy check on every prescription', 'Prescribing a drug the patient is allergic to stops and asks for a deliberate override.'],
    ['users', 'Two-person approvals', 'Purchase orders, expenses and leave can never be approved by the person who raised them.'],
    ['bell', 'Critical alerts', 'Triage level 1–2 arrivals and critical lab values notify doctors immediately.'],
    ['eye', 'Chart access log', 'Every time a record is opened it is logged — who, when and from where.'],
    ['lock', 'Role-based access', 'Eleven roles. Each person sees what their job needs and nothing more.'],
    ['shield', 'Hospital-level isolation', 'Every record belongs to one hospital and every request is checked against it.'],
];

const ROLES = [
    ['Doctors', 'Their own queue, the full record, one form for notes, medicines and tests.', 'stethoscope'],
    ['Emergency team', 'A live triage board, waiting timers, bays and one-click admission.', 'ambulance'],
    ['Nurses', 'Medication round, dose recording, nursing notes and fluid balance.', 'syringe'],
    ['Front desk', 'Register, book, check in and take payment from one screen.', 'users'],
    ['Pharmacy', 'A live prescription queue and stock that counts itself down.', 'pill'],
    ['Laboratory', 'Urgent orders first; results go straight back to the doctor and patient.', 'flask'],
    ['Accounts', 'Collections, claims, expense approvals, P&L and reports.', 'wallet'],
    ['Store', 'Stock levels, reorder alerts, suppliers and goods received.', 'box'],
    ['HR', 'Leave approvals, attendance and the staff roster.', 'briefcase'],
];

const FAQ = [
    ['Do we need to install anything?', 'No. Fera HospitalOS runs in any browser on a computer, tablet or phone, and can be added to the home screen like an app. Your hospital gets its own sign-in page for staff and patients.'],
    ['Which modules are included?', 'All fifteen, on every plan: EHR, appointments, OPD, emergency, inpatients, eMAR, lab, pharmacy, billing, insurance, store, HR, finance, reports and the patient portal. Switch off anything you don’t use in Settings.'],
    ['Is each hospital’s data kept separate?', 'Yes. Every record belongs to exactly one hospital and every request is checked against it, so one hospital can never see another’s patients. Every chart opening is logged.'],
    ['Who can see what?', 'Access follows the job: doctors, nurses, front desk, pharmacy, lab, accounts, store and HR each see what they need. Patients only ever see their own records.'],
    ['Does it handle insurance?', 'Yes. Record each patient’s policy, request pre-authorization, claim bills with the insurer’s share worked out for you, and track every claim until it is paid.'],
    ['Can we get our data out?', 'Yes. Reports, stock, attendance and expenses all download as CSV, and the patient chart can be printed or exported at any time.'],
    ['What happens after the free trial?', 'You move to the Free plan unless you upgrade. Nothing is locked or deleted; you just can’t add staff or beds beyond the Free limits.'],
    ['Can you set it up for us?', 'Yes. Fera Solution can import your patients, staff and price lists and train your team. Get in touch through ferasolution.com.'],
];

const FALLBACK_PLANS = [
    { slug: 'free', name: 'Free', price_monthly: 0, max_staff: 5, max_beds: 10, storage_mb: 500 },
    { slug: 'clinic', name: 'Clinic', price_monthly: 99, max_staff: 25, max_beds: 30, storage_mb: 10240 },
    { slug: 'hospital', name: 'Hospital', price_monthly: 249, max_staff: 150, max_beds: 200, storage_mb: 51200 },
    { slug: 'enterprise', name: 'Enterprise', price_monthly: 499, max_staff: null, max_beds: null, storage_mb: 204800 },
];

export default function Landing() {
    const [plans, setPlans] = useState(FALLBACK_PLANS);
    useEffect(() => { api('plans').then((r) => r.data?.length && setPlans(r.data)).catch(() => {}); }, []);
    const { scrollYProgress } = useScroll();
    const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30 });

    return (
        <div className="overflow-x-clip bg-[#f3f7f8]">
            <motion.div style={{ scaleX: progress }} className="fixed inset-x-0 top-0 z-[60] h-[3px] origin-left bg-gradient-to-r from-[#2dd4bf] via-[#22d3ee] to-[#818cf8]" />
            <Nav />
            <Hero />
            <Marquee />
            <Suites />
            <Showcase />
            <Journey />
            <Safety />
            <Stats />
            <Roles />
            <Pricing plans={plans} />
            <Faq />
            <FinalCta />
            <Footer />
        </div>
    );
}

/* ---------------------------------------------------------------- nav */

function Nav() {
    const { scrollY } = useScroll();
    const [solid, setSolid] = useState(false);
    const [open, setOpen] = useState(false);
    useMotionValueEvent(scrollY, 'change', (y) => setSolid(y > window.innerHeight * 0.7));
    const link = `rounded-full px-3.5 py-2 text-[15px] font-semibold transition ${solid ? 'text-pencil hover:text-ink-deep' : 'text-white/70 hover:text-white'}`;
    const items = [['#modules', 'Platform'], ['#showcase', 'Tour'], ['#safety', 'Safety'], ['#pricing', 'Pricing'], ['#faq', 'FAQ']];

    return (
        <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5">
            <motion.div initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.7, ease: EASE }}
                className={`mx-auto flex h-16 max-w-6xl items-center justify-between rounded-2xl pr-2 pl-4 transition-all duration-500 ${solid ? 'glass shadow-[0_12px_40px_-16px_rgba(10,47,58,.35)] ring-1 ring-black/5' : 'bg-white/[.04] ring-1 ring-white/10 backdrop-blur-md'}`}>
                <Logo light={!solid} />
                <nav className="hidden items-center md:flex" aria-label="Main">
                    {items.map(([h, l]) => <a key={h} href={h} className={link}>{l}</a>)}
                </nav>
                <div className="flex items-center gap-1.5">
                    <Link to="/login" className={`hidden sm:block ${link}`}>Sign in</Link>
                    <Link to="/register" className="group relative inline-flex h-11 items-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-[#14b8a6] to-[#06b6d4] px-5 text-[15px] font-bold text-white shadow-[0_10px_30px_-10px_rgba(20,184,166,.9)]">
                        <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover:translate-x-full" aria-hidden />
                        Start free
                    </Link>
                    <button type="button" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open} className={`grid h-10 w-10 place-items-center rounded-xl md:hidden ${solid ? 'text-ink-deep' : 'text-white'}`}>
                        <Icon name={open ? 'x' : 'menu'} />
                    </button>
                </div>
            </motion.div>
            <AnimatePresence>
                {open && (
                    <motion.nav initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }} className="mx-auto mt-2 grid max-w-6xl gap-1 rounded-2xl bg-white p-3 shadow-xl ring-1 ring-rule md:hidden" aria-label="Mobile">
                        {items.map(([h, l]) => <a key={h} href={h} onClick={() => setOpen(false)} className="rounded-xl px-4 py-3 font-semibold text-ink-deep hover:bg-ink-50">{l}</a>)}
                        <Link to="/login" className="rounded-xl px-4 py-3 font-semibold text-ink-deep hover:bg-ink-50">Sign in</Link>
                    </motion.nav>
                )}
            </AnimatePresence>
        </header>
    );
}

/* ---------------------------------------------------------------- hero */

function Hero() {
    const reduce = useReducedMotion();
    const [gl, setGl] = useState(false);
    useEffect(() => setGl(hasWebGL()), []);
    const ref = useRef(null);
    const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
    const fade = useTransform(scrollYProgress, [0, 0.8], [1, 0]);
    const lift = useTransform(scrollYProgress, [0, 1], [0, -120]);

    return (
        <section ref={ref} className="relative min-h-[100svh] overflow-hidden bg-[#04161c] text-white">
            {/* Aurora */}
            <div className="pointer-events-none absolute inset-0" aria-hidden>
                <div className="absolute -top-40 left-[-10%] h-[38rem] w-[38rem] rounded-full bg-[#0d9488]/40 blur-[120px] animate-[aurora_14s_ease-in-out_infinite]" />
                <div className="absolute top-1/3 right-[-15%] h-[34rem] w-[34rem] rounded-full bg-[#0891b2]/35 blur-[120px] animate-[aurora_18s_ease-in-out_infinite_reverse]" />
                <div className="absolute bottom-[-20%] left-1/3 h-[28rem] w-[28rem] rounded-full bg-[#6366f1]/20 blur-[120px] animate-[aurora_22s_ease-in-out_infinite]" />
                <div className="absolute inset-0 opacity-[.18]" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.35) 1px, transparent 1px)', backgroundSize: '28px 28px', maskImage: 'radial-gradient(ellipse 70% 60% at 50% 40%, black, transparent)' }} />
            </div>

            {gl && <Suspense fallback={null}><HealthScene reduced={!!reduce} /></Suspense>}
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,#04161c_0%,rgba(4,22,28,.85)_32%,rgba(4,22,28,0)_65%)] max-md:bg-[linear-gradient(180deg,rgba(4,22,28,.2)_0%,rgba(4,22,28,.75)_45%,rgba(4,22,28,.95)_75%)]" aria-hidden />

            <motion.div style={reduce ? undefined : { opacity: fade, y: lift }} className="pointer-events-none relative mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-center px-5 pt-32 pb-28 sm:px-8">
                <div className="pointer-events-auto max-w-2xl">
                    <motion.div initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.6 }}
                        className="mb-7 inline-flex items-center gap-2.5 rounded-full bg-white/[.06] py-1.5 pr-4 pl-2 text-sm text-white/85 ring-1 ring-white/15 backdrop-blur">
                        <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full rounded-full bg-[#2dd4bf] animate-[pulse-ring_1.6s_ease-out_infinite]" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#2dd4bf]" /></span>
                        New · Emergency, eMAR, Store, HR & Finance
                    </motion.div>
                    <h1 className="font-display text-[clamp(2.7rem,6.6vw,5.1rem)] leading-[0.98] font-extrabold tracking-[-0.045em] text-white">
                        <MaskedLines lines={['The operating', 'system for', <span key="x" className="text-gradient">modern hospitals.</span>]} />
                    </h1>
                    <motion.p initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6, duration: 0.7, ease: EASE }}
                        className="mt-7 max-w-xl text-lg leading-8 text-white/70 sm:text-xl sm:leading-9">
                        Emergency to discharge, pharmacy to payroll-ready attendance — fifteen modules on one patient record, in one calm, fast system your whole team will actually enjoy using.
                    </motion.p>
                    <motion.div initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75, duration: 0.7, ease: EASE }} className="mt-10 flex flex-col gap-3 sm:flex-row">
                        <Link to="/register" className="group relative inline-flex h-14 items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-[#14b8a6] to-[#06b6d4] px-8 text-[17px] font-bold text-white shadow-[0_20px_50px_-15px_rgba(20,184,166,.9)] transition hover:shadow-[0_24px_60px_-12px_rgba(34,211,238,.9)]">
                            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/35 to-transparent transition-transform duration-700 group-hover:translate-x-full" aria-hidden />
                            Start your free trial<Icon name="arrowRight" size={20} className="transition group-hover:translate-x-1" />
                        </Link>
                        <a href="#showcase" className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-white/[.06] px-7 text-[17px] font-bold text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-white/10">
                            <Icon name="play" size={18} />Take the tour
                        </a>
                    </motion.div>
                    <motion.ul initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1, duration: 0.8 }} className="mt-9 flex flex-wrap gap-x-7 gap-y-2 text-[15px] text-white/60">
                        {['14 days free', 'No card needed', 'All 15 modules included', 'Works on any device'].map((t) => <li key={t} className="flex items-center gap-2"><Icon name="check" size={16} strokeWidth={2.8} className="text-[#5eead4]" />{t}</li>)}
                    </motion.ul>
                </div>
            </motion.div>

            <FloatingCards reduce={reduce} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-[#f3f7f8]" aria-hidden />
        </section>
    );
}

/** Small glass widgets that float over the 3D scene (desktop). */
function FloatingCards({ reduce }) {
    const card = 'absolute rounded-2xl bg-white/[.07] p-4 text-white ring-1 ring-white/15 backdrop-blur-xl shadow-[0_30px_60px_-30px_rgba(0,0,0,.8)]';
    const pts = [30, 28, 34, 22, 40, 12, 44, 26, 30, 28, 33, 24, 36];
    return (
        <div className="pointer-events-none absolute inset-0 hidden xl:block" aria-hidden>
            <motion.div initial={reduce ? false : { opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.1, duration: 0.9, ease: EASE }} className={`${card} top-[22%] right-[6%] w-60 animate-[float_7s_ease-in-out_infinite]`}>
                <p className="text-xs font-semibold text-white/60">Heart rate · Bed ICU-02</p>
                <p className="mt-1 font-display text-3xl font-extrabold">78 <span className="text-sm font-semibold text-white/60">bpm</span></p>
                <svg viewBox="0 0 120 50" className="mt-2 h-12 w-full"><motion.path fill="none" stroke="#5eead4" strokeWidth="2.5" strokeLinejoin="round" d={`M${pts.map((y, i) => `${i * 10} ${y}`).join(' L')}`}
                    initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2.2, repeat: reduce ? 0 : Infinity, repeatDelay: 0.8, ease: 'easeInOut' }} /></svg>
            </motion.div>
            <motion.div initial={reduce ? false : { opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.3, duration: 0.9, ease: EASE }} className={`${card} right-[24%] bottom-[18%] w-64 animate-[float_8s_ease-in-out_infinite_1s]`}>
                <p className="flex items-center justify-between text-xs font-semibold text-white/60">Emergency · live<span className="flex items-center gap-1 text-[#fda4af]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#fb7185]" />2 critical</span></p>
                {[['1', 'bg-red-500', 'Chest pain', '4 m'], ['2', 'bg-orange-500', 'Stroke signs', '9 m'], ['3', 'bg-amber-400 text-[#04161c]', 'High fever', '22 m']].map(([l, c, n, t]) => (
                    <div key={n} className="mt-2 flex items-center gap-2 text-sm"><span className={`grid h-5 w-5 place-items-center rounded-md text-[11px] font-extrabold ${c}`}>{l}</span><span className="flex-1 font-semibold">{n}</span><span className="tabular-nums text-white/60">{t}</span></div>
                ))}
            </motion.div>
            <motion.div initial={reduce ? false : { opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.5, duration: 0.9, ease: EASE }} className={`${card} top-[60%] right-[3%] w-52 animate-[float_9s_ease-in-out_infinite_2s]`}>
                <p className="text-xs font-semibold text-white/60">Claim · Summit Health</p>
                <p className="mt-1 font-display text-2xl font-extrabold">$1,240</p>
                <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#2dd4bf]/20 px-2 py-0.5 text-xs font-bold text-[#5eead4]"><Icon name="check" size={12} strokeWidth={3} />Approved</p>
            </motion.div>
        </div>
    );
}

function Marquee() {
    const words = ['EHR', 'Appointments', 'OPD', 'Emergency', 'Triage', 'Ambulance', 'IPD', 'Bed board', 'eMAR', 'Pharmacy', 'Laboratory', 'Radiology', 'Billing', 'Insurance claims', 'Purchasing', 'HR', 'Finance', 'Reports', 'Patient portal'];
    return (
        <div className="relative overflow-hidden py-8" aria-hidden>
            <div className="flex w-max animate-[marquee_40s_linear_infinite] gap-10 whitespace-nowrap">
                {[...words, ...words].map((w, i) => <span key={i} className="flex items-center gap-10 font-display text-xl font-bold text-ink-deep/30">{w}<span className="h-1.5 w-1.5 rounded-full bg-ink/40" /></span>)}
            </div>
            <div className="pointer-events-none absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-[#f3f7f8] to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-[#f3f7f8] to-transparent" />
        </div>
    );
}

function SectionTitle({ eyebrow, title, text, center, dark }) {
    return (
        <Reveal className={center ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'}>
            <p className={`text-sm font-bold tracking-[.18em] uppercase ${dark ? 'text-[#5eead4]' : 'text-ink'}`}>{eyebrow}</p>
            <h2 className={`mt-3 font-display text-[clamp(2.1rem,4.6vw,3.6rem)] leading-[1.04] font-extrabold tracking-[-0.035em] ${dark ? 'text-white' : ''}`}>{title}</h2>
            {text && <p className={`mt-4 text-lg ${dark ? 'text-white/65' : 'text-pencil'}`}>{text}</p>}
        </Reveal>
    );
}

/* ---------------------------------------------------------------- suites */

function Suites() {
    const reduce = useReducedMotion();
    const [i, setI] = useState(0);
    const [auto, setAuto] = useState(true);
    const ref = useRef(null);
    const inView = useInView(ref, { margin: '-30% 0px' });
    useEffect(() => {
        if (!auto || reduce || !inView) return undefined;
        const t = setTimeout(() => setI((x) => (x + 1) % SUITES.length), 7000);
        return () => clearTimeout(t);
    }, [i, auto, reduce, inView]);
    const suite = SUITES[i];
    const pick = (k) => { setAuto(false); setI(k); };

    return (
        <section id="modules" ref={ref} className="mx-auto max-w-6xl scroll-mt-24 px-5 pt-16 pb-24 sm:px-8 lg:pb-32">
            <SectionTitle eyebrow="The platform" title="Fifteen modules. One patient record." text="Nothing is typed twice and nothing gets lost between departments — every module writes to the same chart." />

            <div className="mt-12 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Suites">
                {SUITES.map((x, k) => (
                    <button key={x.key} type="button" role="tab" aria-selected={k === i} onClick={() => pick(k)}
                        className={`relative flex shrink-0 items-center gap-2.5 overflow-hidden rounded-2xl px-4 py-3 text-[15px] font-bold transition ${k === i ? 'text-white' : 'bg-white text-graphite ring-1 ring-black/[.06] hover:ring-ink/30'}`}>
                        {k === i && <motion.span layoutId="suite-pill" className="absolute inset-0 rounded-2xl bg-[#04161c]" transition={{ type: 'spring', stiffness: 380, damping: 32 }} />}
                        <span className={`relative grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br ${x.grad} text-white`}><Icon name={x.icon} size={17} /></span>
                        <span className="relative">{x.label}</span>
                        {k === i && auto && !reduce && <motion.span key={`bar-${i}`} className="absolute bottom-0 left-0 h-[3px] bg-[#2dd4bf]" initial={{ width: 0 }} animate={{ width: inView ? '100%' : 0 }} transition={{ duration: 7, ease: 'linear' }} />}
                    </button>
                ))}
            </div>

            <div className="mt-6 grid items-center gap-8 lg:grid-cols-[0.9fr_1.1fr] [&>*]:min-w-0">
                <AnimatePresence mode="wait">
                    <motion.div key={suite.key} initial={reduce ? false : { opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.45, ease: EASE }}>
                        <h3 className="font-display text-3xl leading-tight font-extrabold tracking-[-0.03em] text-ink-deep sm:text-4xl">{suite.title}</h3>
                        <p className="mt-4 text-lg text-pencil">{suite.text}</p>
                        <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
                            {suite.points.map((t, k) => (
                                <motion.li key={t} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + k * 0.07 }} className="flex gap-2.5 rounded-xl bg-white px-3.5 py-3 text-[15px] font-semibold text-graphite ring-1 ring-black/[.05]">
                                    <Icon name="check" size={18} strokeWidth={2.8} className="mt-0.5 shrink-0 text-ink" />{t}
                                </motion.li>
                            ))}
                        </ul>
                    </motion.div>
                </AnimatePresence>

                <AppWindow url={suite.url}>
                    <AnimatePresence mode="wait">
                        <motion.div key={suite.key} initial={reduce ? false : { opacity: 0, y: 20, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12, scale: 0.98 }} transition={{ duration: 0.45, ease: EASE }}>
                            {suite.key === 'clinical' && <ChartPreview />}
                            {suite.key === 'acute' && <TriagePreview />}
                            {suite.key === 'diagnostics' && <LabPreview />}
                            {suite.key === 'revenue' && <RevenuePreview />}
                            {suite.key === 'ops' && <OpsPreview />}
                        </motion.div>
                    </AnimatePresence>
                </AppWindow>
            </div>

            <Reveal className="mt-16">
                <p className="text-center text-sm font-bold tracking-[.18em] text-pencil uppercase">Every plan includes</p>
                <ul className="mt-5 flex flex-wrap justify-center gap-2">
                    {ALL_MODULES.map(([icon, name], k) => (
                        <motion.li key={name} initial={reduce ? false : { opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: k * 0.03 }}
                            className="flex items-center gap-2 rounded-full bg-white py-1.5 pr-4 pl-1.5 text-sm font-semibold text-graphite ring-1 ring-black/[.06] transition hover:-translate-y-0.5 hover:ring-ink/30">
                            <span className="grid h-7 w-7 place-items-center rounded-full bg-ink-50 text-ink"><Icon name={icon} size={15} /></span>{name}
                        </motion.li>
                    ))}
                </ul>
            </Reveal>
        </section>
    );
}

/** A browser-style frame around the product previews. */
function AppWindow({ url, children }) {
    const ref = useRef(null);
    const reduce = useReducedMotion();
    const rx = useSpring(0, { stiffness: 120, damping: 18 });
    const ry = useSpring(0, { stiffness: 120, damping: 18 });
    function move(e) {
        if (reduce) return;
        const r = ref.current.getBoundingClientRect();
        ry.set(((e.clientX - r.left) / r.width - 0.5) * 6);
        rx.set(-((e.clientY - r.top) / r.height - 0.5) * 6);
    }
    return (
        <div className="relative [perspective:1400px]">
            <div className="pointer-events-none absolute -inset-6 rounded-[2.5rem] bg-gradient-to-br from-[#2dd4bf]/30 via-[#22d3ee]/20 to-[#818cf8]/25 blur-2xl" aria-hidden />
            <motion.div ref={ref} onMouseMove={move} onMouseLeave={() => { rx.set(0); ry.set(0); }} style={{ rotateX: rx, rotateY: ry }}
                className="relative overflow-hidden rounded-3xl bg-white shadow-[0_50px_100px_-40px_rgba(4,22,28,.55)] ring-1 ring-black/[.06]">
                <div className="flex items-center gap-2 border-b border-rule bg-[#f7fafb] px-4 py-3">
                    <span className="h-3 w-3 rounded-full bg-[#ff5f57]" /><span className="h-3 w-3 rounded-full bg-[#febc2e]" /><span className="h-3 w-3 rounded-full bg-[#28c840]" />
                    <span className="ml-3 flex-1 truncate rounded-lg bg-white px-3 py-1 text-xs text-pencil ring-1 ring-rule"><Icon name="lock" size={11} className="mr-1 inline" />mercy.hospitalos.app/{url}</span>
                </div>
                <div className="min-h-[22rem] p-5 sm:p-6">{children}</div>
            </motion.div>
        </div>
    );
}

const stagger = (k) => ({ initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.1 + k * 0.08, duration: 0.4 } });

function ChartPreview() {
    const ys = [52, 48, 50, 44, 46, 38, 40, 34];
    return (
        <div>
            <motion.div {...stagger(0)} className="flex items-center gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-teal-400 to-cyan-500 font-bold text-white">AB</span>
                <div className="flex-1"><p className="font-bold text-ink-deep">Ava Brooks</p><p className="text-sm text-pencil">MRN-000214 · 34 y · F · Summit Health PPO</p></div>
                <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600 ring-1 ring-red-200">⚠ Penicillin</span>
            </motion.div>
            <motion.div {...stagger(1)} className="mt-4 flex gap-4 border-b border-rule text-sm font-bold text-pencil"><span className="border-b-2 border-ink pb-2 text-ink-deep">Health record</span><span>Visits</span><span>Labs</span><span>Bills</span></motion.div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <motion.div {...stagger(2)} className="rounded-2xl bg-[#f7fafb] p-4 ring-1 ring-rule">
                    <p className="text-xs font-bold tracking-wide text-pencil uppercase">Problems</p>
                    {[['Type 2 diabetes', 'E11.9'], ['Hypertension', 'I10'], ['Asthma, mild', 'J45.20']].map(([n, c]) => <p key={c} className="mt-2 flex justify-between text-sm"><span className="font-semibold text-graphite">{n}</span><span className="font-mono text-xs text-pencil">{c}</span></p>)}
                </motion.div>
                <motion.div {...stagger(3)} className="rounded-2xl bg-[#f7fafb] p-4 ring-1 ring-rule">
                    <p className="text-xs font-bold tracking-wide text-pencil uppercase">HbA1c trend</p>
                    <svg viewBox="0 0 140 60" className="mt-2 h-16 w-full"><motion.path d={`M${ys.map((y, k) => `${k * 20} ${y}`).join(' L')}`} fill="none" stroke="#0d9488" strokeWidth="3" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, delay: 0.3 }} /></svg>
                    <p className="text-sm font-bold text-emerald-600">8.4% → 6.9% in 6 months</p>
                </motion.div>
                <motion.div {...stagger(4)} className="rounded-2xl bg-[#f7fafb] p-4 ring-1 ring-rule sm:col-span-2">
                    <p className="text-xs font-bold tracking-wide text-pencil uppercase">Current medicines</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-sm">{['Metformin 500 mg BD', 'Amlodipine 5 mg OD', 'Salbutamol inhaler PRN'].map((m) => <span key={m} className="rounded-lg bg-white px-2.5 py-1 font-semibold text-graphite ring-1 ring-rule">{m}</span>)}</div>
                </motion.div>
            </div>
        </div>
    );
}

function TriagePreview() {
    const [sec, setSec] = useState(0);
    useEffect(() => { const t = setInterval(() => setSec((x) => x + 1), 1000); return () => clearInterval(t); }, []);
    const rows = [[1, 'bg-red-500 text-white', 'Noah Hill', 'Chest pain, sweating', 4, 'Resus 1'], [2, 'bg-orange-500 text-white', 'Unknown Patient', 'RTA — head injury', 9, 'Bay 2'], [3, 'bg-amber-400 text-amber-950', 'Mia Cole', 'Fever 103°F, cough', 26, 'Bay 5'], [4, 'bg-emerald-500 text-white', 'Liam Reed', 'Ankle sprain', 41, null]];
    return (
        <div>
            <motion.div {...stagger(0)} className="grid grid-cols-4 gap-2 text-center">
                {[['In ER', 7], ['Critical', 2], ['To triage', 1], ['Avg wait', '18m']].map(([l, v]) => <div key={l} className="rounded-xl bg-[#f7fafb] p-2 ring-1 ring-rule"><p className="text-[11px] font-bold text-pencil">{l}</p><p className="font-display text-lg font-extrabold text-ink-deep">{v}</p></div>)}
            </motion.div>
            <ul className="mt-4 space-y-2">
                {rows.map(([l, c, n, cc, m, bay], k) => (
                    <motion.li key={n} {...stagger(k + 1)} className="relative flex items-center gap-3 overflow-hidden rounded-xl bg-white p-3 ring-1 ring-rule">
                        <span className={`absolute inset-y-0 left-0 w-1 ${c.split(' ')[0]}`} />
                        <span className={`relative grid h-9 w-9 place-items-center rounded-lg font-display font-extrabold ${c}`}>{l}{l <= 2 && <span className="absolute inset-0 animate-ping rounded-lg bg-current opacity-20" />}</span>
                        <div className="min-w-0 flex-1"><p className="truncate font-bold text-graphite">{n}</p><p className="truncate text-sm text-pencil">{cc}</p></div>
                        <div className="text-right"><p className={`font-display font-extrabold tabular-nums ${m > 20 && l <= 3 ? 'text-red-600' : 'text-ink-deep'}`}>{m}:{String(sec % 60).padStart(2, '0')}</p><p className="text-xs text-pencil">{bay ?? 'Waiting'}</p></div>
                    </motion.li>
                ))}
            </ul>
        </div>
    );
}

function LabPreview() {
    return (
        <div className="grid gap-4 sm:grid-cols-2">
            <div>
                <p className="text-xs font-bold tracking-wide text-pencil uppercase">Lab worklist</p>
                {[['STAT', 'bg-red-500', 'Troponin I', 'Noah Hill'], ['Urgent', 'bg-amber-400', 'CBC', 'Mia Cole'], ['Routine', 'bg-slate-300', 'Lipid profile', 'Ava Brooks']].map(([p, c, t, n], k) => (
                    <motion.div key={t} {...stagger(k)} className="mt-2 flex items-center gap-2 rounded-xl bg-white p-3 text-sm ring-1 ring-rule"><span className={`h-8 w-1 rounded-full ${c}`} /><div className="flex-1"><b className="text-graphite">{t}</b><p className="text-pencil">{n}</p></div><span className="text-xs font-bold text-pencil">{p}</span></motion.div>
                ))}
                <motion.div {...stagger(3)} className="mt-3 rounded-xl bg-red-50 p-3 text-sm ring-1 ring-red-200"><b className="text-red-700">Critical · Potassium 6.4 mmol/L</b><p className="text-red-700/80">Dr. Mitchell alerted · 08:42</p></motion.div>
            </div>
            <div>
                <p className="text-xs font-bold tracking-wide text-pencil uppercase">Pharmacy queue</p>
                {[['Ceftriaxone 1 g × 6', 'Ward A · G-12', 'Ready'], ['Metformin 500 mg × 60', 'OPD · Ava Brooks', 'Dispensing'], ['Salbutamol inhaler', 'ER · Bay 5', 'New']].map(([m, w, st], k) => (
                    <motion.div key={m} {...stagger(k + 1)} className="mt-2 rounded-xl bg-white p-3 text-sm ring-1 ring-rule"><div className="flex justify-between"><b className="text-graphite">{m}</b><span className={`rounded-full px-2 text-xs font-bold ${st === 'Ready' ? 'bg-emerald-100 text-emerald-700' : st === 'New' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-800'}`}>{st}</span></div><p className="text-pencil">{w}</p></motion.div>
                ))}
                <motion.p {...stagger(4)} className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900 ring-1 ring-amber-200">3 medicines below reorder level</motion.p>
            </div>
        </div>
    );
}

function RevenuePreview() {
    const bars = [62, 58, 71, 66, 74, 80, 77, 86];
    return (
        <div>
            <div className="grid grid-cols-3 gap-2">
                {[['Collected', '$96,400', 'text-emerald-600'], ['Expenses', '$71,200', 'text-graphite'], ['Net', '$25,200', 'text-ink-deep']].map(([l, v, c], k) => (
                    <motion.div key={l} {...stagger(k)} className="rounded-xl bg-[#f7fafb] p-3 ring-1 ring-rule"><p className="text-xs font-bold text-pencil">{l}</p><p className={`font-display text-xl font-extrabold ${c}`}>{v}</p></motion.div>
                ))}
            </div>
            <motion.div {...stagger(3)} className="mt-4 flex h-28 items-end gap-2 rounded-xl bg-[#f7fafb] p-3 ring-1 ring-rule">
                {bars.map((h, k) => <motion.span key={k} initial={{ height: 0 }} animate={{ height: `${h}%` }} transition={{ delay: 0.3 + k * 0.05, duration: 0.6, ease: EASE }} className="flex-1 rounded-t-md bg-gradient-to-t from-teal-500 to-cyan-400" />)}
            </motion.div>
            <motion.div {...stagger(4)} className="mt-4 rounded-xl bg-white p-3 ring-1 ring-rule">
                <div className="flex justify-between text-sm"><b className="text-graphite">INV-2026-0418 · Ava Brooks</b><span className="font-bold">$1,550</span></div>
                <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-[#eef3f4]">
                    <motion.span className="bg-teal-500" initial={{ width: 0 }} animate={{ width: '80%' }} transition={{ delay: 0.6, duration: 0.8 }} />
                    <motion.span className="bg-amber-400" initial={{ width: 0 }} animate={{ width: '20%' }} transition={{ delay: 1.3, duration: 0.5 }} />
                </div>
                <p className="mt-2 flex justify-between text-xs font-semibold text-pencil"><span>Summit Health · $1,240 · claim submitted</span><span>Patient $310</span></p>
            </motion.div>
        </div>
    );
}

function OpsPreview() {
    const [step, setStep] = useState(0);
    useEffect(() => { const t = setInterval(() => setStep((x) => (x + 1) % 5), 1300); return () => clearInterval(t); }, []);
    const steps = [['Raised', 'Store · J. Park'], ['Approved', 'Accounts · R. Diaz'], ['Received', '20 boxes'], ['Expense booked', '$128.00']];
    return (
        <div>
            <motion.div {...stagger(0)} className="rounded-2xl bg-[#f7fafb] p-4 ring-1 ring-rule">
                <div className="flex justify-between"><b className="text-ink-deep">PO-2026-0087 · MedSupply Co</b><span className="font-bold">$128.00</span></div>
                <p className="text-sm text-pencil">Nitrile gloves (M) × 20 boxes</p>
                <ol className="mt-4 grid grid-cols-4 gap-2">
                    {steps.map(([t, sub], k) => (
                        <li key={t} className="text-center">
                            <motion.span animate={{ backgroundColor: step > k ? '#0d9488' : '#e2e8f0', color: step > k ? '#fff' : '#64748b', scale: step === k + 1 ? [1, 1.2, 1] : 1 }} className="mx-auto grid h-8 w-8 place-items-center rounded-full text-sm font-bold">{step > k ? '✓' : k + 1}</motion.span>
                            <p className="mt-1 text-xs font-bold text-graphite">{t}</p><p className="text-[11px] text-pencil">{sub}</p>
                        </li>
                    ))}
                </ol>
            </motion.div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <motion.div {...stagger(1)} className="rounded-2xl bg-white p-4 ring-1 ring-rule">
                    <p className="text-xs font-bold tracking-wide text-pencil uppercase">Who’s in today</p>
                    <p className="mt-1 font-display text-2xl font-extrabold text-ink-deep">42 <span className="text-sm font-semibold text-pencil">/ 48</span></p>
                    <div className="mt-2 flex flex-wrap gap-1">{Array.from({ length: 48 }, (_, k) => <span key={k} className={`h-2.5 w-2.5 rounded-sm ${k < 38 ? 'bg-teal-500' : k < 42 ? 'bg-amber-400' : k < 45 ? 'bg-sky-400' : 'bg-slate-200'}`} />)}</div>
                </motion.div>
                <motion.div {...stagger(2)} className="rounded-2xl bg-white p-4 ring-1 ring-rule">
                    <p className="text-xs font-bold tracking-wide text-pencil uppercase">Leave requests</p>
                    {[['Grace Lee · RN', '3 days'], ['Dr. Reyes', '1 day']].map(([n, d]) => <p key={n} className="mt-2 flex justify-between text-sm"><span className="font-semibold text-graphite">{n}</span><span className="rounded-full bg-amber-100 px-2 text-xs font-bold text-amber-800">{d}</span></p>)}
                </motion.div>
            </div>
        </div>
    );
}

/* ---------------------------------------------------------------- showcase (bento) */

function Showcase() {
    return (
        <section id="showcase" className="scroll-mt-20 bg-[#04161c] text-white">
            <div className="relative mx-auto max-w-6xl px-5 py-24 sm:px-8 lg:py-32">
                <div className="pointer-events-none absolute top-20 right-0 h-80 w-80 rounded-full bg-[#0d9488]/30 blur-[100px]" aria-hidden />
                <SectionTitle dark eyebrow="See it working" title="Built for the busiest hour of the day." text="Every screen answers the question that matters right now: who’s next, which bed is free, what’s critical, who still owes." />
                <div className="relative mt-14 grid gap-4 md:grid-cols-6">
                    <Bento className="md:col-span-4" title="Live waiting room" text="Tokens, check-in and who’s with the doctor — updated automatically."><Queue /></Bento>
                    <Bento className="md:col-span-2" title="Bed board" text="Every ward at a glance."><Beds /></Bento>
                    <Bento className="md:col-span-3" title="Medication round" text="Every dose recorded at the bedside — given, held or refused."><Emar /></Bento>
                    <Bento className="md:col-span-3" title="Two-person approvals" text="Orders and expenses wait for a second signature."><Approvals /></Bento>
                    <Bento className="md:col-span-2" title="Vitals trend" text="Spot the change before it’s a problem."><Vitals /></Bento>
                    <Bento className="md:col-span-2" title="Critical results" text="Doctors are alerted the moment a value is flagged."><Critical /></Bento>
                    <Bento className="md:col-span-2" title="Insurance split" text="Insurer and patient share, worked out for you."><Split /></Bento>
                </div>
            </div>
        </section>
    );
}

function Bento({ className = '', title, text, children }) {
    return (
        <Reveal className={className}>
            <div className="group h-full rounded-3xl bg-white/[.04] p-6 ring-1 ring-white/10 backdrop-blur transition duration-300 hover:bg-white/[.07] hover:ring-[#2dd4bf]/40">
                <div className="min-h-36">{children}</div>
                <h3 className="mt-5 text-lg font-bold text-white">{title}</h3>
                <p className="mt-1 text-white/60">{text}</p>
            </div>
        </Reveal>
    );
}

function Queue() {
    const reduce = useReducedMotion();
    const [i, setI] = useState(0);
    const people = [['Ava Brooks', 'A-12'], ['Noah Hill', 'A-13'], ['Mia Cole', 'A-14'], ['Liam Reed', 'A-15'], ['Zoe King', 'A-16']];
    useEffect(() => { if (reduce) return undefined; const t = setInterval(() => setI((x) => (x + 1) % people.length), 2200); return () => clearInterval(t); }, [reduce, people.length]);
    const shown = [0, 1, 2, 3].map((k) => people[(i + k) % people.length]);
    return (
        <ul className="space-y-2">
            <AnimatePresence initial={false} mode="popLayout">
                {shown.map(([n, tok], k) => (
                    <motion.li layout key={n} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.5, ease: EASE }}
                        className="flex items-center gap-3 rounded-xl bg-white/[.06] px-4 py-2.5">
                        <span className="w-12 font-mono text-sm text-white/50">{tok}</span>
                        <span className="flex-1 font-semibold">{n}</span>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${k === 0 ? 'bg-[#2dd4bf] text-[#04161c]' : k === 1 ? 'bg-amber-400/90 text-[#04161c]' : 'bg-white/10 text-white/70'}`}>{k === 0 ? 'With doctor' : k === 1 ? 'Next' : 'Waiting'}</span>
                    </motion.li>
                ))}
            </AnimatePresence>
        </ul>
    );
}

function Beds() {
    const reduce = useReducedMotion();
    const [beds, setBeds] = useState([1, 0, 1, 1, 2, 0, 1, 0, 1]);
    useEffect(() => { if (reduce) return undefined; const t = setInterval(() => setBeds((b) => b.map((x, j) => (j === Math.floor(Math.random() * b.length) ? (x + 1) % 3 : x))), 1500); return () => clearInterval(t); }, [reduce]);
    return (
        <div className="grid grid-cols-3 gap-2">
            {beds.map((b, j) => (
                <motion.div key={j} layout className={`rounded-xl p-2 text-center text-xs font-bold transition-colors duration-500 ${b === 1 ? 'bg-[#2dd4bf] text-[#04161c]' : b === 0 ? 'bg-white/10 text-white/70' : 'bg-amber-400/80 text-[#04161c]'}`}>
                    G-0{j + 1}<span className="block font-medium opacity-75">{b === 1 ? 'Occupied' : b === 0 ? 'Free' : 'Cleaning'}</span>
                </motion.div>
            ))}
        </div>
    );
}

function Emar() {
    const reduce = useReducedMotion();
    const doses = [['02:00', 'given'], ['06:00', 'given'], ['10:00', 'held'], ['14:00', 'due'], ['18:00', 'due'], ['22:00', 'due']];
    const [n, setN] = useState(reduce ? 3 : 0);
    useEffect(() => { if (reduce) return undefined; const t = setInterval(() => setN((x) => (x + 1) % 8), 900); return () => clearInterval(t); }, [reduce]);
    return (
        <div>
            <div className="flex items-center justify-between text-sm"><b>Ceftriaxone 1 g · IV · Q4H</b><span className="rounded-full bg-[#e5484d]/25 px-2 py-0.5 text-xs font-bold text-[#fda4af]">⚠ Penicillin</span></div>
            <div className="mt-4 grid grid-cols-6 gap-2">
                {doses.map(([t, st], k) => {
                    const done = k < n && st !== 'due';
                    return (
                        <motion.div key={t} animate={{ scale: k === n - 1 && done ? [1, 1.12, 1] : 1 }} className={`rounded-xl px-1 py-2.5 text-center text-xs font-bold transition-colors duration-500 ${done ? (st === 'held' ? 'bg-amber-400 text-[#04161c]' : 'bg-[#2dd4bf] text-[#04161c]') : 'bg-white/[.08] text-white/70'}`}>
                            {t}<span className="block font-medium capitalize opacity-80">{done ? st : 'due'}</span>
                        </motion.div>
                    );
                })}
            </div>
        </div>
    );
}

function Approvals() {
    const reduce = useReducedMotion();
    const [k, setK] = useState(reduce ? 2 : 0);
    useEffect(() => { if (reduce) return undefined; const t = setInterval(() => setK((x) => (x + 1) % 4), 1400); return () => clearInterval(t); }, [reduce]);
    const rows = [['PO-0087 · Gloves', '$128', 'Store'], ['Expense · Electricity', '$2,940', 'Accounts']];
    return (
        <div className="space-y-2">
            {rows.map(([t, v, by], i) => {
                const approved = k > i + 1 || (k === 3);
                return (
                    <div key={t} className="flex items-center gap-3 rounded-xl bg-white/[.06] px-4 py-3">
                        <div className="flex-1"><p className="font-semibold">{t}</p><p className="text-xs text-white/50">Raised by {by}</p></div>
                        <b className="tabular-nums">{v}</b>
                        <motion.span key={String(approved)} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${approved ? 'bg-[#2dd4bf] text-[#04161c]' : 'bg-amber-400/90 text-[#04161c]'}`}>{approved ? 'Approved' : 'Awaiting 2nd'}</motion.span>
                    </div>
                );
            })}
        </div>
    );
}

function Vitals() {
    const reduce = useReducedMotion();
    const ys = [60, 55, 58, 48, 52, 40, 44, 34, 38, 30];
    return (
        <svg viewBox="0 0 180 90" className="h-36 w-full">
            <defs><linearGradient id="vg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#2dd4bf" stopOpacity=".45" /><stop offset="1" stopColor="#2dd4bf" stopOpacity="0" /></linearGradient></defs>
            <motion.path d={`M0 ${ys[0]} ${ys.map((y, i) => `L${i * 20} ${y}`).join(' ')} L180 90 L0 90 Z`} fill="url(#vg)" initial={reduce ? false : { opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 1.2, delay: 0.6 }} />
            <motion.path d={`M0 ${ys[0]} ${ys.map((y, i) => `L${i * 20} ${y}`).join(' ')}`} fill="none" stroke="#5eead4" strokeWidth="3" strokeLinecap="round" initial={reduce ? false : { pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.6, ease: 'easeInOut' }} />
            {ys.map((y, i) => <circle key={i} cx={i * 20} cy={y} r="2.5" fill="#a5f3fc" />)}
        </svg>
    );
}

function Critical() {
    return (
        <div className="space-y-2">
            {[['Haemoglobin', '9.1 g/dL', 'critical'], ['Potassium', '5.4 mmol/L', 'high'], ['Glucose (F)', '96 mg/dL', 'normal']].map(([t, v, f], i) => (
                <motion.div key={t} initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 + i * 0.15 }}
                    className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${f === 'critical' ? 'bg-[#e5484d]/20 ring-1 ring-[#e5484d]/50' : 'bg-white/[.06]'}`}>
                    <span className="flex-1 font-semibold">{t}</span><span className="tabular-nums">{v}</span>
                    <span className={`rounded-full px-2 text-[11px] font-bold uppercase ${f === 'critical' ? 'bg-[#e5484d] text-white' : f === 'high' ? 'bg-amber-400 text-[#04161c]' : 'bg-white/15 text-white/70'}`}>{f}</span>
                </motion.div>
            ))}
        </div>
    );
}

function Split() {
    return (
        <div className="pt-3">
            <div className="flex justify-between text-sm"><span className="text-white/60">Bill</span><b>$1,550</b></div>
            <div className="mt-3 flex h-4 overflow-hidden rounded-full bg-white/10">
                <motion.div className="bg-gradient-to-r from-[#14b8a6] to-[#22d3ee]" initial={{ width: 0 }} whileInView={{ width: '80%' }} viewport={{ once: true }} transition={{ duration: 1.2, ease: EASE }} />
                <motion.div className="bg-amber-400" initial={{ width: 0 }} whileInView={{ width: '20%' }} viewport={{ once: true }} transition={{ duration: 0.8, delay: 1, ease: EASE }} />
            </div>
            <div className="mt-3 flex justify-between text-sm"><span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#2dd4bf]" />Insurer $1,240</span><span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-400" />Patient $310</span></div>
        </div>
    );
}

/* ---------------------------------------------------------------- journey */

function Journey() {
    const ref = useRef(null);
    const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.75', 'end 0.6'] });
    const height = useSpring(useTransform(scrollYProgress, [0, 1], ['0%', '100%']), { stiffness: 120, damping: 30 });
    return (
        <section id="journey" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-24 sm:px-8 lg:py-32">
            <SectionTitle eyebrow="How it works" title="From the front door to the final bill." text="Each step hands over to the next by itself. Charges are added as care happens, so the bill is ready when the patient is — and management sees it the same day." />
            <div ref={ref} className="relative mt-16">
                <div className="absolute top-0 bottom-0 left-6 w-[3px] rounded-full bg-rule md:left-1/2 md:-translate-x-1/2" aria-hidden />
                <motion.div style={{ height }} className="absolute top-0 left-6 w-[3px] rounded-full bg-gradient-to-b from-[#14b8a6] to-[#22d3ee] md:left-1/2 md:-translate-x-1/2" aria-hidden />
                <ol className="space-y-12">
                    {JOURNEY.map(([title, text, icon], i) => (
                        <li key={title} className={`relative flex items-start gap-6 pl-16 md:pl-0 ${i % 2 ? 'md:flex-row-reverse' : ''}`}>
                            <span className="absolute top-2 left-0 grid h-12 w-12 place-items-center rounded-2xl bg-white text-ink shadow-[0_10px_30px_-10px_rgba(14,138,126,.6)] ring-1 ring-ink/20 md:left-1/2 md:-translate-x-1/2"><Icon name={icon} size={22} /></span>
                            <Reveal className={`md:w-[calc(50%-3rem)] ${i % 2 ? 'md:text-left' : 'md:text-right'}`} y={30}>
                                <div className="rounded-3xl bg-white p-6 shadow-[0_20px_40px_-24px_rgba(10,47,58,.3)] ring-1 ring-black/[.04]">
                                    <p className="font-display text-sm font-bold text-ink">Step {i + 1}</p>
                                    <h3 className="mt-1 text-xl font-bold">{title}</h3>
                                    <p className="mt-2 text-pencil">{text}</p>
                                </div>
                            </Reveal>
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    );
}

function Safety() {
    return (
        <section id="safety" className="scroll-mt-24 bg-white">
            <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-24 sm:px-8 lg:grid-cols-[1fr_1.15fr] lg:py-32">
                <div>
                    <SectionTitle eyebrow="Safety & control" title="Guardrails built into every screen." text="The checks a good hospital does on paper — done automatically, every time, and recorded." />
                    <Reveal delay={0.1} className="mt-8">
                        <AllergyDemo />
                    </Reveal>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                    {SAFETY.map(([icon, title, text], i) => (
                        <Reveal key={title} delay={(i % 2) * 0.08}>
                            <div className="group h-full rounded-3xl bg-[#f3f7f8] p-6 ring-1 ring-black/[.04] transition duration-300 hover:-translate-y-1 hover:bg-white hover:shadow-[0_30px_60px_-30px_rgba(10,47,58,.35)]">
                                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#04161c] text-[#5eead4] transition group-hover:scale-110 group-hover:rotate-[-6deg]"><Icon name={icon} size={20} /></span>
                                <h3 className="mt-4 text-lg font-bold text-ink-deep">{title}</h3>
                                <p className="mt-1.5 text-[15px] leading-relaxed text-pencil">{text}</p>
                            </div>
                        </Reveal>
                    ))}
                </div>
            </div>
        </section>
    );
}

/** A tiny looping demo of the allergy check on prescribing. */
function AllergyDemo() {
    const reduce = useReducedMotion();
    const ref = useRef(null);
    const inView = useInView(ref, { margin: '-20%' });
    const [phase, setPhase] = useState(reduce ? 2 : 0);
    useEffect(() => {
        if (reduce || !inView) return undefined;
        const t = setTimeout(() => setPhase((p) => (p + 1) % 3), phase === 2 ? 2600 : 1400);
        return () => clearTimeout(t);
    }, [phase, reduce, inView]);
    const typed = 'Amoxicillin 500 mg';
    return (
        <div ref={ref} className="rounded-3xl bg-[#04161c] p-5 text-white shadow-[0_40px_80px_-40px_rgba(4,22,28,.9)]">
            <p className="text-xs font-bold tracking-wide text-white/50 uppercase">Prescribe · Ava Brooks · G-12</p>
            <div className="mt-3 rounded-xl bg-white/[.07] px-4 py-3 font-semibold ring-1 ring-white/10">
                {phase === 0 ? <motion.span key="t" initial={{ clipPath: 'inset(0 100% 0 0)' }} animate={{ clipPath: 'inset(0 0% 0 0)' }} transition={{ duration: 1.1, ease: 'linear' }} className="inline-block">{typed}</motion.span> : typed}
                <span className="ml-0.5 inline-block h-4 w-px animate-pulse bg-white/70 align-middle" />
            </div>
            <AnimatePresence>
                {phase >= 1 && (
                    <motion.div initial={{ opacity: 0, y: -6, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                        <div className="mt-3 rounded-xl bg-[#e5484d]/15 p-3.5 ring-1 ring-[#e5484d]/50">
                            <p className="font-bold text-[#fda4af]">⚠ Allergy alert — Penicillin (severe)</p>
                            <p className="mt-0.5 text-sm text-white/70">Amoxicillin is a penicillin. Confirm to prescribe anyway.</p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
            <div className="mt-3 flex justify-end gap-2 text-sm font-bold">
                <span className="rounded-lg px-3 py-2 text-white/60">Cancel</span>
                <motion.span animate={{ backgroundColor: phase === 2 ? '#2dd4bf' : 'rgba(255,255,255,.1)', color: phase === 2 ? '#04161c' : 'rgba(255,255,255,.5)' }} className="rounded-lg px-3 py-2">{phase === 2 ? 'Switched to Azithromycin ✓' : 'Prescribe'}</motion.span>
            </div>
        </div>
    );
}

function Stats() {
    return (
        <section className="px-4 sm:px-8">
            <div className="relative mx-auto grid max-w-6xl gap-6 overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#0f766e] via-[#0e7490] to-[#1e3a8a] px-6 py-14 text-white sm:grid-cols-2 sm:px-12 lg:grid-cols-4">
                <div className="pointer-events-none absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.6) 1px, transparent 1px)', backgroundSize: '22px 22px' }} aria-hidden />
                {[[15, '', 'connected modules'], [11, '', 'roles with the right access'], [8, '', 'ready-made reports'], [100, '%', 'data isolation per hospital']].map(([n, s, l]) => (
                    <div key={l} className="relative text-center">
                        <p className="font-display text-5xl font-extrabold tracking-tight"><CountUp to={n} suffix={s} /></p>
                        <p className="mt-2 text-white/75">{l}</p>
                    </div>
                ))}
            </div>
        </section>
    );
}

function Roles() {
    return (
        <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8 lg:py-32">
            <SectionTitle center eyebrow="For every role" title="The right screen for every job." text="Everyone signs in to the same hospital and sees exactly what their role needs." />
            <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {ROLES.map(([title, text, icon], i) => (
                    <Reveal key={title} delay={(i % 3) * 0.08}>
                        <div className="group flex h-full gap-4 rounded-3xl bg-white p-6 ring-1 ring-black/[.04] shadow-[0_20px_40px_-28px_rgba(10,47,58,.3)] transition hover:-translate-y-1">
                            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-ink-50 text-ink transition group-hover:bg-ink group-hover:text-white"><Icon name={icon} size={21} /></span>
                            <div><h3 className="text-lg font-bold">{title}</h3><p className="mt-1 text-pencil">{text}</p></div>
                        </div>
                    </Reveal>
                ))}
            </div>
        </section>
    );
}

/* ---------------------------------------------------------------- pricing */

function Pricing({ plans }) {
    return (
        <section id="pricing" className="scroll-mt-24 bg-white">
            <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 lg:py-32">
                <SectionTitle center eyebrow="Pricing" title="Simple, honest pricing." text="Every module on every plan, unlimited patients. Pay only for staff and beds as you grow." />
                <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4 lg:items-stretch">
                    {plans.map((p, i) => {
                        const featured = p.slug === 'hospital';
                        const items = [
                            p.max_staff ? `Up to ${Number(p.max_staff).toLocaleString()} staff accounts` : 'Unlimited staff',
                            p.max_beds ? `Up to ${p.max_beds} beds` : 'Unlimited beds',
                            p.storage_mb ? `${p.storage_mb >= 1024 ? `${Math.round(p.storage_mb / 1024)} GB` : `${p.storage_mb} MB`} file storage` : null,
                            'Unlimited patients',
                            'All 15 modules included',
                        ].filter(Boolean);
                        return (
                            <Reveal key={p.slug} delay={i * 0.08}>
                                <div className={`relative flex h-full flex-col rounded-3xl p-7 transition duration-300 hover:-translate-y-1.5 ${featured ? 'bg-[#04161c] text-white shadow-[0_40px_80px_-30px_rgba(4,22,28,.8)] ring-1 ring-[#2dd4bf]/40' : 'bg-[#f3f7f8] ring-1 ring-black/[.05]'}`}>
                                    {featured && <span className="absolute -top-3.5 left-7 rounded-full bg-gradient-to-r from-[#14b8a6] to-[#06b6d4] px-3.5 py-1 text-sm font-bold text-white shadow-lg">Most popular</span>}
                                    <h3 className={`text-xl font-bold ${featured ? 'text-white' : ''}`}>{p.name}</h3>
                                    <p className="mt-5 flex items-baseline gap-1.5">
                                        <span className={`font-display text-5xl font-extrabold tracking-tight ${featured ? 'text-gradient' : 'text-ink-deep'}`}>${Number(p.price_monthly)}</span>
                                        <span className={featured ? 'text-white/60' : 'text-pencil'}>/ month</span>
                                    </p>
                                    <ul className={`mt-7 flex-1 space-y-3 ${featured ? 'text-white/85' : 'text-graphite'}`}>
                                        {items.map((t) => <li key={t} className="flex gap-3"><Icon name="check" size={19} strokeWidth={2.6} className={`mt-0.5 shrink-0 ${featured ? 'text-[#5eead4]' : 'text-ink'}`} />{t}</li>)}
                                    </ul>
                                    <Link to="/register" className={`mt-9 inline-flex h-12 items-center justify-center rounded-xl font-bold transition ${featured ? 'bg-gradient-to-r from-[#14b8a6] to-[#06b6d4] text-white hover:brightness-110' : 'bg-ink-deep text-white hover:bg-ink'}`}>
                                        {Number(p.price_monthly) === 0 ? 'Start free' : `Start with ${p.name}`}
                                    </Link>
                                </div>
                            </Reveal>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}

function Faq() {
    const [open, setOpen] = useState(0);
    return (
        <section id="faq" className="scroll-mt-24">
            <div className="mx-auto grid max-w-6xl gap-10 px-5 py-24 sm:px-8 lg:grid-cols-[1fr_1.6fr] lg:py-32">
                <Reveal>
                    <p className="text-sm font-bold tracking-[.18em] text-ink uppercase">FAQ</p>
                    <h2 className="mt-3 font-display text-[clamp(2.1rem,4.6vw,3.2rem)] leading-[1.04] font-extrabold tracking-[-0.035em]">Questions, answered.</h2>
                    <p className="mt-4 text-lg text-pencil">Anything else? Get in touch through <a href="https://www.ferasolution.com" className="font-bold text-ink hover:underline">ferasolution.com</a>.</p>
                </Reveal>
                <div className="space-y-3">
                    {FAQ.map(([q, a], i) => (
                        <div key={q} className={`rounded-2xl bg-white ring-1 transition ${open === i ? 'shadow-[0_20px_40px_-24px_rgba(10,47,58,.3)] ring-ink/25' : 'ring-black/[.05]'}`}>
                            <button type="button" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i} className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left">
                                <span className="text-lg font-bold text-ink-deep">{q}</span>
                                <motion.span animate={{ rotate: open === i ? 45 : 0 }} className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${open === i ? 'bg-ink text-white' : 'bg-ink-50 text-ink'}`}><Icon name="plus" size={18} /></motion.span>
                            </button>
                            <AnimatePresence initial={false}>
                                {open === i && (
                                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                                        <p className="max-w-2xl px-6 pb-6 text-[16px] leading-7 text-pencil">{a}</p>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

function FinalCta() {
    return (
        <section className="px-4 pb-20 sm:px-8">
            <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2.2rem] bg-[#04161c] px-6 py-20 text-center text-white sm:px-12 sm:py-28">
                <div className="pointer-events-none absolute -top-24 left-1/4 h-80 w-80 rounded-full bg-[#14b8a6]/40 blur-[100px] animate-[aurora_12s_ease-in-out_infinite]" aria-hidden />
                <div className="pointer-events-none absolute -bottom-24 right-1/4 h-80 w-80 rounded-full bg-[#6366f1]/30 blur-[100px] animate-[aurora_16s_ease-in-out_infinite_reverse]" aria-hidden />
                <Reveal className="relative">
                    <h2 className="mx-auto max-w-3xl font-display text-[clamp(2.3rem,5.6vw,4.2rem)] leading-[1] font-extrabold tracking-[-0.04em] text-white">Your hospital could be running on it <span className="text-gradient">tomorrow.</span></h2>
                    <p className="mx-auto mt-6 max-w-xl text-lg text-white/65">Create your hospital and we set up departments, wards, beds, common tests, medicines, a service price list and a starter store for you. Add your team and start seeing patients.</p>
                    <Link to="/register" className="group mt-10 inline-flex h-14 items-center gap-2 rounded-2xl bg-white px-8 text-[17px] font-bold text-[#04161c] transition hover:scale-[1.03]">
                        Create your hospital<Icon name="arrowRight" size={20} className="transition group-hover:translate-x-1" />
                    </Link>
                </Reveal>
            </div>
        </section>
    );
}

function Footer() {
    return (
        <footer className="border-t border-rule bg-white">
            <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
                <div>
                    <Logo />
                    <p className="mt-3 max-w-xs text-pencil">The hospital operating system — clinical care, emergency, wards, diagnostics, revenue and operations in one place.</p>
                    <p className="mt-4 text-sm text-pencil">A product of <a href="https://www.ferasolution.com" className="font-bold text-graphite hover:text-ink">Fera Solution</a></p>
                </div>
                {[
                    ['Product', [['#modules', 'Platform'], ['#showcase', 'Product tour'], ['#journey', 'How it works'], ['#safety', 'Safety'], ['#pricing', 'Pricing'], ['#faq', 'FAQ']]],
                    ['Get started', [['/register', 'Create a hospital'], ['/login', 'Sign in']]],
                    ['Company', [['https://www.ferasolution.com', 'Fera Solution'], ['https://www.ferasolution.com', 'Contact us']]],
                ].map(([title, links]) => (
                    <div key={title}>
                        <p className="font-bold text-graphite">{title}</p>
                        <ul className="mt-3 space-y-2">
                            {links.map(([href, label]) => <li key={label}>{href.startsWith('/') ? <Link to={href} className="text-pencil hover:text-ink">{label}</Link> : <a href={href} className="text-pencil hover:text-ink">{label}</a>}</li>)}
                        </ul>
                    </div>
                ))}
            </div>
            <div className="border-t border-rule"><p className="mx-auto max-w-6xl px-5 py-6 text-sm text-pencil sm:px-8">© {new Date().getFullYear()} Fera Solution. All rights reserved.</p></div>
        </footer>
    );
}
