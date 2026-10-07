// =====================================================================
//  ShowOps v2 — app logic.  You don't need to edit this file.
//  (Your settings go in config.js.)
// =====================================================================
(function () {
  "use strict";

  const CFG = window.SHOWOPS_CONFIG || {};
  const APP = CFG.APP_NAME || "ShowOps";
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const root = $("#app");

  // ---------- 0. Check settings ----------
  const notConfigured = !CFG.SUPABASE_URL || !CFG.SUPABASE_KEY ||
    CFG.SUPABASE_URL.includes("PASTE") || CFG.SUPABASE_KEY.includes("PASTE");
  if (notConfigured || !window.supabase) {
    root.innerHTML = `<div class="setup card">
      <h1>Almost there 👋</h1>
      ${!window.supabase
        ? `<p>The Supabase library didn't load. Check your internet connection and refresh.</p>`
        : `<p>Open <code>config.js</code> and paste your Supabase <b>Project URL</b> and <b>Publishable key</b> between the quotes, then save and refresh this page.</p>`}
    </div>`;
    return;
  }
  const sb = window.supabase.createClient(CFG.SUPABASE_URL.trim(), CFG.SUPABASE_KEY.trim());

  // ---------- 1. App state ----------
  const S = {
    me: null, profiles: [], shows: [], tasks: [], issues: [], log: [], batches: [], invites: [],
    tasksByShow: new Map(), batchesByShow: new Map(), issuesByShow: new Map(),
    settings: { request_start: "06:00:00", request_end: "18:30:00", timezone: "Asia/Kolkata", tat_days: {}, maq_warn_days: 7 },
    page: "dashboard", param: null, live: false, channel: null, redraw: null, v2: true,
    f: {                     // remembered filters per page
      shows: { q: "", stage: "", ops: "", source: "", maq: "", sort: "name" },
      production: { q: "", only: "" },
      maq: { q: "", status: "alerts" },
      tracker: { q: "", person: "", status: "open", p: "", special: "", type: "", group: false },
      blockers: { status: "active", severity: "" },
      mytasks: { filter: "" },
      log: { q: "" },
    },
    selected: new Set(),
  };

  const PAGES = [
    ["dashboard", "Dashboard", "⌂"],
    ["shows", "Shows Master", "▣"],
    ["production", "Production Tracker", "▦"],
    ["maq", "MAQ Alerts", "⏱"],
    ["raise", "Raise Request", "＋"],
    ["tracker", "Task Tracker", "☰"],
    ["blockers", "Blockers / Issues", "⚠"],
    ["mytasks", "My Tasks", "✓"],
    ["log", "Activity Log", "≡"],
    ["team", "Team & Settings", "⚙"],
  ];
  const HIDDEN_PAGES = ["show"];
  const STATUSES = ["Unassigned", "Assigned", "In Progress", "Blocked", "Completed", "Cancelled"];
  const TASK_TYPES = ["L/S", "Adaptation", "AIVO", "Translation", "Summary", "QC", "Other"];
  const WAITING_ON = ["Ops", "Writer", "Rectifier", "Producer", "Sound Engineer", "Proofreader"];
  const BATCH_STATUSES = ["Not started", "Pending (Writer)", "Pending (Ops)", "Await", "Batch pending", "Done", "NA", "Early closure"];
  const PROD_STAGES = ["Yet to pick", "Step 1: SS + LOC received", "Step 2: LS V3 vetted", "Step 3: Adapted script vetted", "Step 4: Audio QC",
    "Step 5: Rectify / Re-Gen", "Step 6: SE patchwork", "Step 7: GTG from production", "Launched", "Unpublished", "Not to be picked", "Show Dropped", "On Hold"];
  const SOURCE_STATES = ["Running", "Completed", "Hiatus", "NA"];
  const DE_STATUSES = ["Launch Planned", "Running", "Completed", "Hiatus", "Unpublished"];
  const MAQ_STATES = ["Running", "Completed", "On Hold"];

  // ---------- 2. Small helpers ----------
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const role = () => S.me?.role;
  const isStaff = () => role() === "ops" || role() === "manager";
  const isManager = () => role() === "manager";
  const person = (id) => S.profiles.find((p) => p.id === id);
  const nameOf = (id) => (id ? person(id)?.full_name || "Former member" : "—");
  const showById = (id) => S.shows.find((s) => s.id === id);
  const showName = (id) => (id ? showById(id)?.name || "Deleted show" : "—");
  const members = () => S.profiles.filter((p) => p.role !== "pending").sort((a, b) => a.full_name.localeCompare(b.full_name));
  const tz = () => S.settings.timezone || "Asia/Kolkata";
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
  const showLink = (id, label) => `<a href="#show/${id}" class="showlink">${esc(label ?? showName(id))}</a>`;

  function todayStr() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
  function nowHM() {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz(), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  }
  function dateInTz(ts) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
  }
  const dayNum = (d) => { const [y, m, dd] = d.split("-").map(Number); return Date.UTC(y, m - 1, dd) / 86400000; };
  const daysBetween = (a, b) => dayNum(b) - dayNum(a);      // b - a, in days
  const addDays = (d, n) => new Date((dayNum(d) + n) * 86400000).toISOString().slice(0, 10);
  function fmtDate(d) {
    if (!d) return "—";
    const [y, m, dd] = d.split("-").map(Number);
    return `${dd} ${MON[m - 1]} ${y}`;
  }
  function fmtDT(ts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleString("en-IN", { timeZone: tz(), day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
  }
  function ago(ts) {
    const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
  }
  const hm = (t) => (t || "").slice(0, 5);
  const initials = (n) => (n || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  function colorFor(id) {
    const palette = ["#4f46e5", "#0e9f6e", "#d97706", "#db2777", "#2563eb", "#7c3aed", "#0891b2", "#65a30d", "#dc2626", "#475569"];
    let h = 0; for (const c of String(id || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return palette[h % palette.length];
  }
  const avatar = (id, name) => `<span class="av" style="background:${colorFor(id || name)}">${esc(initials(name ?? nameOf(id)))}</span>`;
  const linkify = (v) => {
    const s = String(v ?? "");
    const m = s.match(/^(.*?)\s*\|\s*(https?:\/\/\S+)$/);
    if (m) return `<a href="${esc(m[2])}" target="_blank" rel="noopener">${esc(m[1] || "Open")}</a>`;
    if (/^https?:\/\//.test(s)) return `<a href="${esc(s)}" target="_blank" rel="noopener">Open link ↗</a>`;
    return esc(s).replace(/\n/g, "<br>");
  };

  // Task rules
  const isOpen = (t) => t.status !== "Completed" && t.status !== "Cancelled";
  const isOverdue = (t) => isOpen(t) && t.deadline && t.deadline < todayStr();
  const isDueToday = (t) => isOpen(t) && t.deadline === todayStr();
  const isHigh = (t) => isOpen(t) && (t.high_flag || t.p_level === "P0");
  const tatFor = (type) => { const m = S.settings.tat_days || {}; return Number(m[type] ?? m.Other ?? 3); };
  function delay(t) {          // { late, days, why }
    if (!isOpen(t)) return { late: false };
    const today = todayStr();
    if (t.deadline) {
      const d = daysBetween(t.deadline, today);
      return { late: d > 0, days: d, why: "past deadline" };
    }
    const age = daysBetween(dateInTz(t.created_at), today);
    const tat = tatFor(t.task_type);
    return { late: age > tat, days: age - tat, why: `over ${tat}-day turnaround` };
  }
  const isDelayed = (t) => delay(t).late;
  const assigneeName = (t) => (t.assigned_to ? nameOf(t.assigned_to) : t.poc_name ? `${t.poc_name}*` : "—");
  const openIssues = () => S.issues.filter((i) => i.status !== "Resolved");

  // Batch / production rules
  const batchesFor = (showId) => {
    const s = showById(showId); const all = S.batchesByShow.get(showId) || [];
    // The old trackers filled "NA" in every column past a show's length; those aren't real batches.
    return all.filter((b) => !(b.loc_status === "NA" && b.adapted_status === "NA" && s && s.source_eps && b.ep_from > s.source_eps));
  };
  const COMPLETE = ["Done", "NA", "Early closure"];
  function progressOf(s) {
    const bs = batchesFor(s.id);
    const total = s.source_eps ? Math.max(Math.ceil(s.source_eps / 100), bs.length) : bs.length;
    const loc = bs.filter((b) => COMPLETE.includes(b.loc_status)).length;
    const adp = bs.filter((b) => COMPLETE.includes(b.adapted_status)).length;
    const cnt = (st) => bs.reduce((n, b) => n + (b.loc_status === st) + (b.adapted_status === st), 0);
    return {
      total, loc, adp, pct: total ? Math.min(1, adp / total) : null,
      writer: cnt("Pending (Writer)"), ops: cnt("Pending (Ops)"), await: cnt("Await"), batchPending: cnt("Batch pending"),
    };
  }

  // MAQ rules (same as the "Queue Alerts" sheet)
  function maqInfo(s) {
    const tracked = !!(s.maq_till_date || s.maq_pattern || s.maq_till_ep);
    if (!tracked) return { tracked: false };
    const finished = ["On Hold", "Completed"].includes(s.maq_state) || /completed/i.test(s.maq_comments || "") ||
      (s.source_eps && !/\+/.test(s.source_eps_note || "") && s.maq_till_ep != null && s.maq_till_ep >= s.source_eps);
    if (finished) return { tracked: true, status: "DONE" };
    if (!s.maq_till_date) return { tracked: true, status: "FIX DATE" };
    const d = s.maq_till_date;
    const dow = new Date(dayNum(d) * 86400000).getUTCDay();          // 0 Sun … 6 Sat
    const alertOn = dow === 6 ? addDays(d, -1) : dow === 0 ? addDays(d, -2) : d;
    const today = todayStr();
    const daysLeft = daysBetween(today, d);
    const warn = Number(S.settings.maq_warn_days ?? 7);
    const status = today > d ? "OVERDUE" : today >= alertOn ? "QUEUE TODAY" : daysBetween(today, alertOn) <= warn ? "COMING UP" : "OK";
    return { tracked: true, status, alertOn, daysLeft };
  }
  const MAQ_CLS = { OVERDUE: "bad", "QUEUE TODAY": "warn", "COMING UP": "info", OK: "good", DONE: "", "FIX DATE": "accent" };
  const maqPill = (st) => (st ? `<span class="pill ${MAQ_CLS[st] || ""}">${esc(st)}</span>` : `<span class="dim">—</span>`);
  const maqAlerts = () => S.shows.map((s) => ({ s, m: maqInfo(s) })).filter((x) => ["OVERDUE", "QUEUE TODAY"].includes(x.m.status));

  const pill = (txt, cls = "") => `<span class="pill ${cls}">${esc(txt)}</span>`;
  const STATUS_CLS = { Unassigned: "warn", Assigned: "info", "In Progress": "accent", Blocked: "bad", Completed: "good", Cancelled: "", "No Active Task": "", Open: "bad", Investigating: "warn", Resolved: "good" };
  const statusPill = (s) => pill(s, STATUS_CLS[s] || "");
  const hmlPill = (h) => pill(h, { High: "bad", Medium: "info", Low: "" }[h]);
  const pPill = (p) => pill(p, { P0: "bad", P1: "warn", P2: "info" }[p]);
  const sevPill = (s) => pill(s, { Critical: "bad", High: "warn", Medium: "info", Low: "" }[s]);
  const stagePill = (st) => {
    if (!st) return `<span class="dim">—</span>`;
    const cls = st === "Launched" ? "good" : /Dropped|Not to be/.test(st) ? "" : /^Step/.test(st) ? "accent" : st === "Unpublished" || st === "On Hold" ? "warn" : "info";
    return pill(st.replace(/ from production$/, ""), cls);
  };
  const BCLS = { "Not started": "b-none", "Pending (Writer)": "b-writer", "Pending (Ops)": "b-ops", Await: "b-await", "Batch pending": "b-bp", Done: "b-done", NA: "b-na", "Early closure": "b-early" };
  const batchPill = (s) => `<span class="bpill ${BCLS[s] || ""}">${esc(s)}</span>`;
  const highCell = (t) => (t.high_flag ? `<span class="flag">● Yes</span>` : `<span class="dim">—</span>`);
  function deadlineCell(t) {
    const d = delay(t);
    const base = t.deadline ? `<span class="${isOverdue(t) ? "late" : ""}">${fmtDate(t.deadline)}</span>` : `<span class="dim">—</span>`;
    return d.late ? `${base}<small class="late">⚠ ${d.days} day${d.days === 1 ? "" : "s"} late</small>` : base;
  }
  const progressBar = (p) => (p.pct == null ? `<span class="dim">—</span>`
    : `<div class="pbar" title="${p.adp}/${p.total} adapted batches done"><span style="width:${Math.round(p.pct * 100)}%"></span></div><small>${Math.round(p.pct * 100)}% · ${p.adp}/${p.total}</small>`);

  const PR = { P0: 0, P1: 1, P2: 2 }, HR = { High: 0, Medium: 1, Low: 2 };
  const prioritySort = (a, b) =>
    !isOpen(a) - !isOpen(b) ||
    isDelayed(b) - isDelayed(a) ||
    b.high_flag - a.high_flag ||
    PR[a.p_level] - PR[b.p_level] ||
    HR[a.hml] - HR[b.hml] ||
    (a.deadline || "9999").localeCompare(b.deadline || "9999") ||
    new Date(b.updated_at) - new Date(a.updated_at);
  const newestFirst = (a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);

  function friendly(error) {
    const m = error?.message || String(error);
    if (/row-level security|permission denied/i.test(m)) return "You don't have permission to do that.";
    if (/duplicate key.*shows_name/i.test(m)) return "A show with that name already exists.";
    if (/duplicate key.*ext_id/i.test(m)) return "A task with that Task ID already exists.";
    if (/duplicate key.*show_batches/i.test(m)) return "That batch already exists for this show.";
    if (/column .* does not exist|Could not find the .* column|relation .*show_batches.* does not exist/i.test(m)) return "The database needs updating: run update-v2.sql in Supabase.";
    if (/Failed to fetch|NetworkError/i.test(m)) return "Can't reach the server. Check your internet connection.";
    return m;
  }

  function toast(msg, kind = "") {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = msg;
    $("#toasts").append(el);
    setTimeout(() => el.classList.add("out"), 4000);
    setTimeout(() => el.remove(), 4500);
  }

  async function save(request, okMsg) {
    const { error } = await request;
    if (error) { toast(friendly(error), "bad"); refresh(); return false; }
    if (okMsg) toast(okMsg, "good");
    await loadAll();
    refresh();
    return true;
  }

  // ---------- 3. Modal ----------
  function openModal(title, body, onMount, wide) {
    const m = $("#modal");
    m.innerHTML = `<div class="modal-card ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h3>${esc(title)}</h3><button type="button" data-close aria-label="Close">✕</button></div>
      <div class="modal-body">${body}</div></div>`;
    m.hidden = false;
    m.onclick = (e) => { if (e.target === m || e.target.closest("[data-close]")) closeModal(); };
    const first = $("input:not([type=hidden]), select, textarea", m);
    if (first) first.focus();
    if (onMount) onMount(m);
  }
  function closeModal() { const m = $("#modal"); m.hidden = true; m.innerHTML = ""; }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });

  // ---------- 4. Loading data ----------
  async function fetchAll(table, orderBy) {
    const out = [];
    const size = 1000;
    for (let from = 0; ; from += size) {
      const { data, error } = await sb.from(table).select("*").order(orderBy, { ascending: true }).range(from, from + size - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < size) break;
    }
    return out;
  }

  async function loadAll() {
    try {
      const [profiles, shows, tasks, issues, logRes, setRes] = await Promise.all([
        fetchAll("profiles", "created_at"),
        fetchAll("shows", "id"),
        fetchAll("tasks", "id"),
        fetchAll("issues", "id"),
        sb.from("activity_log").select("*").order("id", { ascending: false }).limit(500),
        sb.from("settings").select("*").eq("id", 1).maybeSingle(),
      ]);
      let batches = [];
      try { batches = await fetchAll("show_batches", "ep_from"); S.v2 = true; } catch (e) { S.v2 = false; }
      let invites = [];
      if (isManager() && S.v2) { try { invites = await fetchAll("invites", "created_at"); } catch (e) { /* not yet */ } }
      Object.assign(S, { profiles, shows, tasks, issues, batches, invites, log: logRes.data || [] });
      if (setRes.data) S.settings = { ...S.settings, ...setRes.data };
      const meNow = profiles.find((p) => p.id === S.me?.id);
      if (meNow) S.me = meNow;
      S.tasksByShow = new Map(); for (const t of tasks) { if (!S.tasksByShow.has(t.show_id)) S.tasksByShow.set(t.show_id, []); S.tasksByShow.get(t.show_id).push(t); }
      S.batchesByShow = new Map(); for (const b of batches) { if (!S.batchesByShow.has(b.show_id)) S.batchesByShow.set(b.show_id, []); S.batchesByShow.get(b.show_id).push(b); }
      for (const list of S.batchesByShow.values()) list.sort((a, b) => a.ep_from - b.ep_from);
      S.issuesByShow = new Map(); for (const i of issues) { if (!S.issuesByShow.has(i.show_id)) S.issuesByShow.set(i.show_id, []); S.issuesByShow.get(i.show_id).push(i); }
    } catch (e) {
      toast("Couldn't load data: " + friendly(e), "bad");
    }
  }

  let reloadTimer = null;
  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      const oldRole = role();
      await loadAll();
      if (role() !== oldRole) { boot(); return; }
      refresh();
    }, 500);
  }

  function subscribe() {
    if (S.channel) return;
    S.channel = sb
      .channel("showops-live")
      .on("postgres_changes", { event: "*", schema: "public" }, (payload) => {
        if (payload.table === "activity_log" && payload.eventType === "INSERT" && payload.new.user_id && payload.new.user_id !== S.me?.id) {
          const l = payload.new;
          toast(`${nameOf(l.user_id)}: ${l.action}${l.show_id ? " · " + showName(l.show_id) : ""}`);
        }
        scheduleReload();
      })
      .subscribe((status) => { S.live = status === "SUBSCRIBED"; const b = $("#live"); if (b) b.outerHTML = liveBadge(); });
  }
  const liveBadge = () => `<span id="live" class="live ${S.live ? "on" : ""}" title="${S.live ? "Changes from others appear instantly" : "Not connected live. Refresh the page to see others' changes."}"><i></i>${S.live ? "Live" : "Not live"}</span>`;

  // ---------- 5. Sign in / sign up ----------
  function renderAuth(mode = "in", msg = "") {
    root.innerHTML = `<div class="auth"><div class="card">
      <div class="brand"><i style="color:#fff">✓</i>${esc(APP)}</div>
      <div class="tabs" role="tablist">
        <button type="button" data-mode="in" class="${mode === "in" ? "on" : ""}">Sign in</button>
        <button type="button" data-mode="up" class="${mode === "up" ? "on" : ""}">Create account</button>
      </div>
      <form id="authForm">
        ${mode === "up" ? `<div class="field"><label for="a_name">Full name</label><input id="a_name" type="text" required autocomplete="name"></div>` : ""}
        <div class="field"><label for="a_email">Email</label><input id="a_email" type="email" required autocomplete="email"></div>
        <div class="field"><label for="a_pass">Password <small>(at least 6 characters)</small></label><input id="a_pass" type="password" minlength="6" required autocomplete="${mode === "up" ? "new-password" : "current-password"}"></div>
        <button class="btn primary" type="submit">${mode === "up" ? "Create account" : "Sign in"}</button>
        <div class="form-error" id="authErr">${esc(msg)}</div>
      </form>
      <p class="hint">${mode === "up" ? "Use your full name. If your Manager added your email, you'll get access straight away; otherwise a Manager approves you." : "New here? Choose “Create account”."}</p>
    </div></div>`;
    $$("[data-mode]").forEach((b) => (b.onclick = () => renderAuth(b.dataset.mode)));
    $("#authForm").onsubmit = async (e) => {
      e.preventDefault();
      const btn = $("#authForm button[type=submit]");
      btn.disabled = true;
      const email = $("#a_email").value.trim();
      const password = $("#a_pass").value;
      let res;
      if (mode === "up") {
        res = await sb.auth.signUp({ email, password, options: { data: { full_name: $("#a_name").value.trim() } } });
        if (!res.error && !res.data.session) {
          renderAuth("in", "Account created. Check your email for a confirmation link, then sign in here.");
          return;
        }
      } else {
        res = await sb.auth.signInWithPassword({ email, password });
      }
      btn.disabled = false;
      if (res.error) $("#authErr").textContent = friendly(res.error);
    };
  }

  function renderPending() {
    root.innerHTML = `<div class="auth"><div class="card">
      <div class="brand"><i style="color:#fff">✓</i>${esc(APP)}</div>
      <h2 style="margin:0 0 6px">Waiting for approval</h2>
      <p>Hi ${esc(S.me.full_name)}, your account is ready. A Manager needs to give you a role before you can see the team's work.</p>
      <p class="hint">Ask your Manager to open <b>Team &amp; Settings</b> and set your role.</p>
      <div class="modal-foot"><button class="btn" id="pOut">Sign out</button><button class="btn primary" id="pRe">Check again</button></div>
    </div></div>`;
    $("#pOut").onclick = () => sb.auth.signOut();
    $("#pRe").onclick = () => boot();
  }

  // ---------- 6. Start-up ----------
  let booting = false;
  async function boot() {
    if (booting) return;
    booting = true;
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { S.me = null; renderAuth(); return; }
      const { data: me, error } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
      if (error || !me) {
        root.innerHTML = `<div class="setup card"><h1>Profile not found</h1>
          <p>You're signed in, but your profile is missing. This usually means <code>database-setup.sql</code> hasn't been run yet. Run it in Supabase's SQL Editor, then refresh.</p>
          <p class="form-error">${esc(error ? friendly(error) : "")}</p>
          <button class="btn" id="xOut">Sign out</button></div>`;
        $("#xOut").onclick = () => sb.auth.signOut();
        return;
      }
      S.me = me;
      if (me.role === "pending") { renderPending(); return; }
      await loadAll();
      subscribe();
      renderShell();
    } finally {
      booting = false;
    }
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
      S.me = null;
      setTimeout(boot, 0);
    } else if (event === "SIGNED_IN" && (!S.me || S.me.id !== session?.user?.id)) {
      setTimeout(boot, 0);
    }
  });

  // ---------- 7. Page frame ----------
  function myDelayed() { return S.tasks.filter((t) => isDelayed(t) && (isStaff() || t.assigned_to === S.me.id)); }
  function navBadges() {
    return {
      blockers: [openIssues().length, "red"],
      maq: [maqAlerts().length, "red"],
      mytasks: [S.tasks.filter((t) => t.assigned_to === S.me.id && isOpen(t)).length, S.tasks.some((t) => t.assigned_to === S.me.id && isDelayed(t)) ? "red" : ""],
      team: [S.profiles.filter((p) => p.role === "pending").length, "red"],
    };
  }

  function renderShell() {
    root.innerHTML = `<div class="shell">
      <aside class="side">
        <div class="brand"><i>✓</i>${esc(APP)}</div>
        <nav class="nav" id="nav"></nav>
        <div class="me">${avatar(S.me.id, S.me.full_name)}<div><b>${esc(S.me.full_name)}</b><small>${esc(S.me.role)}</small></div><button id="signout" type="button">Sign out</button></div>
      </aside>
      <main class="main" id="main"></main>
    </div>`;
    $("#signout").onclick = () => sb.auth.signOut();
    route();
  }

  function drawNav() {
    const b = navBadges();
    $("#nav").innerHTML = PAGES.filter(([id]) => id !== "team" || isManager())
      .map(([id, label, ic]) => {
        const [n, cls] = b[id] || [0, ""];
        const badge = n ? `<span class="badge ${cls}">${n}</span>` : "";
        const on = S.page === id || (S.page === "show" && id === "shows");
        return `${id === "log" ? "<hr>" : ""}<a href="#${id}" class="${on ? "on" : ""}"><span class="ic">${ic}</span>${label}${badge}</a>`;
      }).join("");
    const bell = $("#bell");
    if (bell) bell.outerHTML = bellBtn();
  }

  function alertItems() {
    const items = [];
    for (const { s, m } of maqAlerts()) items.push({ kind: "MAQ " + m.status, cls: m.status === "OVERDUE" ? "bad" : "warn", text: `${s.name}: queued till EP ${s.maq_till_ep ?? "?"} (${fmtDate(s.maq_till_date)})`, href: "#maq" });
    for (const t of myDelayed().sort(prioritySort)) { const d = delay(t); items.push({ kind: "Delayed", cls: "bad", text: `${t.title} · ${showName(t.show_id)} · ${assigneeName(t)} · ${d.days}d late`, href: `#show/${t.show_id}` }); }
    for (const i of openIssues().filter((i) => i.severity === "Critical")) items.push({ kind: "Critical blocker", cls: "bad", text: `${showName(i.show_id)}: ${i.description}`, href: "#blockers" });
    return items;
  }
  const bellBtn = () => { const n = alertItems().length; return `<button type="button" id="bell" class="bell ${n ? "hot" : ""}" title="Alerts">🔔${n ? `<span>${n}</span>` : ""}</button>`; };

  function header(title, sub, right = "") {
    return `<div class="top"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}</div><div class="right">${right}${bellBtn()}${liveBadge()}</div></div>`;
  }

  const PAGE_FN = {};
  function route() {
    if (!S.me || !$("#main")) return;
    const raw = (location.hash || "#dashboard").slice(1);
    let [id, param] = raw.split("/");
    if (id === "workload") id = "tracker";                                   // merged into Task Tracker
    if (id === "status") { id = "shows"; S.f.shows.sort = "activity"; }      // merged into Shows Master
    if (![...PAGES.map((p) => p[0]), ...HIDDEN_PAGES].includes(id) || (id === "team" && !isManager())) id = "dashboard";
    if (!S.v2 && ["production", "maq", "show"].includes(id)) id = "dashboard";
    S.page = id;
    S.param = param ? decodeURIComponent(param) : null;
    S.redraw = null;
    S.selected.clear();
    drawNav();
    PAGE_FN[id]($("#main"));
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  function refresh() {
    if (!S.me || !$("#main")) return;
    drawNav();
    if (S.redraw) S.redraw();
    const bell = $("#bell"); if (bell) bell.outerHTML = bellBtn();
  }

  function go(page, filters) {
    if (filters && S.f[page]) Object.assign(S.f[page], filters);
    if (location.hash === "#" + page) route(); else location.hash = page;
  }

  function v2Banner() {
    return S.v2 ? "" : `<div class="banner closed">The database hasn't been updated for v2 yet. Run <b>update-v2.sql</b> in Supabase → SQL Editor, then refresh.</div>`;
  }

  // ---------- 8. Shared pieces ----------
  function showInfo(s) {
    const tasks = S.tasksByShow.get(s.id) || [];
    const latest = tasks.slice().sort(newestFirst)[0];
    const blockers = (S.issuesByShow.get(s.id) || []).filter((i) => i.status !== "Resolved");
    return {
      show: s, latest, blockers,
      openTasks: tasks.filter(isOpen).length,
      delayed: tasks.filter(isDelayed).length,
      status: blockers.length ? "Blocked" : latest ? latest.status : "No Active Task",
      updated: latest ? latest.updated_at : s.updated_at,
      prog: progressOf(s), maq: maqInfo(s),
    };
  }
  const opsOf = (s) => (s.ops_owner ? nameOf(s.ops_owner) : s.ops_name || "—");

  function canEditTask(t) { return isStaff() || t.assigned_to === S.me.id; }

  function taskActions(t) {
    const a = [];
    if (isStaff()) a.push(`<button class="btn sm" data-act="edit-task" data-id="${t.id}">Edit</button>`);
    if (canEditTask(t)) {
      if (!isOpen(t)) a.push(`<button class="btn sm" data-act="set-status" data-status="${t.assigned_to ? "Assigned" : "Unassigned"}" data-id="${t.id}">Reopen</button>`);
      else {
        if (t.assigned_to === S.me.id && t.status === "Assigned") a.push(`<button class="btn sm" data-act="set-status" data-status="In Progress" data-id="${t.id}">Start</button>`);
        if (t.assigned_to || t.poc_name) a.push(`<button class="btn sm" data-act="set-status" data-status="Completed" data-id="${t.id}">Complete</button>`);
      }
    }
    return `<div class="row-actions">${a.join("") || '<span class="dim">—</span>'}</div>`;
  }

  function taskTable(tasks, opt = {}) {
    if (!tasks.length) return `<div class="empty">${opt.empty || "No tasks here."}</div>`;
    const selectable = opt.selectable && isStaff();
    const people = members();
    const shown = opt.limit ? tasks.slice(0, opt.limit) : tasks;
    const rows = shown.map((t) => {
      const meta = [t.ext_task_id ? `#${esc(t.ext_task_id)}` : "", t.ep_range ? `EP ${esc(t.ep_range)}` : "", t.waiting_on ? `<b class="wait">waiting on ${esc(t.waiting_on)}</b>` : ""].filter(Boolean).join(" · ");
      return `<tr class="${isDelayed(t) ? "row-late" : ""}">
      ${selectable ? `<td><input class="check" type="checkbox" data-sel="${t.id}" ${S.selected.has(t.id) ? "checked" : ""} aria-label="Select task"></td>` : ""}
      ${opt.hideShow ? "" : `<td>${showLink(t.show_id)}</td>`}
      <td><b>${esc(t.title)}</b>${meta ? `<small>${meta}</small>` : ""}${t.details && !opt.compact ? `<small>${esc(t.details.slice(0, 90))}${t.details.length > 90 ? "…" : ""}</small>` : ""}</td>
      <td>${pill(t.task_type || "Other", "type")}</td>
      ${opt.compact ? "" : `<td>${hmlPill(t.hml)}</td><td>${pPill(t.p_level)}</td><td>${highCell(t)}</td>`}
      ${opt.hidePerson ? "" : `<td>${opt.inlineAssign && isStaff()
        ? `<select data-act="assign-row" data-id="${t.id}" aria-label="Assign to"><option value="">${t.poc_name ? esc(t.poc_name) + "* (no account)" : "Unassigned"}</option>${people.map((p) => `<option value="${p.id}" ${p.id === t.assigned_to ? "selected" : ""}>${esc(p.full_name)}</option>`).join("")}</select>`
        : esc(assigneeName(t))}</td>`}
      <td>${statusPill(t.status)}</td>
      <td class="num">${deadlineCell(t)}</td>
      <td>${taskActions(t)}</td>
    </tr>`;
    }).join("");
    return `<div class="table-wrap"><table><thead><tr>
      ${selectable ? `<th><input class="check" type="checkbox" data-selall aria-label="Select all"></th>` : ""}
      ${opt.hideShow ? "" : "<th>Show</th>"}<th>Task</th><th>Type</th>${opt.compact ? "" : "<th>H/M/L</th><th>P</th><th>High</th>"}
      ${opt.hidePerson ? "" : "<th>Assigned to</th>"}<th>Status</th><th>Deadline</th><th>Action</th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    ${opt.limit && tasks.length > opt.limit ? `<p class="hint">Showing ${opt.limit} of ${tasks.length}. Use the filters to narrow down.</p>` : ""}
    ${tasks.some((t) => !t.assigned_to && t.poc_name) ? `<p class="hint">* Name from the imported sheet. That person hasn't joined ShowOps yet (Manager: Team &amp; Settings → Match imported names).</p>` : ""}`;
  }

  function bulkBar() {
    if (!isStaff()) return "";
    return `<div class="bar" id="bulk"><span class="dim" id="selCount">0 selected</span>
      <select id="bulkTo" aria-label="Reassign to"><option value="">Choose person…</option><option value="__none">Unassigned</option>${members().map((p) => `<option value="${p.id}">${esc(p.full_name)}</option>`).join("")}</select>
      <button class="btn" id="bulkGo" type="button">Reassign selected</button>
      <select id="bulkSt" aria-label="Set status"><option value="">Set status…</option>${STATUSES.map((s) => `<option>${s}</option>`).join("")}</select>
      <button class="btn" id="bulkStGo" type="button">Apply status</button></div>`;
  }
  function wireBulk(main) {
    const upd = () => { const c = $("#selCount", main); if (c) c.textContent = `${S.selected.size} selected`; };
    upd();
    const goBtn = $("#bulkGo", main);
    if (goBtn) goBtn.onclick = async () => {
      const to = $("#bulkTo", main).value;
      if (!S.selected.size) return toast("Tick at least one task first.");
      if (!to) return toast("Choose who to reassign to.");
      const ids = [...S.selected];
      const ok = await save(sb.from("tasks").update({ assigned_to: to === "__none" ? null : to }).in("id", ids), `${ids.length} task(s) reassigned`);
      if (ok) { S.selected.clear(); refresh(); }
    };
    const stBtn = $("#bulkStGo", main);
    if (stBtn) stBtn.onclick = async () => {
      const st = $("#bulkSt", main).value;
      if (!S.selected.size) return toast("Tick at least one task first.");
      if (!st) return toast("Choose a status.");
      const ids = [...S.selected];
      const ok = await save(sb.from("tasks").update({ status: st }).in("id", ids), `${ids.length} task(s) set to ${st}`);
      if (ok) { S.selected.clear(); refresh(); }
    };
    return upd;
  }

  document.addEventListener("click", async (e) => {
    if (e.target.closest("#bell")) return alertsModal();
    const el = e.target.closest("[data-act]");
    if (!el || el.tagName === "SELECT" || el.tagName === "INPUT") return;
    const id = Number(el.dataset.id);
    switch (el.dataset.act) {
      case "edit-task": return taskModal(S.tasks.find((t) => t.id === id));
      case "set-status": {
        el.disabled = true;
        await save(sb.from("tasks").update({ status: el.dataset.status }).eq("id", id), `Marked ${el.dataset.status}`);
        return;
      }
      case "timeline": return timelineModal(id);
      case "edit-show": return showModal(showById(id));
      case "add-show": return showModal(null);
      case "add-issue": return issueModal(null, el.dataset.show ? Number(el.dataset.show) : null);
      case "edit-issue": return issueModal(S.issues.find((i) => i.id === id));
      case "edit-maq": return maqModal(showById(id));
      case "batch": return batchModal(Number(el.dataset.show), Number(el.dataset.from), Number(el.dataset.to));
      case "goto": return go(el.dataset.page, JSON.parse(el.dataset.f || "null"));
    }
  });
  document.addEventListener("change", async (e) => {
    const el = e.target;
    if (el.dataset.sel !== undefined && el.dataset.sel !== "") {
      const id = Number(el.dataset.sel);
      el.checked ? S.selected.add(id) : S.selected.delete(id);
      const c = $("#selCount"); if (c) c.textContent = `${S.selected.size} selected`;
    } else if (el.hasAttribute("data-selall")) {
      $$("[data-sel]").forEach((cb) => { cb.checked = el.checked; const id = Number(cb.dataset.sel); el.checked ? S.selected.add(id) : S.selected.delete(id); });
      const c = $("#selCount"); if (c) c.textContent = `${S.selected.size} selected`;
    } else if (el.dataset.act === "assign-row") {
      await save(sb.from("tasks").update({ assigned_to: el.value || null }).eq("id", Number(el.dataset.id)), "Task reassigned");
    } else if (el.dataset.act === "issue-status") {
      await save(sb.from("issues").update({ status: el.value }).eq("id", Number(el.dataset.id)), `Blocker marked ${el.value}`);
    } else if (el.dataset.act === "batch-field") {
      const patch = { [el.dataset.field]: el.value };
      await save(sb.from("show_batches").update(patch).eq("id", Number(el.dataset.id)), "Batch updated");
    }
  });

  // ---------- 9. Pages ----------

  // 9.1 Dashboard
  PAGE_FN.dashboard = (main) => {
    S.redraw = () => {
      const open = S.tasks.filter(isOpen);
      const done = S.tasks.filter((t) => t.status === "Completed").length;
      const oi = openIssues();
      const unassigned = open.filter((t) => !t.assigned_to && !t.poc_name);
      const delayed = open.filter(isDelayed);
      const maqA = maqAlerts();
      const maqAll = S.shows.map((s) => ({ s, m: maqInfo(s) })).filter((x) => x.m.status && !["DONE"].includes(x.m.status));
      const coming = maqAll.filter((x) => x.m.status === "COMING UP");
      const kpis = [
        ["Open Tasks", open.length, "", "tracker", { status: "open", person: "", p: "", special: "", q: "", type: "" }],
        ["Delayed", delayed.length, "red", "tracker", { status: "open", special: "delayed", person: "", p: "", q: "", type: "" }],
        ["MAQ Alerts", maqA.length, "amber", "maq", { status: "alerts", q: "" }],
        ["Open Blockers", oi.length, "red", "blockers", { status: "active", severity: "" }],
        ["Unassigned", unassigned.length, "violet", "tracker", { status: "open", person: "none", p: "", special: "", q: "", type: "" }],
        ["Completed", done, "green", "tracker", { status: "Completed", person: "", p: "", special: "", q: "", type: "" }],
      ];
      const pendW = S.batches.reduce((n, b) => n + (b.loc_status === "Pending (Writer)") + (b.adapted_status === "Pending (Writer)"), 0);
      const pendO = S.batches.reduce((n, b) => n + (b.loc_status === "Pending (Ops)") + (b.adapted_status === "Pending (Ops)"), 0);
      const attn = [
        ["⏱", "#fde6e9", "MAQ overdue / queue today", "Episodes run out on the CMS", maqA.length, "maq", { status: "alerts", q: "" }],
        ["◷", "#e6edfd", "MAQ coming up", `Within ${S.settings.maq_warn_days ?? 7} days`, coming.length, "maq", { status: "COMING UP", q: "" }],
        ["⚠", "#fde6e9", "Delayed tasks", "Past deadline or turnaround", delayed.length, "tracker", { status: "open", special: "delayed", person: "", p: "", q: "", type: "" }],
        ["✎", "#fff1d6", "Batches pending from Writer", "LOC sheets / adapted scripts", pendW, "production", { only: "writer", q: "" }],
        ["⚙", "#eceafd", "Batches pending from Ops", "LOC sheets / adapted scripts", pendO, "production", { only: "ops", q: "" }],
        ["!", "#fde6e9", "Open blockers", "Need resolving", oi.length, "blockers", { status: "active", severity: "" }],
      ];
      const maqRows = maqAll.filter((x) => x.s.maq_till_date).sort((a, b) => a.s.maq_till_date.localeCompare(b.s.maq_till_date)).slice(0, 7);
      const mine = S.tasks.filter((t) => t.assigned_to === S.me.id && isOpen(t)).sort(prioritySort).slice(0, 6);
      const recent = S.log.slice(0, 8);

      main.innerHTML = header("Dashboard", `Welcome back, ${esc(S.me.full_name.split(" ")[0])} 👋`) + v2Banner() + `
        <div class="kpis">${kpis.map(([l, n, c, p, f]) => `<button type="button" class="kpi ${c}" data-act="goto" data-page="${p}" data-f='${esc(JSON.stringify(f))}'><span>${l}</span><b>${n}</b></button>`).join("")}</div>
        <div class="grid2">
          <div class="card"><h2>MAQ runway (next to run out)<a class="more" href="#maq">MAQ Alerts →</a></h2>
            ${maqRows.length ? `<div class="table-wrap"><table><thead><tr><th>Show</th><th>MAQ till EP</th><th>Till date</th><th>Days left</th><th>Status</th><th>Pattern</th></tr></thead><tbody>
            ${maqRows.map(({ s, m }) => `<tr><td>${showLink(s.id, s.name)}</td><td class="num">${s.maq_till_ep ?? "—"}</td><td class="num">${fmtDate(s.maq_till_date)}</td><td class="num ${m.daysLeft < 0 ? "late" : ""}">${m.daysLeft ?? "—"}</td><td>${maqPill(m.status)}</td><td>${esc(s.maq_pattern || "—")}</td></tr>`).join("")}
            </tbody></table></div>` : `<div class="empty">No MAQ dates yet. Add them on a show page or the MAQ Alerts page.</div>`}
          </div>
          <div class="card"><h2>Needs attention</h2><div class="attn">
            ${attn.map(([ic, bg, t, s, n, p, f]) => `<button type="button" data-act="goto" data-page="${p}" data-f='${esc(JSON.stringify(f))}'><span class="dot" style="background:${bg}">${ic}</span><span><b>${t}</b><small>${s}</small></span><span class="n ${n ? "hot" : ""}">${n}</span></button>`).join("")}
          </div></div>
        </div>
        <div class="grid2b">
          <div class="card"><h2>My priority queue<a class="more" href="#mytasks">View my tasks →</a></h2>
            ${mine.length ? `<div class="table-wrap"><table><thead><tr><th>Task</th><th>Show</th><th>Type</th><th>Due</th><th>Status</th></tr></thead><tbody>
            ${mine.map((t) => `<tr class="${isDelayed(t) ? "row-late" : ""}"><td><b>${esc(t.title)}</b></td><td>${showLink(t.show_id)}</td><td>${pill(t.task_type, "type")}</td><td>${deadlineCell(t)}</td><td>${statusPill(t.status)}</td></tr>`).join("")}
            </tbody></table></div>` : `<div class="empty">Nothing assigned to you right now.</div>`}
          </div>
          <div class="card"><h2>Recent activity<a class="more" href="#log">View all →</a></h2>
            ${recent.length ? `<div class="feed">${recent.map((l) => `<div>${avatar(l.user_id, l.user_id ? nameOf(l.user_id) : "S")}<span><b>${esc(l.user_id ? nameOf(l.user_id) : "System")}</b> · ${esc(l.action)}${l.show_id ? ` · ${showLink(l.show_id)}` : ""}<small>${esc(l.details || "")} · ${ago(l.created_at)}</small></span></div>`).join("")}</div>` : `<div class="empty">No activity yet.</div>`}
          </div>
        </div>`;
    };
    S.redraw();
  };

  // 9.2 Shows Master
  PAGE_FN.shows = (main) => {
    const f = S.f.shows;
    const opsNames = [...new Set(S.shows.map(opsOf).filter((n) => n && n !== "—"))].sort();
    main.innerHTML = header("Shows Master", "Every show with its stage, source, batch progress, owner, latest task and MAQ status. Click a show for everything about it, or Timeline for its history.",
      isStaff() ? `<button class="btn primary" data-act="add-show" type="button">＋ Add show</button>` : "") + v2Banner() + `
      <div class="card">
        <div class="bar">
          <div class="grow"><input type="search" id="sq" placeholder="Search show, DE title or ID…" value="${esc(f.q)}" aria-label="Search shows"></div>
          <select id="sstage" aria-label="Stage"><option value="">All stages</option><option value="__active" ${f.stage === "__active" ? "selected" : ""}>In production (Steps 1–7)</option>${PROD_STAGES.map((t) => `<option ${f.stage === t ? "selected" : ""}>${t}</option>`).join("")}</select>
          <select id="sops" aria-label="Ops"><option value="">All Ops</option>${opsNames.map((t) => `<option ${f.ops === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
          <select id="ssrc" aria-label="Source state"><option value="">Any source state</option>${SOURCE_STATES.map((t) => `<option ${f.source === t ? "selected" : ""}>${t}</option>`).join("")}</select>
          <select id="smaq" aria-label="MAQ"><option value="">Any MAQ status</option>${["OVERDUE", "QUEUE TODAY", "COMING UP", "OK", "FIX DATE", "DONE"].map((t) => `<option ${f.maq === t ? "selected" : ""}>${t}</option>`).join("")}</select>
          <select id="ssort" aria-label="Sort">${[["name", "Sort: Name A–Z"], ["activity", "Sort: Latest activity"], ["maq", "Sort: MAQ runs out first"], ["progress", "Sort: Least progress first"], ["delayed", "Sort: Most delayed tasks"]].map(([v, l]) => `<option value="${v}" ${f.sort === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        </div>
        <div id="results"></div>
      </div>`;
    const bind = (id, key) => { const el = $(id); const h = (e) => { f[key] = e.target.value; S.redraw(); }; if (el.tagName === "SELECT") el.onchange = h; else el.oninput = h; };
    bind("#sq", "q"); bind("#sstage", "stage"); bind("#sops", "ops"); bind("#ssrc", "source"); bind("#smaq", "maq"); bind("#ssort", "sort");
    S.redraw = () => {
      const q = f.q.toLowerCase();
      const list = S.shows.map(showInfo).filter((i) => {
        const s = i.show;
        if (q && ![s.name, s.de_title, s.us_show_id, s.de_show_id].some((v) => (v || "").toLowerCase().includes(q))) return false;
        if (f.stage === "__active" ? !/^Step/.test(s.prod_status || "") : f.stage && s.prod_status !== f.stage) return false;
        if (f.ops && opsOf(s) !== f.ops) return false;
        if (f.source && s.source_state !== f.source) return false;
        if (f.maq && i.maq.status !== f.maq) return false;
        return true;
      });
      const byName = (a, b) => a.show.name.localeCompare(b.show.name);
      const SORTS = {
        name: byName,
        activity: (a, b) => new Date(b.updated || 0) - new Date(a.updated || 0) || byName(a, b),
        maq: (a, b) => (a.show.maq_till_date && !["DONE"].includes(a.maq.status) ? a.show.maq_till_date : "9999").localeCompare(b.show.maq_till_date && !["DONE"].includes(b.maq.status) ? b.show.maq_till_date : "9999") || byName(a, b),
        progress: (a, b) => (a.prog.pct ?? 2) - (b.prog.pct ?? 2) || byName(a, b),
        delayed: (a, b) => b.delayed - a.delayed || b.openTasks - a.openTasks || byName(a, b),
      };
      list.sort(SORTS[f.sort] || byName);
      $("#results").innerHTML = list.length ? `<p class="dim" style="margin:0 0 6px">${list.length} show(s)</p><div class="table-wrap"><table><thead><tr><th>Show</th><th>Stage</th><th>Source</th><th>Batch progress</th><th>Ops</th><th>Open tasks</th><th>Latest task</th><th>Blocker</th><th>MAQ</th><th></th></tr></thead><tbody>
        ${list.map((i) => { const s = i.show; return `<tr>
          <td>${showLink(s.id, s.name)}${s.de_title ? `<small>${esc(s.de_title)}</small>` : ""}<small>${[s.type, s.show_type, s.genre].filter(Boolean).map(esc).join(" · ")}${s.approved ? "" : " · " + pill("Not approved", "warn")}</small></td>
          <td>${stagePill(s.prod_status)}</td>
          <td>${s.source_state ? esc(s.source_state) : '<span class="dim">—</span>'}<small>${s.source_eps_note || s.source_eps ? esc(s.source_eps_note || s.source_eps) + " eps" : ""}</small></td>
          <td style="min-width:120px">${progressBar(i.prog)}${i.prog.writer || i.prog.ops ? `<small class="wait">${i.prog.writer ? i.prog.writer + " pending writer " : ""}${i.prog.ops ? i.prog.ops + " pending ops" : ""}</small>` : ""}</td>
          <td>${esc(opsOf(s))}</td>
          <td class="num">${i.openTasks}${i.delayed ? ` <small class="late">${i.delayed} late</small>` : ""}</td>
          <td>${i.latest ? `${esc(i.latest.title)}<small>${statusPill(i.latest.status)} · ${ago(i.updated)}</small>` : '<span class="dim">No request yet</span>'}</td>
          <td>${i.blockers.length ? `<span class="late">${esc(i.blockers[0].description)}</span>` : `<span class="dim">—</span>`}</td>
          <td>${i.maq.tracked ? maqPill(i.maq.status) : '<span class="dim">—</span>'}${i.maq.daysLeft != null ? `<small>${i.maq.daysLeft} d left</small>` : ""}</td>
          <td><div class="row-actions"><a class="btn sm" href="#show/${s.id}">Open</a><button class="btn sm" data-act="timeline" data-id="${s.id}" type="button">Timeline</button></div></td>
        </tr>`; }).join("")}</tbody></table></div>` : `<div class="empty">No shows match.${isStaff() ? " Use “Add show” to create one." : ""}</div>`;
    };
    S.redraw();
  };

  // 9.3 Show page (everything about one show)
  PAGE_FN.show = (main) => {
    const id = Number(S.param);
    S.redraw = () => {
      const s = showById(id);
      if (!s) { main.innerHTML = header("Show not found") + `<div class="card"><p>This show doesn't exist any more.</p><a class="btn" href="#shows">Back to Shows Master</a></div>`; return; }
      const i = showInfo(s);
      const tasks = (S.tasksByShow.get(s.id) || []).slice().sort(prioritySort);
      const blockers = (S.issuesByShow.get(s.id) || []).slice().sort((a, b) => (a.status === "Resolved") - (b.status === "Resolved"));
      const bs = batchesFor(s.id);
      const staff = isStaff();
      const field = (label, v, raw) => `<div class="kv"><span>${label}</span><b>${raw ? v : v ? linkify(v) : '<span class="dim">—</span>'}</b></div>`;
      const extra = Object.entries(s.extra || {});
      main.innerHTML = header(esc(s.name), [s.de_title ? `DE: ${esc(s.de_title)}` : "", s.type, s.show_type, s.genre, s.sub_genre].filter(Boolean).map(esc).join(" · "),
        `<a class="btn" href="#shows">← All shows</a>${staff ? `<button class="btn" data-act="edit-show" data-id="${s.id}" type="button">Edit details</button>` : ""}<button class="btn" data-act="timeline" data-id="${s.id}" type="button">Timeline</button>`) + `
        <div class="kpis">
          <div class="kpi"><span>Stage</span><div style="margin-top:6px">${stagePill(s.prod_status)}</div></div>
          <div class="kpi"><span>Source</span><b>${esc(s.source_eps_note || s.source_eps || "—")}</b><small>${esc(s.source_state || "")}</small></div>
          <div class="kpi"><span>Adapted batches</span><b>${i.prog.total ? `${i.prog.adp}/${i.prog.total}` : "—"}</b><small>LOC ${i.prog.loc}/${i.prog.total || 0}</small></div>
          <div class="kpi ${i.maq.status === "OVERDUE" ? "red" : i.maq.status === "QUEUE TODAY" ? "amber" : ""}"><span>MAQ</span><div style="margin-top:6px">${i.maq.tracked ? maqPill(i.maq.status) : '<span class="dim">Not tracked</span>'}</div><small>${s.maq_till_ep ? `till EP ${s.maq_till_ep}` : ""}${s.maq_till_date ? ` · ${fmtDate(s.maq_till_date)}` : ""}</small></div>
          <div class="kpi ${i.delayed ? "red" : ""}"><span>Open tasks</span><b>${i.openTasks}</b><small>${i.delayed ? `${i.delayed} delayed` : ""}</small></div>
          <div class="kpi ${i.blockers.length ? "red" : ""}"><span>Open blockers</span><b>${i.blockers.length}</b></div>
        </div>
        <div class="grid2">
          <div class="card"><h2>LOC sheets &amp; adapted scripts (per batch)${staff ? `<span class="more"><button class="btn sm" id="genB" type="button">Create 100-episode batches</button> <button class="btn sm" id="addB" type="button">＋ Custom batch</button></span>` : ""}</h2>
            ${bs.length ? `<div class="table-wrap"><table><thead><tr><th>Episodes</th><th>LOC sheet</th><th>Adapted script</th><th>Notes</th><th>Updated</th>${staff ? "<th></th>" : ""}</tr></thead><tbody>
            ${bs.map((b) => `<tr>
              <td class="num"><b>${b.ep_from}–${b.ep_to}</b></td>
              <td>${staff ? batchSelect(b, "loc_status") : batchPill(b.loc_status)}</td>
              <td>${staff ? batchSelect(b, "adapted_status") : batchPill(b.adapted_status)}</td>
              <td>${staff ? `<input type="text" class="inline" data-note="${b.id}" value="${esc(b.notes || "")}" placeholder="—" aria-label="Notes">` : esc(b.notes || "—")}</td>
              <td><small>${fmtDT(b.updated_at)}${b.updated_by ? `<br>${esc(nameOf(b.updated_by))}` : ""}</small></td>
              ${staff ? `<td><button class="btn sm ghost-danger" data-delb="${b.id}" type="button" title="Remove batch">✕</button></td>` : ""}
            </tr>`).join("")}</tbody></table></div>` : `<div class="empty">No batches yet.${staff ? " Click “Create 100-episode batches” to set them up from the source episode count." : ""}</div>`}
          </div>
          <div class="card"><h2>MAQ scheduling${staff ? `<span class="more"><button class="btn sm" data-act="edit-maq" data-id="${s.id}" type="button">Update MAQ</button></span>` : ""}</h2>
            ${field("MAQ done till EP", s.maq_till_ep)}${field("MAQ done till date", s.maq_till_date ? fmtDate(s.maq_till_date) : "")}
            ${field("Alert on", i.maq.alertOn ? fmtDate(i.maq.alertOn) : "")}${field("Days left", i.maq.daysLeft != null ? String(i.maq.daysLeft) : "")}
            ${field("Pattern", s.maq_pattern)}${field("DE CMS state", s.maq_state)}${field("NRC", [s.nrc_status, s.nrc_cadence].filter(Boolean).join(" · "))}
            ${field("Comments", s.maq_comments)}${field("DE CMS", s.de_cms_link)}${field("Source CMS", s.source_cms_link)}
            ${s.maq_updated_at ? `<p class="hint">MAQ last updated ${fmtDT(s.maq_updated_at)}</p>` : ""}
          </div>
        </div>
        <div class="grid2b" style="margin-bottom:16px">
          <div class="card"><h2>Show details</h2>
            <div class="kvgrid">
              ${field("Priority", s.priority)}${field("Month", s.month)}${field("Producer", s.producer)}${field("Ops", opsOf(s))}
              ${field("LOC writer", s.loc_writer)}${field("Rectifier", s.rectifier)}${field("Proofreader 1", s.proofreader1)}${field("Proofreader 2", s.proofreader2)}
              ${field("Sound engineer", s.sound_engineer)}${field("Voice", s.voice)}${field("Adaptation type", s.adaptation_type)}${field("Added by", s.added_by)}
              ${field("Production start", s.prod_start ? fmtDate(s.prod_start) : "")}${field("Launch date", s.launch_date ? fmtDate(s.launch_date) : "")}
              ${field("DE show status", s.de_status)}${field("Published", s.published_status)}${field("Source link", s.source_link)}
              ${field("Show ID (US/UK)", s.us_show_id ? `<code>${esc(s.us_show_id)}</code>` : "", true)}${field("Show ID (DE)", s.de_show_id ? `<code>${esc(s.de_show_id)}</code>` : "", true)}
            </div>
            ${s.comments ? `<p><b>Comments:</b> ${esc(s.comments)}</p>` : ""}
          </div>
          <div class="card"><h2>Show-specific fields <small class="dim">(splits, merges, hiatus, assets, slates…)</small></h2>
            ${extra.length ? `<div class="kvgrid one">${extra.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${linkify(v)}</b>${staff ? `<button class="x" data-xk="${esc(k)}" title="Edit or remove" type="button">✎</button>` : ""}</div>`).join("")}</div>` : `<div class="empty">No extra fields yet.</div>`}
            ${staff ? `<form id="xf" class="bar" style="margin-top:10px"><input type="text" id="xk" placeholder="Field name, e.g. Splits done" required style="flex:1 1 160px"><input type="text" id="xv" placeholder="Value" style="flex:2 1 200px"><button class="btn" type="submit">Save field</button></form>` : ""}
          </div>
        </div>
        <div class="card" style="margin-bottom:16px"><h2>Tasks<span class="more"><a class="btn sm" href="#raise" id="raiseHere">＋ Raise request for this show</a></span></h2>
          ${taskTable(tasks, { hideShow: true, limit: 60, empty: "No tasks for this show yet." })}</div>
        <div class="card"><h2>Blockers<span class="more"><button class="btn sm danger" data-act="add-issue" data-show="${s.id}" type="button">＋ Raise issue</button></span></h2>
          ${blockers.length ? `<div class="table-wrap"><table><thead><tr><th>Issue</th><th>Task</th><th>Severity</th><th>Status</th><th>Owner</th><th>Raised</th></tr></thead><tbody>
          ${blockers.map((b) => `<tr><td><b>${esc(b.description)}</b></td><td>${esc(S.tasks.find((t) => t.id === b.task_id)?.title || "—")}</td><td>${sevPill(b.severity)}</td><td>${statusPill(b.status)}</td><td>${esc(nameOf(b.owner))}</td><td><small>${fmtDT(b.created_at)}</small></td></tr>`).join("")}
          </tbody></table></div>` : `<div class="empty">No blockers. 🎉</div>`}</div>`;

      const rh = $("#raiseHere"); if (rh) rh.onclick = () => { S.presetShow = s.name; };
      if (!staff) return;
      $$("[data-note]", main).forEach((inp) => inp.onchange = () => save(sb.from("show_batches").update({ notes: inp.value || null }).eq("id", Number(inp.dataset.note)), "Note saved"));
      $$("[data-delb]", main).forEach((b) => b.onclick = async () => {
        if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Sure?"; return; }
        await save(sb.from("show_batches").delete().eq("id", Number(b.dataset.delb)), "Batch removed");
      });
      $("#genB").onclick = async () => {
        let upto = s.source_eps;
        if (!upto) { toast("Add the source episode count first (Edit details), or use “Custom batch”.", "bad"); return; }
        const have = new Set(bs.map((b) => b.ep_from));
        const rows = [];
        for (let f0 = 1; f0 <= upto; f0 += 100) if (!have.has(f0)) rows.push({ show_id: s.id, ep_from: f0, ep_to: Math.min(f0 + 99, upto) });
        if (!rows.length) { toast("All 100-episode batches already exist."); return; }
        await save(sb.from("show_batches").insert(rows), `${rows.length} batch(es) created`);
      };
      $("#addB").onclick = () => batchModal(s.id, null, null);
      $$("[data-xk]", main).forEach((b) => b.onclick = () => { $("#xk").value = b.dataset.xk; $("#xv").value = (s.extra || {})[b.dataset.xk] || ""; $("#xv").focus(); });
      $("#xf").onsubmit = async (e) => {
        e.preventDefault();
        const k = $("#xk").value.trim(), v = $("#xv").value.trim();
        if (!k) return;
        const ex = { ...(s.extra || {}) };
        if (v) ex[k] = v; else delete ex[k];
        await save(sb.from("shows").update({ extra: ex }).eq("id", s.id), v ? `Saved “${k}”` : `Removed “${k}”`);
      };
    };
    S.redraw();
  };
  const batchSelect = (b, field) => `<select class="bsel ${BCLS[b[field]] || ""}" data-act="batch-field" data-field="${field}" data-id="${b.id}" aria-label="${field}">${BATCH_STATUSES.map((x) => `<option ${x === b[field] ? "selected" : ""}>${x}</option>`).join("")}</select>`;

  // 9.4 Production Tracker (all shows × batches)
  PAGE_FN.production = (main) => {
    const f = S.f.production;
    main.innerHTML = header("Production Tracker", "LOC sheet and adapted script status for every 100-episode batch. Click a cell to update it.") + v2Banner() + `
      <div class="kpis" id="pk"></div>
      <div class="card" style="margin-bottom:16px">
        <div class="bar">
          <div class="grow"><input type="search" id="pq" placeholder="Search show…" value="${esc(f.q)}" aria-label="Search"></div>
          <select id="ponly" aria-label="Show only"><option value="">All shows with batches</option><option value="pending" ${f.only === "pending" ? "selected" : ""}>Anything pending</option><option value="writer" ${f.only === "writer" ? "selected" : ""}>Pending from Writer</option><option value="ops" ${f.only === "ops" ? "selected" : ""}>Pending from Ops</option><option value="await" ${f.only === "await" ? "selected" : ""}>Await</option><option value="incomplete" ${f.only === "incomplete" ? "selected" : ""}>Not finished</option></select>
        </div>
        <div class="legend">${BATCH_STATUSES.map((x) => `<span><i class="cell-dot ${BCLS[x]}"></i>${x}</span>`).join("")}<span class="dim">Each cell: <b>L</b> = LOC sheet, <b>A</b> = adapted script</span></div>
        <div id="results"></div>
      </div>
      <div class="card"><h2>Pending batches</h2><div id="pend"></div></div>`;
    const bind = (id, key) => { const el = $(id); const h = (e) => { f[key] = e.target.value; S.redraw(); }; if (el.tagName === "SELECT") el.onchange = h; else el.oninput = h; };
    bind("#pq", "q"); bind("#ponly", "only");
    S.redraw = () => {
      const all = S.batches;
      const c = (st) => all.reduce((n, b) => n + (b.loc_status === st) + (b.adapted_status === st), 0);
      const shows = S.shows.filter((s) => batchesFor(s.id).length);
      const finished = shows.filter((s) => { const p = progressOf(s); return p.pct === 1; }).length;
      $("#pk").innerHTML = [
        ["Shows tracked", shows.length, ""], ["LOC sheets done", all.filter((b) => b.loc_status === "Done").length, "green"],
        ["Adapted scripts done", all.filter((b) => b.adapted_status === "Done").length, "green"], ["Pending (Writer)", c("Pending (Writer)"), "amber"],
        ["Pending (Ops)", c("Pending (Ops)"), "violet"], ["Await", c("Await"), "blue"], ["Shows fully adapted", finished, ""],
      ].map(([l, n, cl]) => `<div class="kpi ${cl}" style="cursor:default"><span>${l}</span><b>${n}</b></div>`).join("");
      const q = f.q.toLowerCase();
      const has = (s, pred) => batchesFor(s.id).some((b) => pred(b.loc_status) || pred(b.adapted_status));
      const list = shows.filter((s) => {
        if (q && !(s.name.toLowerCase().includes(q) || (s.de_title || "").toLowerCase().includes(q))) return false;
        if (f.only === "pending") return has(s, (x) => ["Pending (Writer)", "Pending (Ops)", "Await", "Batch pending"].includes(x));
        if (f.only === "writer") return has(s, (x) => x === "Pending (Writer)");
        if (f.only === "ops") return has(s, (x) => x === "Pending (Ops)");
        if (f.only === "await") return has(s, (x) => x === "Await");
        if (f.only === "incomplete") return progressOf(s).pct !== 1;
        return true;
      }).sort((a, b) => a.name.localeCompare(b.name));
      const maxTo = Math.max(100, ...list.map((s) => Math.max(s.source_eps || 0, ...batchesFor(s.id).map((b) => b.ep_to))));
      const cols = []; for (let f0 = 1; f0 <= Math.min(maxTo, 3000); f0 += 100) cols.push(f0);
      $("#results").innerHTML = list.length ? `<div class="table-wrap matrix-wrap"><table class="matrix"><thead><tr><th class="stick">Show</th><th>Progress</th>${cols.map((c0) => `<th class="mcol">${c0}<br>–${c0 + 99}</th>`).join("")}</tr></thead><tbody>
        ${list.map((s) => {
          const bs = batchesFor(s.id);
          const p = progressOf(s);
          const byStart = new Map(); for (const b of bs) byStart.set(Math.floor((b.ep_from - 1) / 100) * 100 + 1, b);
          const lastCol = s.source_eps ? Math.floor((s.source_eps - 1) / 100) * 100 + 1 : Math.max(...bs.map((b) => b.ep_from));
          return `<tr><td class="stick">${showLink(s.id, s.name)}<small>${esc(s.source_eps_note || s.source_eps || "?")} eps · ${esc(opsOf(s))}</small></td>
            <td style="min-width:110px">${progressBar(p)}</td>
            ${cols.map((c0) => {
              const b = byStart.get(c0);
              if (!b) return c0 <= lastCol && isStaff() ? `<td class="mcell empty-cell" data-act="batch" data-show="${s.id}" data-from="${c0}" data-to="${c0 + 99}" title="Not set up yet: click to add"><span>＋</span></td>` : `<td class="mcell off"></td>`;
              return `<td class="mcell" ${isStaff() ? `data-act="batch" data-show="${s.id}" data-from="${b.ep_from}" data-to="${b.ep_to}"` : ""} title="${b.ep_from}–${b.ep_to} · LOC: ${esc(b.loc_status)} · Adapted: ${esc(b.adapted_status)}${b.notes ? " · " + esc(b.notes) : ""}"><i class="la ${BCLS[b.loc_status]}">L</i><i class="la ${BCLS[b.adapted_status]}">A</i></td>`;
            }).join("")}</tr>`;
        }).join("")}</tbody></table></div>` : `<div class="empty">No shows match. Batches are created on each show page, or come in with the import.</div>`;
      const pend = [];
      for (const b of all) for (const [fld, lab] of [["loc_status", "LOC sheet"], ["adapted_status", "Adapted script"]]) {
        if (["Pending (Writer)", "Pending (Ops)", "Await", "Batch pending"].includes(b[fld])) pend.push({ b, lab, st: b[fld] });
      }
      pend.sort((x, y) => x.st.localeCompare(y.st) || showName(x.b.show_id).localeCompare(showName(y.b.show_id)) || x.b.ep_from - y.b.ep_from);
      $("#pend").innerHTML = pend.length ? `<div class="table-wrap"><table><thead><tr><th>Waiting on</th><th>Show</th><th>Batch</th><th>What</th><th>Ops</th><th>Since</th><th>Notes</th></tr></thead><tbody>
        ${pend.map(({ b, lab, st }) => { const s = showById(b.show_id) || {}; return `<tr><td>${batchPill(st)}</td><td>${showLink(b.show_id)}</td><td class="num">${b.ep_from}–${b.ep_to}</td><td>${lab}</td><td>${esc(opsOf(s))}</td><td><small>${ago(b.updated_at)}</small></td><td>${esc(b.notes || "")}</td></tr>`; }).join("")}
        </tbody></table></div>` : `<div class="empty">Nothing pending. 🎉</div>`;
    };
    S.redraw();
  };

  // 9.5 MAQ Alerts
  PAGE_FN.maq = (main) => {
    const f = S.f.maq;
    main.innerHTML = header("MAQ Alerts", `When each show's queued episodes on the DE CMS run out. Alert day moves to Friday if the date falls on a weekend; “Coming up” = within ${S.settings.maq_warn_days ?? 7} days.`) + v2Banner() + `
      <div class="kpis" id="mk"></div>
      <div class="card" style="margin-bottom:16px">
        <div class="bar">
          <div class="grow"><input type="search" id="mq" placeholder="Search show…" value="${esc(f.q)}" aria-label="Search"></div>
          <select id="ms" aria-label="Status"><option value="alerts">Needs action (overdue + queue today)</option><option value="">All tracked shows</option>${["OVERDUE", "QUEUE TODAY", "COMING UP", "OK", "FIX DATE", "DONE"].map((x) => `<option ${f.status === x ? "selected" : ""}>${x}</option>`).join("")}</select>
        </div>
        <div id="results"></div>
      </div>`;
    $("#ms").value = f.status;
    $("#mq").oninput = (e) => { f.q = e.target.value; S.redraw(); };
    $("#ms").onchange = (e) => { f.status = e.target.value; S.redraw(); };
    S.redraw = () => {
      const rows = S.shows.map((s) => ({ s, m: maqInfo(s) })).filter((x) => x.m.tracked);
      const cnt = (st) => rows.filter((x) => x.m.status === st).length;
      $("#mk").innerHTML = [["Queue now", cnt("OVERDUE") + cnt("QUEUE TODAY"), "red", "alerts"], ["Overdue", cnt("OVERDUE"), "red", "OVERDUE"], ["Queue today", cnt("QUEUE TODAY"), "amber", "QUEUE TODAY"],
        [`Coming up (${S.settings.maq_warn_days ?? 7} days)`, cnt("COMING UP"), "blue", "COMING UP"], ["OK", cnt("OK"), "green", "OK"], ["Dates to fix", cnt("FIX DATE"), "violet", "FIX DATE"]]
        .map(([l, n, c, st]) => `<button type="button" class="kpi ${c}" data-mst="${st}"><span>${l}</span><b>${n}</b></button>`).join("");
      $$("[data-mst]").forEach((b) => b.onclick = () => { f.status = b.dataset.mst; $("#ms").value = f.status; S.redraw(); });
      const q = f.q.toLowerCase();
      const list = rows.filter((x) => (!q || x.s.name.toLowerCase().includes(q)) &&
        (f.status === "" || (f.status === "alerts" ? ["OVERDUE", "QUEUE TODAY"].includes(x.m.status) : x.m.status === f.status)))
        .sort((a, b) => (a.s.maq_till_date || "9999").localeCompare(b.s.maq_till_date || "9999"));
      const win = 30;
      $("#results").innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th>Show</th><th>MAQ till EP</th><th>Till date</th><th>Alert on</th><th>Days left</th><th>Status</th><th>Runway</th><th>Pattern</th><th>Comments</th><th>Ops</th><th></th></tr></thead><tbody>
        ${list.map(({ s, m }) => `<tr class="${m.status === "OVERDUE" ? "row-late" : ""}">
          <td>${showLink(s.id, s.name)}<small>${esc(s.maq_state || "")}${s.source_eps_note || s.source_eps ? ` · source ${esc(s.source_eps_note || s.source_eps)}` : ""}</small></td>
          <td class="num">${s.maq_till_ep ?? "—"}</td><td class="num">${fmtDate(s.maq_till_date)}</td><td class="num">${m.alertOn ? fmtDate(m.alertOn) : "—"}</td>
          <td class="num ${m.daysLeft < 0 ? "late" : ""}">${m.daysLeft ?? "—"}</td><td>${maqPill(m.status)}</td>
          <td style="min-width:90px">${m.daysLeft != null ? `<div class="runway ${MAQ_CLS[m.status]}"><span style="width:${Math.max(4, Math.min(100, (Math.max(m.daysLeft, 0) / win) * 100))}%"></span></div>` : ""}</td>
          <td>${esc(s.maq_pattern || "—")}</td><td><small>${esc(s.maq_comments || "")}</small></td><td>${esc(opsOf(s))}</td>
          <td><div class="row-actions">${s.de_cms_link ? `<a class="btn sm" href="${esc(s.de_cms_link)}" target="_blank" rel="noopener">Open CMS</a>` : ""}${isStaff() ? `<button class="btn sm" data-act="edit-maq" data-id="${s.id}" type="button">Update</button>` : ""}</div></td>
        </tr>`).join("")}</tbody></table></div>` : `<div class="empty">${f.status === "alerts" ? "No shows need queuing right now. 🎉" : "No shows match."}</div>`;
    };
    S.redraw();
  };

  // 9.6 Raise Request
  PAGE_FN.raise = (main) => {
    const s = S.settings;
    const writer = role() === "writer";
    const open = nowHM() >= hm(s.request_start) && nowHM() <= hm(s.request_end);
    const banner = writer
      ? open ? `<div class="banner ok">✓ <b>Requests open.</b> Window: ${hm(s.request_start)}–${hm(s.request_end)}. Current time: <b>${nowHM()}</b></div>`
             : `<div class="banner closed">✕ <b>Requests closed.</b> Writers can raise requests between ${hm(s.request_start)} and ${hm(s.request_end)}. Current time: <b>${nowHM()}</b></div>`
      : `<div class="banner note">As ${esc(role())}, you can raise requests at any time. (Writers: ${hm(s.request_start)}–${hm(s.request_end)}.)</div>`;
    const shows = S.shows.filter((x) => x.approved).sort((a, b) => (a.name === "Adhoc" ? -1 : b.name === "Adhoc" ? 1 : a.name.localeCompare(b.name)));
    const mgr = isManager();
    main.innerHTML = header("Raise Request", "Request work for an approved show, or choose “Adhoc”.") + `
      <div class="card">${banner}
        <form class="form" id="rf">
          <div><label for="r_show">Show name *</label>
            <input id="r_show" type="text" list="r_shows" placeholder="Start typing a show…" required autocomplete="off" value="${esc(S.presetShow || "")}">
            <datalist id="r_shows">${shows.map((x) => `<option value="${esc(x.name)}"></option>`).join("")}</datalist></div>
          <div><label for="r_to">Assign to ${writer ? "<small>(set by Ops)</small>" : ""}</label>
            <select id="r_to" ${writer ? "disabled" : ""}><option value="">Unassigned</option>${members().map((p) => `<option value="${p.id}">${esc(p.full_name)}</option>`).join("")}</select></div>
          <div class="full"><label for="r_title">Task / requirement *</label><textarea id="r_title" required placeholder="e.g. TMTF 801-900 AI Friendly, Lunar Curse 201-250 LS V3…" style="min-height:70px"></textarea></div>
          <div><label for="r_type">Task type</label><select id="r_type">${TASK_TYPES.map((t) => `<option>${t}</option>`).join("")}</select></div>
          <div><label for="r_rng">Episode range</label><input id="r_rng" type="text" placeholder="e.g. 801-900"></div>
          <div><label for="r_ext">Task ID <small>(from the production tool, optional)</small></label><input id="r_ext" type="text" placeholder="e.g. 66902"></div>
          <div><label for="r_dl">Deadline <small>(blank = ${tatFor("Other")}-day turnaround rule)</small></label><input id="r_dl" type="date"></div>
          <div><label for="r_hml">Priority ${mgr ? "" : "<small>(set by Manager)</small>"}</label>
            <select id="r_hml" ${mgr ? "" : "disabled"}><option>Low</option><option>Medium</option><option>High</option></select></div>
          <div><label for="r_p">P0 / P1 / P2 ${mgr ? "" : "<small>(set by Manager)</small>"}</label>
            <select id="r_p" ${mgr ? "" : "disabled"}><option>P2</option><option>P1</option><option>P0</option></select></div>
          <div><label for="r_high">High priority flag ${mgr ? "" : "<small>(set by Manager)</small>"}</label>
            <select id="r_high" ${mgr ? "" : "disabled"}><option value="false">No</option><option value="true">Yes</option></select></div>
          <div class="full"><label for="r_det">Additional details</label><textarea id="r_det" placeholder="Optional context, links or notes…"></textarea></div>
          <div class="full"><button class="btn primary" type="submit" ${writer && !open ? "disabled" : ""}>Submit request</button><div class="form-error" id="rErr"></div></div>
        </form>
      </div>`;
    S.presetShow = null;
    const title = $("#r_title");
    title.oninput = () => {                    // guess type + range from the text
      const t = title.value.toLowerCase();
      const guess = /\bl\s*\/?\s*s\b|ls ?v3|loc sheet/.test(t) ? "L/S" : /ai ?friendly|adapt/.test(t) ? "Adaptation" : /ai ?vo/.test(t) ? "AIVO" : /translat/.test(t) ? "Translation" : /summar/.test(t) ? "Summary" : null;
      if (guess && !$("#r_type").dataset.touched) $("#r_type").value = guess;
      const m = t.match(/(\d+)\s*(?:-|to|–)\s*(\d+)/);
      if (m && !$("#r_rng").dataset.touched) $("#r_rng").value = `${m[1]}-${m[2]}`;
    };
    $("#r_type").onchange = (e) => (e.target.dataset.touched = "1");
    $("#r_rng").oninput = (e) => (e.target.dataset.touched = "1");
    $("#rf").onsubmit = async (e) => {
      e.preventDefault();
      const name = $("#r_show").value.trim();
      const sh = shows.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!sh) { $("#rErr").textContent = "Pick a show from the list (it must already exist and be approved)."; return; }
      const row = { show_id: sh.id, title: title.value.trim(), details: $("#r_det").value.trim() || null, deadline: $("#r_dl").value || null };
      if (S.v2) Object.assign(row, { task_type: $("#r_type").value, ep_range: $("#r_rng").value.trim() || null, ext_task_id: $("#r_ext").value.trim() || null });
      if (!writer) row.assigned_to = $("#r_to").value || null;
      if (mgr) Object.assign(row, { hml: $("#r_hml").value, p_level: $("#r_p").value, high_flag: $("#r_high").value === "true" });
      const btn = $("#rf button[type=submit]"); btn.disabled = true;
      const { error } = await sb.from("tasks").insert(row);
      btn.disabled = false;
      if (error) { $("#rErr").textContent = friendly(error); return; }
      toast(`Request raised for ${sh.name}`, "good");
      await loadAll();
      $("#rf").reset();
      delete $("#r_type").dataset.touched; delete $("#r_rng").dataset.touched;
      $("#rErr").textContent = "";
      drawNav();
    };
  };

  // 9.7 Task Tracker (tasks + team workload in one page)
  PAGE_FN.tracker = (main) => {
    const f = S.f.tracker;
    main.innerHTML = header("Task Tracker", "Every task and who's working on it. Click a person to see their queue; rows in red are delayed.") + `
      <div class="kpis" id="tk"></div>
      <div class="people" id="ppl"></div>
      <div class="card">
        <div class="bar">
          <div class="grow"><input type="search" id="tq" placeholder="Search task, show or Task ID…" value="${esc(f.q)}" aria-label="Search"></div>
          <select id="tp" aria-label="Person"></select>
          <select id="ts" aria-label="Status"><option value="">All statuses</option><option value="open" ${f.status === "open" ? "selected" : ""}>All open</option>${STATUSES.map((s) => `<option ${f.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>
          <select id="tt" aria-label="Type"><option value="">All types</option>${TASK_TYPES.map((t) => `<option ${f.type === t ? "selected" : ""}>${t}</option>`).join("")}</select>
          <select id="tl" aria-label="P level"><option value="">All P levels</option>${["P0", "P1", "P2"].map((p) => `<option ${f.p === p ? "selected" : ""}>${p}</option>`).join("")}</select>
          <select id="tx" aria-label="Quick filter"><option value="">Any deadline</option><option value="delayed" ${f.special === "delayed" ? "selected" : ""}>Delayed</option><option value="overdue" ${f.special === "overdue" ? "selected" : ""}>Past deadline</option><option value="today" ${f.special === "today" ? "selected" : ""}>Due today</option><option value="high" ${f.special === "high" ? "selected" : ""}>High priority</option><option value="waiting" ${f.special === "waiting" ? "selected" : ""}>Waiting on someone</option></select>
          <label class="chk toggle"><input type="checkbox" id="tg" ${f.group ? "checked" : ""}> Group by person</label>
        </div>
        ${bulkBar()}
        <div id="results"></div>
      </div>`;
    const bind = (id, key) => { const el = $(id); const h = (e) => { f[key] = e.target.value; S.selected.clear(); S.redraw(); }; if (el.tagName === "SELECT") el.onchange = h; else el.oninput = h; };
    bind("#tq", "q"); bind("#tp", "person"); bind("#ts", "status"); bind("#tt", "type"); bind("#tl", "p"); bind("#tx", "special");
    $("#tg").onchange = (e) => { f.group = e.target.checked; S.redraw(); };
    $("#ppl").onclick = (e) => { const b = e.target.closest("[data-person]"); if (b) { f.person = f.person === b.dataset.person ? "" : b.dataset.person; S.selected.clear(); S.redraw(); } };
    $("#tk").onclick = (e) => { const b = e.target.closest("[data-tk]"); if (!b) return; Object.assign(f, JSON.parse(b.dataset.tk)); S.selected.clear(); route(); };
    const upd = wireBulk(main);
    const ownerKey = (t) => (t.assigned_to ? t.assigned_to : t.poc_name ? "poc:" + t.poc_name : "none");
    const ownerLabel = (k) => (k === "none" ? "Unassigned" : k.startsWith("poc:") ? `${k.slice(4)}* (named in sheet, no account yet)` : nameOf(k));
    S.redraw = () => {
      const open = S.tasks.filter(isOpen);
      const ppl = members();
      const noOwner = (t) => !t.assigned_to && !t.poc_name;
      const ALL = { status: "open", person: "", p: "", special: "", q: "", type: "" };
      $("#tk").innerHTML = [
        ["Open tasks", open.length, "", { ...ALL }], ["Delayed", open.filter(isDelayed).length, "red", { ...ALL, special: "delayed" }],
        ["Unassigned", open.filter(noOwner).length, "amber", { ...ALL, person: "none" }], ["Not linked yet*", open.filter((t) => !t.assigned_to && t.poc_name).length, "violet", { ...ALL, person: "poc" }],
        ["Blocked", open.filter((t) => t.status === "Blocked").length, "", { ...ALL, status: "Blocked" }], ["Completed", S.tasks.filter((t) => t.status === "Completed").length, "green", { ...ALL, status: "Completed" }],
      ].map(([l, n, c, filt]) => `<button type="button" class="kpi ${c}" data-tk='${esc(JSON.stringify(filt))}'><span>${l}</span><b>${n}</b></button>`).join("");
      const max = Math.max(1, ...ppl.map((p) => open.filter((t) => t.assigned_to === p.id).length));
      $("#ppl").innerHTML = ppl.map((p) => {
        const mine = open.filter((t) => t.assigned_to === p.id);
        const late = mine.filter(isDelayed).length;
        return `<button type="button" class="person ${f.person === p.id ? "on" : ""}" data-person="${p.id}" title="Show ${esc(p.full_name)}'s tasks">${avatar(p.id, p.full_name)}<span style="flex:1;min-width:0"><b>${esc(p.full_name)}</b><small>${mine.length} open${late ? ` · <span class="late">${late} delayed</span>` : ""}</small><div class="loadbar"><span style="width:${(mine.length / max) * 100}%"></span></div></span></button>`;
      }).join("");
      $("#tp").innerHTML = `<option value="">All people</option><option value="none" ${f.person === "none" ? "selected" : ""}>Unassigned</option><option value="poc" ${f.person === "poc" ? "selected" : ""}>Named in sheet, no account*</option>` +
        ppl.map((p) => `<option value="${p.id}" ${f.person === p.id ? "selected" : ""}>${esc(p.full_name)}</option>`).join("");
      const q = f.q.toLowerCase();
      const list = S.tasks.filter((t) =>
        (!q || t.title.toLowerCase().includes(q) || showName(t.show_id).toLowerCase().includes(q) || (t.ext_task_id || "").includes(q) || (t.poc_name || "").toLowerCase().includes(q)) &&
        (!f.person || (f.person === "none" ? noOwner(t) : f.person === "poc" ? (!t.assigned_to && t.poc_name) : t.assigned_to === f.person)) &&
        (!f.status || (f.status === "open" ? isOpen(t) : t.status === f.status)) &&
        (!f.type || t.task_type === f.type) &&
        (!f.p || t.p_level === f.p) &&
        (!f.special || (f.special === "delayed" ? isDelayed(t) : f.special === "overdue" ? isOverdue(t) : f.special === "today" ? isDueToday(t) : f.special === "waiting" ? (isOpen(t) && t.waiting_on) : isHigh(t)))
      ).sort(prioritySort);
      for (const id of [...S.selected]) if (!list.some((t) => t.id === id)) S.selected.delete(id);
      const opts = { selectable: true, inlineAssign: true, limit: 300, empty: "No tasks match these filters." };
      if (f.group && list.length) {
        const groups = new Map();
        for (const t of list) { const k = ownerKey(t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
        const keys = [...groups.keys()].sort((a, b) => (a === "none") - (b === "none") || ownerLabel(a).localeCompare(ownerLabel(b)));
        $("#results").innerHTML = `<p class="dim" style="margin:0 0 6px">${list.length} task(s) · ${keys.length} people</p>` + keys.map((k) => {
          const g = groups.get(k); const late = g.filter(isDelayed).length;
          return `<div class="group"><h3>${k === "none" || k.startsWith("poc:") ? "" : avatar(k, nameOf(k))} ${esc(ownerLabel(k))} <small>${g.length} task(s)${late ? ` · <span class="late">${late} delayed</span>` : ""}</small></h3>${taskTable(g, { ...opts, hidePerson: true })}</div>`;
        }).join("");
      } else {
        $("#results").innerHTML = `<p class="dim" style="margin:0 0 6px">${list.length} task(s)</p>` + taskTable(list, opts);
      }
      upd && upd();
    };
    S.redraw();
  };

  // 9.9 Blockers / Issues
  PAGE_FN.blockers = (main) => {
    const f = S.f.blockers;
    main.innerHTML = header("Blockers / Issues", "Linked to shows and tasks. An open blocker marks its task as Blocked automatically.",
      `<button class="btn danger" data-act="add-issue" type="button">＋ Raise issue</button>`) + `
      <div class="kpis" id="bk"></div>
      <div class="card">
        <div class="bar">
          <select id="bs" aria-label="Status"><option value="active">Open + Investigating</option><option value="">All</option>${["Open", "Investigating", "Resolved"].map((s) => `<option ${f.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>
          <select id="bv" aria-label="Severity"><option value="">All severities</option>${["Critical", "High", "Medium", "Low"].map((s) => `<option ${f.severity === s ? "selected" : ""}>${s}</option>`).join("")}</select>
        </div>
        <div id="results"></div>
      </div>`;
    $("#bs").value = f.status;
    $("#bs").onchange = (e) => { f.status = e.target.value; S.redraw(); };
    $("#bv").onchange = (e) => { f.severity = e.target.value; S.redraw(); };
    S.redraw = () => {
      const I = S.issues;
      $("#bk").innerHTML = [["Open", I.filter((i) => i.status === "Open").length, "red"], ["Investigating", I.filter((i) => i.status === "Investigating").length, "amber"], ["Resolved", I.filter((i) => i.status === "Resolved").length, "green"], ["Critical (unresolved)", I.filter((i) => i.severity === "Critical" && i.status !== "Resolved").length, "red"]]
        .map(([l, n, c]) => `<div class="kpi ${c}" style="cursor:default"><span>${l}</span><b>${n}</b></div>`).join("");
      const list = I.filter((i) => (f.status === "" || (f.status === "active" ? i.status !== "Resolved" : i.status === f.status)) && (!f.severity || i.severity === f.severity))
        .sort((a, b) => (a.status === "Resolved") - (b.status === "Resolved") || new Date(b.created_at) - new Date(a.created_at));
      const can = (i) => isStaff() || i.owner === S.me.id || i.raised_by === S.me.id;
      $("#results").innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th>Show</th><th>Task</th><th>Issue</th><th>Severity</th><th>Status</th><th>Raised by</th><th>Owner</th><th>Raised</th><th></th></tr></thead><tbody>
        ${list.map((i) => {
          const t = S.tasks.find((x) => x.id === i.task_id);
          return `<tr><td>${showLink(i.show_id)}</td><td>${t ? esc(t.title) : '<span class="dim">—</span>'}</td><td><b>${esc(i.description)}</b></td><td>${sevPill(i.severity)}</td>
            <td>${can(i) ? `<select data-act="issue-status" data-id="${i.id}" aria-label="Status">${["Open", "Investigating", "Resolved"].map((s) => `<option ${s === i.status ? "selected" : ""}>${s}</option>`).join("")}</select>` : statusPill(i.status)}</td>
            <td>${esc(nameOf(i.raised_by))}</td><td>${esc(nameOf(i.owner))}</td><td><small>${fmtDT(i.created_at)}</small></td>
            <td>${can(i) ? `<button class="btn sm" data-act="edit-issue" data-id="${i.id}">Edit</button>` : ""}</td></tr>`;
        }).join("")}</tbody></table></div>` : `<div class="empty">No blockers here. 🎉</div>`;
    };
    S.redraw();
  };

  // 9.11 My Tasks
  PAGE_FN.mytasks = (main) => {
    const f = S.f.mytasks;
    main.innerHTML = header("My Tasks", "Your queue: delayed first, then High flag → P0/P1/P2 → H/M/L → deadline. Completed tasks sit at the bottom.") + `
      <div class="card"><div class="bar"><select id="mf" aria-label="Filter">${[["", "All"], ["open", "Open only"], ["delayed", "Delayed"], ["high", "High priority"], ["P0", "P0"], ["P1", "P1"], ["P2", "P2"], ["today", "Due today"], ["overdue", "Past deadline"]].map(([v, l]) => `<option value="${v}" ${f.filter === v ? "selected" : ""}>${l}</option>`).join("")}</select></div><div id="results"></div></div>`;
    $("#mf").onchange = (e) => { f.filter = e.target.value; S.redraw(); };
    S.redraw = () => {
      const x = f.filter;
      const list = S.tasks.filter((t) => t.assigned_to === S.me.id &&
        (!x || (x === "open" ? isOpen(t) : x === "delayed" ? isDelayed(t) : x === "high" ? isHigh(t) : x === "today" ? isDueToday(t) : x === "overdue" ? isOverdue(t) : t.p_level === x))).sort(prioritySort);
      $("#results").innerHTML = taskTable(list, { hidePerson: true, limit: 300, empty: "Nothing assigned to you here. Tasks appear automatically when someone assigns them to you." });
    };
    S.redraw();
  };

  // 9.12 Activity Log
  PAGE_FN.log = (main) => {
    const f = S.f.log;
    main.innerHTML = header("Activity Log", "Every change is recorded automatically and can't be edited. Showing the latest 500 events.") + `
      <div class="card"><div class="bar"><div class="grow"><input type="search" id="lq" placeholder="Search by person, action, show or details…" value="${esc(f.q)}" aria-label="Search"></div></div><div id="results"></div></div>`;
    $("#lq").oninput = (e) => { f.q = e.target.value; S.redraw(); };
    S.redraw = () => {
      const q = f.q.toLowerCase();
      const list = S.log.filter((l) => !q || [nameOf(l.user_id), l.action, showName(l.show_id), l.details].join(" ").toLowerCase().includes(q));
      $("#results").innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Show</th><th>Details</th></tr></thead><tbody>
        ${list.map((l) => `<tr><td class="num"><small>${fmtDT(l.created_at)}</small></td><td>${esc(l.user_id ? nameOf(l.user_id) : "System")}</td><td><b>${esc(l.action)}</b></td><td>${l.show_id ? showLink(l.show_id) : "—"}</td><td>${esc(l.details || "")}</td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty">No matching activity.</div>`;
    };
    S.redraw();
  };

  // 9.13 Team & Settings (Manager only)
  PAGE_FN.team = (main) => {
    const s = S.settings;
    const tat = s.tat_days || {};
    main.innerHTML = header("Team & Settings", "Add members, approve sign-ups, set roles, and change the request window and delay rules.") + v2Banner() + `
      <div class="card" style="margin-bottom:16px"><h2>People</h2><div id="results"></div>
        <p class="hint"><b>Writer</b>: raises requests inside the window. <b>Ops</b>: assigns, reassigns, updates tasks, batches and MAQ, and adds shows. <b>Manager</b>: everything, including priority, roles and settings. <b>Pending</b>: can't see anything yet.</p></div>
      ${S.v2 ? `<div class="grid2b" style="margin-bottom:16px">
        <div class="card"><h2>Add members</h2>
          <p class="hint" style="margin-top:0">Add people by email. When they create their account with that email, they get this name and role straight away, with no approval needed.</p>
          <form class="form" id="invf">
            <div><label for="i_name">Full name</label><input id="i_name" type="text" required></div>
            <div><label for="i_email">Email</label><input id="i_email" type="email" required></div>
            <div><label for="i_role">Role</label><select id="i_role"><option value="writer">Writer</option><option value="ops" selected>Ops</option><option value="manager">Manager</option></select></div>
            <div style="align-self:end"><button class="btn primary" type="submit">Add member</button></div>
          </form>
          <details style="margin-top:12px"><summary>Add many at once</summary>
            <p class="hint">One person per line: <code>Name, email, role</code> (role = writer, ops or manager).</p>
            <textarea id="i_bulk" placeholder="Shruti Soam, ext-shruti.soam@pocketfm.com, ops"></textarea>
            <button class="btn" id="i_bulkGo" type="button" style="margin-top:8px">Add all</button>
          </details>
          <div id="invList" style="margin-top:14px"></div>
        </div>
        <div class="card"><h2>Imported names</h2>
          <p class="hint" style="margin-top:0">Tasks and shows brought in from the sheets carry people's names (e.g. “Shruti”, “Akshaya”). After those people join, click below to link their work to their accounts. It's safe to click any time.</p>
          <p><b id="unlinked">${S.tasks.filter((t) => t.poc_name && !t.assigned_to).length}</b> task(s) and <b>${S.shows.filter((x) => (x.ops_name || x.ops_email) && !x.ops_owner).length}</b> show owner(s) not linked yet.</p>
          <button class="btn primary" id="relink" type="button">Match imported names to accounts</button>
        </div>
      </div>` : ""}
      <div class="grid2b">
        <div class="card"><h2>Request window</h2>
          <form class="form" id="setf">
            <div><label for="s_start">Opens at</label><input id="s_start" type="time" value="${hm(s.request_start)}" required></div>
            <div><label for="s_end">Closes at</label><input id="s_end" type="time" value="${hm(s.request_end)}" required></div>
            <div class="full"><label for="s_tz">Time zone</label><input id="s_tz" type="text" value="${esc(s.timezone)}" required><small class="dim">e.g. Asia/Kolkata, Europe/London</small></div>
            <div class="full"><button class="btn primary" type="submit">Save request window</button></div>
          </form></div>
        ${S.v2 ? `<div class="card"><h2>Delay rules</h2>
          <p class="hint" style="margin-top:0">A task with no deadline counts as <b>delayed</b> when it's still open this many days after it was raised. Tasks with a deadline are delayed once the deadline passes.</p>
          <form class="form" id="tatf">
            ${TASK_TYPES.map((t) => `<div><label for="tat_${t.replace(/\W/g, "")}">${t} <small>(days)</small></label><input id="tat_${t.replace(/\W/g, "")}" data-tat="${t}" type="number" min="0" max="60" value="${tat[t] ?? 3}"></div>`).join("")}
            <div><label for="s_maqw">MAQ “coming up” window <small>(days)</small></label><input id="s_maqw" type="number" min="1" max="60" value="${s.maq_warn_days ?? 7}"></div>
            <div class="full"><button class="btn primary" type="submit">Save delay rules</button></div>
          </form></div>` : ""}
      </div>`;
    $("#setf").onsubmit = (e) => {
      e.preventDefault();
      const tzv = $("#s_tz").value.trim();
      try { new Intl.DateTimeFormat("en", { timeZone: tzv }); } catch { return toast("That time zone isn't recognised. Try Asia/Kolkata.", "bad"); }
      save(sb.from("settings").update({ request_start: $("#s_start").value, request_end: $("#s_end").value, timezone: tzv }).eq("id", 1), "Request window saved");
    };
    if (S.v2) {
      $("#tatf").onsubmit = (e) => {
        e.preventDefault();
        const m = {}; $$("[data-tat]").forEach((i) => (m[i.dataset.tat] = Math.max(0, Number(i.value) || 0)));
        save(sb.from("settings").update({ tat_days: m, maq_warn_days: Math.max(1, Number($("#s_maqw").value) || 7) }).eq("id", 1), "Delay rules saved");
      };
      const addInvites = async (rows) => {
        const clean = rows.filter((r) => r.email && r.full_name).map((r) => ({ email: r.email.trim().toLowerCase(), full_name: r.full_name.trim(), role: ["writer", "ops", "manager"].includes((r.role || "").trim().toLowerCase()) ? r.role.trim().toLowerCase() : "writer" }));
        if (!clean.length) return toast("Nothing to add. Check the format: Name, email, role", "bad");
        const existing = new Set(S.profiles.map((p) => (p.email || "").toLowerCase()));
        const already = clean.filter((r) => existing.has(r.email));
        const ok = await save(sb.from("invites").upsert(clean.filter((r) => !existing.has(r.email))), `${clean.length - already.length} member(s) added`);
        if (already.length) toast(`${already.length} already have accounts. Set their role in the People table.`);
        return ok;
      };
      $("#invf").onsubmit = async (e) => {
        e.preventDefault();
        if (await addInvites([{ full_name: $("#i_name").value, email: $("#i_email").value, role: $("#i_role").value }])) $("#invf").reset();
      };
      $("#i_bulkGo").onclick = async () => {
        const rows = $("#i_bulk").value.split(/\n+/).map((l) => l.split(/[,\t;]/).map((x) => x.trim())).filter((a) => a.length >= 2).map(([full_name, email, r]) => ({ full_name, email, role: r }));
        if (await addInvites(rows)) $("#i_bulk").value = "";
      };
      $("#invList").onclick = async (e) => {
        const b = e.target.closest("[data-uninv]"); if (!b) return;
        await save(sb.from("invites").delete().eq("email", b.dataset.uninv), "Removed");
      };
      $("#relink").onclick = async () => {
        const { data, error } = await sb.rpc("relink_imported_names");
        if (error) return toast(friendly(error), "bad");
        toast(`Linked ${data?.tasks ?? 0} task(s) and ${data?.shows ?? 0} show owner(s).`, "good");
        await loadAll(); route();
      };
    }
    $("#results").onchange = (e) => {
      const el = e.target.closest("[data-role]");
      if (el) save(sb.from("profiles").update({ role: el.value }).eq("id", el.dataset.role), "Role updated");
    };
    S.redraw = () => {
      const ppl = S.profiles.slice().sort((a, b) => (a.role === "pending") === (b.role === "pending") ? a.full_name.localeCompare(b.full_name) : a.role === "pending" ? -1 : 1);
      $("#results").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead><tbody>
        ${ppl.map((p) => `<tr><td><b>${esc(p.full_name)}</b>${p.role === "pending" ? ` ${pill("Needs approval", "warn")}` : ""}${p.id === S.me.id ? ' <small>(you)</small>' : ""}</td><td>${esc(p.email || "")}</td>
          <td><select data-role="${p.id}" aria-label="Role for ${esc(p.full_name)}">${["pending", "writer", "ops", "manager"].map((r) => `<option value="${r}" ${r === p.role ? "selected" : ""}>${r[0].toUpperCase() + r.slice(1)}</option>`).join("")}</select></td>
          <td><small>${fmtDT(p.created_at)}</small></td></tr>`).join("")}
        </tbody></table></div>`;
      const il = $("#invList");
      if (il) il.innerHTML = S.invites.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>
        ${S.invites.map((i) => `<tr><td>${esc(i.full_name)}</td><td>${esc(i.email)}</td><td>${esc(i.role)}</td><td>${i.used_at ? pill("Joined", "good") : pill("Waiting to sign up", "")}</td><td>${i.used_at ? "" : `<button class="btn sm ghost-danger" data-uninv="${esc(i.email)}" type="button">Remove</button>`}</td></tr>`).join("")}
        </tbody></table></div>` : `<p class="dim">No one added yet.</p>`;
    };
    S.redraw();
  };

  // ---------- 10. Pop-up forms ----------
  function alertsModal() {
    const items = alertItems();
    openModal(`Alerts (${items.length})`, items.length ? `<div class="alerts">${items.map((a) => `<a href="${a.href}" class="alert-row" data-close>${pill(a.kind, a.cls)}<span>${esc(a.text)}</span></a>`).join("")}</div>
      <p class="hint">${isStaff() ? "You see every delayed task in the team." : "You see delayed tasks assigned to you."} Delay rules are set in Team &amp; Settings.</p>` : `<div class="empty">Nothing needs attention right now. 🎉</div>`);
  }

  function taskModal(t) {
    if (!t) return;
    const mgr = isManager();
    const opt = (list, cur) => list.map((v) => `<option ${v === cur ? "selected" : ""}>${v}</option>`).join("");
    openModal("Edit task", `<form id="tf">
      <div class="form">
        <div class="full"><label for="e_show">Show</label><select id="e_show">${S.shows.slice().sort((a, b) => a.name.localeCompare(b.name)).map((x) => `<option value="${x.id}" ${x.id === t.show_id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
        <div class="full"><label for="e_title">Task</label><input id="e_title" type="text" value="${esc(t.title)}" required></div>
        <div><label for="e_type">Type</label><select id="e_type">${opt(TASK_TYPES, t.task_type || "Other")}</select></div>
        <div><label for="e_rng">Episode range</label><input id="e_rng" type="text" value="${esc(t.ep_range || "")}"></div>
        <div><label for="e_ext">Task ID</label><input id="e_ext" type="text" value="${esc(t.ext_task_id || "")}"></div>
        <div><label for="e_wait">Waiting on</label><select id="e_wait"><option value="">Nobody</option>${opt(WAITING_ON, t.waiting_on)}</select></div>
        <div><label for="e_to">Assigned to</label><select id="e_to"><option value="">${t.poc_name && !t.assigned_to ? esc(t.poc_name) + "* (no account)" : "Unassigned"}</option>${members().map((p) => `<option value="${p.id}" ${p.id === t.assigned_to ? "selected" : ""}>${esc(p.full_name)}</option>`).join("")}</select></div>
        <div><label for="e_st">Status</label><select id="e_st">${opt(STATUSES, t.status)}</select></div>
        <div><label for="e_hml">Priority ${mgr ? "" : "<small>(Manager)</small>"}</label><select id="e_hml" ${mgr ? "" : "disabled"}>${opt(["High", "Medium", "Low"], t.hml)}</select></div>
        <div><label for="e_p">P level ${mgr ? "" : "<small>(Manager)</small>"}</label><select id="e_p" ${mgr ? "" : "disabled"}>${opt(["P0", "P1", "P2"], t.p_level)}</select></div>
        <div><label for="e_high">High flag ${mgr ? "" : "<small>(Manager)</small>"}</label><select id="e_high" ${mgr ? "" : "disabled"}><option value="false">No</option><option value="true" ${t.high_flag ? "selected" : ""}>Yes</option></select></div>
        <div><label for="e_dl">Deadline</label><input id="e_dl" type="date" value="${t.deadline || ""}"></div>
        <div class="full"><label for="e_det">Details</label><textarea id="e_det">${esc(t.details || "")}</textarea></div>
      </div>
      <p class="hint">Raised ${t.raised_by ? "by " + esc(nameOf(t.raised_by)) + " " : ""}on ${fmtDT(t.created_at)}${t.completed_at ? ` · Completed ${fmtDT(t.completed_at)}` : ""}${isDelayed(t) ? ` · <span class="late">Delayed ${delay(t).days} day(s) (${delay(t).why})</span>` : ""}</p>
      <div class="modal-foot">
        ${mgr ? `<button type="button" class="btn ghost-danger left" id="e_del">Delete task</button>` : ""}
        <button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Save changes</button>
      </div></form>`, (m) => {
      $("#tf", m).onsubmit = async (e) => {
        e.preventDefault();
        const patch = {
          show_id: Number($("#e_show", m).value), title: $("#e_title", m).value.trim(),
          assigned_to: $("#e_to", m).value || null, status: $("#e_st", m).value,
          deadline: $("#e_dl", m).value || null, details: $("#e_det", m).value.trim() || null,
        };
        if (S.v2) Object.assign(patch, { task_type: $("#e_type", m).value, ep_range: $("#e_rng", m).value.trim() || null, ext_task_id: $("#e_ext", m).value.trim() || null, waiting_on: $("#e_wait", m).value || null });
        if (mgr) Object.assign(patch, { hml: $("#e_hml", m).value, p_level: $("#e_p", m).value, high_flag: $("#e_high", m).value === "true" });
        if (await save(sb.from("tasks").update(patch).eq("id", t.id), "Task saved")) closeModal();
      };
      const del = $("#e_del", m);
      if (del) del.onclick = async () => {
        if (del.dataset.sure !== "1") { del.dataset.sure = "1"; del.textContent = "Click again to delete for good"; del.classList.add("danger"); return; }
        if (await save(sb.from("tasks").delete().eq("id", t.id), "Task deleted")) closeModal();
      };
    }, true);
  }

  function showModal(sh) {
    const isNew = !sh;
    const v = (k) => esc(sh?.[k] ?? "");
    const sel = (id, list, cur, blank = "—") => `<select id="${id}"><option value="">${blank}</option>${list.map((x) => `<option ${x === cur ? "selected" : ""}>${esc(x)}</option>`).join("")}${cur && !list.includes(cur) ? `<option selected>${esc(cur)}</option>` : ""}</select>`;
    const txt = (id, k, ph = "") => `<input id="${id}" type="text" value="${v(k)}" placeholder="${esc(ph)}">`;
    openModal(isNew ? "Add show" : `Edit · ${sh.name}`, `<form id="sf">
      <div class="form">
        <div class="full"><label for="h_name">Show name *</label><input id="h_name" type="text" value="${v("name")}" required></div>
        <div><label for="h_type">Region</label><select id="h_type">${["EU", "UK", "Other"].map((t) => `<option ${t === (sh?.type || "EU") ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div><label for="h_ok">Requests</label><label class="chk"><input type="checkbox" id="h_ok" ${sh?.approved === false ? "" : "checked"}> Approved (writers can raise requests)</label></div>
        ${S.v2 ? `
        <div><label for="h_de">DE title</label>${txt("h_de", "de_title")}</div>
        <div><label for="h_stage">Production stage</label>${sel("h_stage", PROD_STAGES, sh?.prod_status)}</div>
        <div><label for="h_stype">Show type</label>${sel("h_stype", ["US", "UK", "Commissioning", "Writer ver", "Hindi", "Hindi Show US ver", "Reskinning"], sh?.show_type)}</div>
        <div><label for="h_pri">Priority</label>${sel("h_pri", ["P0", "P1", "P2"], sh?.priority)}</div>
        <div><label for="h_genre">Genre</label>${txt("h_genre", "genre")}</div>
        <div><label for="h_sub">Sub-genre</label>${txt("h_sub", "sub_genre")}</div>
        <div><label for="h_src">Source state</label>${sel("h_src", SOURCE_STATES, sh?.source_state)}</div>
        <div><label for="h_eps">Source episodes</label><input id="h_eps" type="text" value="${esc(sh?.source_eps_note || sh?.source_eps || "")}" placeholder="e.g. 1206 or 1206+"></div>
        <div><label for="h_ops">Ops owner</label><select id="h_ops"><option value="">${sh?.ops_name && !sh?.ops_owner ? esc(sh.ops_name) + "* (no account)" : "—"}</option>${members().map((p) => `<option value="${p.id}" ${p.id === sh?.ops_owner ? "selected" : ""}>${esc(p.full_name)}</option>`).join("")}</select></div>
        <div><label for="h_prod">Producer</label>${txt("h_prod", "producer")}</div>
        <div><label for="h_loc">LOC writer</label>${txt("h_loc", "loc_writer")}</div>
        <div><label for="h_rect">Rectifier</label>${txt("h_rect", "rectifier")}</div>
        <div><label for="h_pr1">Proofreader 1</label>${txt("h_pr1", "proofreader1")}</div>
        <div><label for="h_pr2">Proofreader 2</label>${txt("h_pr2", "proofreader2")}</div>
        <div><label for="h_se">Sound engineer</label>${txt("h_se", "sound_engineer")}</div>
        <div><label for="h_voice">Voice (M/F)</label>${sel("h_voice", ["F", "M", "F + M"], sh?.voice)}</div>
        <div><label for="h_start">Production start</label><input id="h_start" type="date" value="${v("prod_start")}"></div>
        <div><label for="h_launch">Launch date</label><input id="h_launch" type="date" value="${v("launch_date")}"></div>
        <div><label for="h_destat">DE show status</label>${sel("h_destat", DE_STATUSES, sh?.de_status)}</div>
        <div><label for="h_pub">Published</label>${sel("h_pub", ["Published", "Yet to publish", "Unpublished"], sh?.published_status)}</div>
        <div><label for="h_month">Month</label>${txt("h_month", "month", "e.g. Oct' 26")}</div>
        <div><label for="h_adapt">Adaptation type</label>${txt("h_adapt", "adaptation_type")}</div>
        <div class="full"><label for="h_srcl">Source link</label>${txt("h_srcl", "source_link", "https://…")}</div>
        <div class="full"><label for="h_cms">DE CMS link</label>${txt("h_cms", "de_cms_link", "https://cms.pocketfm.com/…")}</div>
        <div><label for="h_usid">Show ID (US/UK)</label>${txt("h_usid", "us_show_id")}</div>
        <div><label for="h_deid">Show ID (DE)</label>${txt("h_deid", "de_show_id")}</div>
        <div class="full"><label for="h_com">Comments</label><textarea id="h_com">${v("comments")}</textarea></div>` : ""}
      </div>
      <div class="modal-foot">
        ${!isNew && isManager() ? `<button type="button" class="btn ghost-danger left" id="h_del">Delete show</button>` : ""}
        <button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">${isNew ? "Add show" : "Save"}</button>
      </div></form>`, (m) => {
      $("#sf", m).onsubmit = async (e) => {
        e.preventDefault();
        const val = (id) => { const x = $(id, m); return x ? (x.value.trim() || null) : undefined; };
        const row = { name: $("#h_name", m).value.trim(), type: $("#h_type", m).value, approved: $("#h_ok", m).checked };
        if (S.v2) {
          const epsTxt = val("#h_eps");
          const epsNum = epsTxt ? parseInt(epsTxt.replace(/\D.*$/, ""), 10) : null;
          Object.assign(row, {
            de_title: val("#h_de"), prod_status: val("#h_stage"), show_type: val("#h_stype"), priority: val("#h_pri"), genre: val("#h_genre"), sub_genre: val("#h_sub"),
            source_state: val("#h_src"), source_eps: Number.isFinite(epsNum) ? epsNum : null, source_eps_note: epsTxt && String(epsNum) !== epsTxt ? epsTxt : null,
            ops_owner: val("#h_ops"), producer: val("#h_prod"), loc_writer: val("#h_loc"), rectifier: val("#h_rect"), proofreader1: val("#h_pr1"), proofreader2: val("#h_pr2"),
            sound_engineer: val("#h_se"), voice: val("#h_voice"), prod_start: val("#h_start"), launch_date: val("#h_launch"), de_status: val("#h_destat"), published_status: val("#h_pub"),
            month: val("#h_month"), adaptation_type: val("#h_adapt"), source_link: val("#h_srcl"), de_cms_link: val("#h_cms"), us_show_id: val("#h_usid"), de_show_id: val("#h_deid"), comments: val("#h_com"),
          });
        }
        const req = isNew ? sb.from("shows").insert(row) : sb.from("shows").update(row).eq("id", sh.id);
        if (await save(req, isNew ? `Show “${row.name}” added` : "Show saved")) closeModal();
      };
      const del = $("#h_del", m);
      if (del) del.onclick = async () => {
        if (del.dataset.sure !== "1") { del.dataset.sure = "1"; del.textContent = "Click again: this also deletes its tasks and batches"; del.classList.add("danger"); return; }
        if (await save(sb.from("shows").delete().eq("id", sh.id), "Show deleted")) { closeModal(); location.hash = "shows"; }
      };
    }, true);
  }

  function maqModal(sh) {
    if (!sh) return;
    openModal(`Update MAQ · ${sh.name}`, `<form id="mf2">
      <div class="form">
        <div><label for="q_ep">MAQ done till EP</label><input id="q_ep" type="number" min="0" value="${sh.maq_till_ep ?? ""}"></div>
        <div><label for="q_date">MAQ done till date</label><input id="q_date" type="date" value="${sh.maq_till_date || ""}"></div>
        <div><label for="q_pat">Pattern</label><input id="q_pat" type="text" list="q_pats" value="${esc(sh.maq_pattern || "")}" placeholder="e.g. 2 eps/daily"><datalist id="q_pats"><option value="2 eps/daily"><option value="3 eps/daily"><option value="10 eps/daily"><option value="Custom"></datalist></div>
        <div><label for="q_state">Show state on DE CMS</label><select id="q_state"><option value="">—</option>${MAQ_STATES.map((x) => `<option ${x === sh.maq_state ? "selected" : ""}>${x}</option>`).join("")}</select></div>
        <div><label for="q_nrc">NRC status</label><input id="q_nrc" type="text" value="${esc(sh.nrc_status || "")}" placeholder="e.g. Added"></div>
        <div><label for="q_nrcc">NRC cadence</label><input id="q_nrcc" type="text" value="${esc(sh.nrc_cadence || "")}" placeholder="e.g. 2 ep/day"></div>
        <div class="full"><label for="q_com">Comments</label><input id="q_com" type="text" value="${esc(sh.maq_comments || "")}" placeholder="e.g. 6:30 am schedule time"></div>
      </div>
      <p class="hint">Tip: with “2 eps/daily”, queuing 20 more episodes moves the date 10 days later.</p>
      <div class="modal-foot"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Save MAQ</button></div></form>`, (m) => {
      $("#mf2", m).onsubmit = async (e) => {
        e.preventDefault();
        const ep = $("#q_ep", m).value;
        const patch = { maq_till_ep: ep === "" ? null : Number(ep), maq_till_date: $("#q_date", m).value || null, maq_pattern: $("#q_pat", m).value.trim() || null,
          maq_state: $("#q_state", m).value || null, nrc_status: $("#q_nrc", m).value.trim() || null, nrc_cadence: $("#q_nrcc", m).value.trim() || null, maq_comments: $("#q_com", m).value.trim() || null };
        if (await save(sb.from("shows").update(patch).eq("id", sh.id), "MAQ updated")) closeModal();
      };
    });
  }

  function batchModal(showId, from, to) {
    const s = showById(showId);
    if (!s || !isStaff()) return;
    const b = from ? batchesFor(showId).find((x) => x.ep_from === from) : null;
    const opt = (cur) => BATCH_STATUSES.map((x) => `<option ${x === cur ? "selected" : ""}>${x}</option>`).join("");
    openModal(`${s.name} · ${b ? `${b.ep_from}–${b.ep_to}` : "batch"}`, `<form id="bf">
      <div class="form">
        <div><label for="b_from">From episode</label><input id="b_from" type="number" min="1" value="${b?.ep_from ?? from ?? ""}" ${b ? "disabled" : ""} required></div>
        <div><label for="b_to">To episode</label><input id="b_to" type="number" min="1" value="${b?.ep_to ?? to ?? ""}" ${b ? "disabled" : ""} required></div>
        <div><label for="b_loc">LOC sheet</label><select id="b_loc">${opt(b?.loc_status || "Not started")}</select></div>
        <div><label for="b_adp">Adapted script</label><select id="b_adp">${opt(b?.adapted_status || "Not started")}</select></div>
        <div class="full"><label for="b_note">Notes</label><input id="b_note" type="text" value="${esc(b?.notes || "")}"></div>
      </div>
      ${b ? `<p class="hint">Last updated ${fmtDT(b.updated_at)}${b.updated_by ? " by " + esc(nameOf(b.updated_by)) : ""}</p>` : ""}
      <div class="modal-foot"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">${b ? "Save" : "Add batch"}</button></div></form>`, (m) => {
      $("#bf", m).onsubmit = async (e) => {
        e.preventDefault();
        const row = { loc_status: $("#b_loc", m).value, adapted_status: $("#b_adp", m).value, notes: $("#b_note", m).value.trim() || null };
        const req = b ? sb.from("show_batches").update(row).eq("id", b.id)
          : sb.from("show_batches").insert({ show_id: showId, ep_from: Number($("#b_from", m).value), ep_to: Number($("#b_to", m).value), ...row });
        if (await save(req, b ? "Batch updated" : "Batch added")) closeModal();
      };
    });
  }

  function issueModal(issue, presetShow) {
    const isNew = !issue;
    const shows = S.shows.slice().sort((a, b) => a.name.localeCompare(b.name));
    const curShow = issue?.show_id || presetShow || "";
    openModal(isNew ? "Raise issue" : "Edit issue", `<form id="if">
      <div class="form">
        <div><label for="i_show">Show *</label><select id="i_show" required><option value="">Choose a show…</option>${shows.map((x) => `<option value="${x.id}" ${x.id === curShow ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
        <div><label for="i_task">Task <small>(optional)</small></label><select id="i_task"></select></div>
        <div class="full"><label for="i_desc">Issue *</label><textarea id="i_desc" required placeholder="e.g. Book 3 not available">${esc(issue?.description || "")}</textarea></div>
        <div><label for="i_sev">Severity</label><select id="i_sev">${["Critical", "High", "Medium", "Low"].map((s) => `<option ${s === (issue?.severity || "High") ? "selected" : ""}>${s}</option>`).join("")}</select></div>
        <div><label for="i_own">Owner <small>(who resolves it)</small></label><select id="i_own"><option value="">Me</option>${members().map((p) => `<option value="${p.id}" ${p.id === issue?.owner ? "selected" : ""}>${esc(p.full_name)}</option>`).join("")}</select></div>
        ${isNew ? "" : `<div><label for="i_st">Status</label><select id="i_st">${["Open", "Investigating", "Resolved"].map((s) => `<option ${s === issue.status ? "selected" : ""}>${s}</option>`).join("")}</select></div>`}
      </div>
      <div class="modal-foot">
        ${!isNew && isManager() ? `<button type="button" class="btn ghost-danger left" id="i_del">Delete</button>` : ""}
        <button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">${isNew ? "Raise issue" : "Save"}</button>
      </div></form>`, (m) => {
      const fillTasks = () => {
        const sid = Number($("#i_show", m).value);
        const ts = (S.tasksByShow.get(sid) || []).slice().sort(newestFirst);
        $("#i_task", m).innerHTML = `<option value="">Whole show / no specific task</option>` + ts.map((t) => `<option value="${t.id}" ${t.id === issue?.task_id ? "selected" : ""}>${esc(t.title)} (${t.status})</option>`).join("");
      };
      fillTasks();
      $("#i_show", m).onchange = fillTasks;
      $("#if", m).onsubmit = async (e) => {
        e.preventDefault();
        const row = {
          show_id: Number($("#i_show", m).value), task_id: Number($("#i_task", m).value) || null,
          description: $("#i_desc", m).value.trim(), severity: $("#i_sev", m).value,
          owner: $("#i_own", m).value || S.me.id,
        };
        if (!isNew) row.status = $("#i_st", m).value;
        const req = isNew ? sb.from("issues").insert(row) : sb.from("issues").update(row).eq("id", issue.id);
        if (await save(req, isNew ? "Issue raised" : "Issue saved")) closeModal();
      };
      const del = $("#i_del", m);
      if (del) del.onclick = async () => {
        if (del.dataset.sure !== "1") { del.dataset.sure = "1"; del.textContent = "Click again to delete"; del.classList.add("danger"); return; }
        if (await save(sb.from("issues").delete().eq("id", issue.id), "Issue deleted")) closeModal();
      };
    });
  }

  async function timelineModal(showId) {
    const sh = showById(showId);
    if (!sh) return;
    const info = showInfo(sh);
    openModal(`Timeline · ${sh.name}`, `<p>${stagePill(sh.prod_status)} ${statusPill(info.status)} · ${info.openTasks} open task(s) · ${info.blockers.length} open blocker(s)</p><div id="tlBody" class="dim">Loading…</div>`);
    const { data, error } = await sb.from("activity_log").select("*").eq("show_id", showId).order("id", { ascending: false }).limit(300);
    const body = $("#tlBody");
    if (!body) return;
    if (error) { body.textContent = friendly(error); return; }
    body.className = "";
    body.innerHTML = data.length ? `<ul class="tl">${data.map((l) => `<li class="${/Blocker Raised|Blocked|Pending/.test(l.action) ? "bad" : /Completed|Resolved|Done|Launched/.test(l.action + (l.details || "")) ? "good" : ""}"><b>${esc(l.action)}</b> · ${esc(l.details || "")}<small>${esc(l.user_id ? nameOf(l.user_id) : "System")} · ${fmtDT(l.created_at)}</small></li>`).join("")}</ul>` : `<div class="empty">No history yet. Changes made in ShowOps appear here.</div>`;
  }

  // ---------- Go! ----------
  boot();
})();
