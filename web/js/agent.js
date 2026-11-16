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
    else if (targetApp.assigned_agent && isAssignedToStaff(targetApp.assigned_agent, currentAgent)) cleanTab = "claimed";
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
var activeIdImgMode = "cropped";
var pendingProofDataUrl = "";
var pendingProofFile = null;
var lastDetectedFields = null;
var isScreeningServiceOnline = false;
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

async function checkAgentScreeningService() {
  isScreeningServiceOnline = false;
  var banner = document.getElementById("agent-screening-banner");
  if (banner) banner.classList.remove("hidden");
  return false;
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
  var scr = (app && app.screening) || {};
  return ["pending_agent", "checking", "queued", "layer1_running", "layer2_running"].includes(scr.state) || visualScreeningRunningAppId === (app && app.id);
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
      // Do not rebuild an open review form: it would erase notes, uploads and expanded sections.
      // Explicit screening/status actions refresh it after they finish.
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
  var encodingCount = 0;
  var fix = 0;
  var approvedCount = 0;
  var rejectedCount = 0;
  var planCounts = { "1000": 0, "1400": 0, "1900": 0 };

  for (var i = 0; i < allApps.length; i++) {
    var a = allApps[i];
    var st = a.status || "Pending Review";

    if (!a.assigned_agent && st === "Pending Review") unclaimed++;
    if (isAssignedToStaff(a.assigned_agent, currentAgent) && (st === "Pending Review" || st === "Under Agent Review")) myClaimed++;
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
  setTxt("cnt-claimed", myClaimed);
  setTxt("cnt-encoding", encodingCount);
  setTxt("cnt-correction", fix);
  setTxt("cnt-approved", approvedCount);
  setTxt("cnt-rejected", rejectedCount);

  setTxt("st-unclaimed", unclaimed);
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
    renderCalendar("agent-calendar", allApps);
    await renderAgentLinks();
  }

  renderAgentCards();
  if (activeBranch === "reports") renderAgentReport();
  if (isScreeningServiceOnline) {
    checkPendingDocuments(allApps, async function (appId) {
      await refreshAgentData(true);
    });
  }
}

function showTab(branch) {
  if (branch === "encoded") branch = "encoding";
  activeBranch = branch;
  var navIds = ["overview", "queue", "claimed", "encoding", "correction", "approved", "rejected", "links", "reports"];
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
  document.getElementById("tab-links").classList.toggle("hidden", branch !== "links");
  var repTabEl = document.getElementById("tab-reports");
  if (repTabEl) repTabEl.classList.toggle("hidden", branch !== "reports");

  var isAppBranch = (
    branch === "queue" ||
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
      queue: ["Shared Queue", "Unclaimed applications, including referrals, are available for any Agent to claim."],
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
  if (!isAiEnabled() || !isScreeningServiceOnline || documentCheckUnavailable(app.id) || state === "unavailable" || state === "paused" || scr.fallback_original_only) {
    return '<span class="badge badge-gray">Open to check documents</span>';
  }
  if (["pending_agent", "queued", "checking"].includes(state)) return '<span class="badge badge-blue">Waiting for Document Check</span>';
  var eta = formatEtaLabel(scr.eta_seconds);

  if (state === "queued" || state === "layer1_running") {
    return '<span class="badge badge-blue">Screening in Progress' + (eta ? " (" + escapeHtml(eta) + ")" : "") + '</span>';
  }
  if (state === "layer2_running") {
    return '<span class="badge badge-blue">Cropping and Verifying' + (eta ? " (" + escapeHtml(eta) + ")" : "") + '</span>';
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

function getScreeningQuickSummary(app) {
  var duplicate = detectClientSideDuplicateId(app);
  if (duplicate.isDup) return escapeHtml(duplicate.reason);
  var check = getAgentAppIdCheck(app, true);
  if (check && check.result) return escapeHtml(summarizeAgentIdFindings(check.result));
  if (check) return "Checking ID photos…";
  return app.id_image_url || app.id_front_path ? "Document check has not run yet." : "No front ID photo is available.";
}

async function checkAgentQueueDocument(appId, button) {
  var app = findAppById(appId);
  if (!app) return;
  var check = getAgentAppIdCheck(app);
  if (!check) return;
  if (button) button.disabled = true;
  var node = document.getElementById("check-note-" + appId);
  if (node) node.textContent = "Checking ID photos…";
  var result = await check.pending;
  var summary = summarizeAgentIdFindings(result);
  node = document.getElementById("check-note-" + appId);
  if (node) node.textContent = summary;
  if (button) button.disabled = false;
}

function renderAgentCards() {
  var box = document.getElementById("agent-cards-box");
  if (!box) return;
  var q = (document.getElementById("q-filter") ? document.getElementById("q-filter").value : "").trim().toLowerCase();

  var filtered = [];
  for (var i = 0; i < allApps.length; i++) {
    var a = allApps[i];
    var st = a.status || "Pending Review";

    if (activeBranch === "queue" && (a.assigned_agent || st !== "Pending Review")) continue;
    if (activeBranch === "claimed" && !(isAssignedToStaff(a.assigned_agent, currentAgent) && (st === "Pending Review" || st === "Under Agent Review"))) continue;
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

  var html = "";
  for (var j = 0; j < filtered.length; j++) {
    var app = filtered[j];
    var isClaimedByMe = isAssignedToStaff(app.assigned_agent, currentAgent);
    var claimBtn = "";

    if (!app.assigned_agent) {
      claimBtn = '<button type="button" class="btn btn-red btn-sm" onclick="claimApplication(\'' + escapeHtml(app.id) + '\')">Claim</button>';
    } else if (isClaimedByMe) {
      claimBtn = '<span class="badge badge-blue">Claimed by You</span>';
    } else {
      claimBtn = '<span class="badge badge-gray">Assigned: ' + escapeHtml(app.assigned_agent) + '</span>';
    }

    var locText = [app.barangay, app.city, app.province].filter(Boolean).join(", ");

    html +=
      '<div class="q-card">'  +
        '<div class="q-head">' +
          '<div style="min-width:0; flex:1">' +
            '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap">' +
              '<span class="q-name">' + escapeHtml(app.full_name) + '</span>' +
              '<span class="badge badge-gray" style="font-weight:700">' + escapeHtml(app.reference_no) + '</span>' +
              statusBadge(app.status) +
              (app.agent_link_code ? '<span class="badge badge-blue">Referral · ' + escapeHtml(app.agent_link_code) + '</span>' : '') +
            '</div>' +
            '<div class="q-sub" style="margin-top:4px">' +
              '<b>' + escapeHtml(app.plan_name || "Red Fiber Plan") + '</b>' +
              (locText ? ' &bull; ' + escapeHtml(locText) : '') +
              ' &bull; Submitted ' + formatDate(app.created_at) +
            '</div>' +
            '<div style="margin-top:8px; display:flex; gap:6px; align-items:center; flex-wrap:wrap">' +
              getScreeningCardBadge(app) +
              (typeof getCoverageBadgeHtml === "function" ? getCoverageBadgeHtml(app, false) : "") +
              (app.cropped_id_url ? '<span class="badge badge-green">Cropped ID Ready</span>' : '') +
              (app.has_correction ? '<span class="badge badge-blue">Customer Resubmitted</span>' : '') +
            '</div>' +
          '</div>' +
          '<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">' +
            '<button type="button" id="btn-more-' + escapeHtml(app.id) + '" class="btn ' + (expandedSummaryCards['more-' + app.id] ? 'btn-red' : 'btn-outline') + ' btn-sm" onclick="toggleCardMore(\'more-' + escapeHtml(app.id) + '\')">' + (expandedSummaryCards['more-' + app.id] ? 'Hide Summary' : 'Summary') + '</button>' +
            '<button type="button" class="btn btn-outline btn-sm" style="font-weight:700" onclick="openAppDetail(\'' + escapeHtml(app.id) + '\')">Open and Verify</button>' +
            '<button type="button" class="btn btn-outline btn-sm" data-app-id="' + escapeHtml(app.id) + '" onclick="checkAgentQueueDocument(this.dataset.appId, this)">Check documents</button>' +
            claimBtn +
          '</div>' +
        '</div>' +
        '<p class="small muted" style="margin:8px 0 0" id="check-note-' + escapeHtml(app.id) + '">' + getScreeningQuickSummary(app) + '</p>' +
        '<div id="more-' + escapeHtml(app.id) + '" class="q-more' + (expandedSummaryCards['more-' + app.id] ? '' : ' hidden') + '">' +
          '<div style="margin-top:4px" class="small muted"><b>Contact:</b> ' + escapeHtml(app.email || "-") + ' | ' + escapeHtml(app.phone || "-") + '</div>' +
        '</div>' +
      '</div>';
  }
  box.innerHTML = html;
  if (!q && (activeBranch === "queue" || activeBranch === "claimed")) {
    filtered.slice(0, 2).forEach(function (app) {
      if (!getAgentAppIdCheck(app, true)) checkAgentQueueDocument(app.id);
    });
  }
}

function toggleCardMore(elId) {
  var el = document.getElementById(elId);
  if (!el) return;
  var willShow = el.classList.contains("hidden");
  expandedSummaryCards[elId] = willShow;
  el.classList.toggle("hidden", !willShow);
  var btn = document.getElementById("btn-" + elId);
  if (btn) {
    btn.classList.toggle("btn-red", willShow);
    btn.classList.toggle("btn-outline", !willShow);
    btn.textContent = willShow ? "Hide Summary" : "Summary";
  }
}

async function claimApplication(appId) {
  var app = findAppById(appId);
  var keepCorrection = app && app.status === "Needs Correction";
  var staffId = getStaffIdentifier(currentAgent);
  await dbUpdateApplication(appId, {
    assigned_agent: staffId,
    status: keepCorrection ? "Needs Correction" : "Under Agent Review"
  });
  if (app) {
    await dbAddAiLog(app.id, app.reference_no, "Agent (" + currentAgent.full_name + ")", "Claimed application from queue.");
    await dbAddLog(staffId, "Claimed application " + app.reference_no);
  }
  await refreshAgentData();
  showTab(keepCorrection ? "correction" : "claimed");
}

function findAppById(id) {
  for (var i = 0; i < allApps.length; i++) {
    if (allApps[i].id === id) return allApps[i];
  }
  return null;
}

async function openAppDetail(appId) {
  lastDetectedFields = null;
  activeDetailAppId = appId;
  activeCopyMode = "latest";
  var app = findAppById(appId);
  activeIdImgMode = (app && (app.cropped_id_url || app.id_cropped_url)) ? "cropped" : "raw";
  pendingProofDataUrl = "";
  pendingProofFile = null;
  await renderDetailModalContent();
  document.getElementById("app-detail-modal").classList.remove("hidden");

}

function closeDetailModal() {
  document.getElementById("app-detail-modal").classList.add("hidden");
}

function switchCopyMode(mode) {
  activeCopyMode = mode;
  renderDetailModalContent();
}

function switchIdImgMode(mode) {
  activeIdImgMode = mode;
  renderDetailModalContent();
}

function renderVisualScreeningProgressBox(app) {
  if (!isAiEnabled() || !isScreeningServiceOnline || documentCheckUnavailable(app.id)) return "";
  if (!["pending_agent", "queued", "checking"].includes((app.screening || {}).state)) return "";
  // The endpoint returns one result, not live stage events. Do not invent progress percentages.
  return '<div class="screening-live-box" role="status" aria-live="polite" style="margin-bottom:14px">' +
    '<span class="inline-spinner"></span> <b>' +
    ((app.screening || {}).state === "checking" ? "Checking documents..." : "Waiting for the document check...") + '</b>' +
    '<div class="small muted">Reading both ID photos and comparing the application details. Please wait for the saved result.</div></div>';
}

// Only compare a value when the photo reader found a clear label for that field.
function compareAgentIdFields(text, expected) {
  var checks = [
    { key: "name", label: "Name", entered: expected.name, pattern: /^(?:full\s+name|name|pangalan)\s*[:.-]\s*(.+)$/im },
    { key: "birth_date", label: "Birth date", entered: expected.birth, pattern: /^(?:date\s+of\s+birth|birth\s*date|dob|petsa ng kapanganakan)\s*[:.-]\s*(.+)$/im },
    { key: "id_number", label: "ID number", entered: expected.number, pattern: /^(?:id(?:\s*(?:card|student))?\s*(?:number|no\.?|#)|student\s*(?:number|no\.?)|license\s*(?:number|no\.?))\s*[:.-]\s*(.+)$/im }
  ];
  return checks.map(function (field) {
    var values = Array.from(text.matchAll(new RegExp(field.pattern.source, "gim")), function (match) {
      var value = match[1].trim();
      // Compare dates only when their format is clear. Month/day order can vary by ID.
      if (field.label === "Birth date") {
        var iso = value.match(/^(\d{4})[-/. ](\d{2})[-/. ](\d{2})$/);
        return iso ? iso.slice(1).join("-") : "";
      }
      return value;
    }).filter(Boolean);
    var normalize = function (value) {
      return String(value || "").normalize("NFC").trim().toUpperCase().replace(/\s+/g, field.label === "ID number" ? "" : " ");
    };
    var candidates = new Map(values.map(function (value) { return [normalize(value), value]; }));
    var entered = normalize(field.entered);
    if (!entered || candidates.size !== 1) return { key: field.key, label: field.label, status: "unreadable" };
    var found = candidates.values().next().value;
    return { key: field.key, label: field.label, status: normalize(found) === entered ? "match" : "difference", found: found };
  });
}

function describeAgentIdField(field) {
  if (field.status === "match") return field.label + ": Matches";
  if (field.status === "difference") return field.label + ": Check difference (photo reads " + field.found + ")";
  return field.label + ": Could not verify";
}

function compareAgentIdDetails(text, expected) {
  return compareAgentIdFields(text, expected).map(describeAgentIdField);
}

var agentDocumentChecks = new Map();
var agentDocumentQueue = Promise.resolve();
var agentOpenCv;

function loadAgentOpenCv() {
  if (!agentOpenCv) {
    agentOpenCv = new Promise(function (resolve) {
      var script = document.createElement("script");
      var timeout = setTimeout(function () { resolve(null); }, 8000);
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
  return agentOpenCv;
}

async function enhanceAgentIdPhoto(photo, cv) {
  if (!cv || typeof createImageBitmap !== "function") return null;
  var bitmap = await createImageBitmap(photo);
  var canvas = document.createElement("canvas");
  var scale = 1600 / Math.max(bitmap.width, bitmap.height);
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
    cv.equalizeHist(gray, contrast);
    cv.GaussianBlur(contrast, soft, new cv.Size(3, 3), 0);
    cv.addWeighted(contrast, 1.35, soft, -0.35, 0, sharpened);
    cv.imshow(canvas, sharpened);
    return canvas;
  } finally {
    mats.forEach(function (item) { item.delete(); });
  }
}

function isReadableIdText(read) {
  return read.data.confidence >= 60 && /[\p{L}\p{N}]/u.test(read.data.text);
}

async function readAgentIdPhoto(worker, photo, expected, isFront) {
  var original = await worker.recognize(photo);
  function fieldsFound(read) {
    return compareAgentIdFields(read.data.text, expected).filter(function (field) {
      return field.status !== "unreadable";
    }).length;
  }
  var originalReadable = isReadableIdText(original);
  var originalFields = originalReadable ? fieldsFound(original) : 0;
  if ((originalReadable && (!isFront || originalFields >= 2)) || !document.head) return original;
  try {
    var adjusted = await enhanceAgentIdPhoto(photo, await loadAgentOpenCv());
    if (adjusted) {
      var secondRead = await worker.recognize(adjusted);
      if (isReadableIdText(secondRead) && (!originalReadable || fieldsFound(secondRead) > originalFields)) {
        return secondRead;
      }
    }
  } catch (error) {
    // An enhancement failure does not replace the original photo or its result.
  }
  return original;
}

async function collectAgentIdFindings(sources, expected) {
  var worker;
  var textBySide = [];
  var unclearSides = [];
  var unavailableSides = [];
  try {
    worker = await Tesseract.createWorker("eng");
    for (var side of sources) {
      try {
        // The browser reads the downloaded photo locally.
        var response = await fetch(side.url, { referrerPolicy: "no-referrer" });
        if (!response.ok) throw new Error("Photo unavailable");
        var read = await readAgentIdPhoto(worker, await response.blob(), expected, side.label === "Front");
        if (isReadableIdText(read)) {
          textBySide.push(read.data.text.trim());
        } else {
          unclearSides.push(side.label);
        }
      } catch (error) {
        unavailableSides.push(side.label);
      }
    }
    return { fields: compareAgentIdFields(textBySide.join("\n"), expected), unclearSides: unclearSides, unavailableSides: unavailableSides };
  } catch (error) {
    return { fields: [], unclearSides: [], unavailableSides: [], failed: true };
  } finally {
    if (worker) await worker.terminate().catch(function () {});
  }
}

function summarizeAgentIdFindings(result) {
  if (result.failed) return "Document check is unavailable. Open the original photos to review them.";
  var notes = [];
  if (result.unclearSides.length) notes.push(result.unclearSides.join(" and ") + " ID photo" + (result.unclearSides.length > 1 ? "s: text is unclear." : ": text is unclear."));
  if (result.unavailableSides.length) notes.push(result.unavailableSides.join(" and ") + " photo could not be opened.");
  var differences = result.fields.filter(function (field) { return field.status === "difference"; });
  if (differences.length) notes.push("Check " + differences.map(function (field) { return field.label.toLowerCase(); }).join(", ") + ".");
  if (notes.length) return notes.join(" ");
  if (result.fields.every(function (field) { return field.status === "match"; })) return "Name, birth date, and ID number match.";
  var unreadable = result.fields.filter(function (field) { return field.status === "unreadable"; });
  return "Could not verify " + unreadable.map(function (field) { return field.label.toLowerCase(); }).join(", ") + ".";
}

function getAgentIdCheck(front, back, expected, existingOnly) {
  var sources = [{ label: "Front", url: front }, { label: "Back", url: back }].filter(function (side) { return side.url; });
  if (!sources.length) return null;
  var key = JSON.stringify([sources, expected]);
  if (existingOnly) return agentDocumentChecks.get(key);
  if (!agentDocumentChecks.has(key)) {
    var check = { result: null };
    // Run one reader at a time. Reopening a record reuses its result until the photos or fields change.
    check.pending = agentDocumentQueue.then(function () { return collectAgentIdFindings(sources, expected); }).then(function (result) {
      check.result = result;
      return result;
    });
    agentDocumentQueue = check.pending.catch(function () {});
    agentDocumentChecks.set(key, check);
    if (agentDocumentChecks.size > 40) agentDocumentChecks.delete(agentDocumentChecks.keys().next().value);
  }
  return agentDocumentChecks.get(key);
}

function getAgentAppIdCheck(app, existingOnly) {
  return getAgentIdCheck(app.id_image_url || app.id_front_path || "", app.id_back_image_url || app.id_back_path || "", {
    name: app.full_name || "", birth: app.birth_date || "", number: app.id_number || ""
  }, existingOnly);
}

async function showAgentIdFindings(panel) {
  if (!panel) return;
  var expected = { name: panel.dataset.name, birth: panel.dataset.birth, number: panel.dataset.number };
  var check = getAgentIdCheck(panel.dataset.front, panel.dataset.back, expected);
  if (!check) return;
  var result = await check.pending;
  if (panel.isConnected === false) return;
  panel._documentFindings = result;
  panel.textContent = summarizeAgentIdFindings(result);
  if (!result.failed && result.fields.some(function (field) { return field.status !== "unreadable"; })) {
    panel.textContent += "\n" + result.fields.filter(function (field) {
      return field.status !== "unreadable";
    }).map(describeAgentIdField).join("\n");
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
  if (!result || result.failed) return null;
  var differences = result.fields.filter(function (field) { return field.status === "difference"; });
  if (differences.length === 1) {
    var field = differences[0];
    var preset = VALIDATOR_PRESETS.find(function (item) { return item.field === field.key; });
    if (preset) return { fields: [field.key], message: preset.msg };
  }
  if (differences.length > 1) return null;
  if (!result.unclearSides.length) return null;
  var sides = result.unclearSides.join(" and ").toLowerCase();
  return { fields: ["id_photo"], sides: result.unclearSides.map(function (side) { return side.toLowerCase(); }), message: "Hello! Please upload a clearer photo of the " + sides +
    " of your ID in your account. Make sure the printed details are readable." };
}

async function renderDetailModalContent(updateResultsOnly) {
  var app = findAppById(activeDetailAppId);
  if (!app) return;

  document.getElementById("det-title").textContent = app.reference_no + " - " + app.full_name;
  var viewData = (activeCopyMode === "original" && app.original_submission) ? app.original_submission : app;
  var scr = app.screening || {};
  var res = app.ai_result || {};
  var dupCheck = detectClientSideDuplicateId(app);
  var isManualFallback = (!isAiEnabled() || !isScreeningServiceOnline || documentCheckUnavailable(app.id) || ["pending_agent", "queued", "checking"].includes(scr.state) || scr.state === "unavailable" || scr.state === "paused" || scr.fallback_original_only || (scr.ocr && scr.ocr.available === false));

  var topScreeningBanner = renderVisualScreeningProgressBox(app);
  if (!topScreeningBanner) {
    if (dupCheck.isDup) {
      topScreeningBanner =
        '<div class="status-banner warn" style="margin-bottom:14px">' +
          '<div><b>Duplicate ID Image Flagged:</b> ' + escapeHtml(dupCheck.reason) + ' Use Section 4 below to request a corrected ID photo from the customer.</div>' +
          '<span class="badge badge-red">Duplicate Detected</span>' +
        '</div>';
    } else if (isManualFallback) {
      topScreeningBanner =
        '<div class="status-banner warn" style="margin-bottom:14px">' +
          '<div><b>Manual Document Review Active:</b> The customer\'s <b>Original Uploaded ID Photos</b> are ready below for verification.</div>' +
        '</div>';
    }
  }

  var logs = await dbListAiLogs(app.id);
  var logItemsHtml = "";
  for (var i = 0; i < logs.length; i++) {
    var item = logs[i];
    logItemsHtml +=
      '<div class="chat-item">' +
        '<div class="who">' + escapeHtml(cleanScreeningText(item.actor)) + ' &bull; <span class="muted" style="font-weight:400">' + formatDate(item.created_at) + '</span></div>' +
        '<div>' + escapeHtml(cleanScreeningText(item.message)) + '</div>' +
      '</div>';
  }
  if (!logItemsHtml) {
    logItemsHtml = '<div class="small muted">No activity log entries recorded yet.</div>';
  }

  var dupBadge = dupCheck.isDup
    ? '<span class="badge badge-red">Duplicate Flagged</span>'
    : '<span class="badge badge-green">Distinct Photos</span>';

  var cleanIssuesList = ((res.issues && res.issues.length) ? res.issues : [])
    .map(function (x) { return stripFalseReuploadMsg(x, dupCheck); })
    .filter(Boolean);
  var cleanScrSummary = stripFalseReuploadMsg(scr.summary || "", dupCheck);
  var cleanSuggestedRemark = stripFalseReuploadMsg(scr.Suggested_remark || "", dupCheck);

  var copySwitcher = "";
  if (app.original_submission) {
    copySwitcher =
      '<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap">' +
        '<span class="small muted">Version:</span>' +
        '<button type="button" class="btn btn-sm ' + (activeCopyMode === "latest" ? "btn-red" : "btn-outline") + '" style="padding:3px 10px; font-size:12px" onclick="switchCopyMode(\'latest\')">Latest Copy</button>' +
        '<button type="button" class="btn btn-sm ' + (activeCopyMode === "original" ? "btn-red" : "btn-outline") + '" style="padding:3px 10px; font-size:12px" onclick="switchCopyMode(\'original\')">Original Submission</button>' +
      '</div>';
  }

  var frontIdPhotoUrl = viewData.id_image_url || app.id_image_url || app.id_front_path || "";
  var rawFrontUrl = frontIdPhotoUrl || "https://wuunqfxyejxwrawtjdrf.supabase.co/storage/v1/object/public/website-assets/black-logo-white-mode.png";
  var croppedUrl = (activeCopyMode === "latest" && (app.cropped_id_url || app.id_cropped_url || (scr && scr.cropped_front_url)))
    ? (app.cropped_id_url || app.id_cropped_url || scr.cropped_front_url)
    : "";
  var displayedFrontUrl = (croppedUrl && activeIdImgMode === "cropped") ? croppedUrl : rawFrontUrl;
  var idBackPhotoUrl = viewData.id_back_image_url || viewData.id_back_path || app.id_back_image_url || app.id_back_path || "";
  var croppedBackUrl = (activeCopyMode === "latest" && (app.cropped_back_url || app.id_back_cropped_url || (scr && scr.cropped_back_url)))
    ? (app.cropped_back_url || app.id_back_cropped_url || scr.cropped_back_url)
    : "";
  var displayedBackUrl = (croppedBackUrl && activeIdImgMode === "cropped") ? croppedBackUrl : idBackPhotoUrl;

  var idModeBar = '<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap">';
  if (croppedUrl || croppedBackUrl) {
    idModeBar +=
      '<button type="button" class="btn btn-sm ' + (activeIdImgMode === "cropped" ? "btn-red" : "btn-outline") + '" style="padding:3px 10px; font-size:12px" onclick="switchIdImgMode(\'cropped\')">Cropped Copy</button>' +
      '<button type="button" class="btn btn-sm ' + (activeIdImgMode === "raw" ? "btn-red" : "btn-outline") + '" style="padding:3px 10px; font-size:12px" onclick="switchIdImgMode(\'raw\')">Original Photo</button>';
  }
  idModeBar += '</div>';

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
  var isCorrectionOpen = (currentSt === "Needs Correction" || hasPrelimConcern) ? " open" : "";
  var activeCorrFields = dupCheck.isDup
    ? "id_photo"
    : ((app.correction_fields && app.correction_fields.length)
      ? app.correction_fields.join(",")
      : ((scr.suggested_fields && scr.suggested_fields.length) ? scr.suggested_fields[0] : (Number(res.blur_score) < 55 ? "id_photo" : "")));
  var prefillRawNote = (currentSt === "Needs Correction" && app.validator_raw_remark)
    ? stripFalseReuploadMsg(app.validator_raw_remark, dupCheck)
    : (dupCheck.isDup ? dupCheck.reason : (hasPrelimConcern ? (cleanScrSummary || cleanIssuesList[0] || "") : ""));
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
  var displayEmail = (activeCopyMode === "latest" && app.corrected_copy && app.corrected_copy.contact_email)
    ? app.corrected_copy.contact_email
    : (viewData.email || app.email);

  var detailHtml =
    '<div id="document-check-status">' + topScreeningBanner + '</div>' +

    '<div class="grid-4" style="margin-bottom:14px">' +
      '<div class="card" style="padding:10px 14px"><div class="tiny muted">Internal Status</div><div style="margin-top:4px">' + statusBadge(app.status) + '</div></div>' +
      '<div class="card" style="padding:10px 14px"><div class="tiny muted">Customer Sees</div><div style="margin-top:4px">' + customerStatusBadge(app.status) + '</div></div>' +
      '<div class="card" style="padding:10px 14px"><div class="tiny muted">Selected Plan</div><div style="margin-top:4px; font-weight:700; font-size:13.5px">' + escapeHtml(app.plan_name || "-") + '</div></div>' +
      '<div class="card" style="padding:10px 14px"><div class="tiny muted">Assigned Agent</div><div style="margin-top:4px; font-weight:700; font-size:13px">' + escapeHtml(app.assigned_agent || "Unclaimed") + '</div></div>' +
    '</div>' +

    '<div class="section-card">' +
      '<div class="section-head">' +
        '<div class="section-head-title"><span class="step-badge">1</span>Applicant Profile and Installation Address</div>' +
        copySwitcher +
      '</div>' +
      '<div class="grid-2" style="align-items:start">' +
        '<div>' +
          '<div class="tiny muted" style="font-weight:700; text-transform:uppercase; margin-bottom:6px">Personal and ID Details</div>' +
          '<div class="kv">' +
            '<div><span>Full Name</span><b>' + escapeHtml(viewData.full_name || app.full_name) + '</b></div>' +
            '<div><span>Birth Date</span><b>' + escapeHtml(viewData.birth_date || app.birth_date || "-") + '</b></div>' +
            '<div><span>Email Address</span><b>' + escapeHtml(displayEmail || "-") + '</b></div>' +
            '<div><span>Mobile Number</span><b>' + escapeHtml(viewData.phone || app.phone || "-") + '</b></div>' +
            '<div><span>Valid ID Type</span><b>' + escapeHtml(viewData.id_type || app.id_type || "-") + '</b></div>' +
            '<div><span>Primary ID Number</span><b>' + escapeHtml(viewData.id_number || app.id_number || "-") + '</b></div>' +
          '</div>' +
        '</div>' +
        '<div>' +
          '<div class="tiny muted" style="font-weight:700; text-transform:uppercase; margin-bottom:6px">Installation Location</div>' +
          '<div class="kv">' +
            '<div><span>House / Bldg / Street</span><b>' + escapeHtml(((app.house_no ? app.house_no + " " : "") + (app.building_name && app.building_name !== "N/A" ? app.building_name + " " : "") + (viewData.street || app.street || "")).trim() || "-") + '</b></div>' +
            '<div><span>Subdivision and Brgy</span><b>' + escapeHtml([app.subdivision, app.barangay].filter(Boolean).join(", ") || "-") + '</b></div>' +
            '<div><span>City and Province</span><b>' + escapeHtml([app.city, app.province].filter(Boolean).join(", ") || "-") + '</b></div>' +
            '<div><span>Nearest Landmark</span><b>' + escapeHtml(app.landmark || "-") + '</b></div>' +
            '<div><span>Pinned Coordinates</span><b>' + escapeHtml((app.latitude != null ? app.latitude : "-") + ", " + (app.longitude != null ? app.longitude : "-")) + '</b></div>' +
            '<div><span>Service Coverage</span><b>' + (typeof getCoverageBadgeHtml === "function" ? getCoverageBadgeHtml(app, true) : "-") + '</b></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="section-card" id="document-check-results">' +
      '<div class="section-head">' +
        '<div class="section-head-title"><span class="step-badge">2</span>Valid ID Photos and Document Check</div>' +
        idModeBar +
      '</div>' +
      '<div class="grid-2" style="margin-bottom:12px">' +
        '<div style="border:1px solid var(--line); border-radius:10px; padding:10px; background:var(--soft); text-align:center">' +
          '<div style="font-size:11.5px; font-weight:700; margin-bottom:6px">' + (croppedUrl && activeIdImgMode === "cropped" ? "FRONT ID (CROPPED COPY)" : "FRONT ID (ORIGINAL UPLOADED COPY)") + '</div>' +
          '<img src="' + escapeHtml(displayedFrontUrl) + '" alt="Front ID" style="max-height:185px; margin:0 auto; border-radius:6px; object-fit:contain; cursor:pointer" onclick="window.open(this.src, \'_blank\')" title="Click to open full size in new tab" />' +
        '</div>' +
        '<div style="border:1px solid var(--line); border-radius:10px; padding:10px; background:var(--soft); text-align:center">' +
          '<div style="font-size:11.5px; font-weight:700; margin-bottom:6px">' + (croppedBackUrl && activeIdImgMode === "cropped" ? "BACK ID (CROPPED COPY)" : "BACK ID (ORIGINAL UPLOADED COPY)") + '</div>' +
          (displayedBackUrl
            ? '<img src="' + escapeHtml(displayedBackUrl) + '" alt="Back ID" style="max-height:185px; margin:0 auto; border-radius:6px; object-fit:contain; cursor:pointer" onclick="window.open(this.src, \'_blank\')" title="Click to open full size in new tab" />'
            : '<span class="muted small" style="display:block; padding:54px 0">No Back ID uploaded</span>') +
        '</div>' +
      '</div>' +

      ((frontIdPhotoUrl || idBackPhotoUrl)
        ? '<div class="mb"><b>Document findings</b>' +
          '<p class="small muted">Review any differences before requesting a correction.</p>' +
          '<div class="small" data-id-text-result role="status" style="white-space:pre-wrap; overflow-wrap:anywhere" data-front="' + escapeHtml(frontIdPhotoUrl) +
          '" data-back="' + escapeHtml(idBackPhotoUrl) + '" data-name="' + escapeHtml(viewData.full_name || app.full_name || "") +
          '" data-birth="' + escapeHtml(viewData.birth_date || "") + '" data-number="' + escapeHtml(viewData.id_number || "") +
          '">Checking the ID photos…</div></div>'
        : '') +
      '<div class="check-pill-grid" style="grid-template-columns:repeat(auto-fit, minmax(min(100%, 210px), 1fr));">' +
        '<div class="check-pill"><span>Duplicate Image Check</span>' + dupBadge + '</div>' +
        '<div class="check-pill"><span>Area Coverage</span>' + (typeof getCoverageBadgeHtml === "function" ? getCoverageBadgeHtml(app, true) : '<span class="badge badge-gray">-</span>') + '</div>' +
      '</div>' +
      (function () {
        var covInfo = typeof getApplicationCoverageInfo === "function" ? getApplicationCoverageInfo(app) : null;
        if (!covInfo || (covInfo.inPhilippines && covInfo.serviceable)) return "";
        return '<div class="small" style="margin-top:8px; padding:8px 10px; border-radius:8px; background:#fefce8; border:1px solid #fde047; color:#854d0e"><b>Location Coverage Notice:</b> ' + escapeHtml(covInfo.advisory || "Outside standard serviceable areas (Metro Manila, Bulacan, Cavite, Laguna, Rizal, Cebu) — verify facility coverage.") + '</div>';
      })() +

      '<details style="margin-top:10px; border-top:1px dashed var(--line); padding-top:8px">' +
        '<summary style="cursor:pointer; font-size:12.5px; font-weight:600; color:var(--muted)">View Activity Log (' + logs.length + ' entries)</summary>' +
        '<div class="chat-log" style="max-height:170px; overflow-y:auto; margin-top:8px">' + logItemsHtml + '</div>' +
      '</details>' +
    '</div>' +

    '<div class="section-card">' +
      '<div class="section-head">' +
        '<div class="section-head-title"><span class="step-badge">3</span>Application Status and Validator Decision</div>' +
        '<span class="tiny muted">Customers see Processing, Approved, or Rejected</span>' +
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
    '</div>' +

    (currentSt === "Needs Correction"
      ? '<div class="section-card" style="background:#fffaf5; border-color:#fed7aa">' +
          '<div class="section-head" style="margin-bottom:8px">' +
            '<div class="section-head-title"><span class="step-badge" style="background:#d97706">4</span>Customer Update Request Sent (Awaiting Customer Resubmission)</div>' +
            '<span class="badge badge-yellow">Waiting for Customer</span>' +
          '</div>' +
          '<div class="small" style="color:#7c2d12; line-height:1.55">' +
            '<div><b>Requested Field(s):</b> ' + escapeHtml(FIELD_SUMMARY_LABELS[activeCorrFields] || activeCorrFields || "Application / Valid ID Update") + '</div>' +
            (prefillRawNote ? '<div style="margin-top:4px"><b>Review / Validator Note:</b> ' + escapeHtml(prefillRawNote) + '</div>' : '') +
            '<div style="margin-top:4px"><b>Instruction Sent to Customer:</b> ' + escapeHtml(app.agent_remarks || prefillPoliteMsg || "Please submit the requested correction in your Customer Account.") + '</div>' +
            '<div class="tiny muted" style="margin-top:8px">This update request form is hidden while awaiting the customer\'s response and will automatically reopen once the customer resubmits their updated application or requirements.</div>' +
          '</div>' +
        '</div>'
      : '<details' + isCorrectionOpen + ' class="section-card" style="background:var(--soft)">' +
          '<summary style="cursor:pointer; font-weight:700; font-size:14.5px; color:var(--text); display:flex; align-items:center; gap:8px">' +
            '<span class="step-badge" style="background:#d97706">4</span>' +
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
  if (activeDetailAppId !== app.id) return;
  if (updateResultsOnly) {
    var template = document.createElement("template");
    template.innerHTML = detailHtml;
    var currentResults = document.getElementById("document-check-results");
    var nextResults = template.content.querySelector("#document-check-results");
    if (currentResults && nextResults) currentResults.replaceWith(nextResults);
    var currentStatus = document.getElementById("document-check-status");
    var nextStatus = template.content.querySelector("#document-check-status");
    if (currentStatus && nextStatus) currentStatus.replaceWith(nextStatus);
  } else {
    document.getElementById("det-body").innerHTML = detailHtml;
  }
  var findings = document.querySelector && document.querySelector("#det-body [data-id-text-result]");
  if (findings) showAgentIdFindings(findings);

}

function saveSelectedStatus() {
  var sel = document.getElementById("det-status-select");
  var chosen = sel ? sel.value : "Encoding";
  saveAgentDecision(chosen);
}

async function convertValidatorToPoliteRemark() {
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
  if (!app) return;

  var rawValidator = document.getElementById("det-validator-raw") ? document.getElementById("det-validator-raw").value.trim() : "";
  var chosenField = document.getElementById("det-correction-field") ? document.getElementById("det-correction-field").value : "auto";
  var statusRemarks = document.getElementById("det-remarks") ? document.getElementById("det-remarks").value.trim() : "";
  var corrRemarks = document.getElementById("det-correction-message") ? document.getElementById("det-correction-message").value.trim() : "";
  var remarks = newStatus === "Needs Correction" ? (corrRemarks || statusRemarks) : statusRemarks;
  var providerRef = document.getElementById("det-provider-ref") ? document.getElementById("det-provider-ref").value.trim() : (app.provider_ref || "");
  var isEncoded = (newStatus === "Encoding" || newStatus === "Approved");

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
  var updatedScreening = Object.assign({}, app.screening || {}, {
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
    customer_instruction: remarks,
    screening: updatedScreening,
    has_correction: newStatus === "Needs Correction" ? false : app.has_correction,
    encoded: isEncoded,
    provider_ref: providerRef,
    encoding_proof_url: proofUrl
  });

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

  await refreshAgentData();
  await renderDetailModalContent();
  showAlert("Status Updated", "Application " + app.reference_no + " is now marked as " + newStatus + "." + emailNoticeNote);
}

function printApplicantCopy() {
  return exportApplicantCopy(false);
}

function downloadApplicantCopy() {
  return exportApplicantCopy(true);
}

async function embedApplicantPhoto(url) {
  if (!url) return "";
  try {
    var response = await fetch(url, { referrerPolicy: "no-referrer" });
    if (!response.ok) return "";
    var photo = await response.blob();
    if (!/^image\/(?:jpeg|png|webp|gif|bmp)$/i.test(photo.type)) return "";
    return await new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { resolve(""); };
      reader.readAsDataURL(photo);
    });
  } catch (error) {
    return "";
  }
}

async function exportApplicantCopy(download) {
  var app = findAppById(activeDetailAppId);
  if (!app) return;
  var viewData = (activeCopyMode === "original" && app.original_submission) ? app.original_submission : app;
  var displayEmail = (activeCopyMode === "latest" && app.corrected_copy && app.corrected_copy.contact_email)
    ? app.corrected_copy.contact_email
    : (viewData.email || app.email || "-");
  var frontUrl = (activeIdImgMode === "cropped" && (app.cropped_id_url || app.id_cropped_url))
    ? (app.cropped_id_url || app.id_cropped_url)
    : (viewData.id_image_url || app.id_image_url || app.id_front_path || "");
  var backUrl = viewData.id_back_image_url || viewData.id_back_path || app.id_back_image_url || app.id_back_path || "";
  var fullAddr = [
    app.house_no ? app.house_no : "",
    app.building_name && app.building_name !== "N/A" ? app.building_name : "",
    viewData.street || app.street || "",
    app.subdivision || "",
    app.barangay ? "Brgy. " + app.barangay : "",
    app.city || "",
    app.province || ""
  ].filter(Boolean).join(", ");

  var printWin = download ? null : window.open("", "_blank", "width=920,height=780");
  if (!download && !printWin) {
    showAlert("Print preview blocked", "Allow pop-ups for PIGEM, then click Print again.");
    return;
  }
  var missingFrontLabel = "No front ID available";
  var missingBackLabel = "No back ID available";
  if (download) {
    var embedded = await Promise.all([embedApplicantPhoto(frontUrl), embedApplicantPhoto(backUrl)]);
    if (frontUrl && !embedded[0]) missingFrontLabel = "Front photo could not be downloaded";
    if (backUrl && !embedded[1]) missingBackLabel = "Back photo could not be downloaded";
    frontUrl = embedded[0];
    backUrl = embedded[1];
  }
  var docHtml =
    "<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'>" +
    "<title>Application Verification Copy - " + escapeHtml(app.reference_no || "") + "</title>" +
    "<style>" +
      "body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:880px;margin:28px auto;padding:0 22px;font-size:12px;line-height:1.45;}" +
      ".hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #c8102e;padding-bottom:12px;margin-bottom:16px;}" +
      ".hdr h1{font-size:18px;margin:0;color:#c8102e;}" +
      ".hdr p{margin:3px 0 0;color:#475467;font-size:12px;}" +
      ".sec{border:1px solid #d0d5dd;border-radius:8px;padding:12px 14px;margin-bottom:14px;page-break-inside:avoid;}" +
      ".sec h2{font-size:13.5px;margin:0 0 10px;text-transform:uppercase;color:#1e293b;border-bottom:1px solid #e4e7ec;padding-bottom:6px;}" +
      ".grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px 18px;}" +
      ".row-kv{display:flex;justify-content:space-between;gap:10px;border-bottom:1px dashed #e2e8f0;padding:4px 0;}" +
      ".row-kv span{color:#64748b;}" +
      ".row-kv b{text-align:right;color:#0f172a;overflow-wrap:anywhere;min-width:0;}" +
      ".id-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;text-align:center;margin-top:8px;}" +
      ".id-box{border:1px solid #cbd5e1;border-radius:8px;padding:10px;background:#f8fafc;}" +
      ".id-box b{display:block;font-size:11.5px;margin-bottom:6px;color:#334155;}" +
      ".id-box img{max-width:100%;max-height:220px;object-fit:contain;border-radius:4px;}" +
      "@page{size:A4;margin:14mm;}@media print{body{margin:0;padding:0;max-width:none;}.no-print{display:none!important;}}" +
    "</style></head><body>" +
      "<div class='hdr'>" +
        "<div><h1>PIGEM COMBINED FACILITIES SUPPORT SERVICES</h1><p>Internet Service Application · Verification Copy</p></div>" +
        "<div style='text-align:right;'><b>Ref No: " + escapeHtml(app.reference_no || "-") + "</b><p>Status: " + escapeHtml(app.status || "-") + " | Prepared: " + escapeHtml(new Date().toLocaleString()) + "</p></div>" +
      "</div>" +
      "<div class='sec'>" +
        "<h2>1. Applicant Profile &amp; Service Plan</h2>" +
        "<div class='grid2'>" +
          "<div class='row-kv'><span>Full Name</span><b>" + escapeHtml(viewData.full_name || app.full_name || "-") + "</b></div>" +
          "<div class='row-kv'><span>Selected Plan</span><b>" + escapeHtml(app.plan_name || "-") + "</b></div>" +
          "<div class='row-kv'><span>Birth Date</span><b>" + escapeHtml(viewData.birth_date || app.birth_date || "-") + "</b></div>" +
          "<div class='row-kv'><span>Submitted Date</span><b>" + escapeHtml(formatDate(app.created_at)) + "</b></div>" +
          "<div class='row-kv'><span>Email Address</span><b>" + escapeHtml(displayEmail) + "</b></div>" +
          "<div class='row-kv'><span>Mobile Number</span><b>" + escapeHtml(viewData.phone || app.phone || "-") + "</b></div>" +
          "<div class='row-kv'><span>Valid ID Type</span><b>" + escapeHtml(viewData.id_type || app.id_type || "-") + "</b></div>" +
          "<div class='row-kv'><span>Primary ID Number</span><b>" + escapeHtml(viewData.id_number || app.id_number || "-") + "</b></div>" +
        "</div>" +
      "</div>" +
      "<div class='sec'>" +
        "<h2>2. Installation Address &amp; Coordinates</h2>" +
        "<div class='grid2'>" +
          "<div class='row-kv'><span>Complete Address</span><b>" + escapeHtml(fullAddr || "-") + "</b></div>" +
          "<div class='row-kv'><span>Nearest Landmark</span><b>" + escapeHtml(app.landmark || "-") + "</b></div>" +
          "<div class='row-kv'><span>Pinned Coordinates</span><b>" + escapeHtml((app.latitude != null ? app.latitude : "-") + ", " + (app.longitude != null ? app.longitude : "-")) + "</b></div>" +
          "<div class='row-kv'><span>Assigned Agent</span><b>" + escapeHtml(app.assigned_agent || "Unassigned") + "</b></div>" +
        "</div>" +
      "</div>" +
      "<div class='sec'>" +
        "<h2>3. Uploaded Valid ID Copies (Front &amp; Back)</h2>" +
        "<div class='id-grid'>" +
          "<div class='id-box'><b>FRONT OF VALID ID</b>" + (frontUrl ? "<img src='" + escapeHtml(frontUrl) + "' alt='Front ID' />" : "<span>" + missingFrontLabel + "</span>") + "</div>" +
          "<div class='id-box'><b>BACK OF VALID ID</b>" + (backUrl ? "<img src='" + escapeHtml(backUrl) + "' alt='Back ID' />" : "<span>" + missingBackLabel + "</span>") + "</div>" +
        "</div>" +
        (app.agent_remarks ? "<div style='margin-top:10px;font-size:12px;color:#334155;'><b>Verification Remarks:</b> " + escapeHtml(app.agent_remarks) + "</div>" : "") +
      "</div>" +
      "<p>For PIGEM staff use only.</p>" +
      (download ? "" : "<button class='no-print' onclick='window.print()'>Print</button>") +
    "</body></html>";

  if (download) {
    var filename = "PIGEM-" + String(app.reference_no || "application").replace(/[^a-zA-Z0-9_-]/g, "_") + ".html";
    var url = URL.createObjectURL(new Blob([docHtml], { type: "text/html" }));
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    return;
  }
  printWin.opener = null;
  printWin.document.open();
  printWin.document.write(docHtml);
  printWin.document.close();
}

async function createNewAgentLink() {
  var note = document.getElementById("link-note").value.trim() || "Walk-in / Assisted Customer";
  await dbCreateAgentLink(getStaffIdentifier(currentAgent), note);
  document.getElementById("link-note").value = "";
  await renderAgentLinks();
}

async function renderAgentLinks() {
  var body = document.getElementById("agent-links-body");
  if (!body) return;
  var links = await dbListAgentLinks();
  agentLinks = links || [];
  var referralOnly = agentLinks.filter(function (link) {
    return !String(link.code || "").startsWith("INV-") && isAssignedToStaff(link.agent_email || link.agent_id, currentAgent);
  });
  if (referralOnly.length === 0) {
    body.innerHTML = '<tr><td colspan="6" class="muted">No links generated yet.</td></tr>';
    return;
  }
  var baseUrl = _getPortalBaseUrl() + "/apply.html";
  var html = "";
  for (var i = 0; i < referralOnly.length; i++) {
    var l = referralOnly[i];
    var fullUrl = baseUrl + "?agent=" + encodeURIComponent(l.code);
    html +=
      '<tr>' +
        '<td><b>' + escapeHtml(l.code) + '</b></td>' +
        '<td>' + escapeHtml(l.note) + '</td>' +
        '<td><input type="text" readonly value="' + escapeHtml(fullUrl) + '" style="font-size:12px; padding:5px 8px" /></td>' +
        '<td>' + formatDate(l.created_at) + '</td>' +
        '<td>' + allApps.filter(function (app) { return app.agent_link_code === l.code; }).length + '</td>' +
        '<td><button type="button" class="btn btn-outline btn-sm" onclick="navigator.clipboard.writeText(\'' + escapeHtml(fullUrl) + '\'); showAlert(\'Copied\', \'Application link copied to clipboard!\')">Copy URL</button></td>' +
      '</tr>';
  }
  body.innerHTML = html;
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
      return String(l.code || "").indexOf("INV-") !== 0 && matchesReportTimeframeValue(l.created_at, tfMode, exactDate, monthStr);
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
  downloadFormattedHtmlReport(data.title, data.timeframeLabel, data.pieSlices, data.columns, data.rows, "PIGEM-agent-" + activeAgentReportTab + "-report.html");
}
