import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { patientLine } from '../lib/hms';
import Icon from './Icon';
import { Avatar } from './ui';

/** Search patients by name, MRN or phone and pick one. */
export default function PatientPicker({ tenant, value, onChange, label = 'Patient', error }) {
    const [q, setQ] = useState('');
    const [rows, setRows] = useState([]);

    useEffect(() => {
        if (q.trim().length < 2) { setRows([]); return undefined; }
        const t = setTimeout(() => api(`patients?search=${encodeURIComponent(q.trim())}`, { tenant }).then((r) => setRows(r.data.slice(0, 8))).catch(() => {}), 200);
        return () => clearTimeout(t);
    }, [q, tenant]);

    if (value) {
        return (
            <div>
                <p className="mb-1.5 text-sm font-bold text-graphite">{label}</p>
                <div className="flex items-center gap-3 rounded-lg bg-ink-50 px-3 py-2">
                    <Avatar name={value.name} size={32} />
                    <span className="min-w-0 flex-1"><b className="text-graphite">{value.name}</b> <span className="text-sm text-pencil">{patientLine(value)}</span></span>
                    <button type="button" className="text-sm font-bold text-ink" onClick={() => onChange(null)}>Change</button>
                </div>
            </div>
        );
    }

    return (
        <div>
            <label className="mb-1.5 block text-sm font-bold text-graphite">
                {label}
                <span className="relative mt-1.5 block">
                    <Icon name="search" size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-pencil" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, MRN or phone" autoComplete="off"
                        className="h-11 w-full rounded-lg border border-rule bg-white pr-3 pl-10 font-normal focus:border-ink focus:ring-4 focus:ring-ink/10 focus:outline-none" />
                </span>
            </label>
            {rows.length > 0 && (
                <ul className="mt-1 max-h-64 divide-y divide-rule overflow-y-auto rounded-lg border border-rule bg-white">
                    {rows.map((p) => (
                        <li key={p.id}>
                            <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-paper" onClick={() => { onChange(p); setQ(''); }}>
                                <Avatar name={p.name} size={28} />
                                <span><b>{p.name}</b> <span className="text-sm text-pencil">· {patientLine(p)}{p.phone ? ` · ${p.phone}` : ''}</span></span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {q.trim().length >= 2 && rows.length === 0 && <p className="mt-1.5 text-sm text-pencil">No patient found. Register them first on the Patients page.</p>}
            {error && <p className="mt-1.5 text-sm text-margin">{error}</p>}
        </div>
    );
}
