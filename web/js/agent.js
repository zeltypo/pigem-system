var currentAgent = null;
var allApps = [];
var agentLinks = [];
var activeBranch = "overview";
var activeAgentReportTab = "apps";
var activeDetailAppId = null;
var expandedSummaryCards = {};

window.openDashTabById = function (tabId, targetId) {
  var cleanTab = String(tabId || "").replace(/^tab-/, "");
  var targetApp = targetId ? findAppById(targetId) : null;
  if (targetApp && (!cleanTab || cleanTab === "apps" || cleanTab === "queue")) {
    var st = targetApp.status || "Pending Review";
    if (st === "Encoding") cleanTab = "encoding";
    else if (st === "Needs Correction") cleanTab = "correction";
    else if (st === "Approved" || st === "Submitted to Provider") cleanTab = "approved";
    else if (st === "Rejected") cleanTab = "rejected";
    else if (targetApp.assigned_agent && isAssignedToStaff(targetApp.assigned_agent, currentAgent)) cleanTab = targetApp.status === "Pending Review" ? "myqueue" : "claimed";
    else cleanTab = "queue";
  }
  if (cleanTab) {
    if (cleanTab === "apps") cleanTab = "queue";
    showTab(cleanTab);
  }
  if (targetApp) {
    openAppDetail(targetApp.id);
  }
};
var activeCopyMode = "latest";
var activePhotoCopyMode = "latest";
var activePersonalCopyMode = "latest";
var activeIdImgMode = "cropped";
var pendingProofDataUrl = "";
var pendingProofFile = null;
var lastDetectedFields = null;
var isScreeningServiceOnline = false;
var backgroundScreeningEnabled = false;
var lastScreeningAvailability = false;
var visualScreeningRunningAppId = null;
var visualScreeningStage = 0;

var FIELD_SUMMARY_LABELS = {
  auto: "Information / Document Clarification",
  name: "Applicant Name Update",
  birth_date: "Birth Date Confirmation",
  id_photo: "Clearer Valid ID Photo Upload",
  id_number: "Primary ID Number Verification",
  email: "Alternate Email Address",
  phone: "Alternate Mobile Number",
  email_or_phone: "Email and Mobile Number Update",
  address: "Complete Installation Address / Landmark"
};

function agentScreeningAvailable() {
  return navigator.onLine !== false && isAiEnabled() && isScreeningServiceOnline;
}

async function checkAgentScreeningService() {
  var health = navigator.onLine !== false && isAiEnabled() ? await apiCheckHealth() : null;
  isScreeningServiceOnline = Boolean(health?.auto_screening_ready);
  if (health) backgroundScreeningEnabled = health.background_screening === true;
  if (!agentScreeningAvailable()) activeScreeningJob?.cancel();
  var available = agentScreeningAvailable();
  if (lastScreeningAvailability !== available) {
    lastScreeningAvailability = available;
    refreshScreeningVisibility();
    if (available) {
      Object.keys(expandedSummaryCards).forEach(function (id) {
        if (expandedSummaryCards[id]) checkAgentQueueDocument(id);
      });
    }
  }
  var banner = document.getElementById("agent-screening-banner");
  if (banner) banner.classList.remove("hidden");
  return agentScreeningAvailable();
}

var VALIDATOR_PRESETS = [
  { label: "-- Select a Common Validator / Screening Remark --", raw: "", field: "auto", msg: "" },
  { label: "[Duplicate] Front and Back ID Photos are Identical", raw: "Uploaded Front ID and Back ID are the exact same photo", field: "id_photo", msg: "We noticed that the same photo was uploaded for both the Front and Back of your Valid ID. Please sign in to your Customer Account and upload a clear photo of the actual Front side and Back side of your Valid ID." },
  { label: "[Duplicate] Same Unclear ID Photo Re-Uploaded", raw: "Re-uploaded ID photo is identical to previous unclear image", field: "id_photo", msg: "The Valid ID photo you uploaded is identical to the previous unclear image. Please capture a new, well-lit photo of your physical Valid ID and upload it in your Customer Account." },
  { label: "[Quality] Blurry / Out-of-Focus Valid ID Text", raw: "Uploaded valid ID photo is blurry or unreadable", field: "id_photo", msg: "Your uploaded Valid ID photo is slightly blurry and the printed details could not be clearly read. Please upload a sharper photo of your Valid ID in a well-lit area." },
  { label: "[Quality] Flash Glare Covering Name or ID Number", raw: "Lighting glare covering text on valid ID", field: "id_photo", msg: "There is flash or lighting glare covering important text on your Valid ID. Please take a new photo without camera flash so all printed details are readable." },
  { label: "[Quality] ID Card Corners / Edges Cut Off", raw: "Valid ID corners or borders are cut off", field: "id_photo", msg: "Some edges of your Valid ID are cut off in the photo. Please upload a full photo showing all 4 corners of your physical ID card." },
  { label: "[Details Do Not Match] Applicant Name Does Not Match Printed ID", raw: "Applicant name entered does not match Valid ID", field: "name", msg: "The name entered on your application form does not match the legal name printed on your Valid ID. Please review and update your name in your Customer Account." },
  { label: "[Details Do Not Match] Birth Date Does Not Match Printed ID", raw: "Birth date entered does not match Valid ID", field: "birth_date", msg: "The birth date entered on your application form does not match the birth date printed on your Valid ID. Please verify and update your birth date." },
  { label: "[Details Do Not Match] Primary ID Number Mismatch", raw: "ID number entered does not match number printed on ID", field: "id_number", msg: "The ID number entered in the form does not match the number printed on your Valid ID card. Please check and update your ID number." },
  { label: "[Details Do Not Match] Selected ID Type Does Not Match Uploaded Card", raw: "Selected ID type does not match uploaded government ID", field: "id_photo", msg: "The Valid ID photo uploaded does not match the ID type selected in your form. Please upload the matching government ID or update your ID details." },
  { label: "[Validator] Duplicate Email in Provider Portal", raw: "Duplicate email address in provider portal", field: "email", msg: "Your email address is already linked to an existing record with the provider. Please provide an alternate active email address." },
  { label: "[Validator] Duplicate Mobile Number in Provider Portal", raw: "Mobile number already exists in provider system", field: "phone", msg: "The mobile number provided is already registered in the provider system. Please update your mobile number." },
  { label: "[Validator] Address Incomplete / Missing Nearest Landmark", raw: "Installation address missing street detail or landmark", field: "address", msg: "Please add a clearer street detail, house description, or nearest landmark to help our field team locate your installation address." }
];

var STATUS_INSTRUCTION_PRESETS = {
  "Under Agent Review": [
    { label: "Standard In-Review Instruction", text: "Your application and Valid ID requirements are currently being reviewed by our verification team." }
  ],
  "Encoding": [
    { label: "Standard Encoding Instruction (Forwarded to Provider)", text: "Your application requirements passed initial verification and are now being encoded into the provider system for facility and account validation." },
    { label: "Encoding Complete - Awaiting Validator Reference", text: "Your application has been encoded into the provider portal and is awaiting final validator confirmation and port assignment." }
  ],
  "Approved": [
    { label: "Approved - Standard 3 to 5 Days Installation Schedule", text: "Congratulations! Your application has been approved by the provider validator. Please allow 3 to 5 business days for installation scheduling and keep your mobile number open for our dispatch call." },
    { label: "Approved - Prepare Valid ID and Installation Fee on Dispatch", text: "Your fiber application is approved! Please prepare one (1) original Valid ID and the 50% discounted installation fee (PHP 1,000) upon the arrival of our installation technicians." },
    { label: "Approved - Priority Barangay Dispatch Queue", text: "Your application is approved and assigned to our local Dasmariñas field installation team. Expect a coordination call or SMS within 3 to 5 business days." }
  ],
  "Rejected": [
    { label: "Rejected - No Available Fiber Facility / NAP Port in Area", text: "We regret to inform you that your application could not be approved because all fiber NAP ports in your pinned street/subdivision are currently at full capacity." },
    { label: "Rejected - Outside Serviceable Fiber Coverage Area", text: "We regret to inform you that your pinned installation location is currently outside our active fiber distribution coverage area." },
    { label: "Rejected - Existing Unpaid Balance / Duplicate Account Record", text: "Your application did not pass provider validation due to an existing active or unsettled account record under the same subscriber details." },
    { label: "Rejected - Unverified / Invalid Identification Document", text: "Your application could not be approved because the submitted identification document did not pass final provider authentication." }
  ]
};

function renderStatusInstructionPresetOptions(statusValue) {
  var list = STATUS_INSTRUCTION_PRESETS[statusValue] || STATUS_INSTRUCTION_PRESETS["Encoding"];
  var html = '<option value="">-- Optional: Select a Common Instruction for ' + escapeHtml(statusValue) + ' (or type below) --</option>';
  for (var i = 0; i < list.length; i++) {
    html += '<option value="' + i + '">' + escapeHtml(list[i].label) + '</option>';
  }
  return html;
}

function onStatusSelectChange() {
  var stEl = document.getElementById("det-status-select");
  var presetEl = document.getElementById("det-status-preset");
  if (!stEl || !presetEl) return;
  presetEl.innerHTML = renderStatusInstructionPresetOptions(stEl.value);
}

function onStatusInstructionPresetChange(idxStr) {
  var stEl = document.getElementById("det-status-select");
  var remEl = document.getElementById("det-remarks");
  if (!stEl || !remEl || idxStr === "") return;
  var list = STATUS_INSTRUCTION_PRESETS[stEl.value] || [];
  var item = list[parseInt(idxStr, 10)];
  if (item && item.text) {
    remEl.value = item.text;
  }
}

function renderValidatorPresetOptions(filterText) {
  var term = String(filterText || "").toLowerCase().trim();
  var optionsHtml = "<option value=''>-- Select Common Validator / Screening Remark --</option>";

  for (var i = 1; i < VALIDATOR_PRESETS.length; i++) {
    var p = VALIDATOR_PRESETS[i];
    if (term) {
      var combined = (p.label + " " + p.raw + " " + p.msg).toLowerCase();
      if (combined.indexOf(term) === -1) continue;
    }
    optionsHtml += "<option value='" + i + "'>" + escapeHtml(p.label) + "</option>";
  }
  return optionsHtml;
}

function onValidatorPresetChange(val) {
  var idx = parseInt(val, 10);
  if (isNaN(idx) || idx <= 0 || idx >= VALIDATOR_PRESETS.length) return;

  var p = VALIDATOR_PRESETS[idx];
  var rawEl = document.getElementById("det-validator-raw");
  var fieldEl = document.getElementById("det-correction-field");
  var corrMsgEl = document.getElementById("det-correction-message");

  if (rawEl) rawEl.value = p.raw;
  if (fieldEl) fieldEl.value = p.field;
  if (corrMsgEl) corrMsgEl.value = p.msg;
}

function isScreeningActiveOnApp(app) {
  if (!app || !agentScreeningAvailable()) return false;
  var scr = app.screening || {};
  if (scr.manual_fallback || scr.state === "manual_fallback" || scr.background_state === "failed") return false;
  if (typeof getSavedAgentFindings === "function" && getSavedAgentFindings(app)) return false;
  var check = typeof getAgentAppIdCheck === "function" ? getAgentAppIdCheck(app, true) : null;
  if (check) return !check.result;
  var bgState = scr.background_state || "";
  if (bgState === "queued" || bgState === "running") return true;
  if (bgState === "completed" || scr.state === "completed") return false;
  return ["pending_agent", "checking", "layer1_running", "layer2_running"].includes(scr.state) || visualScreeningRunningAppId === app.id;
}

function getScreeningEtaLabel(app) {
  var scr = (app && app.screening) || {};
  return screeningTimeLabel(scr);
}

function formatEtaLabel(seconds) {
  var sec = Number(seconds || 0);
  if (!sec || sec <= 0) return "";
  if (sec >= 60) {
    var mins = Math.ceil(sec / 60);
    return "~" + mins + (mins === 1 ? " min" : " mins") + " left";
  }
  return "~" + sec + "s left";
}

function cleanScreeningText(str) {
  return String(str || "")
    .replace(/\bAI Screening Engine\b/gi, "Application Screening")
    .replace(/\bAI Document Screening\b/gi, "Application Screening")
    .replace(/\b(OpenCV|OpenAI|Gemini|FastAPI|Vercel|Qwen\S*|OCR|API|AI)\b/gi, "Screening")
    .replace(/\bScreening\s+Screening\b/gi, "Screening");
}

function detectClientSideDuplicateId(app) {
  if (!app) return { isDup: false, reason: "", type: "" };
  var scr = app.screening || {};
  var front = String(app.id_image_url || app.id_front_path || "").trim();
  var back = String(app.id_back_image_url || app.id_back_path || "").trim();
  if (front && back && front === back) {
    return {
      isDup: true,
      type: "front_back",
      reason: "Front ID and Back ID photos are identical. Separate photos of the Front and Back sides are required."
    };
  }
  if (scr.duplicate_check && scr.duplicate_check.has_duplicate) {
    if (scr.duplicate_check.front_equals_back) {
      return {
        isDup: true,
        type: "front_back",
        reason: "Uploaded Front ID and Back ID photos are the exact same image file."
      };
    }
    if (scr.duplicate_check.matched_other_refs && scr.duplicate_check.matched_other_refs.length > 0) {
      return {
        isDup: true,
        type: "cross_app",
        reason: "This exact ID photo was already submitted in application " + scr.duplicate_check.matched_other_refs.slice(0, 3).join(", ") + "."
      };
    }
    var origFront = app.original_submission ? String(app.original_submission.id_image_url || "").trim() : "";
    if (scr.duplicate_check.same_as_previous_upload && app.has_correction && origFront && front === origFront) {
      return {
        isDup: true,
        type: "reupload_same",
        reason: "Re-uploaded ID photo is identical to the previously flagged image."
      };
    }
  }
  for (var i = 0; i < allApps.length; i++) {
    var other = allApps[i];
    if (!other || other.id === app.id) continue;
    var oFront = String(other.id_image_url || other.id_front_path || "").trim();
    if (front && front.length > 40 && oFront === front && front.indexOf("logo.png") === -1) {
      return {
        isDup: true,
        type: "cross_app",
        reason: "Same ID photo was already submitted in application " + (other.reference_no || other.ref_no) + "."
      };
    }
  }
  return { isDup: false, reason: "", type: "" };
}

window.PORTAL_ALLOWED_ROLES = ["agent"];

window.addEventListener("DOMContentLoaded", async function () {
  currentAgent = await requireLogin(["agent"]);
  if (!currentAgent) return;

  var topUserEl = document.getElementById("top-user-name");
  if (topUserEl) topUserEl.textContent = currentAgent.full_name + " · Agent";
  var repDateEl = document.getElementById("rep-date");
  var repMonthEl = document.getElementById("rep-month");
  if (repDateEl && typeof getLocalTodayIso === "function") repDateEl.value = getLocalTodayIso();
  if (repMonthEl && typeof getLocalMonthIso === "function") repMonthEl.value = getLocalMonthIso();
  populateAgentReportFilters();
  await checkAgentScreeningService();
  await refreshAgentData();
  initDashUI(currentAgent, allApps, openAppDetail);

  setInterval(function () {
    checkAgentScreeningService();
  }, 20000);

  setInterval(async function () {
    if (visualScreeningRunningAppId) return;
    var anyRunning = false;
    for (var i = 0; i < allApps.length; i++) {
      if (isScreeningActiveOnApp(allApps[i])) {
        anyRunning = true;
        break;
      }
    }
    var activeTag = document.activeElement ? document.activeElement.tagName : "";
    var isTyping = (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT");

    if (anyRunning || !isTyping) {
      await refreshAgentData(true);
      var modal = document.getElementById("app-detail-modal");


    }
  }, 4500);
});

async function refreshAgentData(silent) {
  var previousApp = findAppById(activeDetailAppId);
  var previousScreening = JSON.stringify(previousApp && previousApp.screening);
  allApps = await dbListAllApplications();
  var currentApp = findAppById(activeDetailAppId);
  if (silent && currentApp && previousScreening !== JSON.stringify(currentApp.screening)) {
    await renderDetailModalContent(true);
  }
  updateDashSearchApps(allApps);

  var unclaimed = 0;
  var myClaimed = 0;
  var myQueue = 0;
  var encodingCount = 0;
  var fix = 0;
  var approvedCount = 0;
  var rejectedCount = 0;
  var planCounts = { "1000": 0, "1400": 0, "1900": 0 };

  for (var i = 0; i < allApps.length; i++) {
    var a = allApps[i];
    var st = a.status || "Pending Review";

    if (!a.assigned_agent && st === "Pending Review") unclaimed++;
    if (isAssignedToStaff(a.assigned_agent, currentAgent) && st === "Pending Review") myQueue++;
    if (isAssignedToStaff(a.assigned_agent, currentAgent) && st === "Under Agent Review") myClaimed++;
    if (!isAssignedToStaff(a.assigned_agent, currentAgent) && !(st === "Needs Correction" && !a.assigned_agent && a.screening?.auto_correction_sent)) continue;
    if (st === "Encoding") encodingCount++;
    if (st === "Needs Correction") fix++;
    if (st === "Approved") approvedCount++;
    if (st === "Rejected") rejectedCount++;

    var planStr = String(a.plan_name || a.plan_id || "");
    if (planStr.indexOf("1000") !== -1) planCounts["1000"]++;
    else if (planStr.indexOf("1400") !== -1) planCounts["1400"]++;
    else if (planStr.indexOf("1900") !== -1) planCounts["1900"]++;
  }

  var setTxt = function (id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setTxt("cnt-queue", unclaimed);
  setTxt("cnt-myqueue", myQueue);
  setTxt("cnt-claimed", myClaimed);
  setTxt("cnt-encoding", encodingCount);
  setTxt("cnt-correction", fix);
  setTxt("cnt-approved", approvedCount);
  setTxt("cnt-rejected", rejectedCount);

  setTxt("st-unclaimed", unclaimed);
  setTxt("st-myqueue", myQueue);
  setTxt("st-myclaimed", myClaimed);
  setTxt("st-encoding", encodingCount);
  setTxt("st-fix", fix);
  setTxt("st-approved", approvedCount);
  setTxt("st-rejected", rejectedCount);

  if (!silent) {
    renderPieChart("chart-agent-pie", [
      { label: "Unclaimed", value: unclaimed, color: "#64748b" },
      { label: "Claimed", value: myClaimed, color: "#2563eb" },
      { label: "Encoding", value: encodingCount, color: "#0284c7" },
      { label: "Needs Correction", value: fix, color: "#d97706" },
      { label: "Approved", value: approvedCount, color: "#15803d" },
      { label: "Rejected", value: rejectedCount, color: "#b91c1c" }
    ], "Queue");
    renderBars("chart-agent-bars", [
      { label: "Unclaimed", value: unclaimed, color: "#64748b" },
      { label: "Claimed", value: myClaimed, color: "#2563eb" },
      { label: "Encoding", value: encodingCount, color: "#0284c7" },
      { label: "Needs Correction", value: fix, color: "#d97706" },
      { label: "Approved", value: approvedCount, color: "#15803d" },
      { label: "Rejected", value: rejectedCount, color: "#b91c1c" }
    ]);
    renderColumns("chart-agent-cols", [
      { label: "Plan 1000", value: planCounts["1000"], color: "#c8102e" },
      { label: "Plan 1400", value: planCounts["1400"], color: "#0f172a" },
      { label: "Plan 1900", value: planCounts["1900"], color: "#2563eb" }
    ]);
    renderPieChart("chart-agent-plan-pie", [
      { label: "Plan 1000", value: planCounts["1000"], color: "#c8102e" },
      { label: "Plan 1400", value: planCounts["1400"], color: "#0f172a" },
      { label: "Plan 1900", value: planCounts["1900"], color: "#2563eb" }
    ], "Plans");
    renderCalendar("agent-calendar", allApps.filter(function (a) { return isAssignedToStaff(a.assigned_agent, currentAgent); }));
  }
  renderCalendar("agent-report-calendar", allApps.filter(function (a) { return isAssignedToStaff(a.assigned_agent, currentAgent); }));
  if (!silent || activeBranch === "myqueue" || activeBranch === "reports") await renderAgentLinks();

  renderAgentCards();
  if (activeBranch === "reports") renderAgentReport();
}

function showTab(branch) {
  if (branch === "encoded") branch = "encoding";
  if (branch === "links") branch = "myqueue";
  activeBranch = branch;
  var navIds = ["overview", "queue", "myqueue", "claimed", "encoding", "correction", "approved", "rejected", "reports"];
  for (var i = 0; i < navIds.length; i++) {
    var btn = document.getElementById("nav-" + navIds[i]);
    if (btn) btn.classList.toggle("active", navIds[i] === branch);
  }

  var pills = document.querySelectorAll("[data-pill]");
  for (var p = 0; p < pills.length; p++) {
    var isMatch = pills[p].getAttribute("data-pill") === branch;
    if (pills[p].classList.contains("sub-nav-btn")) {
      pills[p].classList.toggle("active", isMatch);
    } else {
      pills[p].classList.toggle("btn-red", isMatch);
      pills[p].classList.toggle("btn-outline", !isMatch);
    }
  }

  document.getElementById("tab-overview").classList.toggle("hidden", branch !== "overview");
  document.getElementById("agent-personal-link").classList.toggle("hidden", branch !== "myqueue");
  if (branch === "myqueue") renderAgentLinks();
  var repTabEl = document.getElementById("tab-reports");
  if (repTabEl) repTabEl.classList.toggle("hidden", branch !== "reports");

  var isAppBranch = (
    branch === "queue" || branch === "myqueue" ||
    branch === "claimed" ||
    branch === "encoding" ||
    branch === "correction" ||
    branch === "approved" ||
    branch === "rejected"
  );
  document.getElementById("tab-apps").classList.toggle("hidden", !isAppBranch);
  updateOverviewOnlyVisibility(branch === "overview");
  if (branch === "reports") renderAgentReport();

  if (isAppBranch) {
    var titles = {
      queue: ["Public Queue", "Unassigned applications available to any agent."],
      myqueue: ["My Queue", "Applications received through your personal link or assigned to you."],
      claimed: ["My Claimed Applications", "Applications claimed by you for Valid ID review and provider encoding."],
      encoding: ["Encoding Queue", "Verified applications forwarded to the provider portal and awaiting validator decision."],
      correction: ["Needs Correction", "Applications awaiting customer updates for an unclear ID or field discrepancy."],
      approved: ["Approved Applications", "Applications approved by the provider validator and scheduled for installation."],
      rejected: ["Rejected Applications", "Applications that did not pass provider validation."]
    };
    document.getElementById("apps-heading").textContent = titles[branch][0];
    document.getElementById("apps-subtitle").textContent = titles[branch][1];
    renderAgentCards();
  }
}

function getScreeningCardBadge(app) {
  var dup = detectClientSideDuplicateId(app);
  if (dup.isDup) {
    return '<span class="badge badge-red">Duplicate ID Photo Flagged</span>';
  }
  var scr = app.screening || {};
  var state = scr.state || "";
  if (!isAiEnabled() || !isScreeningServiceOnline || documentCheckUnavailable(app.id) || state === "unavailable" || state === "paused" || state === "manual_fallback" || scr.manual_fallback || scr.background_state === "failed" || scr.fallback_original_only) {
    return '<span class="badge badge-yellow">Manual Review Fallback</span>';
  }
  if (isScreeningActiveOnApp(app)) {
    var eta = screeningTimeLabel(scr);
    if (state === "layer2_running") {
      return '<span class="badge badge-blue">Cropping and Verifying' + (eta ? " (" + escapeHtml(eta) + ")" : "") + '</span>';
    }
    return '<span class="badge badge-blue">Screening in Progress' + (eta ? " (" + escapeHtml(eta) + ")" : "") + '</span>';
  }
  if (scr.overall_match === false || (scr.review_recommended && app.status !== "Approved" && app.status !== "Rejected")) {
    return '<span class="badge badge-yellow">Preliminary Finding - Review Needed</span>';
  }
  var res = app.ai_result || {};
  var st = res.overall_status || "Checked";
  if (st === "Verified" || scr.overall_match === true) {
    return '<span class="badge badge-green">Screening Passed</span>';
  }
  if (st.indexOf("Needs") !== -1) {
    return '<span class="badge badge-yellow">Review Recommended</span>';
  }
  return '<span class="badge badge-gray">Screening Checked</span>';
}

function stripFalseReuploadMsg(str, dup) {
  var s = String(str || "");
  if (!dup || !dup.isDup || dup.type !== "reupload_same") {
    s = s.replace(/Unchanged Re-Uploaded Image:[^.;]*[.;]?\s*/gi, "").trim();
  }
  return cleanScreeningText(s);
}

function agentBackgroundStatus(app) {
  if (!agentScreeningAvailable() || app?.screening?.manual_fallback || app?.screening?.state === "manual_fallback" || app?.screening?.background_state === "failed") {
    return "Manual Review Fallback — Automated screening is offline or unavailable. Compare the ID photos and applicant details manually below.";
  }
  var states = {
    queued: "Waiting for document check — " + getScreeningEtaLabel(app) + ".",
    running: (app?.screening?.phase || "Checking ID quality and details") + " — " + getScreeningEtaLabel(app) + ".",
    failed: "Manual Review Fallback — Automated document check could not finish. Inspect the ID photos and details manually."
  };
  return states[app?.screening?.background_state] || "Click Check documents to inspect the ID photos and run verification.";
}

function getScreeningQuickSummary(app) {
  var duplicate = detectClientSideDuplicateId(app);
  if (duplicate.isDup) return escapeHtml(duplicate.reason);
  var saved = getSavedAgentFindings(app);
  if (saved) {
    return escapeHtml(saved.queueSummary || summarizeAgentIdFindings(saved));
  }
  if (!agentScreeningAvailable() || app?.screening?.manual_fallback || app?.screening?.state === "manual_fallback" || app?.screening?.background_state === "failed") {
    return "Manual Review Fallback — Automated screening is offline or unavailable. Click Check documents to review the ID photos and details manually.";
  }
  if (app && app.screening && app.screening.summary && app.screening.state === "completed" && !app.has_correction) {
    return escapeHtml(app.screening.summary);
  }
  var check = getAgentAppIdCheck(app, true);
  if (check && check.result) {
    if (check.result.failed) {
      return "Manual Review Fallback — Automated check could not finish. Click Check documents to review the ID photos and details manually.";
    }
    return escapeHtml(check.result.queueSummary || summarizeAgentIdFindings(check.result));
  }
  if (check || isScreeningActiveOnApp(app)) return escapeHtml(getScreeningEtaLabel(app) + "…");
  if (backgroundScreeningEnabled) return escapeHtml(agentBackgroundStatus(app));
  return app.id_image_url || app.id_front_path ? "Click Check documents to run quality assessment & verification." : "No front ID photo is available.";
}

async function checkAgentQueueDocument(appId, button) {
  var app = findAppById(appId);
  if (!app) return;
  var check = getAgentAppIdCheck(app);
  if (!check) return;
  if (button) button.disabled = true;
  var node = document.getElementById("check-note-" + appId);
  if (node) node.textContent = getScreeningEtaLabel(app) + "…";
  renderAgentCards();
  var result = await check.pending;
  var summary = result.queueSummary || summarizeAgentIdFindings(result);
  node = document.getElementById("check-note-" + appId);
  if (node) node.textContent = summary;
  if (button) button.disabled = false;
  renderAgentCards();
}

function isAgentClaimable(app) {
  return app.status === "Pending Review" && !isScreeningActiveOnApp(app);
}

function getAgentQueueTone(app) {
  var dup = detectClientSideDuplicateId(app);
  if (dup.isDup && app.screening?.auto_correction_sent) return "red";
  if (dup.isDup) return "yellow";
  var saved = getSavedAgentFindings(app);
  if (saved && saved.triage) return saved.triage;
  if (app && app.screening && app.screening.triage) return app.screening.triage;
  if (app.status === "Needs Correction" || app.status === "Rejected") return "red";
  if (isScreeningActiveOnApp(app)) return "neutral";
  var check = getAgentAppIdCheck(app, true)?.result;
  if (check) {
    if (check.triage) return check.triage;
    if (agentFindingsReadyForReview(check)) return "green";
    return "yellow";
  }
  if (app.screening?.upload_photo_warning) return "yellow";
  return "neutral";
}

function openTriageQuestionPopup(appId) {
  var app = findAppById(appId);
  if (!app) return;
  var tone = getAgentQueueTone(app);
  var saved = getSavedAgentFindings(app) || (getAgentAppIdCheck(app, true) && getAgentAppIdCheck(app, true).result) || {};
  var summary = saved.queueSummary || (app.screening && app.screening.summary) || getScreeningQuickSummary(app);
  var finalRec = saved.finalRecommendation || (app.screening && app.screening.final_recommendation) || summarizeAgentIdFindings(saved);
  var sentMsg = app.agent_remarks || saved.suggestedPoliteRemark || (app.screening && app.screening.Suggested_remark) || "";
  var id = escapeHtml(app.id);

  if (tone === "red" && app.screening?.auto_correction_sent) {
    openPopup(
      '<div style="border-left:4px solid #dc2626; padding-left:12px">' +
        '<span class="badge badge-red" style="margin-bottom:6px">Automatic Needs Correction (PIGEM Screening)</span>' +
        '<h3>Why this application is marked Red (?)</h3>' +
        '<p class="mt" style="font-size:13.5px; line-height:1.5"><b>Screening Summary:</b> ' + escapeHtml(summary) + '</p>' +
        (finalRec ? '<p class="small muted mt"><b>Final Recommendation:</b> ' + escapeHtml(finalRec) + '</p>' : '') +
        (sentMsg ? '<div class="notice warn mt" style="font-size:12.5px"><b>Automatic Instruction Sent to Customer:</b><br>' + escapeHtml(sentMsg) + '</div>' : '') +
        '<p class="tiny muted mt">The system confirmed an objective upload problem, such as identical, blank, tiny or unreadable photos. No provider decision has been made. Wait for the customer to upload a replacement.</p>' +
      '</div>' +
      '<div class="row mt" style="gap:8px; justify-content:flex-end; flex-wrap:wrap">' +
        '<button type="button" class="btn btn-outline" onclick="closePopup()">Close</button>' +
        '<button type="button" class="btn btn-outline" data-id="' + id + '" onclick="closePopup(); openAppDetail(this.dataset.id, \'documents\')">Check documents</button>' +
        ((!app.assigned_agent || isAssignedToStaff(app.assigned_agent, currentAgent)) && isAgentClaimable(app)
          ? '<button type="button" class="btn btn-red" data-id="' + id + '" onclick="closePopup(); claimApplication(this.dataset.id)">Claim anyway</button>'
          : '') +
      '</div>'
    );
    return;
  }

  openPopup(
    '<div style="border-left:4px solid #d97706; padding-left:12px">' +
      '<span class="badge badge-yellow" style="margin-bottom:6px">Agent Decision Required (Yellow Tag)</span>' +
      '<h3>Please review this finding before claiming</h3>' +
      '<p class="mt" style="font-size:13.5px; line-height:1.5"><b>Screening Summary:</b> ' + escapeHtml(summary) + '</p>' +
      (finalRec ? '<p class="small muted mt"><b>Final Recommendation:</b> ' + escapeHtml(finalRec) + '</p>' : '') +
      '<p class="tiny muted mt">The applicant\'s submission is reasonable and was NOT automatically rejected. Please inspect the ID photo and details before deciding whether to claim for ISP Encoding or send a Needs Correction request.</p>' +
    '</div>' +
    '<div class="row mt" style="gap:8px; justify-content:flex-end; flex-wrap:wrap">' +
      '<button type="button" class="btn btn-outline" onclick="closePopup()">Cancel</button>' +
      '<button type="button" class="btn btn-outline" data-id="' + id + '" onclick="closePopup(); openAppDetail(this.dataset.id, \'documents\')">Check documents first</button>' +
      ((!app.assigned_agent || isAssignedToStaff(app.assigned_agent, currentAgent)) && isAgentClaimable(app)
        ? '<button type="button" class="btn btn-red" data-id="' + id + '" onclick="closePopup(); claimApplication(this.dataset.id)">Proceed &amp; Claim</button>'
        : '') +
    '</div>'
  );
}

function renderAgentCards() {
  var box = document.getElementById("agent-cards-box");
  if (!box || (document.activeElement && box.contains(document.activeElement) && document.activeElement.tagName === "SELECT")) return;
  var q = (document.getElementById("q-filter") ? document.getElementById("q-filter").value : "").trim().toLowerCase();

  var filtered = [];
  for (var i = 0; i < allApps.length; i++) {
    var a = allApps[i];
    var st = a.status || "Pending Review";

    if (activeBranch === "queue" && (a.assigned_agent || st !== "Pending Review")) continue;
    if (activeBranch !== "queue" && !isAssignedToStaff(a.assigned_agent, currentAgent) && !(activeBranch === "correction" && !a.assigned_agent && a.screening?.auto_correction_sent)) continue;
    if (activeBranch === "myqueue" && st !== "Pending Review") continue;
    if (activeBranch === "claimed" && st !== "Under Agent Review") continue;
    if (activeBranch === "encoding" && st !== "Encoding") continue;
    if (activeBranch === "correction" && st !== "Needs Correction") continue;
    if (activeBranch === "approved" && st !== "Approved") continue;
    if (activeBranch === "rejected" && st !== "Rejected") continue;

    if (q) {
      var hay = ((a.full_name || "") + " " + (a.reference_no || "") + " " + (a.city || "") + " " + (a.email || "")).toLowerCase();
      if (hay.indexOf(q) === -1) continue;
    }
    filtered.push(a);
  }

  if (filtered.length === 0) {
    box.innerHTML = '<div class="card muted" style="text-align:center; padding:28px">' +
      (q ? 'No applications match your search. Try a different name, reference number, city, or email.'
         : 'No applications in this view right now.') + '</div>';
    return;
  }

  var html = filtered.map(function (app) {
    var id = escapeHtml(app.id);
    var shared = activeBranch === "queue" || activeBranch === "myqueue";
    var owned = isAssignedToStaff(app.assigned_agent, currentAgent);
    var place = [app.barangay, app.city, app.province].filter(Boolean).join(", ");
    var tone = getAgentQueueTone(app);
    var running = isScreeningActiveOnApp(app);

    var actions = '<option value="">Choose an action</option><option value="documents">Check documents (PIGEM Screening)</option>';
    if (owned) {
      actions += '<option value="correction">Needs correction (PIGEM / ISP)</option><option value="status">ISP / Validator decision</option>' +
        '<option value="Encoding">ISP Encoding</option><option value="Approved">ISP Approved</option><option value="Rejected">ISP Rejected</option>';
    }

    var qMarkBtn = "";
    if (!running && (tone === "red" || tone === "yellow")) {
      var qStyle = tone === "red"
        ? "background:#fee2e2; color:#b91c1c; border:1.5px solid #dc2626; font-weight:800; border-radius:999px; width:28px; height:28px; padding:0; display:inline-flex; align-items:center; justify-content:center; cursor:pointer"
        : "background:#fef3c7; color:#b45309; border:1.5px solid #d97706; font-weight:800; border-radius:999px; width:28px; height:28px; padding:0; display:inline-flex; align-items:center; justify-content:center; cursor:pointer";
      var qTitle = tone === "red" && app.screening?.auto_correction_sent
        ? "Automatic Needs Correction sent — click to view details"
        : "Review needed before claiming — click to view findings";
      qMarkBtn = '<button type="button" aria-label="' + qTitle + '" title="' + qTitle + '" style="' + qStyle + '" data-id="' + id + '" onclick="openTriageQuestionPopup(this.dataset.id)">?</button>';
    }

    var publish = activeBranch === "myqueue" && owned && app.agent_link_code &&
      String(app.agent_id) === String(currentAgent.id)
      ? '<button type="button" class="btn btn-outline btn-sm" data-id="' + id + '" onclick="confirmReleaseReferral(this.dataset.id)">Move to Public Queue</button>' : "";
    var review = getSavedAgentFindings(app)?.uploadReview || getAgentAppIdCheck(app, true)?.result?.uploadReview;
    var nonIdPhoto = review?.kind === "not_id" || /does not appear to show an ID card/i.test(review?.finding || "");
    var correctionBadge = nonIdPhoto && ["Pending Review", "Under Agent Review"].includes(app.status)
      ? '<span class="badge badge-yellow" title="' + escapeHtml(review.finding) + '">ID photo needs correction</span>' : "";

    var control = "";
    if (running) {
      control = '<span class="badge badge-blue" role="status" style="display:inline-flex; align-items:center; gap:6px; padding:6px 10px">' +
        '<span class="inline-spinner" style="width:12px; height:12px"></span> ' + escapeHtml(getScreeningEtaLabel(app)) + '</span>';
    } else if (shared) {
      control = '<div class="row" style="gap:6px; align-items:center">' +
        qMarkBtn +
        '<button type="button" class="btn btn-red btn-sm" data-id="' + id + '" onclick="confirmAgentClaim(this.dataset.id)">Claim</button>' +
      '</div>';
    } else {
      control = '<div class="row" style="gap:6px; align-items:center">' +
        qMarkBtn +
        '<select class="agent-queue-action" aria-label="Application action" data-id="' + id + '" onchange="runAgentQueueAction(this)">' + actions + '</select>' +
      '</div>';
    }

    var corrTrackBadge = "";
    if (app.status === "Needs Correction") {
      var isAutoPigem = Boolean(app.screening && app.screening.auto_correction_sent);
      corrTrackBadge = isAutoPigem
        ? '<span class="badge badge-red">Auto Needs Correction (PIGEM Screening)</span>'
        : '<span class="badge badge-yellow">Needs Correction (Agent / ISP Validator)</span>';
    }

    return '<div class="q-card agent-queue-item queue-tone-' + tone + '"><div class="agent-queue-header"><details class="agent-queue-toggle" data-id="' + id + '"' + (expandedSummaryCards[app.id] ? " open" : "") +
      ' ontoggle="expandedSummaryCards[this.dataset.id] = this.open; if(this.open && !getAgentAppIdCheck(findAppById(this.dataset.id), true)) checkAgentQueueDocument(this.dataset.id)">' +
      '<summary aria-controls="queue-details-' + id + '"><strong>' + escapeHtml(app.full_name) + '</strong><span>' + escapeHtml(app.reference_no) + '</span></summary></details>' +
      '<div class="agent-queue-header-action">' + correctionBadge + control + publish + '</div></div>' +
      '<div class="agent-queue-details" id="queue-details-' + id + '">' +
        '<div class="agent-screening-note">' +
          '<div class="row between" style="align-items:center; gap:8px; flex-wrap:wrap">' +
            '<b>' + (agentScreeningAvailable() ? 'Screening summary' : 'Manual Review Fallback') + '</b>' +
            '<button type="button" class="btn btn-outline btn-sm" style="padding:2px 8px; font-size:11.5px; font-weight:700" data-id="' + id + '" onclick="openAppDetail(this.dataset.id, \'documents\')">Check documents &rarr;</button>' +
          '</div>' +
          '<div role="status" id="check-note-' + id + '" style="margin-top:4px">' + getScreeningQuickSummary(app) + '</div>' +
        '</div>' +
        '<p class="small muted">' + escapeHtml(app.plan_name || "Red Fiber Plan") + (place ? ' &bull; ' + escapeHtml(place) : '') +
          ' &bull; Submitted ' + escapeHtml(formatDate(app.created_at)) + '</p>' +
        '<div class="agent-queue-controls">' + statusBadge(app.status) + corrTrackBadge +
        (app.agent_link_code ? '<span class="badge badge-blue">Referral · ' + escapeHtml(app.agent_link_code) + '</span>' : '') +
        '</div>' +
      '</div></div>';
  }).join("");
  box.innerHTML = html;

}

function runAgentQueueAction(select) {
  var action = select.value;
  select.value = "";
  if (["Encoding", "Approved", "Rejected"].includes(action)) {
    openAppDetail(select.dataset.id, "status", action);
  } else if (action) {
    openAppDetail(select.dataset.id, action);
  }
}

function confirmAgentClaim(appId) {
  var app = findAppById(appId);
  if (!app || (app.assigned_agent && !isAssignedToStaff(app.assigned_agent, currentAgent)) || !isAgentClaimable(app)) return;
  if (isScreeningActiveOnApp(app)) {
    showAlert("Document check in progress", getScreeningEtaLabel(app) + ". Please wait for the preliminary findings before claiming.");
    return;
  }
  var tone = getAgentQueueTone(app);
  if (tone === "yellow" || tone === "red") {
    openTriageQuestionPopup(appId);
    return;
  }
  var id = escapeHtml(appId);
  openPopup(
    '<h3>Claim this application?</h3>' +
    '<p class="mt">Screening passed (Green). If you claim this application, you will be responsible for reviewing it and encoding to the ISP. Would you like to check the documents first?</p>' +
    '<div class="row mt" style="gap:8px;justify-content:flex-end;flex-wrap:wrap">' +
      '<button type="button" class="btn btn-outline" onclick="closePopup()">Cancel</button>' +
      '<button type="button" class="btn btn-outline" data-id="' + id + '" onclick="closePopup(); openAppDetail(this.dataset.id)">Check documents first</button>' +
      '<button type="button" class="btn btn-red" data-id="' + id + '" onclick="closePopup(); claimApplication(this.dataset.id)">Yes, claim</button>' +
    '</div>');
}

async function claimApplication(appId) {
  var app = findAppById(appId);
  if (!app || (app.assigned_agent && !isAssignedToStaff(app.assigned_agent, currentAgent)) || !isAgentClaimable(app)) return;
  var staffId = getStaffIdentifier(currentAgent);
  try {
    var claimed = await dbClaimApplication(appId, staffId, app.assigned_agent, app.status);
    if (!claimed) {
      showAlert("Application unavailable", "This application is no longer available to claim.");
      await refreshAgentData();
      return;
    }
    await dbAddLog(staffId, "Claimed application " + app.reference_no);
    await refreshAgentData();
    expandedSummaryCards[appId] = true;
    showTab("claimed");
  } catch (error) {
    showAlert("Could not claim", "Refresh the queue and try again.");
  }
}

function confirmReleaseReferral(appId) {
  var app = findAppById(appId);
  if (!app) return;
  openConfirmPopup("Move to Public Queue?", "Any agent will be able to claim this application.", "Move to Public Queue", async function () {
    try {
      if (!await dbReleaseReferralApplication(app, currentAgent)) {
        showAlert("Application unavailable", "Refresh My Queue and try again.");
        return;
      }
      await refreshAgentData();
      showTab("queue");
    } catch (error) {
      showAlert("Could not move application", "Refresh My Queue and try again.");
    }
  });
}

function findAppById(id) {
  for (var i = 0; i < allApps.length; i++) {
    if (allApps[i].id === id) return allApps[i];
  }
  return null;
}

var agentDetailMode = "documents";

async function openAppDetail(appId, mode, requestedStatus) {
  var record = findAppById(appId);
  if (!record) return;
  agentDetailMode = ["status", "correction"].includes(mode) && isAssignedToStaff(record.assigned_agent, currentAgent) ? mode : "documents";
  var exports = document.getElementById("det-export-actions");
  if (exports) exports.hidden = !agentScreeningAvailable() || agentDetailMode !== "documents";
  lastDetectedFields = null;
  activeDetailAppId = appId;
  activeCopyMode = "latest";
  activePhotoCopyMode = "latest";
  activePersonalCopyMode = "latest";
  var app = findAppById(appId);
  activeIdImgMode = "cropped";
  pendingProofDataUrl = "";
  pendingProofFile = null;
  await renderDetailModalContent();
  var statusSelect = document.getElementById("det-status-select");
  if (statusSelect && requestedStatus) {
    statusSelect.value = requestedStatus;
    var statusRemarks = document.getElementById("det-remarks");
    if (statusRemarks && requestedStatus !== record.status) statusRemarks.value = "";
    onStatusSelectChange();
  }
  document.getElementById("app-detail-modal").classList.remove("hidden");

}

function closeDetailModal() {
  agentDynamsoft.clear();
  document.getElementById("app-detail-modal").classList.add("hidden");
}

function switchCopyMode(mode, section) {
  if (section === "photo") activePhotoCopyMode = mode;
  else if (section === "personal") activePersonalCopyMode = mode;
  else {
    activeCopyMode = mode;
    activePhotoCopyMode = mode;
    activePersonalCopyMode = mode;
  }
  activeIdImgMode = activePhotoCopyMode === "original" ? "raw" : "cropped";
  renderDetailModalContent();
}

function switchIdImgMode(mode) {
  if (mode === "dynamsoft" && !agentDynamsoft.requestLicense()) {
    document.getElementById("photo-display-mode").value = activeIdImgMode;
    return;
  }
  activeIdImgMode = mode;
  renderDetailModalContent();
}

function renderVisualScreeningProgressBox(app) {
  if (!isAiEnabled() || !isScreeningServiceOnline || documentCheckUnavailable(app.id)) return "";
  if (!["pending_agent", "queued", "checking"].includes((app.screening || {}).state)) return "";

  return '<div class="screening-live-box" role="status" aria-live="polite" style="margin-bottom:14px">' +
    '<span class="inline-spinner"></span> <b>' +
    ((app.screening || {}).state === "checking" ? "Checking documents..." : "Waiting for the document check...") + '</b>' +
    '<div class="small muted">Reading both ID photos and comparing the application details. Please wait for the saved result.</div></div>';
}


function normalizeAgentBirthDate(value) {
  var months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  function monthNumber(name) {
    return months.findIndex(function (month) { return month === name || month.slice(0, 3) === name; }) + 1;
  }
  var text = value.trim().toUpperCase();
  var year, month, day;
  var iso = text.match(/^(\d{4})[-/. ](\d{1,2})[-/. ](\d{1,2})$/);
  var dayFirst = text.match(/^(\d{1,2})[\s-]+([A-Z]{3,9})[\s,-]+(\d{4})$/);
  var monthFirst = text.match(/^([A-Z]{3,9})[\s-]+(\d{1,2}),?[\s-]+(\d{4})$/);
  var numeric = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (iso) [, year, month, day] = iso;
  else if (dayFirst) {
    [, day, month, year] = dayFirst;
    month = monthNumber(month);
  } else if (monthFirst) {
    [, month, day, year] = monthFirst;
    month = monthNumber(month);
  } else if (numeric && (Number(numeric[1]) > 12 || Number(numeric[2]) > 12 || numeric[1] === numeric[2])) {
    year = numeric[3];
    day = Number(numeric[1]) > 12 ? numeric[1] : numeric[2];
    month = Number(numeric[1]) > 12 ? numeric[2] : numeric[1];
  } else return "";
  var date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) return "";
  return date.toISOString().slice(0, 10);
}

var agentIdLabels = {
  name: "full name|name|pangalan",
  given: "given names?|first name|mga pangalan",
  middle: "middle name|gitnang apelyido",
  family: "last name|surname|family name|apelyido",
  birth_date: "date of birth|birth date|birthdate|d\\.?o\\.?b\\.?|petsa ng kapanganakan|petsa ng pagsilang",
  id_number: "(?:student id|id card|id|student|license|passport|document|pcn|crn)[ \\t]*(?:number|no\\.?|#)|(?:pcn|crn)"
};
var agentIdOtherLabels = "date of issue|date of expiry|expiration date|expiry date|address|address of residence|sex|gender|nationality|signature|blood type";
var agentIdLabelLine = new RegExp("^(?:" + Object.values(agentIdLabels).concat(agentIdOtherLabels).join("|") + ")(?:$|[:.\u2013\u2014 \\t-])", "i");

function readAgentIdLabelValues(lines, key) {
  var label = agentIdLabels[key];
  var pattern = new RegExp("^(?:" + label + ")(?:[ \\t]*[:.\u2013\u2014-][ \\t]*(.*)|[ \\t]+(.*)|)$", "i");
  return lines.reduce(function (values, line, index) {
    if (!line || !agentIdLabelLine.test(line)) return values;
    var match = line.match(pattern);
    if (!match) return values;
    var candidate = (match[1] || match[2] || "").trim();

    if (!candidate && lines[index + 1] && !agentIdLabelLine.test(lines[index + 1])) candidate = lines[index + 1];
    if (candidate) values.push(candidate);
    return values;
  }, []);
}

function compareAgentIdFields(text, expected) {
  var lines = String(text || "").split(/\r?\n/).map(function (line) { return line.trim(); });
  var given = readAgentIdLabelValues(lines, "given");
  var family = readAgentIdLabelValues(lines, "family");
  var middle = readAgentIdLabelValues(lines, "middle");
  var checks = [
    { key: "name", label: "Name", entered: expected.name },
    { key: "birth_date", label: "Birth date", entered: expected.birth },
    { key: "id_number", label: "ID number", entered: expected.number }
  ];
  function normalizeName(value) {
    var comma = value.split(",").map(function (part) { return part.trim(); });
    var ordered = comma.length === 2 ? comma[1] + " " + comma[0] : value;
    return ordered.normalize("NFC").trim().toUpperCase().replace(/\s+/g, " ");
  }
  return checks.map(function (field) {
    var values = readAgentIdLabelValues(lines, field.key);
    var partialName = false;
    if (field.key === "name" && !values.length && given.length === 1 && family.length === 1 && middle.length <= 1) {
      values.push([given[0], middle[0], family[0]].filter(Boolean).join(" "));
      partialName = !middle.length;
    }
    var normalize = field.key === "birth_date" ? normalizeAgentBirthDate : field.key === "name" ? normalizeName :
      function (value) { return value.toUpperCase().replace(/[\s-]+/g, ""); };
    var candidates = new Map(values.filter(function (value) {
      if (field.key === "name") return !/^of\s/i.test(value) && /^[\p{L} .,'’-]+$/u.test(value) && value.trim().includes(" ");
      if (field.key === "id_number") return /^[a-z0-9\s-]+$/i.test(value) && /\d/.test(value);
      return true;
    }).map(function (value) { return [normalize(value), value]; }).filter(function (entry) { return entry[0]; }));
    var entered = normalize(String(field.entered || ""));
    var result = { key: field.key, label: field.label, status: "unreadable" };
    if (!entered || candidates.size !== 1) return result;
    var entry = candidates.entries().next().value;
    var found = entry[0];
    if (found !== entered && partialName) return result;
    function similarId(value) { return value.replace(/O/g, "0").replace(/[IL]/g, "1"); }
    if (field.key === "id_number" && found !== entered && similarId(found) === similarId(entered)) return result;
    return { key: field.key, label: field.label, status: found === entered ? "match" : "difference", found: entry[1] };
  });
}

function describeAgentIdField(field) {
  if (field.status === "match") return field.label + ": Matches";
  if (field.status === "difference") return field.label + ": Check difference" + (field.found ? " (photo reads " + field.found + ")" : "");
  return field.label + ": Could not verify";
}

function compareAgentIdDetails(text, expected) {
  return compareAgentIdFields(text, expected).map(describeAgentIdField);
}

var agentDocumentChecks = new Map();
var agentOpenCv;

function loadAgentOpenCv() {
  if (!agentOpenCv) {
    agentOpenCv = new Promise(function (resolve) {
      var script = document.createElement("script");
      var timeout = setTimeout(function () { script.remove(); resolve(null); }, 20000);
      script.src = "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.11.0-release.1/dist/opencv.js";
      script.integrity = "sha256-WtIp0mZvzmgDo69KVpEhvW2o0J1cFk26+w1/dYRgwl4=";
      script.crossOrigin = "anonymous";
      script.onload = function () {
        Promise.resolve(window.cv).then(function (cv) {
          if (cv && typeof cv.Mat === "function") { clearTimeout(timeout); resolve(cv); }
        }).catch(function () { clearTimeout(timeout); resolve(null); });
      };
      script.onerror = function () { clearTimeout(timeout); resolve(null); };
      document.head.appendChild(script);
    });
  }
  var loading = agentOpenCv;
  loading.then(function (cv) {
    if (!cv && agentOpenCv === loading) agentOpenCv = null;
  });
  return loading;
}

function getAgentCardShape(points, cols, rows) {
  var sums = points.slice().sort(function (a, b) { return a.x + a.y - b.x - b.y; });
  var differences = points.slice().sort(function (a, b) { return a.x - a.y - b.x + b.y; });
  var ordered = [sums[0], differences[3], sums[3], differences[0]];
  if (new Set(ordered).size !== 4 || ordered.some(function (point) {
    return point.x < 3 || point.y < 3 || point.x >= cols - 3 || point.y >= rows - 3;
  })) return null;

  var distance = function (a, b) { return Math.hypot(a.x - b.x, a.y - b.y); };
  var top = distance(ordered[0], ordered[1]);
  var bottom = distance(ordered[3], ordered[2]);
  var left = distance(ordered[0], ordered[3]);
  var right = distance(ordered[1], ordered[2]);
  var width = (top + bottom) / 2;
  var height = (left + right) / 2;
  var aspect = Math.max(width, height) / Math.min(width, height);
  if (aspect < 1.12 || aspect > 2.35 || Math.min(top, bottom) / Math.max(top, bottom) < 0.52 ||
      Math.min(left, right) / Math.max(left, right) < 0.52) return null;
  return { points: ordered, width: width, height: height };
}

function agentCardBoundaryEvidence(gray, shape) {
  var points = shape.points;
  var center = points.reduce(function (total, point) {
    return { x: total.x + point.x / 4, y: total.y + point.y / 4 };
  }, { x: 0, y: 0 });
  var support = 0;
  var step = Math.max(5, Math.round(Math.min(shape.width, shape.height) * 0.025));
  function pixel(x, y) {
    x = Math.max(0, Math.min(gray.cols - 1, Math.round(x)));
    y = Math.max(0, Math.min(gray.rows - 1, Math.round(y)));
    return gray.data[y * gray.cols + x];
  }
  for (var i = 0; i < 4; i++) {
    var point = points[i];
    var next = points[(i + 1) % 4];
    [0.25, 0.5, 0.75].forEach(function (ratio) {
      var x = point.x + ratio * (next.x - point.x);
      var y = point.y + ratio * (next.y - point.y);
      var length = Math.hypot(center.x - x, center.y - y);
      if (!length) return;
      var dx = (center.x - x) * step / length;
      var dy = (center.y - y) * step / length;
      if (Math.abs(pixel(x + dx, y + dy) - pixel(x - dx, y - dy)) >= 7) support++;
    });
  }
  return { support: support, center: center };
}

function findAgentIdCorners(gray, cv) {
  var enhanced = new cv.Mat();
  var blurred = new cv.Mat();
  var mask = new cv.Mat();
  var hierarchy = new cv.Mat();
  var polygon = new cv.Mat();
  var kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  var clahe = new cv.CLAHE(2.5, new cv.Size(8, 8));
  var frameArea = gray.cols * gray.rows;
  var best = null;
  var bestScore = 0;

  function scanMask() {
    var contours = new cv.MatVector();
    try {
      cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel);
      cv.findContours(mask, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      for (var i = 0; i < contours.size(); i++) {
        var contour = contours.get(i);
        try {
          var area = cv.contourArea(contour);
          if (area < frameArea * 0.05 || area > frameArea * 0.96) continue;

          var perimeter = cv.arcLength(contour, true);
          var candidateShapes = [];
          for (var tolerance of [0.015, 0.022, 0.035, 0.05, 0.065]) {
            cv.approxPolyDP(contour, polygon, tolerance * perimeter, true);
            if (polygon.rows === 4 && cv.isContourConvex(polygon)) {
              var pts = [];
              for (var j = 0; j < 4; j++) pts.push({ x: polygon.data32S[j * 2], y: polygon.data32S[j * 2 + 1] });
              var sh = getAgentCardShape(pts, gray.cols, gray.rows);
              if (sh) candidateShapes.push(sh);
            }
          }
          if (!candidateShapes.length && area >= frameArea * 0.06 && area <= frameArea * 0.90 && typeof cv.minAreaRect === "function" && typeof cv.RotatedRect === "function" && typeof cv.RotatedRect.points === "function") {
            try {
              var rRect = cv.minAreaRect(contour);
              var rw = rRect.size.width;
              var rh = rRect.size.height;
              if (rw > 70 && rh > 70 && (area / (rw * rh)) >= 0.78) {
                var rPts = cv.RotatedRect.points(rRect);
                var shRect = getAgentCardShape(rPts, gray.cols, gray.rows);
                if (shRect) candidateShapes.push(shRect);
              }
            } catch (e) {}
          }
          for (var sIdx = 0; sIdx < candidateShapes.length; sIdx++) {
            var shape = candidateShapes[sIdx];
            if (area < shape.width * shape.height * 0.68) continue;
            var evidence = agentCardBoundaryEvidence(blurred, shape);
            if (evidence.support < 5) continue;
            var score = area * (0.6 + evidence.support / 12);
            if (score <= bestScore) continue;
            bestScore = score;
            best = {
              points: shape.points.flatMap(function (point) {
                return [
                  Math.max(0, Math.min(gray.cols - 1, evidence.center.x + (point.x - evidence.center.x) * 1.04)),
                  Math.max(0, Math.min(gray.rows - 1, evidence.center.y + (point.y - evidence.center.y) * 1.04))
                ];
              }),
              width: Math.round(shape.width * 1.04),
              height: Math.round(shape.height * 1.04)
            };
          }
        } finally {
          contour.delete();
        }
      }
    } finally {
      contours.delete();
    }
  }

  try {

    clahe.apply(gray, enhanced);
    cv.GaussianBlur(enhanced, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, mask, 20, 65);
    scanMask();
    if (!best) {
      cv.Canny(blurred, mask, 9, 32);
      scanMask();
    }
    if (!best) {
      cv.adaptiveThreshold(blurred, mask, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 21, 5);
      scanMask();
    }
    if (!best) {
      cv.threshold(blurred, mask, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
      scanMask();
    }
    if (!best) {
      cv.threshold(blurred, mask, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
      scanMask();
    }
    return best;
  } finally {
    [enhanced, blurred, mask, hierarchy, polygon, kernel, clahe].forEach(function (item) { item.delete(); });
  }
}

async function enhanceAgentIdPhoto(photo, cv) {
  if (!cv || typeof createImageBitmap !== "function") return null;
  var bitmap = await createImageBitmap(photo);
  var canvas = document.createElement("canvas");
  var scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  try {
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  } finally {
    bitmap.close();
  }

  var mats = [];
  function mat() {
    var result = new cv.Mat();
    mats.push(result);
    return result;
  }
  try {
    var image = cv.imread(canvas);
    mats.push(image);
    var gray = mat();
    var contrast = mat();
    var soft = mat();
    var sharpened = mat();
    cv.cvtColor(image, gray, cv.COLOR_RGBA2GRAY);
    var corners = findAgentIdCorners(gray, cv);
    var color = image;
    if (corners) {
      var w = corners.width;
      var h = corners.height;
      var originalPoints = cv.matFromArray(4, 1, cv.CV_32FC2, corners.points);
      var outputPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w - 1, 0, w - 1, h - 1, 0, h - 1]);
      mats.push(originalPoints, outputPoints);
      var transform = cv.getPerspectiveTransform(originalPoints, outputPoints);
      mats.push(transform);
      color = mat();
      cv.warpPerspective(image, color, transform, new cv.Size(w, h));
      cv.cvtColor(color, gray, cv.COLOR_RGBA2GRAY);
    }
    var source = gray;
    var meanLight = cv.mean(source)[0];
    var adjustedLight = meanLight < 105 || meanLight > 205;
    if (adjustedLight) {
      var levels = Array.from({ length: 256 }, function (_, value) {

        return Math.round(255 * Math.pow(value / 255, meanLight < 105 ? 0.75 : 1.2));
      });
      var lut = cv.matFromArray(1, 256, cv.CV_8U, levels);
      mats.push(lut);
      var brighter = mat();
      cv.LUT(source, lut, brighter);
      source = brighter;
    }
    var clahe = new cv.CLAHE(2, new cv.Size(8, 8));
    mats.push(clahe);
    clahe.apply(source, contrast);
    cv.GaussianBlur(contrast, soft, new cv.Size(3, 3), 0);
    cv.addWeighted(contrast, 1.23, soft, -0.23, 0, sharpened);
    var originalLight = gray.data;
    var enhancedLight = sharpened.data;
    var pixels = color.data;
    for (var i = 0, pixel = 0; i < originalLight.length; i++, pixel += 4) {
      var adjustment = enhancedLight[i] - originalLight[i];
      for (var channel = 0; channel < 3; channel++) {
        var index = pixel + channel;
        pixels[index] = Math.max(0, Math.min(255, pixels[index] + adjustment));
      }
    }
    cv.imshow(canvas, color);
    var cleanedBlob = await new Promise(function (resolve) {
      if (typeof canvas.toBlob === "function") {
        canvas.toBlob(function (b) { resolve(b); }, "image/jpeg", 0.92);
      } else {
        resolve(null);
      }
    });
    return { canvas: canvas, blob: cleanedBlob, cropped: Boolean(corners), lightingAdjusted: adjustedLight };
  } finally {
    mats.forEach(function (item) { item.delete(); });
  }
}

function withAgentReadTimeout(work, milliseconds) {
  var timer;
  return Promise.race([
    work,
    new Promise(function (_, reject) {
      timer = setTimeout(function () { reject(new Error("Document check timed out")); }, milliseconds);
    })
  ]).finally(function () { clearTimeout(timer); });
}

var agentPreparedPhotos = new Map();

function prepareAgentIdPhoto(url, photo) {
  if (!document.head) return Promise.resolve(null);
  if (!agentPreparedPhotos.has(url)) {
    var preparation = (async function () {
      try {
        if (!photo) {
          var response = await withAgentReadTimeout(fetch(url, { referrerPolicy: "no-referrer" }), 10000);
          if (!response.ok) return null;
          photo = await withAgentReadTimeout(response.blob(), 10000);
        }
        return await enhanceAgentIdPhoto(photo, await loadAgentOpenCv());
      } catch (error) {
        return null;
      }
    })();
    agentPreparedPhotos.set(url, preparation);
    if (agentPreparedPhotos.size > 8) agentPreparedPhotos.delete(agentPreparedPhotos.keys().next().value);
    preparation.then(function (result) {
      if (!result && agentPreparedPhotos.get(url) === preparation) agentPreparedPhotos.delete(url);
    });
  }
  return agentPreparedPhotos.get(url);
}

function showAgentPreparedPhoto(container) {
  var image = container.querySelector("img");
  var status = container.querySelector("[data-photo-status]");
  var url = container.dataset.photo;
  if (!image || !status || !url) return;
  var app = findAppById(activeDetailAppId);
  var current = getAgentPreviewCopy(app, activePhotoCopyMode);
  var findings = activePhotoCopyMode === "latest" ? getSavedAgentFindings(app) : current.screening_findings;
  var side = container.dataset.photoSide || "front";
  var preparation = findings && findings.stages && findings.stages.photoPreparation && findings.stages.photoPreparation[side];
  if (activeIdImgMode === "dynamsoft") {
    var rotation = preparation?.applied_ops?.find(function (op) { return op.startsWith("rotate_"); });
    agentDynamsoft.show(container, image, status, url, rotation);
    return;
  }
  var previousCrop = preparation?.cropped && preparation.crop_verified !== true;
  var preview = previousCrop ? "" : preparation?.preview_data_url;
  image.src = activePhotoCopyMode !== "original" && activeIdImgMode === "cropped" && preview ? preview : url;
  var usingPreview = image.src === preview;
  image.dataset.suggestedCrop = String(Boolean(usingPreview && preparation.suggested_preview_crop));
  if (usingPreview && preparation.suggested_preview_crop) {
    status.textContent = "Suggested crop for reading. Compare with the original to confirm all details are visible.";
    return;
  }
  status.textContent = usingPreview
    ? (preparation.cropped ? "Cropped reading copy" : "Adjusted reading copy")
    : "Original uploaded photo";
  if (activeIdImgMode === "cropped" && activePhotoCopyMode !== "original" && (previousCrop || preparation?.crop_status === "edges_uncertain")) {
    status.textContent += ". Full image kept because the card edges could not be confirmed.";
  }
}

var agentDocumentTypes = [
  { label: "Driver's License", choice: /driver|lto/i, heading: /^driver'?s licen[cs]e$/im },
  { label: "National ID", choice: /national|philsys/i, heading: /^(?:philippine identification card|philippine identification system|national id)$/im },
  { label: "Passport", choice: /passport/i, heading: /^(?:passport|pasaporte)$/im },
  { label: "Student ID", choice: /student/i, heading: /^(?:student id|student identification card)$/im },
  { label: "Postal ID", choice: /postal/i, heading: /^(?:postal id|postal identity card)$/im },
  { label: "UMID", choice: /umid/i, heading: /^(?:umid|unified multi-purpose id)$/im }
];

function compareAgentDocumentType(text, selected) {
  var choice = agentDocumentTypes.find(function (type) { return type.choice.test(selected || ""); });
  var evidence = agentDocumentTypes.filter(function (type) { return type.heading.test(text); });
  if (!choice || evidence.length !== 1 || evidence[0] === choice) return "";
  return evidence[0].label;
}

async function areSameAgentPhotos(front, back) {
  if (!front || !back || !front.size || front.size !== back.size ||
      typeof front.arrayBuffer !== "function" || typeof back.arrayBuffer !== "function") return false;
  try {
    var bytes = await withAgentReadTimeout(Promise.all([front.arrayBuffer(), back.arrayBuffer()]), 3000);
    var left = new Uint8Array(bytes[0]);
    var right = new Uint8Array(bytes[1]);
    return left.every(function (value, index) { return value === right[index]; });
  } catch (error) {
    return false;
  }
}

async function collectAgentIdFindings(sources, expected, job) {
  var unclearSides = [];
  var unavailableSides = [];
  var failedReads = [];
  var photoIssues = [];

  var sessionStatus = await apiCheckScreeningSession(job.controller.signal);
  if (sessionStatus !== 200) {
    return { fields: [], unclearSides: [], unavailableSides: [], failedReads: ["Staff session"],
      accessDenied: sessionStatus === 401 || sessionStatus === 403 };
  }

  var photos = sources.map(async function (side) {
    try {
      var options = { referrerPolicy: "no-referrer", signal: job.controller.signal };
      var response = await withAgentReadTimeout(fetch(side.url, options), 30000);
      if (!response.ok) return null;
      return await withAgentReadTimeout(response.blob(), 30000);
    } catch (error) {
      return null;
    }
  });

  try {
    if (job.expired || job.controller.signal.aborted) throw new Error("Document check cancelled");
    var frontRaw = await photos[0];
    var backRaw = sources.length > 1 ? await photos[1] : null;
    if (!frontRaw) {
      unavailableSides.push(sources[0] ? sources[0].label : "Front");
      return { fields: [], unclearSides: [], unavailableSides: unavailableSides, failedReads: [] };
    }
    if (sources.length > 1 && !backRaw) {
      return { fields: [], unclearSides: [], unavailableSides: [sources[1].label], failedReads: [] };
    }

    var duplicatePhotos = sources.length === 2 && backRaw && await areSameAgentPhotos(frontRaw, backRaw);
    var frontUpload = frontRaw;
    var backUpload = (!duplicatePhotos && backRaw) ? backRaw : null;

    var screenData = await withAgentReadTimeout(
      apiRunScreening(frontUpload, {
        full_name: expected.name || "",
        birth_date: expected.birth || "",
        id_type: expected.type || "",
        id_number: expected.number || "",
        previous_response_id: expected.previous_response_id || "",
        browserPreparedFront: false,
        browserPreparedBack: false,
        id_back: backUpload
      }, backUpload, job.controller.signal),
      100000
    );

    if (!screenData || screenData.status === "offline" || !(screenData.ocr && screenData.ocr.available)) {
      return {
        fields: [
          { key: "name", label: "Name", status: "unreadable" },
          { key: "birth_date", label: "Birth date", status: "unreadable" },
          { key: "id_number", label: "ID number", status: "unreadable" }
        ],
        unclearSides: unclearSides,
        unavailableSides: unavailableSides,
        failedReads: ["IDP service"],
        accessDenied: [401, 403].includes(screenData?.status_code),
        uploadTooLarge: screenData?.status_code === 413,
        duplicatePhotos: duplicatePhotos,
        photoIssues: photoIssues
      };
    }

    var ocr = screenData.ocr || {};
    if (ocr.front_readable === false) unclearSides.push("Front");
    if (backUpload && ocr.back_readable === false) unclearSides.push("Back");

    var comps = Array.isArray(screenData.comparisons) ? screenData.comparisons : [];
    function mapField(key, label) {
      var foundComp = comps.find(function (c) { return c.key === key; });
      if (!foundComp) return { key: key, label: label, status: "unreadable" };
      if (foundComp.status === "match") {
        return { key: key, label: label, status: "match", found: foundComp.found_on_id };
      }
      if (foundComp.status === "mismatch") {
        return { key: key, label: label, status: "difference", found: foundComp.found_on_id };
      }
      return { key: key, label: label, status: "unreadable" };
    }

    var mappedFields = [
      mapField("name", "Name"),
      mapField("birth_date", "Birth date"),
      mapField("id_number", "ID number")
    ];

    var detectedOtherType = "";
    if (ocr.id_type_matches_declared === false && ocr.detected_document_type) {
      detectedOtherType = ocr.detected_document_type;
    } else if (ocr.lines && ocr.lines.length) {
      detectedOtherType = compareAgentDocumentType(ocr.lines.join("\n"), expected.type);
    }

    var aiObj = screenData.ai || {};
    var nlpObj = screenData.nlp_validation || {};
    var qualObj = screenData.quality || {};
    if (Array.isArray(qualObj.issues) && qualObj.issues.length && (qualObj.verdict !== "good" || qualObj.upload_review)) {
      photoIssues = qualObj.issues.slice();
    }

    return {
      route: screenData.route || qualObj.verdict || "good",
      triage: screenData.triage || aiObj.triage || "yellow",
      autoNeedsCorrection: Boolean(aiObj.auto_needs_correction),
      correctionType: aiObj.correction_type || "none",
      targetFields: aiObj.target_fields || [],
      queueSummary: aiObj.queue_summary || "",
      finalRecommendation: aiObj.final_recommendation || "",
      openaiResponseId: screenData.openai_response_id || aiObj.response_id || "",
      fields: mappedFields,
      unclearSides: unclearSides,
      unavailableSides: unavailableSides,
      failedReads: failedReads,
      duplicatePhotos: Boolean(duplicatePhotos || qualObj.duplicate_front_back),
      photoIssues: photoIssues,
      uploadReview: qualObj.upload_review || null,
      detectedOtherType: detectedOtherType,
      stages: {
        checkId: screenData.check_id || "",
        qualityGate: {
          model: qualObj.model || "gpt-6.2-sol",
          verdict: qualObj.verdict || "good",
          score: qualObj.quality_score != null ? qualObj.quality_score : 85
        },
        photoPreparation: qualObj.preprocessed || null,
        extraction: {
          provider: ocr.provider || "",
          earlyStopped: Boolean(ocr.early_stopped),
          frontReadable: ocr.front_readable === true,
          backReadable: backUpload ? ocr.back_readable === true : null
        },
        validation: "completed",
        messageDraft: aiObj.available === true ? "generated" : "standard"
      },
      nlpValidation: nlpObj,
      aiRecommendation: aiObj.recommendation || "",
      aiFindings: Array.isArray(aiObj.findings) ? aiObj.findings : [],
      tamperingFlags: Array.isArray(aiObj.tampering_flags) ? aiObj.tampering_flags : [],
      suggestedPoliteRemark: aiObj.suggested_polite_remark || ""
    };
  } catch (error) {
    return { fields: [], unclearSides: [], unavailableSides: [], failed: true };
  }
}

var agentScreeningQueue = Promise.resolve();
var activeScreeningJob = null;

function showScreeningConnection(message) {
  var notice = document.getElementById("screening-connection");
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "screening-connection";
    notice.className = "notice warn";
    notice.setAttribute("role", "status");
    document.getElementById("agent-cards-box")?.before(notice);
  }
  notice.textContent = message;
}

function refreshScreeningVisibility() {
  renderAgentCards();
  if (activeDetailAppId && !document.getElementById("app-detail-modal")?.classList.contains("hidden")) {
    renderDetailModalContent(true);
  }
}

window.addEventListener("offline", function () {
  lastScreeningAvailability = false;
  refreshScreeningVisibility();
  showScreeningConnection("Connection lost. Document checking is paused.");
  activeScreeningJob?.cancel();
});

window.addEventListener("online", async function () {
  await checkAgentScreeningService();
  if (!agentScreeningAvailable()) return;
  showScreeningConnection("Connection restored. Retrying open document checks.");
  agentDocumentChecks.forEach(function (check, key) {
    if (check.result?.failed || check.result?.unavailableSides?.length || check.result?.failedReads?.length) {
      agentDocumentChecks.delete(key);
    }
  });
  Object.keys(expandedSummaryCards).forEach(function (id) {
    if (expandedSummaryCards[id]) checkAgentQueueDocument(id);
  });
  if (activeDetailAppId && !document.getElementById("app-detail-modal")?.classList.contains("hidden")) {
    renderDetailModalContent(true);
  }
});

function runAgentIdCheck(sources, expected) {
  var next = agentScreeningQueue.then(function () { return runAgentIdCheckNow(sources, expected); });
  agentScreeningQueue = next.catch(function () {});
  return next;
}

async function runAgentIdCheckNow(sources, expected) {
  if (!agentScreeningAvailable()) {
    return { fields: [], unclearSides: [], unavailableSides: [], failedReads: [], failed: true, offline: true };
  }
  var job = { expired: false, worker: null, terminated: false, controller: new AbortController() };
  var cancelled = new Promise(function (_, reject) {
    job.cancel = function () { reject(new Error("Connection lost")); };
  });
  activeScreeningJob = job;
  try {
    return await withAgentReadTimeout(Promise.race([collectAgentIdFindings(sources, expected, job), cancelled]), 140000);
  } catch (error) {
    job.expired = true;
    return { fields: [], unclearSides: [], unavailableSides: [], failedReads: [], failed: true,
      offline: navigator.onLine === false, timedOut: navigator.onLine !== false };
  } finally {
    job.controller.abort();
    if (job.worker && !job.terminated) {
      job.terminated = true;
      Promise.resolve(job.worker.terminate()).catch(function () {});
    }
    if (activeScreeningJob === job) activeScreeningJob = null;
  }
}

function agentFindingsReadyForReview(result) {
  return !result.failed && !result.unavailableSides?.length && !result.failedReads?.length &&
    result.fields.length === 3 && result.fields.every(function (field) { return field.status === "match"; }) &&
    !result.unclearSides?.length && !result.photoIssues?.length && !result.duplicatePhotos &&
    !result.detectedOtherType && !result.tamperingFlags?.length &&
    result.nlpValidation?.age_eligible !== false && !result.nlpValidation?.is_expired &&
    result.nlpValidation?.id_format_valid !== false &&
    (!result.aiRecommendation || result.aiRecommendation === "approve");
}

function summarizeAgentIdFindings(result) {
  if (result.uploadTooLarge) return "The ID photos are too large to send for checking. Try smaller clear copies.";
  if (result.accessDenied) return "Screening access is missing or expired. Sign in again with your screening-enabled username or ask your administrator to enable it.";
  if (result.offline) return "Connection lost. Document checking will resume when you are online.";
  if (result.unavailableSides?.length || result.failedReads?.length) {
    return "Document check incomplete. The photo could not be downloaded or read. Reopen the application to retry.";
  }
  if (result.timedOut) return "The document check took too long. Reopen this application to try again, or check the original photos.";
  if (result.failed) return "The IDP screening service could not finish. Refresh and reopen the application, or check the original photos.";
  if (result.uploadReview?.finding) return result.uploadReview.finding + " Check the original uploads before requesting a correction.";
  var notes = [];
  var unclear = result.unclearSides || [];
  var differences = result.fields.filter(function (field) { return field.status === "difference"; });
  var labels = differences.map(function (field) { return field.label.toLowerCase(); }).join(", ");
  if (result.nlpValidation?.age_eligible === false) {
    notes.push("Applicant does not meet the age requirement. Confirm before deciding.");
  } else if (unclear.length && differences.length) {
    notes.push("Some ID text is unreadable. Review the readable differences (" + labels + ") and request a clearer photo first.");
  } else if (unclear.length) {
    notes.push("ID text is unreadable. Check the marked photo before comparing details.");
  } else if (differences.length) {
    notes.push("Details to review: " + labels + ".");
  } else if (result.duplicatePhotos || result.detectedOtherType || result.nlpValidation?.is_expired ||
             result.nlpValidation?.id_format_valid === false || result.tamperingFlags?.length) {
    notes.push("ID needs review. See the findings below.");
  }
  if (result.duplicatePhotos) notes.push("Front and back contain the same photo. Check the back upload.");
  if (result.detectedOtherType) notes.push("The photo appears to show a " + result.detectedOtherType + ". Check the selected ID type.");
  if (result.nlpValidation) {
    if (result.nlpValidation.age_eligible === false && result.nlpValidation.age_note) notes.push(result.nlpValidation.age_note);
    if (result.nlpValidation.is_expired && result.nlpValidation.expiry_note) notes.push(result.nlpValidation.expiry_note);
    if (result.nlpValidation.id_format_valid === false && result.nlpValidation.id_format_note) notes.push(result.nlpValidation.id_format_note);
  }
  if (result.tamperingFlags && result.tamperingFlags.length) {
    notes.push(result.tamperingFlags.join(" "));
  }
  if (result.unclearSides.length) notes.push(result.unclearSides.join(" and ") + " ID photo" + (result.unclearSides.length > 1 ? "s: Printed text could not be read. Check the photos." : ": Printed text could not be read. Check the photo."));
  if (result.unavailableSides.length) notes.push(result.unavailableSides.join(" and ") + " photo could not be opened.");
  if (result.photoIssues && result.photoIssues.length) notes.push(result.photoIssues.join(" "));

  if (notes.length) {
    if (result.fields.some(function (field) { return field.key === "birth_date" && field.status === "unreadable"; })) {
      notes.push("Birth date could not be verified. Check the original ID; if no date is printed, ask for an ID that shows it.");
    }
    return notes.join(" ");
  }
  if (agentFindingsReadyForReview(result)) {
    return "Name, birth date, and ID number match. Ready for Agent review.";
  }
  var unreadable = result.fields.filter(function (field) { return field.status === "unreadable"; });
  if (!unreadable.length) return "Manual review recommended. Compare the ID with the application before proceeding.";
  if (unreadable.length === 1 && unreadable[0].key === "birth_date") {
    return "Birth date could not be verified. Check the original ID; if no date is printed, ask for an ID that shows it.";
  }
  return "Could not verify " + unreadable.map(function (field) { return field.label.toLowerCase(); }).join(", ") + ". Check the printed details on the ID.";
}

function getAgentIdCheck(front, back, expected, existingOnly, revisionKey) {
  if (!agentScreeningAvailable()) return null;
  var sources = [{ label: "Front", url: front }, { label: "Back", url: back }].filter(function (side) { return side.url; });
  if (!sources.length) return null;
  var key = JSON.stringify([revisionKey || "", sources, expected]);
  var existing = agentDocumentChecks.get(key);
  if (existingOnly) return existing;
  if (!existing || (existing.retryAt && existing.retryAt <= Date.now())) {
    var check = { result: null };

    check.pending = runAgentIdCheck(sources, expected).then(function (result) {
      if (result.failed || result.unavailableSides.length || (result.failedReads || []).length) check.retryAt = Date.now() + 15000;
      check.result = result;
      return result;
    });
    agentDocumentChecks.set(key, check);
    if (agentDocumentChecks.size > 40) agentDocumentChecks.delete(agentDocumentChecks.keys().next().value);
  }
  return agentDocumentChecks.get(key);
}

var agentScreeningWrites = new Set();

function agentScreeningRevision(app) {
  return (app.corrected_copy && app.corrected_copy.submitted_at) || app.created_at;
}

function getSavedAgentFindings(app) {
  if (!app || !app.screening) return null;
  var rev = agentScreeningRevision(app);
  var stored = app.screening.browser_check;
  if (stored && stored.reader_version === 5 && stored.revision === rev && stored.findings) {
    return stored.findings;
  }
  if (app.screening.background_state === "completed" && app.screening.background_findings) {
    if (app.corrected_copy && app.corrected_copy.submitted_at) {
      if (app.screening.background_revision === rev) {
        return app.screening.background_findings;
      }
      return null;
    }
    return app.screening.background_findings;
  }
  return null;
}

function buildSavedAgentFindings(result) {
  return {
    route: result.route || "good",
    triage: result.triage || (agentFindingsReadyForReview(result) ? "green" : "yellow"),
    autoNeedsCorrection: Boolean(result.autoNeedsCorrection),
    correctionType: result.correctionType || "none",
    targetFields: result.targetFields || [],
    queueSummary: result.queueSummary || "",
    finalRecommendation: result.finalRecommendation || "",
    openaiResponseId: result.openaiResponseId || "",
    fields: result.fields.map(function (field) {
      return { key: field.key, label: field.label, status: field.status };
    }),
    unclearSides: result.unclearSides,
    unavailableSides: [],
    failedReads: [],
    duplicatePhotos: Boolean(result.duplicatePhotos),
    detectedOtherType: result.detectedOtherType || "",
    photoIssues: result.photoIssues || [],
    uploadReview: result.uploadReview || null,
    stages: result.stages || null,
    nlpValidation: result.nlpValidation || null,
    aiRecommendation: result.aiRecommendation || "",
    aiFindings: result.aiFindings || [],
    tamperingFlags: result.tamperingFlags || [],
    suggestedPoliteRemark: result.suggestedPoliteRemark || ""
  };
}

async function saveAgentFindings(app, result) {
  if (!currentAgent || !app || !app.updated_at || !agentScreeningRevision(app) || getSavedAgentFindings(app)) return;
  var isFailedOrOffline = Boolean(
    !agentScreeningAvailable() ||
    result.failed ||
    result.offline ||
    result.timedOut ||
    (result.unavailableSides && result.unavailableSides.length) ||
    (result.failedReads && result.failedReads.length)
  );
  var version = agentScreeningRevision(app);
  var key = app.id + "|" + version;
  if (agentScreeningWrites.has(key)) return;
  agentScreeningWrites.add(key);
  try {
    if (isFailedOrOffline) {
      var fallbackMsg = "Manual Review Fallback — Automated document check could not finish. Please inspect the ID photos and applicant details manually.";
      var fbScreening = Object.assign({}, app.screening || {}, {
        state: "manual_fallback",
        background_state: "failed",
        manual_fallback: true,
        eta_seconds: 0,
        summary: fallbackMsg,
        final_recommendation: fallbackMsg
      });
      var fbSaved = await dbUpdateApplication(app.id, { screening: fbScreening }, app.updated_at).catch(function () { return null; });
      if (fbSaved) {
        app.screening = fbSaved.screening;
        app.updated_at = fbSaved.updated_at;
      } else {
        app.screening = fbScreening;
      }
      return;
    }

    async function saveForRevision(latest) {
      if (!latest || agentScreeningRevision(latest) !== version || !latest.updated_at) return null;
      if (getSavedAgentFindings(latest)) return latest;
      var summaryText = result.queueSummary || summarizeAgentIdFindings(result);
      var finalRecText = result.finalRecommendation || summaryText;
      var triage = result.triage || (agentFindingsReadyForReview(result) ? "green" : "yellow");
      var reviewRec = triage !== "green";
      var politeMsg = result.suggestedPoliteRemark || "";
      var savedFindingsObj = buildSavedAgentFindings(result);
      var screening = Object.assign({}, latest.screening, {
        state: "completed",
        background_state: "completed",
        background_revision: version,
        background_findings: savedFindingsObj,
        manual_fallback: false,
        eta_seconds: 0,
        triage: triage,
        route: result.route || "good",
        summary: summaryText,
        final_recommendation: finalRecText,
        review_recommended: reviewRec,
        overall_match: !reviewRec,
        Suggested_remark: politeMsg,
        openai_response_id: result.openaiResponseId || (latest.screening && latest.screening.openai_response_id) || "",
        browser_check: { reader_version: 5, revision: version, checked_at: new Date().toISOString(), findings: savedFindingsObj }
      });
      var aiResult = Object.assign({}, latest.ai_result, {
        overall_status: triage === "green" ? "Verified" : (triage === "red" ? "Needs Correction" : "Needs Review"),
        triage: triage,
        route: result.route || "good",
        name_match: Boolean(result.fields.find(function (f) { return f.key === "name" && f.status === "match"; })),
        birth_date_match: Boolean(result.fields.find(function (f) { return f.key === "birth_date" && f.status === "match"; })),
        id_number_match: Boolean(result.fields.find(function (f) { return f.key === "id_number" && f.status === "match"; })),
        issues: (result.aiFindings || []).concat(result.tamperingFlags || [])
      });
      var aiLog = Array.isArray(latest.ai_log) ? latest.ai_log.slice() : [];
      aiLog.push({
        at: new Date().toISOString(),
        who: "Stage 1 (gpt-6.2-sol) + Stage 4 (gpt-5.4)",
        text: finalRecText
      });

      var patchBody = {
        screening: screening,
        ai_result: aiResult,
        ai_log: aiLog
      };

      if (triage === "red" && result.autoNeedsCorrection && (latest.status === "Pending Review" || latest.status === "Under Agent Review")) {
        var autoMsg = politeMsg || "Hello! Thank you for applying with PIGEM. Please sign in to your Customer Account to update your highlighted details or upload a clearer Valid ID photo.";
        var targetFields = (result.targetFields && result.targetFields.length) ? result.targetFields : ["id_photo"];
        screening.auto_correction_sent = true;
        screening.auto_correction_type = "pigem_screening";
        screening.auto_correction_reason = summaryText;
        screening.correction_fields = targetFields;
        patchBody.status = "Needs Correction";
        patchBody.agent_remarks = autoMsg;
        patchBody.correction_note = autoMsg;
        patchBody.customer_instruction = autoMsg;
        patchBody.has_correction = false;
      }

      return await dbUpdateApplication(app.id, patchBody, latest.updated_at);
    }

    var saved;
    try {
      saved = await saveForRevision(app);
    } catch (error) {
      saved = await saveForRevision(await dbGetApplication(app.id));
    }
    if (saved) {
      var wasPending = app.status === "Pending Review" || app.status === "Under Agent Review";
      app.screening = saved.screening;
      app.ai_result = saved.ai_result;
      app.ai_log = saved.ai_log;
      app.status = saved.status || app.status;
      app.agent_remarks = saved.agent_remarks || app.agent_remarks;
      app.updated_at = saved.updated_at;

      if (wasPending && saved.status === "Needs Correction" && saved.screening && saved.screening.auto_correction_sent) {
        var recipientEmail = (app.corrected_copy && app.corrected_copy.contact_email) || app.email;
        var autoRemarks = saved.agent_remarks || result.suggestedPoliteRemark || "";
        var tFields = (result.targetFields && result.targetFields.length) ? result.targetFields : ["id_photo"];
        var targetSummaryLabel = tFields.map(function (f) { return FIELD_SUMMARY_LABELS[f]; }).filter(Boolean).join(", ");
        try {
          await dbAddNotification({
            email: recipientEmail,
            role: "customer",
            title: "Update Needed for Application (" + app.reference_no + ")",
            message: autoRemarks,
            target_tab: "tab-apps",
            target_id: app.id
          });
          await apiSendStatusEmail(recipientEmail, app.full_name, app.reference_no, "Needs Correction", autoRemarks, targetSummaryLabel);
        } catch (e) {}
      }
    }
  } catch (error) {

  } finally {
    agentScreeningWrites.delete(key);
  }
}

function getAgentAppIdCheck(app, existingOnly) {
  var saved = getSavedAgentFindings(app);
  return saved ? { result: saved, pending: Promise.resolve(saved) } : null;
}

async function showAgentIdFindings(panel, app, copySnapshot) {
  if (!panel) return;
  if (!app && copySnapshot && (copySnapshot.screening_findings || copySnapshot.reviewed_findings)) {
    var histResult = copySnapshot.screening_findings || copySnapshot.reviewed_findings;
    panel._documentFindings = histResult;
    var histHeader = histResult.finalRecommendation || summarizeAgentIdFindings(histResult);
    var histLines = [histHeader];
    if (histResult.queueSummary && histResult.queueSummary !== histHeader) {
      histLines.push("Summary: " + histResult.queueSummary);
    }
    if (Array.isArray(histResult.fields) && histResult.fields.some(function (f) { return f.status !== "unreadable"; })) {
      histLines.push(histResult.fields.filter(function (f) { return f.status !== "unreadable"; }).map(describeAgentIdField).join("\n"));
    }
    panel.textContent = histLines.join("\n");
    return;
  }
  if (!agentScreeningAvailable() && !(app && getSavedAgentFindings(app))) {
    panel.textContent = "Manual Review Fallback Active: Automated AI screening is currently offline or paused. Please visually compare the applicant's Front & Back Valid ID photos below against the submitted Name, Birth Date, and ID Number, then proceed with your Agent decision.";
    return;
  }
  var expected = {
    name: panel.dataset.name,
    birth: panel.dataset.birth,
    number: panel.dataset.number,
    type: panel.dataset.type || "",
    previous_response_id: ""
  };
  var check = app ? getAgentAppIdCheck(app) : null;
  if (!check) {
    panel.textContent = app ? agentBackgroundStatus(app) : "No saved findings for this copy. Review the original photo manually.";
    return;
  }
  var result = await check.pending;
  if (panel.isConnected === false) return;
  panel._documentFindings = result;

  if (result.failed || result.offline || result.timedOut || (result.unavailableSides && result.unavailableSides.length) || (result.failedReads && result.failedReads.length)) {
    panel.textContent = "Manual Review Fallback Active: " + summarizeAgentIdFindings(result) + " Please visually inspect the Valid ID photos and applicant details below to complete your review manually.";
    if (document.querySelectorAll) {
      document.querySelectorAll("#det-body [data-photo-container]").forEach(showAgentPreparedPhoto);
    }
    return;
  }

  var headerLine = result.finalRecommendation || summarizeAgentIdFindings(result);
  var linesOut = [headerLine];
  if (result.queueSummary && result.queueSummary !== headerLine) {
    linesOut.push("Summary: " + result.queueSummary);
  }
  if (!result.failed && !result.unavailableSides?.length && !result.failedReads?.length && result.fields.some(function (field) { return field.status !== "unreadable"; })) {
    linesOut.push(result.fields.filter(function (field) {
      return field.status !== "unreadable";
    }).map(describeAgentIdField).join("\n"));
  }
  if (!result.failed && result.nlpValidation) {
    var nlpLines = [];
    if (result.nlpValidation.age_note) nlpLines.push("Age check: " + result.nlpValidation.age_note);
    if (result.nlpValidation.expiry_note) nlpLines.push("Validity: " + result.nlpValidation.expiry_note);
    if (result.nlpValidation.id_format_note) nlpLines.push("ID number format: " + result.nlpValidation.id_format_note);
    if (nlpLines.length) linesOut.push(nlpLines.join("\n"));
  }
  panel.textContent = linesOut.join("\n");

  if (document.querySelectorAll) {
    document.querySelectorAll("#det-body [data-photo-container]").forEach(showAgentPreparedPhoto);
  }

  var field = document.getElementById("det-correction-field");
  var note = document.getElementById("det-validator-raw");
  var message = document.getElementById("det-correction-message");
  var draft = getFindingCorrectionDraft(result);
  if (draft && field && field.value === "auto" && note && !note.value.trim() && message && !message.value.trim()) {
    message.value = draft.message;
    lastDetectedFields = draft.fields;
  }
}

function getCurrentCorrectionFindings() {
  var panel = document.querySelector("#det-body [data-id-text-result]");
  return panel && panel._documentFindings;
}

function getFindingCorrectionDraft(result) {
  if (!result || result.failed || result.unavailableSides?.length || result.failedReads?.length) return null;
  if (result.duplicatePhotos) {
    return { fields: ["id_photo"], sides: ["back"], message: "Hello! The front and back uploads show the same photo. Please sign in and upload a separate photo of the back of your ID." };
  }
  if (result.uploadReview?.sides?.length && result.uploadReview.instruction) {
    return { fields: ["id_photo"], sides: result.uploadReview.sides, message: result.uploadReview.instruction };
  }
  if (result.detectedOtherType) {
    return { fields: ["id_photo"], message: "Hello! Please sign in and upload a clear photo of the ID type selected on your application." };
  }
  if (result.nlpValidation && result.nlpValidation.is_expired) {
    return { fields: ["id_photo"], message: "Hello! Your uploaded ID appears to be expired. Please sign in and upload a valid, unexpired government ID." };
  }
  var poorPhotos = result.unclearSides.filter(function (side) {
    return (result.photoIssues || []).some(function (issue) {
      return issue.startsWith(side + " photo:") && /looks blurry|too dark|washed out/i.test(issue);
    });
  });
  if (!poorPhotos.length) {
    if (result.unclearSides.length) return null;
    var differences = result.fields.filter(function (field) { return field.status === "difference"; });
    if (differences.length === 1) {
      var field = differences[0];
      var preset = VALIDATOR_PRESETS.find(function (item) { return item.field === field.key; });
      if (preset) return { fields: [field.key], message: preset.msg };
    }
    return null;
  }
  var sides = poorPhotos.join(" and ").toLowerCase();
  return { fields: ["id_photo"], sides: poorPhotos.map(function (side) { return side.toLowerCase(); }), message: "Hello! Please upload a clearer photo of the " + sides +
    " of your ID in your account. Make sure the printed details are readable." };
}

async function renderDetailModalContent(updateResultsOnly) {
  var app = findAppById(activeDetailAppId);
  if (!app) return;

  document.getElementById("det-title").textContent = app.reference_no + " - " + app.full_name;
  var viewData = getAgentPreviewCopy(app);
  var photoData = getAgentPreviewCopy(app, activePhotoCopyMode);
  var personalData = getAgentPreviewCopy(app, activePersonalCopyMode);
  var scr = app.screening || {};
  var res = app.ai_result || {};
  var dupCheck = detectClientSideDuplicateId(app);
  var cleanIssuesList = ((res.issues && res.issues.length) ? res.issues : [])
    .map(function (x) { return stripFalseReuploadMsg(x, dupCheck); })
    .filter(Boolean);
  var cleanSuggestedRemark = stripFalseReuploadMsg(scr.Suggested_remark || "", dupCheck);

  var copySwitcher = renderAgentSubmissionPicker(app);

  var frontIdPhotoUrl = photoData.id_image_url || photoData.id_front_path || "";
  var rawFrontUrl = frontIdPhotoUrl || "/api/assets/black-logo-white-mode.png";
  var displayedFrontUrl = rawFrontUrl;
  var idBackPhotoUrl = photoData.id_back_image_url || photoData.id_back_path || "";
  var displayedBackUrl = idBackPhotoUrl;

  var currentSt = app.status || "Under Agent Review";
  var selectedReqStatus = (currentSt === "Approved" || currentSt === "Rejected" || currentSt === "Encoding" || currentSt === "Under Agent Review")
    ? currentSt
    : "Encoding";
  var hasRealQualityOrFieldConcern = Boolean(
    dupCheck.isDup ||
    res.name_match === false || res.name_match === "not_found" ||
    res.birth_date_match === false || res.birth_date_match === "not_found" ||
    res.id_number_match === false || res.id_number_match === "not_found" ||
    Number(res.blur_score) < 55 ||
    cleanIssuesList.length > 0
  );
  var hasPrelimConcern = Boolean(hasRealQualityOrFieldConcern && currentSt !== "Approved" && currentSt !== "Rejected");
  var activeCorrFields = dupCheck.isDup
    ? "id_photo"
    : ((app.correction_fields && app.correction_fields.length)
      ? app.correction_fields.join(",")
      : ((scr.suggested_fields && scr.suggested_fields.length) ? scr.suggested_fields[0] : (Number(res.blur_score) < 55 ? "id_photo" : "")));
  var prefillRawNote = (currentSt === "Needs Correction" && app.validator_raw_remark)
    ? stripFalseReuploadMsg(app.validator_raw_remark, dupCheck)
    : (dupCheck.isDup ? dupCheck.reason : (hasPrelimConcern ? (cleanIssuesList[0] || "") : ""));
  var dupPoliteDefault = dupCheck.type === "front_back"
    ? "We noticed that the same photo was uploaded for both the Front and Back of your Valid ID. Please sign in to your Customer Account and upload clear, separate photos of the Front and Back sides of your Valid ID so your application can proceed."
    : (dupCheck.type === "reupload_same"
      ? "The re-uploaded Valid ID photo is identical to the previous unclear image. Please capture a new, clearer photo of the Front and Back of your Valid ID and upload it in your Customer Account."
      : "The uploaded Valid ID photo matches an image already used in another record. Please sign in to your Customer Account and upload clear photos of the Front and Back of your own Valid ID.");
  var prefillPoliteMsg = currentSt === "Needs Correction"
    ? (app.agent_remarks || "")
    : (dupCheck.isDup
      ? dupPoliteDefault
      : (hasPrelimConcern ? (cleanSuggestedRemark || "") : ""));
  var displayEmail = personalData.contact_email || personalData.email || app.email;
  var displayPhone = personalData.phone || app.phone;
  var emailContact = displayEmail ? '<a href="mailto:' + escapeHtml(encodeURIComponent(displayEmail)) + '">' + escapeHtml(displayEmail) + '</a>' : "-";
  var phoneContact = displayPhone ? '<a href="tel:' + escapeHtml(String(displayPhone).replace(/[^+\d]/g, "")) + '">' + escapeHtml(displayPhone) + '</a>' : "-";

  var applicantSection =
    '<div class="section-card">' +
      '<div class="section-head">' +
        '<div class="section-head-title"><span class="step-badge">3</span>Applicant Details</div>' +
        renderAgentSubmissionPicker(app, "personal") +
      '</div>' +
      '<div class="grid-2" style="align-items:start">' +
        '<div>' +
          '<div class="tiny muted" style="font-weight:700; text-transform:uppercase; margin-bottom:6px">Personal and ID Details</div>' +
          '<div class="kv">' +
            '<div><span>Full Name</span><b>' + escapeHtml(personalData.full_name || app.full_name) + '</b></div>' +
            '<div><span>Birth Date</span><b>' + escapeHtml(personalData.birth_date || app.birth_date || "-") + '</b></div>' +
            '<div><span>Email Address</span><b>' + emailContact + '</b></div>' +
            '<div><span>Mobile Number</span><b>' + phoneContact + '</b></div>' +
            '<div><span>Plan</span><b>' + escapeHtml(app.plan_name || '-') + '</b></div>' +
            '<div><span>Status</span><b>' + escapeHtml(app.status || '-') + '</b></div>' +
            '<div><span>Valid ID Type</span><b>' + escapeHtml(personalData.id_type || app.id_type || "-") + '</b></div>' +
            '<div><span>Primary ID Number</span><b>' + escapeHtml(personalData.id_number || app.id_number || "-") + '</b></div>' +
          '</div>' +
        '</div>' +
        '<div>' +
          '<div class="tiny muted" style="font-weight:700; text-transform:uppercase; margin-bottom:6px">Installation Location</div>' +
          '<div class="kv">' +
            '<div><span>House / Bldg / Street</span><b>' + escapeHtml(((personalData.house_no ? personalData.house_no + " " : "") + (personalData.building_name && personalData.building_name !== "N/A" ? personalData.building_name + " " : "") + (personalData.street || app.street || "")).trim() || "-") + '</b></div>' +
            '<div><span>Subdivision and Brgy</span><b>' + escapeHtml([personalData.subdivision, personalData.barangay].filter(Boolean).join(", ") || "-") + '</b></div>' +
            '<div><span>City and Province</span><b>' + escapeHtml([personalData.city, personalData.province].filter(Boolean).join(", ") || "-") + '</b></div>' +
            '<div><span>Nearest Landmark</span><b>' + escapeHtml(personalData.landmark || "-") + '</b></div>' +
            '<div><span>Pinned Coordinates</span><b>' + escapeHtml((personalData.latitude != null ? personalData.latitude : "-") + ", " + (personalData.longitude != null ? personalData.longitude : "-")) + '</b></div>' +
            '<div><span>Service Coverage</span><b>' + (typeof getCoverageBadgeHtml === "function" ? getCoverageBadgeHtml(app, true) : "-") + '</b></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  var trialPhotoOption = agentDynamsoft.enabled && activePhotoCopyMode !== "original"
    ? '<option value="dynamsoft"' + (activeIdImgMode === "dynamsoft" ? " selected" : "") + '>Dynamsoft trial preview</option>'
    : "";
  var enhancedPhotoLabel = trialPhotoOption ? "Enhanced reading copy (OpenCV)" : "Enhanced reading copy (if available)";
  var photosSection =
    '<div class="section-card">' +
      '<div class="section-head">' +
        '<div class="section-head-title"><span class="step-badge">2</span>Valid ID Photos</div>' +
        renderAgentSubmissionPicker(app, "photo") +
      '</div>' +
      '<div class="row" style="margin-bottom:12px"><label for="photo-display-mode">Photo view</label><select id="photo-display-mode" onchange="switchIdImgMode(this.value)"><option value="cropped"' + (activeIdImgMode === "cropped" ? " selected" : "") + '>' + enhancedPhotoLabel + '</option>' + trialPhotoOption + '<option value="raw"' + (activeIdImgMode === "raw" ? " selected" : "") + '>Original image</option></select></div>' +
      '<div class="grid-2" style="margin-bottom:12px">' +
        '<div data-photo-container data-photo-side="front" data-photo="' + escapeHtml(frontIdPhotoUrl) + '" style="border:1px solid var(--line); border-radius:10px; padding:10px; background:var(--soft); text-align:center">' +
          '<div style="font-size:11.5px; font-weight:700; margin-bottom:6px">' + "FRONT ID" + '</div>' +
          (frontIdPhotoUrl ? '<img src="' + escapeHtml(displayedFrontUrl) + '" alt="Front ID" style="max-height:280px; max-width:100%; margin:0 auto; border-radius:6px; object-fit:contain; cursor:pointer" onclick="window.open(this.src, \'_blank\')" title="Click to open full size in new tab" />' +
            '<button type="button" class="btn btn-outline btn-sm mt" data-side="front" onclick="downloadAgentIdPhoto(this.dataset.side)">Download front</button>' +
            '<div class="small muted" role="status" data-photo-status></div>' : '<span class="muted">No front photo uploaded</span>') +
        '</div>' +
        '<div data-photo-container data-photo-side="back" data-photo="' + escapeHtml(idBackPhotoUrl) + '" style="border:1px solid var(--line); border-radius:10px; padding:10px; background:var(--soft); text-align:center">' +
          '<div style="font-size:11.5px; font-weight:700; margin-bottom:6px">' + "BACK ID" + '</div>' +
          (displayedBackUrl
            ? '<img src="' + escapeHtml(displayedBackUrl) + '" alt="Back ID" style="max-height:280px; max-width:100%; margin:0 auto; border-radius:6px; object-fit:contain; cursor:pointer" onclick="window.open(this.src, \'_blank\')" title="Click to open full size in new tab" />'
              + '<button type="button" class="btn btn-outline btn-sm mt" data-side="back" onclick="downloadAgentIdPhoto(this.dataset.side)">Download back</button>' +
            '<div class="small muted" role="status" data-photo-status></div>'
            : '<span class="muted small" style="display:block; padding:54px 0">No Back ID uploaded</span>') +
        '</div>' +
      '</div>' +

      '</div>';
  var recommendation = '<section id="document-check-results">' +
      ((frontIdPhotoUrl || idBackPhotoUrl)
        ? '<div class="agent-screening-note"><b>' + (agentScreeningAvailable() ? 'Screening recommendation' : 'Manual Review Mode (Fallback Active)') + '</b><div class="small muted">' +
          (agentScreeningAvailable() ? 'Check the findings before requesting a correction.' : 'Automated screening is offline or paused. Compare the ID photos and applicant details manually below.') + '</div>' +
          '<div class="small" data-id-text-result role="status" style="white-space:pre-wrap; overflow-wrap:anywhere" data-front="' + escapeHtml(frontIdPhotoUrl) +
          '" data-back="' + escapeHtml(idBackPhotoUrl) + '" data-name="' + escapeHtml(viewData.full_name || app.full_name || "") +
          '" data-birth="' + escapeHtml(viewData.birth_date || "") + '" data-number="' + escapeHtml(viewData.id_number || "") +
          '" data-type="' + escapeHtml(viewData.id_type || app.id_type || "") +
          '">' + (agentScreeningAvailable() ? 'Checking the ID photos…' : 'Manual Review Fallback Active: Please visually compare the Front & Back Valid ID photos below against the applicant details.') + '</div></div>'
        : '<div class="agent-screening-note"><b>Screening recommendation</b><div class="small muted">Review the findings before sending a correction request.</div><div>No ID photo was uploaded.</div></div>');

  if (dupCheck.isDup) recommendation += '<p class="notice warn">' + escapeHtml(dupCheck.reason) + '</p>';
  recommendation += "</section>";
  var exportActions = document.getElementById("det-export-actions");
  if (exportActions) exportActions.hidden = agentDetailMode !== "documents";
  var statusSection =
    '<div class="section-card">' +
      '<div class="section-head">' +
        '<div class="section-head-title">Application Status and Validator Decision</div>' +
        '' +
      '</div>' +
      '<div class="grid-3" style="margin-bottom:10px">' +
        '<div class="field" style="margin-bottom:0">' +
          '<label>Select Status</label>' +
          '<select id="det-status-select" onchange="onStatusSelectChange()">' +
            '<option value="Under Agent Review" ' + (selectedReqStatus === "Under Agent Review" ? "selected" : "") + '>Under Agent Review (In Progress)</option>' +
            '<option value="Encoding" ' + (selectedReqStatus === "Encoding" ? "selected" : "") + '>Encoding (Forwarded to Validator)</option>' +
            '<option value="Approved" ' + (selectedReqStatus === "Approved" ? "selected" : "") + '>Approved (Validator Decision)</option>' +
            '<option value="Rejected" ' + (selectedReqStatus === "Rejected" ? "selected" : "") + '>Rejected (Validator Decision)</option>' +
          '</select>' +
        '</div>' +
        '<div class="field" style="margin-bottom:0">' +
          '<label>Validator Reference # (Optional)</label>' +
          '<input id="det-provider-ref" type="text" placeholder="e.g. RF-10492" value="' + escapeHtml(app.provider_ref || "") + '" />' +
        '</div>' +
        '<div class="field" style="margin-bottom:0">' +
          '<label>Encoding Proof Screenshot (Optional)</label>' +
          '<input type="file" accept="image/*" onchange="onEncodingProofPick(this)" />' +
          (app.encoding_proof_url ? '<div style="margin-top:4px"><span class="badge badge-green">Proof Attached</span></div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="field" style="margin-bottom:8px">' +
        '<label>Common Instructions for Selected Status (Optional)</label>' +
        '<select id="det-status-preset" onchange="onStatusInstructionPresetChange(this.value)">' +
          renderStatusInstructionPresetOptions(selectedReqStatus) +
        '</select>' +
      '</div>' +
      '<div class="field" style="margin-bottom:12px">' +
        '<label>Customer Instruction / Validator Remarks (Agent Can Type or Customize)</label>' +
        '<textarea id="det-remarks" rows="2" placeholder="Select a common instruction above or type the specific instruction/reason for Approved, Rejected, or Encoding...">' + escapeHtml(currentSt !== "Needs Correction" ? (app.agent_remarks || "") : "") + '</textarea>' +
      '</div>' +
      '<div class="row" style="justify-content:flex-end">' +
        '<button type="button" class="btn btn-red" onclick="saveSelectedStatus()">Save Status Update</button>' +
      '</div>' +
    '</div>';
  var correctionSection =
    (currentSt === "Needs Correction"
      ? '<div class="section-card" style="background:#fffaf5; border-color:#fed7aa">' +
          '<div class="section-head" style="margin-bottom:8px">' +
            '<div class="section-head-title">Customer Update Request Sent (Awaiting Customer Resubmission)</div>' +
            '<span class="badge badge-yellow">Waiting for Customer</span>' +
          '</div>' +
          '<div class="small" style="color:#7c2d12; line-height:1.55">' +
            '<div><b>Requested Field(s):</b> ' + escapeHtml(FIELD_SUMMARY_LABELS[activeCorrFields] || activeCorrFields || "Application / Valid ID Update") + '</div>' +
            (prefillRawNote ? '<div style="margin-top:4px"><b>Review / Validator Note:</b> ' + escapeHtml(prefillRawNote) + '</div>' : '') +
            '<div style="margin-top:4px"><b>Instruction Sent to Customer:</b> ' + escapeHtml(app.agent_remarks || prefillPoliteMsg || "Please submit the requested correction in your Customer Account.") + '</div>' +
            '<div class="tiny muted" style="margin-top:8px">This update request form is hidden while awaiting the customer\'s response and will automatically reopen once the customer resubmits their updated application or requirements.</div>' +
          '</div>' +
        '</div>'
      : '<details open' + ' class="section-card" style="background:var(--soft)">' +
          '<summary style="cursor:pointer; font-weight:700; font-size:14.5px; color:var(--text); display:flex; align-items:center; gap:8px">' +
              '<span>Request Customer Update (Needs Correction)</span>' +
            (app.has_correction ? '<span class="badge badge-blue" style="margin-left:auto">Customer Resubmitted - Reopened for Review</span>' : '') +
          '</summary>' +
          '<div style="margin-top:12px; padding-top:10px; border-top:1px solid var(--line)">' +
            '<p class="muted" style="font-size:12.5px; margin-bottom:12px">Use this section when the customer needs to correct a detail or upload clearer Front and Back Valid ID photos.</p>' +

            '<div class="grid-2" style="margin-bottom:10px">' +
              '<div class="field" style="margin-bottom:0">' +
                '<label>Field for Customer to Update</label>' +
                '<select id="det-correction-field">' +
                  '<option value="auto">Use document findings</option>' +
                  '<option value="id_photo" ' + (activeCorrFields === "id_photo" ? "selected" : "") + '>Valid ID Photos - Front &amp; Back (Blurry / Glare / Duplicate)</option>' +
                  '<option value="name" ' + (activeCorrFields === "name" ? "selected" : "") + '>Applicant Name</option>' +
                  '<option value="birth_date" ' + (activeCorrFields === "birth_date" ? "selected" : "") + '>Birth Date</option>' +
                  '<option value="id_number" ' + (activeCorrFields === "id_number" ? "selected" : "") + '>Primary ID Number</option>' +
                  '<option value="email" ' + (activeCorrFields === "email" ? "selected" : "") + '>Email Address</option>' +
                  '<option value="phone" ' + (activeCorrFields === "phone" ? "selected" : "") + '>Mobile Number</option>' +
                  '<option value="email_or_phone" ' + (activeCorrFields === "email,phone" ? "selected" : "") + '>Both Email and Mobile</option>' +
                  '<option value="address" ' + (activeCorrFields === "address" ? "selected" : "") + '>Installation Address</option>' +
                '</select>' +
              '</div>' +
              '<div class="field" style="margin-bottom:0">' +
                '<label>Common Screening / Validator Remark Preset</label>' +
                '<select id="det-preset-select" onchange="onValidatorPresetChange(this.value)">' +
                  renderValidatorPresetOptions() +
                '</select>' +
              '</div>' +
            '</div>' +

            '<div class="field" style="margin-bottom:10px">' +
              '<label>Short Review / Validator Note</label>' +
              '<input id="det-validator-raw" type="text" value="' + escapeHtml(prefillRawNote) + '" placeholder="e.g. Blurry ID photo, duplicate Front/Back image, or name mismatch..." />' +
            '</div>' +

            '<div class="field" style="margin-bottom:12px">' +
              '<div class="row between" style="margin-bottom:4px">' +
                '<label style="margin:0">Polite Instruction Shown to Customer</label>' +
                '<button type="button" id="btn-polite-gen" class="btn btn-outline btn-sm" style="padding:3px 10px; font-size:12px" onclick="convertValidatorToPoliteRemark()">Draft message</button>' +
              '</div>' +
              '<span id="polite-running-spinner" class="badge badge-blue" style="display:none; margin-bottom:6px">Composing message...</span>' +
              '<textarea id="det-correction-message" rows="2" placeholder="Select a preset above, click Draft message, or type your instruction for the customer...">' + escapeHtml(prefillPoliteMsg) + '</textarea>' +
            '</div>' +

            '<div class="row" style="justify-content:flex-end">' +
              '<button type="button" class="btn btn-outline" style="border-color:#d97706; color:#b45309; font-weight:700" onclick="saveAgentDecision(\'Needs Correction\')">Send Update Request to Customer</button>' +
            '</div>' +
          '</div>' +
        '</details>');
  var detailHtml = agentDetailMode === "status" ? statusSection :
    agentDetailMode === "correction" ? recommendation + correctionSection :
      (copySwitcher ? '<div class="agent-copy-toolbar"><b>Application copy</b>' + copySwitcher + '</div>' : '') + recommendation + photosSection + applicantSection;
  if (activeDetailAppId !== app.id) return;
  if (updateResultsOnly) {
    var template = document.createElement("template");
    template.innerHTML = detailHtml;
    var currentResults = document.getElementById("document-check-results");
    var nextResults = template.content.querySelector("#document-check-results");
    if (currentResults && nextResults) currentResults.replaceWith(nextResults);
  } else {
    agentDynamsoft.clear();
    document.getElementById("det-body").innerHTML = detailHtml;
  }
  var findings = document.querySelector && document.querySelector("#det-body [data-id-text-result]");
  if (findings) showAgentIdFindings(findings, activeCopyMode === "latest" ? app : null, viewData);
  if (document.querySelectorAll) {
    document.querySelectorAll("#det-body [data-photo-container]").forEach(showAgentPreparedPhoto);
  }

}

function saveSelectedStatus() {
  var sel = document.getElementById("det-status-select");
  var chosen = sel ? sel.value : "Encoding";
  saveAgentDecision(chosen);
}

async function convertValidatorToPoliteRemark() {
  if (!agentScreeningAvailable()) return;
  var rawEl = document.getElementById("det-validator-raw");
  var corrEl = document.getElementById("det-correction-message");
  var fieldEl = document.getElementById("det-correction-field");
  var btn = document.getElementById("btn-polite-gen");
  var spin = document.getElementById("polite-running-spinner");

  var rawText = (rawEl && rawEl.value.trim()) || (corrEl && corrEl.value.trim()) || "";
  var chosenField = fieldEl ? fieldEl.value : "auto";

  if (!rawText && chosenField === "auto") {
    var draft = getFindingCorrectionDraft(getCurrentCorrectionFindings());
    if (draft) {
      if (corrEl) corrEl.value = draft.message;
      lastDetectedFields = draft.fields;
      return { polite_message: draft.message, target_fields: draft.fields };
    }
    showAlert("Note Needed", "Please select a field, choose a preset, or type a short note first so a polite customer message can be composed.");
    return null;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Composing...";
  }
  if (spin) spin.style.display = "inline-block";

  try {
    var res = await apiGeneratePoliteRemark(rawText || chosenField, chosenField);
    if (corrEl && res.polite_message) {
      corrEl.value = res.polite_message;
    }
    lastDetectedFields = res.target_fields || [];
    return res;
  } catch (err) {
    var fallbackLabel = FIELD_SUMMARY_LABELS[chosenField] || "application details";
    var localPolite = "Hello! While reviewing your application, we noticed that your " + fallbackLabel.toLowerCase() + " needs a quick update" + (rawText ? " (" + rawText + ")" : "") + ". Please sign in to your Customer Account to submit the updated information so we can continue processing.";
    if (corrEl) corrEl.value = localPolite;
    return { polite_message: localPolite, target_fields: chosenField !== "auto" ? [chosenField] : [] };
  } finally {
    if (spin) spin.style.display = "none";
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Draft message";
    }
  }
}

function onEncodingProofPick(inputEl) {
  var file = inputEl.files && inputEl.files[0];
  if (!file) return;
  pendingProofFile = file;
  var reader = new FileReader();
  reader.onload = function () {
    pendingProofDataUrl = reader.result;
  };
  reader.readAsDataURL(file);
}

async function saveAgentDecision(newStatus) {
  var app = findAppById(activeDetailAppId);
  if (!app || !isAssignedToStaff(app.assigned_agent, currentAgent)) return;
  if (!canChangeApplicationStatus(app.status, newStatus)) {
    showAlert("Check the current step", "Review the application before encoding. Record a validator decision only after encoding.");
    return;
  }

  var rawValidator = document.getElementById("det-validator-raw") ? document.getElementById("det-validator-raw").value.trim() : "";
  var chosenField = document.getElementById("det-correction-field") ? document.getElementById("det-correction-field").value : "auto";
  var statusRemarks = document.getElementById("det-remarks") ? document.getElementById("det-remarks").value.trim() : "";
  var corrRemarks = document.getElementById("det-correction-message") ? document.getElementById("det-correction-message").value.trim() : "";
  var remarks = newStatus === "Needs Correction" ? (corrRemarks || statusRemarks) : statusRemarks;
  var providerRef = document.getElementById("det-provider-ref") ? document.getElementById("det-provider-ref").value.trim() : (app.provider_ref || "");
  var isEncoded = Boolean(app.encoded || newStatus === "Encoding" || newStatus === "Approved");

  var targetFields = lastDetectedFields || [];
  if (chosenField === "email") targetFields = ["email"];
  else if (chosenField === "phone") targetFields = ["phone"];
  else if (chosenField === "email_or_phone") targetFields = ["email", "phone"];
  else if (chosenField !== "auto") targetFields = [chosenField];

  if ((newStatus === "Encoding" || newStatus === "Under Agent Review") && !remarks) {
    remarks = "Your application requirements passed initial verification and are now being encoded into the provider portal.";
  } else if (newStatus === "Approved" && !remarks) {
    remarks = getApplicationStatusNotice(newStatus);
  } else if (newStatus === "Rejected" && !remarks) {
    showAlert("Reason needed", "Enter a short reason the customer can understand.");
    document.getElementById("det-remarks")?.focus();
    return;
  } else if (newStatus === "Needs Correction" && !remarks) {
    if (rawValidator || chosenField !== "auto" || getFindingCorrectionDraft(getCurrentCorrectionFindings())) {
      var gen = await convertValidatorToPoliteRemark();
      if (gen && gen.polite_message) {
        remarks = gen.polite_message;
        targetFields = gen.target_fields || targetFields;
      }
    }
    if (!remarks) {
      remarks = rawValidator || "Please review your application details and submit the requested update in your Customer Account.";
    }
  }

  if (newStatus === "Needs Correction" && !targetFields.length) {
    showAlert("Choose a correction", "Select the exact detail or photo the customer needs to update.");
    document.getElementById("det-correction-field")?.focus();
    return;
  }

  var proofUrl = app.encoding_proof_url || "";
  if (pendingProofFile && typeof dbUploadDocument === "function") {
    var safeRefFolder = String(app.reference_no || app.ref_no || app.id || "proof").replace(/[^a-zA-Z0-9_-]/g, "_");
    proofUrl = await dbUploadDocument(pendingProofFile, "applications/encoding-proofs/" + safeRefFolder, "encoding-proof");
    pendingProofFile = null;
    pendingProofDataUrl = "";
  } else if (pendingProofDataUrl) {
    proofUrl = pendingProofDataUrl;
    pendingProofDataUrl = "";
  }
  var autoDraft = chosenField === "auto" ? getFindingCorrectionDraft(getCurrentCorrectionFindings()) : null;
  var requestedSides = autoDraft && autoDraft.sides && targetFields.length === 1 && targetFields[0] === "id_photo"
    ? autoDraft.sides
    : [];
  var observed = getCurrentCorrectionFindings() || getSavedAgentFindings(app);
  var observedFindings = observed && !observed.failed ? buildSavedAgentFindings(observed) : null;
  var updatedScreening = Object.assign({}, app.screening || {}, {
    correction_findings: newStatus === "Needs Correction" ? observedFindings : null,
    correction_photo_sides: newStatus === "Needs Correction" ? requestedSides : [],
    correction_fields: newStatus === "Needs Correction" ? targetFields : [],
    auto_correction_sent: false,
    validator_raw_remark: rawValidator,
    flagged_front_sha256: newStatus === "Needs Correction" ? ((app.screening && app.screening.front_sha256) || "") : "",
    flagged_back_sha256: newStatus === "Needs Correction" ? ((app.screening && app.screening.back_sha256) || "") : ""
  });



  var staffId = getStaffIdentifier(currentAgent);
  await dbUpdateApplication(app.id, {
    status: newStatus,
    assigned_agent: staffId,
    agent_remarks: remarks,
    correction_note: remarks,
    correction_fields: newStatus === "Needs Correction" ? targetFields : [],
    validator_raw_remark: rawValidator,
    customer_instruction: remarks,
    screening: updatedScreening,
    has_correction: newStatus === "Needs Correction" ? false : app.has_correction,
    encoded: isEncoded,
    provider_ref: providerRef,
    encoding_proof_url: proofUrl
  }, app.updated_at);

  if (typeof dbRecordProviderUpdate === "function" && (newStatus === "Encoding" || newStatus === "Approved" || newStatus === "Rejected" || providerRef)) {
    await dbRecordProviderUpdate(app.id, providerRef, newStatus, rawValidator || remarks, remarks);
  }

  lastDetectedFields = null;

  await dbAddAiLog(
    app.id,
    app.reference_no,
    "Agent (" + currentAgent.full_name + ")",
    "Updated status to " + newStatus + (providerRef ? " (Ref: " + providerRef + ")" : "") + " - " + remarks
  );

  var emailNoticeNote = "";
  if (newStatus === "Approved" || newStatus === "Rejected" || newStatus === "Needs Correction") {
    var custTitle = newStatus === "Needs Correction"
      ? "Update Needed for Application (" + app.reference_no + ")"
      : "Application " + newStatus + " (" + app.reference_no + ")";
    var targetSummaryLabel = targetFields.map(function (field) { return FIELD_SUMMARY_LABELS[field]; }).filter(Boolean).join(", ");
    var recipientEmail = (app.corrected_copy && app.corrected_copy.contact_email) || app.email;

    await dbAddNotification({
      email: recipientEmail,
      role: "customer",
      title: custTitle,
      message: remarks,
      target_tab: "tab-apps",
      target_id: app.id
    });
    var mailRes = await apiSendStatusEmail(recipientEmail, app.full_name, app.reference_no, newStatus, remarks, targetSummaryLabel);
    emailNoticeNote = mailRes && mailRes.sent
      ? " The customer was emailed."
      : " The update is in the customer portal. The email could not be sent.";
  }

  await dbAddLog(staffId, "Set application " + app.reference_no + " status to " + newStatus);

  closeDetailModal();
  await refreshAgentData();
  var statusTab = { "Under Agent Review": "claimed", "Encoding": "encoding", "Needs Correction": "correction", "Approved": "approved", "Rejected": "rejected" };
  if (statusTab[newStatus]) {
    expandedSummaryCards[app.id] = true;
    showTab(statusTab[newStatus]);
  }
  showAlert("Status Updated", "Application " + app.reference_no + " is now marked as " + newStatus + "." + emailNoticeNote);
}

function getAgentSubmissionCopies(app) {
  var latest = app.corrected_copy;
  var rawOrig = (app.original_submission && app.original_submission.full_name)
    ? app.original_submission
    : ((app.original_copy && app.original_copy.full_name) ? app.original_copy : null);
  var origData = rawOrig
    ? Object.assign({}, app, rawOrig, {
        id_image_url: rawOrig.id_image_url || rawOrig.id_front_path || "",
        id_front_path: rawOrig.id_front_path || rawOrig.id_image_url || "",
        id_back_image_url: rawOrig.id_back_image_url || rawOrig.id_back_path || "",
        id_back_path: rawOrig.id_back_path || rawOrig.id_back_image_url || "",
        screening_findings: rawOrig.screening_findings || (app.screening && app.screening.correction_findings) || null
      })
    : app;

  if (!latest || !latest.submitted_at) return [
    { key: "latest", label: "Latest copy", data: app },
    { key: "original", label: "Original submission (untouched)", data: origData }
  ];
  var earlier = Array.isArray(latest.previous_submissions) ? latest.previous_submissions : [];
  var copies = earlier.map(function (snapshot, index) {
    return {
      key: "correction-" + index,
      label: "Resubmission " + (index + 1) + " · " + formatDate(snapshot.submitted_at),
      data: Object.assign({}, origData, snapshot, {
        id_image_url: snapshot.id_image_url || snapshot.id_front_path || "",
        id_front_path: snapshot.id_front_path || snapshot.id_image_url || "",
        id_back_image_url: snapshot.id_back_image_url || snapshot.id_back_path || "",
        id_back_path: snapshot.id_back_path || snapshot.id_back_image_url || ""
      })
    };
  });
  copies.unshift({
    key: "latest",
    label: "Latest resubmission (" + (earlier.length + 1) + ") · " + formatDate(latest.submitted_at),
    data: Object.assign({}, app, latest, {
      id_image_url: latest.id_image_url || latest.id_front_path || app.id_image_url || app.id_front_path || "",
      id_front_path: latest.id_front_path || latest.id_image_url || app.id_front_path || app.id_image_url || "",
      id_back_image_url: latest.id_back_image_url || latest.id_back_path || app.id_back_image_url || app.id_back_path || "",
      id_back_path: latest.id_back_path || latest.id_back_image_url || app.id_back_path || app.id_back_image_url || ""
    })
  });
  copies.push({ key: "original", label: "Original submission (untouched)", data: origData });
  return copies;
}

function renderAgentSubmissionPicker(app, section) {
  var copies = getAgentSubmissionCopies(app);
  var currentMode = section === "photo" ? activePhotoCopyMode : section === "personal" ? activePersonalCopyMode : activeCopyMode;
  return '<div class="agent-copy-controls"><select aria-label="' + escapeHtml(section || "All") + ' copy history" onchange="switchCopyMode(this.value,\'' + (section || "all") + '\')">' +
      copies.map(function (copy) {
        return '<option value="' + escapeHtml(copy.key) + '"' + (copy.key === currentMode ? ' selected' : '') + '>' + escapeHtml(copy.label) + '</option>';
      }).join("") + '</select></div>';
}

function getAgentPreviewCopy(app, mode) {
  var chosen = getAgentSubmissionCopies(app).find(function (copy) { return copy.key === (mode || activeCopyMode); });
  return chosen ? chosen.data : app;
}

async function downloadAgentIdPhoto(side) {
  var app = findAppById(activeDetailAppId);
  if (!app) return;
  var copy = getAgentPreviewCopy(app, activePhotoCopyMode);
  var version = activePhotoCopyMode;
  var container = document.querySelector('#det-body [data-photo-container][data-photo-side="' + side + '"]');
  var imgEl = container ? container.querySelector("img") : null;
  var url = activeIdImgMode === "dynamsoft" || imgEl?.dataset.suggestedCrop === "true" ? container?.dataset.photo : imgEl?.src;
  url = url || (side === "front" ? copy.id_image_url || copy.id_front_path : copy.id_back_image_url || copy.id_back_path);
  if (!url) return;
  try {
    var response = await fetch(url, { referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error("Photo unavailable");
    var photo = await response.blob();
    var extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[photo.type] || "jpg";
    savePigemExport(photo, app.reference_no + "-" + version + "-" + side + "-ID." + extension);
  } catch (error) {
    showAlert("Photo unavailable", "The photo could not be downloaded. Please try again.");
  }
}

function printApplicantCopy() {
  return exportApplicantCopy(true);
}

function downloadApplicantCopy() {
  return exportApplicantCopy(false);
}

function exportApplicantCopy(print) {
  var app = findAppById(activeDetailAppId);
  if (!app) return;
  var copy = getAgentPreviewCopy(app);
  var panel = document.querySelector("#det-body [data-id-text-result]");
  var docFindings = panel ? panel._documentFindings : null;
  var remarks = docFindings
    ? (docFindings.finalRecommendation || summarizeAgentIdFindings(docFindings))
    : (!agentScreeningAvailable()
      ? "Manual Review Fallback: Application reviewed manually by Agent."
      : ((app.agent_remarks || (app.screening && app.screening.final_recommendation)) || "Reviewed by Agent."));
  var duplicate = detectClientSideDuplicateId(app);
  if (duplicate.isDup) remarks += " " + duplicate.reason;
  var location = [copy.house_no || app.house_no, copy.street || app.street, copy.subdivision || app.subdivision,
    copy.barangay || app.barangay, copy.city || app.city, copy.province || app.province].filter(Boolean).join(", ");
  var rows = [
    ["Full name", copy.full_name || app.full_name],
    ["Plan", app.plan_name],
    ["Status", app.status],
    ["Submitted", formatDate(app.created_at)],
    ["Date of birth", copy.birth_date],
    ["Email", copy.contact_email || copy.email || app.email],
    ["Mobile number", copy.phone || app.phone],
    ["Installation address", location],
    ["Nearest landmark", copy.landmark || app.landmark],
    ["Assigned Agent", app.assigned_agent || "Unassigned"]
  ];
  exportPigemPdf({
    title: "Internet Service Application",
    subtitle: "Reference " + app.reference_no,
    section: "Applicant details",
    columns: ["Field", "Details"],
    rows: rows,
    widths: [0.3, 0.7],
    remarks: remarks
  }, "PIGEM-" + app.reference_no + (activeCopyMode === "latest" ? "" : "-" + activeCopyMode) + ".pdf", print);
}

async function createNewAgentLink(button) {
  if (button) button.disabled = true;
  try {
    await dbRequestAgentLink(currentAgent);
    await renderAgentLinks();
  } catch (error) {
    showAlert("Request not sent", "Please try again.");
    if (button) button.disabled = false;
  }
}

async function renderAgentLinks() {
  var box = document.getElementById("agent-personal-link");
  if (!box || !currentAgent) return;
  try {
    agentLinks = await dbListAgentLinks();
    var matches = agentLinks.filter(function(l) { return agentOwnsLink(l, currentAgent); });
    var link = matches.find(function(l) {return l.active !== false;}) || matches[0];
    var heading = '<h3>My Application Link</h3>';
    if (!link) {
      box.innerHTML = heading + '<p class="muted">Request your personal application link from your manager.</p><button type="button" class="btn btn-red btn-sm" onclick="createNewAgentLink(this)">Request Application Link</button>';
    } else if (link.active === false) {
      box.innerHTML = heading + '<span class="badge badge-yellow">Waiting for manager approval</span>';
    } else {
      var url = _getPortalBaseUrl() + "/apply.html?agent=" + encodeURIComponent(link.code);
      box.innerHTML = heading + '<p class="muted">Share this link. Applications submitted through it will appear in My Queue.</p><input readonly aria-label="My application link" value="' + escapeHtml(url) + '"><button type="button" class="btn btn-red btn-sm" data-url="' + escapeHtml(url) + '" onclick="navigator.clipboard.writeText(this.dataset.url).then(function(){showAlert(\'Copied\',\'Application link copied.\')})">Copy Application Link</button>';
    }
  } catch (error) {
    box.innerHTML = '<p>Application link unavailable. Please refresh.</p>';
  }
}

function setAgentReportSubTab(subTab) {
  activeAgentReportTab = subTab || "apps";
  var tabs = ["apps", "mine", "links"];
  for (var i = 0; i < tabs.length; i++) {
    var b = document.getElementById("rep-sub-" + tabs[i]);
    if (b) b.classList.toggle("active", tabs[i] === activeAgentReportTab);
  }
  populateAgentReportFilters();
  renderAgentReport();
}

function populateAgentReportFilters() {
  var sel = document.getElementById("rep-filter-status");
  if (!sel) return;
  if (activeAgentReportTab === "links") {
    sel.innerHTML = '<option value="all">All Referral Links</option>';
    return;
  }
  sel.innerHTML =
    '<option value="all">All Statuses</option>' +
    '<option value="Pending Review">Pending Review</option>' +
    '<option value="Under Agent Review">Under Agent Review</option>' +
    '<option value="Encoding">Encoding</option>' +
    '<option value="Needs Correction">Needs Correction</option>' +
    '<option value="Approved">Approved</option>' +
    '<option value="Rejected">Rejected</option>';
}

function onAgentReportTimeframeChange() {
  var tfEl = document.getElementById("rep-timeframe");
  var tf = tfEl ? tfEl.value : "all";
  var dw = document.getElementById("rep-date-wrap");
  var mw = document.getElementById("rep-month-wrap");
  if (dw) dw.classList.toggle("hidden", tf !== "daily");
  if (mw) mw.classList.toggle("hidden", tf !== "monthly");
  renderAgentReport();
}

function getAgentReportData() {
  var tfEl = document.getElementById("rep-timeframe");
  var dEl = document.getElementById("rep-date");
  var mEl = document.getElementById("rep-month");
  var fEl = document.getElementById("rep-filter-status");
  var tfMode = tfEl ? tfEl.value : "all";
  var exactDate = dEl ? dEl.value : "";
  var monthStr = mEl ? mEl.value : "";
  var filterVal = fEl ? fEl.value : "all";
  var tfLabel = getReportTimeframeLabel(tfMode, exactDate, monthStr);

  if (activeAgentReportTab === "links") {
    var referralOnly = (agentLinks || []).filter(function (l) {
      return agentOwnsLink(l, currentAgent) && l.active !== false && matchesReportTimeframeValue(l.created_at, tfMode, exactDate, monthStr);
    });
    var codeAppCounts = {};
    for (var ai = 0; ai < allApps.length; ai++) {
      var refCode = allApps[ai].agent_link_code || "";
      if (refCode) codeAppCounts[refCode] = (codeAppCounts[refCode] || 0) + 1;
    }
    var usedCnt = referralOnly.filter(function (l) { return (codeAppCounts[l.code] || 0) > 0; }).length;
    var unusedCnt = referralOnly.length - usedCnt;
    return {
      title: "Referral Links Report",
      timeframeLabel: tfLabel,
      pieTitle: "Link Conversion Status",
      barTitle: "Link Utilization Breakdown",
      pieCenter: "Links",
      pieSlices: [
        { label: "With Applications", value: usedCnt, color: "#15803d" },
        { label: "No Applications Yet", value: unusedCnt, color: "#64748b" }
      ],
      barRows: [
        { label: "With Applications", value: usedCnt, color: "#15803d" },
        { label: "No Applications Yet", value: unusedCnt, color: "#64748b" }
      ],
      columns: ["Referral Code", "Customer / Note", "Applications Received", "Created By", "Created At"],
      rows: referralOnly.map(function (l) {
        return [
          l.code || "-",
          l.note || "-",
          String(codeAppCounts[l.code] || 0),
          l.agent_id || "-",
          formatDate(l.created_at)
        ];
      }),
      badges: []
    };
  }

  var baseList = activeAgentReportTab === "mine"
    ? allApps.filter(function (a) { return isAssignedToStaff(a.assigned_agent, currentAgent); })
    : allApps.slice();

  var appRows = baseList.filter(function (a) {
    if (!matchesReportTimeframeValue(a.created_at, tfMode, exactDate, monthStr)) return false;
    if (filterVal === "all") return true;
    return String(a.status || "") === filterVal;
  });

  var cntPend = appRows.filter(function (a) { return a.status === "Pending Review" || a.status === "Under Agent Review"; }).length;
  var cntEnc = appRows.filter(function (a) { return a.status === "Encoding"; }).length;
  var cntFix = appRows.filter(function (a) { return a.status === "Needs Correction"; }).length;
  var cntApp = appRows.filter(function (a) { return a.status === "Approved" || a.status === "Submitted to Provider"; }).length;
  var cntRej = appRows.filter(function (a) { return a.status === "Rejected"; }).length;

  return {
    title: activeAgentReportTab === "mine" ? "My Handled Applications Report" : "Applications Queue Report",
    timeframeLabel: tfLabel,
    pieTitle: "Applications by Status",
    barTitle: "Verification Pipeline Summary",
    pieCenter: "Apps",
    pieSlices: [
      { label: "Pending / Claimed", value: cntPend, color: "#2563eb" },
      { label: "Encoding", value: cntEnc, color: "#0284c7" },
      { label: "Needs Correction", value: cntFix, color: "#d97706" },
      { label: "Approved", value: cntApp, color: "#15803d" },
      { label: "Rejected", value: cntRej, color: "#dc2626" }
    ],
    barRows: [
      { label: "Pending / Claimed", value: cntPend, color: "#2563eb" },
      { label: "Encoding", value: cntEnc, color: "#0284c7" },
      { label: "Needs Correction", value: cntFix, color: "#d97706" },
      { label: "Approved", value: cntApp, color: "#15803d" },
      { label: "Rejected", value: cntRej, color: "#dc2626" }
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

function renderAgentReport() {
  renderDashReportView({
    data: getAgentReportData(),
    summaryId: "rep-summary-header",
    pieTitleId: "rep-pie-title",
    barTitleId: "rep-bar-title",
    pieBoxId: "chart-report-pie",
    barBoxId: "chart-report-bars",
    tableWrapId: "report-table-wrap",
    actorLabel: getStaffIdentifier(currentAgent)
  });
}

function resetAgentReportFilters() {
  var tfEl = document.getElementById("rep-timeframe");
  var dEl = document.getElementById("rep-date");
  var mEl = document.getElementById("rep-month");
  var fEl = document.getElementById("rep-filter-status");
  if (tfEl) tfEl.value = "all";
  if (dEl) dEl.value = getLocalTodayIso();
  if (mEl) mEl.value = getLocalMonthIso();
  if (fEl) fEl.value = "all";
  onAgentReportTimeframeChange();
}

function exportAgentReportCsv() {
  var data = getAgentReportData();
  exportReportToCsv(data.columns, data.rows, "PIGEM-agent-" + activeAgentReportTab + "-report.csv");
}

function downloadFormattedAgentReport() {
  var data = getAgentReportData();
  exportDashboardReport(data.title, data.timeframeLabel, data.pieSlices, data.columns, data.rows, "PIGEM-agent-" + activeAgentReportTab + "-report.pdf");
}
