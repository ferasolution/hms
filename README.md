# Fera HospitalOS — Hospital ERP, HIS & EHR (SaaS)

Multi-tenant Hospital Management System for hospitals, clinics and diagnostic centres.
Laravel 13 API + React SPA, deployed to `hms.ferasolution.com`. Set up the same way as
Fera EduSphere (LMS) and the CMS portal.

## Modules

| Module | What it does |
|---|---|
| Patients (EMR) | Registration with automatic MRN, allergies, conditions, insurance, emergency contact, full chart |
| Appointments | Doctor schedules and free slots, walk-ins with tokens, check-in, waiting room, video visits |
| Consultations (OPD) | Vitals, complaints, examination, diagnosis + ICD-10, plan, follow-up; prescription and test orders in the same note |
| Inpatients (IPD) | Wards and beds, live bed board, admit / transfer / discharge with summary, automatic room charges |
| Pharmacy | Medicine stock with batch and expiry, stock movements, prescription queue, dispensing against stock |
| Lab & imaging | Test catalogue and prices, orders by priority, sample collection, results with flags and attachments |
| Billing | Bills fill themselves (consultation, lab, pharmacy, room), manual charges, payments, receipts, discounts, void |
| Insurance | Claims per bill: submitted → approved / rejected → paid (records the payment) |
| Staff & roster | Departments, doctor profiles and clinic hours, weekly duty roster |
| Patient portal | Patients see visits, prescriptions, results and bills, and book free slots online |
| Owner console | Every hospital, plans and plan payments, users, password resets, support sign-in, activity, system health |

Each module except Patients can be switched off per hospital (Settings → Modules).

## Roles

`super_admin` (platform owner, no tenant) · `admin` · `doctor` · `nurse` · `receptionist` ·
`pharmacist` · `lab_technician` · `accountant` · `patient`

## How tenancy works

- One database. Every hospital-owned table has a `tenant_id`, and the `BelongsToTenant`
  trait scopes all queries to the current hospital automatically.
- The current hospital is resolved by `ResolveTenant` from, in order:
  1. a subdomain of `TENANCY_CENTRAL_DOMAIN` (`mercy.hms.ferasolution.com`, needs wildcard DNS)
  2. a tenant's `custom_domain`
  3. the `X-Tenant` header (what the SPA uses today: `hms.ferasolution.com/mercy`)
- The hospital's time zone (Settings) is applied to every request, so appointment times are
  the hospital's wall-clock time.
- New hospitals get starter departments, wards and beds, lab tests and common medicines.

## Plans

Free ($0: 5 staff, 10 beds) · Clinic ($99: 25 staff, 30 beds) · Hospital ($249: 150 staff, 200 beds) ·
Enterprise ($499: unlimited). Patients are unlimited on every plan. New hospitals get 14 days of
Enterprise free. Plans and prices are editable in the owner console.

## Local development

```bash
composer install
npm install
cp .env.example .env && php artisan key:generate
touch database/database.sqlite
php artisan migrate --seed
php artisan hms:super-admin you@example.com
npm run dev   # in one terminal
php artisan serve
```

## Deployment (GitHub Actions → Bluehost over FTPS)

Every push to `main` runs the tests, uploads the built app over FTPS (only changed files after
the first time), then calls `POST /api/deploy-hook` with the `DEPLOY_TOKEN`, which runs migrations,
seeds the plans and rebuilds Laravel's caches. No SSH or cPanel access is needed.

**First install (no terminal needed)**

1. PHP **8.3+** for the subdomain (cPanel → MultiPHP Manager); document root → its `public` folder.
2. Add the `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` secrets below and push (or re-run the workflow).
3. Open `https://hms.ferasolution.com/install`. Enter the `INSTALL_KEY` secret (or the FTP password if it is not set),
   the MySQL details and your owner account. The installer creates the tables, the owner and `.env`,
   then shows a **deploy token** once.
4. Save that token as the `DEPLOY_TOKEN` secret. Every later deploy runs migrations and rebuilds
   caches automatically. The installer is closed for good once `.env` exists.

**GitHub → Settings → Secrets and variables → Actions**

| Secret | Value |
|---|---|
| `FTP_SERVER` | `ftp.ferasolution.com` |
| `FTP_USERNAME` | the FTP account, e.g. `deploy@hms.ferasolution.com` |
| `FTP_PASSWORD` | its password |
| `INSTALL_KEY` | optional: a phrase you type on `/install` to prove you own the site (defaults to the FTP password) |
| `DEPLOY_TOKEN` | shown by the installer |
| `FTP_SERVER_DIR` | optional, only if the FTP home is not the subdomain folder (must end with `/`) |
