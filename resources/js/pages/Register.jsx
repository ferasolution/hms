import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, session } from '../lib/api';
import Icon from '../components/Icon';
import AuthShell, { AsideList } from '../components/AuthShell';
import { Button, Field } from '../components/ui';

export const INSTITUTE_TYPES = [
    { value: 'hospital', icon: 'hospital', title: 'Hospital', text: 'OPD, wards and beds, pharmacy, lab and billing.' },
    { value: 'clinic', icon: 'stethoscope', title: 'Clinic or practice', text: 'Appointments, consultations, prescriptions and bills.' },
    { value: 'diagnostic', icon: 'flask', title: 'Diagnostic centre', text: 'Lab and imaging orders, results and billing.' },
];

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export default function Register() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const preset = INSTITUTE_TYPES.some((t) => t.value === params.get('type')) ? params.get('type') : null;

    const [step, setStep] = useState(preset ? 2 : 1);
    const [form, setForm] = useState({
        type: preset ?? 'hospital', institute_name: '', slug: '', name: '', email: '', password: '', password_confirmation: '',
    });
    const [slugTouched, setSlugTouched] = useState(false);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [showPass, setShowPass] = useState(false);

    const set = (key) => (e) => {
        const value = e.target.value;
        setForm((f) => ({ ...f, [key]: value, ...(key === 'institute_name' && !slugTouched ? { slug: slugify(value) } : {}) }));
    };

    async function submit(e) {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const res = await api('register-hospital', { method: 'POST', body: { ...form, hospital_name: form.institute_name, password_confirmation: form.password, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
            session.save(res.tenant.slug, res.token);
            navigate(`/${res.tenant.slug}`);
        } catch (err) {
            setError(err);
        } finally {
            setBusy(false);
        }
    }

    const type = INSTITUTE_TYPES.find((t) => t.value === form.type);

    return (
        <AuthShell aside={<AsideList title="Your hospital, online in a few minutes." items={[
            'Your own sign-in page for staff and patients',
            'Patient records, appointments, wards, pharmacy, lab and billing',
            'Departments, beds, tests and medicines set up for you',
            '14 days free. No card needed.',
        ]} />}>
            <p className="text-sm font-bold text-pencil">Step {step} of 2</p>

            {step === 1 && (
                <div>
                    <h1 className="mt-2 text-3xl font-extrabold">What are you setting up?</h1>
                    <p className="mt-2 text-pencil">This shapes your dashboard. You can add features later.</p>
                    <div className="mt-8 grid gap-3">
                        {INSTITUTE_TYPES.map((t) => (
                            <button key={t.value} type="button" onClick={() => { setForm({ ...form, type: t.value }); setStep(2); }}
                                className="group flex items-center gap-4 rounded-xl border border-rule bg-white p-4 text-left transition hover:border-ink hover:shadow-[0_8px_24px_-16px_rgba(18,40,95,.5)]">
                                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-ink-50 text-ink transition group-hover:bg-ink group-hover:text-white">
                                    <Icon name={t.icon} size={24} />
                                </span>
                                <span className="flex-1">
                                    <span className="block text-lg font-bold text-ink-deep">{t.title}</span>
                                    <span className="block text-pencil">{t.text}</span>
                                </span>
                                <Icon name="arrowRight" className="text-pencil transition group-hover:translate-x-0.5 group-hover:text-ink" />
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {step === 2 && (
                <form onSubmit={submit} noValidate>
                    <button type="button" onClick={() => setStep(1)} className="mt-2 inline-flex items-center gap-2 rounded-full bg-ink-50 py-1 pr-3 pl-1.5 text-sm font-bold text-ink-deep hover:bg-ink/10">
                        <span className="grid h-6 w-6 place-items-center rounded-full bg-ink text-white"><Icon name={type.icon} size={14} /></span>
                        {type.title}
                        <span className="font-normal text-pencil">Change</span>
                    </button>
                    <h1 className="mt-4 text-3xl font-extrabold">Create your hospital</h1>

                    {error && !Object.keys(error.errors).length && (
                        <p className="mt-4 rounded-lg bg-margin/5 px-3 py-2 text-margin" role="alert">{error.message}</p>
                    )}

                    <div className="mt-8 space-y-5">
                        <Field label="Hospital or clinic name" name="institute_name" error={error} value={form.institute_name} onChange={set('institute_name')}
                            placeholder={form.type === 'clinic' ? 'e.g. Riverside Family Clinic' : form.type === 'diagnostic' ? 'e.g. Precision Diagnostics' : 'e.g. Mercy General Hospital'} autoFocus />

                        <Field label="Your address" name="slug" error={error} hint="Lowercase letters, numbers and dashes. This is where your people sign in.">
                            <div className="flex h-11 items-center overflow-hidden rounded-lg border border-rule bg-white transition focus-within:border-ink focus-within:ring-4 focus-within:ring-ink/10">
                                <span className="flex h-full items-center border-r border-rule bg-paper px-3 text-sm whitespace-nowrap text-pencil">{window.location.host}/</span>
                                <input aria-label="Your address" className="h-full w-full min-w-0 bg-transparent px-3 font-bold text-ink-deep focus:outline-none" value={form.slug}
                                    onChange={(e) => { setSlugTouched(true); setForm({ ...form, slug: slugify(e.target.value) }); }} />
                            </div>
                        </Field>

                        <div className="border-t border-rule pt-5">
                            <p className="mb-4 font-bold text-graphite">Your admin account</p>
                            <div className="space-y-5">
                                <Field label="Full name" name="name" error={error} value={form.name} onChange={set('name')} autoComplete="name" />
                                <Field label="Email" name="email" type="email" error={error} value={form.email} onChange={set('email')} autoComplete="email" />
                                <Field label="Password" name="password" error={error} hint="At least 8 characters.">
                                    <div className="relative">
                                        <input aria-label="Password" type={showPass ? 'text' : 'password'} value={form.password} onChange={set('password')} autoComplete="new-password"
                                            className="h-11 w-full rounded-lg border border-rule bg-white pr-12 pl-3 focus:border-ink focus:ring-4 focus:ring-ink/10 focus:outline-none" />
                                        <button type="button" onClick={() => setShowPass((s) => !s)} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-pencil hover:text-ink"
                                            aria-label={showPass ? 'Hide password' : 'Show password'}>
                                            <Icon name={showPass ? 'eyeOff' : 'eye'} size={18} />
                                        </button>
                                    </div>
                                </Field>
                            </div>
                        </div>

                        <Button type="submit" size="lg" className="w-full" busy={busy}>{busy ? 'Setting up your hospital' : 'Create hospital'}</Button>
                        <p className="text-center text-sm text-pencil">Already have one? <Link to="/login" className="font-bold text-ink hover:underline">Sign in</Link></p>
                    </div>
                </form>
            )}
        </AuthShell>
    );
}
