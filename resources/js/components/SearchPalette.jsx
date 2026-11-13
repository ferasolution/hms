import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { ROLE_LABEL } from '../lib/hms';
import Icon from './Icon';

/** Ctrl/Cmd+K: jump to a page, patient or staff member. */
export default function SearchPalette({ open, onClose, tenant, pages }) {
    const navigate = useNavigate();
    const [q, setQ] = useState('');
    const [res, setRes] = useState(null);
    const [active, setActive] = useState(0);
    const input = useRef(null);

    useEffect(() => {
        if (open) { setQ(''); setRes(null); setActive(0); setTimeout(() => input.current?.focus(), 10); }
    }, [open]);

    useEffect(() => {
        if (!open || q.trim().length < 2) { setRes(null); return; }
        const t = setTimeout(() => api(`search?q=${encodeURIComponent(q.trim())}`, { tenant }).then(setRes).catch(() => setRes(null)), 180);
        return () => clearTimeout(t);
    }, [q, open, tenant]);

    const items = useMemo(() => {
        const term = q.trim().toLowerCase();
        const pageItems = pages.filter((p) => !term || p.label.toLowerCase().includes(term))
            .map((p) => ({ group: 'Go to', icon: p.icon, label: p.label, to: p.to }));
        if (!res) return pageItems;
        return [
            ...pageItems,
            ...res.patients.map((p) => ({ group: 'Patients', icon: 'user', label: p.name, sub: [p.mrn, p.age != null ? `${p.age} y` : null, p.phone].filter(Boolean).join(' · '), to: `/${tenant}/patients/${p.id}` })),
            ...res.staff.map((p) => ({ group: 'Staff', icon: 'stethoscope', label: p.name, sub: ROLE_LABEL[p.role] ?? p.role, to: `/${tenant}/staff` })),
        ];
    }, [pages, q, res, tenant]);

    useEffect(() => setActive(0), [items.length]);

    if (!open) return null;

    function go(item) {
        onClose();
        navigate(item.to);
    }

    function onKey(e) {
        if (e.key === 'Escape') onClose();
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
        if (e.key === 'Enter' && items[active]) go(items[active]);
    }

    let lastGroup = null;

    return (
        <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search">
            <div className="absolute inset-0 bg-ink-deep/30 backdrop-blur-[2px]" onClick={onClose} />
            <div className="relative w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl animate-[pop_.12s_ease-out]">
                <div className="flex items-center gap-3 border-b border-rule px-4">
                    <Icon name="search" size={20} className="text-pencil" />
                    <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search patients by name, MRN or phone…"
                        aria-label="Search" className="h-14 flex-1 bg-transparent text-lg text-graphite placeholder:text-pencil/70 focus:outline-none" />
                    <kbd className="rounded-md border border-rule px-1.5 py-0.5 text-xs text-pencil">Esc</kbd>
                </div>
                <ul className="max-h-[50vh] overflow-y-auto py-2" role="listbox">
                    {items.length === 0 && <li className="px-4 py-8 text-center text-pencil">{q.trim().length < 2 ? 'Type to search' : 'Nothing found'}</li>}
                    {items.map((item, i) => {
                        const header = item.group !== lastGroup;
                        lastGroup = item.group;
                        return (
                            <li key={`${item.group}-${item.to}-${i}`} role="option" aria-selected={i === active}>
                                {header && <p className="px-4 pt-3 pb-1 text-xs font-bold text-pencil">{item.group}</p>}
                                <button type="button" onMouseEnter={() => setActive(i)} onClick={() => go(item)}
                                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${i === active ? 'bg-ink-50' : ''}`}>
                                    <Icon name={item.icon} size={18} className="text-ink" />
                                    <span className="min-w-0 flex-1 truncate text-graphite">{item.label}</span>
                                    {item.sub && <span className="truncate text-sm text-pencil">{item.sub}</span>}
                                    {i === active && <Icon name="arrowRight" size={16} className="text-pencil" />}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
}
