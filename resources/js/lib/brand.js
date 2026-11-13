// Hospital colour themes. The whole UI reads --color-ink*, so switching a
// theme is three CSS variables. Keys are kept stable (they are stored in settings).
export const BRANDS = {
    ink: { label: 'Clinical teal', ink: '#0e8a7e', deep: '#0a2f3a', tint: '#e5f5f2' },
    emerald: { label: 'Emerald', ink: '#15803d', deep: '#0c3320', tint: '#e8f6ed' },
    plum: { label: 'Violet', ink: '#6d4ad8', deep: '#241a4f', tint: '#f0ecfd' },
    teal: { label: 'Ocean blue', ink: '#1d6fd8', deep: '#0b2552', tint: '#e8f1fd' },
    maroon: { label: 'Rose', ink: '#c0265a', deep: '#41101f', tint: '#fdebf1' },
    slate: { label: 'Graphite', ink: '#334155', deep: '#0f172a', tint: '#eef2f6' },
};

export function applyBrand(key) {
    const b = BRANDS[key] ?? BRANDS.ink;
    const root = document.documentElement.style;
    root.setProperty('--color-ink', b.ink);
    root.setProperty('--color-ink-deep', b.deep);
    root.setProperty('--color-ink-50', b.tint);
}

export function resetBrand() {
    applyBrand('ink');
}
