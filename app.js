/* Omnisoft Gym v2 — vanilla JS + Supabase, mobile-first */
(() => {
'use strict';

const CFG = window.APP_CONFIG || {};
const app = document.getElementById('app');
const NOT_CONFIGURED = !CFG.key || CFG.key.includes('ΒΑΛΤΕ');
const sb = NOT_CONFIGURED ? null : window.supabase.createClient(CFG.url, CFG.key);
const st = { user: null, memberships: [], cur: null, isAdmin: false, charts: [], timers: [], cleanup: [] };

// =====================================================================
// Βοηθητικά
// =====================================================================
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const num = v => (v === '' || v == null || isNaN(+String(v).replace(',', '.'))) ? null : +String(v).replace(',', '.');
const fmtNum = v => v == null || v === '' ? '' : (+v % 1 === 0 ? String(+v) : (+v).toFixed(1).replace('.', ','));
const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoOf(new Date());
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d); };
// Όλες οι ημερομηνίες σε μορφή ηη/μμ/εεεε
const fmtDate = v => { if (!v) return '–'; const s = String(v).slice(0, 10).split('-'); return `${s[2]}/${s[1]}/${s[0]}`; };
const DAYS = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
const MONTHS = ['Ιανουάριος','Φεβρουάριος','Μάρτιος','Απρίλιος','Μάιος','Ιούνιος','Ιούλιος','Αύγουστος','Σεπτέμβριος','Οκτώβριος','Νοέμβριος','Δεκέμβριος'];
const fmtDateDay = v => v ? `${DAYS[new Date(v + 'T12:00:00').getDay()]} ${fmtDate(v)}` : '';
const relDays = d => d == null ? 'ποτέ' : d === 0 ? 'σήμερα' : d === 1 ? 'χθες' : `πριν ${d} ημ.`;
const fmtTime = s => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } },
                set(k, v) { try { localStorage.setItem(k, v); } catch {} },
                del(k) { try { localStorage.removeItem(k); } catch {} } };
const isStaff = m => !!(m && (m.is_owner || m.is_coach) && m.gym_status === 'active');
const e1rm = (w, r) => (w && r) ? w * (1 + r / 30) : 0;

function toast(msg, err) {
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), err ? 5000 : 2400);
}
async function q(promise) {
  const { data, error } = await promise;
  if (error) { console.error(error); toast(friendly(error.message), true); throw error; }
  return data;
}
function friendly(m) {
  if (/Invalid login/i.test(m)) return 'Λάθος email ή κωδικός';
  if (/Email not confirmed/i.test(m)) return 'Το email δεν έχει επιβεβαιωθεί';
  if (/row-level security/i.test(m)) return 'Δεν έχετε δικαίωμα για αυτή την ενέργεια';
  if (/duplicate key/i.test(m)) return 'Υπάρχει ήδη εγγραφή με αυτά τα στοιχεία';
  return m;
}
function clearTimers() {
  st.timers.forEach(t => clearInterval(t)); st.timers = []; $('.rest-bar')?.remove();
  (st.cleanup || []).forEach(f => { try { f(); } catch {} }); st.cleanup = [];
}
const money = v => (+v || 0).toLocaleString('el-GR', { style: 'currency', currency: 'EUR' });
const SUB = { active: ['b-ok', 'Ενεργή'], expiring: ['b-warn', 'Λήγει σύντομα'], expired: ['b-bad', 'Ληγμένη'],
              none: ['b-muted', 'Χωρίς συνδρομή'], frozen: ['b-info', 'Σε πάγωμα'] };
const METHOD = { cash: 'Μετρητά', card: 'Κάρτα', iris: 'IRIS', bank: 'Κατάθεση', other: 'Άλλο' };
function subLine(s) {
  if (!s || s.status === 'none') return 'Χωρίς συνδρομή';
  const parts = [s.plan_name || s.plan];
  if (s.visits_left != null) parts.push(`${s.visits_left} επισκέψεις`);
  if (s.end_date) parts.push(`έως ${fmtDate(s.end_date)}`);
  return parts.filter(Boolean).join(' · ');
}
function qrSvg(text, size = 220) {
  if (!window.qrcode) return '<p class="muted">Δεν φορτώθηκε η βιβλιοθήκη QR</p>';
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  return qr.createSvgTag({ cellSize: Math.max(2, Math.floor(size / (qr.getModuleCount() + 8))), margin: 4, scalable: true })
    .replace('<svg ', `<svg style="width:${size}px;height:${size}px;max-width:100%" `);
}
const nfcSupported = () => 'NDEFReader' in window;
async function readNfc(onSerial) {
  const r = new NDEFReader(), ctrl = new AbortController();
  await r.scan({ signal: ctrl.signal });
  r.onreading = e => onSerial((e.serialNumber || '').replace(/:/g, '').toUpperCase());
  return () => ctrl.abort();
}
function destroyCharts() { st.charts.forEach(c => c.destroy()); st.charts = []; }

// Εικονίδια (SVG γραμμής)
const IC = {
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkSq: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4"/>',
  clip: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h6"/>',
  dumbbell: '<path d="M6.5 6.5 17.5 17.5M21 21l-1-1M3 3l1 1M18 22l4-4M2 6l4-4M3 10l7-7M14 21l7-7"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  play: '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
  up: '<path d="m18 15-6-6-6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15zM20 17v5H6.5A2.5 2.5 0 0 1 4 19.5"/>',
  timer: '<path d="M10 2h4M12 14l3-3"/><circle cx="12" cy="14" r="8"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h3v-3"/>',
  nfc: '<path d="M6 8.32a7.43 7.43 0 0 1 0 7.36M9.46 6.21a11.76 11.76 0 0 1 0 11.58M12.91 4.1a15.91 15.91 0 0 1 .01 15.8M16.37 2a20.16 20.16 0 0 1 0 20"/>',
  flip: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>',
  euro: '<path d="M4 10h12M4 14h9M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2"/>'
};
const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || ''}</svg>`;

function avatar(name, cls = '') {
  let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  const ini = String(name).trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return `<div class="avatar ${cls}" style="background:hsl(${h} 55% 45%)">${esc(ini)}</div>`;
}
function applyTheme(m) {
  const r = document.documentElement.style;
  r.setProperty('--brand', (m && m.primary_color) || '#d71920');
  r.setProperty('--brand-2', (m && m.secondary_color) || '#111111');
}

// Πεδίο ημερομηνίας που δείχνει πάντα ηη/μμ/εεεε (με το native ημερολόγιο από κάτω)
function dateField(id, value) {
  return `<label class="date-field" for="${id}">${icon('checkSq', 'sm')}<span data-show="${id}">${fmtDate(value)}</span>
    <input type="date" id="${id}" value="${value || ''}"></label>`;
}
function bindDate(id, onChange) {
  const el = document.getElementById(id); if (!el) return;
  el.addEventListener('click', () => { try { el.showPicker(); } catch {} });
  el.onchange = () => { $(`[data-show="${id}"]`).textContent = fmtDate(el.value); onChange && onChange(el.value); };
}

// Bottom sheet (αντί για alert/prompt/confirm)
function sheet(title, html, onMount) {
  const bg = document.createElement('div'); bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(title)}"><div class="grip"></div>
    <div class="row between nowrap"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Κλείσιμο">${icon('x')}</button></div>${html}</div>`;
  const close = () => bg.remove();
  bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  document.body.appendChild(bg);
  onMount && onMount($('.sheet', bg), close);
  return close;
}
function confirmSheet(title, text, okLabel, onOk, danger) {
  sheet(title, `<p>${esc(text)}</p><div class="row"><button class="btn ${danger ? 'danger' : ''} grow" data-ok>${esc(okLabel)}</button>
    <button class="btn secondary grow" data-close>Άκυρο</button></div>`, (el, close) => {
    $('[data-ok]', el).onclick = async () => { close(); await onOk(); };
  });
}
function showExercise(name, code, sub) {
  sheet(name, `<div class="center">${Stickman.svg(code, true)}</div><p class="muted center">${esc(sub || '')}</p>`);
}

const metricLabel = { reps_weight: 'Επαναλήψεις & κιλά', reps: 'Επαναλήψεις', time: 'Χρόνος', distance: 'Απόσταση' };
const statusInfo = {
  increase: ['b-ok', 'Αύξηση'], hold: ['b-muted', 'Ίδια κιλά'], deload: ['b-warn', 'Επιστροφή'],
  decrease: ['b-bad', 'Μείωση'], stall: ['b-warn', 'Στασιμότητα'], new: ['b-info', 'Νέα']
};
function targetText(pe) {
  if (pe.target_seconds) return `${pe.sets} × ${pe.target_seconds}″`;
  const r = pe.reps_min && pe.reps_max && pe.reps_min !== pe.reps_max ? `${pe.reps_min}–${pe.reps_max}` : (pe.reps_max || pe.reps_min || '');
  return `${pe.sets} × ${r}${pe.target_weight ? ` · ${fmtNum(pe.target_weight)} κ.` : ''}`;
}

// =====================================================================
// Είσοδος / εγγραφή
// =====================================================================
function renderConfigMissing() {
  app.innerHTML = `<div class="auth-wrap"><div class="auth-card"><h1>Ρύθμιση</h1>
    <p>Λείπει το publishable key στο <code>config.js</code>.</p></div></div>`;
}
function authLogo() {
  return `<div class="row nowrap"><div class="logo">${icon('dumbbell')}</div><div><b>Omnisoft Gym</b>
    <div class="muted small">Προγράμματα · πρόοδος · παρουσίες</div></div></div>`;
}
function renderAuth(mode = 'login') {
  applyTheme(null);
  const titles = { login: 'Σύνδεση', signup: 'Νέος λογαριασμός', reset: 'Επαναφορά κωδικού' };
  app.innerHTML = `<div class="auth-wrap"><form class="auth-card" id="authForm">${authLogo()}
    <h1>${titles[mode]}</h1>
    <div class="field"><label>Email</label><input type="email" name="email" required autocomplete="email" inputmode="email"></div>
    ${mode !== 'reset' ? `<div class="field"><label>Κωδικός</label><input type="password" name="password" required minlength="6"
        autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"></div>` : ''}
    <button class="btn block">${titles[mode]}</button>
    <div class="row between small" style="margin-top:16px">
      ${mode !== 'login' ? `<button type="button" class="link-btn" data-mode="login">Έχω λογαριασμό</button>` :
        `<button type="button" class="link-btn" data-mode="signup">Νέος λογαριασμός</button>
         <button type="button" class="link-btn" data-mode="reset">Ξέχασα τον κωδικό</button>`}
    </div>
    ${mode === 'signup' ? `<p class="muted small">Αθλητές και προπονητές: χρησιμοποιήστε το email που έχει δηλώσει το γυμναστήριό σας.
       Ιδιοκτήτες: μετά την εγγραφή δηλώνετε το γυμναστήριό σας.</p>` : ''}
  </form></div>`;
  $$('[data-mode]').forEach(b => b.onclick = () => renderAuth(b.dataset.mode));
  $('#authForm').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target), email = f.get('email').trim(), password = f.get('password');
    const btn = $('button.btn', e.target); btn.disabled = true;
    const redirectTo = location.origin + location.pathname;
    try {
      if (mode === 'login') await q(sb.auth.signInWithPassword({ email, password }));
      else if (mode === 'signup') {
        const d = await q(sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } }));
        if (!d.session) { toast('Στάλθηκε email επιβεβαίωσης'); renderAuth('login'); }
      } else { await q(sb.auth.resetPasswordForEmail(email, { redirectTo })); toast('Στάλθηκε email επαναφοράς'); renderAuth('login'); }
    } catch {} finally { btn.disabled = false; }
  };
}

async function loadMe() {
  const [ms, adm, lib] = await Promise.all([
    q(sb.rpc('my_memberships')),
    q(sb.from('platform_admins').select('user_id').eq('user_id', st.user.id)),
    q(sb.from('exercise_library').select('code, motion'))
  ]);
  st.memberships = ms; st.isAdmin = adm.length > 0;
  Stickman.setMap(Object.fromEntries(lib.map(l => [l.code, l.motion])));
  const saved = store.get('gym_member');
  st.cur = ms.find(m => m.member_id === saved) || ms.find(m => m.gym_status === 'active') || ms[0] || null;
}

function renderRegisterGym() {
  applyTheme(null);
  app.innerHTML = `<div class="auth-wrap"><form class="auth-card" id="regForm">${authLogo()}
    <h1>Εγγραφή γυμναστηρίου</h1>
    <p class="muted small">Ο λογαριασμός <b>${esc(st.user.email)}</b> δεν είναι συνδεδεμένος με γυμναστήριο.
      Αθλητές και προπονητές: ζητήστε από το γυμναστήριο να σας καταχωρήσει με αυτό το email.</p>
    <div class="field"><label>Όνομα γυμναστηρίου</label><input name="gym" required></div>
    <div class="field"><label>Ονοματεπώνυμο ιδιοκτήτη</label><input name="owner" required></div>
    <div class="form-grid"><div class="field"><label>Πόλη</label><input name="city"></div>
      <div class="field"><label>Τηλέφωνο</label><input name="phone" type="tel"></div></div>
    <button class="btn block">Αποστολή αίτησης</button>
    <p class="small center" style="margin-top:14px"><button type="button" class="link-btn" id="logout">Αποσύνδεση</button></p>
  </form></div>`;
  $('#logout').onclick = () => sb.auth.signOut();
  $('#regForm').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    try { await q(sb.rpc('register_gym', { p_gym_name: f.get('gym'), p_owner_name: f.get('owner'),
            p_city: f.get('city') || null, p_phone: f.get('phone') || null }));
          toast('Η αίτηση στάλθηκε'); await start(); } catch {}
  };
}
function renderPending() {
  app.innerHTML = `<div class="auth-wrap"><div class="auth-card">${authLogo()}<h1>${esc(st.cur.gym_name)}</h1>
    <p><span class="badge ${st.cur.gym_status === 'pending' ? 'b-warn' : 'b-bad'}">${st.cur.gym_status === 'pending' ? 'Σε αναμονή έγκρισης' : 'Σε αναστολή'}</span></p>
    <p class="muted">Θα μπορείτε να χρησιμοποιήσετε την εφαρμογή μόλις ενεργοποιηθεί το γυμναστήριο.</p>
    <button class="btn secondary block" id="logout">Αποσύνδεση</button></div></div>`;
  $('#logout').onclick = () => sb.auth.signOut();
}

// =====================================================================
// Κέλυφος & πλοήγηση
// =====================================================================
function tabsFor(m) {
  const t = [], active = m && m.gym_status === 'active';
  if (isStaff(m)) {
    t.push(['athletes', 'Αθλητές', 'users'], ['checkin', 'Check-in', 'scan']);
    if (m.is_owner) t.push(['subs', 'Συνδρομές', 'wallet']);
    t.push(['attendance', 'Παρουσίες', 'checkSq'], ['programs', 'Προγράμματα', 'clip'], ['exercises', 'Ασκήσεις', 'dumbbell'], ['members', 'Μέλη', 'card']);
  }
  if (m && m.is_athlete && active) {
    if (isStaff(m)) t.push(['today', 'Η προπόνησή μου', 'play'], ['card', 'Η κάρτα μου', 'qr']);
    else t.push(['today', 'Προπόνηση', 'play'], ['history', 'Ιστορικό', 'clock'], ['progress', 'Πρόοδος', 'trend'], ['card', 'Κάρτα', 'qr']);
  }
  if (m && m.is_owner && active) t.push(['settings', 'Ρυθμίσεις', 'cog']);
  if (st.isAdmin) t.push(['admin', 'Διαχείριση', 'shield']);
  return t;
}
function shell() {
  const m = st.cur; applyTheme(m);
  const role = m ? [m.is_owner && 'Ιδιοκτήτης', m.is_coach && 'Προπονητής', m.is_athlete && 'Αθλητής'].filter(Boolean).join(' · ') : 'Διαχειριστής';
  const name = m ? m.gym_name : 'Omnisoft Gym';
  const ini = name.split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
  const tabs = tabsFor(m), main = tabs.slice(0, tabs.length > 5 ? 4 : 5), extra = tabs.length > 5 ? tabs.slice(4) : [];
  app.innerHTML = `
    <header class="topbar"><div class="logo">${m && m.logo_url ? `<img src="${esc(m.logo_url)}" alt="">` : esc(ini)}</div>
      <div class="title grow">${esc(name)}<small>${esc(m ? m.full_name : st.user.email)} · ${esc(role)}</small></div>
      ${st.memberships.length > 1 ? `<select id="gymSel" aria-label="Γυμναστήριο">${st.memberships.map(x =>
        `<option value="${x.member_id}" ${x.member_id === m?.member_id ? 'selected' : ''}>${esc(x.gym_name)}</option>`).join('')}</select>` : ''}
      <button class="icon-btn" id="logout" title="Αποσύνδεση" aria-label="Αποσύνδεση">${icon('logout')}</button></header>
    <nav class="tabs">${tabs.map(([k, l, i]) => `<a href="#/${k}" data-k="${k}">${icon(i, 'sm')}${l}</a>`).join('')}</nav>
    <main id="view"></main>
    <nav class="bottomnav">${main.map(([k, l, i]) => `<a href="#/${k}" data-k="${k}">${icon(i)}<span>${l}</span></a>`).join('')}
      ${extra.length ? `<button id="moreBtn" data-k="__more">${icon('more')}<span>Περισσότερα</span></button>` : ''}</nav>`;
  $('#logout').onclick = () => confirmSheet('Αποσύνδεση', 'Θέλετε να αποσυνδεθείτε;', 'Αποσύνδεση', () => sb.auth.signOut());
  const gs = $('#gymSel');
  if (gs) gs.onchange = () => { store.set('gym_member', gs.value); st.cur = st.memberships.find(x => x.member_id === gs.value); shell(); route(); };
  const mb = $('#moreBtn');
  if (mb) mb.onclick = () => sheet('Περισσότερα', extra.map(([k, l, i]) =>
    `<a class="card tap list-item" style="text-decoration:none;color:inherit" href="#/${k}" data-close>${icon(i)}<b>${l}</b></a>`).join(''));
  st.extraKeys = extra.map(t => t[0]);
}

const routes = {};
const PARENT = { athlete: 'athletes', program: 'programs', log: 'athletes' };
async function route() {
  destroyCharts(); clearTimers(); $$('.sheet-bg').forEach(x => x.remove());
  const tabs = tabsFor(st.cur);
  let [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const staffOnly = PARENT[name] && isStaff(st.cur);
  const athleteExtra = ['history', 'progress'].includes(name) && st.cur?.is_athlete;
  if (!routes[name] || (!tabs.find(t => t[0] === name) && !staffOnly && !athleteExtra)) {
    name = tabs[0] ? tabs[0][0] : 'admin';
    if (location.hash !== '#/' + name) history.replaceState(null, '', '#/' + name);
  }
  const key = PARENT[name] || name;
  $$('.tabs a, .bottomnav a').forEach(a => a.classList.toggle('active', a.dataset.k === key));
  $('#moreBtn')?.classList.toggle('active', (st.extraKeys || []).includes(key));
  const view = $('#view'); view.innerHTML = '<p class="muted">Φόρτωση…</p>';
  window.scrollTo(0, 0);
  try { await routes[name](view, arg); } catch (e) { console.error(e); view.innerHTML = `<div class="card">Σφάλμα: ${esc(e.message || e)}</div>`; }
}
window.addEventListener('hashchange', () => { if (st.user && $('#view')) route(); });

// =====================================================================
// Κοινά δεδομένα
// =====================================================================
async function loadProgram(programId) {
  const p = await q(sb.from('programs').select(`id, name, goal, athlete_id, is_template, sessions_per_week, active, notes,
    program_days(id, day_no, name, program_exercises(id, sort_order, sets, reps_min, reps_max, target_weight, target_seconds,
      rest_seconds, notes, exercise_id, exercises(name, animation_code, metric_type, muscle_group, increment_kg)))`).eq('id', programId).single());
  p.program_days.sort((a, b) => a.day_no - b.day_no);
  p.program_days.forEach(d => d.program_exercises.sort((a, b) => a.sort_order - b.sort_order));
  return p;
}
async function activeProgramId(athleteId) {
  const r = await q(sb.from('programs').select('id').eq('athlete_id', athleteId).eq('active', true).order('start_date', { ascending: false }).limit(1));
  return r[0]?.id || null;
}
async function gymExercises(all) {
  let x = sb.from('exercises').select('id, name, muscle_group, metric_type, animation_code, active, increment_kg').eq('gym_id', st.cur.gym_id)
    .order('muscle_group').order('name');
  if (!all) x = x.eq('active', true);
  return q(x);
}
function groupBy(arr, fn) { const m = new Map(); arr.forEach(x => { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return m; }

// =====================================================================
// Προπονητής: αθλητές
// =====================================================================
routes.athletes = async view => {
  const g = st.cur.gym_id;
  const [rows, flags, week, subs] = await Promise.all([
    q(sb.from('v_athlete_status').select('*').eq('gym_id', g).order('full_name')),
    q(sb.rpc('athlete_flags', { p_gym: g })),
    q(sb.from('workout_sessions').select('id').eq('gym_id', g).gte('performed_on', addDays(todayISO(), -6))),
    q(sb.rpc('sub_status', { p_gym: g }))
  ]);
  const F = Object.fromEntries(flags.map(f => [f.athlete_id, f])), SS = Object.fromEntries(subs.map(x => [x.member_id, x]));
  rows.forEach(r => {
    const f = F[r.athlete_id] || {};
    r.attention = (r.days_absent == null || r.days_absent > 10) || f.n_stall > 0 || f.n_decrease > 0;
    r.f = f; r.pct = r.planned_28d ? Math.min(100, Math.round(100 * r.workouts_28d / r.planned_28d)) : 0;
  });
  const today = rows.filter(r => r.days_absent === 0).length, attn = rows.filter(r => r.attention).length;
  let filter = 'all', search = '';
  view.innerHTML = `
    <div class="head-row"><h1>Αθλητές</h1><button class="btn small" id="addA">${icon('plus', 'sm')}Νέος</button></div>
    <div class="kpis"><div class="kpi accent"><b>${today}</b><span>προπονήθηκαν σήμερα</span></div>
      <div class="kpi"><b>${week.length}</b><span>προπονήσεις 7 ημ.</span></div>
      <div class="kpi"><b style="color:${attn ? 'var(--bad)' : 'inherit'}">${attn}</b><span>θέλουν προσοχή</span></div></div>
    <div class="search">${icon('search', 'sm')}<input id="q" placeholder="Αναζήτηση αθλητή"></div>
    <div class="chips" id="flt">
      <button class="chip active" data-f="all">Όλοι <span class="badge b-muted">${rows.length}</span></button>
      <button class="chip" data-f="attn">Θέλουν προσοχή <span class="badge b-bad">${attn}</span></button>
      <button class="chip" data-f="today">Σήμερα <span class="badge b-ok">${today}</span></button>
    </div>
    <div class="grid cols-2" id="list"></div>`;
  const draw = () => {
    const list = rows.filter(r => (filter === 'all' || (filter === 'attn' && r.attention) || (filter === 'today' && r.days_absent === 0))
      && r.full_name.toLowerCase().includes(search));
    $('#list').innerHTML = list.map(r => {
      const d = r.days_absent, cls = d == null ? 'b-muted' : d > 21 ? 'b-bad' : d > 10 ? 'b-warn' : d === 0 ? 'b-ok' : 'b-muted';
      const tags = [];
      if (r.f.n_stall) tags.push(`<span class="badge b-warn">${icon('alert', 'sm')}Στασιμότητα</span>`);
      if (r.f.n_decrease) tags.push(`<span class="badge b-bad">Δυσκολεύεται</span>`);
      if (r.f.n_increase) tags.push(`<span class="badge b-ok">${icon('trend', 'sm')}Έτοιμος για αύξηση</span>`);
      const sb0 = SS[r.athlete_id];
      if (sb0 && sb0.status !== 'active') tags.push(`<span class="badge ${SUB[sb0.status][0]}">${icon('wallet', 'sm')}${SUB[sb0.status][1]}</span>`);
      if (sb0 && sb0.has_debt && st.cur.is_owner) tags.push(`<span class="badge b-bad">Οφειλή</span>`);
      return `<a class="card tap" href="#/athlete/${r.athlete_id}" style="text-decoration:none;color:inherit">
        <div class="list-item">${avatar(r.full_name)}<div class="grow"><div class="row between nowrap"><b class="ellipsis">${esc(r.full_name)}</b>
          <span class="badge ${cls}">${relDays(d)}</span></div>
          <div class="row nowrap small muted" style="margin-top:6px"><div class="meter grow"><i style="width:${r.pct}%;background:${r.pct >= 75 ? 'var(--ok)' : r.pct >= 50 ? 'var(--warn)' : 'var(--bad)'}"></i></div>
            <span>${r.workouts_28d}/${r.planned_28d || '–'} σε 4 εβδ.</span></div>
          ${tags.length ? `<div class="row" style="margin-top:8px;gap:6px">${tags.join('')}</div>` : ''}</div></div></a>`;
    }).join('') || '<div class="card empty">Κανένας αθλητής</div>';
  };
  $('#q').oninput = e => { search = e.target.value.toLowerCase(); draw(); };
  $$('#flt .chip').forEach(c => c.onclick = () => { filter = c.dataset.f; $$('#flt .chip').forEach(x => x.classList.toggle('active', x === c)); draw(); });
  $('#addA').onclick = () => memberSheet(null, async () => route());
  draw();
};

routes.athlete = async (view, id) => {
  const [m, sugg, pid, stat] = await Promise.all([
    q(sb.from('gym_members').select('*').eq('id', id).single()),
    q(sb.rpc('suggest_progression', { p_athlete: id })),
    activeProgramId(id),
    q(sb.from('v_athlete_status').select('*').eq('athlete_id', id))
  ]);
  const s0 = stat[0] || {}, pct = s0.planned_28d ? Math.round(100 * s0.workouts_28d / s0.planned_28d) : 0;
  const flagged = sugg.filter(s => ['deload', 'decrease', 'stall'].includes(s.status));
  let tab = 'sugg';
  view.innerHTML = `
    <p class="small"><a href="#/athletes" class="row nowrap" style="gap:2px;text-decoration:none">${icon('left', 'sm')}Αθλητές</a></p>
    <div class="card"><div class="list-item">${avatar(m.full_name, 'lg')}<div class="grow">
      <h1 style="margin:0">${esc(m.full_name)}</h1><div class="muted small">${esc(m.goal || 'Χωρίς στόχο')}</div></div></div>
      <div class="kpis" style="margin:14px 0 10px"><div class="kpi"><b>${s0.workouts_28d ?? 0}</b><span>προπονήσεις 4 εβδ.</span></div>
        <div class="kpi"><b>${pct}%</b><span>συνέπεια</span></div><div class="kpi"><b class="small" style="font-size:16px">${relDays(s0.days_absent)}</b><span>τελευταία φορά</span></div></div>
      <div class="row"><a class="btn grow" href="#/log/${id}">${icon('play', 'sm')}Καταγραφή προπόνησης</a>
        ${pid ? `<a class="btn secondary grow" href="#/program/${pid}">${icon('clip', 'sm')}Πρόγραμμα</a>`
              : `<button class="btn secondary grow" id="newProg">${icon('plus', 'sm')}Πρόγραμμα</button>`}</div></div>
    ${flagged.length ? `<div class="card" style="border-color:#fde68a;background:#fffbeb"><div class="row nowrap">${icon('alert')}<b>Χρειάζεται προσοχή</b></div>
      <div class="small" style="margin-top:6px">${[...new Map(flagged.map(f => [f.status, f])).values()].map(f =>
        `<div>• ${esc(f.reason)} <span class="muted">(${flagged.filter(x => x.status === f.status).length} ασκήσεις)</span></div>`).join('')}</div></div>` : ''}
    <div class="seg" id="seg"><button data-t="sugg" class="active">Επόμενη προπόνηση</button><button data-t="prog">Πρόοδος</button><button data-t="hist">Ιστορικό</button></div>
    <div id="tabc"></div>`;
  if (!pid) $('#newProg').onclick = () => createProgramFor(id);
  const draw = async () => {
    destroyCharts(); const el = $('#tabc');
    if (tab === 'sugg') el.innerHTML = suggList(sugg);
    if (tab === 'prog') await renderProgress(el, id);
    if (tab === 'hist') await renderHistory(el, id, 15);
  };
  $$('#seg button').forEach(b => b.onclick = () => { tab = b.dataset.t; $$('#seg button').forEach(x => x.classList.toggle('active', x === b)); draw(); });
  draw();
};

function suggList(sugg) {
  if (!sugg.length) return '<div class="card empty">Δεν υπάρχει ενεργό πρόγραμμα</div>';
  return [...groupBy(sugg, s => s.program_day)].map(([day, xs]) => `<h2>${esc(day)}</h2>
    <div class="card" style="padding:4px 14px">${xs.map((s, i) => { const [c, l] = statusInfo[s.status] || ['b-muted', s.status];
      return `<div class="row nowrap" style="padding:10px 0;${i ? 'border-top:1px solid var(--line)' : ''}"><div class="grow">
        <b>${esc(s.exercise_name)}</b><div class="small muted">${s.last_weight != null ? `Τελευταία: ${fmtNum(s.last_weight)} κ. × ${esc(s.last_reps)}` :
          s.last_reps ? `Τελευταία: ${esc(s.last_reps)}` : 'Δεν έχει γίνει ακόμα'}</div>
        <div class="small" style="margin-top:2px">${esc(s.reason)}</div></div>
        <div style="text-align:right">${s.suggested_weight != null ? `<b style="font-size:18px">${fmtNum(s.suggested_weight)}</b><span class="small"> κ.</span><br>` : ''}
          <span class="badge ${c}">${l}</span></div></div>`; }).join('')}</div>`).join('');
}

// =====================================================================
// Προγράμματα
// =====================================================================
async function createProgramFor(athleteId) {
  const templates = await q(sb.from('programs').select('id, name').eq('gym_id', st.cur.gym_id).eq('is_template', true).eq('active', true));
  sheet('Νέο πρόγραμμα', `<p class="muted small">Ξεκινήστε από πρότυπο ή από κενό πρόγραμμα.</p>
    ${templates.map(t => `<button class="card tap list-item" style="width:100%;text-align:left" data-t="${t.id}">${icon('clip')}<b class="grow">${esc(t.name)}</b>${icon('right', 'sm')}</button>`).join('')}
    <button class="btn secondary block" data-t="">${icon('plus', 'sm')}Κενό πρόγραμμα</button>`, (el, close) => {
    $$('[data-t]', el).forEach(b => b.onclick = async () => {
      close();
      const id = b.dataset.t ? await copyProgram(b.dataset.t, athleteId) :
        (await q(sb.from('programs').insert({ gym_id: st.cur.gym_id, athlete_id: athleteId, coach_id: st.cur.member_id,
          name: 'Νέο πρόγραμμα', sessions_per_week: 3 }).select('id').single())).id;
      location.hash = '#/program/' + id;
    });
  });
}
async function copyProgram(srcId, athleteId) {
  const src = await loadProgram(srcId);
  if (athleteId) await q(sb.from('programs').update({ active: false }).eq('athlete_id', athleteId).eq('active', true));
  const np = await q(sb.from('programs').insert({ gym_id: st.cur.gym_id, athlete_id: athleteId || null, coach_id: st.cur.member_id,
    is_template: !athleteId, name: athleteId ? src.name.replace(/^Πρότυπο:\s*/, '') : src.name + ' (πρότυπο)',
    goal: src.goal, sessions_per_week: src.sessions_per_week }).select('id').single());
  for (const d of src.program_days) {
    const nd = await q(sb.from('program_days').insert({ gym_id: st.cur.gym_id, program_id: np.id, day_no: d.day_no, name: d.name }).select('id').single());
    if (d.program_exercises.length) await q(sb.from('program_exercises').insert(d.program_exercises.map(pe => ({
      gym_id: st.cur.gym_id, program_day_id: nd.id, exercise_id: pe.exercise_id, sort_order: pe.sort_order, sets: pe.sets,
      reps_min: pe.reps_min, reps_max: pe.reps_max, target_weight: pe.target_weight, target_seconds: pe.target_seconds,
      rest_seconds: pe.rest_seconds, notes: pe.notes }))));
  }
  return np.id;
}

routes.programs = async view => {
  const [progs, members] = await Promise.all([
    q(sb.from('programs').select('id, name, athlete_id, is_template, sessions_per_week, start_date').eq('gym_id', st.cur.gym_id).eq('active', true).order('name')),
    q(sb.from('gym_members').select('id, full_name').eq('gym_id', st.cur.gym_id).eq('is_athlete', true).eq('status', 'active').order('full_name'))
  ]);
  const byAth = Object.fromEntries(progs.filter(p => p.athlete_id).map(p => [p.athlete_id, p]));
  const tpl = progs.filter(p => p.is_template);
  view.innerHTML = `
    <div class="head-row"><h1>Προγράμματα</h1><button class="btn small" id="newTpl">${icon('plus', 'sm')}Πρότυπο</button></div>
    <h2>Πρότυπα</h2>
    <div class="grid cols-3">${tpl.map(p => `<a class="card tap list-item" style="text-decoration:none;color:inherit" href="#/program/${p.id}">
      <div class="logo" style="background:var(--brand-soft);color:var(--brand)">${icon('clip')}</div><div class="grow"><b>${esc(p.name)}</b>
      <div class="muted small">${p.sessions_per_week} φορές / εβδομάδα</div></div>${icon('right', 'sm')}</a>`).join('') ||
      '<div class="card empty">Κανένα πρότυπο ακόμα</div>'}</div>
    <h2>Ανά αθλητή</h2>
    <div class="grid cols-2">${members.map(m => { const p = byAth[m.id];
      return `<div class="card list-item">${avatar(m.full_name)}<div class="grow"><b>${esc(m.full_name)}</b>
        <div class="small ${p ? 'muted' : ''}">${p ? `${esc(p.name)} · από ${fmtDate(p.start_date)}` : '<span class="badge b-warn">χωρίς πρόγραμμα</span>'}</div></div>
        ${p ? `<a class="btn secondary small" href="#/program/${p.id}">Άνοιγμα</a>` : `<button class="btn small" data-new="${m.id}">Δημιουργία</button>`}</div>`; }).join('')}</div>`;
  $$('[data-new]', view).forEach(b => b.onclick = () => createProgramFor(b.dataset.new));
  $('#newTpl').onclick = () => sheet('Νέο πρότυπο', `<form id="tf"><div class="field"><label>Όνομα</label><input name="n" required placeholder="π.χ. Αρχάριοι 3 ημέρες"></div>
    <button class="btn block">Δημιουργία</button></form>`, (el, close) => {
    $('#tf', el).onsubmit = async e => { e.preventDefault(); close();
      const p = await q(sb.from('programs').insert({ gym_id: st.cur.gym_id, coach_id: st.cur.member_id, is_template: true,
        name: e.target.n.value.trim() }).select('id').single());
      location.hash = '#/program/' + p.id; };
  });
};

function exercisePicker(exs, onPick) {
  const groups = groupBy(exs, e => e.muscle_group || 'Άλλο');
  sheet('Επιλογή άσκησης', `<div class="search">${icon('search', 'sm')}<input id="xs" placeholder="Αναζήτηση"></div>
    <div id="xl">${[...groups].map(([g, xs]) => `<div data-g><h2 style="margin-top:8px">${esc(g)}</h2>
      ${xs.map(e => `<button class="card tap list-item" style="width:100%;text-align:left;margin-bottom:8px;padding:8px" data-x="${e.id}" data-n="${esc(e.name.toLowerCase())}">
        ${Stickman.svg(e.animation_code).replace('class="stick"', 'class="stick" style="width:48px;height:48px"')}<b class="grow">${esc(e.name)}</b>${icon('plus', 'sm')}</button>`).join('')}</div>`).join('')}</div>`,
    (el, close) => {
      $('#xs', el).oninput = ev => { const s = ev.target.value.toLowerCase();
        $$('[data-x]', el).forEach(b => b.style.display = b.dataset.n.includes(s) ? '' : 'none');
        $$('[data-g]', el).forEach(g => g.style.display = $$('[data-x]', g).some(b => b.style.display !== 'none') ? '' : 'none'); };
      $$('[data-x]', el).forEach(b => b.onclick = () => { close(); onPick(exs.find(e => e.id === b.dataset.x)); });
    });
}

routes.program = async (view, programId) => {
  const [p, exs] = await Promise.all([loadProgram(programId), gymExercises()]);
  const athlete = p.athlete_id ? await q(sb.from('gym_members').select('id, full_name').eq('id', p.athlete_id).single()) : null;
  const back = athlete ? ['#/athlete/' + athlete.id, athlete.full_name] : ['#/programs', 'Προγράμματα'];
  const saved = () => toast('Αποθηκεύτηκε');
  const peFields = pe => {
    const m = pe.exercises.metric_type;
    const f = (k, l, step = 1) => `<div><label class="tiny">${l}</label><input type="number" inputmode="decimal" step="${step}" data-f="${k}" value="${pe[k] ?? ''}"></div>`;
    return m === 'time' ? f('sets', 'Σετ') + f('target_seconds', 'Δευτ.') + f('rest_seconds', 'Διάλ. ″')
      : f('sets', 'Σετ') + f('reps_min', 'Επαν. από') + f('reps_max', 'έως') + (m === 'reps_weight' ? f('target_weight', 'Κιλά', 0.5) : '') + f('rest_seconds', 'Διάλ. ″');
  };
  view.innerHTML = `
    <p class="small"><a href="${back[0]}" class="row nowrap" style="gap:2px;text-decoration:none">${icon('left', 'sm')}${esc(back[1])}</a></p>
    <div class="card"><div class="row between"><b>${p.is_template ? '<span class="badge b-info">Πρότυπο</span>' : 'Πρόγραμμα αθλητή'}</b>
      ${!p.is_template ? `<button class="btn ghost small" id="saveTpl">Αποθήκευση ως πρότυπο</button>` : ''}</div>
      <div class="form-grid" style="margin-top:10px">
        <div class="field"><label>Όνομα</label><input data-pf="name" value="${esc(p.name)}"></div>
        <div class="field"><label>Στόχος</label><input data-pf="goal" value="${esc(p.goal || '')}"></div>
        <div class="field"><label>Φορές / εβδομάδα</label><input data-pf="sessions_per_week" type="number" min="1" max="7" value="${p.sessions_per_week}"></div>
      </div></div>
    ${p.program_days.map(d => `
      <div class="card" data-day="${d.id}">
        <div class="row nowrap"><input data-dn="${d.id}" value="${esc(d.name)}" style="font-weight:700" class="grow">
          <button class="icon-btn" data-deld="${d.id}" title="Διαγραφή ημέρας" style="color:var(--bad)">${icon('x')}</button></div>
        ${d.program_exercises.map((pe, i) => `<div data-pe="${pe.id}" style="padding:12px 0;border-top:1px solid var(--line);margin-top:${i ? 0 : 12}px">
          <div class="row nowrap"><button class="stick-btn" data-show="${pe.id}">${Stickman.svg(pe.exercises.animation_code).replace('class="stick"', 'class="stick" style="width:48px;height:48px"')}</button>
            <b class="grow">${esc(pe.exercises.name)}</b>
            <button class="icon-btn" data-mv="-1" ${i === 0 ? 'disabled' : ''} title="Πάνω">${icon('up', 'sm')}</button>
            <button class="icon-btn" data-mv="1" ${i === d.program_exercises.length - 1 ? 'disabled' : ''} title="Κάτω">${icon('down', 'sm')}</button>
            <button class="icon-btn" data-delpe style="color:var(--bad)" title="Αφαίρεση">${icon('x', 'sm')}</button></div>
          <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(60px,1fr));margin-top:8px">${peFields(pe)}</div></div>`).join('')}
        <button class="btn ghost block" data-add="${d.id}" style="margin-top:10px">${icon('plus', 'sm')}Προσθήκη άσκησης</button>
      </div>`).join('')}
    <button class="btn secondary block" id="addDay">${icon('plus', 'sm')}Νέα ημέρα</button>`;

  $$('[data-pf]', view).forEach(i => i.onchange = () =>
    q(sb.from('programs').update({ [i.dataset.pf]: i.type === 'number' ? num(i.value) : i.value }).eq('id', p.id)).then(saved));
  $$('[data-dn]', view).forEach(i => i.onchange = () => q(sb.from('program_days').update({ name: i.value }).eq('id', i.dataset.dn)).then(saved));
  $$('[data-pe] input', view).forEach(i => i.onchange = () =>
    q(sb.from('program_exercises').update({ [i.dataset.f]: num(i.value) }).eq('id', i.closest('[data-pe]').dataset.pe)).then(saved));
  $$('[data-show]', view).forEach(b => b.onclick = () => {
    const pe = p.program_days.flatMap(d => d.program_exercises).find(x => x.id === b.dataset.show);
    showExercise(pe.exercises.name, pe.exercises.animation_code, pe.exercises.muscle_group); });
  $$('[data-delpe]', view).forEach(b => b.onclick = async () => {
    const box = b.closest('[data-pe]'); await q(sb.from('program_exercises').delete().eq('id', box.dataset.pe)); box.remove(); });
  $$('[data-mv]', view).forEach(b => b.onclick = async () => {
    const d = p.program_days.find(x => x.id === b.closest('[data-day]').dataset.day), list = d.program_exercises;
    const i = list.findIndex(x => x.id === b.closest('[data-pe]').dataset.pe), j = i + +b.dataset.mv;
    [list[i], list[j]] = [list[j], list[i]];
    await Promise.all(list.map((x, k) => q(sb.from('program_exercises').update({ sort_order: k + 1 }).eq('id', x.id))));
    route();
  });
  $$('[data-deld]', view).forEach(b => b.onclick = () => confirmSheet('Διαγραφή ημέρας', 'Θα διαγραφεί η ημέρα και οι ασκήσεις της.', 'Διαγραφή', async () => {
    await q(sb.from('program_days').delete().eq('id', b.dataset.deld)); route(); }, true));
  $$('[data-add]', view).forEach(b => b.onclick = () => exercisePicker(exs, async ex => {
    const d = p.program_days.find(x => x.id === b.dataset.add), t = ex.metric_type === 'time';
    await q(sb.from('program_exercises').insert({ gym_id: st.cur.gym_id, program_day_id: d.id, exercise_id: ex.id,
      sort_order: d.program_exercises.length + 1, sets: 3, reps_min: t ? null : 8, reps_max: t ? null : 12,
      target_seconds: t ? 30 : null, rest_seconds: 90 }));
    route();
  }));
  $('#addDay').onclick = async () => {
    const n = p.program_days.length + 1;
    await q(sb.from('program_days').insert({ gym_id: st.cur.gym_id, program_id: p.id,
      day_no: Math.max(0, ...p.program_days.map(d => d.day_no)) + 1, name: 'Ημέρα ' + ('ΑΒΓΔΕΖΗ'[n - 1] || n) }));
    route();
  };
  const tb = $('#saveTpl');
  if (tb) tb.onclick = async () => { const id = await copyProgram(p.id, null); toast('Δημιουργήθηκε πρότυπο'); location.hash = '#/program/' + id; };
};

// =====================================================================
// Ασκήσεις
// =====================================================================
routes.exercises = async view => {
  const [exs, lib] = await Promise.all([gymExercises(true), q(sb.from('exercise_library').select('*').order('muscle_group').order('name_el'))]);
  const have = new Set(exs.map(e => e.animation_code)), missing = lib.filter(l => !have.has(l.code));
  let tab = 'mine', search = '';
  view.innerHTML = `
    <div class="head-row"><h1>Ασκήσεις</h1><button class="btn small" id="custom">${icon('plus', 'sm')}Νέα</button></div>
    <button class="card tap list-item" id="photo" style="width:100%;text-align:left;border-style:dashed">
      <div class="logo" style="background:var(--brand-soft);color:var(--brand)">${icon('camera')}</div>
      <div class="grow"><b>Από φωτογραφία εξοπλισμού</b><div class="small muted">Βγάλτε φωτογραφία ένα μηχάνημα και δημιουργούνται οι ασκήσεις του</div></div>
      <span class="badge b-info">Σύντομα</span></button>
    <div class="seg" id="seg"><button data-t="mine" class="active">Του γυμναστηρίου (${exs.length})</button><button data-t="lib">Βιβλιοθήκη (${missing.length})</button></div>
    <div class="search">${icon('search', 'sm')}<input id="q" placeholder="Αναζήτηση"></div>
    <div id="list"></div>`;
  const draw = () => {
    const src = tab === 'mine' ? exs.map(e => ({ id: e.id, name: e.name, code: e.animation_code, group: e.muscle_group || 'Άλλο', sub: metricLabel[e.metric_type], active: e.active }))
      : missing.map(l => ({ id: l.id, name: l.name_el, code: l.code, group: l.muscle_group, sub: metricLabel[l.metric_type], lib: true }));
    const list = src.filter(x => x.name.toLowerCase().includes(search));
    $('#list').innerHTML = [...groupBy(list, x => x.group)].map(([g, xs]) => `<h2>${esc(g)}</h2><div class="grid cols-3">${xs.map(x => `
      <div class="card list-item" style="${x.active === false ? 'opacity:.5' : ''}"><button class="stick-btn" data-show="${x.id}">${Stickman.svg(x.code)}</button>
        <div class="grow"><b>${esc(x.name)}</b><div class="muted small">${esc(x.sub)}</div></div>
        ${x.lib ? `<button class="btn ghost small" data-addlib="${x.id}">${icon('plus', 'sm')}</button>` :
          `<label class="check" title="Ενεργή"><input type="checkbox" data-toggle="${x.id}" ${x.active ? 'checked' : ''}></label>`}</div>`).join('')}</div>`).join('')
      || '<div class="card empty">Δεν βρέθηκαν ασκήσεις</div>';
    $$('[data-show]').forEach(b => b.onclick = () => { const x = src.find(y => y.id === b.dataset.show); showExercise(x.name, x.code, x.group); });
    $$('[data-toggle]').forEach(c => c.onchange = async () => {
      await q(sb.from('exercises').update({ active: c.checked }).eq('id', c.dataset.toggle));
      exs.find(e => e.id === c.dataset.toggle).active = c.checked; draw(); });
    $$('[data-addlib]').forEach(b => b.onclick = async () => {
      const l = lib.find(x => x.id === b.dataset.addlib);
      await q(sb.from('exercises').insert({ gym_id: st.cur.gym_id, library_id: l.id, name: l.name_el, muscle_group: l.muscle_group,
        metric_type: l.metric_type, animation_code: l.code, increment_kg: l.default_increment_kg }));
      toast('Προστέθηκε: ' + l.name_el); route(); });
  };
  $$('#seg button').forEach(b => b.onclick = () => { tab = b.dataset.t; $$('#seg button').forEach(x => x.classList.toggle('active', x === b)); draw(); });
  $('#q').oninput = e => { search = e.target.value.toLowerCase(); draw(); };
  $('#photo').onclick = () => toast('Η αναγνώριση από φωτογραφία έρχεται στην επόμενη έκδοση');
  $('#custom').onclick = () => sheet('Νέα άσκηση', `<form id="cf">
    <div class="field"><label>Όνομα</label><input name="name" required></div>
    <div class="form-grid"><div class="field"><label>Μυϊκή ομάδα</label><input name="muscle" list="groups">
      <datalist id="groups">${[...new Set(lib.map(l => l.muscle_group))].map(g => `<option>${esc(g)}</option>`).join('')}</datalist></div>
      <div class="field"><label>Μέτρηση</label><select name="metric">${Object.entries(metricLabel).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><label>Βήμα αύξησης (κ.)</label><input name="inc" type="number" step="0.5" value="2.5"></div></div>
    <div class="field"><label>Κίνηση (animation)</label><div class="row nowrap"><select name="anim" class="grow">${lib.map(l => `<option value="${l.code}">${esc(l.name_el)}</option>`).join('')}</select><div id="prev"></div></div></div>
    <button class="btn block">Αποθήκευση</button></form>`, (el, close) => {
    const f = $('#cf', el), prev = () => $('#prev', el).innerHTML = Stickman.svg(f.anim.value);
    f.anim.onchange = prev; prev();
    f.onsubmit = async e => { e.preventDefault();
      await q(sb.from('exercises').insert({ gym_id: st.cur.gym_id, name: f.name.value.trim(), muscle_group: f.muscle.value || null,
        metric_type: f.metric.value, animation_code: f.anim.value, increment_kg: num(f.inc.value) ?? 2.5 }));
      close(); toast('Αποθηκεύτηκε'); route(); };
  });
  draw();
};

// =====================================================================
// Παρουσίες
// =====================================================================
routes.attendance = async view => {
  let day = todayISO(), search = '';
  const [athletes, subs] = await Promise.all([q(sb.from('gym_members').select('id, full_name, rfid_tag').eq('gym_id', st.cur.gym_id)
    .eq('is_athlete', true).eq('status', 'active').order('full_name')), q(sb.rpc('sub_status', { p_gym: st.cur.gym_id }))]);
  const SS = Object.fromEntries(subs.map(x => [x.member_id, x]));
  view.innerHTML = `
    <div class="head-row"><h1>Παρουσίες</h1><a class="btn small" href="#/checkin">${icon('scan', 'sm')}Check-in</a></div>
    <div class="card row between nowrap" style="padding:8px">
      <button class="icon-btn" id="prev" aria-label="Προηγούμενη">${icon('left')}</button>
      <div class="center grow"><div id="dayName" class="small muted"></div>${dateField('day', day)}</div>
      <button class="icon-btn" id="next" aria-label="Επόμενη">${icon('right')}</button></div>
    <div class="row between nowrap"><h2 id="cnt" style="margin:8px 0"></h2><span class="muted small">Πατήστε για παρών/απών</span></div>
    <div class="search">${icon('search', 'sm')}<input id="q" placeholder="Αναζήτηση"></div>
    <div class="grid cols-4" id="list"></div>`;
  async function load() {
    $('#dayName').textContent = day === todayISO() ? 'Σήμερα' : DAYS[new Date(day + 'T12:00:00').getDay()];
    $('[data-show="day"]').textContent = fmtDate(day); $('#day').value = day;
    $('#next').disabled = day >= todayISO();
    const from = new Date(day + 'T00:00:00'), to = new Date(from.getTime() + 864e5);
    const rows = await q(sb.from('attendance').select('id, member_id, method, checked_in_at').eq('gym_id', st.cur.gym_id)
      .gte('checked_in_at', from.toISOString()).lt('checked_in_at', to.toISOString()));
    const present = new Map(rows.map(r => [r.member_id, r]));
    $('#cnt').textContent = `${present.size} από ${athletes.length} παρόντες`;
    $('#list').innerHTML = athletes.filter(a => a.full_name.toLowerCase().includes(search)).map(a => { const r = present.get(a.id);
      return `<button class="card tap" data-m="${a.id}" style="text-align:center;border:2px solid ${r ? 'var(--ok)' : 'var(--line)'};background:${r ? 'var(--ok-soft)' : '#fff'};position:relative">
        ${r ? `<span style="position:absolute;top:8px;right:8px;color:var(--ok)">${icon('check', 'sm')}</span>` : ''}
        <div style="display:flex;justify-content:center">${avatar(a.full_name)}</div><b class="small" style="display:block;margin-top:6px">${esc(a.full_name)}</b>
        <div class="tiny muted">${r ? new Date(r.checked_in_at).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' }) +
          (r.method !== 'manual' ? ' · ' + ({ rfid: 'κάρτα', workout: 'προπόνηση', qr: 'QR' }[r.method] || '') : '') : 'απών'}</div>
        ${SS[a.id] && SS[a.id].status !== 'active' ? `<span class="badge ${SUB[SS[a.id].status][0]}" style="margin-top:4px">${SUB[SS[a.id].status][1]}</span>` : ''}</button>`; }).join('');
    $$('[data-m]').forEach(b => b.onclick = async () => {
      if (present.has(b.dataset.m)) await q(sb.from('attendance').delete().eq('member_id', b.dataset.m).gte('checked_in_at', from.toISOString()).lt('checked_in_at', to.toISOString()));
      else await q(sb.from('attendance').insert({ gym_id: st.cur.gym_id, member_id: b.dataset.m,
        checked_in_at: (day === todayISO() ? new Date() : new Date(day + 'T12:00:00')).toISOString(), method: 'manual' }));
      load();
    });
  }
  bindDate('day', v => { day = v > todayISO() ? todayISO() : v; load(); });
  $('#prev').onclick = () => { day = addDays(day, -1); load(); };
  $('#next').onclick = () => { if (day < todayISO()) { day = addDays(day, 1); load(); } };
  $('#q').oninput = e => { search = e.target.value.toLowerCase(); load(); };
  await load();
};

// =====================================================================
// Μέλη
// =====================================================================
async function memberSheet(m, after) {
  const coaches = await q(sb.from('gym_members').select('id, full_name').eq('gym_id', st.cur.gym_id).or('is_coach.eq.true,is_owner.eq.true'));
  const owner = st.cur.is_owner, isNew = !m; m = m || { is_athlete: true, coach_id: st.cur.member_id, status: 'active' };
  sheet(isNew ? 'Νέο μέλος' : m.full_name, `<form id="mf">
    <div class="field"><label>Ονοματεπώνυμο</label><input name="full_name" required value="${esc(m.full_name || '')}"></div>
    <div class="field"><label>Email (για τη σύνδεση)</label><input name="email" type="email" required value="${esc(m.email || '')}" ${isNew ? '' : 'readonly'}></div>
    <div class="form-grid"><div class="field"><label>Τηλέφωνο</label><input name="phone" type="tel" value="${esc(m.phone || '')}"></div>
      <div class="field"><label>Στόχος</label><input name="goal" value="${esc(m.goal || '')}"></div>
      <div class="field"><label>Προπονητής</label><select name="coach_id"><option value="">—</option>${coaches.map(c =>
        `<option value="${c.id}" ${c.id === m.coach_id ? 'selected' : ''}>${esc(c.full_name)}</option>`).join('')}</select></div>
      <div class="field"><label>Κάρτα NFC / RFID</label><div class="row nowrap"><input name="rfid_tag" value="${esc(m.rfid_tag || '')}" placeholder="—" class="grow">
        <button type="button" class="btn secondary small" id="readCard" title="Ανάγνωση κάρτας">${icon('nfc', 'sm')}</button></div></div></div>
    <div class="row" style="margin-bottom:14px"><label class="check"><input type="checkbox" name="is_athlete" ${m.is_athlete ? 'checked' : ''}>Αθλητής</label>
      ${owner ? `<label class="check"><input type="checkbox" name="is_coach" ${m.is_coach ? 'checked' : ''}>Προπονητής</label>` : ''}
      ${!isNew ? `<label class="check"><input type="checkbox" name="active" ${m.status === 'active' ? 'checked' : ''} ${m.user_id === st.user.id ? 'disabled' : ''}>Ενεργό</label>` : ''}</div>
    ${isNew ? '<p class="small muted">Το μέλος φτιάχνει λογαριασμό με το ίδιο email και συνδέεται αυτόματα.</p>' :
      `<div class="row between" style="margin-bottom:12px">${m.user_id ? '<span class="badge b-ok">Έχει λογαριασμό</span>' : '<span class="badge b-muted">Δεν έχει φτιάξει λογαριασμό ακόμα</span>'}
        ${m.checkin_code ? `<button type="button" class="btn ghost small" id="showQr">${icon('qr', 'sm')}QR check-in</button>` : ''}</div>`}
    <button class="btn block">${isNew ? 'Προσθήκη' : 'Αποθήκευση'}</button></form>`, (el, close) => {
    $('#readCard', el).onclick = async () => {
      const inp = $('[name=rfid_tag]', el);
      if (nfcSupported()) {
        try { toast('Ακουμπήστε την κάρτα στο πίσω μέρος της συσκευής');
          const stop = await readNfc(serial => { inp.value = serial; toast('Διαβάστηκε: ' + serial); stop(); }); } catch (e) { toast('NFC: ' + e.message, true); }
      } else { inp.value = ''; inp.focus(); toast('Περάστε την κάρτα στον USB αναγνώστη'); }
    };
    const sq = $('#showQr', el);
    if (sq) sq.onclick = () => sheet('QR check-in · ' + m.full_name, `<div class="center">${qrSvg('OGYM:' + m.checkin_code, 260)}
      <p class="muted small">Για αθλητές χωρίς κινητό: εκτυπώστε το και δείξτε το στην κάμερα check-in.</p>
      <button class="btn secondary" onclick="window.print()">Εκτύπωση</button></div>`);
    $('#mf', el).onsubmit = async e => {
      e.preventDefault(); const f = e.target;
      const row = { full_name: f.full_name.value.trim(), phone: f.phone.value || null, goal: f.goal.value || null,
        coach_id: f.coach_id.value || null, rfid_tag: f.rfid_tag.value.trim() || null, is_athlete: f.is_athlete.checked };
      if (owner) row.is_coach = f.is_coach.checked;
      try {
        if (isNew) await q(sb.from('gym_members').insert({ ...row, gym_id: st.cur.gym_id, email: f.email.value.trim() }));
        else { if (f.active && !f.active.disabled) row.status = f.active.checked ? 'active' : 'inactive';
               await q(sb.from('gym_members').update(row).eq('id', m.id)); }
        close(); toast('Αποθηκεύτηκε'); after && after();
      } catch {}
    };
  });
}
routes.members = async view => {
  const ms = await q(sb.from('gym_members').select('*').eq('gym_id', st.cur.gym_id).order('full_name'));
  let filter = 'active', search = '';
  view.innerHTML = `
    <div class="head-row"><h1>Μέλη</h1><button class="btn small" id="add">${icon('plus', 'sm')}Νέο μέλος</button></div>
    <div class="search">${icon('search', 'sm')}<input id="q" placeholder="Αναζήτηση"></div>
    <div class="chips" id="flt"><button class="chip active" data-f="active">Ενεργά</button><button class="chip" data-f="staff">Προπονητές</button>
      <button class="chip" data-f="nolog">Χωρίς λογαριασμό</button><button class="chip" data-f="inactive">Ανενεργά</button></div>
    <div class="grid cols-2" id="list"></div>`;
  const draw = () => {
    const list = ms.filter(m => (filter === 'active' ? m.status === 'active' : filter === 'staff' ? (m.is_coach || m.is_owner) :
      filter === 'nolog' ? !m.user_id : m.status !== 'active') && (m.full_name + m.email).toLowerCase().includes(search));
    $('#list').innerHTML = list.map(m => `<button class="card tap list-item" data-id="${m.id}" style="text-align:left;width:100%">${avatar(m.full_name)}
      <div class="grow" style="min-width:0"><b>${esc(m.full_name)}</b><div class="small muted ellipsis">${esc(m.email)}</div>
      <div class="row" style="gap:4px;margin-top:4px">${m.is_owner ? '<span class="badge b-brand">Ιδιοκτήτης</span>' : ''}${m.is_coach ? '<span class="badge b-info">Προπονητής</span>' : ''}
        ${m.is_athlete ? '<span class="badge b-muted">Αθλητής</span>' : ''}${!m.user_id ? '<span class="badge b-warn">χωρίς λογαριασμό</span>' : ''}
        ${m.rfid_tag ? `<span class="badge b-muted">${icon('card', 'sm')}</span>` : ''}</div></div>${icon('right', 'sm')}</button>`).join('')
      || '<div class="card empty">Κανένα μέλος</div>';
    $$('[data-id]').forEach(b => b.onclick = () => memberSheet(ms.find(m => m.id === b.dataset.id), () => route()));
  };
  $('#q').oninput = e => { search = e.target.value.toLowerCase(); draw(); };
  $$('#flt .chip').forEach(c => c.onclick = () => { filter = c.dataset.f; $$('#flt .chip').forEach(x => x.classList.toggle('active', x === c)); draw(); });
  $('#add').onclick = () => memberSheet(null, () => route());
  draw();
};

// =====================================================================
// Ρυθμίσεις ιδιοκτήτη
// =====================================================================
const PROG_FIELDS = [['missed_days_hold', 'Απουσία ημερών → ίδια κιλά'], ['missed_days_deload', 'Απουσία ημερών → μείωση'],
  ['deload_pct', 'Μείωση μετά από απουσία %'], ['fails_for_decrease', 'Αποτυχίες στη σειρά → μείωση'],
  ['decrease_pct', 'Μείωση μετά από αποτυχίες %'], ['stall_sessions', 'Προπονήσεις χωρίς βελτίωση → στασιμότητα']];
routes.settings = async view => {
  const [g, ps] = await Promise.all([q(sb.from('gyms').select('*').eq('id', st.cur.gym_id).single()),
    q(sb.from('progression_settings').select('*').eq('gym_id', st.cur.gym_id).single())]);
  const plans = { trial: 'Δοκιμαστικό', basic: 'Basic', pro: 'Pro', free: 'Δωρεάν' };
  view.innerHTML = `<h1>Ρυθμίσεις</h1>
    <div class="card row between"><div><div class="small muted">Πακέτο</div><b>${plans[g.plan] || g.plan}</b></div>
      <div><div class="small muted">Αθλητές</div><b>έως ${g.max_athletes}</b></div>
      <div><div class="small muted">Ισχύει έως</div><b>${fmtDate(g.paid_until)}</b></div></div>
    <form class="card" id="gf"><h3>Γυμναστήριο</h3><div class="form-grid" style="margin-top:10px">
      <div class="field"><label>Όνομα</label><input name="name" value="${esc(g.name)}"></div>
      <div class="field"><label>Πόλη</label><input name="city" value="${esc(g.city || '')}"></div>
      <div class="field"><label>Τηλέφωνο</label><input name="phone" value="${esc(g.phone || '')}"></div>
      <div class="field"><label>Κύριο χρώμα</label><input name="primary_color" type="color" value="${esc(g.primary_color)}"></div>
      <div class="field"><label>Σκούρο χρώμα</label><input name="secondary_color" type="color" value="${esc(g.secondary_color)}"></div></div>
      <div class="field"><label>Λογότυπο (σύνδεσμος εικόνας)</label><input name="logo_url" value="${esc(g.logo_url || '')}" placeholder="https://…"></div>
      <h3 style="margin-top:8px">Συνδρομές</h3><div class="form-grid" style="margin-top:8px">
        <div class="field"><label>Ληγμένη συνδρομή ή οφειλή</label><select name="expired_policy">
          <option value="warn" ${g.expired_policy !== 'block' ? 'selected' : ''}>Μόνο σήμανση</option>
          <option value="block" ${g.expired_policy === 'block' ? 'selected' : ''}>Ο αθλητής δεν καταγράφει προπόνηση</option></select></div>
        <div class="field"><label>Ειδοποίηση «λήγει» πριν από (ημέρες)</label><input name="expiring_days" type="number" min="1" value="${g.expiring_days ?? 7}"></div></div>
      <button class="btn block">Αποθήκευση</button></form>
    <form class="card" id="pf"><h3>Κανόνες προόδου</h3><p class="muted small">Από αυτούς βγαίνουν οι προτάσεις κιλών για όλους τους αθλητές.</p>
      <div class="form-grid">${PROG_FIELDS.map(([k, l]) => `<div class="field"><label>${l}</label><input name="${k}" type="number" step="0.5" value="${fmtNum(ps[k])}"></div>`).join('')}</div>
      <button class="btn block">Αποθήκευση</button></form>`;
  $('#gf').onsubmit = async e => { e.preventDefault(); const f = e.target, upd = {};
    ['name', 'city', 'phone', 'primary_color', 'secondary_color', 'logo_url'].forEach(k => upd[k] = f[k].value || null);
    upd.expired_policy = f.expired_policy.value; upd.expiring_days = num(f.expiring_days.value) || 7;
    await q(sb.from('gyms').update(upd).eq('id', g.id)); toast('Αποθηκεύτηκε'); await loadMe(); shell(); route(); };
  $('#pf').onsubmit = async e => { e.preventDefault(); const f = e.target, upd = {};
    PROG_FIELDS.forEach(([k]) => upd[k] = num(f[k].value)); await q(sb.from('progression_settings').update(upd).eq('gym_id', g.id)); toast('Αποθηκεύτηκε'); };
};

// =====================================================================
// Καταγραφή προπόνησης (αθλητής ή προπονητής για λογαριασμό του)
// =====================================================================
routes.today = view => renderWorkout(view, st.cur.member_id, 'athlete');
routes.log = (view, athleteId) => renderWorkout(view, athleteId, 'coach');

async function renderWorkout(view, athleteId, source) {
  const pid = await activeProgramId(athleteId);
  if (!pid) { view.innerHTML = `<h1>Προπόνηση</h1><div class="card empty">${icon('clip')}<p>Δεν υπάρχει ενεργό πρόγραμμα.</p>${source === 'coach' ?
    `<a class="btn" href="#/athlete/${athleteId}">Δημιουργία προγράμματος</a>` : 'Επικοινωνήστε με τον προπονητή σας.'}</div>`; return; }
  const [p, sugg, recent, ath, best] = await Promise.all([
    loadProgram(pid), q(sb.rpc('suggest_progression', { p_athlete: athleteId })),
    q(sb.from('workout_sessions').select('id, program_day_id, performed_on, workout_sets(exercise_id, set_no, reps, weight, seconds)')
      .eq('athlete_id', athleteId).order('performed_on', { ascending: false }).limit(12)),
    q(sb.from('gym_members').select('full_name').eq('id', athleteId).single()),
    q(sb.from('v_exercise_progress').select('exercise_id, est_1rm').eq('athlete_id', athleteId))
  ]);
  const days = p.program_days;
  if (!days.length) { view.innerHTML = '<div class="card empty">Το πρόγραμμα δεν έχει ημέρες ακόμα.</div>'; return; }
  const last = recent[0];
  const nextIdx = last ? (days.findIndex(d => d.id === last.program_day_id) + 1) % days.length : 0;
  let dayIdx = nextIdx;
  const sMap = Object.fromEntries(sugg.map(s => [s.program_exercise_id, s]));
  const prev = {};   // τελευταία σετ ανά άσκηση
  for (const s of recent) for (const x of s.workout_sets) {
    if (!prev[x.exercise_id]) prev[x.exercise_id] = { date: s.performed_on, sets: [] };
    if (prev[x.exercise_id].date === s.performed_on) prev[x.exercise_id].sets[x.set_no - 1] = x;
  }
  const bestE1 = {}; best.forEach(b => bestE1[b.exercise_id] = Math.max(bestE1[b.exercise_id] || 0, +b.est_1rm || 0));
  const started = Date.now();
  let state, date = todayISO(), restLeft = 0;
  const draftKey = () => `draft_${athleteId}_${days[dayIdx].id}`;

  function initState() {
    const saved = store.get(draftKey());
    if (saved) { try { const d = JSON.parse(saved); if (d.date === todayISO()) return d.ex; } catch {} }
    return days[dayIdx].program_exercises.map(pe => {
      const s = sMap[pe.id], pv = prev[pe.exercise_id], m = pe.exercises.metric_type;
      const w = s?.suggested_weight ?? pe.target_weight;
      return { pe: pe.id, ex: pe.exercise_id, m, sets: Array.from({ length: pe.sets }, (_, i) => {
        const ps = pv?.sets[i] || pv?.sets.filter(Boolean).slice(-1)[0];
        return { w: m === 'reps_weight' ? (w ?? ps?.weight ?? '') : '', r: m === 'time' ? '' : (ps?.reps ?? pe.reps_max ?? pe.reps_min ?? ''),
                 s: m === 'time' ? (ps?.seconds ?? pe.target_seconds ?? '') : '', done: false };
      }) };
    });
  }
  const saveDraft = () => store.set(draftKey(), JSON.stringify({ date: todayISO(), ex: state }));

  function draw() {
    const d = days[dayIdx];
    const total = state.reduce((a, e) => a + e.sets.length, 0), done = state.reduce((a, e) => a + e.sets.filter(s => s.done).length, 0);
    view.innerHTML = `
      <div class="workout-bar"><div class="prog"><div class="row between nowrap small"><b>${done}/${total} σετ</b><span class="time" id="elapsed">00:00</span></div>
        <div class="meter" style="margin-top:6px"><i style="width:${total ? 100 * done / total : 0}%"></i></div></div>
        <button class="btn small" id="finish" ${done ? '' : 'disabled'}>Τέλος</button></div>
      ${source === 'coach' ? `<p class="small"><a href="#/athlete/${athleteId}" class="row nowrap" style="gap:2px;text-decoration:none">${icon('left', 'sm')}${esc(ath.full_name)}</a></p>` : ''}
      <h1 style="margin-bottom:4px">${source === 'coach' ? esc(ath.full_name) : 'Η προπόνησή μου'}</h1>
      <div class="muted small" style="margin-bottom:12px">${esc(p.name)}${last ? ` · τελευταία ${fmtDate(last.performed_on)}` : ''}</div>
      <div class="chips">${days.map((x, i) => `<button class="chip ${i === dayIdx ? 'active' : ''}" data-day="${i}">${esc(x.name)}${i === nextIdx ? ' <span class="badge b-brand">επόμενη</span>' : ''}</button>`).join('')}</div>
      <div class="row" style="margin-bottom:12px"><span class="small muted">Ημερομηνία</span>${dateField('wdate', date)}</div>
      ${d.program_exercises.map((pe, ei) => { const ex = pe.exercises, s = sMap[pe.id], S = state[ei], m = ex.metric_type, pv = prev[pe.exercise_id];
        const [c, l] = s ? (statusInfo[s.status] || ['b-muted', '']) : ['b-muted', ''];
        return `<div class="card" data-ei="${ei}">
          <div class="ex-head"><button class="stick-btn" data-show="${ei}">${Stickman.svg(ex.animation_code)}</button>
            <div class="grow"><h3>${esc(ex.name)}</h3><div class="muted small">${targetText(pe)}${pe.rest_seconds ? ` · ${icon('timer', 'sm').replace('class="i sm"', 'class="i sm" style="width:14px;height:14px;vertical-align:-2px"')} ${pe.rest_seconds}″` : ''}</div></div></div>
          ${s && s.status && s.status !== 'new' ? `<div class="suggest">${icon('trend', 'sm')}<div>${s.suggested_weight != null && m === 'reps_weight' ? `<b>${fmtNum(s.suggested_weight)} κ.</b> · ` : ''}${esc(s.reason)}
            ${s.status !== 'hold' ? ` <span class="badge ${c}">${l}</span>` : ''}</div></div>` : ''}
          <div class="sets"><div class="set-row hdr"><span>#</span><span>Προηγ.</span>${m === 'time' ? '<span>Δευτ.</span><span></span>' : m === 'reps_weight' ? '<span>Κιλά</span><span>Επαν.</span>' : '<span>Επαν.</span><span></span>'}<span>✓</span></div>
          ${S.sets.map((x, si) => { const ps = pv?.sets[si];
            const prevTxt = ps ? (ps.seconds ? ps.seconds + '″' : (ps.weight ? fmtNum(ps.weight) + '×' : '') + (ps.reps ?? '')) : '–';
            return `<div class="set-row ${x.done ? 'done' : ''}" data-si="${si}"><span class="n">${si + 1}</span><span class="prev">${prevTxt}</span>
              ${m === 'time' ? `<input inputmode="numeric" data-k="s" value="${fmtNum(x.s)}" aria-label="Δευτερόλεπτα"><span></span>` :
                m === 'reps_weight' ? `<input inputmode="decimal" data-k="w" value="${fmtNum(x.w)}" aria-label="Κιλά"><input inputmode="numeric" data-k="r" value="${fmtNum(x.r)}" aria-label="Επαναλήψεις">`
                : `<input inputmode="numeric" data-k="r" value="${fmtNum(x.r)}" aria-label="Επαναλήψεις"><span></span>`}
              <button class="tick" data-tick aria-label="Ολοκλήρωση σετ">${icon('check')}</button></div>`; }).join('')}
          <button class="btn ghost small add-set" data-addset>${icon('plus', 'sm')}Σετ</button></div></div>`; }).join('')}
      <button class="btn block" id="finish2" ${done ? '' : 'disabled'}>${icon('check', 'sm')}Ολοκλήρωση προπόνησης</button>`;

    $$('[data-day]').forEach(b => b.onclick = () => { dayIdx = +b.dataset.day; state = initState(); draw(); });
    bindDate('wdate', v => { date = v > todayISO() ? todayISO() : v; });
    $$('[data-show]').forEach(b => b.onclick = () => { const pe = d.program_exercises[+b.dataset.show];
      showExercise(pe.exercises.name, pe.exercises.animation_code, pe.exercises.muscle_group); });
    $$('.set-row input').forEach(inp => inp.oninput = () => {
      const ei = +inp.closest('[data-ei]').dataset.ei, si = +inp.closest('[data-si]').dataset.si;
      state[ei].sets[si][inp.dataset.k] = inp.value; saveDraft(); });
    $$('[data-tick]').forEach(b => b.onclick = () => {
      const ei = +b.closest('[data-ei]').dataset.ei, si = +b.closest('[data-si]').dataset.si, x = state[ei].sets[si];
      if (!x.done && x.r === '' && x.s === '') { toast('Συμπληρώστε επαναλήψεις ή χρόνο', true); return; }
      x.done = !x.done; saveDraft();
      if (x.done) { const pe = d.program_exercises[ei]; if (pe.rest_seconds) startRest(pe.rest_seconds); if (navigator.vibrate) navigator.vibrate(30); }
      const y = window.scrollY; draw(); window.scrollTo(0, y);
    });
    $$('[data-addset]').forEach(b => b.onclick = () => {
      const ei = +b.closest('[data-ei]').dataset.ei, lastSet = state[ei].sets.slice(-1)[0] || { w: '', r: '', s: '' };
      state[ei].sets.push({ ...lastSet, done: false }); saveDraft(); const y = window.scrollY; draw(); window.scrollTo(0, y); });
    $('#finish').onclick = $('#finish2').onclick = finish;
  }

  function startRest(sec) {
    restLeft = sec; let bar = $('.rest-bar');
    if (!bar) { bar = document.createElement('div'); bar.className = 'rest-bar'; document.body.appendChild(bar); }
    const paint = () => { bar.innerHTML = `${icon('timer')}<div><div class="tiny" style="opacity:.7">Διάλειμμα</div><div class="t">${fmtTime(Math.max(0, restLeft))}</div></div>
      <span class="grow"></span><button data-r="-15">−15</button><button data-r="15">+15</button><button data-r="0">Συνέχεια</button>`;
      $$('[data-r]', bar).forEach(b => b.onclick = () => { if (b.dataset.r === '0') { restLeft = 0; } else restLeft += +b.dataset.r; tick(); }); };
    const tick = () => { if (restLeft <= 0) { bar.remove(); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); return; } paint(); };
    paint();
    if (!st.restTimer) { st.restTimer = setInterval(() => { if (!$('.rest-bar')) return; restLeft--; tick(); }, 1000); st.timers.push(st.restTimer); }
  }

  async function finish() {
    const rows = [];
    state.forEach(e => e.sets.forEach((x, i) => { if (!x.done) return;
      rows.push({ program_exercise_id: e.pe, exercise_id: e.ex, set_no: i + 1, reps: num(x.r), weight: e.m === 'reps_weight' ? num(x.w) : null, seconds: num(x.s) }); }));
    if (!rows.length) { toast('Πατήστε ✓ στα σετ που κάνατε', true); return; }
    $$('#finish, #finish2').forEach(b => b.disabled = true);
    try {
      const sess = await q(sb.from('workout_sessions').insert({ gym_id: st.cur.gym_id, athlete_id: athleteId, program_day_id: days[dayIdx].id,
        performed_on: date, source }).select('id').single());
      await q(sb.from('workout_sets').insert(rows.map(r => ({ ...r, gym_id: st.cur.gym_id, session_id: sess.id }))));
      store.del(draftKey()); clearTimers();
      summary(rows);
    } catch { $$('#finish, #finish2').forEach(b => b.disabled = false); }
  }

  function summary(rows) {
    const mins = Math.max(1, Math.round((Date.now() - started) / 60000));
    const vol = rows.reduce((a, r) => a + (r.weight || 0) * (r.reps || 0), 0);
    const names = Object.fromEntries(days[dayIdx].program_exercises.map(pe => [pe.exercise_id, pe.exercises.name]));
    const prs = [];
    for (const [ex, xs] of groupBy(rows, r => r.exercise_id)) {
      const top = Math.max(...xs.map(x => e1rm(x.weight, x.reps)));
      if (top > 0 && bestE1[ex] && top > bestE1[ex] + 0.05) {
        const s = xs.reduce((a, x) => e1rm(x.weight, x.reps) > e1rm(a.weight, a.reps) ? x : a);
        prs.push(`<div class="pr">${icon('trophy')}<div class="grow"><b>${esc(names[ex] || '')}</b><div class="small muted">${fmtNum(s.weight)} κ. × ${s.reps} · εκτ. 1RM ${fmtNum(top)} κ.</div></div>
          <span class="badge b-ok">+${fmtNum(top - bestE1[ex])} κ.</span></div>`);
      }
    }
    view.innerHTML = `<div class="card done-hero"><div class="big">${icon('check')}</div><h1>Μπράβο!</h1>
      <p class="muted">${esc(days[dayIdx].name)} · ${fmtDateDay(date)}</p>
      <div class="kpis" style="margin-top:16px"><div class="kpi"><b>${rows.length}</b><span>σετ</span></div>
        <div class="kpi"><b>${Math.round(vol).toLocaleString('el-GR')}</b><span>κιλά συνολικά</span></div>
        ${source === 'athlete' ? `<div class="kpi"><b>${mins}′</b><span>διάρκεια</span></div>` : ''}</div></div>
      ${prs.length ? `<div class="card"><div class="row nowrap">${icon('flame')}<b>Νέα ρεκόρ!</b></div>${prs.join('')}</div>` : ''}
      <a class="btn block" href="${source === 'coach' ? '#/athlete/' + athleteId : (isStaff(st.cur) ? '#/athletes' : '#/progress')}">Συνέχεια</a>`;
  }

  state = initState(); draw();
  const el = setInterval(() => { const e = $('#elapsed'); if (e) e.textContent = fmtTime(Math.floor((Date.now() - started) / 1000)); }, 1000);
  st.timers.push(el); st.restTimer = null;
}

// =====================================================================
// Ιστορικό & πρόοδος
// =====================================================================
async function renderHistory(el, athleteId, limit = 40) {
  const ss = await q(sb.from('workout_sessions').select(`id, performed_on, source, notes, program_days(name),
    workout_sets(set_no, reps, weight, seconds, exercise_id, exercises(name))`).eq('athlete_id', athleteId)
    .order('performed_on', { ascending: false }).limit(limit));
  const withSets = ss.filter(s => s.workout_sets.length);
  if (!withSets.length) { el.innerHTML = '<div class="card empty">Καμία καταγραφή ακόμα</div>'; return; }
  el.innerHTML = [...groupBy(withSets, s => s.performed_on.slice(0, 7))].map(([ym, xs]) => {
    const [y, mo] = ym.split('-');
    return `<h2>${MONTHS[+mo - 1]} ${y} <span class="muted small">· ${xs.length} προπονήσεις</span></h2>` + xs.map(s => {
      const by = groupBy(s.workout_sets.sort((a, b) => a.set_no - b.set_no), x => x.exercises.name);
      const vol = s.workout_sets.reduce((a, x) => a + (x.weight || 0) * (x.reps || 0), 0);
      return `<details class="card"><summary style="cursor:pointer;list-style:none"><div class="row between nowrap">
        <div><b>${fmtDateDay(s.performed_on)}</b><div class="small muted">${esc(s.program_days?.name || '')}${s.source === 'coach' ? ' · από προπονητή' : ''}</div></div>
        <div style="text-align:right" class="small"><b>${s.workout_sets.length}</b> σετ<br><span class="muted">${Math.round(vol).toLocaleString('el-GR')} κ.</span></div></div></summary>
        <div class="divider"></div><div class="small">${[...by].map(([n, ys]) => `<div style="margin-bottom:4px"><b>${esc(n)}</b>
          <span class="muted">${ys.map(x => x.seconds ? x.seconds + '″' : (x.weight ? fmtNum(x.weight) + '×' : '') + (x.reps ?? '')).join(' · ')}</span></div>`).join('')}</div></details>`;
    }).join('');
  }).join('');
}
routes.history = async view => { view.innerHTML = '<h1>Ιστορικό</h1><div id="h"></div>'; await renderHistory($('#h'), st.cur.member_id); };

async function renderProgress(el, athleteId) {
  const rows = await q(sb.from('v_exercise_progress').select('*').eq('athlete_id', athleteId).order('performed_on'));
  if (!rows.length) { el.innerHTML = '<div class="card empty">Δεν υπάρχουν ακόμα δεδομένα προόδου</div>'; return; }
  const withW = rows.filter(r => r.top_weight != null), dates = [...new Set(rows.map(r => r.performed_on))];
  const d28 = dates.filter(d => d >= addDays(todayISO(), -28)).length;
  // Εβδομάδες στη σειρά με τουλάχιστον μία προπόνηση
  const wk = d => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return isoOf(x); };
  const weeks = new Set(dates.map(wk)); let streak = 0, w = wk(todayISO());
  if (!weeks.has(w)) w = addDays(w, -7);
  while (weeks.has(w)) { streak++; w = addDays(w, -7); }
  const exNames = [...new Map(withW.map(r => [r.exercise_id, r.exercise_name])).entries()];
  const recs = exNames.map(([id, n]) => { const xs = withW.filter(r => r.exercise_id === id);
    const b = xs.reduce((a, r) => +r.est_1rm > +a.est_1rm ? r : a); return { n, w: b.top_weight, e: b.est_1rm, d: b.performed_on, first: xs[0].est_1rm }; })
    .sort((a, b) => (b.e - b.first) / b.first - (a.e - a.first) / a.first);
  el.innerHTML = `
    <div class="kpis"><div class="kpi accent"><b>${streak}</b><span>εβδομάδες στη σειρά</span></div>
      <div class="kpi"><b>${d28}</b><span>προπονήσεις 4 εβδ.</span></div><div class="kpi"><b>${dates.length}</b><span>συνολικά</span></div></div>
    ${exNames.length ? `<div class="card"><select id="exSel">${exNames.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('')}</select>
      <div id="delta" class="small" style="margin:10px 0"></div><div class="chart-box"><canvas id="ch"></canvas></div></div>
    <h2>${icon('trophy', 'sm')} Ρεκόρ</h2><div class="card" style="padding:4px 14px">${recs.slice(0, 8).map((r, i) => `<div class="row nowrap" style="padding:10px 0;${i ? 'border-top:1px solid var(--line)' : ''}">
      <div class="grow"><b>${esc(r.n)}</b><div class="small muted">${fmtNum(r.w)} κ. · ${fmtDate(r.d)}</div></div>
      <div style="text-align:right"><b>${fmtNum(r.e)}</b><span class="small"> κ. 1RM</span><br>
      <span class="badge ${r.e > r.first ? 'b-ok' : 'b-muted'}">${r.e > r.first ? '+' : ''}${Math.round(100 * (r.e - r.first) / r.first)}%</span></div></div>`).join('')}</div>` : ''}`;
  if (!exNames.length) return;
  const ctx = $('#ch', el), brand = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#d71920';
  const drawChart = id => {
    destroyCharts();
    const xs = withW.filter(r => r.exercise_id === id), a = xs[0], b = xs[xs.length - 1], dd = b.est_1rm - a.est_1rm;
    $('#delta', el).innerHTML = `Εκτίμηση μέγιστου (1RM): <b>${fmtNum(a.est_1rm)} → ${fmtNum(b.est_1rm)} κ.</b>
      <span class="badge ${dd > 0 ? 'b-ok' : dd < 0 ? 'b-bad' : 'b-muted'}">${dd > 0 ? '+' : ''}${Math.round(100 * dd / a.est_1rm)}%</span>`;
    st.charts.push(new Chart(ctx, { type: 'line', data: { labels: xs.map(r => fmtDate(r.performed_on)), datasets: [
      { label: 'Εκτ. 1RM', data: xs.map(r => +r.est_1rm), borderColor: brand, backgroundColor: brand + '22', fill: true, tension: .3, pointRadius: 3 },
      { label: 'Κιλά', data: xs.map(r => +r.top_weight), borderColor: '#9ca3af', backgroundColor: '#9ca3af', borderDash: [5, 4], tension: .3, pointRadius: 0 }] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } },
        scales: { x: { ticks: { maxTicksLimit: 5, maxRotation: 0 } }, y: { ticks: { callback: v => v + ' κ.' } } } } }));
  };
  $('#exSel', el).onchange = e => drawChart(e.target.value); drawChart(exNames[0][0]);
}
routes.progress = async view => {
  view.innerHTML = '<h1>Η πρόοδός μου</h1><div class="seg" id="seg"><button data-t="p" class="active">Πρόοδος</button><button data-t="s">Επόμενη προπόνηση</button></div><div id="c"></div>';
  const draw = async t => { destroyCharts(); const c = $('#c');
    if (t === 'p') await renderProgress(c, st.cur.member_id);
    else c.innerHTML = suggList(await q(sb.rpc('suggest_progression', { p_athlete: st.cur.member_id }))); };
  $$('#seg button').forEach(b => b.onclick = () => { $$('#seg button').forEach(x => x.classList.toggle('active', x === b)); draw(b.dataset.t); });
  draw('p');
};

// =====================================================================
// Check-in: QR με κάμερα, κάρτα NFC (κινητό/tablet Android), USB RFID, χειροκίνητα
// =====================================================================
routes.checkin = async view => {
  const g = st.cur.gym_id;
  const [members, today] = await Promise.all([
    q(sb.from('gym_members').select('id, full_name, checkin_code, is_athlete').eq('gym_id', g).eq('status', 'active').order('full_name')),
    q(sb.from('attendance').select('member_id, checked_in_at, method').eq('gym_id', g).gte('checked_in_at', new Date(todayISO() + 'T00:00:00').toISOString()))
  ]);
  const names = Object.fromEntries(members.map(m => [m.id, m.full_name]));
  let facing = store.get('cam_facing') || 'user', lastCode = '', lastAt = 0, busy = false, resetT = null;
  view.innerHTML = `
    <div class="head-row"><h1>Check-in</h1><a class="btn secondary small" href="#/attendance">${icon('checkSq', 'sm')}Παρουσίες</a></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
      <div class="card" style="padding:10px">
        <div style="position:relative;border-radius:12px;overflow:hidden;background:#111;aspect-ratio:4/3">
          <video id="vid" playsinline muted style="width:100%;height:100%;object-fit:cover;${facing === 'user' ? 'transform:scaleX(-1)' : ''}"></video>
          <div style="position:absolute;inset:18%;border:3px solid rgba(255,255,255,.85);border-radius:16px;pointer-events:none"></div>
          <div id="camMsg" style="position:absolute;inset:0;display:grid;place-items:center;color:#fff;text-align:center;padding:16px">
            <div>${icon('qr')}<p>Πατήστε «Κάμερα» για σάρωση QR</p></div></div>
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn grow" id="camBtn">${icon('camera', 'sm')}Κάμερα</button>
          <button class="btn secondary" id="flipBtn" title="Αλλαγή κάμερας">${icon('flip', 'sm')}</button>
          ${nfcSupported() ? `<button class="btn secondary grow" id="nfcBtn">${icon('nfc', 'sm')}NFC</button>` : ''}
        </div>
        <p class="tiny muted" style="margin:8px 0 0">Ο USB αναγνώστης καρτών δουλεύει πάντα σε αυτή την οθόνη (λειτουργεί σαν πληκτρολόγιο).
          ${nfcSupported() ? '' : 'Το NFC υποστηρίζεται μόνο σε Chrome για Android.'}</p>
      </div>
      <div>
        <div class="card center" id="result" style="min-height:220px;display:grid;place-items:center"><div class="muted">
          ${icon('scan')}<p>Δείξτε το QR της κάρτας σας<br>ή περάστε την κάρτα</p></div></div>
        <div class="card"><b>Χειροκίνητα</b><div class="search" style="margin:8px 0 0">${icon('search', 'sm')}<input id="mq" placeholder="Όνομα αθλητή" autocomplete="off"></div>
          <div id="ml"></div></div>
      </div>
    </div>
    <h2 id="tcnt"></h2><div class="card" style="padding:4px 14px" id="tlist"></div>`;

  const drawToday = () => {
    const xs = today.slice().sort((a, b) => b.checked_in_at.localeCompare(a.checked_in_at));
    $('#tcnt').textContent = `Σήμερα: ${new Set(xs.map(x => x.member_id)).size} check-in`;
    $('#tlist').innerHTML = xs.slice(0, 30).map((x, i) => `<div class="row nowrap" style="padding:8px 0;${i ? 'border-top:1px solid var(--line)' : ''}">
      ${avatar(names[x.member_id] || '?')}<b class="grow">${esc(names[x.member_id] || '')}</b>
      <span class="small muted">${new Date(x.checked_in_at).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' })} · ${({ rfid: 'κάρτα', qr: 'QR', manual: 'χειροκ.', workout: 'προπόνηση' })[x.method] || ''}</span></div>`).join('')
      || '<div class="empty">Κανένα check-in ακόμα σήμερα</div>';
  };
  const beep = ok => { try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), gn = a.createGain();
    o.frequency.value = ok ? 880 : 300; gn.gain.value = .15; o.connect(gn); gn.connect(a.destination); o.start(); o.stop(a.currentTime + (ok ? .15 : .4)); } catch {} };

  async function doCheckin(code, method) {
    if (busy || !code) return;
    if (code === lastCode && Date.now() - lastAt < 6000) return;
    busy = true; lastCode = code; lastAt = Date.now();
    try {
      const r = await q(sb.rpc('checkin', { p_gym: g, p_code: code, p_method: method }));
      const [cls, lbl] = SUB[r.status] || SUB.none, bad = ['expired', 'none'].includes(r.status) && r.is_athlete;
      beep(!bad); if (navigator.vibrate) navigator.vibrate(bad ? [200, 100, 200] : 60);
      if (!r.already) { today.push({ member_id: r.member_id, checked_in_at: new Date().toISOString(), method }); drawToday(); }
      $('#result').style.borderColor = bad ? 'var(--bad)' : 'var(--ok)';
      $('#result').innerHTML = `<div><div style="display:flex;justify-content:center;margin-bottom:10px">${avatar(r.name, 'lg')}</div>
        <h1 style="margin:0">${esc(r.name)}</h1>
        <p style="font-size:18px;margin:6px 0">${r.already ? 'Έχετε ήδη κάνει check-in σήμερα' : bad ? 'Παρακαλούμε περάστε από τη γραμματεία' : 'Καλή προπόνηση! 💪'}</p>
        ${r.is_athlete ? `<span class="badge ${cls}" style="font-size:14px;padding:6px 12px">${lbl}</span>
          <p class="small muted" style="margin:8px 0 0">${esc(subLine(r))}</p>` : ''}</div>`;
      const rb = $('#result').getBoundingClientRect(); if (rb.top < 60 || rb.bottom > innerHeight) $('#result').scrollIntoView({ behavior: 'smooth', block: 'center' });
      clearTimeout(resetT);
      resetT = setTimeout(() => { const el = $('#result'); if (!el) return; el.style.borderColor = '';
        el.innerHTML = `<div class="muted">${icon('scan')}<p>Δείξτε το QR της κάρτας σας<br>ή περάστε την κάρτα</p></div>`; }, 7000);
    } catch { beep(false); } finally { busy = false; }
  }

  // --- Κάμερα / QR ---
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
  const detector = ('BarcodeDetector' in window) ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
  let scanT = null;
  async function startCam() {
    stopCam();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 } }, audio: false });
      st.stream = stream; const v = $('#vid'); v.srcObject = stream; await v.play();
      v.style.transform = facing === 'user' ? 'scaleX(-1)' : '';
      $('#camMsg').style.display = 'none'; $('#camBtn').innerHTML = `${icon('x', 'sm')}Διακοπή`;
      scanT = setInterval(scan, 300); st.timers.push(scanT);
    } catch (e) {
      $('#camMsg').style.display = 'grid';
      $('#camMsg').innerHTML = `<div><p>Δεν ήταν δυνατή η πρόσβαση στην κάμερα.</p><p class="small">${esc(e.message)}</p></div>`;
    }
  }
  function stopCam() {
    if (scanT) clearInterval(scanT); scanT = null;
    if (st.stream) { st.stream.getTracks().forEach(t => t.stop()); st.stream = null; }
    const b = $('#camBtn'); if (b) b.innerHTML = `${icon('camera', 'sm')}Κάμερα`;
    const m = $('#camMsg'); if (m) m.style.display = 'grid';
  }
  async function scan() {
    const v = $('#vid'); if (!v || !v.videoWidth || busy) return;
    try {
      let txt = null;
      if (detector) { const r = await detector.detect(v); txt = r[0]?.rawValue || null; }
      else if (window.jsQR) {
        const w = 480, h = Math.round(v.videoHeight * w / v.videoWidth); canvas.width = w; canvas.height = h;
        ctx.drawImage(v, 0, 0, w, h); const r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
        txt = r?.data || null;
      }
      if (txt) doCheckin(txt.trim(), 'qr');
    } catch {}
  }
  $('#camBtn').onclick = () => st.stream ? stopCam() : startCam();
  $('#flipBtn').onclick = () => { facing = facing === 'user' ? 'environment' : 'user'; store.set('cam_facing', facing); if (st.stream) startCam(); };
  st.cleanup.push(stopCam);

  // --- NFC (Android) ---
  const nb = $('#nfcBtn');
  if (nb) nb.onclick = async () => {
    try { const stop = await readNfc(serial => doCheckin(serial, 'rfid')); st.cleanup.push(stop);
      nb.classList.remove('secondary'); nb.innerHTML = `${icon('nfc', 'sm')}NFC ενεργό`; toast('Ακουμπήστε κάρτα στη συσκευή'); }
    catch (e) { toast('NFC: ' + e.message, true); }
  };

  // --- USB RFID (πληκτρολόγιο): γρήγορη σειρά χαρακτήρων + Enter ---
  let buf = '', lastKey = 0;
  const onKey = e => {
    if (e.target.matches('input, textarea, select')) return;
    const now = Date.now(); if (now - lastKey > 120) buf = ''; lastKey = now;
    if (e.key === 'Enter') { if (buf.length >= 4) doCheckin(buf, 'rfid'); buf = ''; return; }
    if (e.key.length === 1) buf += e.key;
  };
  document.addEventListener('keydown', onKey); st.cleanup.push(() => document.removeEventListener('keydown', onKey));

  // --- Χειροκίνητα ---
  $('#mq').oninput = e => { const t = e.target.value.toLowerCase().trim();
    $('#ml').innerHTML = !t ? '' : members.filter(m => m.full_name.toLowerCase().includes(t)).slice(0, 6).map(m =>
      `<button class="card tap list-item" data-c="${m.checkin_code}" style="width:100%;text-align:left;margin:8px 0 0;padding:8px">${avatar(m.full_name)}<b class="grow">${esc(m.full_name)}</b>${icon('check', 'sm')}</button>`).join('');
    $$('[data-c]').forEach(b => b.onclick = () => { $('#mq').value = ''; $('#ml').innerHTML = ''; lastCode = ''; doCheckin(b.dataset.c, 'manual'); }); };
  drawToday();
  if (store.get('cam_auto') === '1') startCam();
};

// =====================================================================
// Συνδρομές (ιδιοκτήτης)
// =====================================================================
function memState(ms) {   // κατάσταση στον client για τον αθλητή
  const t = todayISO();
  const valid = ms.filter(s => s.status === 'active' && s.start_date <= t && (!s.end_date || s.end_date >= t) && (s.kind === 'time' || s.visits_used < s.visits_total));
  const cur = valid[0] || ms.find(s => s.status === 'frozen') || ms.filter(s => s.status !== 'cancelled')[0];
  return { cur, valid: valid.length > 0 };
}
routes.subs = async (view, sub) => {
  sub = sub || 'status';
  view.innerHTML = `<div class="head-row"><h1>Συνδρομές</h1></div>
    <div class="seg">${[['status', 'Αθλητές'], ['payments', 'Πληρωμές'], ['plans', 'Πακέτα']].map(([k, l]) =>
      `<button data-s="${k}" class="${k === sub ? 'active' : ''}">${l}</button>`).join('')}</div><div id="sc"></div>`;
  $$('[data-s]', view).forEach(b => b.onclick = () => location.hash = '#/subs/' + b.dataset.s);
  await SUBS[sub]($('#sc'));
};
const SUBS = {
  async load() {
    const g = st.cur.gym_id;
    const [status, members, plans, mems, pays] = await Promise.all([
      q(sb.rpc('sub_status', { p_gym: g })),
      q(sb.from('gym_members').select('id, full_name, email, phone').eq('gym_id', g).eq('is_athlete', true).eq('status', 'active').order('full_name')),
      q(sb.from('membership_plans').select('*').eq('gym_id', g).order('sort_order')),
      q(sb.from('memberships').select('*').eq('gym_id', g).order('start_date', { ascending: false })),
      q(sb.from('payments').select('*').eq('gym_id', g).order('paid_on', { ascending: false }))
    ]);
    const bal = {};
    mems.filter(m => m.status !== 'cancelled').forEach(m => bal[m.member_id] = (bal[m.member_id] || 0) + +m.price);
    pays.forEach(p => bal[p.member_id] = (bal[p.member_id] || 0) - +p.amount);
    return { status: Object.fromEntries(status.map(s => [s.member_id, s])), members, plans, mems, pays, bal };
  },
  async status(el) {
    const D = await SUBS.load(), month = todayISO().slice(0, 7);
    const cnt = k => D.members.filter(m => (D.status[m.id]?.status || 'none') === k).length;
    const debt = Object.values(D.bal).filter(v => v > 0.009).reduce((a, v) => a + v, 0);
    const income = D.pays.filter(p => p.paid_on.startsWith(month)).reduce((a, p) => a + +p.amount, 0);
    let filter = 'all', search = '';
    el.innerHTML = `<div class="kpis">
        <div class="kpi accent"><b>${money(income)}</b><span>εισπράξεις ${MONTHS[+month.slice(5) - 1].toLowerCase()}</span></div>
        <div class="kpi"><b style="color:${debt ? 'var(--bad)' : 'inherit'}">${money(debt)}</b><span>οφειλές</span></div>
        <div class="kpi"><b>${cnt('active') + cnt('expiring')}</b><span>ενεργές</span></div>
        <div class="kpi"><b style="color:${cnt('expired') ? 'var(--bad)' : 'inherit'}">${cnt('expired') + cnt('none')}</b><span>ληγμένες / χωρίς</span></div></div>
      ${!D.plans.length ? `<div class="card" style="border-color:#fde68a;background:#fffbeb">Ορίστε πρώτα τα <a href="#/subs/plans">πακέτα</a> του γυμναστηρίου.</div>` : ''}
      <div class="search">${icon('search', 'sm')}<input id="q" placeholder="Αναζήτηση αθλητή"></div>
      <div class="chips" id="flt">${[['all', 'Όλοι', D.members.length, 'b-muted'], ['expiring', 'Λήγουν', cnt('expiring'), 'b-warn'],
        ['expired', 'Ληγμένες', cnt('expired'), 'b-bad'], ['debt', 'Οφειλή', D.members.filter(m => D.bal[m.id] > 0.009).length, 'b-bad'],
        ['none', 'Χωρίς', cnt('none'), 'b-muted'], ['frozen', 'Πάγωμα', cnt('frozen'), 'b-info']].map(([k, l, n, c]) =>
        `<button class="chip ${k === 'all' ? 'active' : ''}" data-f="${k}">${l} <span class="badge ${c}">${n}</span></button>`).join('')}</div>
      <div class="grid cols-2" id="list"></div>`;
    const draw = () => {
      const xs = D.members.filter(m => { const s = D.status[m.id]?.status || 'none';
        return (filter === 'all' || (filter === 'debt' ? D.bal[m.id] > 0.009 : s === filter)) && m.full_name.toLowerCase().includes(search); });
      $('#list').innerHTML = xs.map(m => { const s = D.status[m.id] || { status: 'none' }, [c, l] = SUB[s.status], b = D.bal[m.id] || 0;
        return `<div class="card"><div class="list-item tap" data-m="${m.id}" style="cursor:pointer">${avatar(m.full_name)}<div class="grow" style="min-width:0">
          <div class="row between nowrap"><b class="ellipsis">${esc(m.full_name)}</b><span class="badge ${c}">${l}</span></div>
          <div class="small muted">${esc(subLine(s))}</div>
          ${b > 0.009 ? `<span class="badge b-bad" style="margin-top:4px">Οφειλή ${money(b)}</span>` : ''}</div></div>
          ${['expiring', 'expired', 'none'].includes(s.status) || b > 0.009 ? `<div class="row" style="margin-top:10px">
            ${['expiring', 'expired', 'none'].includes(s.status) ? `<button class="btn small grow" data-renew="${m.id}">${icon('plus', 'sm')}${s.status === 'none' ? 'Νέα συνδρομή' : 'Ανανέωση'}</button>` : ''}
            ${b > 0.009 ? `<button class="btn secondary small grow" data-pay="${m.id}">${icon('euro', 'sm')}Πληρωμή</button>` : ''}</div>` : ''}</div>`; }).join('')
        || '<div class="card empty">Κανένας αθλητής</div>';
      $$('[data-m]').forEach(b => b.onclick = () => SUBS.memberSheet(b.dataset.m, D));
      $$('[data-renew]').forEach(b => b.onclick = () => SUBS.newSheet(b.dataset.renew, D));
      $$('[data-pay]').forEach(b => b.onclick = () => SUBS.paySheet(b.dataset.pay, D));
    };
    $('#q').oninput = e => { search = e.target.value.toLowerCase(); draw(); };
    $$('#flt .chip').forEach(c => c.onclick = () => { filter = c.dataset.f; $$('#flt .chip').forEach(x => x.classList.toggle('active', x === c)); draw(); });
    draw();
  },
  memberSheet(id, D) {
    const m = D.members.find(x => x.id === id), s = D.status[id] || { status: 'none' }, b = D.bal[id] || 0;
    const ms = D.mems.filter(x => x.member_id === id), ps = D.pays.filter(x => x.member_id === id);
    const cur = memState(ms).cur;
    sheet(m.full_name, `
      <div class="card" style="background:#f9fafb"><div class="row between"><span class="badge ${SUB[s.status][0]}">${SUB[s.status][1]}</span>
        <b style="color:${b > 0.009 ? 'var(--bad)' : 'var(--ok)'}">${b > 0.009 ? 'Οφειλή ' + money(b) : b < -0.009 ? 'Προπληρωμή ' + money(-b) : 'Εξοφλημένος'}</b></div>
        <p style="margin:8px 0 0">${esc(subLine(s))}</p></div>
      <div class="row" style="margin-bottom:8px"><button class="btn grow" data-a="new">${icon('plus', 'sm')}${cur ? 'Ανανέωση' : 'Νέα συνδρομή'}</button>
        <button class="btn secondary grow" data-a="pay">${icon('euro', 'sm')}Πληρωμή</button></div>
      ${cur && cur.status !== 'cancelled' ? `<div class="row"><button class="btn secondary small grow" data-a="freeze">${cur.status === 'frozen' ? 'Ξεπάγωμα' : 'Πάγωμα'}</button>
        <button class="btn danger small grow" data-a="cancel">Ακύρωση συνδρομής</button></div>` : ''}
      <h2>Συνδρομές</h2>${ms.map(x => `<div class="row nowrap" style="padding:8px 0;border-top:1px solid var(--line);${x.status === 'cancelled' ? 'opacity:.5' : ''}">
        <div class="grow"><b>${esc(x.plan_name)}</b><div class="small muted">${fmtDate(x.start_date)}${x.end_date ? ' – ' + fmtDate(x.end_date) : ''}
          ${x.kind === 'visits' ? ` · ${x.visits_used}/${x.visits_total} επισκέψεις` : ''}${x.frozen_days ? ` · πάγωμα ${x.frozen_days} ημ.` : ''}
          ${x.status === 'cancelled' ? ' · ακυρωμένη' : x.status === 'frozen' ? ' · σε πάγωμα' : ''}</div></div><b>${money(x.price)}</b></div>`).join('') || '<p class="muted">—</p>'}
      <h2>Πληρωμές</h2>${ps.map(x => `<div class="row nowrap" style="padding:8px 0;border-top:1px solid var(--line)">
        <div class="grow"><b>${money(x.amount)}</b><div class="small muted">${fmtDate(x.paid_on)} · ${METHOD[x.method]}${x.notes ? ' · ' + esc(x.notes) : ''}</div></div>
        <button class="icon-btn" data-delpay="${x.id}" title="Διαγραφή" style="color:var(--bad)">${icon('x', 'sm')}</button></div>`).join('') || '<p class="muted">—</p>'}
      ${m.phone ? `<a class="btn secondary block" style="margin-top:12px" href="tel:${esc(m.phone)}">Κλήση ${esc(m.phone)}</a>` : ''}`, (el, close) => {
      $('[data-a="new"]', el).onclick = () => { close(); SUBS.newSheet(id, D); };
      $('[data-a="pay"]', el).onclick = () => { close(); SUBS.paySheet(id, D); };
      const fz = $('[data-a="freeze"]', el);
      if (fz) fz.onclick = async () => { await q(sb.rpc('freeze_membership', { p_id: cur.id, p_freeze: cur.status !== 'frozen' })); close();
        toast(cur.status === 'frozen' ? 'Η λήξη μετατέθηκε κατά τις ημέρες παγώματος' : 'Η συνδρομή πάγωσε'); route(); };
      const cn = $('[data-a="cancel"]', el);
      if (cn) cn.onclick = () => { close(); confirmSheet('Ακύρωση συνδρομής', `${cur.plan_name}: η συνδρομή ακυρώνεται και δεν μετράει στην οφειλή.`, 'Ακύρωση συνδρομής', async () => {
        await q(sb.from('memberships').update({ status: 'cancelled' }).eq('id', cur.id)); route(); }, true); };
      $$('[data-delpay]', el).forEach(bt => bt.onclick = () => { close(); confirmSheet('Διαγραφή πληρωμής', 'Η πληρωμή θα διαγραφεί οριστικά.', 'Διαγραφή', async () => {
        await q(sb.from('payments').delete().eq('id', bt.dataset.delpay)); route(); }, true); });
    });
  },
  newSheet(id, D) {
    const m = D.members.find(x => x.id === id), plans = D.plans.filter(p => p.active);
    if (!plans.length) { toast('Ορίστε πρώτα πακέτα', true); location.hash = '#/subs/plans'; return; }
    const last = D.mems.find(x => x.member_id === id && x.status !== 'cancelled');
    const def = plans.find(p => p.id === last?.plan_id) || plans[0];
    sheet('Συνδρομή · ' + m.full_name, `<form id="nf">
      <div class="field"><label>Πακέτο</label><select name="plan">${plans.map(p => `<option value="${p.id}" ${p.id === def.id ? 'selected' : ''}>${esc(p.name)} · ${money(p.price)}</option>`).join('')}</select></div>
      <div class="form-grid"><div class="field"><label>Έναρξη</label>${dateField('nstart', '')}<div class="tiny muted" style="margin-top:4px">Κενό = αμέσως ή μετά τη λήξη της τρέχουσας</div></div>
        <div class="field"><label>Τιμή (€)</label><input name="price" type="number" step="0.01" inputmode="decimal" value="${def.price}"></div></div>
      <div class="form-grid"><div class="field"><label>Πληρώθηκαν τώρα (€)</label><input name="paid" type="number" step="0.01" inputmode="decimal" value="${def.price}"></div>
        <div class="field"><label>Τρόπος</label><select name="method">${Object.entries(METHOD).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div></div>
      <div class="field"><label>Σημείωση</label><input name="notes" placeholder="π.χ. έκπτωση φοιτητή"></div>
      <button class="btn block">Καταχώρηση</button></form>`, (el, close) => {
      bindDate('nstart'); $('[data-show="nstart"]', el).textContent = 'Αυτόματα';
      const f = $('#nf', el);
      f.plan.onchange = () => { const p = plans.find(x => x.id === f.plan.value); f.price.value = p.price; f.paid.value = p.price; };
      f.price.oninput = () => { f.paid.value = f.price.value; };
      f.onsubmit = async e => { e.preventDefault();
        try { await q(sb.rpc('new_membership', { p_member: id, p_plan: f.plan.value, p_start: $('#nstart').value || null,
            p_price: num(f.price.value), p_paid: num(f.paid.value) || 0, p_method: f.method.value, p_notes: f.notes.value || null }));
          close(); toast('Η συνδρομή καταχωρήθηκε'); route(); } catch {} };
    });
  },
  paySheet(id, D) {
    const m = D.members.find(x => x.id === id), b = Math.max(0, D.bal[id] || 0);
    const cur = memState(D.mems.filter(x => x.member_id === id)).cur;
    sheet('Πληρωμή · ' + m.full_name, `<form id="pf">${b > 0.009 ? `<p>Οφειλή: <b style="color:var(--bad)">${money(b)}</b></p>` : ''}
      <div class="form-grid"><div class="field"><label>Ποσό (€)</label><input name="amount" type="number" step="0.01" inputmode="decimal" required value="${b ? b.toFixed(2) : ''}"></div>
        <div class="field"><label>Τρόπος</label><select name="method">${Object.entries(METHOD).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="field"><label>Ημερομηνία</label>${dateField('pdate', todayISO())}</div></div>
      <div class="field"><label>Σημείωση</label><input name="notes"></div>
      <p class="tiny muted">Η εφαρμογή καταγράφει την πληρωμή. Η απόδειξη εκδίδεται από το σύστημα τιμολόγησης του γυμναστηρίου.</p>
      <button class="btn block">Καταχώρηση πληρωμής</button></form>`, (el, close) => {
      bindDate('pdate');
      $('#pf', el).onsubmit = async e => { e.preventDefault(); const f = e.target;
        try { await q(sb.from('payments').insert({ gym_id: st.cur.gym_id, member_id: id, membership_id: cur?.id || null, amount: num(f.amount.value),
            method: f.method.value, paid_on: $('#pdate').value || todayISO(), notes: f.notes.value || null }));
          close(); toast('Η πληρωμή καταχωρήθηκε'); route(); } catch {} };
    });
  },
  async payments(el) {
    const D = await SUBS.load(); let ym = todayISO().slice(0, 7);
    const names = Object.fromEntries(D.members.map(m => [m.id, m.full_name]));
    const allNames = Object.fromEntries((await q(sb.from('gym_members').select('id, full_name').eq('gym_id', st.cur.gym_id))).map(m => [m.id, m.full_name]));
    el.innerHTML = `<div class="card row between nowrap" style="padding:8px"><button class="icon-btn" id="pm">${icon('left')}</button>
      <b id="ml" class="center grow"></b><button class="icon-btn" id="nm">${icon('right')}</button></div><div id="pc"></div>`;
    const draw = () => {
      const [y, mo] = ym.split('-').map(Number); $('#ml').textContent = `${MONTHS[mo - 1]} ${y}`;
      $('#nm').disabled = ym >= todayISO().slice(0, 7);
      const xs = D.pays.filter(p => p.paid_on.startsWith(ym)), tot = xs.reduce((a, p) => a + +p.amount, 0);
      const byM = groupBy(xs, p => p.method);
      const sold = D.mems.filter(m => m.status !== 'cancelled' && m.start_date.startsWith(ym));
      $('#pc').innerHTML = `<div class="kpis"><div class="kpi accent"><b>${money(tot)}</b><span>εισπράξεις</span></div>
        <div class="kpi"><b>${xs.length}</b><span>πληρωμές</span></div><div class="kpi"><b>${sold.length}</b><span>νέες συνδρομές</span></div></div>
        ${xs.length ? `<div class="card"><b>Ανά τρόπο πληρωμής</b>${[...byM].map(([k, ys]) => { const v = ys.reduce((a, p) => a + +p.amount, 0);
          return `<div style="margin-top:8px"><div class="row between small"><span>${METHOD[k]}</span><b>${money(v)}</b></div>
          <div class="meter"><i style="width:${tot ? 100 * v / tot : 0}%;background:var(--brand)"></i></div></div>`; }).join('')}</div>` : ''}
        <div class="card" style="padding:4px 14px">${xs.map((p, i) => `<div class="row nowrap" style="padding:10px 0;${i ? 'border-top:1px solid var(--line)' : ''}">
          ${avatar(allNames[p.member_id] || names[p.member_id] || '?')}<div class="grow"><b>${esc(allNames[p.member_id] || '')}</b>
          <div class="small muted">${fmtDate(p.paid_on)} · ${METHOD[p.method]}</div></div><b>${money(p.amount)}</b></div>`).join('') || '<div class="empty">Καμία πληρωμή</div>'}</div>`;
    };
    $('#pm').onclick = () => { const d = new Date(ym + '-15'); d.setMonth(d.getMonth() - 1); ym = isoOf(d).slice(0, 7); draw(); };
    $('#nm').onclick = () => { const d = new Date(ym + '-15'); d.setMonth(d.getMonth() + 1); ym = isoOf(d).slice(0, 7); draw(); };
    draw();
  },
  async plans(el) {
    const plans = await q(sb.from('membership_plans').select('*').eq('gym_id', st.cur.gym_id).order('sort_order'));
    el.innerHTML = `<div class="row between" style="margin-bottom:12px"><span class="muted small">Τα πακέτα που πουλάει το γυμναστήριο</span>
      <button class="btn small" id="np">${icon('plus', 'sm')}Πακέτο</button></div>
      <div class="grid cols-2">${plans.map(p => `<button class="card tap list-item" data-p="${p.id}" style="text-align:left;width:100%;${p.active ? '' : 'opacity:.5'}">
        <div class="logo" style="background:var(--brand-soft);color:var(--brand)">${icon(p.kind === 'time' ? 'clock' : 'checkSq')}</div>
        <div class="grow"><b>${esc(p.name)}</b><div class="small muted">${p.kind === 'time' ? `${p.months} ${p.months === 1 ? 'μήνας' : 'μήνες'}` :
          `${p.visits} επισκέψεις${p.valid_days ? ` · ισχύ ${p.valid_days} ημ.` : ''}`}${p.active ? '' : ' · ανενεργό'}</div></div>
        <b style="font-size:18px">${money(p.price)}</b></button>`).join('') || '<div class="card empty">Κανένα πακέτο ακόμα</div>'}</div>`;
    const edit = p => {
      const isNew = !p; p = p || { kind: 'time', months: 1, price: '', active: true };
      sheet(isNew ? 'Νέο πακέτο' : p.name, `<form id="plf">
        <div class="field"><label>Όνομα</label><input name="name" required value="${esc(p.name || '')}" placeholder="π.χ. Μηνιαίο kickboxing"></div>
        <div class="seg" id="kseg"><button type="button" data-k="time" class="${p.kind === 'time' ? 'active' : ''}">Χρονικό</button>
          <button type="button" data-k="visits" class="${p.kind === 'visits' ? 'active' : ''}">Επισκέψεις</button></div>
        <div class="form-grid"><div class="field" data-for="time"><label>Μήνες</label><input name="months" type="number" min="1" value="${p.months ?? 1}"></div>
          <div class="field" data-for="visits"><label>Επισκέψεις</label><input name="visits" type="number" min="1" value="${p.visits ?? 10}"></div>
          <div class="field" data-for="visits"><label>Ισχύ (ημέρες, προαιρετικό)</label><input name="valid_days" type="number" min="1" value="${p.valid_days ?? ''}"></div>
          <div class="field"><label>Τιμή (€)</label><input name="price" type="number" step="0.01" inputmode="decimal" required value="${p.price}"></div></div>
        <label class="check" style="margin-bottom:14px"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}>Ενεργό (εμφανίζεται στις νέες συνδρομές)</label>
        <button class="btn block">Αποθήκευση</button></form>`, (el2, close) => {
        let kind = p.kind; const f = $('#plf', el2);
        const sync = () => { $$('[data-for]', el2).forEach(x => x.style.display = x.dataset.for === kind ? '' : 'none');
          $$('#kseg button', el2).forEach(x => x.classList.toggle('active', x.dataset.k === kind)); };
        $$('#kseg button', el2).forEach(x => x.onclick = () => { kind = x.dataset.k; sync(); }); sync();
        f.onsubmit = async e => { e.preventDefault();
          const row = { gym_id: st.cur.gym_id, name: f.name.value.trim(), kind, price: num(f.price.value) || 0, active: f.active.checked,
            months: kind === 'time' ? num(f.months.value) : null, visits: kind === 'visits' ? num(f.visits.value) : null,
            valid_days: kind === 'visits' ? num(f.valid_days.value) : null };
          if (isNew) row.sort_order = plans.length + 1;
          await q(isNew ? sb.from('membership_plans').insert(row) : sb.from('membership_plans').update(row).eq('id', p.id));
          close(); toast('Αποθηκεύτηκε'); route(); };
      });
    };
    $('#np').onclick = () => edit(null);
    $$('[data-p]').forEach(b => b.onclick = () => edit(plans.find(p => p.id === b.dataset.p)));
  }
};

// =====================================================================
// Αθλητής: η κάρτα μου (QR check-in + συνδρομή + πληρωμές)
// =====================================================================
routes.card = async view => {
  const id = st.cur.member_id;
  const [me, ms, ps] = await Promise.all([
    q(sb.from('gym_members').select('full_name, checkin_code').eq('id', id).single()),
    q(sb.from('memberships').select('*').eq('member_id', id).order('start_date', { ascending: false })),
    q(sb.from('payments').select('*').eq('member_id', id).order('paid_on', { ascending: false }))
  ]);
  const { cur, valid } = memState(ms);
  const bal = ms.filter(m => m.status !== 'cancelled').reduce((a, m) => a + +m.price, 0) - ps.reduce((a, p) => a + +p.amount, 0);
  const left = cur?.end_date ? Math.round((new Date(cur.end_date + 'T12:00:00') - new Date(todayISO() + 'T12:00:00')) / 864e5) : null;
  const status = !cur ? 'none' : cur.status === 'frozen' ? 'frozen' : !valid ? 'expired'
    : ((left != null && left <= 7) || (cur.kind === 'visits' && cur.visits_total - cur.visits_used <= 2)) ? 'expiring' : 'active';
  view.innerHTML = `<h1>Η κάρτα μου</h1>
    <div class="card center" style="background:var(--brand-2);color:#fff;border:0">
      <div class="row nowrap" style="justify-content:center;margin-bottom:10px"><b>${esc(st.cur.gym_name)}</b></div>
      <div style="background:#fff;border-radius:16px;padding:12px;display:inline-block">${me.checkin_code ? qrSvg('OGYM:' + me.checkin_code, 230) : ''}</div>
      <h2 style="margin:12px 0 2px;color:#fff">${esc(me.full_name)}</h2>
      <div class="small" style="opacity:.75">Δείξτε το QR στην κάμερα check-in του γυμναστηρίου</div></div>
    <div class="card"><div class="row between"><b>Συνδρομή</b><span class="badge ${SUB[status][0]}">${SUB[status][1]}</span></div>
      ${cur ? `<h2 style="margin:10px 0 4px">${esc(cur.plan_name)}</h2>
        ${cur.kind === 'visits' ? `<div class="row between small"><span>Επισκέψεις</span><b>${cur.visits_total - cur.visits_used} από ${cur.visits_total}</b></div>
          <div class="meter" style="margin:6px 0 8px"><i style="width:${100 * (cur.visits_total - cur.visits_used) / cur.visits_total}%;background:var(--brand)"></i></div>` : ''}
        ${cur.end_date ? `<div class="small">Ισχύει ${fmtDate(cur.start_date)} – <b>${fmtDate(cur.end_date)}</b>${left != null && left >= 0 ? ` · απομένουν ${left} ημέρες` : ''}</div>` : ''}
        ${cur.status === 'frozen' ? `<p class="small">Σε πάγωμα από ${fmtDate(cur.frozen_from)}. Η λήξη θα μετατεθεί.</p>` : ''}`
      : '<p class="muted">Δεν υπάρχει συνδρομή. Επικοινωνήστε με το γυμναστήριο.</p>'}
      ${bal > 0.009 ? `<p style="margin:10px 0 0"><span class="badge b-bad">Υπόλοιπο προς εξόφληση ${money(bal)}</span></p>` : ''}</div>
    ${ps.length ? `<h2>Πληρωμές</h2><div class="card" style="padding:4px 14px">${ps.map((p, i) => `<div class="row nowrap" style="padding:10px 0;${i ? 'border-top:1px solid var(--line)' : ''}">
      <div class="grow">${fmtDate(p.paid_on)}<div class="small muted">${METHOD[p.method]}</div></div><b>${money(p.amount)}</b></div>`).join('')}</div>` : ''}`;
};

// =====================================================================
// Διαχείριση πλατφόρμας
// =====================================================================
const PLAN = { trial: ['b-info', 'Δοκιμαστικό'], basic: ['b-muted', 'Basic'], pro: ['b-brand', 'Pro'], free: ['b-ok', 'Δωρεάν'] };
const GSTAT = { pending: ['b-warn', 'Σε αναμονή'], active: ['b-ok', 'Ενεργό'], suspended: ['b-bad', 'Σε αναστολή'] };
routes.admin = async (view, sub) => {
  sub = sub || 'gyms';
  view.innerHTML = `<h1>Διαχείριση</h1>
    <div class="seg">${[['gyms', 'Γυμναστήρια'], ['library', 'Ασκήσεις'], ['platform', 'Ρυθμίσεις'], ['admins', 'Admins']].map(([k, l]) =>
      `<button data-s="${k}" class="${k === sub ? 'active' : ''}">${l}</button>`).join('')}</div><div id="ac"></div>`;
  $$('[data-s]', view).forEach(b => b.onclick = () => location.hash = '#/admin/' + b.dataset.s);
  await ADMIN[sub]($('#ac'));
};
const ADMIN = {
  async gyms(el) {
    const [gyms, stats] = await Promise.all([q(sb.from('gyms').select('*').order('created_at', { ascending: false })), q(sb.rpc('admin_gym_stats'))]);
    const S = Object.fromEntries(stats.map(s => [s.gym_id, s]));
    let filter = 'all';
    el.innerHTML = `<div class="kpis">${['pending', 'active', 'suspended'].map(s => `<div class="kpi ${s === 'pending' && gyms.some(g => g.status === s) ? 'accent' : ''}">
      <b>${gyms.filter(g => g.status === s).length}</b><span>${GSTAT[s][1]}</span></div>`).join('')}
      <div class="kpi"><b>${stats.reduce((a, s) => a + s.athletes, 0)}</b><span>αθλητές συνολικά</span></div></div>
      <div class="chips" id="flt"><button class="chip active" data-f="all">Όλα</button>${Object.entries(GSTAT).map(([k, [, l]]) => `<button class="chip" data-f="${k}">${l}</button>`).join('')}</div>
      <div class="grid cols-2" id="gl"></div>`;
    const draw = () => {
      $('#gl').innerHTML = gyms.filter(g => filter === 'all' || g.status === filter).map(g => { const s = S[g.id] || {}, exp = g.paid_until && g.paid_until < todayISO();
        return `<button class="card tap" data-g="${g.id}" style="text-align:left;width:100%"><div class="list-item">
          <div class="logo" style="background:${esc(g.primary_color)}">${esc(g.name.slice(0, 2).toUpperCase())}</div>
          <div class="grow"><b>${esc(g.name)}</b><div class="small muted">${esc(g.city || '—')} · εγγραφή ${fmtDate(g.created_at)}</div></div>
          <span class="badge ${GSTAT[g.status][0]}">${GSTAT[g.status][1]}</span></div>
          <div class="row small" style="margin-top:10px;gap:14px"><span><b>${s.athletes ?? 0}</b>/${g.max_athletes} αθλητές</span>
            <span><b>${s.sessions_30d ?? 0}</b> προπ. 30ημ.</span><span class="muted">τελ. ${fmtDate(s.last_activity)}</span></div>
          <div class="row" style="margin-top:8px;gap:6px"><span class="badge ${(PLAN[g.plan] || PLAN.basic)[0]}">${(PLAN[g.plan] || [, g.plan])[1]}</span>
            <span class="badge ${exp ? 'b-bad' : 'b-muted'}">έως ${fmtDate(g.paid_until)}</span></div></button>`; }).join('') || '<div class="card empty">Κανένα γυμναστήριο</div>';
      $$('[data-g]').forEach(b => b.onclick = () => ADMIN.gymSheet(gyms.find(g => g.id === b.dataset.g), S[b.dataset.g]));
    };
    $$('#flt .chip').forEach(c => c.onclick = () => { filter = c.dataset.f; $$('#flt .chip').forEach(x => x.classList.toggle('active', x === c)); draw(); });
    draw();
  },
  gymSheet(g, s = {}) {
    sheet(g.name, `<div class="row" style="gap:6px;margin-bottom:12px"><span class="badge ${GSTAT[g.status][0]}">${GSTAT[g.status][1]}</span>
        <span class="badge b-muted">${s.members ?? 0} μέλη · ${s.coaches ?? 0} προπονητές · ${s.linked ?? 0} με λογαριασμό</span></div>
      <div class="row" style="margin-bottom:14px">${g.status !== 'active' ? `<button class="btn grow" data-st="1">${icon('check', 'sm')}Έγκριση</button>` :
        `<button class="btn danger grow" data-st="0">Αναστολή</button>`}</div>
      <form id="gf"><div class="form-grid">
        <div class="field"><label>Όνομα</label><input name="name" value="${esc(g.name)}"></div>
        <div class="field"><label>Πόλη</label><input name="city" value="${esc(g.city || '')}"></div>
        <div class="field"><label>Τηλέφωνο</label><input name="phone" value="${esc(g.phone || '')}"></div>
        <div class="field"><label>Πακέτο</label><select name="plan">${Object.entries(PLAN).map(([k, [, l]]) => `<option value="${k}" ${k === g.plan ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>Μέγιστοι αθλητές</label><input name="max_athletes" type="number" min="1" value="${g.max_athletes}"></div>
        <div class="field"><label>Ισχύει έως</label>${dateField('gpaid', g.paid_until || '')}</div>
        <div class="field"><label>Κύριο χρώμα</label><input name="primary_color" type="color" value="${esc(g.primary_color)}"></div>
        <div class="field"><label>Σκούρο χρώμα</label><input name="secondary_color" type="color" value="${esc(g.secondary_color)}"></div></div>
        <div class="field"><label>Σημειώσεις διαχείρισης</label><textarea name="admin_notes" rows="2">${esc(g.admin_notes || '')}</textarea></div>
        <button class="btn block">Αποθήκευση</button></form>`, (el, close) => {
      bindDate('gpaid');
      $$('[data-st]', el).forEach(b => b.onclick = async () => { await q(sb.rpc('approve_gym', { p_gym: g.id, p_active: b.dataset.st === '1' }));
        close(); toast(b.dataset.st === '1' ? 'Εγκρίθηκε' : 'Τέθηκε σε αναστολή'); route(); });
      $('#gf', el).onsubmit = async e => { e.preventDefault(); const f = e.target;
        await q(sb.from('gyms').update({ name: f.name.value, city: f.city.value || null, phone: f.phone.value || null, plan: f.plan.value,
          max_athletes: num(f.max_athletes.value) || 30, paid_until: $('#gpaid').value || null, primary_color: f.primary_color.value,
          secondary_color: f.secondary_color.value, admin_notes: f.admin_notes.value || null }).eq('id', g.id));
        close(); toast('Αποθηκεύτηκε'); route(); };
    });
  },
  async library(el) {
    const lib = await q(sb.from('exercise_library').select('*').order('muscle_group').order('name_el'));
    let search = '';
    el.innerHTML = `<div class="row nowrap" style="margin-bottom:12px"><div class="search grow" style="margin:0">${icon('search', 'sm')}<input id="q" placeholder="Αναζήτηση στη βιβλιοθήκη (${lib.length})"></div>
      <button class="btn small" id="newL">${icon('plus', 'sm')}Νέα</button></div><p class="small muted">Η βιβλιοθήκη είναι κοινή για όλα τα γυμναστήρια. Από εδώ προσθέτουν ασκήσεις και από εδώ θα αντιστοιχίζει το AI τις φωτογραφίες εξοπλισμού.</p><div id="ll"></div>`;
    const draw = () => { const xs = lib.filter(l => (l.name_el + ' ' + (l.name_en || '')).toLowerCase().includes(search));
      $('#ll').innerHTML = [...groupBy(xs, l => l.muscle_group)].map(([g, ys]) => `<h2>${esc(g)}</h2><div class="grid cols-3">${ys.map(l => `
        <button class="card tap list-item" data-l="${l.id}" style="text-align:left;width:100%">${Stickman.svg(l.code)}<div class="grow"><b>${esc(l.name_el)}</b>
        <div class="small muted">${esc(l.name_en || '')} · ${esc(metricLabel[l.metric_type])}</div><div class="tiny muted">${esc(l.equipment_type)}</div></div></button>`).join('')}</div>`).join('');
      $$('[data-l]').forEach(b => b.onclick = () => ADMIN.libSheet(lib.find(l => l.id === b.dataset.l), lib)); };
    $('#q').oninput = e => { search = e.target.value.toLowerCase(); draw(); };
    $('#newL').onclick = () => ADMIN.libSheet(null, lib);
    draw();
  },
  libSheet(l, lib) {
    const isNew = !l; l = l || { metric_type: 'reps_weight', default_increment_kg: 2.5, motion: 'stand' };
    sheet(isNew ? 'Νέα άσκηση βιβλιοθήκης' : l.name_el, `<form id="lf"><div class="form-grid">
      <div class="field"><label>Όνομα (ελληνικά)</label><input name="name_el" required value="${esc(l.name_el || '')}"></div>
      <div class="field"><label>Όνομα (αγγλικά)</label><input name="name_en" value="${esc(l.name_en || '')}"></div>
      <div class="field"><label>Μυϊκή ομάδα</label><input name="muscle_group" required list="mg" value="${esc(l.muscle_group || '')}">
        <datalist id="mg">${[...new Set(lib.map(x => x.muscle_group))].map(g => `<option>${esc(g)}</option>`).join('')}</datalist></div>
      <div class="field"><label>Εξοπλισμός</label><input name="equipment_type" required list="eq" value="${esc(l.equipment_type || '')}">
        <datalist id="eq">${[...new Set(lib.map(x => x.equipment_type))].map(g => `<option>${esc(g)}</option>`).join('')}</datalist></div>
      <div class="field"><label>Μέτρηση</label><select name="metric_type">${Object.entries(metricLabel).map(([k, v]) => `<option value="${k}" ${k === l.metric_type ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>Βήμα αύξησης (κ.)</label><input name="inc" type="number" step="0.5" value="${fmtNum(l.default_increment_kg)}"></div></div>
      <div class="field"><label>Κίνηση stickman</label><div class="row nowrap"><select name="motion" class="grow">${Stickman.motions.map(m =>
        `<option value="${m}" ${m === (l.motion || 'stand') ? 'selected' : ''}>${esc(Stickman.labels[m] || m)}</option>`).join('')}</select><div id="mp"></div></div></div>
      <div class="field"><label>Οδηγίες εκτέλεσης</label><textarea name="cues" rows="2">${esc(l.cues || '')}</textarea></div>
      <button class="btn block">Αποθήκευση</button></form>`, (el, close) => {
      const f = $('#lf', el), prev = () => $('#mp', el).innerHTML = Stickman.svgMotion(f.motion.value); f.motion.onchange = prev; prev();
      f.onsubmit = async e => { e.preventDefault();
        const row = { name_el: f.name_el.value.trim(), name_en: f.name_en.value.trim() || null, muscle_group: f.muscle_group.value.trim(),
          equipment_type: f.equipment_type.value.trim(), metric_type: f.metric_type.value, default_increment_kg: num(f.inc.value) ?? 0,
          motion: f.motion.value, cues: f.cues.value || null };
        if (isNew) row.code = (row.name_en || row.name_el).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + Date.now().toString(36).slice(-4);
        await q(isNew ? sb.from('exercise_library').insert(row) : sb.from('exercise_library').update(row).eq('id', l.id));
        Stickman.setMap({ [row.code || l.code]: row.motion }); close(); toast('Αποθηκεύτηκε'); route(); };
    });
  },
  async platform(el) {
    const p = await q(sb.from('platform_settings').select('*').eq('id', 1).single());
    el.innerHTML = `<form id="pf">
      <div class="card"><h3>Νέα γυμναστήρια</h3><label class="check" style="margin:10px 0 14px"><input type="checkbox" name="allow_gym_signup" ${p.allow_gym_signup ? 'checked' : ''}>Επιτρέπονται νέες αιτήσεις εγγραφής</label>
        <div class="form-grid"><div class="field"><label>Αρχικό πακέτο</label><select name="default_plan">${Object.entries(PLAN).map(([k, [, l]]) => `<option value="${k}" ${k === p.default_plan ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label>Μέγιστοι αθλητές</label><input name="default_max_athletes" type="number" value="${p.default_max_athletes}"></div>
          <div class="field"><label>Ημέρες δοκιμής</label><input name="default_trial_days" type="number" value="${p.default_trial_days}"></div>
          <div class="field"><label>Κύριο χρώμα</label><input name="default_primary_color" type="color" value="${esc(p.default_primary_color)}"></div>
          <div class="field"><label>Σκούρο χρώμα</label><input name="default_secondary_color" type="color" value="${esc(p.default_secondary_color)}"></div></div></div>
      <div class="card"><h3>Προεπιλεγμένοι κανόνες προόδου</h3><p class="small muted">Εφαρμόζονται σε κάθε νέο γυμναστήριο. Ο ιδιοκτήτης μπορεί να τους αλλάξει.</p>
        <div class="form-grid">${PROG_FIELDS.map(([k, l]) => `<div class="field"><label>${l}</label><input name="${k}" type="number" step="0.5" value="${fmtNum(p[k])}"></div>`).join('')}</div></div>
      <button class="btn block">Αποθήκευση</button></form>`;
    $('#pf').onsubmit = async e => { e.preventDefault(); const f = e.target;
      const upd = { allow_gym_signup: f.allow_gym_signup.checked, default_plan: f.default_plan.value, default_max_athletes: num(f.default_max_athletes.value),
        default_trial_days: num(f.default_trial_days.value), default_primary_color: f.default_primary_color.value,
        default_secondary_color: f.default_secondary_color.value, updated_at: new Date().toISOString() };
      PROG_FIELDS.forEach(([k]) => upd[k] = num(f[k].value));
      await q(sb.from('platform_settings').update(upd).eq('id', 1)); toast('Αποθηκεύτηκε'); };
  },
  async admins(el) {
    const list = await q(sb.rpc('admin_list_admins'));
    el.innerHTML = `<div class="card">${list.map((a, i) => `<div class="row nowrap" style="padding:10px 0;${i ? 'border-top:1px solid var(--line)' : ''}">
      ${avatar(a.email)}<div class="grow"><b>${esc(a.email)}</b><div class="small muted">από ${fmtDate(a.created_at)}</div></div>
      ${a.user_id !== st.user.id ? `<button class="btn danger small" data-rm="${a.user_id}">Αφαίρεση</button>` : '<span class="badge b-muted">εσείς</span>'}</div>`).join('')}</div>
      <form class="card" id="af"><h3>Νέος διαχειριστής</h3><p class="small muted">Ο χρήστης πρέπει να έχει ήδη λογαριασμό.</p>
        <div class="row nowrap"><input name="email" type="email" required placeholder="email" class="grow"><button class="btn">Προσθήκη</button></div></form>`;
    $$('[data-rm]').forEach(b => b.onclick = () => confirmSheet('Αφαίρεση διαχειριστή', 'Ο χρήστης δεν θα έχει πλέον πρόσβαση στη διαχείριση.', 'Αφαίρεση', async () => {
      await q(sb.rpc('admin_remove_admin', { p_user: b.dataset.rm })); route(); }, true));
    $('#af').onsubmit = async e => { e.preventDefault(); try { await q(sb.rpc('admin_add_admin', { p_email: e.target.email.value })); toast('Προστέθηκε'); route(); } catch {} };
  }
};

// =====================================================================
// Εκκίνηση
// =====================================================================
async function start() {
  if (NOT_CONFIGURED) return renderConfigMissing();
  const { data } = await sb.auth.getSession();
  st.user = data.session?.user || null;
  if (!st.user) return renderAuth();
  try { await loadMe(); } catch { return; }
  if (!st.memberships.length && !st.isAdmin) return renderRegisterGym();
  if (st.cur && st.cur.gym_status !== 'active' && !st.isAdmin && !st.memberships.some(m => m.gym_status === 'active')) return renderPending();
  shell(); route();
}
if (sb) sb.auth.onAuthStateChange((ev, session) => {
  const uid = session?.user?.id || null;
  if ((ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') && uid !== (st.user?.id || null)) setTimeout(start, 0);
  if (ev === 'PASSWORD_RECOVERY') setTimeout(() => sheet('Νέος κωδικός', `<form id="pw"><div class="field"><label>Νέος κωδικός</label>
    <input type="password" name="p" minlength="6" required autocomplete="new-password"></div><button class="btn block">Αλλαγή</button></form>`, (el, close) => {
    $('#pw', el).onsubmit = async e => { e.preventDefault(); try { await q(sb.auth.updateUser({ password: e.target.p.value })); close(); toast('Ο κωδικός άλλαξε'); } catch {} };
  }), 0);
});
start();
})();
