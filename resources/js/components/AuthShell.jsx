import { motion, useReducedMotion } from 'motion/react';
import { Logo } from './ui';
import Icon from './Icon';

// Split layout for sign-up, sign-in and setup pages: a living aurora panel on
// the left (desktop only) and the form on the right.
export default function AuthShell({ aside, children }) {
    const reduce = useReducedMotion();
    return (
        <div className="min-h-screen lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <aside className="relative hidden overflow-hidden bg-[#04161c] text-white lg:block">
                <div className="pointer-events-none absolute inset-0" aria-hidden>
                    <div className="absolute -top-32 -left-20 h-[30rem] w-[30rem] rounded-full bg-[#0d9488]/45 blur-[110px] animate-[aurora_14s_ease-in-out_infinite]" />
                    <div className="absolute -right-24 bottom-0 h-[26rem] w-[26rem] rounded-full bg-[#0891b2]/35 blur-[110px] animate-[aurora_18s_ease-in-out_infinite_reverse]" />
                    <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.4) 1px, transparent 1px)', backgroundSize: '26px 26px', maskImage: 'radial-gradient(ellipse 80% 70% at 30% 40%, black, transparent)' }} />
                </div>
                <div className="relative flex h-full flex-col justify-between p-12">
                    <Logo light />
                    <motion.div initial={reduce ? false : { opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }} className="max-w-md">
                        {aside}
                        <div className="mt-12 w-72 rounded-2xl bg-white/[.07] p-4 ring-1 ring-white/15 backdrop-blur-xl animate-[float_7s_ease-in-out_infinite]" aria-hidden>
                            <div className="flex items-center gap-2 text-xs font-semibold text-white/60"><Icon name="activity" size={14} />Live vitals · Ward B</div>
                            <svg viewBox="0 0 200 50" className="mt-2 h-12 w-full">
                                <motion.path d="M0 30 H60 L70 30 L76 10 L84 46 L92 4 L100 36 L106 30 H150 L156 30 L160 22 L166 38 L170 30 H200" fill="none" stroke="#5eead4" strokeWidth="2.5" strokeLinejoin="round"
                                    initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2, repeat: reduce ? 0 : Infinity, repeatDelay: 0.6, ease: 'easeInOut' }} />
                            </svg>
                            <div className="mt-1 flex justify-between text-sm"><span>HR <b>76</b></span><span>SpO₂ <b>98%</b></span><span>BP <b>118/76</b></span></div>
                        </div>
                    </motion.div>
                    <p className="text-sm text-white/45">A product of Fera Solution</p>
                </div>
            </aside>
            <main className="flex min-h-screen flex-col px-5 py-8 sm:px-10">
                <div className="lg:hidden"><Logo /></div>
                <div className="flex flex-1 items-center justify-center py-10">
                    <motion.div initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
                        className="w-full max-w-md rounded-[1.75rem] bg-white p-6 shadow-[0_30px_70px_-35px_rgba(10,47,58,.45)] ring-1 ring-black/[.04] sm:p-9">
                        {children}
                    </motion.div>
                </div>
            </main>
        </div>
    );
}

export function AsideList({ title, items }) {
    return (
        <>
            <h2 className="font-display text-[2.6rem] leading-[1.08] font-extrabold tracking-[-0.03em] text-white">{title}</h2>
            <ul className="mt-8 space-y-4">
                {items.map((item, i) => (
                    <motion.li key={item} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.1 }} className="flex gap-3 text-[16px] text-white/75">
                        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#2dd4bf]/20 text-[#5eead4]"><Icon name="check" size={14} strokeWidth={3} /></span>
                        {item}
                    </motion.li>
                ))}
            </ul>
        </>
    );
}
