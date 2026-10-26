'use strict';
const CFG = window.SGAP_CONFIG;
const sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const state = { profile: null, email: '' };

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600);
}
function header(title, sub = '') { $('#title').textContent = title; $('#subtitle').textContent = sub; }
const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const hrs = (n) => (Math.round(n * 100) / 100).toFixed(2);
const t5 = (t) => (t || '').slice(0, 5);
const formData = (f) => Object.fromEntries(new FormData(f).entries());
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const editable = (e) => state.profile.role === 'admin' || e.work_date >= daysAgo(CFG.editWindowDays);

// Turns Supabase errors into friendly messages
function check({ data, error }) {
  if (!error) return data;
  const m = error.message || '';
  if (/row-level security|permission denied/i.test(m)) throw new Error(`Not allowed. Hours older than ${CFG.editWindowDays} days are locked – please contact the administrator.`);
  if (/rate limit|security purposes/i.test(m)) throw new Error('Too many codes requested. Please wait a few minutes and try again.');
  if (/expired|invalid/i.test(m) && /token|otp/i.test(m)) throw new Error('That code is not correct or has expired.');
  if (/duplicate key/i.test(m)) throw new Error('That email address is already in use.');
  throw new Error(m || 'Something went wrong.');
}

// Fetches every row in pages (Supabase returns at most 1000 rows per request)
async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = check(await build().range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

function ranges() {
  const t = new Date(); const y = t.getFullYear(); const m = t.getMonth();
  const mon = new Date(t); mon.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  const lastMon = new Date(mon); lastMon.setDate(mon.getDate() - 7);
  const lastSun = new Date(mon); lastSun.setDate(mon.getDate() - 1);
  return {
    'This week': [iso(mon), iso(t)], 'Last week': [iso(lastMon), iso(lastSun)],
    'This month': [iso(new Date(y, m, 1)), iso(t)], 'Last month': [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))],
    'All': ['', ''],
  };
}
const chipsHtml = () => `<div class="chips">${Object.keys(ranges()).map((k) => `<button type="button" data-range="${k}">${k}</button>`).join('')}</div>`;
function bindChips(root, from, to, cb) {
  root.querySelectorAll('[data-range]').forEach((b) => b.onclick = () => { [from.value, to.value] = ranges()[b.dataset.range]; cb(); });
}
const dateFilter = (q, from, to) => { if (from) q = q.gte('work_date', from); if (to) q = q.lte('work_date', to); return q; };

// ---------- login ----------
function viewLogin(msg = '') {
  header('Space to play and much more!', 'Staff timesheet login');
  app.innerHTML = `<div class="card narrow">
    <h2>Staff login</h2>
    <p class="muted">Enter your email address and we'll email you a login code. New staff can use this too – you'll be asked for your details.</p>
    <form id="f">
      <label for="email">Email address</label>
      <input id="email" type="email" autocomplete="email" required value="${esc(state.email)}" placeholder="name@example.com">
      <button class="btn block">Email me a code</button>
      <p class="error" id="err">${esc(msg)}</p>
    </form>
  </div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button', e.target); btn.disabled = true;
    state.email = $('#email').value.trim().toLowerCase();
    try {
      check(await sb.auth.signInWithOtp({ email: state.email, options: { shouldCreateUser: true } }));
      viewVerify();
    } catch (err) { $('#err').textContent = err.message; btn.disabled = false; }
  };
}

function viewVerify() {
  app.innerHTML = `<div class="card narrow">
    <h2>Enter your code</h2>
    <p class="muted">We've emailed a login code to <strong>${esc(state.email)}</strong>. Check your junk folder if it hasn't arrived within a minute.</p>
    <form id="f">
      <label for="code">Login code</label>
      <input id="code" inputmode="numeric" autocomplete="one-time-code" pattern="\\d{6,10}" maxlength="10" required style="font-size:1.6rem;letter-spacing:.3em;text-align:center">
      <button class="btn block">Log in</button>
      <p class="error" id="err"></p>
    </form>
    <p class="or"><a href="#" id="back">Didn't get it? Send a new code</a></p>
  </div>`;
  $('#code').focus();
  $('#back').onclick = (e) => { e.preventDefault(); viewLogin(); };
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button', e.target); btn.disabled = true;
    try {
      check(await sb.auth.verifyOtp({ email: state.email, token: $('#code').value.trim(), type: 'email' }));
      await start();
    } catch (err) { $('#err').textContent = err.message; btn.disabled = false; }
  };
}

function userFields(u = {}, withEmail = true) {
  return `<div class="row">
      <div><label>Forename</label><input name="forename" required maxlength="50" autocomplete="given-name" value="${esc(u.forename)}"></div>
      <div><label>Surname</label><input name="surname" required maxlength="50" autocomplete="family-name" value="${esc(u.surname)}"></div>
    </div>
    ${withEmail ? `<label>Email</label><input name="email" type="email" required autocomplete="email" value="${esc(u.email)}">` : ''}
    <label>Mobile number</label><input name="phone" type="tel" required maxlength="20" autocomplete="tel" value="${esc(u.phone)}" placeholder="07…">`;
}

// ---------- first login: details + waiting for approval ----------
function viewDetails() {
  header('Join the team', 'Tell us who you are');
  app.innerHTML = `<div class="card narrow">
    <h2>Your details</h2>
    <p class="muted">Logged in as <strong>${esc(state.profile.email)}</strong>. Once you've saved your details, the administrator will approve your account.</p>
    <form id="f">${userFields({}, false)}<button class="btn block">Save details</button><p class="error" id="err"></p></form>
  </div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      check(await sb.from('profiles').update(formData(e.target)).eq('id', state.profile.id));
      await start();
    } catch (err) { $('#err').textContent = err.message; }
  };
}

function viewWaiting() {
  const inactive = state.profile.status === 'inactive';
  header(`Hello ${state.profile.forename}!`, inactive ? 'Account not active' : 'Awaiting approval');
  app.innerHTML = `<div class="card narrow">
    <h2>${inactive ? 'Account not active' : 'Nearly there!'}</h2>
    <p>${inactive ? 'Your account is not currently active. Please contact the office.' : 'Thanks for registering. The administrator needs to approve your account before you can log hours. Please let them know you have registered.'}</p>
    ${inactive ? '' : '<button class="btn block" id="again">Check again</button>'}
  </div>`;
  if (!inactive) $('#again').onclick = start;
}

// ---------- staff: log hours + history ----------
function entryForm(e = {}) {
  const acts = CFG.activities.includes(e.activity) || !e.activity ? CFG.activities : [...CFG.activities, e.activity];
  const opts = acts.map((a) => `<option ${a === e.activity ? 'selected' : ''}>${esc(a)}</option>`).join('');
  return `<label>Date</label><input name="work_date" type="date" required max="${iso(new Date())}" value="${e.work_date || iso(new Date())}">
    <label>Activity / session</label><select name="activity" required><option value="">Choose…</option>${opts}</select>
    <div class="row three">
      <div><label>Start</label><input name="start_time" type="time" required value="${t5(e.start_time)}"></div>
      <div><label>Finish</label><input name="end_time" type="time" required value="${t5(e.end_time)}"></div>
      <div><label>Break (mins)</label><input name="break_mins" type="number" min="0" max="600" step="5" value="${e.break_mins ?? 0}"></div>
    </div>
    <label>Notes (optional)</label><textarea name="notes" maxlength="500">${esc(e.notes)}</textarea>
    <div class="calc" data-calc>Total: 0.00 hours</div>`;
}
function entryData(form) {
  const f = formData(form);
  return { work_date: f.work_date, activity: f.activity, start_time: f.start_time, end_time: f.end_time, break_mins: parseInt(f.break_mins, 10) || 0, notes: f.notes.trim() };
}
function liveCalc(form) {
  const upd = () => {
    const f = formData(form);
    if (!f.start_time || !f.end_time) return;
    const [a, b] = [f.start_time, f.end_time].map((t) => t.split(':').reduce((h, m) => h * 60 + +m));
    const m = b - a - (+f.break_mins || 0);
    $('[data-calc]', form).textContent = m > 0 ? `Total: ${hrs(m / 60)} hours` : 'Finish must be after start';
  };
  form.addEventListener('input', upd); upd();
}

function viewStaff(container = app) {
  container.innerHTML = `<div class="grid two">
    <div class="card"><h2>Log hours</h2><form id="add">${entryForm()}<button class="btn block">Save hours</button><p class="error" id="err"></p></form></div>
    <div class="card"><h2>My hours</h2>
      <div class="row"><div><label>From</label><input type="date" id="from"></div><div><label>To</label><input type="date" id="to"></div></div>
      ${chipsHtml()}
      <div class="total"><span id="count">Total</span><strong id="sum">0.00</strong></div>
      <ul class="entries" id="list"></ul>
    </div></div>`;
  const add = $('#add', container), from = $('#from', container), to = $('#to', container);
  [from.value, to.value] = ranges()['This month'];
  liveCalc(add);
  add.onsubmit = async (e) => {
    e.preventDefault();
    try {
      check(await sb.from('entries').insert(entryData(add)));
      toast('Hours saved ✔'); add.reset(); add.work_date.value = iso(new Date()); add.break_mins.value = 0; $('#err', container).textContent = ''; load();
    } catch (err) { $('#err', container).textContent = err.message; }
  };
  async function load() {
    const entries = await fetchAll(() => dateFilter(sb.from('entries').select('*').eq('user_id', state.profile.id), from.value, to.value)
      .order('work_date', { ascending: false }).order('start_time', { ascending: false }));
    $('#sum', container).textContent = hrs(entries.reduce((s, e) => s + Number(e.hours), 0)) + ' hrs';
    $('#count', container).textContent = `${entries.length} shift${entries.length === 1 ? '' : 's'}`;
    $('#list', container).innerHTML = entries.length ? entries.map((e) => `<li>
        <span class="when">${fmtDate(e.work_date)}</span><span class="hrs">${hrs(e.hours)}</span>
        <span class="meta"><span class="tag">${esc(e.activity)}</span> ${t5(e.start_time)}–${t5(e.end_time)}${e.break_mins ? ` · ${e.break_mins} min break` : ''}${e.notes ? `<br>${esc(e.notes)}` : ''}</span>
        <span class="acts">${editable(e) ? `<button class="btn small ghost" data-edit="${e.id}">Edit</button>` : '<span class="muted">Locked</span>'}</span>
      </li>`).join('') : '<li class="muted">No hours logged for this period.</li>';
    container.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => editEntry(entries.find((x) => x.id == b.dataset.edit), load));
  }
  from.onchange = to.onchange = load;
  bindChips(container, from, to, load);
  load().catch((e) => toast(e.message));
}

function editEntry(e, done) {
  const d = document.createElement('dialog');
  d.innerHTML = `<h2>Edit hours</h2><form id="ef">${entryForm(e)}
    <div class="btns" style="margin-top:16px"><button class="btn">Save</button><button type="button" class="btn ghost" id="cx">Cancel</button></div>
    <p class="error" id="eerr"></p><p class="or"><a href="#" id="del" style="color:var(--red)">Delete this entry</a></p></form>`;
  document.body.append(d); d.showModal();
  const f = $('#ef', d); liveCalc(f);
  $('#cx', d).onclick = () => d.remove();
  d.addEventListener('close', () => d.remove());
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    try { check(await sb.from('entries').update(entryData(f)).eq('id', e.id).select()); d.remove(); toast('Entry updated'); done(); }
    catch (err) { $('#eerr', d).textContent = err.message; }
  };
  $('#del', d).onclick = async (ev) => {
    ev.preventDefault();
    if (!confirm('Delete this entry?')) return;
    try { check(await sb.from('entries').delete().eq('id', e.id)); d.remove(); toast('Entry deleted'); done(); }
    catch (err) { $('#eerr', d).textContent = err.message; }
  };
}

// ---------- admin ----------
function viewAdmin(tab = 'timesheets') {
  app.innerHTML = `<div class="tabs">
    <button data-tab="timesheets">Timesheets</button><button data-tab="staff">Staff <span id="pend"></span></button><button data-tab="mine">My hours</button>
  </div><div id="pane"></div>`;
  app.querySelectorAll('[data-tab]').forEach((b) => { b.classList.toggle('on', b.dataset.tab === tab); b.onclick = () => viewAdmin(b.dataset.tab); });
  sb.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending')
    .then(({ count }) => { if (count) $('#pend').textContent = `(${count} new)`; });
  const pane = $('#pane');
  const run = tab === 'mine' ? viewStaff : tab === 'staff' ? adminStaff : adminTimesheets;
  Promise.resolve(run(pane)).catch((e) => toast(e.message));
}

async function adminTimesheets(pane) {
  const users = check(await sb.from('profiles').select('id, forename, surname').order('surname'));
  pane.innerHTML = `<div class="card"><h2>Hours logged</h2>
    <div class="filters">
      <div><label>From</label><input type="date" id="from"></div>
      <div><label>To</label><input type="date" id="to"></div>
      <div><label>Staff member</label><select id="who"><option value="">Everyone</option>${users.map((u) => `<option value="${u.id}">${esc(u.surname)}, ${esc(u.forename)}</option>`).join('')}</select></div>
      <div><button class="btn block" id="csv" style="margin:0">Export CSV</button></div>
    </div>${chipsHtml()}
    <div class="total"><span id="count"></span><strong id="sum"></strong></div>
    <h3>Summary by staff member</h3><div class="table-wrap"><table><thead><tr><th>Name</th><th class="num">Shifts</th><th class="num">Hours</th></tr></thead><tbody id="summary"></tbody></table></div>
    <h3 style="margin-top:20px">All entries</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Name</th><th>Activity</th><th>Times</th><th class="num">Break</th><th class="num">Hours</th><th class="hide-sm">Notes</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
  </div>`;
  const from = $('#from'), to = $('#to'), who = $('#who');
  [from.value, to.value] = ranges()['This month'];
  let entries = [];
  const query = () => fetchAll(() => {
    let q = dateFilter(sb.from('entries').select('*, profiles(forename, surname, email, phone)'), from.value, to.value);
    if (who.value) q = q.eq('user_id', who.value);
    return q.order('work_date', { ascending: false }).order('start_time');
  });
  async function load() {
    entries = await query();
    const name = (e) => `${e.profiles?.surname}, ${e.profiles?.forename}`;
    $('#sum').textContent = hrs(entries.reduce((s, e) => s + Number(e.hours), 0)) + ' hrs';
    $('#count').textContent = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
    const by = {};
    entries.forEach((e) => { const k = name(e); by[k] = by[k] || { n: 0, h: 0 }; by[k].n++; by[k].h += Number(e.hours); });
    $('#summary').innerHTML = Object.keys(by).sort().map((k) => `<tr><td>${esc(k)}</td><td class="num">${by[k].n}</td><td class="num"><strong>${hrs(by[k].h)}</strong></td></tr>`).join('') || '<tr><td colspan="3" class="muted">No entries.</td></tr>';
    $('#rows').innerHTML = entries.map((e) => `<tr><td style="white-space:nowrap">${fmtDate(e.work_date)}</td><td>${esc(e.profiles?.forename)} ${esc(e.profiles?.surname)}</td><td>${esc(e.activity)}</td>
      <td style="white-space:nowrap">${t5(e.start_time)}–${t5(e.end_time)}</td><td class="num">${e.break_mins}</td><td class="num"><strong>${hrs(e.hours)}</strong></td><td class="hide-sm">${esc(e.notes)}</td>
      <td><button class="btn small ghost" data-edit="${e.id}">Edit</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">No entries for this period.</td></tr>';
    pane.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => editEntry(entries.find((x) => x.id == b.dataset.edit), load));
  }
  const reload = () => load().catch((e) => toast(e.message));
  from.onchange = to.onchange = who.onchange = reload;
  bindChips(pane, from, to, reload);
  $('#csv').onclick = () => downloadCsv([...entries].reverse(), from.value, to.value);
  await load();
}

function downloadCsv(rows, from, to) {
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['Date', 'Forename', 'Surname', 'Email', 'Phone', 'Activity', 'Start', 'Finish', 'Break (mins)', 'Hours', 'Notes', 'Last updated'];
  const lines = rows.map((r) => [r.work_date, r.profiles?.forename, r.profiles?.surname, r.profiles?.email, r.profiles?.phone, r.activity,
    t5(r.start_time), t5(r.end_time), r.break_mins, r.hours, r.notes, new Date(r.updated_at).toLocaleString('en-GB')].map(cell).join(','));
  const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `timesheets_${from || 'all'}_to_${to || 'all'}.csv` });
  document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
}

async function adminStaff(pane) {
  const [users, invites] = await Promise.all([
    sb.from('profiles').select('*').order('surname').then(check),
    sb.from('staff_invites').select('*').order('surname').then(check),
  ]);
  const pending = users.filter((u) => u.status === 'pending');
  const name = (u) => u.forename ? `${esc(u.surname)}, ${esc(u.forename)}` : '<span class="muted">(details not entered yet)</span>';
  pane.innerHTML = `${pending.length ? `<div class="card" style="border-top-color:var(--orange)"><h2>Awaiting approval (${pending.length})</h2>
      <ul class="entries">${pending.map((u) => `<li><span class="when">${name(u)}</span>
        <span class="acts"><button class="btn small green" data-approve="${u.id}">Approve</button><button class="btn small ghost" data-reject="${u.id}">Reject</button></span>
        <span class="meta">${esc(u.email)} · ${esc(u.phone)}</span></li>`).join('')}</ul></div>` : ''}
    <div class="card"><div class="btns" style="justify-content:space-between;align-items:center;margin-bottom:10px"><h2 style="margin:0">Staff</h2><button class="btn small" id="addu" style="flex:0;white-space:nowrap">+ Add staff</button></div>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Mobile</th><th>Status</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr><td>${name(u)} ${u.role === 'admin' ? '<span class="tag admin">Admin</span>' : ''}</td><td>${esc(u.email)}</td><td style="white-space:nowrap">${esc(u.phone)}</td>
        <td><span class="tag ${u.status}">${u.status}</span></td><td><button class="btn small ghost" data-uedit="${u.id}">Edit</button></td></tr>`).join('')}
      ${invites.map((i) => `<tr><td>${esc(i.surname)}, ${esc(i.forename)} ${i.role === 'admin' ? '<span class="tag admin">Admin</span>' : ''}</td><td>${esc(i.email)}</td><td style="white-space:nowrap">${esc(i.phone)}</td>
        <td><span class="tag pending">invited</span></td><td><button class="btn small ghost" data-uninvite="${esc(i.email)}">Remove</button></td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted">Invited staff are approved automatically the first time they log in with that email address.</p></div>`;
  const reload = () => adminStaff(pane).catch((e) => toast(e.message));
  const set = async (id, body, msg) => { try { check(await sb.from('profiles').update(body).eq('id', id)); toast(msg); reload(); } catch (e) { toast(e.message); } };
  pane.querySelectorAll('[data-approve]').forEach((b) => b.onclick = () => set(b.dataset.approve, { status: 'active' }, 'Approved'));
  pane.querySelectorAll('[data-reject]').forEach((b) => b.onclick = () => set(b.dataset.reject, { status: 'inactive' }, 'Rejected'));
  pane.querySelectorAll('[data-uedit]').forEach((b) => b.onclick = () => userDialog(users.find((u) => u.id == b.dataset.uedit), reload));
  pane.querySelectorAll('[data-uninvite]').forEach((b) => b.onclick = async () => {
    try { check(await sb.from('staff_invites').delete().eq('email', b.dataset.uninvite)); toast('Invite removed'); reload(); } catch (e) { toast(e.message); }
  });
  $('#addu').onclick = () => userDialog(null, reload);
}

function userDialog(u, done) {
  const d = document.createElement('dialog');
  const sel = (n, opts, cur) => `<select name="${n}">${opts.map((o) => `<option value="${o}" ${o === cur ? 'selected' : ''}>${o[0].toUpperCase() + o.slice(1)}</option>`).join('')}</select>`;
  d.innerHTML = `<h2>${u ? 'Edit staff member' : 'Add staff member'}</h2><form id="uf">${userFields(u || {}, !u)}
    ${u ? `<p class="muted">Email: ${esc(u.email)}</p>` : ''}
    <div class="row"><div><label>Role</label>${sel('role', ['staff', 'admin'], u?.role || 'staff')}</div>
    ${u ? `<div><label>Status</label>${sel('status', ['active', 'pending', 'inactive'], u.status)}</div>` : ''}</div>
    <div class="btns" style="margin-top:16px"><button class="btn">Save</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><p class="error" id="uerr"></p></form>`;
  document.body.append(d); d.showModal();
  $('#cx', d).onclick = () => d.remove();
  d.addEventListener('close', () => d.remove());
  $('#uf', d).onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    try {
      if (u) check(await sb.from('profiles').update(f).eq('id', u.id));
      else {
        f.email = f.email.trim().toLowerCase();
        const { count } = await sb.from('profiles').select('id', { count: 'exact', head: true }).eq('email', f.email);
        if (count) throw new Error('That person already has an account – edit them in the list instead.');
        check(await sb.from('staff_invites').insert(f));
      }
      d.remove(); toast(u ? 'Saved' : 'Staff member added – they can now log in'); done();
    } catch (err) { $('#uerr', d).textContent = err.message; }
  };
}

// ---------- start-up ----------
async function start() {
  const { data: { session } } = await sb.auth.getSession();
  $('#logout').hidden = !session;
  if (!session) return viewLogin();
  try {
    state.profile = check(await sb.from('profiles').select('*').eq('id', session.user.id).single());
  } catch (e) { return viewLogin(e.message); }
  const p = state.profile;
  if (!p.forename) return viewDetails();
  if (p.status !== 'active') return viewWaiting();
  header(`Hello ${p.forename}!`, p.role === 'admin' ? 'Administrator' : 'Log your hours below');
  p.role === 'admin' ? viewAdmin() : viewStaff();
}
$('#logout').onclick = async () => { await sb.auth.signOut(); state.profile = null; start(); };

start();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
