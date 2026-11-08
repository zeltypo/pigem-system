var currentManager = null;
var mgrApps = [];
var mgrUsers = [];
var activeMgrTab = "overview";
var activeMgrAppId = null;
var isMgrScreeningOnline = true;

async function checkMgrScreeningService() {
  var banner = document.getElementById("mgr-screening-banner");
  if (!isAiEnabled()) {
    isMgrScreeningOnline = false;
    if (banner) banner.classList.remove("hidden");
    return false;
  }
  if (typeof apiCheckHealth === "function") {
    var health = await apiCheckHealth();
    if (!health || health.status !== "ok" || health.auto_screening_ready === false) {
      isMgrScreeningOnline = false;
      if (banner) banner.classList.remove("hidden");
      if (typeof dbNotifyScreeningUnavailable === "function") {
        await dbNotifyScreeningUnavailable("", "", "Auto-screening service is currently offline. Applications continue using original uploaded ID copies.");
      }
      return false;
    }
  }
  isMgrScreeningOnline = true;
  if (banner) banner.classList.add("hidden");
  return true;
}

function isMgrScreeningActive(app) {
  var scr = (app && app.screening) || {};
  return scr.state === "queued" || scr.state === "layer1_running" || scr.state === "layer2_running";
}

function formatMgrEta(seconds) {
  var sec = Number(seconds || 0);
  if (!sec || sec <= 0) return "";
  if (sec >= 60) {
    var mins = Math.ceil(sec / 60);
    return "~" + mins + (mins === 1 ? " min" : " mins") + " left";
  }
  return "~" + sec + "s left";
}

function getMgrScreeningBadge(app) {
  var scr = app.screening || {};
  var state = scr.state || "";
  if (!isAiEnabled() || !isMgrScreeningOnline || state === "unavailable" || state === "paused" || scr.fallback_original_only) {
    return '<span class="badge badge-gray">Original ID Copy (Manual Review)</span>';
  }
  var eta = formatMgrEta(scr.eta_seconds);

  if (state === "queued" || state === "layer1_running") {
    return '<span class="badge badge-blue">Screening in Progress' + (eta ? " (" + escapeHtml(eta) + ")" : "") + '</span>';
  }
  if (state === "layer2_running") {
    if (scr.severity === "warning") {
      return '<span class="badge badge-yellow">Enhancing Document' + (eta ? " (" + escapeHtml(eta) + ")" : "") + ' - Hold Recommended</span>';
    }
    return '<span class="badge badge-blue">Cropping and Verifying' + (eta ? " (" + escapeHtml(eta) + ")" : "") + '</span>';
  }
  if (scr.review_recommended && app.status !== "Approved" && app.status !== "Rejected") {
    return '<span class="badge badge-yellow">Preliminary Finding - Review Needed</span>';
  }
  if (scr.auto_correction_sent) {
    return '<span class="badge badge-yellow">Update Requested</span>';
  }

  var res = app.ai_result || {};
  var st = res.overall_status || "Checked";
  if (st === "Verified") {
    return '<span class="badge badge-green">Screening Passed</span>';
  }
  if (st.indexOf("Needs") !== -1) {
    return '<span class="badge badge-yellow">Review Recommended</span>';
  }
  return '<span class="badge badge-gray">Screening Checked</span>';
}

window.addEventListener("DOMContentLoaded", async function () {
  currentManager = await requireLogin(["manager", "admin"]);
  if (!currentManager) return;

  document.getElementById("top-user-name").textContent = currentManager.full_name;
  await checkMgrScreeningService();
  await refreshManagerData();
  loadAllCmsEditors();
  initDashUI(currentManager, mgrApps, openMgrAppModal);

  setInterval(function () {
    checkMgrScreeningService();
  }, 20000);

  setInterval(async function () {
    var anyRunning = false;
    for (var i = 0; i < mgrApps.length; i++) {
      if (isMgrScreeningActive(mgrApps[i])) {
        anyRunning = true;
        break;
      }
    }
    var activeTag = document.activeElement ? document.activeElement.tagName : "";
    var isTyping = (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT");
    if (anyRunning && !isTyping) {
      await refreshManagerData();
      var modal = document.getElementById("mgr-modal");
      if (modal && !modal.classList.contains("hidden") && activeMgrAppId) {
        openMgrAppModal(activeMgrAppId);
      }
    }
  }, 5000);
});

async function refreshManagerData() {
  mgrApps = await dbListAllApplications();
  mgrUsers = await dbListUsers();
  updateDashSearchApps(mgrApps);

  var pending = 0, fix = 0, approved = 0, rejected = 0;
  var planCounts = { "1000": 0, "1400": 0, "1900": 0 };

  for (var i = 0; i < mgrApps.length; i++) {
    var a = mgrApps[i];
    if (a.status === "Pending Review" || a.status === "Under Agent Review" || a.status === "Encoding") pending++;
    else if (a.status === "Needs Correction") fix++;
    else if (a.status === "Approved" || a.status === "Submitted to Provider") approved++;
    else if (a.status === "Rejected") rejected++;

    if (String(a.plan_name).indexOf("1000") !== -1) planCounts["1000"]++;
    else if (String(a.plan_name).indexOf("1400") !== -1) planCounts["1400"]++;
    else if (String(a.plan_name).indexOf("1900") !== -1) planCounts["1900"]++;
  }

  document.getElementById("st-total").textContent = mgrApps.length;
  document.getElementById("st-pending").textContent = pending;
  document.getElementById("st-fix").textContent = fix;
  document.getElementById("st-approved").textContent = approved;

  renderBars("chart-mgr-bars", [
    { label: "Pending / Encoding", value: pending, color: "#2563eb" },
    { label: "Needs Correction", value: fix, color: "#d97706" },
    { label: "Approved", value: approved, color: "#15803d" },
    { label: "Rejected", value: rejected, color: "#dc2626" }
  ]);
  renderColumns("chart-mgr-cols", [
    { label: "Plan 1000", value: planCounts["1000"], color: "#c8102e" },
    { label: "Plan 1400", value: planCounts["1400"], color: "#0f172a" },
    { label: "Plan 1900", value: planCounts["1900"], color: "#2563eb" }
  ]);
  renderCalendar("mgr-calendar", mgrApps);

  renderManagerApps();
  renderAgentPerformance();
  await renderManagerLinks();
}

function showTab(tab) {
  if (tab === "app-encoded") tab = "app-approved";
  activeMgrTab = tab;
  var allNavs = [
    "overview",
    "app-all", "app-encoding", "app-override", "app-approved", "app-rejected",
    "agent-perf", "agent-links",
    "cms-banners", "cms-assets", "cms-about", "cms-plans", "cms-faqs",
    "promo-broadcast"
  ];
  for (var i = 0; i < allNavs.length; i++) {
    var btn = document.getElementById("nav-" + allNavs[i]);
    if (btn) btn.classList.toggle("active", allNavs[i] === tab);
  }

  var isAppView = (
    tab === "app-all" ||
    tab === "app-encoding" ||
    tab === "app-override" ||
    tab === "app-approved" ||
    tab === "app-rejected"
  );
  var isCmsView = (tab.indexOf("cms-") === 0);

  document.getElementById("tab-overview").classList.toggle("hidden", tab !== "overview");
  document.getElementById("tab-apps").classList.toggle("hidden", !isAppView);
  document.getElementById("tab-agent-perf").classList.toggle("hidden", tab !== "agent-perf");
  document.getElementById("tab-agent-links").classList.toggle("hidden", tab !== "agent-links");
  document.getElementById("tab-cms-banners").classList.toggle("hidden", tab !== "cms-banners");
  var tabAssets = document.getElementById("tab-cms-assets");
  if (tabAssets) tabAssets.classList.toggle("hidden", tab !== "cms-assets");
  document.getElementById("tab-cms-about").classList.toggle("hidden", tab !== "cms-about");
  document.getElementById("tab-cms-plans").classList.toggle("hidden", tab !== "cms-plans");
  document.getElementById("tab-cms-faqs").classList.toggle("hidden", tab !== "cms-faqs");
  var tabPromo = document.getElementById("tab-promo-broadcast");
  if (tabPromo) tabPromo.classList.toggle("hidden", tab !== "promo-broadcast");

  var maintBar = document.getElementById("cms-maint-bar");
  if (maintBar) {
    maintBar.classList.toggle("hidden", !isCmsView);
    if (isCmsView) {
      updateCmsMaintenanceBarUI();
    }
  }

  if (isAppView) {
    var headings = {
      "app-all": "All Customer Applications",
      "app-encoding": "Encoding Applications (With Provider Validator)",
      "app-override": "Applications Needing Correction",
      "app-approved": "Approved Applications",
      "app-rejected": "Rejected Applications"
    };
    document.getElementById("mgr-apps-title").textContent = headings[tab] || "All Customer Applications";
    renderManagerApps();
  }
}

function updateCmsMaintenanceBarUI() {
  var badge = document.getElementById("cms-maint-badge");
  var btn = document.getElementById("cms-maint-toggle-btn");
  if (!badge || !btn) return;
  if (isMaintenanceOn()) {
    badge.className = "badge badge-yellow";
    badge.textContent = "Maintenance Mode: ON (Customers Paused)";
    btn.className = "btn btn-green btn-sm";
    btn.textContent = "Return Website to Live";
  } else {
    badge.className = "badge badge-green";
    badge.textContent = "Website Status: LIVE";
    btn.className = "btn btn-outline btn-sm";
    btn.textContent = "Enable Maintenance Mode";
  }
}

function finishCmsAndDisableMaintenance() {
  if (isMaintenanceOn()) {
    openConfirmPopup(
      "Return Public Website to Live?",
      "Customers will immediately regain access to the public website, application form, and account activation.",
      "Yes, Make Website Live",
      async function () {
        setMaintenanceOn(false);
        if (currentManager) await dbAddLog(currentManager.email, "Disabled Maintenance Mode from Website Content (CMS)");
        await dbAddNotification(null, "agent", "Website Restored to Live", "Public Maintenance Mode has been disabled. Customer website and application form are live.");
        updateCmsMaintenanceBarUI();
        showAlert("Website is Live", "Maintenance Mode is now OFF. Customers can browse plans and submit applications.");
      },
      false
    );
  } else {
    openConfirmPopup(
      "Enable Public Website Maintenance Mode?",
      "Turning ON Maintenance Mode will temporarily pause customer access to the public website and application form until you turn it back off.",
      "Yes, Enable Maintenance Mode",
      async function () {
        setMaintenanceOn(true);
        if (currentManager) await dbAddLog(currentManager.email, "Enabled Maintenance Mode from Website Content (CMS)");
        await dbAddNotification(null, "agent", "Website Maintenance Mode Enabled", "Public Maintenance Mode is active while website content is being updated.");
        updateCmsMaintenanceBarUI();
      },
      true
    );
  }
}

function renderManagerApps() {
  var box = document.getElementById("mgr-apps-list");
  if (!box) return;
  var q = (document.getElementById("mgr-filter") ? document.getElementById("mgr-filter").value : "").trim().toLowerCase();

  var list = [];
  for (var i = 0; i < mgrApps.length; i++) {
    var a = mgrApps[i];
    if (activeMgrTab === "app-encoding" && a.status !== "Encoding") continue;
    if (activeMgrTab === "app-override" && a.status !== "Needs Correction") continue;
    if (activeMgrTab === "app-approved" && a.status !== "Approved" && a.status !== "Submitted to Provider") continue;
    if (activeMgrTab === "app-rejected" && a.status !== "Rejected") continue;
    if (q) {
      var hay = ((a.full_name || "") + " " + (a.reference_no || "") + " " + (a.assigned_agent || "") + " " + (a.city || "")).toLowerCase();
      if (hay.indexOf(q) === -1) continue;
    }
    list.push(a);
  }

  if (list.length === 0) {
    box.innerHTML = '<div class="card muted" style="text-align:center; padding:26px">No matching applications found in this view.</div>';
    return;
  }

  var html = "";
  for (var j = 0; j < list.length; j++) {
    var app = list[j];
    var scr = app.screening || {};
    var scrNote = "";
    if (isMgrScreeningActive(app) && scr.advisory) {
      scrNote = '<div class="muted" style="font-size:12px; margin-top:4px">' + escapeHtml(scr.advisory) + '</div>';
    } else if (scr.review_recommended && scr.suggested_summary) {
      scrNote = '<div class="muted" style="font-size:12px; margin-top:4px">Preliminary finding for Agent review: <b>' + escapeHtml(scr.suggested_summary) + '</b></div>';
    } else if (scr.auto_correction_sent && scr.auto_correction_reason) {
      scrNote = '<div class="muted" style="font-size:12px; margin-top:4px">Requested update from customer: <b>' + escapeHtml(scr.auto_correction_reason) + '</b></div>';
    }

    html +=
      '<div class="q-card">' +
        '<div class="q-head">' +
          '<div>' +
            '<div class="q-name">' + escapeHtml(app.full_name) + ' <span class="muted" style="font-weight:500; font-size:12px">(' + escapeHtml(app.reference_no) + ')</span></div>' +
            '<div class="q-sub" style="margin-top:6px; display:flex; gap:8px; align-items:center; flex-wrap:wrap">' +
              statusBadge(app.status) +
              getMgrScreeningBadge(app) +
              '<span class="badge badge-gray">Agent: ' + escapeHtml(app.assigned_agent || "Unassigned") + '</span>' +
              '<span class="muted">' + escapeHtml(app.plan_name) + ' - ' + escapeHtml(app.city || "") + '</span>' +
            '</div>' +
            scrNote +
          '</div>' +
          '<button type="button" class="btn btn-red btn-sm" onclick="openMgrAppModal(\'' + escapeHtml(app.id) + '\')">Manage / Override</button>' +
        '</div>' +
      '</div>';
  }
  box.innerHTML = html;
}

function findMgrApp(id) {
  for (var i = 0; i < mgrApps.length; i++) {
    if (mgrApps[i].id === id) return mgrApps[i];
  }
  return null;
}

function openMgrAppModal(appId) {
  activeMgrAppId = appId;
  var app = findMgrApp(appId);
  if (!app) return;

  var agents = [];
  for (var i = 0; i < mgrUsers.length; i++) {
    if (mgrUsers[i].role === "agent") agents.push(mgrUsers[i]);
  }
  var agentOpts = '<option value="">- Unassigned -</option>';
  for (var j = 0; j < agents.length; j++) {
    var ag = agents[j];
    var sel = app.assigned_agent === ag.email ? "selected" : "";
    agentOpts += '<option value="' + escapeHtml(ag.email) + '" ' + sel + '>' + escapeHtml(ag.full_name + " (" + ag.email + ")") + '</option>';
  }

  var scr = app.screening || {};
  var res = app.ai_result || {};
  var scrDetail = scr.advisory || ((res.issues && res.issues.length > 0) ? res.issues.join("; ") : "Document clear and details match.");
  var docLinksHtml = "";
  if (app.cropped_id_url || app.id_front_url) {
    docLinksHtml = '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px">';
    if (app.cropped_id_url) {
      docLinksHtml += '<a href="' + escapeHtml(app.cropped_id_url) + '" target="_blank" class="btn btn-outline btn-sm"><img data-img="icons/preview.png" src="https://wuunqfxyejxwrawtjdrf.supabase.co/storage/v1/object/public/website-assets/icons/preview.png" alt="Cropped ID (not available)" class="icon-img" />View Cropped and Enhanced ID</a>';
    }
    if (app.id_front_url) {
      docLinksHtml += '<a href="' + escapeHtml(app.id_front_url) + '" target="_blank" class="btn btn-outline btn-sm"><img data-img="icons/camera.png" src="https://wuunqfxyejxwrawtjdrf.supabase.co/storage/v1/object/public/website-assets/icons/camera.png" alt="Original ID (not available)" class="icon-img" />View Original Uploaded ID</a>';
    }
    docLinksHtml += '</div>';
  }

  document.getElementById("mgr-modal-title").textContent = app.reference_no + " - " + app.full_name;
  document.getElementById("mgr-modal-body").innerHTML =
    '<div class="grid-2">' +
      '<div class="kv">' +
        '<div><span>Internal Status</span><b>' + statusBadge(app.status) + '</b></div>' +
        '<div><span>Customer View</span><b>' + customerStatusBadge(app.status) + '</b></div>' +
        '<div><span>Screening</span><b>' + getMgrScreeningBadge(app) + '</b></div>' +
        '<div><span>Screening Note</span><b style="font-weight:500">' + escapeHtml(scrDetail) + '</b></div>' +
        '<div><span>Plan</span><b>' + escapeHtml(app.plan_name) + '</b></div>' +
        '<div><span>Email and Mobile</span><b>' + escapeHtml(app.email + " / " + app.phone) + '</b></div>' +
        '<div><span>Primary ID</span><b>' + escapeHtml(app.id_type + " - " + app.id_number) + '</b></div>' +
        '<div><span>Address</span><b>' + escapeHtml((app.street || "") + ", " + (app.barangay || "") + ", " + (app.city || "")) + '</b></div>' +
        docLinksHtml +
      '</div>' +
      '<div>' +
        '<div class="field"><label>Assign / Reassign Verification Agent</label><select id="mgr-assign-agent">' + agentOpts + '</select></div>' +
        '<div class="field">' +
          '<label>Application Status</label>' +
          '<select id="mgr-override-status">' +
            '<option value="Pending Review" ' + (app.status === "Pending Review" ? "selected" : "") + '>Pending Review (Customer sees Processing)</option>' +
            '<option value="Under Agent Review" ' + (app.status === "Under Agent Review" ? "selected" : "") + '>Under Agent Review (Customer sees Processing)</option>' +
            '<option value="Encoding" ' + (app.status === "Encoding" ? "selected" : "") + '>Encoding - Forwarded to Validator (Customer sees Processing)</option>' +
            '<option value="Approved" ' + (app.status === "Approved" ? "selected" : "") + '>Approved - Validator Approved</option>' +
            '<option value="Rejected" ' + (app.status === "Rejected" ? "selected" : "") + '>Rejected - Validator Rejected</option>' +
            '<option value="Needs Correction" ' + (app.status === "Needs Correction" ? "selected" : "") + '>Needs Correction (Branch inside Processing)</option>' +
          '</select>' +
        '</div>' +
        '<div class="field"><label>Manager Remarks</label><textarea id="mgr-remarks" rows="2">' + escapeHtml(app.agent_remarks || "") + '</textarea></div>' +
        '<button type="button" class="btn btn-red" style="width:100%" onclick="saveMgrOverride()">Save Assignment and Status Override</button>' +
      '</div>' +
    '</div>';

  document.getElementById("mgr-modal").classList.remove("hidden");
}

function closeMgrModal() {
  document.getElementById("mgr-modal").classList.add("hidden");
}

async function saveMgrOverride() {
  var app = findMgrApp(activeMgrAppId);
  if (!app) return;
  var agentEmail = document.getElementById("mgr-assign-agent").value;
  var newStatus = document.getElementById("mgr-override-status").value;
  var remarks = document.getElementById("mgr-remarks").value.trim();

  var effectiveRemarks = remarks || (newStatus === "Needs Correction" ? "Please sign in to your Customer Account to review and update your application details." : (app.agent_remarks || ""));

  await dbUpdateApplication(app.id, {
    assigned_agent: agentEmail,
    status: newStatus,
    agent_remarks: effectiveRemarks,
    correction_note: newStatus === "Needs Correction" ? effectiveRemarks : (app.correction_note || ""),
    customer_instruction: effectiveRemarks,
    encoded: (newStatus === "Encoding" || newStatus === "Approved" || newStatus === "Submitted to Provider") ? true : app.encoded
  });

  if (typeof dbRecordProviderUpdate === "function" && (newStatus === "Encoding" || newStatus === "Approved" || newStatus === "Rejected")) {
    await dbRecordProviderUpdate(app.id, app.provider_ref || "", newStatus, effectiveRemarks, effectiveRemarks);
  }

  await dbAddAiLog(app.id, app.reference_no, "Manager (" + currentManager.full_name + ")", "Manager set status to " + newStatus + " (Agent: " + (agentEmail || "Unassigned") + ")");
  await dbAddLog(currentManager.email, "Manager updated " + app.reference_no + " -> " + newStatus);

  if (agentEmail && agentEmail !== app.assigned_agent) {
    await dbAddNotification(
      agentEmail,
      "agent",
      "Application Assigned: " + app.reference_no,
      "Manager " + currentManager.full_name + " assigned application " + app.reference_no + " to your workspace queue."
    );
  }

  var shouldNotifyCust = (newStatus === "Needs Correction") || (newStatus !== app.status && (newStatus === "Approved" || newStatus === "Rejected"));
  if (shouldNotifyCust) {
    var custLabel = (newStatus === "Needs Correction") ? "Update Needed" : newStatus;
    var custEmail = (app.corrected_copy && app.corrected_copy.contact_email) || app.email;
    await dbAddNotification(
      custEmail,
      "customer",
      "Application " + custLabel + " (" + app.reference_no + ")",
      effectiveRemarks || ("Your application status has been updated to " + custLabel + ".")
    );
    if (newStatus === "Needs Correction") {
      await apiSendCorrectionEmail(
        custEmail,
        app.full_name,
        app.reference_no,
        effectiveRemarks,
        "Information / Document Clarification Required"
      );
    } else {
      await apiSendStatusEmail(custEmail, app.full_name, app.reference_no, newStatus, effectiveRemarks);
    }
  }

  closeMgrModal();
  await refreshManagerData();
  showAlert("Saved", "Application " + app.reference_no + " has been updated.");
}

function renderAgentPerformance() {
  var body = document.getElementById("mgr-agent-body");
  if (!body) return;
  var html = "";
  for (var i = 0; i < mgrUsers.length; i++) {
    var u = mgrUsers[i];
    if (u.role !== "agent") continue;
    var active = 0, fix = 0, done = 0, total = 0;
    for (var j = 0; j < mgrApps.length; j++) {
      var a = mgrApps[j];
      if (a.assigned_agent === u.email) {
        total++;
        if (a.status === "Pending Review" || a.status === "Under Agent Review") active++;
        else if (a.status === "Needs Correction") fix++;
        else if (a.status === "Encoding" || a.status === "Approved" || a.status === "Submitted to Provider") done++;
      }
    }
    html +=
      '<tr>' +
        '<td><b>' + escapeHtml(u.full_name) + '</b>' + (u.username ? '<div class="tiny muted">@' + escapeHtml(u.username) + '</div>' : '') + '</td>' +
        '<td>' + escapeHtml(u.email) + '</td>' +
        '<td><span class="badge badge-blue">' + active + '</span></td>' +
        '<td><span class="badge badge-yellow">' + fix + '</span></td>' +
        '<td><span class="badge badge-green">' + done + '</span></td>' +
        '<td><b>' + total + '</b></td>' +
      '</tr>';
  }
  body.innerHTML = html || '<tr><td colspan="6" class="muted">No agents found.</td></tr>';
}

async function generateManagerAgentInvite() {
  var noteEl = document.getElementById("mgr-invite-note");
  var note = noteEl ? noteEl.value.trim() : "";
  try {
    var res = await dbCreateAgentInviteLink(currentManager ? currentManager.email : "manager@pigem.ph", note || "Manager Private Agent Registration Invite");
    var url = getSiteBaseUrl() + "/agent-register.html?invite=" + encodeURIComponent(res.code);
    var wrap = document.getElementById("mgr-invite-output-wrap");
    var inp = document.getElementById("mgr-invite-url");
    if (inp) inp.value = url;
    if (wrap) wrap.classList.remove("hidden");
    if (noteEl) noteEl.value = "";
    showMsg("mgr-invite-msg", "ok", "Private Agent Registration Link (" + res.code + ") created! Share the URL below with your new agent.");
    await renderManagerLinks();
  } catch (err) {
    showMsg("mgr-invite-msg", "err", err.message || "Could not generate private registration link.");
  }
}

function copyManagerInviteUrl() {
  var inp = document.getElementById("mgr-invite-url");
  if (!inp || !inp.value) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(inp.value);
  } else {
    inp.select();
    document.execCommand("copy");
  }
  showAlert("Copied", "Private Agent Registration Link copied to clipboard.");
}

async function createAgentFromManager() {
  var fname = (document.getElementById("mgr-ag-fname").value || "").trim();
  var mname = (document.getElementById("mgr-ag-mname").value || "").trim();
  var lname = (document.getElementById("mgr-ag-lname").value || "").trim();
  var username = (document.getElementById("mgr-ag-username").value || "").trim().toLowerCase();
  var email = (document.getElementById("mgr-ag-email").value || "").trim().toLowerCase();
  var pass = document.getElementById("mgr-ag-pass").value;

  if (!fname || !lname || !username || !email || !pass) {
    showMsg("mgr-create-agent-msg", "err", "Please complete First Name, Last Name, Username, Official Email (@pigem.ph), and Password.");
    return;
  }
  if (!isValidUsername(username)) {
    showMsg("mgr-create-agent-msg", "err", "Username must be 3-30 characters using letters, numbers, underscores, dots, or hyphens.");
    return;
  }
  if (!isStaffBusinessEmail(email)) {
    showMsg("mgr-create-agent-msg", "err", "Agent accounts must use an official @pigem.ph email address.");
    return;
  }
  if (!isStrongPassword(pass)) {
    showMsg("mgr-create-agent-msg", "err", PASSWORD_REQUIREMENT_TEXT);
    return;
  }

  var fullName = [fname, mname, lname].filter(Boolean).join(" ");
  try {
    await dbCreateUserAccount(fullName, email, pass, "agent", username);
    if (currentManager) {
      await dbAddLog(currentManager.email, "Manager created Agent account: " + email + " (@" + username + ")");
    }
    document.getElementById("mgr-ag-fname").value = "";
    document.getElementById("mgr-ag-mname").value = "";
    document.getElementById("mgr-ag-lname").value = "";
    document.getElementById("mgr-ag-username").value = "";
    document.getElementById("mgr-ag-email").value = "";
    document.getElementById("mgr-ag-pass").value = "";
    showMsg("mgr-create-agent-msg", "ok", "Agent account created for " + fullName + " (@" + username + ").");
    await refreshManagerData();
  } catch (err) {
    showMsg("mgr-create-agent-msg", "err", err.message || "Could not create Agent account.");
  }
}

async function renderManagerLinks() {
  var body = document.getElementById("mgr-links-body");
  if (!body) return;
  var links = await dbListAgentLinks();
  if (links.length === 0) {
    body.innerHTML = '<tr><td colspan="5" class="muted">No agent registration invites or referral links created yet.</td></tr>';
    return;
  }
  var html = "";
  for (var i = 0; i < links.length; i++) {
    var l = links[i];
    var isInvite = String(l.code || "").indexOf("INV-") === 0;
    var typeBadge = "";
    var noteCol = escapeHtml(l.note || "");
    if (isInvite) {
      if (l.active !== false) {
        typeBadge = '<span class="badge badge-green">Private Agent Invite (Active)</span>';
        var inviteUrl = getSiteBaseUrl() + "/agent-register.html?invite=" + encodeURIComponent(l.code);
        noteCol += '<div class="tiny" style="margin-top:4px"><a href="' + escapeHtml(inviteUrl) + '" target="_blank" style="color:#175cd3; text-decoration:underline">' + escapeHtml(inviteUrl) + '</a></div>';
      } else {
        typeBadge = '<span class="badge badge-gray">Private Agent Invite (Used)</span>';
      }
    } else {
      typeBadge = '<span class="badge badge-blue">Customer Referral Link</span>';
    }
    html +=
      '<tr>' +
        '<td><b>' + escapeHtml(l.code) + '</b></td>' +
        '<td>' + typeBadge + '</td>' +
        '<td>' + escapeHtml(l.agent_email) + '</td>' +
        '<td>' + noteCol + '</td>' +
        '<td>' + formatDate(l.created_at) + '</td>' +
      '</tr>';
  }
  body.innerHTML = html;
}

function ensureFourSlides(slides, fallbackSlides) {
  var arr = (slides || []).slice();
  var fb = fallbackSlides || [];
  while (arr.length < 4) {
    var nextFb = fb[arr.length] || { tag: "PIGEM FIBER", image: "", title: "Slide " + (arr.length + 1), text: "Upload banner from library or enter description." };
    arr.push(Object.assign({}, nextFb));
  }
  return arr.slice(0, 4);
}

function loadAllCmsEditors() {
  var c = getSiteContent();
  var lib = c.asset_library || DEFAULT_CONTENT.asset_library;

  c.home_slides = ensureFourSlides(c.home_slides, DEFAULT_CONTENT.hero_slides);
  c.about_slides = ensureFourSlides(c.about_slides, DEFAULT_CONTENT.about_slides);
  renderSlideEditorList("cms-home-slides", "home", c.home_slides, lib.Banners || []);
  renderSlideEditorList("cms-about-slides", "about", c.about_slides, lib.Banners || []);

  renderMediaAssetsEditor(c);

  document.getElementById("cms-about-lead").value = c.about_lead || "";
  document.getElementById("cms-about-s1").value = c.about_story_1 || "";
  document.getElementById("cms-about-s2").value = c.about_story_2 || "";
  document.getElementById("cms-contact-email").value = c.contact_email || "";
  document.getElementById("cms-contact-phone").value = c.contact_phone || "";
  document.getElementById("cms-contact-addr").value = c.contact_address || "";

  var plansBox = document.getElementById("cms-plans-list");
  var plansHtml = "";
  var plans = c.plans || [];
  for (var i = 0; i < plans.length; i++) {
    var p = plans[i];
    plansHtml +=
      '<div class="card" style="margin-bottom:12px; background:var(--soft)">' +
        '<div class="grid-3">' +
          '<div class="field"><label>Plan Name</label><input id="pl-name-' + i + '" type="text" value="' + escapeHtml(p.name) + '" /></div>' +
          '<div class="field"><label>Speed (e.g. 100 Mbps)</label><input id="pl-speed-' + i + '" type="text" value="' + escapeHtml(p.speed) + '" /></div>' +
          '<div class="field"><label>Monthly Price (₱)</label><input id="pl-price-' + i + '" type="number" value="' + escapeHtml(p.price) + '" /></div>' +
        '</div>' +
        '<div class="field"><label>Features (comma-separated)</label><input id="pl-feat-' + i + '" type="text" value="' + escapeHtml((p.features || []).join(", ")) + '" /></div>' +
      '</div>';
  }
  plansBox.innerHTML = plansHtml;

  renderFaqEditorRows(c.faqs || []);
}

function renderSlideEditorList(boxId, prefix, slides, savedBanners) {
  var box = document.getElementById(boxId);
  if (!box) return;
  var html = "";
  for (var i = 0; i < slides.length; i++) {
    var s = slides[i];
    var currentImg = s.image || "";
    var allChoices = (savedBanners || []).slice();
    if (currentImg && allChoices.indexOf(currentImg) === -1) allChoices.unshift(currentImg);

    var optionsHtml = '<option value="">- No Banner Selected -</option>';
    for (var b = 0; b < allChoices.length; b++) {
      var path = allChoices[b];
      var label = path.indexOf("data:") === 0 ? ("Uploaded Image #" + (b + 1)) : path;
      var sel = (path === currentImg) ? "selected" : "";
      optionsHtml += '<option value="' + escapeHtml(path) + '" ' + sel + '>' + escapeHtml(label) + '</option>';
    }

    html +=
      '<div class="card" style="margin-bottom:10px; background:var(--soft)">' +
        '<div style="display:flex; gap:14px; align-items:flex-start; flex-wrap:wrap">' +
          '<img id="' + prefix + '-prev-' + i + '" src="' + escapeHtml(getImageUrl(currentImg)) + '" onerror="imageFallback(this, \'' + escapeHtml(currentImg) + '\')" alt="Slide ' + (i + 1) + '" style="width:140px; height:82px; object-fit:cover; border-radius:8px; border:1px solid var(--line); background:#111" />' +
          '<div style="flex:1; min-width:260px">' +
            '<div class="grid-3">' +
              '<div class="field"><label>Slide ' + (i + 1) + ' Tag</label><input id="' + prefix + '-tag-' + i + '" type="text" value="' + escapeHtml(s.tag || "") + '" /></div>' +
              '<div class="field"><label>Headline Title</label><input id="' + prefix + '-title-' + i + '" type="text" value="' + escapeHtml(s.title || "") + '" /></div>' +
              '<div class="field">' +
                '<label>Switch Saved Banner (' + allChoices.length + ' available)</label>' +
                '<select id="' + prefix + '-img-' + i + '" onchange="document.getElementById(\'' + prefix + '-prev-' + i + '\').src = getImageUrl(this.value)">' + optionsHtml + '</select>' +
              '</div>' +
            '</div>' +
            '<div class="field" style="margin-bottom:0"><label>Subtitle Text</label><input id="' + prefix + '-text-' + i + '" type="text" value="' + escapeHtml(s.text || "") + '" /></div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }
  box.innerHTML = html;
}

function renderMediaAssetsEditor(c) {
  var lib = c.asset_library || DEFAULT_CONTENT.asset_library;
  var logos = (lib.Logos || ["black-logo-white-mode.png", "white-logo-dark-mode.png"]).slice();

  var logoSelect = document.getElementById("cms-active-logo");
  var logoPrev = document.getElementById("cms-logo-preview");
  if (logoSelect && logoPrev) {
    var activeLogo = c.logo_image || "black-logo-white-mode.png";
    if (logos.indexOf(activeLogo) === -1) logos.unshift(activeLogo);
    logoSelect.innerHTML = logos.map(function (p, idx) {
      var lbl = p.indexOf("data:") === 0 ? ("Uploaded Logo #" + (idx + 1)) : p;
      return '<option value="' + escapeHtml(p) + '" ' + (p === activeLogo ? "selected" : "") + '>' + escapeHtml(lbl) + '</option>';
    }).join("");
    logoPrev.src = getImageUrl(activeLogo);
  }

  var darkLogoSelect = document.getElementById("cms-active-dark-logo");
  var darkLogoPrev = document.getElementById("cms-dark-logo-preview");
  if (darkLogoSelect && darkLogoPrev) {
    var activeDarkLogo = c.dark_logo_image || "white-logo-dark-mode.png";
    if (logos.indexOf(activeDarkLogo) === -1) logos.push(activeDarkLogo);
    darkLogoSelect.innerHTML = logos.map(function (p, idx) {
      var lbl = p.indexOf("data:") === 0 ? ("Uploaded Logo #" + (idx + 1)) : p;
      return '<option value="' + escapeHtml(p) + '" ' + (p === activeDarkLogo ? "selected" : "") + '>' + escapeHtml(lbl) + '</option>';
    }).join("");
    darkLogoPrev.src = getImageUrl(activeDarkLogo);
  }

  renderAssetCheckboxGallery("cms-clients-gallery", "client", lib.Clients || [], c.client_images || []);
  renderAssetCheckboxGallery("cms-vehicles-gallery", "vehicle", lib.Vehicles || [], c.vehicle_images || []);
  renderAssetCheckboxGallery("cms-permits-gallery", "permit", lib.Permits || [], c.permit_images || []);
}

function renderAssetCheckboxGallery(boxId, groupName, allSaved, activeList) {
  var box = document.getElementById(boxId);
  if (!box) return;
  var merged = (allSaved || []).slice();
  for (var i = 0; i < (activeList || []).length; i++) {
    if (merged.indexOf(activeList[i]) === -1) merged.push(activeList[i]);
  }
  var html = "";
  for (var j = 0; j < merged.length; j++) {
    var path = merged[j];
    var checked = (activeList || []).indexOf(path) !== -1 ? "checked" : "";
    var shortLabel = path.indexOf("data:") === 0 ? ("Uploaded #" + (j + 1)) : path;
    html +=
      '<label class="card" style="display:flex; align-items:center; gap:10px; padding:10px; cursor:pointer; margin:0">' +
        '<input type="checkbox" name="cms-asset-' + groupName + '" value="' + escapeHtml(path) + '" ' + checked + ' style="width:18px; height:18px" />' +
        '<img src="' + escapeHtml(getImageUrl(path)) + '" onerror="imageFallback(this, \'' + escapeHtml(path) + '\')" alt="" style="width:56px; height:42px; object-fit:contain; border:1px solid var(--line); border-radius:6px; background:#fff; padding:2px" />' +
        '<span style="font-size:12px; word-break:break-all">' + escapeHtml(shortLabel) + '</span>' +
      '</label>';
  }
  box.innerHTML = html;
}

async function uploadNewBucketAsset(category, fileInputId, msgId) {
  var inp = document.getElementById(fileInputId);
  var file = inp && inp.files ? inp.files[0] : null;
  if (!file) {
    showMsg(msgId, "err", "Please choose an image file from your computer first.");
    return;
  }
  try {
    showMsg(msgId, "info", "Uploading " + file.name + " to " + category + " library...");
    var savedPath = await dbUploadWebsiteAsset(file, category);
    var c = getSiteContent();
    if (category === "Logos") {
      c.logo_image = savedPath;
    } else if (category === "Clients") {
      c.client_images = c.client_images || [];
      if (c.client_images.indexOf(savedPath) === -1) c.client_images.push(savedPath);
    } else if (category === "Vehicles") {
      c.vehicle_images = c.vehicle_images || [];
      if (c.vehicle_images.indexOf(savedPath) === -1) c.vehicle_images.push(savedPath);
    } else if (category === "Permits") {
      c.permit_images = c.permit_images || [];
      if (c.permit_images.indexOf(savedPath) === -1) c.permit_images.push(savedPath);
    }
    saveSiteContent(c);
    inp.value = "";
    loadAllCmsEditors();
    showMsg(msgId, "ok", "Uploaded (" + savedPath + ")! It is now saved in your media library and ready to select.");
  } catch (e) {
    showMsg(msgId, "err", e.message || "Upload failed.");
  }
}

function saveMediaAssetsCms() {
  var c = getSiteContent();
  var logoSel = document.getElementById("cms-active-logo");
  var darkLogoSel = document.getElementById("cms-active-dark-logo");
  if (logoSel && logoSel.value) c.logo_image = logoSel.value;
  if (darkLogoSel && darkLogoSel.value) c.dark_logo_image = darkLogoSel.value;

  c.client_images = getCheckedAssetValues("client");
  c.vehicle_images = getCheckedAssetValues("vehicle");
  c.permit_images = getCheckedAssetValues("permit");

  saveSiteContent(c);
  loadPageImages();
  dbAddLog(currentManager.email, "Updated active Logos, Clients, Vehicles and Permits in Website Content (CMS)");
  showMsg("cms-assets-msg", "ok", "Active Website Assets saved! Click 'Preview Live Website' above to view.");
}

function getCheckedAssetValues(groupName) {
  var boxes = document.querySelectorAll('input[name="cms-asset-' + groupName + '"]:checked');
  var out = [];
  for (var i = 0; i < boxes.length; i++) out.push(boxes[i].value);
  return out;
}

function saveBannersCms() {
  var c = getSiteContent();
  c.home_slides = ensureFourSlides(c.home_slides, DEFAULT_CONTENT.hero_slides);
  c.about_slides = ensureFourSlides(c.about_slides, DEFAULT_CONTENT.about_slides);

  for (var i = 0; i < 4; i++) {
    c.home_slides[i].tag = document.getElementById("home-tag-" + i).value.trim();
    c.home_slides[i].title = document.getElementById("home-title-" + i).value.trim();
    c.home_slides[i].image = document.getElementById("home-img-" + i).value.trim();
    c.home_slides[i].text = document.getElementById("home-text-" + i).value.trim();
  }
  for (var j = 0; j < 4; j++) {
    c.about_slides[j].tag = document.getElementById("about-tag-" + j).value.trim();
    c.about_slides[j].title = document.getElementById("about-title-" + j).value.trim();
    c.about_slides[j].image = document.getElementById("about-img-" + j).value.trim();
    c.about_slides[j].text = document.getElementById("about-text-" + j).value.trim();
  }
  saveSiteContent(c);
  dbAddLog(currentManager.email, "Updated 4 Home and 4 About Hero Banners in Website Content (CMS)");
  showMsg("cms-banners-msg", "ok", "4-Slide Hero Banners saved! Click 'Preview Live Website' to inspect.");
}

function saveAboutCms() {
  var c = getSiteContent();
  c.about_lead = document.getElementById("cms-about-lead").value.trim();
  c.about_story_1 = document.getElementById("cms-about-s1").value.trim();
  c.about_story_2 = document.getElementById("cms-about-s2").value.trim();
  c.contact_email = document.getElementById("cms-contact-email").value.trim();
  c.contact_phone = document.getElementById("cms-contact-phone").value.trim();
  c.contact_address = document.getElementById("cms-contact-addr").value.trim();
  saveSiteContent(c);
  dbAddLog(currentManager.email, "Updated About PIGEM text in Website Content (CMS)");
  showMsg("cms-about-msg", "ok", "About PIGEM and Contact information saved!");
}

function savePlansCms() {
  var c = getSiteContent();
  for (var i = 0; i < c.plans.length; i++) {
    c.plans[i].name = document.getElementById("pl-name-" + i).value.trim();
    c.plans[i].speed = document.getElementById("pl-speed-" + i).value.trim();
    c.plans[i].price = Number(document.getElementById("pl-price-" + i).value) || c.plans[i].price;
    var feats = document.getElementById("pl-feat-" + i).value.split(",");
    var cleanFeats = [];
    for (var f = 0; f < feats.length; f++) {
      if (feats[f].trim()) cleanFeats.push(feats[f].trim());
    }
    c.plans[i].features = cleanFeats;
  }
  saveSiteContent(c);
  dbAddLog(currentManager.email, "Updated Red Fiber Plans in Website Content (CMS)");
  showMsg("cms-plans-msg", "ok", "Internet Plans saved!");
}

var currentEditingFaqs = [];

function renderFaqEditorRows(faqs) {
  currentEditingFaqs = faqs.slice();
  var box = document.getElementById("cms-faqs-list");
  var html = "";
  for (var i = 0; i < currentEditingFaqs.length; i++) {
    html +=
      '<div class="card" style="margin-bottom:10px; background:var(--soft)">' +
        '<div class="field"><label>Question #' + (i + 1) + '</label><input id="faq-q-' + i + '" type="text" value="' + escapeHtml(currentEditingFaqs[i].q) + '" /></div>' +
        '<div class="field"><label>Answer</label><textarea id="faq-a-' + i + '" rows="2">' + escapeHtml(currentEditingFaqs[i].a) + '</textarea></div>' +
      '</div>';
  }
  box.innerHTML = html;
}

function addFaqCmsRow() {
  syncFaqInputs();
  currentEditingFaqs.push({ q: "New Question?", a: "Write the answer here." });
  renderFaqEditorRows(currentEditingFaqs);
}

function syncFaqInputs() {
  for (var i = 0; i < currentEditingFaqs.length; i++) {
    var qEl = document.getElementById("faq-q-" + i);
    var aEl = document.getElementById("faq-a-" + i);
    if (qEl && aEl) {
      currentEditingFaqs[i].q = qEl.value.trim();
      currentEditingFaqs[i].a = aEl.value.trim();
    }
  }
}

function saveFaqsCms() {
  syncFaqInputs();
  var c = getSiteContent();
  c.faqs = currentEditingFaqs.filter(function (item) { return item.q !== ""; });
  saveSiteContent(c);
  dbAddLog(currentManager.email, "Updated FAQs in Website Content (CMS)");
  showMsg("cms-faqs-msg", "ok", "FAQs saved!");
}

function togglePromoTarget() {
  var t = document.getElementById("promo-target").value;
  var wrap = document.getElementById("promo-test-email-wrap");
  if (wrap) wrap.style.display = (t === "test") ? "block" : "none";
}

function clearSiteAnnouncement() {
  var c = getSiteContent();
  c.announcement = { active: false, headline: "", body: "" };
  saveSiteContent(c);
  if (currentManager) dbAddLog(currentManager.email, "Cleared public website announcement banner");
  showMsg("promo-msg", "ok", "Public website announcement banner has been cleared.");
}

async function sendManagerPromoBroadcast() {
  var btn = document.getElementById("btn-send-promo");
  var headline = document.getElementById("promo-headline").value.trim();
  var target = document.getElementById("promo-target").value;
  var body = document.getElementById("promo-body").value.trim();
  var recipient = document.getElementById("promo-recipient").value.trim().toLowerCase();

  if (!headline || !body) {
    showMsg("promo-msg", "error", "Please provide both an announcement headline and message.");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Publishing...";
  showMsg("promo-msg", "info", "Processing announcement...");

  try {
    var activePlans = getActivePlans().map(function (p) {
      return {
        name: p.name,
        speed: p.speed + " Mbps",
        price: "₱" + Number(p.price).toLocaleString("en-PH")
      };
    });

    if (target === "test") {
      if (!recipient || !isCustomerGmail(recipient)) {
        showMsg("promo-msg", "error", "Please enter a valid @gmail.com Customer email address.");
        return;
      }
      var res = await apiSendPromotionalEmail(recipient, "Valued Customer", headline, body, activePlans);
      if (res && res.sent) {
        showMsg("promo-msg", "ok", "Preview announcement email delivered via PIGEM Support Services to " + recipient + ".");
      } else {
        showMsg("promo-msg", "error", "Delivery failed: " + ((res && res.reason) || "Email service unavailable"));
      }
    } else if (target === "website_only") {
      var siteData = getSiteContent();
      siteData.announcement = { active: true, headline: headline, body: body };
      saveSiteContent(siteData);
      await dbAddNotification(null, "customer", headline, body);
      showMsg("promo-msg", "ok", "Announcement published on the public website banner and Customer Portal notifications.");
    } else {
      var siteAll = getSiteContent();
      siteAll.announcement = { active: true, headline: headline, body: body };
      saveSiteContent(siteAll);

      var optedEmails = {};
      var optedNames = {};
      for (var aIdx = 0; aIdx < mgrApps.length; aIdx++) {
        var ap = mgrApps[aIdx];
        var apEmail = String(ap.email || "").trim().toLowerCase();
        if (ap.agree_tu !== false && isCustomerGmail(apEmail)) {
          optedEmails[apEmail] = true;
          optedNames[apEmail] = ap.full_name || "Valued Subscriber";
        }
      }
      for (var uIdx = 0; uIdx < mgrUsers.length; uIdx++) {
        var u = mgrUsers[uIdx];
        var uEmail = String(u.email || "").trim().toLowerCase();
        if (u.role === "customer" && u.active !== false && isCustomerGmail(uEmail) && optedEmails[uEmail] === undefined) {
          optedEmails[uEmail] = true;
          optedNames[uEmail] = u.full_name || "Valued Subscriber";
        }
      }

      var targetList = Object.keys(optedEmails);
      var sentCount = 0;
      for (var k = 0; k < targetList.length; k++) {
        var cEmail = targetList[k];
        var mailOut = await apiSendPromotionalEmail(cEmail, optedNames[cEmail], headline, body, activePlans);
        if (mailOut && mailOut.sent) sentCount++;
        await dbAddNotification(cEmail, "customer", headline, body);
      }
      showMsg(
        "promo-msg",
        "ok",
        "Announcement published on the website and dispatched via PIGEM Support Services to " + sentCount + " opted-in @gmail.com Customer(s)."
      );
    }

    if (currentManager) {
      await dbAddLog(currentManager.email, "Published Announcement: '" + headline + "' (" + target + ")");
    }
  } catch (err) {
    showMsg("promo-msg", "error", "Error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Publish and Dispatch Announcement";
  }
}
