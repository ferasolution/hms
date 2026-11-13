import { useEffect, useState } from 'react';
import { Navigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { api, upload } from '../lib/api';
import { applyBrand, BRANDS } from '../lib/brand';
import { CURRENCIES } from '../lib/format';
import Icon from '../components/Icon';
import { Button, Field, FileDrop, PageHeader, Tabs, useToast } from '../components/ui';
import { ActivityTab, ModulesTab } from './hospital/AdminTabs';

export default function Settings() {
    const { tenant, isAdmin, me, refresh } = useOutletContext();
    const toast = useToast();
    const [params, setParams] = useSearchParams();
    const tab = params.get('tab') ?? 'hospital';
    const s = me.tenant.settings ?? {};

    const [form, setForm] = useState(() => ({
        name: me.tenant.name,
        brand: s.brand ?? 'ink',
        logo_url: s.logo_url ?? '',
        welcome_message: s.welcome_message ?? '',
        support_email: s.support_email ?? '',
        support_phone: s.support_phone ?? '',
        currency: s.currency ?? 'USD',
        address: s.address ?? '',
        emergency_phone: s.emergency_phone ?? '',
        registration_no: s.registration_no ?? '',
        tax_id: s.tax_id ?? '',
        invoice_footer: s.invoice_footer ?? '',
        timezone: s.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    }));
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState(null);

    // Undo an unsaved colour preview when leaving the page.
    const savedBrand = s.brand ?? 'ink';
    useEffect(() => () => applyBrand(savedBrand), [savedBrand]);

    if (!isAdmin) return <Navigate to={`/${tenant}`} replace />;

    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
    const pickBrand = (key) => { setForm((f) => ({ ...f, brand: key })); applyBrand(key); };

    async function onLogo(file) {
        setUploading(true);
        setUploadError(null);
        try {
            const r = await upload(file, 'image', tenant);
            setForm((f) => ({ ...f, logo_url: r.url }));
        } catch (err) {
            setUploadError(err.message);
        } finally {
            setUploading(false);
        }
    }

    async function save(e) {
        e?.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await api('settings', {
                method: 'PATCH', tenant, body: {
                    name: form.name,
                    settings: {
                        brand: form.brand,
                        logo_url: form.logo_url || null,
                        welcome_message: form.welcome_message || null,
                        support_email: form.support_email || null,
                        support_phone: form.support_phone || null,
                        currency: form.currency,
                        address: form.address || null,
                        emergency_phone: form.emergency_phone || null,
                        registration_no: form.registration_no || null,
                        tax_id: form.tax_id || null,
                        invoice_footer: form.invoice_footer || null,
                        timezone: form.timezone || null,
                    },
                },
            });
            await refresh();
            toast('Settings saved');
        } catch (err) {
            setError(err);
            toast(err.message, 'error');
        } finally {
            setBusy(false);
        }
    }

    const err = (k) => error?.errors?.[`settings.${k}`]?.[0] ?? error?.errors?.[`settings.payments.${k}`]?.[0];

    return (
        <form onSubmit={save} noValidate className="pb-24">
            <PageHeader title="Settings" description="Your hospital’s details, bills, look and modules." />

            <Tabs className="mt-8" value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} tabs={[
                { value: 'hospital', label: 'Hospital', icon: 'hospital' },
                { value: 'bills', label: 'Bills & receipts', icon: 'receipt' },
                { value: 'branding', label: 'Branding', icon: 'palette' },
                { value: 'modules', label: 'Modules', icon: 'grid' },
                { value: 'activity', label: 'Activity log', icon: 'clock' },
            ]} />

            <div className="mt-6 max-w-3xl space-y-6">
                {tab === 'hospital' && (
                    <Card>
                        <Field label="Hospital name" name="name" error={error} value={form.name} onChange={set('name')} />
                        <Field label="Welcome message on your sign-in page" value={form.welcome_message} onChange={set('welcome_message')} error={err('welcome_message')}
                            placeholder="e.g. OPD hours: Mon–Sat, 9am–5pm" maxLength={300} />
                        <div className="grid gap-5 sm:grid-cols-2">
                            <Field label="Front desk phone" value={form.support_phone} onChange={set('support_phone')} error={err('support_phone')} placeholder="+1 555 123 4567" />
                            <Field label="Emergency phone" value={form.emergency_phone} onChange={set('emergency_phone')} error={err('emergency_phone')} />
                            <Field label="Email" type="email" value={form.support_email} onChange={set('support_email')} error={err('support_email')} />
                            <Field label="Time zone" value={form.timezone} onChange={set('timezone')} error={err('timezone')} placeholder="America/New_York" hint="Appointment times use this." />
                        </div>
                        <Field label="Address" as="textarea" rows={2} value={form.address} onChange={set('address')} error={err('address')} hint="Printed on bills and receipts." />
                        <div className="rounded-xl bg-paper p-4 text-sm text-pencil">
                            Staff and patients sign in at <strong className="text-graphite">{window.location.host}/{tenant}/login</strong>
                        </div>
                    </Card>
                )}

                {tab === 'bills' && (
                    <Card description="How bills and receipts look when printed.">
                        <Field label="Currency" hint="Used for every bill and price.">
                            <select value={form.currency} onChange={set('currency')} className="h-11 w-full rounded-lg border border-rule bg-white px-3 focus:border-ink focus:outline-none sm:w-60">
                                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </Field>
                        <div className="grid gap-5 sm:grid-cols-2">
                            <Field label="Registration / license no." value={form.registration_no} onChange={set('registration_no')} error={err('registration_no')} />
                            <Field label="Tax ID" value={form.tax_id} onChange={set('tax_id')} error={err('tax_id')} hint="Printed on bills." />
                        </div>
                        <Field label="Footer note" as="textarea" rows={2} value={form.invoice_footer} onChange={set('invoice_footer')} error={err('invoice_footer')} placeholder="e.g. Thank you for choosing us. Get well soon!" />
                    </Card>
                )}

                {tab === 'branding' && (
                    <>
                        <Card title="Logo">
                            <FileDrop kind="image" value={form.logo_url} uploading={uploading} error={uploadError ?? err('logo_url')}
                                onUpload={onLogo} onClear={() => setForm((f) => ({ ...f, logo_url: '' }))} hint="Square or wide PNG with a transparent background works best." />
                        </Card>
                        <Card title="Colour" description="Used for buttons, links and highlights across your hospital. Changes preview instantly.">
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                {Object.entries(BRANDS).map(([key, b]) => (
                                    <button key={key} type="button" onClick={() => pickBrand(key)} aria-pressed={form.brand === key}
                                        className={`flex items-center gap-3 rounded-xl border-2 p-3 text-left transition ${form.brand === key ? 'border-ink' : 'border-rule hover:border-ink/30'}`}>
                                        <span className="flex h-10 w-10 shrink-0 overflow-hidden rounded-lg">
                                            <span className="flex-1" style={{ background: b.ink }} />
                                            <span className="w-3" style={{ background: b.deep }} />
                                        </span>
                                        <span className="font-bold text-graphite">{b.label}</span>
                                        {form.brand === key && <Icon name="check" size={18} className="ml-auto text-ink" strokeWidth={2.6} />}
                                    </button>
                                ))}
                            </div>
                            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rule bg-paper p-4">
                                <Button type="button" size="sm">Primary button</Button>
                                <Button type="button" size="sm" variant="secondary">Secondary</Button>
                                <span className="font-bold text-ink">A link</span>
                                <span className="h-2 w-28 overflow-hidden rounded-full bg-ink-50"><span className="block h-full w-2/3 bg-ink" /></span>
                            </div>
                        </Card>
                    </>
                )}

                {tab === 'modules' && <ModulesTab tenant={tenant} me={me} refresh={refresh} />}
                {tab === 'activity' && <ActivityTab tenant={tenant} />}

            </div>

            {!['modules', 'activity'].includes(tab) && <div className="fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-white/95 backdrop-blur lg:left-[17rem]">
                <div className="mx-auto flex max-w-6xl items-center justify-end gap-3 px-4 py-3 sm:px-8 lg:px-12">
                    <Button type="submit" busy={busy} icon="check">Save settings</Button>
                </div>
            </div>}
        </form>
    );
}

function Card({ title, description, children }) {
    return (
        <section className="space-y-5 rounded-2xl border border-rule bg-white p-5 sm:p-6">
            {(title || description) && (
                <div>
                    {title && <h2 className="text-lg font-bold">{title}</h2>}
                    {description && <p className="mt-1 text-pencil">{description}</p>}
                </div>
            )}
            {children}
        </section>
    );
}
