import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/inter';
import { lazy, StrictMode, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from './components/ui';
import Register from './pages/Register';
import FindInstitute from './pages/FindInstitute';
import Login from './pages/Login';
import TenantLayout from './pages/TenantLayout';
import Overview from './pages/Overview';
import People from './pages/People';
import Patients from './pages/hospital/Patients';
import PatientChart from './pages/hospital/PatientChart';
import Appointments from './pages/hospital/Appointments';
import Inpatients from './pages/hospital/Inpatients';
import Pharmacy from './pages/hospital/Pharmacy';
import Lab from './pages/hospital/Lab';
import Invoices, { InvoiceDetail } from './pages/hospital/Invoices';
import Staff from './pages/hospital/Staff';
import Insurance from './pages/hospital/Insurance';
import Emergency from './pages/hospital/Emergency';
import Nursing from './pages/hospital/Nursing';
import Store from './pages/hospital/Store';
import Hr from './pages/hospital/Hr';
import Finance from './pages/hospital/Finance';
import Reports from './pages/hospital/Reports';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import { PlatformLogin } from './pages/Platform';
import ConsoleLayout from './pages/platform/ConsoleLayout';
import ConsoleOverview from './pages/platform/ConsoleOverview';
import { ConsoleTenant, ConsoleTenants } from './pages/platform/ConsoleTenants';
import { ConsoleActivity, ConsoleHealth, ConsolePayments, ConsoleSettings, ConsoleSubscriptions, ConsoleUsers } from './pages/platform/ConsoleMore';
import Billing from './pages/Billing';
import { ConsoleAnnouncements, ConsolePlans } from './pages/platform/ConsolePlans';

// The marketing page carries animation libraries; app pages don't need them.
const Landing = lazy(() => import('./pages/Landing'));
import PlatformSetup from './pages/PlatformSetup';
import Install from './pages/Install';

const TITLES = { '/': 'Fera HospitalOS', '/register': 'Create your hospital', '/login': 'Sign in', '/install': 'Install' };

function ScrollAndTitle() {
    const { pathname, hash } = useLocation();
    useEffect(() => {
        if (!hash) window.scrollTo(0, 0);
        const last = pathname.split('/').filter(Boolean).pop();
        const section = { patients: 'Patients', appointments: 'Appointments', inpatients: 'Inpatients', pharmacy: 'Pharmacy', lab: 'Lab & imaging', staff: 'Staff', people: 'People', login: 'Sign in', payments: 'Payments', settings: 'Settings', profile: 'Profile', platform: 'Owner console', billing: 'Billing', insurance: 'Insurance', subscription: 'Plan', hospitals: 'Hospitals', subscriptions: 'Plan payments', users: 'Users', activity: 'Activity', health: 'System health' }[last];
        document.title = TITLES[pathname] ?? (section ? `${section} · Fera HospitalOS` : 'Fera HospitalOS');
    }, [pathname, hash]);
    return null;
}

function App() {
    return (
        <BrowserRouter>
            <ToastProvider>
                <ScrollAndTitle />
                <Routes>
                    <Route path="/" element={<Suspense fallback={<div className="min-h-screen bg-[#0d1d4a]" />}><Landing /></Suspense>} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/login" element={<FindInstitute />} />
                    <Route path="/install" element={<Install />} />
                    <Route path="/platform/setup" element={<PlatformSetup />} />
                    <Route path="/platform/login" element={<PlatformLogin />} />
                    <Route path="/platform" element={<ConsoleLayout />}>
                        <Route index element={<ConsoleOverview />} />
                        <Route path="hospitals" element={<ConsoleTenants />} />
                        <Route path="hospitals/:id" element={<ConsoleTenant />} />
                        <Route path="subscriptions" element={<ConsoleSubscriptions />} />
                        <Route path="payments" element={<ConsolePayments />} />
                        <Route path="users" element={<ConsoleUsers />} />
                        <Route path="plans" element={<ConsolePlans />} />
                        <Route path="announcements" element={<ConsoleAnnouncements />} />
                        <Route path="activity" element={<ConsoleActivity />} />
                        <Route path="health" element={<ConsoleHealth />} />
                        <Route path="settings" element={<ConsoleSettings />} />
                    </Route>
                    <Route path="/:tenant/login" element={<Login />} />
                    <Route path="/:tenant" element={<TenantLayout />}>
                        <Route index element={<Overview />} />
                        <Route path="patients" element={<Patients />} />
                        <Route path="patients/:id" element={<PatientChart />} />
                        <Route path="appointments" element={<Appointments />} />
                        <Route path="inpatients" element={<Inpatients />} />
                        <Route path="pharmacy" element={<Pharmacy />} />
                        <Route path="lab" element={<Lab />} />
                        <Route path="billing" element={<Invoices />} />
                        <Route path="billing/:id" element={<InvoiceDetail />} />
                        <Route path="staff" element={<Staff />} />
                        <Route path="insurance" element={<Insurance />} />
                        <Route path="emergency" element={<Emergency />} />
                        <Route path="nursing" element={<Nursing />} />
                        <Route path="store" element={<Store />} />
                        <Route path="hr" element={<Hr />} />
                        <Route path="finance" element={<Finance />} />
                        <Route path="reports" element={<Reports />} />
                        <Route path="my-health" element={<Navigate to=".." relative="path" replace />} />
                        <Route path="people" element={<People />} />
                        <Route path="settings" element={<Settings />} />
                        <Route path="subscription" element={<Billing />} />
                        <Route path="profile" element={<Profile />} />
                    </Route>
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </ToastProvider>
        </BrowserRouter>
    );
}

createRoot(document.getElementById('app')).render(
    <StrictMode>
        <App />
    </StrictMode>,
);

// Installable on phones (Add to Home Screen).
if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
