import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../../lib/api';
import { money } from '../../lib/format';
import { DISPOSITIONS, minutes, PAY_METHODS, today, TRIAGE } from '../../lib/hms';
import StatTiles from '../../components/StatTiles';
import { Button, EmptyState, PageHeader, Skeleton, useToast } from '../../components/ui';
import { download } from './Store';

const SECTIONS = [
    ['overview', 'Overview'], ['opd', 'Outpatients'], ['inpatients', 'Inpatients'], ['emergency', 'Emergency'],
    ['lab', 'Lab turnaround'], ['pharmacy', 'Pharmacy'], ['revenue', 'Revenue'], ['diagnoses', 'Top diagnoses'],
];
const PRESETS = [['This month', () => [today().slice(0, 8) + '01', today()]], ['Last 7 days', () => [today(-6), today()]], ['Last 30 days', () => [today(-29), today()]], ['This year', () => [today().slice(0, 5) + '01-01', today()]]];

export default function Reports() {
    const { tenant } = useOutletContext();
    const toast = useToast();
    const [section, setSection] = useState('overview');
    const [[from, to], setRange] = useState(PRESETS[0][1]());
    const [d, setD] = useState(null);

    useEffect(() => {
        setD(null);
        api(`reports/${section}?from=${from}&to=${to}`, { tenant }).then(setD).catch((e) => toast(e.message, 'error'));
    }, [tenant, section, from, to, toast]);

    const cur = d?.currency ?? 'USD';

    return (
        <div>
            <PageHeader title="Reports" description="Hospital performance for any date range. Every table downloads as CSV." />
            <div className="mt-6 flex flex-wrap items-center gap-2">
                {PRESETS.map(([l, fn]) => <button key={l} type="button" onClick={() => setRange(fn())} className="rounded-full bg-white px-3 py-1.5 text-sm font-bold text-graphite ring-1 ring-rule hover:ring-ink/30">{l}</button>)}
                <input type="date" aria-label="From" value={from} max={to} onChange={(e) => e.target.value && setRange([e.target.value, to])} className="h-10 rounded-lg border border-rule bg-white px-3" />
                <span className="text-pencil">→</span>
                <input type="date" aria-label="To" value={to} min={from} onChange={(e) => e.target.value && setRange([from, e.target.value])} className="h-10 rounded-lg border border-rule bg-white px-3" />
                {section !== 'overview' && <Button className="ml-auto" variant="secondary" icon="download" onClick={() => download(`reports/${section}?from=${from}&to=${to}&format=csv`, tenant, `${section}-${from}-${to}.csv`).catch((e) => toast(e.message, 'error'))}>CSV</Button>}
            </div>
            <div className="mt-5 grid gap-6 lg:grid-cols-[13rem_1fr]">
                <nav aria-label="Report" className="flex gap-1 overflow-x-auto lg:flex-col">
                    {SECTIONS.map(([k, l]) => (
                        <button key={k} type="button" onClick={() => setSection(k)} aria-current={section === k}
                            className={`relative whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm font-bold ${section === k ? 'text-white' : 'text-graphite hover:bg-white'}`}>
                            {section === k && <motion.span layoutId="report-pick" className="absolute inset-0 rounded-xl bg-ink-deep" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                            <span className="relative">{l}</span>
                        </button>
                    ))}
                </nav>
                <div className="min-w-0">
                    {!d ? <Skeleton className="h-72 rounded-2xl" /> : <Section section={section} d={d} cur={cur} />}
                </div>
            </div>
        </div>
    );
}

function Bars({ rows, label, value, format = (v) => v }) {
    const max = Math.max(1, ...rows.map((r) => Number(r[value]) || 0));
    return (
        <ul className="space-y-2.5">
            {rows.map((r, i) => (
                <li key={i}>
                    <div className="flex justify-between gap-3 text-sm"><span className="truncate text-graphite">{r[label]}</span><b className="tabular-nums">{format(r[value])}</b></div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-paper"><motion.div initial={{ width: 0 }} animate={{ width: `${((Number(r[value]) || 0) / max) * 100}%` }} transition={{ delay: i * 0.03, duration: 0.5 }} className="h-full rounded-full bg-gradient-to-r from-ink to-teal-500" /></div>
                </li>
            ))}
        </ul>
    );
}

function Table({ rows, cols }) {
    if (!rows?.length) return <EmptyState icon="chart" title="No data for these dates" />;
    return (
        <div className="overflow-x-auto rounded-2xl border border-rule bg-white">
            <table className="w-full text-left text-sm">
                <thead className="bg-paper text-pencil"><tr>{cols.map(([k, l, num]) => <th key={k} className={`p-3 ${num ? 'text-right' : ''}`}>{l}</th>)}</tr></thead>
                <tbody className="divide-y divide-rule">
                    {rows.map((r, i) => <tr key={i}>{cols.map(([k, , num, fmt]) => <td key={k} className={`p-3 ${num ? 'text-right tabular-nums' : 'text-graphite'}`}>{fmt ? fmt(r[k], r) : (r[k] ?? '—')}</td>)}</tr>)}
                </tbody>
            </table>
        </div>
    );
}

function Card({ title, children }) {
    return <section className="rounded-2xl border border-rule bg-white p-5"><h3 className="mb-4 text-sm font-bold text-graphite">{title}</h3>{children}</section>;
}

function Section({ section, d, cur }) {
    const m = (v) => money(v, cur);
    switch (section) {
        case 'overview': {
            const k = d.kpis;
            return (
                <div className="space-y-4">
                    <StatTiles items={[{ label: 'New patients', value: k.new_patients }, { label: 'OPD visits', value: k.opd_visits }, { label: 'Admissions', value: k.admissions }, { label: 'Discharges', value: k.discharges }]} />
                    <StatTiles items={[{ label: 'Emergency visits', value: k.er_visits }, { label: 'Lab orders', value: k.lab_orders }, { label: 'Bed occupancy now', value: k.occupancy != null ? `${k.occupancy}%` : '—' }]} />
                    <StatTiles items={[{ label: 'Collected', value: m(k.collected), tone: 'success' }, { label: 'Expenses', value: m(k.expenses) }, { label: 'Net', value: m(k.net), tone: k.net < 0 ? 'danger' : 'ink' }]} />
                </div>
            );
        }
        case 'opd':
            return (
                <div className="space-y-4">
                    <StatTiles items={[{ label: 'Booked', value: d.totals.booked }, { label: 'Seen', value: d.totals.seen, tone: 'success' }, { label: 'No-show rate', value: `${d.totals.no_show_rate}%`, tone: d.totals.no_show_rate > 10 ? 'warning' : 'ink' }]} />
                    {Object.keys(d.by_day ?? {}).length > 0 && <Card title="Visits per day"><Bars rows={Object.entries(d.by_day).map(([day, n]) => ({ day, n }))} label="day" value="n" /></Card>}
                    <Table rows={d.rows} cols={[['doctor', 'Doctor'], ['department', 'Department'], ['booked', 'Booked', 1], ['seen', 'Seen', 1], ['no_show', 'No-show', 1], ['cancelled', 'Cancelled', 1]]} />
                </div>
            );
        case 'inpatients':
            return (
                <div className="space-y-4">
                    <StatTiles items={[{ label: 'Admissions', value: d.totals.admissions }, { label: 'Discharges', value: d.totals.discharges }, { label: 'In hospital now', value: d.totals.in_hospital_now }, { label: 'Average stay', value: d.totals.average_stay_days != null ? `${d.totals.average_stay_days} d` : '—' }, { label: 'Mortality', value: `${d.totals.mortality_rate}%`, tone: d.totals.mortality_rate > 0 ? 'warning' : 'ink' }]} />
                    <Table rows={d.rows} cols={[['ward', 'Ward'], ['discharges', 'Discharges', 1], ['average_stay_days', 'Avg. stay (days)', 1], ['deaths', 'Deaths', 1], ['lama', 'LAMA', 1]]} />
                </div>
            );
        case 'emergency':
            return (
                <div className="space-y-4">
                    <StatTiles items={[{ label: 'Visits', value: d.totals.visits }, { label: 'Left without being seen', value: d.totals.left_without_being_seen, tone: d.totals.left_without_being_seen ? 'warning' : 'ink' }]} />
                    <div className="grid gap-4 md:grid-cols-2">
                        <Card title="Outcomes"><Bars rows={Object.entries(d.dispositions ?? {}).map(([k, n]) => ({ k: DISPOSITIONS[k] ?? k, n }))} label="k" value="n" /></Card>
                        <Card title="How patients arrived"><Bars rows={Object.entries(d.arrival_modes ?? {}).map(([k, n]) => ({ k: { walk_in: 'Walk-in', ambulance: 'Ambulance', referral: 'Referral', police: 'Police', other: 'Other' }[k] ?? k, n }))} label="k" value="n" /></Card>
                    </div>
                    <Table rows={d.rows} cols={[['triage_level', 'Triage', 0, (v) => <span className={`inline-grid h-7 w-7 place-items-center rounded-lg text-xs font-bold ${TRIAGE[v][1]}`}>{v}</span>], ['visits', 'Visits', 1], ['average_minutes_in_department', 'Avg. time in ER', 1, (v) => minutes(v)], ['admitted', 'Admitted', 1]]} />
                </div>
            );
        case 'lab':
            return (
                <div className="space-y-4">
                    <StatTiles items={[{ label: 'Orders', value: d.totals.orders }, { label: 'Tests', value: d.totals.tests }, { label: 'Urgent / STAT', value: d.totals.urgent }]} />
                    <Table rows={d.rows} cols={[['test', 'Test'], ['count', 'Ordered', 1], ['reported', 'Reported', 1], ['average_turnaround_hours', 'Avg. turnaround (h)', 1, (v) => v ?? '—'], ['critical', 'Critical', 1]]} />
                </div>
            );
        case 'pharmacy':
            return (
                <div className="space-y-4">
                    <StatTiles items={[{ label: 'Units dispensed', value: d.totals.units }, { label: 'Value dispensed', value: m(d.totals.value) }]} />
                    {d.rows.length > 0 && <Card title="Top medicines by value"><Bars rows={d.rows.slice(0, 10)} label="medicine" value="value" format={m} /></Card>}
                    <Table rows={d.rows} cols={[['medicine', 'Medicine'], ['units', 'Units', 1], ['value', 'Value', 1, m]]} />
                </div>
            );
        case 'revenue':
            return (
                <div className="space-y-4">
                    <StatTiles items={[{ label: 'Billed', value: m(d.totals.billed) }, { label: 'Collected', value: m(d.totals.collected), tone: 'success' }]} />
                    <div className="grid gap-4 md:grid-cols-2">
                        <Card title="Billed by category"><Bars rows={d.rows} label="category" value="billed" format={m} /></Card>
                        <Card title="Collected by method"><Bars rows={Object.entries(d.by_method ?? {}).map(([k, v]) => ({ k: PAY_METHODS[k] ?? k, v }))} label="k" value="v" format={m} /></Card>
                    </div>
                </div>
            );
        case 'diagnoses':
            return d.rows.length ? <Card title="Most common diagnoses"><Bars rows={d.rows.map((r) => ({ ...r, label: `${r.diagnosis}${r.icd_code ? ` · ${r.icd_code}` : ''}` }))} label="label" value="cases" /></Card> : <EmptyState icon="chart" title="No diagnoses recorded for these dates" />;
        default:
            return null;
    }
}
