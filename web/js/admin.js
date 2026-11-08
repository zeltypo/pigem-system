var currentAdmin = null;
var adminApps = [];
var adminUsers = [];
var activeAdminTab = "overview";

window.addEventListener("DOMContentLoaded", async function () {
  currentAdmin = await requireLogin(["admin"]);
  if (!currentAdmin) return;

  document.getElementById("top-user-name").textContent = currentAdmin.full_name;
  await refreshAdminData();
  initDashUI(currentAdmin, adminApps, function () { showTab("reports"); });
});

async function refreshAdminData() {
  adminApps = await dbListAllApplications();
  adminUsers = await dbListUsers();
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

  renderBars("chart-admin-bars", [
    { label: "Customers", value: rCounts.customer, color: "#64748b" },
    { label: "Agents", value: rCounts.agent, color: "#2563eb" },
    { label: "Managers", value: rCounts.manager, color: "#d97706" },
    { label: "Admins", value: rCounts.admin, color: "#c8102e" }
  ]);
  renderColumns("chart-admin-cols", [
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
      await dbAddLog(currentAdmin.email, "Set Maintenance Mode to " + (next ? "ON" : "OFF"));
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

var lastHealthData = null;

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
      await dbAddLog(currentAdmin.email, "Set AI Screening Engine to " + (next ? "ENABLED" : "DISABLED"));
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
  if (!box) return;

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

  var items = [
    {
      name: "Vercel Python FastAPI Serverless (/api)",
      status: pyOk ? "Online (Cloud)" : "Unreachable",
      badge: pyOk ? "badge-green" : "badge-red",
      detail: pyOk
        ? "Serving /api/health, /api/screen-async, /api/verify-captcha, /api/notify, and /api/polite-remark"
        : "Check Vercel deployment logs for api/index.py"
    },
    {
      name: "Google Gemini Vision and AI API (gemini-flash-latest)",
      status: geminiOk ? "Online (Configured)" : "Key Missing",
      badge: geminiOk ? "badge-green" : "badge-yellow",
      detail: geminiOk
        ? "Performs Valid ID Vision OCR extraction, preliminary screening findings, and polite customer messages"
        : "Add GEMINI_API_KEY in Vercel Environment Variables to activate Vision OCR"
    },
    {
      name: "OpenCV Readability, 4-Corner Auto-Crop, and Duplicate Check",
      status: opencvOk ? "Online" : "Unavailable",
      badge: opencvOk ? "badge-green" : "badge-red",
      detail: opencvOk
        ? "Evaluates blur, brightness, glare, contrast, SHA-256 duplicate image check, and saves cropped copy in documents/cropped/"
        : "Requires opencv-python-headless in Vercel Python runtime"
    },
    {
      name: "Google reCAPTCHA v2 Security (SiteVerify)",
      status: recaptchaOk ? "Protected" : "Client Key Only",
      badge: recaptchaOk ? "badge-green" : "badge-yellow",
      detail: recaptchaOk
        ? "Checkbox Site Key active with server-side SiteVerify secret validation (/api/verify-captcha)"
        : "Add RECAPTCHA_SECRET_KEY in Vercel Environment Variables for server-side token validation"
    },
    {
      name: "LocationIQ + OpenStreetMap Geocoding",
      status: locationIqOk ? "Online (Dual-Source)" : "Fallback Only",
      badge: locationIqOk ? "badge-green" : "badge-yellow",
      detail: locationIqOk
        ? "Primary LocationIQ OpenStreetMap geocoding with automatic Nominatim fallback on Leaflet.js map"
        : "Using OpenStreetMap Nominatim reverse geocoding"
    },
    {
      name: "PIGEM Support Services Email Engine",
      status: smtpOk ? "Online" : (pyOk ? "Env Missing" : "Unreachable"),
      badge: smtpOk ? "badge-green" : "badge-red",
      detail: smtpOk
        ? "Connected via /api/notify (PIGEM Support Services <donotreply@pigem.ph>)"
        : "Configure SMTP_USER and SMTP_PASSWORD in Vercel Environment Variables"
    },
    {
      name: "Supabase Cloud (PostgreSQL + Auth + Storage Buckets)",
      status: supaOk ? "Live Cloud" : "Demo Storage",
      badge: supaOk ? "badge-green" : "badge-blue",
      detail: supaOk ? (CONFIG.SUPABASE_URL + " (documents + website-assets buckets)") : "Running in browser storage"
    }
  ];

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

function renderAdminUsers() {
  var body = document.getElementById("admin-users-body");
  if (!body) return;
  var html = "";
  for (var i = 0; i < adminUsers.length; i++) {
    var u = adminUsers[i];
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

    var actionBtns = '<div style="display:flex; gap:6px; flex-wrap:wrap">';
    if (!isCustomer) {
      actionBtns +=
        '<button type="button" class="btn btn-outline btn-sm" onclick="adminOpenResetPasswordModal(\'' + escapeHtml(u.id) + '\', \'' + escapeHtml(u.email) + '\')">Reset Password</button>';
    }
    if (!isSoleAdmin) {
      actionBtns +=
        '<button type="button" class="btn btn-outline btn-sm" onclick="adminToggleActive(\'' + escapeHtml(u.id) + '\', ' + (!u.active) + ')">' +
          (u.active ? "Disable" : "Enable") +
        '</button>';
    }
    actionBtns += '</div>';

    html +=
      '<tr>' +
        '<td><b>' + escapeHtml(u.full_name) + '</b></td>' +
        '<td><code>@' + escapeHtml(u.username || "-") + '</code></td>' +
        '<td>' + escapeHtml(u.email) + '</td>' +
        '<td>' + roleCell + '</td>' +
        '<td>' + (u.active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-red">Disabled</span>') + '</td>' +
        '<td>' + actionBtns + '</td>' +
      '</tr>';
  }
  body.innerHTML = html;
}

async function adminCreateUser() {
  hideMsg("acc-msg");
  var fname = (document.getElementById("new-acc-fname").value || "").trim();
  var mname = (document.getElementById("new-acc-mname").value || "").trim();
  var lname = (document.getElementById("new-acc-lname").value || "").trim();
  var usernameInput = document.getElementById("new-acc-username");
  var username = (usernameInput ? usernameInput.value : "").trim().toLowerCase();
  var email = document.getElementById("new-acc-email").value.trim().toLowerCase();
  var pw = (document.getElementById("new-acc-pw").value || "").trim();
  var role = document.getElementById("new-acc-role").value;

  if (!fname || !lname || !email) {
    showMsg("acc-msg", "error", "Please enter First Name, Last Name, Username, and Official Email (@pigem.ph).");
    return;
  }
  var name = [fname, mname, lname].filter(Boolean).join(" ");
  if (!username && typeof sanitizeUsernameSeed === "function") {
    username = sanitizeUsernameSeed(name, email);
  }
  if (typeof isValidUsername === "function" && !isValidUsername(username)) {
    showMsg("acc-msg", "error", "Username must be 3 to 30 characters using letters, numbers, dots (.), hyphens (-), or underscores (_).");
    return;
  }
  if (!isStaffBusinessEmail(email)) {
    showMsg("acc-msg", "error", "Internal staff must use an official @pigem.ph email address. Gmail addresses are reserved for Customers.");
    return;
  }
  if (!isStrongPassword(pw)) {
    showMsg("acc-msg", "error", PASSWORD_REQUIREMENT_TEXT);
    return;
  }
  if (role === "admin") {
    showMsg("acc-msg", "error", "Only one System Administrator account is permitted in the system.");
    return;
  }

  try {
    var created = await dbCreateUserAccount(name, email, pw, role, username);
    await dbAddLog(currentAdmin.email, "Created " + role + " account for @" + (created.username || username) + " (" + email + ")");
    document.getElementById("new-acc-fname").value = "";
    document.getElementById("new-acc-mname").value = "";
    document.getElementById("new-acc-lname").value = "";
    if (usernameInput) usernameInput.value = "";
    document.getElementById("new-acc-email").value = "";
    document.getElementById("new-acc-pw").value = "";
    showMsg("acc-msg", "ok", "Staff account created for @" + (created.username || username) + " (" + email + " - " + role + ").");
    await refreshAdminData();
  } catch (err) {
    showMsg("acc-msg", "error", err.message);
  }
}

async function adminGenerateAgentInvite() {
  var noteEl = document.getElementById("adm-invite-note");
  var note = noteEl ? noteEl.value.trim() : "";
  try {
    var res = await dbCreateAgentInviteLink(currentAdmin ? currentAdmin.email : "admin@pigem.ph", note || "Admin Private Agent Registration Invite");
    var url = getSiteBaseUrl() + "/agent-register.html?invite=" + encodeURIComponent(res.code);
    var wrap = document.getElementById("adm-invite-output-wrap");
    var inp = document.getElementById("adm-invite-url");
    if (inp) inp.value = url;
    if (wrap) wrap.classList.remove("hidden");
    if (noteEl) noteEl.value = "";
    showMsg("adm-invite-msg", "ok", "Private Agent Registration Link (" + res.code + ") created! Share the URL below with your new agent.");
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

function adminOpenResetPasswordModal(userId, userEmail) {
  window._adminResetTargetId = userId;
  window._adminResetTargetEmail = userEmail;
  openPopup(
    '<h3>Reset Account Password</h3>' +
    '<p class="small muted mt">Set a new sign-in password for <b>' + escapeHtml(userEmail) + '</b>.</p>' +
    '<div class="mt">' +
      '<label for="adm-reset-pw">New Password</label>' +
      '<input id="adm-reset-pw" type="password" data-pw-check="1" placeholder="Enter strong password" />' +
    '</div>' +
    '<div class="row mt-big" style="justify-content:flex-end; gap:8px;">' +
      '<button type="button" class="btn btn-outline" onclick="closePopup()">Cancel</button>' +
      '<button type="button" class="btn btn-red" onclick="adminConfirmResetPassword()">Update Password</button>' +
    '</div>'
  );
}

async function adminConfirmResetPassword() {
  var pwEl = document.getElementById("adm-reset-pw");
  var newPw = pwEl ? pwEl.value.trim() : "";
  if (!isStrongPassword(newPw)) {
    showAlert("Password Requirement", PASSWORD_REQUIREMENT_TEXT, "warn");
    return;
  }
  try {
    await dbAdminResetUserPassword(window._adminResetTargetId, newPw);
    await dbAddLog(currentAdmin.email, "Reset password for " + window._adminResetTargetEmail);
    closePopup();
    showAlert("Password Updated", "Updated sign-in password for " + window._adminResetTargetEmail + ".", "good");
  } catch (err) {
    showAlert("Update Failed", err.message || "Could not update password.", "bad");
  }
}

async function adminChangeRole(userId, newRole) {
  if (newRole === "admin") {
    showAlert("Single Admin Rule", "Only one System Administrator account is permitted in the system.", "warn");
    await refreshAdminData();
    return;
  }
  await dbUpdateUser(userId, { role: newRole });
  await dbAddLog(currentAdmin.email, "Changed role of user " + userId + " to " + newRole);
  await refreshAdminData();
}

async function adminToggleActive(userId, activeState) {
  await dbUpdateUser(userId, { active: activeState });
  await dbAddLog(currentAdmin.email, (activeState ? "Enabled" : "Disabled") + " user " + userId);
  await refreshAdminData();
}

async function renderAdminLogs() {
  var logs = await dbListLogs();
  var logBody = document.getElementById("admin-logs-body");
  if (logBody) {
    var h1 = "";
    for (var i = 0; i < Math.min(logs.length, 30); i++) {
      var actorDisplay = logs[i].actor_username
        ? ('@' + logs[i].actor_username + ' (' + logs[i].actor_email + ')')
        : logs[i].actor_email;
      h1 += '<tr><td>' + formatDate(logs[i].created_at) + '</td><td><b>' + escapeHtml(actorDisplay) + '</b></td><td>' + escapeHtml(logs[i].action) + '</td></tr>';
    }
    logBody.innerHTML = h1 || '<tr><td colspan="3" class="muted">No activity logs yet.</td></tr>';
  }

  var hist = await dbListLoginHistory();
  var histBody = document.getElementById("admin-login-history-body");
  if (histBody) {
    var h2 = "";
    for (var j = 0; j < Math.min(hist.length, 30); j++) {
      var ev = hist[j];
      var userDisplay = ev.username
        ? ('@' + ev.username + ' (' + ev.email + ')')
        : ev.email;
      h2 += '<tr><td>' + formatDate(ev.created_at) + '</td><td><b>' + escapeHtml(userDisplay) + '</b></td><td>' + escapeHtml(ev.role) + '</td><td><span class="badge ' + (ev.action === "login" ? "badge-green" : "badge-gray") + '">' + escapeHtml(ev.action) + '</span></td></tr>';
    }
    histBody.innerHTML = h2 || '<tr><td colspan="4" class="muted">No login events recorded yet.</td></tr>';
  }
}

function exportApplicationsCsv() {
  var headers = ["Reference No", "Full Name", "Email", "Mobile", "Plan", "ID Type", "ID Number", "City", "Province", "Status", "Assigned Agent", "Created At"];
  var rows = [headers.join(",")];
  for (var i = 0; i < adminApps.length; i++) {
    var a = adminApps[i];
    var cols = [
      a.reference_no, a.full_name, a.email, a.phone, a.plan_name,
      a.id_type, a.id_number, a.city, a.province, a.status,
      a.assigned_agent || "Unassigned", a.created_at
    ];
    var escaped = cols.map(function (v) {
      return '"' + String(v || "").replace(/"/g, '""') + '"';
    });
    rows.push(escaped.join(","));
  }
  var blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  var url = URL.createObjectURL(blob);
  var link = document.createElement("a");
  link.href = url;
  link.download = "PIGEM-Applications-Report.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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
