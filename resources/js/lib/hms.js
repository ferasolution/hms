// Shared labels and helpers for the hospital screens.

export const ROLE_LABEL = {
    admin: 'Admin', doctor: 'Doctor', nurse: 'Nurse', receptionist: 'Front desk', pharmacist: 'Pharmacist',
    lab_technician: 'Lab technician', accountant: 'Accounts', patient: 'Patient', super_admin: 'Owner',
};

export const TYPE_LABEL = { hospital: 'Hospital', clinic: 'Clinic', diagnostic: 'Diagnostic centre' };

export const APPT_STATUS = {
    scheduled: ['Scheduled', 'draft'],
    checked_in: ['Waiting', 'warning'],
    in_progress: ['With doctor', 'published'],
    completed: ['Completed', 'success'],
    cancelled: ['Cancelled', 'neutral'],
    no_show: ['No-show', 'danger'],
};

export const APPT_TYPES = { consultation: 'Consultation', follow_up: 'Follow-up', telemedicine: 'Video visit', procedure: 'Procedure' };

export const INVOICE_STATUS = { unpaid: ['Unpaid', 'danger'], partial: ['Part paid', 'warning'], paid: ['Paid', 'success'], void: ['Void', 'neutral'] };

export const LAB_STATUS = { ordered: ['Awaiting sample', 'warning'], collected: ['Sample collected', 'draft'], completed: ['Reported', 'success'], cancelled: ['Cancelled', 'neutral'] };

export const RX_STATUS = { pending: ['To dispense', 'warning'], partial: ['Part dispensed', 'draft'], dispensed: ['Dispensed', 'success'], cancelled: ['Cancelled', 'neutral'] };

export const FLAG_TONE = { normal: 'success', high: 'warning', low: 'warning', critical: 'danger' };

export const BED_STATUS = {
    available: ['Free', 'bg-leaf-50 text-leaf ring-leaf/25'],
    occupied: ['Occupied', 'bg-ink text-white ring-ink'],
    cleaning: ['Cleaning', 'bg-amber-50 text-amber-800 ring-amber-600/25'],
    maintenance: ['Out of service', 'bg-paper text-pencil ring-rule'],
};

export const WARD_TYPES = { general: 'General', private: 'Private', semi_private: 'Semi-private', icu: 'ICU', emergency: 'Emergency', maternity: 'Maternity', pediatric: 'Pediatric' };

export const PAY_METHODS = { cash: 'Cash', card: 'Card', bank: 'Bank transfer', insurance: 'Insurance', online: 'Online' };

export const CHARGE_CATEGORIES = { consultation: 'Consultation', lab: 'Laboratory', radiology: 'Radiology', pharmacy: 'Pharmacy', room: 'Room & bed', procedure: 'Procedure', other: 'Other' };

export const SHIFTS = { morning: 'Morning', evening: 'Evening', night: 'Night', on_call: 'On call' };

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export const WEEKDAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Local date as YYYY-MM-DD. */
export const today = (offsetDays = 0) => {
    const d = new Date(Date.now() + offsetDays * 86400000);
    return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export function shortDate(d, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
    if (!d) return '';
    const date = typeof d === 'string' && d.length === 10 ? new Date(`${d}T00:00:00`) : new Date(d);
    return date.toLocaleDateString(undefined, opts);
}

export function time(d) {
    if (!d) return '';
    return new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function patientLine(p) {
    if (!p) return '';
    return [p.mrn, p.age != null ? `${p.age} y` : null, p.gender ? p.gender[0].toUpperCase() : null].filter(Boolean).join(' · ');
}

export const VITALS = [
    ['bp', 'BP', 'mmHg', 'text'], ['pulse', 'Pulse', 'bpm'], ['temperature', 'Temp', '°F'], ['spo2', 'SpO₂', '%'],
    ['respiration', 'Resp.', '/min'], ['weight', 'Weight', 'kg'], ['height', 'Height', 'cm'], ['sugar', 'Sugar', 'mg/dL'],
];

/** YYYY-MM-DD of an ISO timestamp in the browser's time zone. */
export function localDay(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
