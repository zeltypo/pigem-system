var currentAdmin = null;
var adminApps = [];
var adminUsers = [];
var adminNotifs = [];
var activeAdminTab = "overview";
var activeAccountSubTab = "all";
var activeLogSubTab = "activity";
var activeReportSubTab = "api";
var lastHealthData = null;
var lastApiReportRows = [];

window.openDashTabById = function (tabId, targetId) {
  var clean = String(tabId || "").replace(/^tab-/, "");
  if (clean) showTab(clean);
  if (clean === "accounts" && typeof setAccountSubTab === "function") {
    if (String(targetId || "").indexOf("reset") !== -1 || adminNotifs.some(function (n) { return String(n.title || "").toLowerCase().indexOf("password reset") !== -1; })) {
      setAccountSubTab("requests");
    }
  }
};

window.PORTAL_ALLOWED_ROLES = ["admin"];

window.addEventListener("DOMContentLoaded", async function () {
  currentAdmin = await requireLogin(["admin"]);
  if (!currentAdmin) return;

  var topNameEl = document.getElementById("top-user-name");
  if (topNameEl) topNameEl.textContent = currentAdmin.full_name;
  var dEl = document.getElementById("rep-date");
  var mEl = document.getElementById("rep-month");
  if (dEl && !dEl.value) dEl.value = getLocalTodayIso();
  if (mEl && !mEl.value) mEl.value = getLocalMonthIso();

  populateReportStatusFilter("api");
  await refreshAdminData();
  initDashUI(currentAdmin, adminApps, function () { showTab("reports"); });
});

async function refreshAdminData() {
  adminApps = await dbListAllApplications();
  adminUsers = await dbListUsers();
  adminNotifs = await dbListMyNotifications(currentAdmin);
  updateDashSearchApps(adminApps);

  var aiOn = isAiEnabled();
  var maintOn = isMaintenanceOn();

  document.getElementById("st-users").textContent = adminUsers.length;
  document.getElementById("st-apps").textContent = adminApps.length;
  document.getElementById("st-ai").textContent = aiOn ? "ON" : "OFF";
  document.getElementById("st-maint").textContent = maintOn ? "ON" : "OFF";

  var rCounts = { customer: 0, agent: 0, manager: 0, admin: 0 };
  for (var i = 0; i < adminUsers.length; i++) {
    var r = adminUsers[i].role || "customer";
    rCounts[r] = (rCounts[r] || 0) + 1;
  }

  var pending = 0, fix = 0, approved = 0, rejected = 0;
  for (var j = 0; j < adminApps.length; j++) {
    var st = adminApps[j].status;
    if (st === "Pending Review" || st === "Under Agent Review" || st === "Encoding") pending++;
    else if (st === "Needs Correction") fix++;
    else if (st === "Approved" || st === "Submitted to Provider") approved++;
    else if (st === "Rejected") rejected++;
  }

  if (typeof renderPieChart === "function") {
    renderPieChart("chart-admin-role-pie", [
      { label: "Customers", value: rCounts.customer, color: "#64748b" },
      { label: "Agents", value: rCounts.agent, color: "#2563eb" },
      { label: "Managers", value: rCounts.manager, color: "#d97706" },
      { label: "Admin", value: rCounts.admin, color: "#c8102e" }
    ], "Accounts");

    renderPieChart("chart-admin-app-pie", [
      { label: "Pending / Encoding", value: pending, color: "#2563eb" },
      { label: "Needs Correction", value: fix, color: "#d97706" },
      { label: "Approved", value: approved, color: "#15803d" },
      { label: "Rejected", value: rejected, color: "#dc2626" }
    ], "Apps");
  }

  renderBars("chart-admin-bars", [
    { label: "Customers", value: rCounts.customer, color: "#64748b" },
    { label: "Agents", value: rCounts.agent, color: "#2563eb" },
    { label: "Managers", value: rCounts.manager, color: "#d97706" },
    { label: "Admins", value: rCounts.admin, color: "#c8102e" }
  ]);
  renderBars("chart-admin-app-bars", [
    { label: "Pending / Encoding", value: pending, color: "#2563eb" },
    { label: "Needs Correction", value: fix, color: "#d97706" },
    { label: "Approved", value: approved, color: "#15803d" },
    { label: "Rejected", value: rejected, color: "#dc2626" }
  ]);

  renderCalendar("admin-overview-calendar", adminApps);
  renderCalendar("admin-full-calendar", adminApps);

  renderMaintState();
  await renderAiState();
  await checkApiHealth();
  renderAdminUsers();
  await renderAdminLogs();
  renderAdminReport();
}

function showTab(tab) {
  activeAdminTab = tab;
  var tabs = ["overview", "maintenance", "ai", "apis", "accounts", "logs", "calendar", "reports"];
  for (var i = 0; i < tabs.length; i++) {
    var btn = document.getElementById("nav-" + tabs[i]);
    if (btn) btn.classList.toggle("active", tabs[i] === tab);
    var sec = document.getElementById("tab-" + tabs[i]);
    if (sec) sec.classList.toggle("hidden", tabs[i] !== tab);
  }
  if (typeof updateOverviewOnlyVisibility === "function") {
    updateOverviewOnlyVisibility(tab === "overview");
  }
}

function renderMaintState() {
  var on = isMaintenanceOn();
  var lbl = document.getElementById("maint-status-label");
  var btn = document.getElementById("btn-toggle-maint");
  if (lbl) lbl.textContent = on ? "Currently ON (Public application submissions are paused)" : "Currently OFF (Public website is accepting applications)";
  if (btn) {
    btn.textContent = on ? "Disable Maintenance Mode" : "Enable Maintenance Mode";
    btn.className = "btn " + (on ? "btn-green" : "btn-red");
  }
}

function toggleMaintMode() {
  var next = !isMaintenanceOn();
  openConfirmPopup(
    next ? "Confirm Enabling Public Maintenance Mode" : "Confirm Returning Public Website to Live",
    next
      ? "Mutating <code>public.system_settings.maintenance_mode = true</code> will temporarily block external customer access to <code>index.html</code>, <code>apply.html</code>, and <code>activate.html</code> while keeping staff/admin portals operational."
      : "Mutating <code>public.system_settings.maintenance_mode = false</code> will immediately restore public visitor access to the live website and application form.",
    next ? "Enable Maintenance Mode" : "Disable Maintenance Mode",
    async function () {
      setMaintenanceOn(next);
      await dbAddLog(getStaffIdentifier(currentAdmin), "Set Maintenance Mode to " + (next ? "ON" : "OFF"));
      var maintTitle = next ? "Website Maintenance Mode Enabled" : "Website Restored to Live";
      var maintBody = next
        ? "System Administrator enabled public Maintenance Mode. Public application submissions are temporarily paused while internal dashboards remain operational."
        : "System Administrator disabled public Maintenance Mode. Public website and Customer application form are now live.";
      await dbAddNotification(null, "agent", maintTitle, maintBody);
      await dbAddNotification(null, "manager", maintTitle, maintBody);
      await refreshAdminData();
    },
    next
  );
}

async function renderAiState() {
  var on = isAiEnabled();
  var health = await apiCheckHealth();
  lastHealthData = health;
  var pyOnline = Boolean(health && health.api);
  var geminiOnline = Boolean(health && health.gemini);
  var opencvOnline = Boolean(health && health.opencv);

  var stAiEl = document.getElementById("st-ai");
  if (stAiEl) {
    stAiEl.textContent = (!on) ? "PAUSED" : ((pyOnline && geminiOnline) ? "ONLINE" : "CHECK");
  }

  var lbl = document.getElementById("ai-status-label");
  var btn = document.getElementById("btn-toggle-ai");
  if (lbl) {
    if (!on) {
      lbl.textContent = "Currently DISABLED by Admin (Agent and Manager workspaces switch cleanly to manual document review)";
    } else if (!pyOnline) {
      lbl.textContent = "Cloud FastAPI Serverless Screening Endpoint (/api) is currently unreachable - manual agent review is active.";
    } else if (!geminiOnline) {
      lbl.textContent = "FastAPI Serverless is ONLINE, awaiting GEMINI_API_KEY in Vercel Environment Variables - manual agent review is active.";
    } else {
      lbl.textContent = "Cloud AI Screening Engine ONLINE (Vercel FastAPI Serverless + " + (opencvOnline ? "OpenCV Auto-Crop + " : "") + "SHA-256 Duplicate Check + Google Gemini Vision OCR)";
    }
  }
  if (btn) {
    btn.textContent = on ? "Disable AI Screening" : "Enable AI Screening";
    btn.className = "btn " + (on ? "btn-red" : "btn-green");
  }

  var aiList = await dbListAiLogs();
  var box = document.getElementById("admin-ai-log-list");
  if (!box) return;
  if (aiList.length === 0) {
    box.innerHTML = '<div class="muted" style="font-size:13px">No AI screening logs recorded yet.</div>';
    return;
  }
  var html = "";
  for (var i = 0; i < Math.min(aiList.length, 20); i++) {
    var item = aiList[i];
    html +=
      '<div class="chat-item ai">' +
        '<div class="who">' + escapeHtml(item.reference_no || "") + ' - ' + escapeHtml(item.actor) + ' <span class="muted" style="font-weight:400">(' + formatDate(item.created_at) + ')</span></div>' +
        '<div>' + escapeHtml(item.message) + '</div>' +
      '</div>';
  }
  box.innerHTML = html;
}

function toggleAiMode() {
  var next = !isAiEnabled();
  openConfirmPopup(
    next ? "Enable Cloud AI Document Screening Engine?" : "Disable Cloud AI Document Screening Engine?",
    next
      ? "Enabling <code>public.system_settings.ai_enabled = true</code> resumes cloud OpenCV + Google Gemini Vision requirements screening via <code>POST /api/screen-async</code>."
      : "Disabling <code>public.system_settings.ai_enabled = false</code> pauses automated screening. Customer submissions will continue without interruption using original uploaded ID copies, and all Agents and Managers will receive a manual-review notification.",
    next ? "Enable AI Screening" : "Disable AI Screening",
    async function () {
      setAiEnabled(next);
      await dbAddLog(getStaffIdentifier(currentAdmin), "Set AI Screening Engine to " + (next ? "ENABLED" : "DISABLED"));
      if (!next) {
        await dbAddNotification(null, "agent", "Auto-Screening Paused", "System Administrator paused automated document screening. Customer applications continue normally using original uploaded ID copies for manual review.");
        await dbAddNotification(null, "manager", "Auto-Screening Paused", "System Administrator paused automated document screening. Customer applications continue normally using original uploaded ID copies for manual review.");
      } else {
        await dbAddNotification(null, "agent", "Auto-Screening Active", "System Administrator re-enabled automated document screening for new and updated applications.");
        await dbAddNotification(null, "manager", "Auto-Screening Active", "System Administrator re-enabled automated document screening for new and updated applications.");
      }
      await refreshAdminData();
    },
    !next
  );
}

async function checkApiHealth() {
  var box = document.getElementById("api-health-list");
  var data = await apiCheckHealth();
  var pyOk = Boolean(data && data.api);
  var geminiOk = Boolean(pyOk && data && data.gemini);
  var opencvOk = Boolean(pyOk && data && data.opencv);
  var recaptchaOk = Boolean(pyOk && data && data.recaptcha);
  var smtpOk = Boolean(pyOk && data && data.smtp);
  var locationIqOk = Boolean(CONFIG.LOCATIONIQ_API_KEY);
  var supaOk = !IS_DEMO_MODE;

  var smtpBadgeEl = document.getElementById("smtp-status-badge");
  if (smtpBadgeEl) {
    smtpBadgeEl.className = "badge " + (smtpOk ? "badge-green" : "badge-red");
    smtpBadgeEl.textContent = smtpOk ? "Gmail SMTP Connected" : (pyOk ? "SMTP Env Missing" : "Endpoint Unreachable");
  }

  var nowIso = new Date().toISOString();
  var items = [
    {
      name: "Vercel Python FastAPI Serverless (/api)",
      status: pyOk ? "Online (Cloud)" : "Unreachable",
      badge: pyOk ? "badge-green" : "badge-red",
      healthy: pyOk,
      checked_at: nowIso,
      detail: pyOk
        ? "Serving /api/health, /api/screen, /api/screen-async, /api/verify-captcha, /api/notify, and /api/polite-remark"
        : "Check Vercel deployment logs for api/index.py"
    },
    {
      name: "Google Gemini Vision and AI API",
      status: geminiOk ? "Online (Configured)" : "Key Missing",
      badge: geminiOk ? "badge-green" : "badge-yellow",
      healthy: geminiOk,
      checked_at: nowIso,
      detail: geminiOk
        ? "Performs Valid ID Vision OCR extraction, non-ID rejection, and polite customer remarks"
        : "Add GEMINI_API_KEY in Vercel Environment Variables to activate Vision OCR"
    },
    {
      name: "OpenCV Readability and 4-Corner Auto-Crop",
      status: opencvOk ? "Online" : "Unavailable",
      badge: opencvOk ? "badge-green" : "badge-red",
      healthy: opencvOk,
      checked_at: nowIso,
      detail: opencvOk
        ? "Evaluates blur, brightness, glare, contrast, SHA-256 duplicate check, and saves cropped copy"
        : "Requires opencv-python-headless in Vercel Python runtime"
    },
    {
      name: "Google reCAPTCHA v2 Security (SiteVerify)",
      status: recaptchaOk ? "Protected" : "Client Key Only",
      badge: recaptchaOk ? "badge-green" : "badge-yellow",
      healthy: recaptchaOk,
      checked_at: nowIso,
      detail: recaptchaOk
        ? "Checkbox Site Key active with server-side SiteVerify secret validation"
        : "Add RECAPTCHA_SECRET_KEY in Vercel Environment Variables for server-side validation"
    },
    {
      name: "LocationIQ + OpenStreetMap Geocoding",
      status: locationIqOk ? "Online (Dual-Source)" : "Fallback Only",
      badge: locationIqOk ? "badge-green" : "badge-yellow",
      healthy: locationIqOk,
      checked_at: nowIso,
      detail: locationIqOk
        ? "Primary LocationIQ geocoding with automatic Nominatim fallback on Leaflet.js map"
        : "Using OpenStreetMap Nominatim reverse geocoding"
    },
    {
      name: "PIGEM Support Services Email Engine",
      status: smtpOk ? "Online" : (pyOk ? "Env Missing" : "Unreachable"),
      badge: smtpOk ? "badge-green" : "badge-red",
      healthy: smtpOk,
      checked_at: nowIso,
      detail: smtpOk
        ? "Connected via /api/notify (Gmail SMTP Notification Engine)"
        : "Configure SMTP_USER and SMTP_PASSWORD in Vercel Environment Variables"
    },
    {
      name: "Supabase Cloud (PostgreSQL + Storage)",
      status: supaOk ? "Live Cloud" : "Demo Storage",
      badge: supaOk ? "badge-green" : "badge-blue",
      healthy: supaOk,
      checked_at: nowIso,
      detail: supaOk ? (CONFIG.SUPABASE_URL + " (documents + website-assets buckets)") : "Running in browser storage"
    }
  ];

  lastApiReportRows = items;
  if (!box) return;

  var html = "";
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    html +=
      '<div class="card" style="background:var(--soft)">' +
        '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px">' +
          '<b>' + escapeHtml(it.name) + '</b>' +
          '<span class="badge ' + it.badge + '">' + escapeHtml(it.status) + '</span>' +
        '</div>' +
        '<div class="muted" style="font-size:12px">' + escapeHtml(it.detail) + '</div>' +
      '</div>';
  }
  box.innerHTML = html;
}

function getPasswordResetRequests() {
  return (adminNotifs || []).filter(function (n) {
    return !n.is_read && String(n.title || "").indexOf("Password Reset Request:") === 0;
  });
}

function setAccountSubTab(sub) {
  activeAccountSubTab = sub;
  var subs = ["all", "agent", "manager", "customer", "requests"];
  for (var i = 0; i < subs.length; i++) {
    var b = document.getElementById("acc-sub-" + subs[i]);
    if (b) b.classList.toggle("active", subs[i] === sub);
  }
  var isReq = sub === "requests";
  var tb = document.getElementById("acc-search-toolbar");
  var tp = document.getElementById("acc-table-panel");
  var rp = document.getElementById("acc-requests-panel");
  if (tb) tb.classList.toggle("hidden", isReq);
  if (tp) tp.classList.toggle("hidden", isReq);
  if (rp) rp.classList.toggle("hidden", !isReq);
  renderAdminUsers();
}

function renderAdminUsers() {
  var cntAll = adminUsers.length;
  var cntAg = adminUsers.filter(function (u) { return u.role === "agent"; }).length;
  var cntMgr = adminUsers.filter(function (u) { return u.role === "manager"; }).length;
  var cntCust = adminUsers.filter(function (u) { return u.role === "customer"; }).length;
  var reqs = getPasswordResetRequests();

  var cMap = { all: cntAll, agent: cntAg, manager: cntMgr, customer: cntCust, requests: reqs.length };
  Object.keys(cMap).forEach(function (k) {
    var el = document.getElementById("acc-cnt-" + k);
    if (el) el.textContent = cMap[k];
  });

  if (activeAccountSubTab === "requests") {
    var reqBody = document.getElementById("admin-reset-req-body");
    if (!reqBody) return;
    if (reqs.length === 0) {
      reqBody.innerHTML = '<tr><td colspan="4" class="muted">No staff password reset requests at this time.</td></tr>';
      return;
    }
    var rh = "";
    for (var rIdx = 0; rIdx < reqs.length; rIdx++) {
      var rq = reqs[rIdx];
      var uMatch = String(rq.title || "").match(/@([a-zA-Z0-9._-]+)/);
      var reqUname = uMatch ? uMatch[1].toLowerCase() : "";
      var matchedStaff = adminUsers.find(function (u) { return String(u.username || "").toLowerCase() === reqUname; });
      rh +=
        '<tr>' +
          '<td>' + formatDate(rq.created_at) + '</td>' +
          '<td><b>' + escapeHtml(rq.title) + '</b></td>' +
          '<td>' + escapeHtml(rq.message) + '</td>' +
          '<td>' +
            (matchedStaff
              ? '<button type="button" class="btn btn-red btn-sm" onclick="adminOpenResetPasswordModal(\'' + escapeHtml(matchedStaff.id) + '\', \'@' + escapeHtml(matchedStaff.username || matchedStaff.full_name) + '\')">Reset Password</button>'
              : '<span class="muted small">Account not found</span>') +
          '</td>' +
        '</tr>';
    }
    reqBody.innerHTML = rh;
    return;
  }

  var body = document.getElementById("admin-users-body");
  if (!body) return;
  var q = (document.getElementById("acc-search-input") ? document.getElementById("acc-search-input").value : "").trim().toLowerCase();

  var list = adminUsers.filter(function (u) {
    if (activeAccountSubTab !== "all" && u.role !== activeAccountSubTab) return false;
    if (!q) return true;
    var hay = [u.full_name, u.username, u.email, u.role].join(" ").toLowerCase();
    return hay.indexOf(q) !== -1;
  });

  if (list.length === 0) {
    body.innerHTML = '<tr><td colspan="6" class="muted">No accounts match this filter.</td></tr>';
    return;
  }

  var html = "";
  for (var i = 0; i < list.length; i++) {
    var u = list[i];
    var isSoleAdmin = (u.role === "admin");
    var isCustomer = (u.role === "customer");
    var roleCell = "";
    if (isSoleAdmin) {
      roleCell = '<span class="badge badge-red">Admin (Provisioned)</span>';
    } else if (isCustomer) {
      roleCell = '<span class="badge badge-gray">Customer (Gmail)</span>';
    } else {
      roleCell =
        '<select onchange="adminChangeRole(\'' + escapeHtml(u.id) + '\', this.value)" style="padding:4px 8px; font-size:12px; width:auto">' +
          '<option value="agent" ' + (u.role === "agent" ? "selected" : "") + '>Agent</option>' +
          '<option value="manager" ' + (u.role === "manager" ? "selected" : "") + '>Manager</option>' +
        '</select>';
    }

    var contactLabel = isCustomer
      ? escapeHtml(u.email || "-")
      : '<span class="muted">Internal (Username Only)</span>';

    var displayRef = "@" + (u.username || u.full_name || u.id);
    var actionBtns = '<div style="display:flex; gap:6px; flex-wrap:wrap">';
    if (!isCustomer) {
      actionBtns +=
        '<button type="button" class="btn btn-outline btn-sm" onclick="openEditStaffModal(\'' + escapeHtml(u.id) + '\')">Edit</button>' +
        '<button type="button" class="btn btn-outline btn-sm" onclick="adminOpenResetPasswordModal(\'' + escapeHtml(u.id) + '\', \'' + escapeHtml(displayRef) + '\')">Reset Password</button>';
    }
    if (!isSoleAdmin) {
      actionBtns +=
        '<button type="button" class="btn btn-outline btn-sm" onclick="adminToggleActive(\'' + escapeHtml(u.id) + '\', ' + (!u.active) + ')">' +
          (u.active ? "Disable" : "Enable") +
        '</button>' +
        '<button type="button" class="btn btn-outline btn-sm" style="color:var(--bad);border-color:#fecdca;" onclick="adminDeleteUser(\'' + escapeHtml(u.id) + '\', \'' + escapeHtml(u.full_name || displayRef) + '\')">Delete</button>';
    }
    actionBtns += '</div>';

    html +=
      '<tr>' +
        '<td><b>' + escapeHtml(u.full_name) + '</b></td>' +
        '<td><code>@' + escapeHtml(u.username || "-") + '</code></td>' +
        '<td>' + contactLabel + '</td>' +
        '<td>' + roleCell + '</td>' +
        '<td>' + (u.active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-red">Disabled</span>') + '</td>' +
        '<td>' + actionBtns + '</td>' +
      '</tr>';
  }
  body.innerHTML = html;
}

function openAddStaffModal(defaultRole) {
  var roleVal = defaultRole === "manager" ? "manager" : "agent";
  var title = roleVal === "manager" ? "Add Internal Manager Account" : "Add Internal Agent Account";
  openPopup(
    '<h3 style="margin-bottom:4px;">' + title + '</h3>' +
    '<p class="small muted">Internal staff accounts sign in using Username and Password only (no email required).</p>' +
    '<form class="mt" novalidate onsubmit="submitAddStaffModal(event)">' +
      '<div class="grid-3">' +
        '<div class="field"><label for="modal-acc-fname">First Name</label><input id="modal-acc-fname" type="text" placeholder="Maria" oninput="if(typeof clearFieldError===\'function\') clearFieldError(this)" /></div>' +
        '<div class="field"><label for="modal-acc-mname">Middle Name <span class="muted">(Optional)</span></label><input id="modal-acc-mname" type="text" placeholder="Optional" oninput="if(typeof clearFieldError===\'function\') clearFieldError(this)" /></div>' +
        '<div class="field"><label for="modal-acc-lname">Last Name</label><input id="modal-acc-lname" type="text" placeholder="Santos" oninput="if(typeof clearFieldError===\'function\') clearFieldError(this)" /></div>' +
      '</div>' +
      '<div class="grid-2">' +
        '<div class="field"><label for="modal-acc-username">Username</label><input id="modal-acc-username" type="text" minlength="3" maxlength="30" placeholder="maria_santos" oninput="if(typeof clearFieldError===\'function\') clearFieldError(this)" /></div>' +
        '<div class="field"><label for="modal-acc-role">Internal Role</label>' +
          '<select id="modal-acc-role">' +
            '<option value="agent" ' + (roleVal === "agent" ? "selected" : "") + '>Agent (Application Handling)</option>' +
            '<option value="manager" ' + (roleVal === "manager" ? "selected" : "") + '>Manager (Monitoring &amp; CMS)</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div class="field"><label for="modal-acc-pw">Password</label><input id="modal-acc-pw" type="password" data-pw-check="1" placeholder="Strong password (min 8 chars)" oninput="if(typeof clearFieldError===\'function\') clearFieldError(this)" /></div>' +
      '<div class="row mt-big" style="justify-content:flex-end; gap:8px;">' +
        '<button type="submit" id="btn-modal-add-staff" class="btn btn-red">+ Create Account</button>' +
      '</div>' +
    '</form>',
    { wide: true, showCloseX: true, closeOnBackdrop: true }
  );
}

async function submitAddStaffModal(event) {
  event.preventDefault();
  if (typeof clearAllFieldErrors === "function") clearAllFieldErrors();

  var fname = (document.getElementById("modal-acc-fname").value || "").trim();
  var mname = (document.getElementById("modal-acc-mname").value || "").trim();
  var lname = (document.getElementById("modal-acc-lname").value || "").trim();
  var username = (document.getElementById("modal-acc-username").value || "").trim().replace(/^@/, "");
  var role = document.getElementById("modal-acc-role").value;
  var pw = (document.getElementById("modal-acc-pw").value || "").trim();

  var cleanMid = (mname && mname.toUpperCase() !== "N/A") ? mname : "";
  var fChk = validatePersonName(fname, "First Name", false, false);
  var mChk = validatePersonName(cleanMid, "Middle Name", false, true);
  var lChk = validatePersonName(lname, "Last Name", false, false);
  var hasErr = false;
  if (!fChk.valid) { setFieldError("modal-acc-fname", fChk.message); hasErr = true; }
  if (!mChk.valid) { setFieldError("modal-acc-mname", mChk.message); hasErr = true; }
  if (!lChk.valid) { setFieldError("modal-acc-lname", lChk.message); hasErr = true; }
  if (!isValidUsername(username)) {
    setFieldError("modal-acc-username", "Username must be 3 to 30 characters using letters, numbers, dots (.), or underscores (_).");
    hasErr = true;
  }
  if (!isStrongPassword(pw)) {
    setFieldError("modal-acc-pw", PASSWORD_REQUIREMENT_TEXT);
    hasErr = true;
  }
  if (hasErr) return;

  var fullName = [fname, cleanMid, lname].filter(Boolean).join(" ");
  var btn = document.getElementById("btn-modal-add-staff");
  btn.disabled = true;
  btn.textContent = "Creating...";
  try {
    var created = await dbCreateUserAccount(fullName, null, pw, role, username);
    await dbAddLog(getStaffIdentifier(currentAdmin), "Created " + role + " account @" + created.username);
    closePopup();
    await refreshAdminData();
    showAlert("Staff Account Created", "Account for <b>" + escapeHtml(fullName) + "</b> (@" + escapeHtml(created.username) + " - " + role.toUpperCase() + ") is active.", "good");
  } catch (err) {
    var msg = err.message || "Could not create account.";
    if (msg.toLowerCase().indexOf("username") !== -1) setFieldError("modal-acc-username", msg);
    else setFieldError("modal-acc-pw", msg);
    btn.disabled = false;
    btn.textContent = "+ Create Account";
  }
}

function openEditStaffModal(userId) {
  var user = adminUsers.find(function (u) { return u.id === userId; });
  if (!user) return;
  var isAdminRow = user.role === "admin";
  openPopup(
    '<h3 style="margin-bottom:6px;">Edit Account (@' + escapeHtml(user.username || user.full_name) + ')</h3>' +
    '<form class="mt" novalidate onsubmit="submitEditStaffModal(event, \'' + escapeHtml(user.id) + '\')">' +
      '<div class="field"><label for="edit-acc-fullname">Full Name</label><input id="edit-acc-fullname" type="text" value="' + escapeHtml(user.full_name || "") + '" oninput="if(typeof clearFieldError===\'function\') clearFieldError(this)" /></div>' +
      '<div class="grid-2">' +
        '<div class="field"><label for="edit-acc-username">Username</label><input id="edit-acc-username" type="text" minlength="3" maxlength="30" value="' + escapeHtml(user.username || "") + '" oninput="if(typeof clearFieldError===\'function\') clearFieldError(this)" /></div>' +
        '<div class="field"><label for="edit-acc-role">Role</label>' +
          (isAdminRow
            ? '<input type="text" value="Admin (Provisioned)" readonly />'
            : '<select id="edit-acc-role">' +
                '<option value="agent" ' + (user.role === "agent" ? "selected" : "") + '>Agent</option>' +
                '<option value="manager" ' + (user.role === "manager" ? "selected" : "") + '>Manager</option>' +
              '</select>') +
        '</div>' +
      '</div>' +
      '<div class="field"><label for="edit-acc-pw">New Password (Optional - leave blank to keep current)</label><input id="edit-acc-pw" type="password" data-pw-check="1" placeholder="Leave blank if unchanged" oninput="if(typeof clearFieldError===\'function\') clearFieldError(this)" /></div>' +
      '<div class="row mt-big" style="justify-content:flex-end; gap:8px;">' +
        '<button type="submit" id="btn-modal-edit-staff" class="btn btn-red">Save Changes</button>' +
      '</div>' +
    '</form>',
    { wide: true, showCloseX: true, closeOnBackdrop: true }
  );
}

async function submitEditStaffModal(event, userId) {
  event.preventDefault();
  if (typeof clearAllFieldErrors === "function") clearAllFieldErrors();
  var fullName = (document.getElementById("edit-acc-fullname").value || "").trim();
  var username = (document.getElementById("edit-acc-username").value || "").trim().replace(/^@/, "");
  var roleEl = document.getElementById("edit-acc-role");
  var newPw = (document.getElementById("edit-acc-pw").value || "").trim();

  var nameChk = validatePersonName(fullName, "Full Name", false, false);
  var hasErr = false;
  if (!nameChk.valid) { setFieldError("edit-acc-fullname", nameChk.message); hasErr = true; }
  if (!isValidUsername(username)) {
    setFieldError("edit-acc-username", "Username must be 3 to 30 characters using letters, numbers, dots (.), or underscores (_).");
    hasErr = true;
  }
  if (newPw && !isStrongPassword(newPw)) { setFieldError("edit-acc-pw", PASSWORD_REQUIREMENT_TEXT); hasErr = true; }
  if (hasErr) return;

  var changes = { full_name: fullName, username: username };
  if (roleEl) changes.role = roleEl.value;
  if (newPw) changes.new_password = newPw;

  var btn = document.getElementById("btn-modal-edit-staff");
  btn.disabled = true;
  btn.textContent = "Saving...";
  try {
    var updated = await dbAdminUpdateStaffAccount(userId, changes);
    if (currentAdmin && currentAdmin.id === userId) {
      currentAdmin = Object.assign({}, currentAdmin, updated || changes);
      var topEl = document.getElementById("top-user-name");
      if (topEl) topEl.textContent = currentAdmin.full_name;
    }
    closePopup();
    await refreshAdminData();
    showAlert("Account Updated", "Saved changes for @" + escapeHtml(username) + ".", "good");
  } catch (err) {
    var msg = err.message || "Could not update account.";
    if (msg.toLowerCase().indexOf("reuse") !== -1 || msg.toLowerCase().indexOf("password") !== -1) setFieldError("edit-acc-pw", msg);
    else setFieldError("edit-acc-username", msg);
    btn.disabled = false;
    btn.textContent = "Save Changes";
  }
}

function adminDeleteUser(userId, label) {
  openConfirmPopup(
    "Delete Account?",
    "Are you sure you want to permanently remove <b>" + escapeHtml(label) + "</b> from registered accounts? This cannot be undone.",
    "Delete Account",
    async function () {
      try {
        await dbDeleteUserAccount(userId);
        await refreshAdminData();
        showAlert("Account Deleted", escapeHtml(label) + " has been removed.", "good");
      } catch (err) {
        showAlert("Delete Failed", err.message || "Could not delete account.", "bad");
      }
    },
    true
  );
}

function openAdminInviteModal() {
  openPopup(
    '<div class="row between" style="margin-bottom:8px;">' +
      '<h3>Generate Private Agent Invite</h3>' +
      '<button type="button" class="btn btn-outline btn-sm" onclick="closePopup()">Close</button>' +
    '</div>' +
    '<p class="small muted">Generate a one-time registration link (<code>agent-register.html?invite=INV-...</code>). Only Agents using an active invite token can register their username-only account.</p>' +
    '<div class="field mt"><label>Invite Label / Note</label><input id="adm-invite-note" type="text" placeholder="e.g. Field Agent - Cavite Desk" /></div>' +
    '<button type="button" class="btn btn-red btn-sm" style="width:100%" onclick="adminGenerateAgentInvite()">Generate One-Time Registration Link</button>' +
    '<div id="adm-invite-msg" class="msg mt"></div>' +
    '<div id="adm-invite-output-wrap" class="hidden" style="margin-top:12px; padding:12px; border:1px solid var(--line); border-radius:10px; background:var(--soft)">' +
      '<div class="tiny muted" style="font-weight:700; margin-bottom:4px">Private One-Time Registration URL:</div>' +
      '<input id="adm-invite-url" type="text" readonly style="margin-bottom:8px; font-size:12px" />' +
      '<button type="button" class="btn btn-outline btn-sm" onclick="adminCopyInviteUrl()">Copy Registration Link</button>' +
    '</div>'
  );
}

async function adminGenerateAgentInvite() {
  var noteEl = document.getElementById("adm-invite-note");
  var note = noteEl ? noteEl.value.trim() : "";
  try {
    var res = await dbCreateAgentInviteLink(getStaffIdentifier(currentAdmin), note || "Admin Private Agent Registration Invite");
    var url = getSiteBaseUrl() + "/agent-register.html?invite=" + encodeURIComponent(res.code);
    var wrap = document.getElementById("adm-invite-output-wrap");
    var inp = document.getElementById("adm-invite-url");
    if (inp) inp.value = url;
    if (wrap) wrap.classList.remove("hidden");
    if (noteEl) noteEl.value = "";
    showMsg("adm-invite-msg", "ok", "Invite " + res.code + " ready! Share the link below.");
  } catch (err) {
    showMsg("adm-invite-msg", "error", err.message || "Could not generate private registration link.");
  }
}

function adminCopyInviteUrl() {
  var inp = document.getElementById("adm-invite-url");
  if (!inp || !inp.value) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(inp.value);
  } else {
    inp.select();
    document.execCommand("copy");
  }
  showAlert("Copied", "Private Agent Registration Link copied to clipboard.");
}

function adminOpenResetPasswordModal(userId, displayLabel) {
  window._adminResetTargetId = userId;
  window._adminResetTargetLabel = displayLabel;
  openPopup(
    '<h3>Reset Account Password</h3>' +
    '<p class="small muted mt">Set a new sign-in password for <b>' + escapeHtml(displayLabel) + '</b>.</p>' +
    '<div class="field mt">' +
      '<label for="adm-reset-pw">New Password</label>' +
      '<input id="adm-reset-pw" type="password" data-pw-check="1" placeholder="Enter strong password" oninput="if(typeof clearFieldError===\'function\') clearFieldError(this)" />' +
    '</div>' +
    '<div class="row mt-big" style="justify-content:flex-end; gap:8px;">' +
      '<button type="button" class="btn btn-red" onclick="adminConfirmResetPassword()">Update Password</button>' +
    '</div>',
    { showCloseX: true, closeOnBackdrop: true }
  );
}

async function adminConfirmResetPassword() {
  if (typeof clearFieldError === "function") clearFieldError("adm-reset-pw");
  var pwEl = document.getElementById("adm-reset-pw");
  var newPw = pwEl ? pwEl.value.trim() : "";
  if (!isStrongPassword(newPw)) {
    setFieldError("adm-reset-pw", PASSWORD_REQUIREMENT_TEXT);
    return;
  }
  try {
    await dbAdminResetUserPassword(window._adminResetTargetId, newPw);
    var targetLabelLow = String(window._adminResetTargetLabel || "").toLowerCase();
    for (var nIdx = 0; nIdx < (adminNotifs || []).length; nIdx++) {
      var n = adminNotifs[nIdx];
      if (String(n.title || "").indexOf("Password Reset Request:") === 0) {
        if (
          (n.target_id && String(n.target_id) === String(window._adminResetTargetId)) ||
          (targetLabelLow && String(n.title || "").toLowerCase().indexOf(targetLabelLow) !== -1)
        ) {
          n.is_read = true;
          if (typeof dbMarkNotificationRead === "function") {
            await dbMarkNotificationRead(n.id, currentAdmin);
          }
        }
      }
    }
    var targetUserObj = adminUsers.find(function (u) { return u.id === window._adminResetTargetId; });
    await dbAddNotification({
      user_id: window._adminResetTargetId,
      role: targetUserObj ? targetUserObj.role : null,
      title: "Password Reset Completed",
      message: "Your internal account password has been updated by the System Administrator.",
      target_tab: "tab-overview"
    });
    await dbAddLog(getStaffIdentifier(currentAdmin), "Reset password for " + window._adminResetTargetLabel);
    closePopup();
    await refreshAdminData();
    if (typeof refreshNotifBell === "function") await refreshNotifBell(currentAdmin);
    showAlert("Password Updated", "Updated sign-in password for " + escapeHtml(window._adminResetTargetLabel) + ".", "good");
  } catch (err) {
    setFieldError("adm-reset-pw", err.message || "Could not update password.");
  }
}

async function adminChangeRole(userId, newRole) {
  if (newRole === "admin") {
    showAlert("Single Admin Rule", "Only one System Administrator account is permitted in the system.", "warn");
    await refreshAdminData();
    return;
  }
  await dbUpdateUser(userId, { role: newRole });
  await dbAddLog(getStaffIdentifier(currentAdmin), "Changed role of user " + userId + " to " + newRole);
  await refreshAdminData();
}

async function adminToggleActive(userId, activeState) {
  if (!activeState && currentAdmin && userId === currentAdmin.id) {
    showAlert("Action Blocked", "You cannot disable your own active System Administrator account.", "warn");
    return;
  }
  try {
    await dbUpdateUser(userId, { active: activeState });
    await dbAddLog(getStaffIdentifier(currentAdmin), (activeState ? "Enabled" : "Disabled") + " user " + userId);
    await refreshAdminData();
  } catch (err) {
    showAlert("Update Failed", err.message || "Could not update account status.", "bad");
  }
}

function setLogSubTab(sub) {
  activeLogSubTab = sub;
  var subs = ["activity", "login", "ai"];
  for (var i = 0; i < subs.length; i++) {
    var b = document.getElementById("log-sub-" + subs[i]);
    if (b) b.classList.toggle("active", subs[i] === sub);
    var p = document.getElementById("log-panel-" + subs[i]);
    if (p) p.classList.toggle("hidden", subs[i] !== sub);
  }
  renderAdminLogs();
}

function classifyLogCategory(text) {
  var s = String(text || "").toLowerCase();
  if (s.indexOf("login") !== -1 || s.indexOf("logout") !== -1 || s.indexOf("password") !== -1 || s.indexOf("activat") !== -1) return "auth";
  if (s.indexOf("user") !== -1 || s.indexOf("role") !== -1 || s.indexOf("account") !== -1 || s.indexOf("invite") !== -1) return "accounts";
  return "system";
}

async function renderAdminLogs() {
  var logs = await dbListLogs();
  var hist = await dbListLoginHistory();
  var aiList = await dbListAiLogs();

  var cAct = document.getElementById("log-cnt-activity");
  var cLog = document.getElementById("log-cnt-login");
  var cAi = document.getElementById("log-cnt-ai");
  if (cAct) cAct.textContent = logs.length;
  if (cLog) cLog.textContent = hist.length;
  if (cAi) cAi.textContent = aiList.length;

  var q = (document.getElementById("logs-search-input") ? document.getElementById("logs-search-input").value : "").trim().toLowerCase();
  var cat = document.getElementById("logs-role-filter") ? document.getElementById("logs-role-filter").value : "all";

  var logBody = document.getElementById("admin-logs-body");
  if (logBody) {
    var filteredLogs = logs.filter(function (row) {
      if (cat !== "all" && classifyLogCategory(row.action) !== cat) return false;
      if (!q) return true;
      var hay = [row.actor_username, row.actor_email, row.action].join(" ").toLowerCase();
      return hay.indexOf(q) !== -1;
    });
    var h1 = "";
    for (var i = 0; i < Math.min(filteredLogs.length, 80); i++) {
      var l = filteredLogs[i];
      var actorDisplay = l.actor_username ? ("@" + l.actor_username) : (l.actor_email || "system");
      h1 += '<tr><td>' + formatDate(l.created_at) + '</td><td><b>' + escapeHtml(actorDisplay) + '</b></td><td>' + escapeHtml(l.action) + '</td></tr>';
    }
    logBody.innerHTML = h1 || '<tr><td colspan="3" class="muted">No matching system activity logs.</td></tr>';
  }

  var histBody = document.getElementById("admin-login-history-body");
  if (histBody) {
    var filteredHist = hist.filter(function (ev) {
      if (cat === "accounts" || cat === "system") return cat !== "system" || false;
      if (!q) return true;
      var hay = [ev.username, ev.email, ev.role, ev.action].join(" ").toLowerCase();
      return hay.indexOf(q) !== -1;
    });
    var h2 = "";
    for (var j = 0; j < Math.min(filteredHist.length, 80); j++) {
      var ev = filteredHist[j];
      var userDisplay = ev.username ? ("@" + ev.username) : (ev.email || "user");
      var badgeCls = ev.action === "login" ? "badge-green" : (ev.action === "account_activated" ? "badge-blue" : "badge-gray");
      h2 += '<tr><td>' + formatDate(ev.created_at) + '</td><td><b>' + escapeHtml(userDisplay) + '</b></td><td><span class="badge badge-gray">' + escapeHtml((ev.role || "").toUpperCase()) + '</span></td><td><span class="badge ' + badgeCls + '">' + escapeHtml(ev.action) + '</span></td></tr>';
    }
    histBody.innerHTML = h2 || '<tr><td colspan="4" class="muted">No matching login events.</td></tr>';
  }

  var aiBody = document.getElementById("admin-ai-logs-table-body");
  if (aiBody) {
    var filteredAi = aiList.filter(function (a) {
      if (!q) return true;
      var hay = [a.reference_no, a.actor, a.message].join(" ").toLowerCase();
      return hay.indexOf(q) !== -1;
    });
    var h3 = "";
    for (var k = 0; k < Math.min(filteredAi.length, 80); k++) {
      var item = filteredAi[k];
      h3 += '<tr><td>' + formatDate(item.created_at) + '</td><td><b>' + escapeHtml(item.reference_no || "-") + '</b></td><td>' + escapeHtml(item.actor || "Screening") + '</td><td>' + escapeHtml(item.message || "") + '</td></tr>';
    }
    aiBody.innerHTML = h3 || '<tr><td colspan="4" class="muted">No matching AI screening records.</td></tr>';
  }
}

function populateReportStatusFilter(subTab) {
  var sel = document.getElementById("rep-filter-status");
  if (!sel) return;
  if (subTab === "api") {
    sel.innerHTML =
      '<option value="all">All Services</option>' +
      '<option value="healthy">Online / Protected Only</option>' +
      '<option value="attention">Needs Attention Only</option>';
  } else if (subTab === "accounts") {
    sel.innerHTML =
      '<option value="all">All Account Roles</option>' +
      '<option value="agent">Agents Only</option>' +
      '<option value="manager">Managers Only</option>' +
      '<option value="customer">Customers Only</option>' +
      '<option value="disabled">Disabled Accounts Only</option>';
  } else {
    sel.innerHTML =
      '<option value="all">All Application Statuses</option>' +
      '<option value="Pending Review">Pending Review</option>' +
      '<option value="Under Agent Review">Under Agent Review</option>' +
      '<option value="Encoding">Encoding</option>' +
      '<option value="Needs Correction">Needs Correction</option>' +
      '<option value="Approved">Approved / Submitted</option>' +
      '<option value="Rejected">Rejected</option>';
  }
}

function setReportSubTab(sub) {
  activeReportSubTab = sub;
  var subs = ["api", "accounts", "applications"];
  for (var i = 0; i < subs.length; i++) {
    var b = document.getElementById("rep-sub-" + subs[i]);
    if (b) b.classList.toggle("active", subs[i] === sub);
  }
  populateReportStatusFilter(sub);
  renderAdminReport();
}

function onReportTimeframeChange() {
  var tf = document.getElementById("rep-timeframe").value;
  var dWrap = document.getElementById("rep-date-wrap");
  var mWrap = document.getElementById("rep-month-wrap");
  if (dWrap) dWrap.classList.toggle("hidden", tf !== "daily");
  if (mWrap) mWrap.classList.toggle("hidden", tf !== "monthly");
  renderAdminReport();
}

function matchesReportTimeframe(isoDateStr) {
  var tf = document.getElementById("rep-timeframe") ? document.getElementById("rep-timeframe").value : "all";
  var pickedDate = document.getElementById("rep-date") ? document.getElementById("rep-date").value : "";
  var pickedMonth = document.getElementById("rep-month") ? document.getElementById("rep-month").value : "";
  return matchesReportTimeframeValue(isoDateStr, tf, pickedDate, pickedMonth);
}

function getActiveReportData() {
  var filterVal = document.getElementById("rep-filter-status") ? document.getElementById("rep-filter-status").value : "all";
  var tf = document.getElementById("rep-timeframe") ? document.getElementById("rep-timeframe").value : "all";
  var tfLabel = tf === "daily"
    ? ("Daily (" + (document.getElementById("rep-date").value || getLocalTodayIso()) + ")")
    : (tf === "monthly" ? ("Monthly (" + (document.getElementById("rep-month").value || getLocalMonthIso()) + ")") : "All Time");

  if (activeReportSubTab === "api") {
    var apiRows = lastApiReportRows.filter(function (item) {
      if (!matchesReportTimeframe(item.checked_at)) return false;
      if (filterVal === "healthy") return item.healthy;
      if (filterVal === "attention") return !item.healthy;
      return true;
    });
    var healthyCnt = apiRows.filter(function (x) { return x.healthy; }).length;
    var issueCnt = apiRows.length - healthyCnt;
    return {
      title: "API Health Report",
      timeframeLabel: tfLabel,
      pieTitle: "Service Health Ratio",
      barTitle: "API Readiness Breakdown",
      pieCenter: "Services",
      pieSlices: [
        { label: "Online / Protected", value: healthyCnt, color: "#15803d" },
        { label: "Needs Attention", value: issueCnt, color: "#d97706" }
      ],
      barRows: [
        { label: "Healthy Services", value: healthyCnt, color: "#15803d" },
        { label: "Warnings / Offline", value: issueCnt, color: "#dc2626" },
        { label: "AI Mode Active", value: isAiEnabled() ? 1 : 0, color: "#2563eb" }
      ],
      columns: ["Service / Endpoint", "Health Status", "Checked Date", "Technical Detail"],
      rows: apiRows.map(function (it) {
        return [it.name, it.status, formatDate(it.checked_at), it.detail];
      }),
      badges: apiRows.map(function (it) { return it.badge; })
    };
  }

  if (activeReportSubTab === "accounts") {
    var accRows = adminUsers.filter(function (u) {
      if (u.created_at && !matchesReportTimeframe(u.created_at)) return false;
      if (filterVal === "disabled") return !u.active;
      if (filterVal !== "all") return u.role === filterVal;
      return true;
    });
    var cAg = accRows.filter(function (u) { return u.role === "agent"; }).length;
    var cMgr = accRows.filter(function (u) { return u.role === "manager"; }).length;
    var cCust = accRows.filter(function (u) { return u.role === "customer"; }).length;
    var cAdm = accRows.filter(function (u) { return u.role === "admin"; }).length;
    var cAct = accRows.filter(function (u) { return u.active; }).length;
    return {
      title: "Accounts Report",
      timeframeLabel: tfLabel,
      pieTitle: "Filtered Accounts by Role",
      barTitle: "Account Status & Role Totals",
      pieCenter: "Accounts",
      pieSlices: [
        { label: "Customers", value: cCust, color: "#64748b" },
        { label: "Agents", value: cAg, color: "#2563eb" },
        { label: "Managers", value: cMgr, color: "#d97706" },
        { label: "Admin", value: cAdm, color: "#c8102e" }
      ],
      barRows: [
        { label: "Active Accounts", value: cAct, color: "#15803d" },
        { label: "Disabled Accounts", value: accRows.length - cAct, color: "#dc2626" },
        { label: "Internal Staff", value: cAg + cMgr + cAdm, color: "#2563eb" },
        { label: "Customers", value: cCust, color: "#64748b" }
      ],
      columns: ["Full Name", "Username", "Account Type / Email", "Role", "Status", "Created At"],
      rows: accRows.map(function (u) {
        return [
          u.full_name || "-",
          "@" + (u.username || "-"),
          u.role === "customer" ? (u.email || "-") : "Internal (Username Only)",
          String(u.role || "").toUpperCase(),
          u.active ? "Active" : "Disabled",
          u.created_at ? formatDate(u.created_at) : "-"
        ];
      }),
      badges: []
    };
  }

  var appRows = adminApps.filter(function (a) {
    if (!matchesReportTimeframe(a.created_at)) return false;
    if (filterVal === "all") return true;
    if (filterVal === "Approved") return a.status === "Approved" || a.status === "Submitted to Provider";
    return a.status === filterVal;
  });
  var aPend = appRows.filter(function (a) { return a.status === "Pending Review" || a.status === "Under Agent Review" || a.status === "Encoding"; }).length;
  var aFix = appRows.filter(function (a) { return a.status === "Needs Correction"; }).length;
  var aApp = appRows.filter(function (a) { return a.status === "Approved" || a.status === "Submitted to Provider"; }).length;
  var aRej = appRows.filter(function (a) { return a.status === "Rejected"; }).length;

  return {
    title: "Applications Report",
    timeframeLabel: tfLabel,
    pieTitle: "Applications by Status",
    barTitle: "Application Volume Summary",
    pieCenter: "Apps",
    pieSlices: [
      { label: "Pending / Encoding", value: aPend, color: "#2563eb" },
      { label: "Needs Correction", value: aFix, color: "#d97706" },
      { label: "Approved", value: aApp, color: "#15803d" },
      { label: "Rejected", value: aRej, color: "#dc2626" }
    ],
    barRows: [
      { label: "Pending / Encoding", value: aPend, color: "#2563eb" },
      { label: "Needs Correction", value: aFix, color: "#d97706" },
      { label: "Approved", value: aApp, color: "#15803d" },
      { label: "Rejected", value: aRej, color: "#dc2626" }
    ],
    columns: ["Reference No.", "Applicant Name", "Plan", "City", "Assigned Agent", "Status", "Submitted At"],
    rows: appRows.map(function (a) {
      return [
        a.reference_no || a.ref_no || "-",
        a.full_name || "-",
        a.plan_name || "-",
        a.city || "-",
        a.assigned_agent || "Unassigned",
        a.status || "-",
        formatDate(a.created_at)
      ];
    }),
    badges: []
  };
}

function renderAdminReport() {
  renderDashReportView({
    data: getActiveReportData(),
    summaryId: "rep-summary-header",
    pieTitleId: "rep-pie-title",
    barTitleId: "rep-bar-title",
    pieBoxId: "chart-report-pie",
    barBoxId: "chart-report-bars",
    tableWrapId: "report-table-wrap",
    actorLabel: getStaffIdentifier(currentAdmin),
    badgeColIdx: activeReportSubTab === "api" ? 1 : -1
  });
}

function resetAdminReportFilters() {
  var tfEl = document.getElementById("rep-timeframe");
  var dEl = document.getElementById("rep-date");
  var mEl = document.getElementById("rep-month");
  var fEl = document.getElementById("rep-filter-status");
  if (tfEl) tfEl.value = "all";
  if (dEl) dEl.value = getLocalTodayIso();
  if (mEl) mEl.value = getLocalMonthIso();
  if (fEl) fEl.value = "all";
  onReportTimeframeChange();
}

function exportActiveReportCsv() {
  var data = getActiveReportData();
  exportReportToCsv(data.columns, data.rows, "PIGEM-" + activeReportSubTab + "-report.csv");
}

function downloadFormattedAdminReport() {
  var data = getActiveReportData();
  downloadFormattedHtmlReport(data.title, data.timeframeLabel, data.pieSlices, data.columns, data.rows, "PIGEM-" + activeReportSubTab + "-summary-report.html");
}

function resetDemoDatabase() {
  localStorage.removeItem("pigem_apps");
  localStorage.removeItem("pigem_users");
  localStorage.removeItem("pigem_content");
  localStorage.removeItem("pigem_logs");
  localStorage.removeItem("pigem_ai_logs");
  showAlert("Demo Data Reset", "All demo records have been reset to factory defaults.", function () {
    window.location.reload();
  });
}

async function adminSendTestEmail() {
  var btn = document.getElementById("btn-test-email");
  var to = document.getElementById("test-email-to").value.trim();
  var type = document.getElementById("test-email-type").value;

  if (!to || !isCustomerGmail(to)) {
    showMsg("test-email-msg", "error", "Please enter a valid @gmail.com Customer email address.");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Sending...";
  showMsg("test-email-msg", "info", "Dispatching via PIGEM Support Services...");

  try {
    var res;
    if (type === "otp") {
      var sampleOtp = String(Math.floor(100000 + Math.random() * 900000));
      res = await apiSendOtpEmail(to, sampleOtp, "Admin Security Test", "Admin", "VSCF");
    } else if (type === "application_confirmation") {
      res = await apiSendApplicationConfirmationEmail(
        to,
        "Juan Dela Cruz",
        "PF-20261021-0001",
        { name: "Plan 1400", speed: "300", price: 1400 },
        "Blk 42 Lot 19 Tokya St., Summerwind Village M., Brgy. Burol Main, Dasmariñas City, Cavite",
        { status: "pending", code: "849201" }
      );
    } else if (type === "correction_notice") {
      res = await apiSendCorrectionEmail(to, "Juan Dela Cruz", "PF-20261021-0001", "The name entered on your application form does not match the name printed on your Valid ID.");
    } else if (type === "status_update") {
      res = await apiSendStatusEmail(to, "Juan Dela Cruz", "PF-20261021-0001", "Approved", "Your application has been approved by the provider.");
    } else if (type === "promotional") {
      res = await apiSendPromotionalEmail(
        to,
        "Juan Dela Cruz",
        "Exclusive Fiber Speed Boost for Cavite Residents",
        "Upgrade your plan today and experience seamless fiber internet with zero lock-in period fees.",
        [
          { name: "Red Fiber 100", speed: "100 Mbps", price: "₱1,699" },
          { name: "Red Fiber 200", speed: "200 Mbps", price: "₱2,199" }
        ]
      );
    }

    if (res && res.sent) {
      showMsg("test-email-msg", "ok", "Email delivered via PIGEM Support Services to " + to + "! Check inbox (and Spam folder).");
    } else if (res && res.offline) {
      showMsg("test-email-msg", "error", "Cloud FastAPI email endpoint (/api/notify) is currently unreachable. Please check Vercel deployment status.");
    } else {
      showMsg("test-email-msg", "error", "Delivery failed: " + ((res && res.reason) || "Unknown error"));
    }
  } catch (err) {
    showMsg("test-email-msg", "error", "Error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Send Live Email";
  }
}
