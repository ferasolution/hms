import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react';
import { api } from '../lib/api';
import Icon from '../components/Icon';
import { Logo } from '../components/ui';
import { EASE, MaskedLines, Reveal } from '../components/landing/Reveal';

const MODULES = [
    ['users', 'Patient records', 'One chart per patient: history, allergies, vitals, visits, prescriptions, results and bills. Medical record numbers are given automatically.'],
    ['calendar', 'Appointments & queue', 'Doctor schedules with free slots, walk-ins with tokens, check-in at the front desk and a live waiting room.'],
    ['stethoscope', 'Consultations', 'Doctors write the note, prescribe and order tests in one step. Nurses record vitals and nursing notes.'],
    ['bed', 'Wards & beds', 'A live bed board. Admit, transfer and discharge with a summary. Room charges go on the bill by themselves.'],
    ['pill', 'Pharmacy', 'Prescriptions arrive at the counter. Dispense against stock, track batches and expiry, and get low-stock warnings.'],
    ['flask', 'Lab & imaging', 'Orders by priority, sample collection, results with flags and attached reports. Doctors are alerted to critical results.'],
    ['receipt', 'Billing & insurance', 'Every service is billed as it happens. Take cash, card or bank payments, print receipts and track insurance claims.'],
    ['activity', 'Patient portal', 'Patients see their results, prescriptions and bills, and book visits online at times that are really free.'],
];

const ROLES = [
    ['Front desk', 'Register, book, check in, take payment. The whole counter on one screen.'],
    ['Doctors', 'Their own queue, the full chart, and one form for notes, medicines and tests.'],
    ['Nurses', 'Vitals, admissions and the bed board, ward by ward.'],
    ['Pharmacy', 'A live prescription queue and stock that counts itself down.'],
    ['Laboratory', 'Urgent first. Results go straight back to the doctor and patient.'],
    ['Accounts', 'Collections by day and method, outstanding bills and insurance claims.'],
];

const JOURNEY = [
    ['Arrives', 'Registered in under a minute and checked in. The consultation fee is billed.'],
    ['Sees the doctor', 'Vitals, history, diagnosis and plan in one note, with medicines and tests.'],
    ['Lab & pharmacy', 'Tests and medicines appear at the lab and pharmacy counters straight away.'],
    ['Pays & goes home', 'One bill with everything on it. Results arrive in the patient portal.'],
];

const FAQ = [
    ['Do we need to install anything?', 'No. Fera HealthSphere runs in any browser on a computer, tablet or phone. Your hospital gets its own sign-in page for staff and patients.'],
    ['Is each hospital’s data kept separate?', 'Yes. Every record belongs to exactly one hospital and every request is checked against it, so one hospital can never see another’s patients.'],
    ['Who can see what?', 'Access follows the job: doctors, nurses, front desk, pharmacy, lab and accounts each see what they need. Patients only ever see their own records.'],
    ['Can we turn off parts we don’t use?', 'Yes. A small clinic can switch off wards, pharmacy or insurance in Settings. Nothing is deleted.'],
    ['What happens after the free trial?', 'You move to the Free plan unless you upgrade. Nothing is locked or deleted; you just can’t add staff or beds beyond the Free limits.'],
    ['Can you set it up for us?', 'Yes. Fera Solution can import your patients, staff and price lists and train your team. Get in touch through ferasolution.com.'],
];

const FALLBACK_PLANS = [
    { slug: 'free', name: 'Free', price_monthly: 0, max_staff: 5, max_beds: 10 },
    { slug: 'clinic', name: 'Clinic', price_monthly: 99, max_staff: 25, max_beds: 30 },
    { slug: 'hospital', name: 'Hospital', price_monthly: 249, max_staff: 150, max_beds: 200 },
    { slug: 'enterprise', name: 'Enterprise', price_monthly: 499, max_staff: null, max_beds: null },
];

export default function Landing() {
    const [plans, setPlans] = useState(FALLBACK_PLANS);
    useEffect(() => { api('plans').then((r) => r.data?.length && setPlans(r.data)).catch(() => {}); }, []);

    return (
        <div className="overflow-x-clip bg-paper">
            <Nav />
            <Hero />
            <Modules />
            <Journey />
            <Roles />
            <Pricing plans={plans} />
            <Faq />
            <FinalCta />
            <Footer />
        </div>
    );
}

function Nav() {
    const { scrollY } = useScroll();
    const [solid, setSolid] = useState(false);
    const [open, setOpen] = useState(false);
    useMotionValueEvent(scrollY, 'change', (y) => setSolid(y > window.innerHeight * 0.75));
    const link = `rounded-full px-3.5 py-2 text-[15px] font-bold transition ${solid ? 'text-pencil hover:text-ink-deep' : 'text-white/75 hover:text-white'}`;
    const items = [['#modules', 'Features'], ['#journey', 'How it works'], ['#pricing', 'Pricing'], ['#faq', 'FAQ']];

    return (
        <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5">
            <div className={`mx-auto flex h-14 max-w-6xl items-center justify-between rounded-full pr-2 pl-4 transition-all duration-300 ${solid ? 'bg-white/85 shadow-[0_8px_30px_-12px_rgba(18,40,95,.35)] ring-1 ring-rule backdrop-blur-xl' : 'bg-white/[.06] ring-1 ring-white/10 backdrop-blur-md'}`}>
                <Logo className={solid ? '' : '[&_span:last-child]:text-white'} />
                <nav className="hidden items-center md:flex" aria-label="Main">
                    {items.map(([h, l]) => <a key={h} href={h} className={link}>{l}</a>)}
                </nav>
                <div className="flex items-center gap-1.5">
                    <Link to="/login" className={`hidden sm:block ${link}`}>Sign in</Link>
                    <Link to="/register" className={`rounded-full px-4 py-2 text-[15px] font-bold transition ${solid ? 'bg-ink text-white hover:bg-ink-deep' : 'bg-white text-ink-deep hover:bg-ink-50'}`}>Start free</Link>
                    <button type="button" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open} className={`grid h-10 w-10 place-items-center rounded-full md:hidden ${solid ? 'text-ink-deep' : 'text-white'}`}>
                        <Icon name={open ? 'x' : 'menu'} />
                    </button>
                </div>
            </div>
            <AnimatePresence>
                {open && (
                    <motion.nav initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="mx-auto mt-2 grid max-w-6xl gap-1 rounded-3xl bg-white p-3 shadow-xl ring-1 ring-rule md:hidden" aria-label="Mobile">
                        {items.map(([h, l]) => <a key={h} href={h} onClick={() => setOpen(false)} className="rounded-2xl px-4 py-3 font-bold text-ink-deep hover:bg-ink-50">{l}</a>)}
                        <Link to="/login" className="rounded-2xl px-4 py-3 font-bold text-ink-deep hover:bg-ink-50">Sign in</Link>
                    </motion.nav>
                )}
            </AnimatePresence>
        </header>
    );
}

function Hero() {
    const reduce = useReducedMotion();
    return (
        <section className="relative overflow-hidden bg-[#0d1d4a] text-white">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_75%_35%,#1d3a8f_0%,#0d1d4a_60%,#08133a_100%)]" aria-hidden />
            <svg viewBox="0 0 1200 200" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-24 h-40 w-full opacity-40" aria-hidden>
                <motion.path d="M0 120 H380 L410 120 L430 60 L455 175 L480 20 L505 150 L525 120 H760 L780 120 L795 90 L815 140 L830 120 H1200"
                    fill="none" stroke="#7be0a6" strokeWidth="3" strokeLinejoin="round"
                    initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2.4, ease: 'easeInOut', repeat: reduce ? 0 : Infinity, repeatDelay: 1.2 }} />
            </svg>
            <div className="relative mx-auto grid min-h-[100svh] max-w-6xl items-center gap-12 px-5 pt-28 pb-24 sm:px-8 lg:grid-cols-[1.1fr_1fr]">
                <div>
                    <motion.p initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05, duration: 0.6 }}
                        className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/10 py-1.5 pr-4 pl-1.5 text-sm text-white/85 ring-1 ring-white/15 backdrop-blur">
                        <span className="rounded-full bg-[#e5484d] px-2 py-0.5 text-xs font-bold text-white">New</span>
                        Hospital management, from front desk to discharge
                    </motion.p>
                    <h1 className="font-display text-[clamp(2.8rem,8vw,5.8rem)] leading-[0.95] font-extrabold tracking-[-0.045em] text-white">
                        <MaskedLines lines={['Every patient.', 'Every bed.', 'One system.']} />
                    </h1>
                    <motion.p initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55, duration: 0.7, ease: EASE }}
                        className="mt-7 max-w-xl text-lg leading-8 text-white/75 sm:text-xl sm:leading-9">
                        Patient records, appointments, wards, pharmacy, lab and billing in one place, for hospitals and clinics of any size. Ready in minutes, in any browser.
                    </motion.p>
                    <motion.div initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7, duration: 0.7, ease: EASE }} className="mt-9 flex flex-col gap-3 sm:flex-row">
                        <Link to="/register" className="group inline-flex h-14 items-center justify-center gap-2 rounded-full bg-white px-7 text-[17px] font-bold text-ink-deep transition hover:bg-ink-50">
                            Start your free trial<Icon name="arrowRight" size={20} className="transition group-hover:translate-x-1" />
                        </Link>
                        <a href="#modules" className="inline-flex h-14 items-center justify-center gap-2 rounded-full px-7 text-[17px] font-bold text-white ring-1 ring-white/25 transition hover:bg-white/10">See what’s inside</a>
                    </motion.div>
                    <motion.ul initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.95, duration: 0.8 }} className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-white/65">
                        {['14 days free', 'No card needed', 'Each hospital fully separate'].map((t) => <li key={t} className="flex items-center gap-2"><Icon name="check" size={17} strokeWidth={2.6} className="text-[#7be0a6]" />{t}</li>)}
                    </motion.ul>
                </div>
                <HeroBoard reduce={reduce} />
            </div>
        </section>
    );
}

/** A small, live-looking mock of the waiting room and bed board. */
function HeroBoard({ reduce }) {
    const queue = [['9:00', 'James Walker', 'With doctor', 'bg-ink'], ['9:15', 'Ava Brooks', 'Waiting', 'bg-amber-500'], ['9:30', 'Noah Hill', 'Waiting', 'bg-amber-500'], ['9:45', 'Mia Cole', 'Booked', 'bg-white/30']];
    const beds = ['occ', 'free', 'occ', 'occ', 'clean', 'free', 'occ', 'free'];
    return (
        <motion.div initial={reduce ? false : { opacity: 0, y: 30, rotate: -1.5 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ delay: 0.4, duration: 0.9, ease: EASE }}
            className="hidden rounded-3xl bg-white/[.07] p-5 ring-1 ring-white/15 backdrop-blur-md lg:block" aria-hidden>
            <p className="text-sm font-bold text-white/60">Waiting room · Dr. Sarah Mitchell</p>
            <ul className="mt-3 space-y-2">
                {queue.map(([t, n, s, c], i) => (
                    <motion.li key={n} initial={reduce ? false : { opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.7 + i * 0.12 }}
                        className="flex items-center gap-3 rounded-xl bg-white/[.06] px-3 py-2.5">
                        <span className="w-12 font-bold tabular-nums">{t}</span><span className="flex-1">{n}</span>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold text-white ${c}`}>{s}</span>
                    </motion.li>
                ))}
            </ul>
            <p className="mt-6 text-sm font-bold text-white/60">General ward · 5 of 8 beds occupied</p>
            <div className="mt-3 grid grid-cols-4 gap-2">
                {beds.map((b, i) => (
                    <motion.div key={i} initial={reduce ? false : { opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1 + i * 0.05 }}
                        className={`rounded-lg p-2 text-xs font-bold ${b === 'occ' ? 'bg-white text-ink-deep' : b === 'free' ? 'bg-[#7be0a6]/20 text-[#7be0a6] ring-1 ring-[#7be0a6]/40' : 'bg-amber-400/20 text-amber-200 ring-1 ring-amber-300/40'}`}>
                        G-0{i + 1}<span className="block font-normal opacity-80">{b === 'occ' ? 'Occupied' : b === 'free' ? 'Free' : 'Cleaning'}</span>
                    </motion.div>
                ))}
            </div>
        </motion.div>
    );
}

function Modules() {
    return (
        <section id="modules" className="mx-auto max-w-6xl scroll-mt-24 px-5 pt-28 pb-20 sm:px-8 lg:pt-36">
            <Reveal>
                <h2 className="max-w-3xl font-display text-[clamp(2.2rem,5vw,3.8rem)] leading-[1.02] font-extrabold tracking-[-0.035em]">Everything a hospital runs on.</h2>
                <p className="mt-4 max-w-2xl text-lg text-pencil">Eight modules that share one patient record, so nothing is typed twice and nothing gets lost between departments.</p>
            </Reveal>
            <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {MODULES.map(([icon, title, text], i) => (
                    <Reveal key={title} delay={(i % 4) * 0.06} className="rounded-3xl border border-rule bg-white p-6">
                        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-ink-50 text-ink"><Icon name={icon} size={24} /></span>
                        <h3 className="mt-5 text-lg font-bold text-ink-deep">{title}</h3>
                        <p className="mt-2 text-pencil">{text}</p>
                    </Reveal>
                ))}
            </div>
        </section>
    );
}

function Journey() {
    return (
        <section id="journey" className="scroll-mt-20 bg-[#0d1d4a] text-white">
            <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 lg:py-32">
                <Reveal>
                    <h2 className="max-w-3xl font-display text-[clamp(2.2rem,5vw,3.8rem)] leading-[1.02] font-extrabold tracking-[-0.035em] text-white">From the front door to the final bill.</h2>
                    <p className="mt-4 max-w-2xl text-lg text-white/70">Each step hands over to the next by itself. Charges are added as services happen, so the bill is ready when the patient is.</p>
                </Reveal>
                <ol className="mt-14 grid gap-5 md:grid-cols-4">
                    {JOURNEY.map(([title, text], i) => (
                        <Reveal key={title} delay={i * 0.1} className="relative rounded-3xl bg-white/[.06] p-6 ring-1 ring-white/10">
                            <span className="font-display text-5xl font-extrabold text-[#7be0a6]">{i + 1}</span>
                            <h3 className="mt-4 text-xl font-bold text-white">{title}</h3>
                            <p className="mt-2 text-white/70">{text}</p>
                        </Reveal>
                    ))}
                </ol>
            </div>
        </section>
    );
}

function Roles() {
    return (
        <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8 lg:py-32">
            <Reveal>
                <h2 className="max-w-3xl font-display text-[clamp(2.2rem,5vw,3.8rem)] leading-[1.02] font-extrabold tracking-[-0.035em]">The right screen for every job.</h2>
                <p className="mt-4 max-w-2xl text-lg text-pencil">Everyone signs in to the same hospital and sees what their role needs, nothing more.</p>
            </Reveal>
            <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-3">
                {ROLES.map(([title, text]) => (
                    <div key={title} className="bg-white p-6"><h3 className="text-lg font-bold text-ink-deep">{title}</h3><p className="mt-1.5 text-pencil">{text}</p></div>
                ))}
            </div>
        </section>
    );
}

function Pricing({ plans }) {
    return (
        <section id="pricing" className="scroll-mt-24 border-t border-rule bg-white">
            <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 lg:py-32">
                <Reveal className="text-center">
                    <h2 className="font-display text-[clamp(2.2rem,5vw,3.8rem)] leading-[1.02] font-extrabold tracking-[-0.035em]">Simple, honest pricing.</h2>
                    <p className="mt-4 text-lg text-pencil">Unlimited patients on every plan. Pay for staff and beds as you grow.</p>
                </Reveal>
                <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4 lg:items-center">
                    {plans.map((p, i) => {
                        const featured = p.slug === 'hospital';
                        const items = [
                            p.max_staff ? `Up to ${Number(p.max_staff).toLocaleString()} staff accounts` : 'Unlimited staff',
                            p.max_beds ? `Up to ${p.max_beds} beds` : 'Unlimited beds',
                            'Unlimited patients',
                            'Every module included',
                        ];
                        return (
                            <Reveal key={p.slug} delay={i * 0.08} className={`relative flex flex-col rounded-3xl p-7 ${featured ? 'bg-[#0d1d4a] text-white shadow-[0_40px_80px_-30px_rgba(13,29,74,.7)] lg:py-10' : 'border border-rule bg-paper'}`}>
                                {featured && <span className="absolute -top-3.5 left-7 rounded-full bg-[#e5484d] px-3.5 py-1 text-sm font-bold text-white">Most popular</span>}
                                <h3 className={`text-xl font-bold ${featured ? 'text-white' : ''}`}>{p.name}</h3>
                                <p className="mt-5 flex items-baseline gap-1.5">
                                    <span className={`font-display text-5xl font-extrabold tracking-tight ${featured ? 'text-white' : 'text-ink-deep'}`}>${Number(p.price_monthly)}</span>
                                    <span className={featured ? 'text-white/60' : 'text-pencil'}>/ month</span>
                                </p>
                                <ul className={`mt-7 flex-1 space-y-3 ${featured ? 'text-white/85' : 'text-graphite'}`}>
                                    {items.map((t) => <li key={t} className="flex gap-3"><Icon name="check" size={19} strokeWidth={2.6} className={`mt-0.5 ${featured ? 'text-[#7be0a6]' : 'text-leaf'}`} />{t}</li>)}
                                </ul>
                                <Link to="/register" className={`mt-9 inline-flex h-12 items-center justify-center rounded-full font-bold transition ${featured ? 'bg-white text-ink-deep hover:bg-ink-50' : 'bg-ink text-white hover:bg-ink-deep'}`}>
                                    {Number(p.price_monthly) === 0 ? 'Start free' : `Start with ${p.name}`}
                                </Link>
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
        <section id="faq" className="scroll-mt-24 border-t border-rule bg-paper">
            <div className="mx-auto grid max-w-6xl gap-10 px-5 py-24 sm:px-8 lg:grid-cols-[1fr_1.6fr] lg:py-32">
                <Reveal>
                    <h2 className="font-display text-[clamp(2.2rem,5vw,3.4rem)] leading-[1.02] font-extrabold tracking-[-0.035em]">Questions, answered.</h2>
                    <p className="mt-4 text-lg text-pencil">Anything else? Get in touch through <a href="https://www.ferasolution.com" className="font-bold text-ink hover:underline">ferasolution.com</a>.</p>
                </Reveal>
                <div className="divide-y divide-rule border-y border-rule">
                    {FAQ.map(([q, a], i) => (
                        <div key={q}>
                            <button type="button" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i} className="flex w-full items-center justify-between gap-6 py-5 text-left">
                                <span className="text-lg font-bold text-ink-deep">{q}</span>
                                <motion.span animate={{ rotate: open === i ? 45 : 0 }} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-50 text-ink"><Icon name="plus" size={18} /></motion.span>
                            </button>
                            <AnimatePresence initial={false}>
                                {open === i && (
                                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                                        <p className="max-w-2xl pb-6 text-[17px] leading-8 text-pencil">{a}</p>
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
        <section className="px-4 py-16 sm:px-8 sm:py-24">
            <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-[#0d1d4a] px-6 py-20 text-center text-white sm:px-12 sm:py-28">
                <div className="relative">
                    <h2 className="mx-auto max-w-3xl font-display text-[clamp(2.4rem,6vw,4.4rem)] leading-[0.98] font-extrabold tracking-[-0.04em] text-white">Your hospital could be running on it tomorrow.</h2>
                    <p className="mx-auto mt-6 max-w-xl text-lg text-white/70">Create your hospital and we set up departments, wards, common tests and medicines for you. Add your doctors and start booking.</p>
                    <Link to="/register" className="group mt-10 inline-flex h-14 items-center gap-2 rounded-full bg-white px-8 text-[17px] font-bold text-ink-deep transition hover:bg-ink-50">
                        Create your hospital<Icon name="arrowRight" size={20} className="transition group-hover:translate-x-1" />
                    </Link>
                </div>
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
                    <p className="mt-3 max-w-xs text-pencil">Hospital management for hospitals, clinics and diagnostic centres.</p>
                    <p className="mt-4 text-sm text-pencil">A product of <a href="https://www.ferasolution.com" className="font-bold text-graphite hover:text-ink">Fera Solution</a></p>
                </div>
                {[
                    ['Product', [['#modules', 'Features'], ['#journey', 'How it works'], ['#pricing', 'Pricing'], ['#faq', 'FAQ']]],
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
