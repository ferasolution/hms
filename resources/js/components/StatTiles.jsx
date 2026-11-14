import { motion } from 'motion/react';
import { Link } from 'react-router-dom';

const COLS = { 1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4', 5: 'md:grid-cols-5' };

/** A row of animated KPI tiles. tone: ink | danger | warning | success */
export default function StatTiles({ items, className = '' }) {
    const tones = {
        ink: 'from-white to-white',
        danger: 'from-red-50 to-white ring-red-200',
        warning: 'from-amber-50 to-white ring-amber-200',
        success: 'from-emerald-50 to-white ring-emerald-200',
    };
    return (
        <div className={`grid grid-cols-2 gap-3 ${COLS[Math.min(items.filter(Boolean).length, 5)]} ${className}`}>
            {items.filter(Boolean).map((t, i) => {
                const body = (
                    <>
                        <p className="text-sm font-semibold text-pencil">{t.label}</p>
                        <p className="mt-1 font-display text-2xl font-extrabold tracking-tight text-ink-deep tabular-nums">{t.value ?? '—'}</p>
                        {t.sub && <p className="mt-0.5 text-xs text-pencil">{t.sub}</p>}
                    </>
                );
                return (
                    <motion.div key={t.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
                        className={`rounded-2xl bg-gradient-to-b p-4 ring-1 ring-rule ${tones[t.tone ?? 'ink']}`}>
                        {t.to ? <Link to={t.to} className="block">{body}</Link> : body}
                    </motion.div>
                );
            })}
        </div>
    );
}
