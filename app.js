// =====================================================================
//  ShowOps — app logic.  You don't need to edit this file.
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
    me: null, profiles: [], shows: [], tasks: [], issues: [], log: [],
    settings: { request_start: "06:00:00", request_end: "18:30:00", timezone: "Asia/Kolkata" },
    page: "dashboard", live: false, channel: null, redraw: null,
    f: {                     // remembered filters per page
      shows: { q: "", type: "", status: "" },
      tracker: { q: "", person: "", status: "open", p: "", special: "" },
      workload: { person: "", q: "" },
      blockers: { status: "active", severity: "" },
      mytasks: { filter: "" },
      log: { q: "" },
    },
    selected: new Set(),
  };

  const PAGES = [
    ["dashboard", "Dashboard", "⌂"],
    ["shows", "Shows Master", "▣"],
    ["raise", "Raise Request", "＋"],
    ["tracker", "Task Tracker", "☰"],
    ["workload", "Team Workload", "◉"],
    ["blockers", "Blockers / Issues", "⚠"],
    ["status", "Show Status & Timeline", "◷"],
    ["mytasks", "My Tasks", "✓"],
    ["log", "Activity Log", "≡"],
    ["team", "Team & Settings", "⚙"],
  ];
  const STATUSES = ["Unassigned", "Assigned", "In Progress", "Blocked", "Completed"];

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

  function todayStr() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
  function nowHM() {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz(), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  }
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
  const avatar = (id, name) => `<span class="av" style="background:${colorFor(id)}">${esc(initials(name ?? nameOf(id)))}</span>`;

  const isOpen = (t) => t.status !== "Completed";
  const isOverdue = (t) => isOpen(t) && t.deadline && t.deadline < todayStr();
  const isDueToday = (t) => isOpen(t) && t.deadline === todayStr();
  const isHigh = (t) => isOpen(t) && (t.high_flag || t.p_level === "P0");
  const openIssues = () => S.issues.filter((i) => i.status !== "Resolved");

  const pill = (txt, cls = "") => `<span class="pill ${cls}">${esc(txt)}</span>`;
  const STATUS_CLS = { Unassigned: "warn", Assigned: "info", "In Progress": "accent", Blocked: "bad", Completed: "good", "No Active Task": "", Open: "bad", Investigating: "warn", Resolved: "good" };
  const statusPill = (s) => pill(s, STATUS_CLS[s] || "");
  const hmlPill = (h) => pill(h, { High: "bad", Medium: "info", Low: "" }[h]);
  const pPill = (p) => pill(p, { P0: "bad", P1: "warn", P2: "info" }[p]);
  const sevPill = (s) => pill(s, { Critical: "bad", High: "warn", Medium: "info", Low: "" }[s]);
  const highCell = (t) => (t.high_flag ? `<span class="flag">● Yes</span>` : `<span class="dim">—</span>`);
  const deadlineCell = (t) => (t.deadline ? `<span class="${isOverdue(t) ? "late" : ""}">${fmtDate(t.deadline)}</span>` : `<span class="dim">—</span>`);

  const PR = { P0: 0, P1: 1, P2: 2 }, HR = { High: 0, Medium: 1, Low: 2 };
  const prioritySort = (a, b) =>
    (a.status === "Completed") - (b.status === "Completed") ||
    b.high_flag - a.high_flag ||
    PR[a.p_level] - PR[b.p_level] ||
    HR[a.hml] - HR[b.hml] ||
    (a.deadline || "9999").localeCompare(b.deadline || "9999");
  const newestFirst = (a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);

  function friendly(error) {
    const m = error?.message || String(error);
    if (/row-level security|permission denied/i.test(m)) return "You don't have permission to do that.";
    if (/duplicate key.*shows_name/i.test(m)) return "A show with that name already exists.";
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

  // Runs a database change, shows a message, refreshes the data.
  async function save(request, okMsg) {
    const { error } = await request;
    if (error) { toast(friendly(error), "bad"); refresh(); return false; }
    if (okMsg) toast(okMsg, "good");
    await loadAll();
    refresh();
    return true;
  }

  // ---------- 3. Modal ----------
  function openModal(title, body, onMount) {
    const m = $("#modal");
    m.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h3>${esc(title)}</h3><button type="button" data-close aria-label="Close">✕</button></div>
      <div class="modal-body">${body}</div></div>`;
    m.hidden = false;
    m.onclick = (e) => { if (e.target === m || e.target.closest("[data-close]")) closeModal(); };
    const first = $("input, select, textarea", m);
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
      Object.assign(S, { profiles, shows, tasks, issues, log: logRes.data || [] });
      if (setRes.data) S.settings = setRes.data;
      const meNow = profiles.find((p) => p.id === S.me?.id);
      if (meNow) S.me = meNow;
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
    }, 400);
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
      <p class="hint">${mode === "up" ? "The first person to create an account becomes the Manager. Everyone after that waits for the Manager to approve them." : "New here? Choose “Create account”."}</p>
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
  function navBadges() {
    return {
      blockers: openIssues().length,
      mytasks: S.tasks.filter((t) => t.assigned_to === S.me.id && isOpen(t)).length,
      team: S.profiles.filter((p) => p.role === "pending").length,
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
      .map(([id, label, ic], i) => {
        const badge = b[id] ? `<span class="badge ${id === "blockers" || id === "team" ? "red" : ""}">${b[id]}</span>` : "";
        return `${id === "log" ? "<hr>" : ""}<a href="#${id}" class="${S.page === id ? "on" : ""}"><span class="ic">${ic}</span>${label}${badge}</a>`;
      }).join("");
  }

  function header(title, sub, right = "") {
    return `<div class="top"><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ""}</div><div class="right">${right}${liveBadge()}</div></div>`;
  }

  const PAGE_FN = {};
  function route() {
    if (!S.me || !$("#main")) return;
    let id = (location.hash || "#dashboard").slice(1);
    if (!PAGES.some(([p]) => p === id) || (id === "team" && !isManager())) id = "dashboard";
    S.page = id;
    S.redraw = null;
    S.selected.clear();
    drawNav();
    PAGE_FN[id]($("#main"));
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  // Called after data changes: redraw only the parts of the page that show data.
  function refresh() {
    if (!S.me || !$("#main")) return;
    drawNav();
    if (S.redraw) S.redraw();
  }

  function go(page, filters) {
    if (filters) Object.assign(S.f[page], filters);
    if (location.hash === "#" + page) route(); else location.hash = page;
  }

  // ---------- 8. Shared pieces ----------
  function showInfo(s) {
    const tasks = S.tasks.filter((t) => t.show_id === s.id);
    const latest = tasks.slice().sort(newestFirst)[0];
    const blockers = S.issues.filter((i) => i.show_id === s.id && i.status !== "Resolved");
    return {
      show: s, latest, blockers,
      openTasks: tasks.filter(isOpen).length,
      status: blockers.length ? "Blocked" : latest ? latest.status : "No Active Task",
      updated: latest ? latest.updated_at : null,
    };
  }

  function canEditTask(t) { return isStaff() || t.assigned_to === S.me.id; }

  function taskActions(t) {
    const a = [];
    if (isStaff()) a.push(`<button class="btn sm" data-act="edit-task" data-id="${t.id}">Edit</button>`);
    if (canEditTask(t)) {
      if (t.status === "Completed") a.push(`<button class="btn sm" data-act="set-status" data-status="Assigned" data-id="${t.id}">Reopen</button>`);
      else {
        if (t.assigned_to === S.me.id && t.status === "Assigned") a.push(`<button class="btn sm" data-act="set-status" data-status="In Progress" data-id="${t.id}">Start</button>`);
        if (t.assigned_to) a.push(`<button class="btn sm" data-act="set-status" data-status="Completed" data-id="${t.id}">Complete</button>`);
      }
    }
    return `<div class="row-actions">${a.join("") || '<span class="dim">—</span>'}</div>`;
  }

  // One table used by Task Tracker, Workload and My Tasks.
  function taskTable(tasks, opt = {}) {
    if (!tasks.length) return `<div class="empty">${opt.empty || "No tasks here."}</div>`;
    const selectable = opt.selectable && isStaff();
    const people = members();
    const rows = tasks.map((t) => `<tr>
      ${selectable ? `<td><input class="check" type="checkbox" data-sel="${t.id}" ${S.selected.has(t.id) ? "checked" : ""} aria-label="Select task"></td>` : ""}
      ${opt.hideShow ? "" : `<td>${esc(showName(t.show_id))}</td>`}
      <td><b>${esc(t.title)}</b>${t.details ? `<small>${esc(t.details.slice(0, 90))}${t.details.length > 90 ? "…" : ""}</small>` : ""}<small>Raised by ${esc(nameOf(t.raised_by))}</small></td>
      <td>${hmlPill(t.hml)}</td><td>${pPill(t.p_level)}</td><td>${highCell(t)}</td>
      ${opt.hidePerson ? "" : `<td>${opt.inlineAssign && isStaff()
        ? `<select data-act="assign-row" data-id="${t.id}" aria-label="Assign to"><option value="">Unassigned</option>${people.map((p) => `<option value="${p.id}" ${p.id === t.assigned_to ? "selected" : ""}>${esc(p.full_name)}</option>`).join("")}</select>`
        : esc(nameOf(t.assigned_to))}</td>`}
      <td>${statusPill(t.status)}</td>
      <td class="num">${deadlineCell(t)}</td>
      <td>${taskActions(t)}</td>
    </tr>`).join("");
    return `<div class="table-wrap"><table><thead><tr>
      ${selectable ? `<th><input class="check" type="checkbox" data-selall aria-label="Select all"></th>` : ""}
      ${opt.hideShow ? "" : "<th>Show</th>"}<th>Task</th><th>H/M/L</th><th>P</th><th>High</th>
      ${opt.hidePerson ? "" : "<th>Assigned to</th>"}<th>Status</th><th>Deadline</th><th>Action</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function bulkBar() {
    if (!isStaff()) return "";
    return `<div class="bar" id="bulk"><span class="dim" id="selCount">0 selected</span>
      <select id="bulkTo" aria-label="Reassign to"><option value="">Choose person…</option><option value="__none">Unassigned</option>${members().map((p) => `<option value="${p.id}">${esc(p.full_name)}</option>`).join("")}</select>
      <button class="btn" id="bulkGo" type="button">Reassign selected</button></div>`;
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
    return upd;
  }

  // One click handler for the whole page (buttons inside tables etc.)
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || el.tagName === "SELECT") return;
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
    }
  });

  // ---------- 9. Pages ----------

  // 9.1 Dashboard
  PAGE_FN.dashboard = (main) => {
    S.redraw = () => {
      const open = S.tasks.filter(isOpen);
      const done = S.tasks.length - open.length;
      const oi = openIssues();
      const unassigned = open.filter((t) => !t.assigned_to);
      const kpis = [
        ["Total Tasks", S.tasks.length, "violet", "tracker", { status: "", person: "", p: "", special: "", q: "" }],
        ["Open Tasks", open.length, "", "tracker", { status: "open", person: "", p: "", special: "", q: "" }],
        ["Open Blockers", oi.length, "red", "blockers", { status: "active", severity: "" }],
        ["Completed", done, "green", "tracker", { status: "Completed", person: "", p: "", special: "", q: "" }],
        ["High Priority", open.filter(isHigh).length, "blue", "tracker", { status: "open", special: "high", person: "", p: "", q: "" }],
        ["Unassigned", unassigned.length, "amber", "tracker", { status: "open", person: "none", p: "", special: "", q: "" }],
      ];
      const attn = [
        ["⏱", "#fde6e9", "Overdue tasks", "Past their deadline", open.filter(isOverdue).length, "tracker", { status: "open", special: "overdue", person: "", p: "", q: "" }],
        ["⚑", "#fde6e9", "High priority", "High flag or P0", open.filter(isHigh).length, "tracker", { status: "open", special: "high", person: "", p: "", q: "" }],
        ["⚠", "#fff1d6", "Open blockers", "Need resolving", oi.length, "blockers", { status: "active", severity: "" }],
        ["◷", "#e6edfd", "Due today", "Deadline is today", open.filter(isDueToday).length, "tracker", { status: "open", special: "today", person: "", p: "", q: "" }],
        ["◌", "#eceafd", "Unassigned", "Need an owner", unassigned.length, "tracker", { status: "open", person: "none", special: "", p: "", q: "" }],
      ];
      const snap = S.shows.map(showInfo).sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0)).slice(0, 6);
      const mine = S.tasks.filter((t) => t.assigned_to === S.me.id && isOpen(t)).sort(prioritySort).slice(0, 5);
      const recent = S.log.slice(0, 8);

      main.innerHTML = header("Dashboard", `Welcome back, ${esc(S.me.full_name.split(" ")[0])} 👋`) + `
        <div class="kpis">${kpis.map(([l, n, c, p, f]) => `<button type="button" class="kpi ${c}" data-act="goto" data-page="${p}" data-f='${esc(JSON.stringify(f))}'><span>${l}</span><b>${n}</b></button>`).join("")}</div>
        <div class="grid2">
          <div class="card"><h2>Shows (latest activity)<a class="more" href="#shows">View all shows →</a></h2>
            ${snap.length ? `<div class="table-wrap"><table><thead><tr><th>Show</th><th>Type</th><th>Status</th><th>Owner</th><th>Open</th><th>Blockers</th><th>Updated</th></tr></thead><tbody>
            ${snap.map((i) => `<tr><td><b>${esc(i.show.name)}</b></td><td>${pill(i.show.type)}</td><td>${statusPill(i.status)}</td><td>${esc(i.latest ? nameOf(i.latest.assigned_to) : "—")}</td><td class="num">${i.openTasks}</td><td>${i.blockers.length ? pill(i.blockers.length, "bad") : pill(0, "good")}</td><td><small>${fmtDT(i.updated)}</small></td></tr>`).join("")}
            </tbody></table></div>` : `<div class="empty">No shows yet.</div>`}
          </div>
          <div class="card"><h2>Needs attention</h2><div class="attn">
            ${attn.map(([ic, bg, t, s, n, p, f]) => `<button type="button" data-act="goto" data-page="${p}" data-f='${esc(JSON.stringify(f))}'><span class="dot" style="background:${bg}">${ic}</span><span><b>${t}</b><small>${s}</small></span><span class="n ${n ? "hot" : ""}">${n}</span></button>`).join("")}
          </div></div>
        </div>
        <div class="grid2b">
          <div class="card"><h2>My priority queue<a class="more" href="#mytasks">View my tasks →</a></h2>
            ${mine.length ? `<div class="table-wrap"><table><thead><tr><th>Task</th><th>Show</th><th>P</th><th>Due</th><th>Status</th></tr></thead><tbody>
            ${mine.map((t) => `<tr><td><b>${esc(t.title)}</b></td><td>${esc(showName(t.show_id))}</td><td>${pPill(t.p_level)}</td><td>${deadlineCell(t)}</td><td>${statusPill(t.status)}</td></tr>`).join("")}
            </tbody></table></div>` : `<div class="empty">Nothing assigned to you right now.</div>`}
          </div>
          <div class="card"><h2>Recent activity<a class="more" href="#log">View all →</a></h2>
            ${recent.length ? `<div class="feed">${recent.map((l) => `<div>${avatar(l.user_id, l.user_id ? nameOf(l.user_id) : "S")}<span><b>${esc(l.user_id ? nameOf(l.user_id) : "System")}</b> · ${esc(l.action)}${l.show_id ? ` · ${esc(showName(l.show_id))}` : ""}<small>${esc(l.details || "")} · ${ago(l.created_at)}</small></span></div>`).join("")}</div>` : `<div class="empty">No activity yet.</div>`}
          </div>
        </div>`;
    };
    S.redraw();
  };

  // 9.2 Shows Master
  PAGE_FN.shows = (main) => {
    const f = S.f.shows;
    main.innerHTML = header("Shows Master", "One row per show. Status comes from the latest task, or “Blocked” if it has an open blocker.",
      isStaff() ? `<button class="btn primary" data-act="add-show" type="button">＋ Add show</button>` : "") + `
      <div class="card">
        <div class="bar">
          <div class="grow"><input type="search" id="sq" placeholder="Search shows…" value="${esc(f.q)}" aria-label="Search shows"></div>
          <select id="st" aria-label="Type"><option value="">All types</option>${["EU", "UK", "Other"].map((t) => `<option ${f.type === t ? "selected" : ""}>${t}</option>`).join("")}</select>
          <select id="ss" aria-label="Status"><option value="">All statuses</option>${["No Active Task", ...STATUSES].map((t) => `<option ${f.status === t ? "selected" : ""}>${t}</option>`).join("")}</select>
        </div>
        <div id="results"></div>
      </div>`;
    $("#sq").oninput = (e) => { f.q = e.target.value; S.redraw(); };
    $("#st").onchange = (e) => { f.type = e.target.value; S.redraw(); };
    $("#ss").onchange = (e) => { f.status = e.target.value; S.redraw(); };
    S.redraw = () => {
      const q = f.q.toLowerCase();
      const list = S.shows.map(showInfo)
        .filter((i) => (!q || i.show.name.toLowerCase().includes(q)) && (!f.type || i.show.type === f.type) && (!f.status || i.status === f.status))
        .sort((a, b) => a.show.name.localeCompare(b.show.name));
      $("#results").innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th>Show</th><th>Type</th><th>Current status</th><th>Latest task</th><th>Owner</th><th>Open</th><th>Blocker</th><th>Updated</th><th></th></tr></thead><tbody>
        ${list.map((i) => `<tr>
          <td><b>${esc(i.show.name)}</b>${i.show.approved ? "" : `<small>${pill("Not approved", "warn")}</small>`}</td>
          <td>${pill(i.show.type)}</td><td>${statusPill(i.status)}</td>
          <td>${i.latest ? esc(i.latest.title) : `<span class="dim">No request raised yet</span>`}</td>
          <td>${esc(i.latest ? nameOf(i.latest.assigned_to) : "—")}</td>
          <td class="num">${i.openTasks}</td>
          <td>${i.blockers.length ? `<span class="late">${esc(i.blockers[0].description)}</span>${i.blockers.length > 1 ? `<small>+${i.blockers.length - 1} more</small>` : ""}` : `<span class="dim">—</span>`}</td>
          <td><small>${fmtDT(i.updated)}</small></td>
          <td><div class="row-actions"><button class="btn sm" data-act="timeline" data-id="${i.show.id}">Timeline</button>${isStaff() ? `<button class="btn sm" data-act="edit-show" data-id="${i.show.id}">Edit</button>` : ""}</div></td>
        </tr>`).join("")}</tbody></table></div>` : `<div class="empty">No shows match.${isStaff() ? " Use “Add show” to create one." : ""}</div>`;
    };
    S.redraw();
  };

  // 9.3 Raise Request
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
            <input id="r_show" type="text" list="r_shows" placeholder="Start typing a show…" required autocomplete="off">
            <datalist id="r_shows">${shows.map((x) => `<option value="${esc(x.name)}"></option>`).join("")}</datalist></div>
          <div><label for="r_to">Assign to ${writer ? "<small>(set by Ops)</small>" : ""}</label>
            <select id="r_to" ${writer ? "disabled" : ""}><option value="">Unassigned</option>${members().map((p) => `<option value="${p.id}">${esc(p.full_name)}</option>`).join("")}</select></div>
          <div class="full"><label for="r_title">Task / requirement *</label><textarea id="r_title" required placeholder="e.g. 1900-2000 LS, Audio Gen Book 3, 1-100 AI-Friendly Scripts…" style="min-height:70px"></textarea></div>
          <div><label for="r_hml">Priority ${mgr ? "" : "<small>(set by Manager)</small>"}</label>
            <select id="r_hml" ${mgr ? "" : "disabled"}><option>Low</option><option>Medium</option><option>High</option></select></div>
          <div><label for="r_p">P0 / P1 / P2 ${mgr ? "" : "<small>(set by Manager)</small>"}</label>
            <select id="r_p" ${mgr ? "" : "disabled"}><option>P2</option><option>P1</option><option>P0</option></select></div>
          <div><label for="r_high">High priority flag ${mgr ? "" : "<small>(set by Manager)</small>"}</label>
            <select id="r_high" ${mgr ? "" : "disabled"}><option value="false">No</option><option value="true">Yes</option></select></div>
          <div><label for="r_dl">Deadline</label><input id="r_dl" type="date"></div>
          <div class="full"><label for="r_det">Additional details</label><textarea id="r_det" placeholder="Optional context, links or notes…"></textarea></div>
          <div class="full"><button class="btn primary" type="submit" ${writer && !open ? "disabled" : ""}>Submit request</button><div class="form-error" id="rErr"></div></div>
        </form>
      </div>`;
    $("#rf").onsubmit = async (e) => {
      e.preventDefault();
      const name = $("#r_show").value.trim();
      const sh = shows.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!sh) { $("#rErr").textContent = "Pick a show from the list (it must already exist and be approved)."; return; }
      const row = { show_id: sh.id, title: $("#r_title").value.trim(), details: $("#r_det").value.trim() || null, deadline: $("#r_dl").value || null };
      if (!writer) row.assigned_to = $("#r_to").value || null;
      if (mgr) Object.assign(row, { hml: $("#r_hml").value, p_level: $("#r_p").value, high_flag: $("#r_high").value === "true" });
      const btn = $("#rf button[type=submit]"); btn.disabled = true;
      const { error } = await sb.from("tasks").insert(row);
      btn.disabled = false;
      if (error) { $("#rErr").textContent = friendly(error); return; }
      toast(`Request raised for ${sh.name}`, "good");
      await loadAll();
      $("#rf").reset();
      $("#rErr").textContent = "";
      drawNav();
    };
  };

  // 9.4 Task Tracker
  PAGE_FN.tracker = (main) => {
    const f = S.f.tracker;
    main.innerHTML = header("Task Tracker", "Every task. Assign, reassign, update status and reopen completed tasks.") + `
      <div class="card">
        <div class="bar">
          <div class="grow"><input type="search" id="tq" placeholder="Search task or show…" value="${esc(f.q)}" aria-label="Search"></div>
          <select id="tp" aria-label="Person"><option value="">All people</option><option value="none" ${f.person === "none" ? "selected" : ""}>Unassigned</option>${members().map((p) => `<option value="${p.id}" ${f.person === p.id ? "selected" : ""}>${esc(p.full_name)}</option>`).join("")}</select>
          <select id="ts" aria-label="Status"><option value="">All statuses</option><option value="open" ${f.status === "open" ? "selected" : ""}>All open</option>${STATUSES.map((s) => `<option ${f.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>
          <select id="tl" aria-label="P level"><option value="">All P levels</option>${["P0", "P1", "P2"].map((p) => `<option ${f.p === p ? "selected" : ""}>${p}</option>`).join("")}</select>
          <select id="tx" aria-label="Quick filter"><option value="">Any deadline</option><option value="overdue" ${f.special === "overdue" ? "selected" : ""}>Overdue</option><option value="today" ${f.special === "today" ? "selected" : ""}>Due today</option><option value="high" ${f.special === "high" ? "selected" : ""}>High priority</option></select>
        </div>
        ${bulkBar()}
        <div id="results"></div>
      </div>`;
    const bind = (id, key) => { $(id).oninput = $(id).onchange = (e) => { f[key] = e.target.value; S.redraw(); }; };
    bind("#tq", "q"); bind("#tp", "person"); bind("#ts", "status"); bind("#tl", "p"); bind("#tx", "special");
    const upd = wireBulk(main);
    S.redraw = () => {
      const q = f.q.toLowerCase();
      const list = S.tasks.filter((t) =>
        (!q || t.title.toLowerCase().includes(q) || showName(t.show_id).toLowerCase().includes(q)) &&
        (!f.person || (f.person === "none" ? !t.assigned_to : t.assigned_to === f.person)) &&
        (!f.status || (f.status === "open" ? isOpen(t) : t.status === f.status)) &&
        (!f.p || t.p_level === f.p) &&
        (!f.special || (f.special === "overdue" ? isOverdue(t) : f.special === "today" ? isDueToday(t) : isHigh(t)))
      ).sort(prioritySort);
      for (const id of [...S.selected]) if (!list.some((t) => t.id === id)) S.selected.delete(id);
      $("#results").innerHTML = `<p class="dim" style="margin:0 0 6px">${list.length} task(s)</p>` + taskTable(list, { selectable: true, empty: "No tasks match these filters." });
      upd && upd();
    };
    S.redraw();
  };

  // 9.5 Team Workload
  PAGE_FN.workload = (main) => {
    const f = S.f.workload;
    main.innerHTML = header("Team Workload", "Pick a person to see their queue, then reassign one or many tasks.") + `
      <div class="kpis" id="wk"></div>
      <div class="people" id="ppl"></div>
      <div class="card">
        <div class="bar">
          <select id="wp" aria-label="Person"></select>
          <div class="grow"><input type="search" id="wq" placeholder="Search their tasks…" value="${esc(f.q)}" aria-label="Search"></div>
        </div>
        ${bulkBar()}
        <div id="results"></div>
      </div>`;
    $("#wq").oninput = (e) => { f.q = e.target.value; S.redraw(); };
    $("#wp").onchange = (e) => { f.person = e.target.value; S.selected.clear(); S.redraw(); };
    $("#ppl").onclick = (e) => { const b = e.target.closest("[data-person]"); if (b) { f.person = f.person === b.dataset.person ? "" : b.dataset.person; S.selected.clear(); S.redraw(); } };
    const upd = wireBulk(main);
    S.redraw = () => {
      const open = S.tasks.filter(isOpen);
      const ppl = members();
      $("#wk").innerHTML = [["People", ppl.length], ["Open tasks", open.length], ["Unassigned", open.filter((t) => !t.assigned_to).length], ["High priority", open.filter(isHigh).length], ["Blocked", open.filter((t) => t.status === "Blocked").length], ["Completed", S.tasks.length - open.length]]
        .map(([l, n]) => `<div class="kpi" style="cursor:default"><span>${l}</span><b>${n}</b></div>`).join("");
      const max = Math.max(1, ...ppl.map((p) => open.filter((t) => t.assigned_to === p.id).length));
      $("#ppl").innerHTML = ppl.map((p) => {
        const mine = open.filter((t) => t.assigned_to === p.id);
        const late = mine.filter(isOverdue).length;
        return `<button type="button" class="person ${f.person === p.id ? "on" : ""}" data-person="${p.id}">${avatar(p.id, p.full_name)}<span style="flex:1;min-width:0"><b>${esc(p.full_name)}</b><small>${mine.length} open${late ? ` · <span class="late">${late} overdue</span>` : ""}</small><div class="loadbar"><span style="width:${(mine.length / max) * 100}%"></span></div></span></button>`;
      }).join("");
      $("#wp").innerHTML = `<option value="">All team (open tasks)</option><option value="none" ${f.person === "none" ? "selected" : ""}>Unassigned</option>` +
        ppl.map((p) => `<option value="${p.id}" ${f.person === p.id ? "selected" : ""}>${esc(p.full_name)}</option>`).join("");
      const q = f.q.toLowerCase();
      const list = open.filter((t) =>
        (!f.person || (f.person === "none" ? !t.assigned_to : t.assigned_to === f.person)) &&
        (!q || t.title.toLowerCase().includes(q) || showName(t.show_id).toLowerCase().includes(q))
      ).sort(prioritySort);
      $("#results").innerHTML = taskTable(list, { selectable: true, inlineAssign: true, empty: "No open tasks for this selection." });
      upd && upd();
    };
    S.redraw();
  };

  // 9.6 Blockers / Issues
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
          return `<tr><td>${esc(showName(i.show_id))}</td><td>${t ? esc(t.title) : '<span class="dim">—</span>'}</td><td><b>${esc(i.description)}</b></td><td>${sevPill(i.severity)}</td>
            <td>${can(i) ? `<select data-act="issue-status" data-id="${i.id}" aria-label="Status">${["Open", "Investigating", "Resolved"].map((s) => `<option ${s === i.status ? "selected" : ""}>${s}</option>`).join("")}</select>` : statusPill(i.status)}</td>
            <td>${esc(nameOf(i.raised_by))}</td><td>${esc(nameOf(i.owner))}</td><td><small>${fmtDT(i.created_at)}</small></td>
            <td>${can(i) ? `<button class="btn sm" data-act="edit-issue" data-id="${i.id}">Edit</button>` : ""}</td></tr>`;
        }).join("")}</tbody></table></div>` : `<div class="empty">No blockers here. 🎉</div>`;
    };
    S.redraw();
  };

  // 9.7 Show Status & Timeline
  PAGE_FN.status = (main) => {
    main.innerHTML = header("Show Status & Timeline", "Each show once, most recently active first. Open a timeline to see its full history.") + `<div class="card"><div id="results"></div></div>`;
    S.redraw = () => {
      const list = S.shows.map(showInfo).sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0) || a.show.name.localeCompare(b.show.name));
      $("#results").innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th>Show</th><th>Type</th><th>Status</th><th>Latest task</th><th>Owner</th><th>Blocker</th><th>Updated</th><th></th></tr></thead><tbody>
        ${list.map((i) => `<tr><td><b>${esc(i.show.name)}</b></td><td>${pill(i.show.type)}</td><td>${statusPill(i.status)}</td>
          <td>${i.latest ? esc(i.latest.title) : '<span class="dim">No request raised yet</span>'}</td><td>${esc(i.latest ? nameOf(i.latest.assigned_to) : "—")}</td>
          <td>${i.blockers.length ? `<span class="late">${esc(i.blockers[0].description)}</span>` : '<span class="dim">—</span>'}</td>
          <td><small>${fmtDT(i.updated)}</small></td><td><button class="btn sm" data-act="timeline" data-id="${i.show.id}">View timeline</button></td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty">No shows yet.</div>`;
    };
    S.redraw();
  };

  // 9.8 My Tasks
  PAGE_FN.mytasks = (main) => {
    const f = S.f.mytasks;
    main.innerHTML = header("My Tasks", "Your queue, sorted by High flag → P0/P1/P2 → H/M/L → deadline. Completed tasks sit at the bottom.") + `
      <div class="card"><div class="bar"><select id="mf" aria-label="Filter">${[["", "All"], ["high", "High priority"], ["P0", "P0"], ["P1", "P1"], ["P2", "P2"], ["today", "Due today"], ["overdue", "Overdue"]].map(([v, l]) => `<option value="${v}" ${f.filter === v ? "selected" : ""}>${l}</option>`).join("")}</select></div><div id="results"></div></div>`;
    $("#mf").onchange = (e) => { f.filter = e.target.value; S.redraw(); };
    S.redraw = () => {
      const x = f.filter;
      const list = S.tasks.filter((t) => t.assigned_to === S.me.id &&
        (!x || (x === "high" ? isHigh(t) : x === "today" ? isDueToday(t) : x === "overdue" ? isOverdue(t) : t.p_level === x))).sort(prioritySort);
      $("#results").innerHTML = taskTable(list, { hidePerson: true, empty: "Nothing assigned to you here. Tasks appear automatically when someone assigns them to you." });
    };
    S.redraw();
  };

  // 9.9 Activity Log
  PAGE_FN.log = (main) => {
    const f = S.f.log;
    main.innerHTML = header("Activity Log", "Every change is recorded automatically and can't be edited. Showing the latest 500 events.") + `
      <div class="card"><div class="bar"><div class="grow"><input type="search" id="lq" placeholder="Search by person, action, show or details…" value="${esc(f.q)}" aria-label="Search"></div></div><div id="results"></div></div>`;
    $("#lq").oninput = (e) => { f.q = e.target.value; S.redraw(); };
    S.redraw = () => {
      const q = f.q.toLowerCase();
      const list = S.log.filter((l) => !q || [nameOf(l.user_id), l.action, showName(l.show_id), l.details].join(" ").toLowerCase().includes(q));
      $("#results").innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Show</th><th>Details</th></tr></thead><tbody>
        ${list.map((l) => `<tr><td class="num"><small>${fmtDT(l.created_at)}</small></td><td>${esc(l.user_id ? nameOf(l.user_id) : "System")}</td><td><b>${esc(l.action)}</b></td><td>${esc(l.show_id ? showName(l.show_id) : "—")}</td><td>${esc(l.details || "")}</td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty">No matching activity.</div>`;
    };
    S.redraw();
  };

  // 9.10 Team & Settings (Manager only)
  PAGE_FN.team = (main) => {
    const s = S.settings;
    main.innerHTML = header("Team & Settings", "Approve new sign-ups, set roles, and change the request window.") + `
      <div class="card" style="margin-bottom:16px"><h2>People</h2><div id="results"></div>
        <p class="hint"><b>Writer</b>: raises requests inside the window. <b>Ops</b>: assigns, reassigns, updates tasks and adds shows. <b>Manager</b>: everything, including priority, roles and settings. <b>Pending</b>: can't see anything yet.</p></div>
      <div class="card"><h2>Request window</h2>
        <form class="form" id="setf" style="max-width:640px">
          <div><label for="s_start">Opens at</label><input id="s_start" type="time" value="${hm(s.request_start)}" required></div>
          <div><label for="s_end">Closes at</label><input id="s_end" type="time" value="${hm(s.request_end)}" required></div>
          <div class="full"><label for="s_tz">Time zone</label><input id="s_tz" type="text" value="${esc(s.timezone)}" required><small class="dim">e.g. Asia/Kolkata, Europe/London</small></div>
          <div class="full"><button class="btn primary" type="submit">Save settings</button></div>
        </form></div>`;
    $("#setf").onsubmit = (e) => {
      e.preventDefault();
      const tzv = $("#s_tz").value.trim();
      try { new Intl.DateTimeFormat("en", { timeZone: tzv }); } catch { return toast("That time zone isn't recognised. Try Asia/Kolkata.", "bad"); }
      save(sb.from("settings").update({ request_start: $("#s_start").value, request_end: $("#s_end").value, timezone: tzv }).eq("id", 1), "Settings saved");
    };
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
    };
    S.redraw();
  };

  // ---------- 10. Pop-up forms ----------
  function taskModal(t) {
    if (!t) return;
    const mgr = isManager();
    const opt = (list, cur) => list.map((v) => `<option ${v === cur ? "selected" : ""}>${v}</option>`).join("");
    openModal("Edit task", `<form id="tf">
      <div class="form">
        <div class="full"><label for="e_show">Show</label><select id="e_show">${S.shows.slice().sort((a, b) => a.name.localeCompare(b.name)).map((x) => `<option value="${x.id}" ${x.id === t.show_id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
        <div class="full"><label for="e_title">Task</label><input id="e_title" type="text" value="${esc(t.title)}" required></div>
        <div><label for="e_to">Assigned to</label><select id="e_to"><option value="">Unassigned</option>${members().map((p) => `<option value="${p.id}" ${p.id === t.assigned_to ? "selected" : ""}>${esc(p.full_name)}</option>`).join("")}</select></div>
        <div><label for="e_st">Status</label><select id="e_st">${opt(STATUSES, t.status)}</select></div>
        <div><label for="e_hml">Priority ${mgr ? "" : "<small>(Manager)</small>"}</label><select id="e_hml" ${mgr ? "" : "disabled"}>${opt(["High", "Medium", "Low"], t.hml)}</select></div>
        <div><label for="e_p">P level ${mgr ? "" : "<small>(Manager)</small>"}</label><select id="e_p" ${mgr ? "" : "disabled"}>${opt(["P0", "P1", "P2"], t.p_level)}</select></div>
        <div><label for="e_high">High flag ${mgr ? "" : "<small>(Manager)</small>"}</label><select id="e_high" ${mgr ? "" : "disabled"}><option value="false">No</option><option value="true" ${t.high_flag ? "selected" : ""}>Yes</option></select></div>
        <div><label for="e_dl">Deadline</label><input id="e_dl" type="date" value="${t.deadline || ""}"></div>
        <div class="full"><label for="e_det">Details</label><textarea id="e_det">${esc(t.details || "")}</textarea></div>
      </div>
      <p class="hint">Raised by ${esc(nameOf(t.raised_by))} on ${fmtDT(t.created_at)}${t.completed_at ? ` · Completed ${fmtDT(t.completed_at)}` : ""}</p>
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
        if (mgr) Object.assign(patch, { hml: $("#e_hml", m).value, p_level: $("#e_p", m).value, high_flag: $("#e_high", m).value === "true" });
        if (await save(sb.from("tasks").update(patch).eq("id", t.id), "Task saved")) closeModal();
      };
      const del = $("#e_del", m);
      if (del) del.onclick = async () => {
        if (del.dataset.sure !== "1") { del.dataset.sure = "1"; del.textContent = "Click again to delete for good"; del.classList.add("danger"); return; }
        if (await save(sb.from("tasks").delete().eq("id", t.id), "Task deleted")) closeModal();
      };
    });
  }

  function showModal(sh) {
    const isNew = !sh;
    openModal(isNew ? "Add show" : "Edit show", `<form id="sf">
      <div class="field"><label for="h_name">Show name</label><input id="h_name" type="text" value="${esc(sh?.name || "")}" required></div>
      <div class="field"><label for="h_type">Type</label><select id="h_type">${["EU", "UK", "Other"].map((t) => `<option ${t === (sh?.type || "Other") ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div class="field"><label><input type="checkbox" id="h_ok" ${sh?.approved === false ? "" : "checked"}> Approved (writers can raise requests for it)</label></div>
      <div class="modal-foot">
        ${!isNew && isManager() ? `<button type="button" class="btn ghost-danger left" id="h_del">Delete show</button>` : ""}
        <button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">${isNew ? "Add show" : "Save"}</button>
      </div></form>`, (m) => {
      $("#sf", m).onsubmit = async (e) => {
        e.preventDefault();
        const row = { name: $("#h_name", m).value.trim(), type: $("#h_type", m).value, approved: $("#h_ok", m).checked };
        const req = isNew ? sb.from("shows").insert(row) : sb.from("shows").update(row).eq("id", sh.id);
        if (await save(req, isNew ? `Show “${row.name}” added` : "Show saved")) closeModal();
      };
      const del = $("#h_del", m);
      if (del) del.onclick = async () => {
        if (del.dataset.sure !== "1") { del.dataset.sure = "1"; del.textContent = "Click again: this also deletes its tasks"; del.classList.add("danger"); return; }
        if (await save(sb.from("shows").delete().eq("id", sh.id), "Show deleted")) closeModal();
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
        const ts = S.tasks.filter((t) => t.show_id === sid).sort(newestFirst);
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
    openModal(`Timeline · ${sh.name}`, `<p>${statusPill(info.status)} · ${info.openTasks} open task(s) · ${info.blockers.length} open blocker(s)</p><div id="tlBody" class="dim">Loading…</div>`);
    const { data, error } = await sb.from("activity_log").select("*").eq("show_id", showId).order("id", { ascending: false }).limit(300);
    const body = $("#tlBody");
    if (!body) return;
    if (error) { body.textContent = friendly(error); return; }
    body.className = "";
    body.innerHTML = data.length ? `<ul class="tl">${data.map((l) => `<li class="${/Blocker Raised|Blocked/.test(l.action) ? "bad" : /Completed|Resolved/.test(l.action) ? "good" : ""}"><b>${esc(l.action)}</b> · ${esc(l.details || "")}<small>${esc(l.user_id ? nameOf(l.user_id) : "System")} · ${fmtDT(l.created_at)}</small></li>`).join("")}</ul>` : `<div class="empty">No history yet.</div>`;
  }

  // ---------- Go! ----------
  boot();
})();
