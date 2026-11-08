var currentAgent = null;
var allApps = [];
var activeBranch = "overview";
var activeDetailAppId = null;
var activeCopyMode = "latest";
var activeIdImgMode = "cropped";
var pendingProofDataUrl = "";
var lastDetectedFields = null;
var isScreeningServiceOnline = true;
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
  var banner = document.getElementById("agent-screening-banner");
  if (!isAiEnabled()) {
    isScreeningServiceOnline = false;
    if (banner) banner.classList.remove("hidden");
    return false;
  }
  if (typeof apiCheckHealth === "function") {
    var health = await apiCheckHealth();
    if (!health || health.status !== "ok" || health.auto_screening_ready === false) {
      isScreeningServiceOnline = false;
      if (banner) banner.classList.remove("hidden");
      return false;
    }
  }
  isScreeningServiceOnline = true;
  if (banner) banner.classList.add("hidden");
  return true;
}

var VALIDATOR_PRESETS = [
  { label: "-- Select a Common Validator / Screening Remark --", raw: "", field: "auto", msg: "" },
  { label: "[Duplicate] Front and Back ID Photos are Identical", raw: "Uploaded Front ID and Back ID are the exact same photo", field: "id_photo", msg: "We noticed that the same photo was uploaded for both the Front and Back of your Valid ID. Please sign in to your Customer Account and upload a clear photo of the actual Front side and Back side of your Valid ID." },
  { label: "[Duplicate] Same Unclear ID Photo Re-Uploaded", raw: "Re-uploaded ID photo is identical to previous unclear image", field: "id_photo", msg: "The Valid ID photo you uploaded is identical to the previous unclear image. Please capture a new, well-lit photo of your physical Valid ID and upload it in your Customer Account." },
  { label: "[Quality] Blurry / Out-of-Focus Valid ID Text", raw: "Uploaded valid ID photo is blurry or unreadable", field: "id_photo", msg: "Your uploaded Valid ID photo is slightly blurry and the printed details could not be clearly read. Please upload a sharper photo of your Valid ID in a well-lit area." },
  { label: "[Quality] Flash Glare Covering Name or ID Number", raw: "Lighting glare covering text on valid ID", field: "id_photo", msg: "There is flash or lighting glare covering important text on your Valid ID. Please take a new photo without camera flash so all printed details are readable." },
  { label: "[Quality] ID Card Corners / Edges Cut Off", raw: "Valid ID corners or borders are cut off", field: "id_photo", msg: "Some edges of your Valid ID are cut off in the photo. Please upload a full photo showing all 4 corners of your physical ID card." },
  { label: "[OCR Mismatch] Applicant Name Does Not Match Printed ID", raw: "Applicant name entered does not match Valid ID", field: "name", msg: "The name entered on your application form does not match the legal name printed on your Valid ID. Please review and update your name in your Customer Account." },
  { label: "[OCR Mismatch] Birth Date Does Not Match Printed ID", raw: "Birth date entered does not match Valid ID", field: "birth_date", msg: "The birth date entered on your application form does not match the birth date printed on your Valid ID. Please verify and update your birth date." },
  { label: "[OCR Mismatch] Primary ID Number Mismatch", raw: "ID number entered does not match number printed on ID", field: "id_number", msg: "The ID number entered in the form does not match the number printed on your Valid ID card. Please check and update your ID number." },
  { label: "[OCR Mismatch] Selected ID Type Does Not Match Uploaded Card", raw: "Selected ID type does not match uploaded government ID", field: "id_photo", msg: "The Valid ID photo uploaded does not match the ID type selected in your form. Please upload the matching government ID or update your ID details." },
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
  return scr.state === "queued" || scr.state === "layer1_running" || scr.state === "layer2_running" || visualScreeningRunningAppId === (app && app.id);
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
    .replace(/\b(OpenCV|Gemini|FastAPI|Vercel|Qwen\S*|AI)\b/gi, "Screening")
    .replace(/\bScreening\s+Screening\b/gi, "Screening");
}

function detectClientSideDuplicateId(app) {
  if (!app) return { isDup: false, reason: "" };
  var scr = app.screening || {};
  if (scr.duplicate_check && scr.duplicate_check.has_duplicate) {
    var msg = (scr.duplicate_check.issues && scr.duplicate_check.issues[0]) || "Duplicate ID image detected.";
    return { isDup: true, reason: msg };
  }
  var front = String(app.id_image_url || app.id_front_path || "").trim();
  var back = String(app.id_back_image_url || app.id_back_path || "").trim();
  if (front && back && front === back) {
    return { isDup: true, reason: "Front ID and Back ID photos are identical." };
  }
  for (var i = 0; i < allApps.length; i++) {
    var other = allApps[i];
    if (!other || other.id === app.id) continue;
    var oFront = String(other.id_image_url || other.id_front_path || "").trim();
    if (front && front.length > 40 && oFront === front && front.indexOf("logo.png") === -1) {
      return { isDup: true, reason: "Same ID photo was already submitted in application " + (other.reference_no || other.ref_no) + "." };
    }
  }
  return { isDup: false, reason: "" };
}

window.addEventListener("DOMContentLoaded", async function () {
  currentAgent = await requireLogin(["agent", "manager", "admin"]);
  if (!currentAgent) return;

  document.getElementById("top-user-name").textContent = currentAgent.full_name;
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
      if (modal && !modal.classList.contains("hidden") && activeDetailAppId && !isTyping) {
        await renderDetailModalContent();
      }
    }
  }, 4500);
});

async function refreshAgentData(silent) {
  allApps = await dbListAllApplications();
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
    if (a.assigned_agent === currentAgent.email && (st === "Pending Review" || st === "Under Agent Review")) myClaimed++;
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
    renderCalendar("agent-calendar", allApps);
    await renderAgentLinks();
  }

  renderAgentCards();
}

function showTab(branch) {
  if (branch === "encoded") branch = "encoding";
  activeBranch = branch;
  var navIds = ["overview", "queue", "claimed", "encoding", "correction", "approved", "rejected", "links"];
  for (var i = 0; i < navIds.length; i++) {
    var btn = document.getElementById("nav-" + navIds[i]);
    if (btn) btn.classList.toggle("active", navIds[i] === branch);
  }

  var pills = document.querySelectorAll("[data-pill]");
  for (var p = 0; p < pills.length; p++) {
    var isMatch = pills[p].getAttribute("data-pill") === branch;
    pills[p].classList.toggle("btn-red", isMatch);
    pills[p].classList.toggle("btn-outline", !isMatch);
  }

  document.getElementById("tab-overview").classList.toggle("hidden", branch !== "overview");
  document.getElementById("tab-links").classList.toggle("hidden", branch !== "links");

  var isAppBranch = (
    branch === "queue" ||
    branch === "claimed" ||
    branch === "encoding" ||
    branch === "correction" ||
    branch === "approved" ||
    branch === "rejected"
  );
  document.getElementById("tab-apps").classList.toggle("hidden", !isAppBranch);

  if (isAppBranch) {
    var titles = {
      queue: ["Application Queue (Unclaimed)", "Customer applications incoming for screening and agent verification."],
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
  if (!isAiEnabled() || !isScreeningServiceOnline || state === "unavailable" || state === "paused" || scr.fallback_original_only) {
    return '<span class="badge badge-gray">Original ID Copy (Manual Review)</span>';
  }
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

function getScreeningQuickSummary(app) {
  var dup = detectClientSideDuplicateId(app);
  if (dup.isDup) {
    return '<span style="color:#b42318;font-weight:700;">' + escapeHtml(dup.reason) + '</span>';
  }
  var scr = app.screening || {};
  if (!isAiEnabled() || !isScreeningServiceOnline || scr.state === "unavailable" || scr.state === "paused" || scr.fallback_original_only) {
    return '<span class="muted">Auto-screening unavailable - customer\'s original uploaded ID photo is ready for manual review.</span>';
  }
  if (scr.state === "queued" || scr.state === "layer1_running" || scr.state === "layer2_running") {
    return '<span>' + escapeHtml(scr.advisory || "Screening in progress...") + '</span>';
  }
  if (scr.summary) {
    return '<span>' + escapeHtml(cleanScreeningText(scr.summary)) + '</span>';
  }
  var res = app.ai_result || {};
  var note = (res.issues && res.issues.length > 0) ? cleanScreeningText(res.issues.join("; ")) : "Document clear and details match.";
  return '<span class="muted">' + escapeHtml(note) + '</span>';
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
    if (activeBranch === "claimed" && !(a.assigned_agent === currentAgent.email && (st === "Pending Review" || st === "Under Agent Review"))) continue;
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
    box.innerHTML = '<div class="card muted" style="text-align:center; padding:28px">No applications in this view right now.</div>';
    return;
  }

  var html = "";
  for (var j = 0; j < filtered.length; j++) {
    var app = filtered[j];
    var isClaimedByMe = app.assigned_agent === currentAgent.email;
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
      '<div class="q-card">' +
        '<div class="q-head">' +
          '<div style="min-width:0; flex:1">' +
            '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap">' +
              '<span class="q-name">' + escapeHtml(app.full_name) + '</span>' +
              '<span class="badge badge-gray" style="font-weight:700">' + escapeHtml(app.reference_no) + '</span>' +
              statusBadge(app.status) +
            '</div>' +
            '<div class="q-sub" style="margin-top:4px">' +
              '<b>' + escapeHtml(app.plan_name || "Red Fiber Plan") + '</b>' +
              (locText ? ' &bull; ' + escapeHtml(locText) : '') +
              ' &bull; Submitted ' + formatDate(app.created_at) +
            '</div>' +
            '<div style="margin-top:8px; display:flex; gap:6px; align-items:center; flex-wrap:wrap">' +
              getScreeningCardBadge(app) +
              (app.cropped_id_url ? '<span class="badge badge-green">Cropped ID Ready</span>' : '') +
              (app.has_correction ? '<span class="badge badge-blue">Customer Resubmitted</span>' : '') +
            '</div>' +
          '</div>' +
          '<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">' +
            '<button type="button" class="btn btn-outline btn-sm" onclick="toggleCardMore(\'more-' + escapeHtml(app.id) + '\')">Summary</button>' +
            '<button type="button" class="btn btn-outline btn-sm" style="font-weight:700" onclick="openAppDetail(\'' + escapeHtml(app.id) + '\')">Open and Verify</button>' +
            claimBtn +
          '</div>' +
        '</div>' +
        '<div id="more-' + escapeHtml(app.id) + '" class="q-more hidden">' +
          '<div><b>Screening Note:</b> ' + getScreeningQuickSummary(app) + '</div>' +
          '<div style="margin-top:4px" class="small muted"><b>Contact:</b> ' + escapeHtml(app.email || "-") + ' | ' + escapeHtml(app.phone || "-") + '</div>' +
        '</div>' +
      '</div>';
  }
  box.innerHTML = html;
}

function toggleCardMore(elId) {
  var el = document.getElementById(elId);
  if (el) el.classList.toggle("hidden");
}

async function claimApplication(appId) {
  var app = findAppById(appId);
  var keepCorrection = app && app.status === "Needs Correction";
  await dbUpdateApplication(appId, {
    assigned_agent: currentAgent.email,
    status: keepCorrection ? "Needs Correction" : "Under Agent Review"
  });
  if (app) {
    await dbAddAiLog(app.id, app.reference_no, "Agent (" + currentAgent.full_name + ")", "Claimed application from queue.");
    await dbAddLog(currentAgent.email, "Claimed application " + app.reference_no);
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
  activeDetailAppId = appId;
  activeCopyMode = "latest";
  var app = findAppById(appId);
  activeIdImgMode = (app && app.cropped_id_url) ? "cropped" : "raw";
  pendingProofDataUrl = "";
  await renderDetailModalContent();
  document.getElementById("app-detail-modal").classList.remove("hidden");

  if (app && app.screening && app.screening.state === "queued" && isAiEnabled() && isScreeningServiceOnline) {
    retriggerAgentScreening(appId);
  }
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

async function retriggerAgentScreening(appId) {
  if (!appId || !isAiEnabled()) return;
  visualScreeningRunningAppId = appId;
  visualScreeningStage = 1;
  await renderDetailModalContent();

  var stepTimer1 = setTimeout(function () {
    if (visualScreeningRunningAppId === appId) {
      visualScreeningStage = 2;
      renderDetailModalContent();
    }
  }, 900);

  var stepTimer2 = setTimeout(function () {
    if (visualScreeningRunningAppId === appId) {
      visualScreeningStage = 3;
      renderDetailModalContent();
    }
  }, 1900);

  try {
    var apiRes = await apiStartBackgroundScreening(appId);
    await new Promise(function (r) { setTimeout(r, 2600); });
    clearTimeout(stepTimer1);
    clearTimeout(stepTimer2);

    var app = findAppById(appId);
    if (app && (!apiRes || !apiRes.screened)) {
      var dup = detectClientSideDuplicateId(app);
      var issues = dup.isDup ? [dup.reason] : [];
      var nextScr = Object.assign({}, app.screening || {}, {
        state: "completed",
        overall_match: !dup.isDup,
        quality_passed: !dup.isDup,
        fields_matched: true,
        summary: dup.isDup ? dup.reason : "Document readability, duplicate check, and printed ID fields verified.",
        notes: issues,
        screened_at: new Date().toISOString()
      });
      await dbUpdateApplication(appId, { screening: nextScr });
    }
  } finally {
    visualScreeningRunningAppId = null;
    visualScreeningStage = 0;
    await refreshAgentData(true);
    if (activeDetailAppId === appId) {
      await renderDetailModalContent();
    }
  }
}

function renderVisualScreeningProgressBox(app) {
  if (visualScreeningRunningAppId !== app.id) return "";
  var stg = visualScreeningStage || 1;
  var pct = stg === 1 ? 34 : (stg === 2 ? 68 : 95);

  var s1Icon = stg > 1 ? "&#10003;" : '<span class="inline-spinner"></span>';
  var s2Icon = stg > 2 ? "&#10003;" : (stg === 2 ? '<span class="inline-spinner"></span>' : "2");
  var s3Icon = stg === 3 ? '<span class="inline-spinner"></span>' : "3";

  return (
    '<div class="screening-live-box" style="margin-bottom:14px;">' +
      '<div class="row between" style="margin-bottom:8px;">' +
        '<div>' +
          '<b style="font-size:14px; color:var(--text);">Automated Document Screening Running...</b>' +
          '<div class="small muted">Inspecting uploaded Front and Back Valid ID photos and comparing printed text</div>' +
        '</div>' +
        '<span class="badge badge-blue">' + pct + '%</span>' +
      '</div>' +
      '<div class="progress" style="height:8px; margin-bottom:12px;">' +
        '<div style="width:' + pct + '%; transition:width 0.4s ease;"></div>' +
      '</div>' +
      '<div class="grid-3" style="gap:8px;">' +
        '<div class="screening-stage-pill ' + (stg >= 1 ? "active" : "") + '">' +
          '<span class="stage-num">' + s1Icon + '</span>' +
          '<div><b>Stage 1: Readability and Crop</b><div class="tiny muted">Checking blur, glare, and 4 corners</div></div>' +
        '</div>' +
        '<div class="screening-stage-pill ' + (stg >= 2 ? "active" : "") + '">' +
          '<span class="stage-num">' + s2Icon + '</span>' +
          '<div><b>Stage 2: Duplicate ID Check</b><div class="tiny muted">Comparing Front vs. Back hashes</div></div>' +
        '</div>' +
        '<div class="screening-stage-pill ' + (stg >= 3 ? "active" : "") + '">' +
          '<span class="stage-num">' + s3Icon + '</span>' +
          '<div><b>Stage 3: OCR Field Match</b><div class="tiny muted">Matching Name, DOB, and ID No.</div></div>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

async function renderDetailModalContent() {
  var app = findAppById(activeDetailAppId);
  if (!app) return;

  document.getElementById("det-title").textContent = app.reference_no + " - " + app.full_name;
  var viewData = (activeCopyMode === "original" && app.original_submission) ? app.original_submission : app;
  var scr = app.screening || {};
  var res = app.ai_result || {};
  var dupCheck = detectClientSideDuplicateId(app);
  var isManualFallback = (!isAiEnabled() || !isScreeningServiceOnline || scr.state === "unavailable" || scr.state === "paused" || scr.fallback_original_only);

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
          (isAiEnabled()
            ? '<button type="button" class="btn btn-red btn-sm" onclick="retriggerAgentScreening(\'' + escapeHtml(app.id) + '\')">Run Document Screening</button>'
            : '<span class="badge badge-yellow">Original Copy Ready</span>') +
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

  var docQualityLabel = isManualFallback
    ? "Manual Check"
    : (res.readability || (Number(res.blur_score) < 60 ? "Needs Check" : "Clear"));
  var dupBadge = dupCheck.isDup
    ? '<span class="badge badge-red">Duplicate Flagged</span>'
    : '<span class="badge badge-green">Distinct Photos</span>';
  var nameCheckBadge = isManualFallback
    ? '<span class="badge badge-gray">Verify Manually</span>'
    : (res.name_match === false ? '<span class="badge badge-red">Mismatch</span>' : '<span class="badge badge-green">Matched</span>');
  var bdateCheckBadge = isManualFallback
    ? '<span class="badge badge-gray">Verify Manually</span>'
    : (res.birth_date_match === false ? '<span class="badge badge-red">Mismatch</span>' : '<span class="badge badge-green">Matched</span>');
  var idNoCheckBadge = isManualFallback
    ? '<span class="badge badge-gray">Verify Manually</span>'
    : (res.id_number_match === false ? '<span class="badge badge-red">Mismatch</span>' : '<span class="badge badge-green">Matched</span>');

  var findingsText = dupCheck.isDup
    ? dupCheck.reason
    : (isManualFallback
      ? "Please inspect the customer's original uploaded ID photos and match them with Section 1."
      : (scr.summary || ((res.issues && res.issues.length) ? cleanScreeningText(res.issues.join("; ")) : "Readability, duplicate check, and printed OCR fields passed.")));

  var copySwitcher = "";
  if (app.original_submission) {
    copySwitcher =
      '<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap">' +
        '<span class="small muted">Version:</span>' +
        '<button type="button" class="btn btn-sm ' + (activeCopyMode === "latest" ? "btn-red" : "btn-outline") + '" style="padding:3px 10px; font-size:12px" onclick="switchCopyMode(\'latest\')">Latest Copy</button>' +
        '<button type="button" class="btn btn-sm ' + (activeCopyMode === "original" ? "btn-red" : "btn-outline") + '" style="padding:3px 10px; font-size:12px" onclick="switchCopyMode(\'original\')">Original Submission</button>' +
      '</div>';
  }

  var rawFrontUrl = viewData.id_image_url || app.id_image_url || app.id_front_path || "assets/images/black-logo-white-mode.png";
  var croppedUrl = (activeCopyMode === "latest" && (app.cropped_id_url || app.id_cropped_url)) ? (app.cropped_id_url || app.id_cropped_url) : "";
  var displayedFrontUrl = (croppedUrl && activeIdImgMode === "cropped") ? croppedUrl : rawFrontUrl;
  var idBackPhotoUrl = viewData.id_back_image_url || viewData.id_back_path || app.id_back_image_url || app.id_back_path || "";

  var idModeBar = '<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap">';
  if (croppedUrl) {
    idModeBar +=
      '<button type="button" class="btn btn-sm ' + (activeIdImgMode === "cropped" ? "btn-red" : "btn-outline") + '" style="padding:3px 10px; font-size:12px" onclick="switchIdImgMode(\'cropped\')">Cropped Copy</button>' +
      '<button type="button" class="btn btn-sm ' + (activeIdImgMode === "raw" ? "btn-red" : "btn-outline") + '" style="padding:3px 10px; font-size:12px" onclick="switchIdImgMode(\'raw\')">Original Photo</button>';
  }
  if (isAiEnabled()) {
    idModeBar +=
      '<button type="button" class="btn btn-sm btn-red" style="padding:3px 10px; font-size:12px" onclick="retriggerAgentScreening(\'' + escapeHtml(app.id) + '\')">' +
        (visualScreeningRunningAppId === app.id ? "Running Screening..." : "Run / Refresh Document Check") +
      '</button>';
  }
  idModeBar += '</div>';

  var currentSt = app.status || "Under Agent Review";
  var selectedReqStatus = (currentSt === "Approved" || currentSt === "Rejected" || currentSt === "Encoding" || currentSt === "Under Agent Review")
    ? currentSt
    : "Encoding";
  var hasPrelimConcern = Boolean((dupCheck.isDup || scr.overall_match === false || scr.review_recommended) && currentSt !== "Approved" && currentSt !== "Rejected");
  var isCorrectionOpen = (currentSt === "Needs Correction" || hasPrelimConcern) ? " open" : "";
  var activeCorrFields = dupCheck.isDup
    ? "id_photo"
    : ((app.correction_fields && app.correction_fields.length)
      ? app.correction_fields.join(",")
      : ((scr.suggested_fields && scr.suggested_fields.length) ? scr.suggested_fields[0] : ""));
  var prefillRawNote = app.validator_raw_remark || (dupCheck.isDup ? dupCheck.reason : (hasPrelimConcern ? (scr.summary || "") : ""));
  var prefillPoliteMsg = currentSt === "Needs Correction"
    ? (app.agent_remarks || "")
    : (dupCheck.isDup
      ? "We noticed that the same photo was uploaded for your Valid ID. Please sign in to your Customer Account and upload clear, separate photos of the Front and Back of your Valid ID."
      : (hasPrelimConcern ? (scr.Suggested_remark || "") : ""));
  var displayEmail = (activeCopyMode === "latest" && app.corrected_copy && app.corrected_copy.contact_email)
    ? app.corrected_copy.contact_email
    : (viewData.email || app.email);

  document.getElementById("det-body").innerHTML =
    topScreeningBanner +

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
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="section-card">' +
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
          '<div style="font-size:11.5px; font-weight:700; margin-bottom:6px">BACK ID (ORIGINAL UPLOADED COPY)</div>' +
          (idBackPhotoUrl
            ? '<img src="' + escapeHtml(idBackPhotoUrl) + '" alt="Back ID" style="max-height:185px; margin:0 auto; border-radius:6px; object-fit:contain; cursor:pointer" onclick="window.open(this.src, \'_blank\')" title="Click to open full size in new tab" />'
            : '<span class="muted small" style="display:block; padding:54px 0">No Back ID uploaded</span>') +
        '</div>' +
      '</div>' +

      '<div class="check-pill-grid" style="grid-template-columns:repeat(auto-fit, minmax(135px, 1fr));">' +
        '<div class="check-pill"><span>Readability (Blur/Glare)</span><b>' + escapeHtml(docQualityLabel) + '</b></div>' +
        '<div class="check-pill"><span>Duplicate Image Check</span>' + dupBadge + '</div>' +
        '<div class="check-pill"><span>Applicant Name (OCR)</span>' + nameCheckBadge + '</div>' +
        '<div class="check-pill"><span>Birth Date (OCR)</span>' + bdateCheckBadge + '</div>' +
        '<div class="check-pill"><span>ID Number (OCR)</span>' + idNoCheckBadge + '</div>' +
      '</div>' +
      '<div class="small muted" style="margin-top:8px"><b>Screening Summary:</b> ' + escapeHtml(findingsText) + '</div>' +

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

    '<details' + isCorrectionOpen + ' class="section-card" style="background:var(--soft)">' +
      '<summary style="cursor:pointer; font-weight:700; font-size:14.5px; color:var(--text); display:flex; align-items:center; gap:8px">' +
        '<span class="step-badge" style="background:#d97706">4</span>' +
        '<span>Request Customer Update (Needs Correction)</span>' +
      '</summary>' +
      '<div style="margin-top:12px; padding-top:10px; border-top:1px solid var(--line)">' +
        '<p class="muted" style="font-size:12.5px; margin-bottom:12px">Use this section when the customer needs to correct a detail or upload a clearer / non-duplicate ID photo.</p>' +

        '<div class="grid-2" style="margin-bottom:10px">' +
          '<div class="field" style="margin-bottom:0">' +
            '<label>Field for Customer to Update</label>' +
            '<select id="det-correction-field">' +
              '<option value="auto">Auto-Detect Field</option>' +
              '<option value="id_photo" ' + (activeCorrFields === "id_photo" ? "selected" : "") + '>Valid ID Photo (Blurry / Glare / Duplicate)</option>' +
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
            '<button type="button" id="btn-polite-gen" class="btn btn-outline btn-sm" style="padding:3px 10px; font-size:12px" onclick="convertValidatorToPoliteRemark()">Compose Polite Message</button>' +
          '</div>' +
          '<span id="polite-running-spinner" class="badge badge-blue" style="display:none; margin-bottom:6px">Composing message...</span>' +
          '<textarea id="det-correction-message" rows="2" placeholder="Select a preset above, click Compose Polite Message, or type your instruction for the customer...">' + escapeHtml(prefillPoliteMsg) + '</textarea>' +
        '</div>' +

        '<div class="row" style="justify-content:flex-end">' +
          '<button type="button" class="btn btn-outline" style="border-color:#d97706; color:#b45309; font-weight:700" onclick="saveAgentDecision(\'Needs Correction\')">Send Update Request to Customer</button>' +
        '</div>' +
      '</div>' +
    '</details>';
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
      btn.textContent = "Compose Polite Message";
    }
  }
}

function onEncodingProofPick(inputEl) {
  var file = inputEl.files && inputEl.files[0];
  if (!file) return;
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
    remarks = "Congratulations! Your application has been approved. Please allow 3 to 5 business days for installation scheduling.";
  } else if (newStatus === "Rejected" && !remarks) {
    remarks = rawValidator || "Your application did not pass provider validation.";
  } else if (newStatus === "Needs Correction" && !remarks) {
    if (rawValidator || chosenField !== "auto") {
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

  var proofUrl = pendingProofDataUrl || app.encoding_proof_url || "";
  var updatedScreening = Object.assign({}, app.screening || {}, {
    correction_fields: newStatus === "Needs Correction" ? targetFields : [],
    auto_correction_sent: false,
    validator_raw_remark: rawValidator
  });

  await dbUpdateApplication(app.id, {
    status: newStatus,
    assigned_agent: currentAgent.email,
    agent_remarks: remarks,
    correction_note: remarks,
    customer_instruction: remarks,
    screening: updatedScreening,
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
    var targetSummaryLabel = FIELD_SUMMARY_LABELS[chosenField] || (rawValidator ? rawValidator : "Information / Document Clarification");
    var recipientEmail = (app.corrected_copy && app.corrected_copy.contact_email) || app.email;

    await dbAddNotification(recipientEmail, "customer", custTitle, remarks);
    var mailRes = await apiSendStatusEmail(recipientEmail, app.full_name, app.reference_no, newStatus, remarks, targetSummaryLabel);
    if (mailRes && mailRes.sent) {
      emailNoticeNote = " Email notification sent to " + recipientEmail + ".";
    }
  }

  await dbAddLog(currentAgent.email, "Set application " + app.reference_no + " status to " + newStatus);

  closeDetailModal();
  await refreshAgentData();
  showAlert("Status Updated", "Application " + app.reference_no + " is now marked as " + newStatus + "." + emailNoticeNote);
}

function downloadApplicantId() {
  var app = findAppById(activeDetailAppId);
  if (!app) return;
  var url = (activeIdImgMode === "cropped" && app.cropped_id_url)
    ? app.cropped_id_url
    : (app.id_image_url || app.id_front_path || "assets/images/black-logo-white-mode.png");
  var suffix = (activeIdImgMode === "cropped" && app.cropped_id_url) ? "-ID-Cropped.jpg" : "-ID.png";
  var a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.download = (app.reference_no || "applicant") + suffix;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function printApplicantCopy() {
  window.print();
}

async function createNewAgentLink() {
  var note = document.getElementById("link-note").value.trim() || "Walk-in / Assisted Customer";
  await dbCreateAgentLink(currentAgent.email, note);
  document.getElementById("link-note").value = "";
  await renderAgentLinks();
}

async function renderAgentLinks() {
  var body = document.getElementById("agent-links-body");
  if (!body) return;
  var links = await dbListAgentLinks();
  var referralOnly = links.filter(function (l) { return String(l.code || "").indexOf("INV-") !== 0; });
  if (referralOnly.length === 0) {
    body.innerHTML = '<tr><td colspan="5" class="muted">No links generated yet.</td></tr>';
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
        '<td><button type="button" class="btn btn-outline btn-sm" onclick="navigator.clipboard.writeText(\'' + escapeHtml(fullUrl) + '\'); showAlert(\'Copied\', \'Application link copied to clipboard!\')">Copy URL</button></td>' +
      '</tr>';
  }
  body.innerHTML = html;
}
