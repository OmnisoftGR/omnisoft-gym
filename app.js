/* Omnisoft Gym — εφαρμογή (vanilla JS + Supabase) */
(() => {
'use strict';

const CFG = window.APP_CONFIG || {};
const app = document.getElementById('app');
const NOT_CONFIGURED = !CFG.key || CFG.key.includes('ΒΑΛΤΕ');
const sb = NOT_CONFIGURED ? null : window.supabase.createClient(CFG.url, CFG.key);

const st = { user: null, memberships: [], cur: null, isAdmin: false, charts: [] };

// ---------------- Βοηθητικά ----------------
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
const fmtNum = v => v == null ? '' : (+v % 1 === 0 ? String(+v) : (+v).toFixed(1));
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const fmtDate = d => d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('el-GR', { day: 'numeric', month: 'short' }) : '–';
const fmtDateLong = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('el-GR', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } },
                set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), err ? 5000 : 2600);
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
const isStaff = m => m && (m.is_owner || m.is_coach) && m.gym_status === 'active';
const metricLabel = { reps_weight: 'Επαν. & κιλά', reps: 'Επαναλήψεις', time: 'Χρόνος', distance: 'Απόσταση' };
const statusBadge = {
  increase: ['b-ok', 'Αύξηση'], hold: ['b-muted', 'Ίδια κιλά'], deload: ['b-warn', 'Μείωση (απουσία)'],
  decrease: ['b-bad', 'Μείωση'], stall: ['b-warn', 'Στασιμότητα'], new: ['b-info', 'Νέα άσκηση']
};
function destroyCharts() { st.charts.forEach(c => c.destroy()); st.charts = []; }
function targetText(pe) {
  if (pe.target_seconds) return `${pe.sets} × ${pe.target_seconds}″`;
  const r = pe.reps_min && pe.reps_max && pe.reps_min !== pe.reps_max ? `${pe.reps_min}–${pe.reps_max}` : (pe.reps_max || pe.reps_min || '');
  return `${pe.sets} × ${r}${pe.target_weight ? ` · ${fmtNum(pe.target_weight)} κ.` : ''}`;
}
function applyTheme(m) {
  const r = document.documentElement.style;
  r.setProperty('--brand', (m && m.primary_color) || '#d71920');
  r.setProperty('--brand-2', (m && m.secondary_color) || '#111111');
}

// ---------------- Είσοδος ----------------
function renderConfigMissing() {
  app.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <h1>Ρύθμιση</h1><p>Λείπει το publishable key στο <code>config.js</code>.</p>
    <p class="muted small">Supabase → Project Settings → API Keys → publishable key.</p></div></div>`;
}

function renderAuth(mode = 'login') {
  applyTheme(null);
  const titles = { login: 'Σύνδεση', signup: 'Νέος λογαριασμός', reset: 'Επαναφορά κωδικού' };
  app.innerHTML = `<div class="auth-wrap"><form class="auth-card" id="authForm">
    <div class="row" style="margin-bottom:12px"><div class="logo" style="width:40px;height:40px;border-radius:10px;background:var(--brand);color:#fff;display:grid;place-items:center;font-weight:800">GYM</div>
      <div><b>Omnisoft Gym</b><div class="muted small">Προγράμματα, πρόοδος, παρουσίες</div></div></div>
    <h1>${titles[mode]}</h1>
    <div class="field"><label>Email</label><input type="email" name="email" required autocomplete="email"></div>
    ${mode !== 'reset' ? `<div class="field"><label>Κωδικός</label><input type="password" name="password" required minlength="6"
        autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"></div>` : ''}
    <button class="btn" style="width:100%">${titles[mode]}</button>
    <div class="row between small" style="margin-top:14px">
      ${mode !== 'login' ? `<button type="button" class="link-btn" data-mode="login">Έχω λογαριασμό</button>` :
        `<button type="button" class="link-btn" data-mode="signup">Νέος λογαριασμός</button>
         <button type="button" class="link-btn" data-mode="reset">Ξέχασα τον κωδικό</button>`}
    </div>
    ${mode === 'signup' ? `<p class="muted small">Αθλητές και προπονητές: χρησιμοποιήστε το email που έχει δηλώσει το γυμναστήριό σας,
       ώστε ο λογαριασμός να συνδεθεί αυτόματα. Ιδιοκτήτες: μετά την εγγραφή δηλώνετε το γυμναστήριό σας.</p>` : ''}
  </form></div>`;
  $$('[data-mode]').forEach(b => b.onclick = () => renderAuth(b.dataset.mode));
  $('#authForm').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target), email = f.get('email').trim(), password = f.get('password');
    const btn = $('button.btn', e.target); btn.disabled = true;
    try {
      if (mode === 'login') {
        await q(sb.auth.signInWithPassword({ email, password }));
      } else if (mode === 'signup') {
        const d = await q(sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } }));
        if (!d.session) { toast('Στάλθηκε email επιβεβαίωσης'); renderAuth('login'); }
      } else {
        await q(sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
        toast('Στάλθηκε email επαναφοράς'); renderAuth('login');
      }
    } catch { /* μήνυμα ήδη */ } finally { btn.disabled = false; }
  };
}

async function loadMe() {
  st.memberships = await q(sb.rpc('my_memberships'));
  const adm = await q(sb.from('platform_admins').select('user_id').eq('user_id', st.user.id));
  st.isAdmin = adm.length > 0;
  const saved = store.get('gym_member');
  st.cur = st.memberships.find(m => m.member_id === saved) || st.memberships.find(m => m.gym_status === 'active') || st.memberships[0] || null;
}

// ---------------- Εγγραφή γυμναστηρίου / αναμονή ----------------
function renderRegisterGym() {
  applyTheme(null);
  app.innerHTML = `<div class="auth-wrap"><form class="auth-card" id="regForm">
    <h1>Εγγραφή γυμναστηρίου</h1>
    <p class="muted small">Ο λογαριασμός ${esc(st.user.email)} δεν είναι συνδεδεμένος με γυμναστήριο. Αν είστε αθλητής ή προπονητής,
      ζητήστε από το γυμναστήριό σας να σας καταχωρήσει με αυτό το email. Αν είστε ιδιοκτήτης, συμπληρώστε τα στοιχεία:</p>
    <div class="field"><label>Όνομα γυμναστηρίου</label><input name="gym" required></div>
    <div class="field"><label>Ονοματεπώνυμο ιδιοκτήτη</label><input name="owner" required></div>
    <div class="field"><label>Πόλη</label><input name="city"></div>
    <div class="field"><label>Τηλέφωνο</label><input name="phone" type="tel"></div>
    <button class="btn" style="width:100%">Αποστολή αίτησης</button>
    <p class="small" style="margin-top:12px"><button type="button" class="link-btn" id="logout">Αποσύνδεση</button></p>
  </form></div>`;
  $('#logout').onclick = () => sb.auth.signOut();
  $('#regForm').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    try {
      await q(sb.rpc('register_gym', { p_gym_name: f.get('gym'), p_owner_name: f.get('owner'),
                                       p_city: f.get('city') || null, p_phone: f.get('phone') || null }));
      toast('Η αίτηση στάλθηκε'); await start();
    } catch {}
  };
}
function renderPending() {
  app.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <h1>${esc(st.cur.gym_name)}</h1>
    <p><span class="badge ${st.cur.gym_status === 'pending' ? 'b-warn' : 'b-bad'}">
      ${st.cur.gym_status === 'pending' ? 'Σε αναμονή έγκρισης' : 'Σε αναστολή'}</span></p>
    <p class="muted">Θα ενημερωθείτε μόλις ενεργοποιηθεί ο λογαριασμός του γυμναστηρίου.</p>
    <button class="btn secondary" id="logout">Αποσύνδεση</button></div></div>`;
  $('#logout').onclick = () => sb.auth.signOut();
}

// ---------------- Κέλυφος & πλοήγηση ----------------
function tabsFor(m) {
  const t = [];
  if (isStaff(m)) t.push(['athletes', 'Αθλητές'], ['programs', 'Προγράμματα'], ['exercises', 'Ασκήσεις'],
                         ['attendance', 'Παρουσίες'], ['members', 'Μέλη']);
  if (m && m.is_athlete && m.gym_status === 'active') t.push(['today', isStaff(m) ? 'Η προπόνησή μου' : 'Σήμερα'],
                         ['history', 'Ιστορικό'], ['progress', 'Πρόοδος']);
  if (m && m.is_owner && m.gym_status === 'active') t.push(['settings', 'Ρυθμίσεις']);
  if (st.isAdmin) t.push(['admin', 'Διαχείριση']);
  return t;
}
function shell() {
  const m = st.cur;
  applyTheme(m);
  const role = m ? [m.is_owner && 'Ιδιοκτήτης', m.is_coach && 'Προπονητής', m.is_athlete && 'Αθλητής'].filter(Boolean).join(' · ') : 'Διαχειριστής';
  const name = m ? m.gym_name : 'Omnisoft Gym';
  const initials = name.split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
  app.innerHTML = `
    <header class="topbar">
      <div class="logo">${m && m.logo_url ? `<img src="${esc(m.logo_url)}" alt="">` : esc(initials)}</div>
      <div class="title">${esc(name)}<small>${esc(m ? m.full_name : st.user.email)} · ${esc(role)}</small></div>
      <div class="spacer"></div>
      ${st.memberships.length > 1 ? `<select id="gymSel" class="hide-sm">${st.memberships.map(x =>
        `<option value="${x.member_id}" ${x.member_id === m?.member_id ? 'selected' : ''}>${esc(x.gym_name)}</option>`).join('')}</select>` : ''}
      <button class="ghost" id="logout">Έξοδος</button>
    </header>
    <nav class="tabs" id="tabs">${tabsFor(m).map(([k, l]) => `<a href="#/${k}" data-k="${k}">${l}</a>`).join('')}</nav>
    <main id="view"></main>`;
  $('#logout').onclick = () => sb.auth.signOut();
  const gs = $('#gymSel');
  if (gs) gs.onchange = () => { store.set('gym_member', gs.value); st.cur = st.memberships.find(x => x.member_id === gs.value); shell(); route(); };
}

const routes = {};
async function route() {
  destroyCharts();
  const tabs = tabsFor(st.cur);
  let [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const staffOnly = ['athlete', 'program', 'log'].includes(name) && isStaff(st.cur);
  if (!routes[name] || (!tabs.find(t => t[0] === name) && !staffOnly)) {
    name = tabs[0] ? tabs[0][0] : 'admin';
    if (location.hash !== '#/' + name) { history.replaceState(null, '', '#/' + name); }
  }
  $$('#tabs a').forEach(a => a.classList.toggle('active', a.dataset.k === name ||
    (name === 'athlete' && a.dataset.k === 'athletes') || (name === 'program' && a.dataset.k === 'programs')));
  const view = $('#view');
  view.innerHTML = '<p class="muted">Φόρτωση…</p>';
  try { await routes[name](view, arg); } catch (e) { console.error(e); view.innerHTML = `<div class="card">Σφάλμα: ${esc(e.message || e)}</div>`; }
}
window.addEventListener('hashchange', () => { if (st.user && $('#view')) route(); });

// ---------------- Κοινά δεδομένα ----------------
async function loadProgram(programId) {
  const p = await q(sb.from('programs').select(`id, name, goal, athlete_id, is_template, sessions_per_week, active, notes,
    program_days(id, day_no, name, program_exercises(id, sort_order, sets, reps_min, reps_max, target_weight, target_seconds,
      rest_seconds, notes, exercise_id, exercises(name, animation_code, metric_type)))`).eq('id', programId).single());
  p.program_days.sort((a, b) => a.day_no - b.day_no);
  p.program_days.forEach(d => d.program_exercises.sort((a, b) => a.sort_order - b.sort_order));
  return p;
}
async function activeProgramId(athleteId) {
  const r = await q(sb.from('programs').select('id').eq('athlete_id', athleteId).eq('active', true)
    .order('start_date', { ascending: false }).limit(1));
  return r[0]?.id || null;
}
async function gymExercises(all) {
  let qq = sb.from('exercises').select('id, name, muscle_group, metric_type, animation_code, active, increment_kg')
    .eq('gym_id', st.cur.gym_id).order('muscle_group').order('name');
  if (!all) qq = qq.eq('active', true);
  return q(qq);
}

// ---------------- Προπονητής: αθλητές ----------------
routes.athletes = async view => {
  const g = st.cur.gym_id;
  const [rows, week] = await Promise.all([
    q(sb.from('v_athlete_status').select('*').eq('gym_id', g).order('full_name')),
    q(sb.from('workout_sessions').select('id', { count: 'exact', head: false }).eq('gym_id', g)
      .gte('performed_on', new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10)))
  ]);
  const absent = rows.filter(r => r.days_absent == null || r.days_absent > 10).length;
  view.innerHTML = `
    <div class="row between"><h1>Αθλητές</h1><a class="btn small" href="#/members">+ Νέος αθλητής</a></div>
    <div class="kpis">
      <div class="kpi"><b>${rows.length}</b><span>ενεργοί αθλητές</span></div>
      <div class="kpi"><b>${week.length}</b><span>προπονήσεις 7 ημερών</span></div>
      <div class="kpi"><b style="color:${absent ? 'var(--bad)' : 'inherit'}">${absent}</b><span>απουσία > 10 ημέρες</span></div>
    </div>
    <input id="search" placeholder="Αναζήτηση αθλητή…" style="margin-bottom:10px">
    <div class="table-wrap card" style="padding:0"><table><thead><tr>
      <th>Αθλητής</th><th>Τελευταία προπόνηση</th><th>Απουσία</th><th class="hide-sm">Συνέπεια 4 εβδ.</th></tr></thead>
      <tbody>${rows.map(r => {
        const d = r.days_absent, cls = d == null ? 'b-muted' : d > 21 ? 'b-bad' : d > 10 ? 'b-warn' : 'b-ok';
        const pct = r.planned_28d ? Math.round(100 * r.workouts_28d / r.planned_28d) : null;
        return `<tr class="click" data-id="${r.athlete_id}" data-n="${esc(r.full_name.toLowerCase())}">
          <td><b>${esc(r.full_name)}</b></td><td>${fmtDate(r.last_workout)}</td>
          <td><span class="badge ${cls}">${d == null ? 'καμία' : d === 0 ? 'σήμερα' : d + ' ημ.'}</span></td>
          <td class="hide-sm">${pct == null ? '–' : `${r.workouts_28d}/${r.planned_28d} · <span class="badge ${pct >= 75 ? 'b-ok' : pct >= 50 ? 'b-warn' : 'b-bad'}">${pct}%</span>`}</td></tr>`;
      }).join('') || '<tr><td colspan="4" class="empty">Δεν υπάρχουν αθλητές ακόμα</td></tr>'}</tbody></table></div>`;
  $$('tr.click', view).forEach(tr => tr.onclick = () => location.hash = '#/athlete/' + tr.dataset.id);
  $('#search').oninput = e => { const s = e.target.value.toLowerCase();
    $$('tr.click', view).forEach(tr => tr.style.display = tr.dataset.n.includes(s) ? '' : 'none'); };
};

routes.athlete = async (view, id) => {
  const [m, sugg, pid] = await Promise.all([
    q(sb.from('gym_members').select('*').eq('id', id).single()),
    q(sb.rpc('suggest_progression', { p_athlete: id })),
    activeProgramId(id)
  ]);
  const flagged = sugg.filter(s => ['deload', 'decrease', 'stall'].includes(s.status));
  view.innerHTML = `
    <p class="small"><a href="#/athletes">← Αθλητές</a></p>
    <div class="row between"><div><h1 style="margin-bottom:2px">${esc(m.full_name)}</h1>
      <div class="muted small">${esc(m.goal || '')}${m.email ? ' · ' + esc(m.email) : ''}</div></div>
      <div class="row">
        ${pid ? `<a class="btn secondary small" href="#/program/${pid}">Πρόγραμμα</a>` : `<button class="btn secondary small" id="newProg">+ Πρόγραμμα</button>`}
        <a class="btn small" href="#/log/${id}">Καταγραφή προπόνησης</a></div></div>
    ${flagged.length ? `<div class="card" style="border-color:#fde68a;background:#fffbeb"><b>Χρειάζεται προσοχή</b>
      <ul style="margin:6px 0 0;padding-left:18px">${[...new Map(flagged.map(f => [f.status + f.reason.replace(/\d+/g, ''), f])).values()]
        .map(f => `<li>${esc(f.exercise_name)}: ${esc(f.reason)}</li>`).join('')}</ul></div>` : ''}
    <h2>Πρόταση για την επόμενη προπόνηση</h2>
    ${suggTable(sugg)}
    <h2>Πρόοδος</h2><div id="prog"></div>
    <h2>Τελευταίες προπονήσεις</h2><div id="hist"></div>`;
  if (!pid) $('#newProg').onclick = () => createProgramFor(id);
  await renderProgress($('#prog'), id);
  await renderHistory($('#hist'), id, 8);
};

function suggTable(sugg) {
  if (!sugg.length) return '<div class="card empty">Δεν υπάρχει ενεργό πρόγραμμα</div>';
  return `<div class="table-wrap card" style="padding:0"><table><thead><tr><th>Άσκηση</th><th class="hide-sm">Ημέρα</th>
    <th>Τελευταία</th><th>Πρόταση</th><th class="hide-sm">Αιτία</th></tr></thead><tbody>
    ${sugg.map(s => { const [c, l] = statusBadge[s.status] || ['b-muted', s.status];
      return `<tr><td><b>${esc(s.exercise_name)}</b></td><td class="hide-sm small muted">${esc(s.program_day)}</td>
        <td class="small">${s.last_weight != null ? fmtNum(s.last_weight) + ' κ. · ' : ''}${esc(s.last_reps || '–')}</td>
        <td>${s.suggested_weight != null ? `<b>${fmtNum(s.suggested_weight)} κ.</b> ` : ''}<span class="badge ${c}">${l}</span></td>
        <td class="hide-sm small">${esc(s.reason)}</td></tr>`; }).join('')}</tbody></table></div>`;
}

async function createProgramFor(athleteId) {
  const templates = await q(sb.from('programs').select('id, name').eq('gym_id', st.cur.gym_id).eq('is_template', true));
  const src = templates.length ? prompt('Αντιγραφή από πρότυπο;\n' + templates.map((t, i) => `${i + 1}. ${t.name}`).join('\n') +
    '\n\nΓράψτε αριθμό ή αφήστε κενό για κενό πρόγραμμα', '') : '';
  if (src === null) return;
  const t = templates[+src - 1];
  const id = t ? await copyProgram(t.id, athleteId) :
    (await q(sb.from('programs').insert({ gym_id: st.cur.gym_id, athlete_id: athleteId, coach_id: st.cur.member_id,
      name: 'Νέο πρόγραμμα', sessions_per_week: 3 }).select('id').single())).id;
  location.hash = '#/program/' + id;
}
async function copyProgram(srcId, athleteId) {
  const src = await loadProgram(srcId);
  if (athleteId) await q(sb.from('programs').update({ active: false }).eq('athlete_id', athleteId).eq('active', true));
  const np = await q(sb.from('programs').insert({ gym_id: st.cur.gym_id, athlete_id: athleteId || null, coach_id: st.cur.member_id,
    is_template: !athleteId, name: athleteId ? src.name.replace(/^Πρότυπο:\s*/, '') : src.name + ' (αντίγραφο)',
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

// ---------------- Προπονητής: προγράμματα ----------------
routes.programs = async view => {
  const [progs, members] = await Promise.all([
    q(sb.from('programs').select('id, name, athlete_id, is_template, sessions_per_week, start_date')
      .eq('gym_id', st.cur.gym_id).eq('active', true).order('name')),
    q(sb.from('gym_members').select('id, full_name').eq('gym_id', st.cur.gym_id).eq('is_athlete', true).eq('status', 'active').order('full_name'))
  ]);
  const byAth = Object.fromEntries(progs.filter(p => p.athlete_id).map(p => [p.athlete_id, p]));
  const tpl = progs.filter(p => p.is_template);
  view.innerHTML = `
    <div class="row between"><h1>Προγράμματα</h1><button class="btn small" id="newTpl">+ Νέο πρότυπο</button></div>
    <h2>Πρότυπα</h2>
    <div class="grid cols-3">${tpl.map(p => `<a class="card" style="text-decoration:none;color:inherit" href="#/program/${p.id}">
      <h3>${esc(p.name)}</h3><span class="muted small">${p.sessions_per_week} φορές/εβδομάδα</span></a>`).join('') ||
      '<div class="card empty">Κανένα πρότυπο</div>'}</div>
    <h2>Ανά αθλητή</h2>
    <div class="table-wrap card" style="padding:0"><table><thead><tr><th>Αθλητής</th><th>Πρόγραμμα</th><th>Από</th><th></th></tr></thead><tbody>
    ${members.map(m => { const p = byAth[m.id]; return `<tr><td><b>${esc(m.full_name)}</b></td>
      <td>${p ? esc(p.name) : '<span class="badge b-warn">χωρίς πρόγραμμα</span>'}</td><td class="small">${p ? fmtDate(p.start_date) : ''}</td>
      <td style="text-align:right">${p ? `<a class="btn secondary small" href="#/program/${p.id}">Επεξεργασία</a>` :
        `<button class="btn small" data-new="${m.id}">Δημιουργία</button>`}</td></tr>`; }).join('')}</tbody></table></div>`;
  $$('[data-new]', view).forEach(b => b.onclick = () => createProgramFor(b.dataset.new));
  $('#newTpl').onclick = async () => {
    const name = prompt('Όνομα προτύπου', 'Πρότυπο: '); if (!name) return;
    const p = await q(sb.from('programs').insert({ gym_id: st.cur.gym_id, coach_id: st.cur.member_id, is_template: true, name })
      .select('id').single());
    location.hash = '#/program/' + p.id;
  };
};

routes.program = async (view, programId) => {
  const [p, exs] = await Promise.all([loadProgram(programId), gymExercises()]);
  let athlete = null;
  if (p.athlete_id) athlete = await q(sb.from('gym_members').select('id, full_name').eq('id', p.athlete_id).single());
  const exOpts = exs.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
  view.innerHTML = `
    <p class="small"><a href="${athlete ? '#/athlete/' + athlete.id : '#/programs'}">← ${athlete ? esc(athlete.full_name) : 'Προγράμματα'}</a></p>
    <div class="card"><div class="inline-inputs">
      <div><label>Όνομα προγράμματος</label><input data-pf="name" value="${esc(p.name)}"></div>
      <div><label>Στόχος</label><input data-pf="goal" value="${esc(p.goal || '')}"></div>
      <div><label>Φορές/εβδομάδα</label><input data-pf="sessions_per_week" type="number" min="1" max="7" value="${p.sessions_per_week}"></div>
    </div>
    <div class="row" style="margin-top:10px">
      ${p.is_template ? `<span class="badge b-info">Πρότυπο</span>` : ''}
      ${!p.is_template ? `<button class="btn secondary small" id="saveTpl">Αποθήκευση ως πρότυπο</button>` : ''}
    </div></div>
    <div id="days">${p.program_days.map(d => `
      <div class="card" data-day="${d.id}">
        <div class="row between"><input data-dn="${d.id}" value="${esc(d.name)}" style="max-width:420px;font-weight:700">
          <button class="btn danger small" data-deld="${d.id}">Διαγραφή ημέρας</button></div>
        <div class="table-wrap"><table style="margin-top:8px"><thead><tr><th></th><th>Άσκηση</th><th>Σετ</th><th>Επαν. από</th>
          <th>έως</th><th>Κιλά</th><th>Δευτ.</th><th class="hide-sm">Διάλειμμα″</th><th></th></tr></thead><tbody>
          ${d.program_exercises.map(pe => `<tr data-pe="${pe.id}">
            <td style="width:52px">${Stickman.svg(pe.exercises.animation_code).replace('class="stick"', 'class="stick" style="width:44px;height:44px"')}</td>
            <td><b>${esc(pe.exercises.name)}</b></td>
            ${['sets', 'reps_min', 'reps_max', 'target_weight', 'target_seconds'].map(f =>
              `<td style="min-width:64px"><input type="number" step="${f === 'target_weight' ? '0.5' : '1'}" data-f="${f}" value="${pe[f] ?? ''}"></td>`).join('')}
            <td class="hide-sm" style="min-width:64px"><input type="number" data-f="rest_seconds" value="${pe.rest_seconds ?? ''}"></td>
            <td><button class="btn danger small" data-delpe="${pe.id}" title="Αφαίρεση">✕</button></td></tr>`).join('')}
        </tbody></table></div>
        <div class="row" style="margin-top:8px"><select data-addsel="${d.id}" style="max-width:360px">${exOpts}</select>
          <button class="btn secondary small" data-add="${d.id}">+ Άσκηση</button></div>
      </div>`).join('')}</div>
    <button class="btn" id="addDay">+ Ημέρα</button>`;

  $$('[data-pf]', view).forEach(i => i.onchange = () =>
    q(sb.from('programs').update({ [i.dataset.pf]: i.type === 'number' ? num(i.value) : i.value }).eq('id', p.id)).then(() => toast('Αποθηκεύτηκε')));
  $$('[data-dn]', view).forEach(i => i.onchange = () =>
    q(sb.from('program_days').update({ name: i.value }).eq('id', i.dataset.dn)).then(() => toast('Αποθηκεύτηκε')));
  $$('tr[data-pe] input', view).forEach(i => i.onchange = () =>
    q(sb.from('program_exercises').update({ [i.dataset.f]: num(i.value) }).eq('id', i.closest('tr').dataset.pe)).then(() => toast('Αποθηκεύτηκε')));
  $$('[data-delpe]', view).forEach(b => b.onclick = async () => {
    await q(sb.from('program_exercises').delete().eq('id', b.dataset.delpe)); b.closest('tr').remove(); });
  $$('[data-deld]', view).forEach(b => b.onclick = async () => {
    if (!confirmInline(b, 'Σίγουρα;')) return;
    await q(sb.from('program_days').delete().eq('id', b.dataset.deld)); route(); });
  $$('[data-add]', view).forEach(b => b.onclick = async () => {
    const dayId = b.dataset.add, exId = $(`[data-addsel="${dayId}"]`, view).value, ex = exs.find(e => e.id === exId);
    const d = p.program_days.find(x => x.id === dayId);
    await q(sb.from('program_exercises').insert({ gym_id: st.cur.gym_id, program_day_id: dayId, exercise_id: exId,
      sort_order: (d.program_exercises.length + 1), sets: 3,
      reps_min: ex.metric_type === 'time' ? null : 8, reps_max: ex.metric_type === 'time' ? null : 12,
      target_seconds: ex.metric_type === 'time' ? 30 : null, rest_seconds: 90 }));
    route();
  });
  $('#addDay').onclick = async () => {
    const n = p.program_days.length + 1;
    await q(sb.from('program_days').insert({ gym_id: st.cur.gym_id, program_id: p.id, day_no: Math.max(0, ...p.program_days.map(d => d.day_no)) + 1,
      name: 'Ημέρα ' + 'ΑΒΓΔΕΖΗ'[n - 1] }));
    route();
  };
  const st2 = $('#saveTpl');
  if (st2) st2.onclick = async () => { const id = await copyProgram(p.id, null); toast('Δημιουργήθηκε πρότυπο'); location.hash = '#/program/' + id; };
}

// Επιβεβαίωση χωρίς παράθυρο διαλόγου: πρώτο κλικ ζητά επιβεβαίωση, δεύτερο εκτελεί
function confirmInline(btn, msg) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1'; const old = btn.textContent; btn.textContent = msg;
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = old; }, 3000);
  return false;
}

// ---------------- Προπονητής: ασκήσεις ----------------
routes.exercises = async view => {
  const [exs, lib] = await Promise.all([gymExercises(true), q(sb.from('exercise_library').select('*').order('muscle_group').order('name_el'))]);
  const have = new Set(exs.map(e => e.animation_code));
  const missing = lib.filter(l => !have.has(l.code));
  const groups = [...new Set(exs.map(e => e.muscle_group || 'Άλλο'))];
  view.innerHTML = `
    <div class="row between"><h1>Ασκήσεις</h1>
      <div class="row"><button class="btn secondary small" id="photo" title="Έρχεται σύντομα">📷 Από φωτογραφία εξοπλισμού</button>
        <button class="btn small" id="custom">+ Δική μου άσκηση</button></div></div>
    <div id="customForm"></div>
    ${groups.map(g => `<h2>${esc(g)}</h2><div class="grid cols-3">${exs.filter(e => (e.muscle_group || 'Άλλο') === g).map(e => `
      <div class="card ex-card" style="${e.active ? '' : 'opacity:.5'}">${Stickman.svg(e.animation_code)}
        <div style="flex:1"><b>${esc(e.name)}</b><div class="muted small">${metricLabel[e.metric_type]}</div>
          <button class="link-btn small" data-toggle="${e.id}" data-a="${e.active}">${e.active ? 'Απενεργοποίηση' : 'Ενεργοποίηση'}</button></div></div>`).join('')}</div>`).join('')}
    <h2>Βιβλιοθήκη (${missing.length} διαθέσιμες)</h2>
    <div class="grid cols-3">${missing.map(l => `<div class="card ex-card">${Stickman.svg(l.code)}
      <div style="flex:1"><b>${esc(l.name_el)}</b><div class="muted small">${esc(l.muscle_group)}</div>
      <button class="btn secondary small" data-addlib="${l.id}">+ Προσθήκη</button></div></div>`).join('') ||
      '<div class="card empty">Έχετε όλες τις ασκήσεις της βιβλιοθήκης</div>'}</div>`;
  $('#photo').onclick = () => toast('Η αναγνώριση από φωτογραφία έρχεται στην επόμενη έκδοση');
  $$('[data-toggle]', view).forEach(b => b.onclick = async () => {
    await q(sb.from('exercises').update({ active: b.dataset.a !== 'true' }).eq('id', b.dataset.toggle)); route(); });
  $$('[data-addlib]', view).forEach(b => b.onclick = async () => {
    const l = lib.find(x => x.id === b.dataset.addlib);
    await q(sb.from('exercises').insert({ gym_id: st.cur.gym_id, library_id: l.id, name: l.name_el, muscle_group: l.muscle_group,
      metric_type: l.metric_type, animation_code: l.code, increment_kg: l.default_increment_kg }));
    toast('Προστέθηκε'); route(); });
  $('#custom').onclick = () => {
    $('#customForm').innerHTML = `<form class="card" id="cf"><div class="inline-inputs">
      <div><label>Όνομα</label><input name="name" required></div>
      <div><label>Μυϊκή ομάδα</label><input name="muscle" list="groups"><datalist id="groups">${[...new Set(lib.map(l => l.muscle_group))].map(g => `<option>${esc(g)}</option>`).join('')}</datalist></div>
      <div><label>Μέτρηση</label><select name="metric">${Object.entries(metricLabel).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div><label>Κίνηση (animation)</label><select name="anim">${lib.map(l => `<option value="${l.code}">${esc(l.name_el)}</option>`).join('')}</select></div>
      <div><label>Βήμα αύξησης (κ.)</label><input name="inc" type="number" step="0.5" value="2.5"></div>
    </div><div class="row" style="margin-top:10px"><button class="btn">Αποθήκευση</button><div id="prev"></div></div></form>`;
    const f = $('#cf'), prev = () => $('#prev').innerHTML = Stickman.svg(f.anim.value);
    f.anim.onchange = prev; prev();
    f.onsubmit = async e => { e.preventDefault();
      await q(sb.from('exercises').insert({ gym_id: st.cur.gym_id, name: f.name.value, muscle_group: f.muscle.value || null,
        metric_type: f.metric.value, animation_code: f.anim.value, increment_kg: num(f.inc.value) ?? 2.5 }));
      toast('Αποθηκεύτηκε'); route(); };
  };
};

// ---------------- Προπονητής: παρουσίες ----------------
routes.attendance = async view => {
  let day = todayISO();
  const athletes = await q(sb.from('gym_members').select('id, full_name, rfid_tag').eq('gym_id', st.cur.gym_id)
    .eq('is_athlete', true).eq('status', 'active').order('full_name'));
  view.innerHTML = `
    <h1>Παρουσίες</h1>
    <div class="grid cols-2">
      <div class="card"><label>Ημερομηνία</label><input type="date" id="day" value="${day}"></div>
      <div class="card"><label>Κάρτα RFID (σκανάρισμα)</label>
        <input id="rfid" placeholder="Περάστε την κάρτα στον αναγνώστη…" autocomplete="off"></div>
    </div>
    <div class="row between"><h2 id="cnt"></h2><span class="muted small">Πατήστε για παρών / απών</span></div>
    <div class="grid cols-4" id="list"></div>`;
  async function load() {
    const from = new Date(day + 'T00:00:00'), to = new Date(from.getTime() + 864e5);
    const rows = await q(sb.from('attendance').select('id, member_id, method, checked_in_at').eq('gym_id', st.cur.gym_id)
      .gte('checked_in_at', from.toISOString()).lt('checked_in_at', to.toISOString()));
    const present = new Map(rows.map(r => [r.member_id, r]));
    $('#cnt').textContent = `Παρόντες: ${present.size} / ${athletes.length}`;
    $('#list').innerHTML = athletes.map(a => { const r = present.get(a.id);
      return `<button class="card" data-m="${a.id}" style="text-align:left;cursor:pointer;border:2px solid ${r ? 'var(--ok)' : 'var(--line)'};background:${r ? '#f0fdf4' : '#fff'}">
        <b>${esc(a.full_name)}</b><div class="small muted">${r ? '✓ ' + new Date(r.checked_in_at).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' }) +
        (r.method !== 'manual' ? ' · ' + ({ rfid: 'κάρτα', workout: 'από προπόνηση', qr: 'QR' }[r.method] || r.method) : '') : 'απών'}</div></button>`; }).join('');
    $$('[data-m]', view).forEach(b => b.onclick = async () => {
      if (present.has(b.dataset.m)) {
        await q(sb.from('attendance').delete().eq('member_id', b.dataset.m).gte('checked_in_at', from.toISOString()).lt('checked_in_at', to.toISOString()));
      } else {
        const at = day === todayISO() ? new Date() : new Date(day + 'T12:00:00');
        await q(sb.from('attendance').insert({ gym_id: st.cur.gym_id, member_id: b.dataset.m, checked_in_at: at.toISOString(), method: 'manual' }));
      }
      load();
    });
  }
  $('#day').onchange = e => { day = e.target.value; load(); };
  $('#rfid').onkeydown = async e => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return;
    const tag = e.target.value.trim(); e.target.value = '';
    try { const name = await q(sb.rpc('rfid_checkin', { p_gym: st.cur.gym_id, p_tag: tag })); toast('✓ ' + name);
      if (day === todayISO()) load(); } catch {}
  };
  await load();
};

// ---------------- Προπονητής: μέλη ----------------
routes.members = async view => {
  const ms = await q(sb.from('gym_members').select('*').eq('gym_id', st.cur.gym_id).order('full_name'));
  const coaches = ms.filter(m => m.is_coach || m.is_owner);
  const owner = st.cur.is_owner;
  view.innerHTML = `
    <h1>Μέλη</h1>
    <form class="card" id="addM"><h3>Νέο μέλος</h3><div class="inline-inputs">
      <div><label>Ονοματεπώνυμο</label><input name="full_name" required></div>
      <div><label>Email (για τη σύνδεση)</label><input name="email" type="email" required></div>
      <div><label>Τηλέφωνο</label><input name="phone" type="tel"></div>
      <div><label>Στόχος</label><input name="goal"></div>
      <div><label>Υπεύθυνος προπονητής</label><select name="coach_id">${coaches.map(c =>
        `<option value="${c.id}" ${c.id === st.cur.member_id ? 'selected' : ''}>${esc(c.full_name)}</option>`).join('')}</select></div>
    </div>
    <div class="row" style="margin-top:10px">
      <label class="row" style="margin:0;color:var(--text)"><input type="checkbox" name="is_athlete" checked style="width:auto;min-height:0"> Αθλητής</label>
      ${owner ? `<label class="row" style="margin:0;color:var(--text)"><input type="checkbox" name="is_coach" style="width:auto;min-height:0"> Προπονητής</label>` : ''}
      <button class="btn">Προσθήκη</button></div>
    <p class="muted small">Το μέλος δημιουργεί λογαριασμό με το ίδιο email και συνδέεται αυτόματα με το γυμναστήριο.</p></form>
    <div class="table-wrap card" style="padding:0"><table><thead><tr><th>Όνομα</th><th class="hide-sm">Email</th><th>Ρόλοι</th>
      <th>Λογαριασμός</th><th class="hide-sm">Κάρτα RFID</th><th>Κατάσταση</th></tr></thead><tbody>
      ${ms.map(m => `<tr data-id="${m.id}"><td><b>${esc(m.full_name)}</b></td><td class="hide-sm small">${esc(m.email)}</td>
        <td class="small">${[m.is_owner && 'Ιδιοκτήτης', m.is_coach && 'Προπονητής', m.is_athlete && 'Αθλητής'].filter(Boolean).join(', ')}</td>
        <td>${m.user_id ? '<span class="badge b-ok">συνδεδεμένος</span>' : '<span class="badge b-muted">αναμονή</span>'}</td>
        <td class="hide-sm" style="min-width:110px"><input data-rfid value="${esc(m.rfid_tag || '')}" placeholder="—"></td>
        <td><button class="btn secondary small" data-st="${m.status}" ${m.user_id === st.user.id ? 'disabled' : ''}>${m.status === 'active' ? 'Ενεργό' : 'Ανενεργό'}</button></td></tr>`).join('')}
    </tbody></table></div>`;
  $('#addM').onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    await q(sb.from('gym_members').insert({ gym_id: st.cur.gym_id, full_name: f.full_name.value.trim(), email: f.email.value.trim(),
      phone: f.phone.value || null, goal: f.goal.value || null, coach_id: f.coach_id.value || null,
      is_athlete: f.is_athlete.checked, is_coach: owner ? f.is_coach.checked : false }));
    toast('Προστέθηκε'); route();
  };
  $$('[data-rfid]', view).forEach(i => i.onchange = () =>
    q(sb.from('gym_members').update({ rfid_tag: i.value.trim() || null }).eq('id', i.closest('tr').dataset.id)).then(() => toast('Αποθηκεύτηκε')));
  $$('[data-st]', view).forEach(b => b.onclick = async () => {
    await q(sb.from('gym_members').update({ status: b.dataset.st === 'active' ? 'inactive' : 'active' }).eq('id', b.closest('tr').dataset.id)); route(); });
};

// ---------------- Ρυθμίσεις (ιδιοκτήτης) ----------------
routes.settings = async view => {
  const [g, ps] = await Promise.all([
    q(sb.from('gyms').select('*').eq('id', st.cur.gym_id).single()),
    q(sb.from('progression_settings').select('*').eq('gym_id', st.cur.gym_id).single())
  ]);
  const pf = [['missed_days_hold', 'Απουσία (ημέρες) → ίδια κιλά'], ['missed_days_deload', 'Απουσία (ημέρες) → μείωση'],
              ['deload_pct', 'Μείωση μετά από απουσία (%)'], ['max_rpe_for_increase', 'Μέγιστο RPE για αύξηση'],
              ['fails_for_decrease', 'Αποτυχίες στη σειρά → μείωση'], ['decrease_pct', 'Μείωση μετά από αποτυχίες (%)'],
              ['stall_sessions', 'Προπονήσεις χωρίς βελτίωση → στασιμότητα']];
  view.innerHTML = `
    <h1>Ρυθμίσεις</h1>
    <form class="card" id="gf"><h3>Γυμναστήριο</h3><div class="inline-inputs">
      <div><label>Όνομα</label><input name="name" value="${esc(g.name)}"></div>
      <div><label>Πόλη</label><input name="city" value="${esc(g.city || '')}"></div>
      <div><label>Τηλέφωνο</label><input name="phone" value="${esc(g.phone || '')}"></div>
      <div><label>Κύριο χρώμα</label><input name="primary_color" type="color" value="${esc(g.primary_color)}"></div>
      <div><label>Δεύτερο χρώμα</label><input name="secondary_color" type="color" value="${esc(g.secondary_color)}"></div>
      <div style="grid-column:1/-1"><label>Λογότυπο (URL εικόνας)</label><input name="logo_url" value="${esc(g.logo_url || '')}"></div>
    </div><button class="btn" style="margin-top:10px">Αποθήκευση</button></form>
    <form class="card" id="pf"><h3>Κανόνες progression</h3>
      <p class="muted small">Ισχύουν για τις προτάσεις κιλών σε όλους τους αθλητές του γυμναστηρίου.</p>
      <div class="inline-inputs">${pf.map(([k, l]) => `<div><label>${l}</label><input name="${k}" type="number" step="0.5" value="${ps[k]}"></div>`).join('')}</div>
      <button class="btn" style="margin-top:10px">Αποθήκευση</button></form>`;
  $('#gf').onsubmit = async e => { e.preventDefault(); const f = e.target, upd = {};
    ['name', 'city', 'phone', 'primary_color', 'secondary_color', 'logo_url'].forEach(k => upd[k] = f[k].value || null);
    await q(sb.from('gyms').update(upd).eq('id', g.id)); toast('Αποθηκεύτηκε'); await loadMe(); shell(); route(); };
  $('#pf').onsubmit = async e => { e.preventDefault(); const f = e.target, upd = {};
    pf.forEach(([k]) => upd[k] = num(f[k].value)); await q(sb.from('progression_settings').update(upd).eq('gym_id', g.id)); toast('Αποθηκεύτηκε'); };
};

// ---------------- Αθλητής: σημερινή προπόνηση / καταγραφή ----------------
routes.today = (view) => renderLog(view, st.cur.member_id, 'athlete');
routes.log = (view, athleteId) => renderLog(view, athleteId, 'coach');

async function renderLog(view, athleteId, source) {
  const pid = await activeProgramId(athleteId);
  if (!pid) { view.innerHTML = `<div class="card empty">Δεν υπάρχει ενεργό πρόγραμμα. ${source === 'coach' ?
    `<a href="#/athlete/${athleteId}">Δημιουργία</a>` : 'Επικοινωνήστε με τον προπονητή σας.'}</div>`; return; }
  const [p, sugg, last, ath] = await Promise.all([
    loadProgram(pid), q(sb.rpc('suggest_progression', { p_athlete: athleteId })),
    q(sb.from('workout_sessions').select('program_day_id, performed_on').eq('athlete_id', athleteId).order('performed_on', { ascending: false }).limit(1)),
    source === 'coach' ? q(sb.from('gym_members').select('full_name').eq('id', athleteId).single()) : null
  ]);
  const days = p.program_days;
  if (!days.length) { view.innerHTML = '<div class="card empty">Το πρόγραμμα δεν έχει ημέρες ακόμα.</div>'; return; }
  const lastIdx = last[0] ? days.findIndex(d => d.id === last[0].program_day_id) : -1;
  let dayIdx = (lastIdx + 1) % days.length;
  const sMap = Object.fromEntries(sugg.map(s => [s.program_exercise_id, s]));

  function draw() {
    const d = days[dayIdx];
    view.innerHTML = `
      ${source === 'coach' ? `<p class="small"><a href="#/athlete/${athleteId}">← ${esc(ath.full_name)}</a></p>` : ''}
      <div class="row between"><div><h1 style="margin-bottom:2px">${source === 'coach' ? 'Καταγραφή: ' + esc(ath.full_name) : 'Η προπόνησή μου'}</h1>
        <div class="muted small">${esc(p.name)}${last[0] ? ' · τελευταία: ' + fmtDate(last[0].performed_on) : ''}</div></div>
        <div style="min-width:220px"><select id="daySel">${days.map((x, i) => `<option value="${i}" ${i === dayIdx ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div></div>
      <div class="row" style="margin:10px 0"><label style="margin:0">Ημερομηνία</label><input type="date" id="dt" value="${todayISO()}" style="max-width:180px"></div>
      ${d.program_exercises.map(pe => { const s = sMap[pe.id], ex = pe.exercises, m = ex.metric_type;
        const [c, l] = s ? (statusBadge[s.status] || ['b-muted', '']) : ['b-muted', ''];
        const w = s?.suggested_weight ?? pe.target_weight;
        return `<div class="card" data-pe="${pe.id}" data-ex="${pe.exercise_id}" data-m="${m}">
          <div class="ex-card">${Stickman.svg(ex.animation_code)}<div style="flex:1">
            <h3>${esc(ex.name)}</h3><div class="muted small">Στόχος: ${targetText(pe)}${pe.rest_seconds ? ` · διάλειμμα ${pe.rest_seconds}″` : ''}</div>
            ${s && s.status ? `<div class="suggest" style="margin-top:6px">${w != null && m === 'reps_weight' ? `<b>${fmtNum(w)} κ.</b> · ` : ''}
              ${s.status !== 'hold' ? `<span class="badge ${c}">${l}</span> ` : ''}${esc(s.reason)}</div>` : ''}</div></div>
          <div style="margin-top:10px">
            <div class="set-row small muted"><span></span>${m === 'time' ? '<span>Δευτ.</span><span></span>' : m === 'reps_weight' ? '<span>Επαναλήψεις</span><span>Κιλά</span>' : '<span>Επαναλήψεις</span><span></span>'}<span>RPE 1-10</span></div>
            ${Array.from({ length: pe.sets }, (_, i) => `<div class="set-row"><span class="n">${i + 1}</span>
              ${m === 'time' ? `<input type="number" inputmode="numeric" data-k="seconds" placeholder="${pe.target_seconds || ''}"><span></span>` :
                `<input type="number" inputmode="numeric" data-k="reps" placeholder="${pe.reps_max || pe.reps_min || ''}">
                 ${m === 'reps_weight' ? `<input type="number" inputmode="decimal" step="0.5" data-k="weight" value="${w != null ? fmtNum(w) : ''}">` : '<span></span>'}`}
              <input type="number" inputmode="decimal" step="0.5" min="1" max="10" data-k="rpe" placeholder="—"></div>`).join('')}
          </div></div>`; }).join('')}
      <div class="card"><label>Σημειώσεις</label><textarea id="notes" rows="2"></textarea></div>
      <button class="btn" id="save" style="width:100%">Αποθήκευση προπόνησης</button>`;
    $('#daySel').onchange = e => { dayIdx = +e.target.value; draw(); };
    $('#save').onclick = save;
  }
  async function save() {
    const sets = [];
    $$('[data-pe]', view).forEach(card => {
      $$('.set-row', card).slice(1).forEach((row, i) => {
        const v = k => { const el = $(`[data-k="${k}"]`, row); return el ? num(el.value) : null; };
        const reps = v('reps'), seconds = v('seconds'), weight = v('weight'), rpe = v('rpe');
        if (reps == null && seconds == null) return;
        sets.push({ program_exercise_id: card.dataset.pe, exercise_id: card.dataset.ex, set_no: i + 1, reps, seconds, weight, rpe });
      });
    });
    if (!sets.length) { toast('Συμπληρώστε τουλάχιστον ένα σετ', true); return; }
    const btn = $('#save'); btn.disabled = true;
    try {
      const sess = await q(sb.from('workout_sessions').insert({ gym_id: st.cur.gym_id, athlete_id: athleteId, program_day_id: days[dayIdx].id,
        performed_on: $('#dt').value || todayISO(), source, notes: $('#notes').value || null }).select('id').single());
      await q(sb.from('workout_sets').insert(sets.map(s => ({ ...s, gym_id: st.cur.gym_id, session_id: sess.id }))));
      toast('Η προπόνηση αποθηκεύτηκε 💪');
      location.hash = source === 'coach' ? '#/athlete/' + athleteId : '#/history';
    } catch { btn.disabled = false; }
  }
  draw();
}

// ---------------- Ιστορικό & πρόοδος ----------------
async function renderHistory(el, athleteId, limit = 30) {
  const ss = await q(sb.from('workout_sessions').select(`id, performed_on, source, notes, program_days(name),
    workout_sets(set_no, reps, weight, seconds, rpe, exercise_id, exercises(name))`)
    .eq('athlete_id', athleteId).order('performed_on', { ascending: false }).limit(limit));
  if (!ss.length) { el.innerHTML = '<div class="card empty">Καμία καταγραφή ακόμα</div>'; return; }
  el.innerHTML = ss.map(s => {
    const by = {};
    s.workout_sets.sort((a, b) => a.set_no - b.set_no).forEach(x => (by[x.exercises.name] = by[x.exercises.name] || []).push(x));
    return `<div class="card"><div class="row between"><b>${fmtDateLong(s.performed_on)}</b>
      <span class="muted small">${esc(s.program_days?.name || '')}${s.source === 'coach' ? ' · από προπονητή' : ''}</span></div>
      <div class="small" style="margin-top:6px">${Object.entries(by).map(([n, xs]) => `<div><b>${esc(n)}:</b> ${xs.map(x =>
        x.seconds ? x.seconds + '″' : (x.weight ? fmtNum(x.weight) + '×' : '') + (x.reps ?? '')).join(', ')}</div>`).join('')}</div>
      ${s.notes ? `<div class="muted small" style="margin-top:4px">${esc(s.notes)}</div>` : ''}</div>`;
  }).join('');
}
routes.history = async view => {
  view.innerHTML = '<h1>Ιστορικό</h1><div id="h"></div>';
  await renderHistory($('#h'), st.cur.member_id);
};

async function renderProgress(el, athleteId) {
  const rows = await q(sb.from('v_exercise_progress').select('*').eq('athlete_id', athleteId).order('performed_on'));
  const withW = rows.filter(r => r.top_weight != null);
  if (!rows.length) { el.innerHTML = '<div class="card empty">Δεν υπάρχουν ακόμα δεδομένα προόδου</div>'; return; }
  const exNames = [...new Map(withW.map(r => [r.exercise_id, r.exercise_name])).entries()];
  const sessions28 = new Set(rows.filter(r => r.performed_on >= new Date(Date.now() - 28 * 864e5).toISOString().slice(0, 10)).map(r => r.performed_on)).size;
  const best = id => { const xs = withW.filter(r => r.exercise_id === id); return xs.length ? [xs[0], xs[xs.length - 1]] : null; };
  el.innerHTML = `
    <div class="kpis"><div class="kpi"><b>${new Set(rows.map(r => r.performed_on)).size}</b><span>προπονήσεις συνολικά</span></div>
      <div class="kpi"><b>${sessions28}</b><span>τελευταίες 4 εβδομάδες</span></div>
      <div class="kpi"><b>${Math.round(rows.reduce((a, r) => a + (+r.volume_kg || 0), 0) / 1000)} τ.</b><span>συνολικός όγκος</span></div></div>
    <div class="card"><div class="row between"><select id="exSel" style="max-width:360px">${exNames.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('')}</select>
      <span id="delta" class="small"></span></div><div class="chart-box" style="margin-top:10px"><canvas id="ch"></canvas></div></div>`;
  const ctx = $('#ch', el), brand = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim();
  function drawChart(id) {
    destroyCharts();
    const xs = withW.filter(r => r.exercise_id === id), b = best(id);
    if (b) { const d = (+b[1].est_1rm) - (+b[0].est_1rm), pct = b[0].est_1rm ? Math.round(100 * d / b[0].est_1rm) : 0;
      $('#delta', el).innerHTML = `Εκτ. 1RM: <b>${fmtNum(b[0].est_1rm)} → ${fmtNum(b[1].est_1rm)} κ.</b> <span class="badge ${d > 0 ? 'b-ok' : d < 0 ? 'b-bad' : 'b-muted'}">${d > 0 ? '+' : ''}${pct}%</span>`; }
    st.charts.push(new Chart(ctx, { type: 'line', data: { labels: xs.map(r => fmtDate(r.performed_on)), datasets: [
      { label: 'Εκτίμηση 1RM (κ.)', data: xs.map(r => +r.est_1rm), borderColor: brand, backgroundColor: brand, tension: .25, pointRadius: 3 },
      { label: 'Μέγιστα κιλά', data: xs.map(r => +r.top_weight), borderColor: '#71717a', backgroundColor: '#71717a', borderDash: [5, 4], tension: .25, pointRadius: 2 }] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom' } }, scales: { y: { title: { display: true, text: 'κιλά' } } } } }));
  }
  if (exNames.length) { $('#exSel', el).onchange = e => drawChart(e.target.value); drawChart(exNames[0][0]); }
}
routes.progress = async view => {
  view.innerHTML = '<h1>Η πρόοδός μου</h1><div id="p"></div><h2>Πρόταση για την επόμενη προπόνηση</h2><div id="s"></div>';
  await renderProgress($('#p'), st.cur.member_id);
  $('#s').innerHTML = suggTable(await q(sb.rpc('suggest_progression', { p_athlete: st.cur.member_id })));
};

// ---------------- Διαχείριση πλατφόρμας ----------------
routes.admin = async view => {
  const gyms = await q(sb.from('gyms').select('*').order('created_at', { ascending: false }));
  const cls = { pending: 'b-warn', active: 'b-ok', suspended: 'b-bad' }, lbl = { pending: 'Σε αναμονή', active: 'Ενεργό', suspended: 'Σε αναστολή' };
  view.innerHTML = `<h1>Διαχείριση γυμναστηρίων</h1>
    <div class="kpis">${['pending', 'active', 'suspended'].map(s => `<div class="kpi"><b>${gyms.filter(g => g.status === s).length}</b><span>${lbl[s]}</span></div>`).join('')}</div>
    <div class="table-wrap card" style="padding:0"><table><thead><tr><th>Γυμναστήριο</th><th class="hide-sm">Πόλη / τηλ.</th><th>Εγγραφή</th><th>Κατάσταση</th><th></th></tr></thead><tbody>
    ${gyms.map(g => `<tr><td><b>${esc(g.name)}</b></td><td class="hide-sm small">${esc(g.city || '')} ${esc(g.phone || '')}</td>
      <td class="small">${fmtDate(g.created_at.slice(0, 10))}</td><td><span class="badge ${cls[g.status]}">${lbl[g.status]}</span></td>
      <td style="text-align:right">${g.status !== 'active' ? `<button class="btn small" data-ok="${g.id}">Έγκριση</button>` :
        `<button class="btn danger small" data-no="${g.id}">Αναστολή</button>`}</td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-ok]', view).forEach(b => b.onclick = async () => { await q(sb.rpc('approve_gym', { p_gym: b.dataset.ok, p_active: true })); toast('Εγκρίθηκε'); route(); });
  $$('[data-no]', view).forEach(b => b.onclick = async () => { if (!confirmInline(b, 'Σίγουρα;')) return;
    await q(sb.rpc('approve_gym', { p_gym: b.dataset.no, p_active: false })); route(); });
};

// ---------------- Εκκίνηση ----------------
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
  if (ev === 'PASSWORD_RECOVERY') setTimeout(async () => {
    const pw = prompt('Νέος κωδικός (τουλάχιστον 6 χαρακτήρες)');
    if (pw) { try { await q(sb.auth.updateUser({ password: pw })); toast('Ο κωδικός άλλαξε'); } catch {} }
  }, 0);
});
start();
})();
