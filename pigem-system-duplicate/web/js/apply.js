var currentPanel = 0;
var TOTAL_PANELS = 6;
var selectedPlanId = "1000";
var referralAgentId = "";
var leafletMap = null;
var leafletMarker = null;

var selectedFrontFile = null;
var selectedBackFile = null;

var isContactOtpVerified = false;
var verifiedEmailAddress = "";

var SECTION_TITLES = [
  "Select Your Plan",
  "Personal Information",
  "Contact Information",
  "Installation Location",
  "Valid ID Documents",
  "Subscriber Declaration and Consent"
];

function showReqTip(el, fieldName, detail) {
  hideReqTip(el);
  var bubble = document.createElement("span");
  bubble.className = "req-bubble";
  bubble.innerHTML = "<b style='color:#fff;display:block;margin-bottom:2px;'>" + fieldName + " (Required)</b>" + detail;
  el.appendChild(bubble);
}

function hideReqTip(el) {
  if (!el) return;
  var old = el.querySelector(".req-bubble:not(.error-pop)");
  if (old) old.remove();
}

function flashErrorBubble(fieldId, fieldName, message) {
  var targetMap = {
    agree_sub: "agree_sub_wrap",
    id_front: "id-front-box",
    id_back: "id-back-box",
    contact_otp: "email"
  };
  var targetId = targetMap[fieldId] || fieldId;
  if (typeof setFieldError === "function") {
    setFieldError(targetId, message);
  }
}

function setupDeviceUploadUI() {
  var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (window.innerWidth <= 768);
  var camBtns = document.querySelectorAll(".phone-only-btn");
  var qrBtn = document.getElementById("btn-phone-qr");

  if (!isMobile) {
    for (var i = 0; i < camBtns.length; i++) {
      camBtns[i].style.display = "none";
    }
    if (qrBtn) qrBtn.hidden = false;
  } else {
    for (var j = 0; j < camBtns.length; j++) {
      camBtns[j].style.display = "inline-flex";
    }
    if (qrBtn) qrBtn.hidden = true;
  }
}

var phoneCorrectionToken = "";
var phoneCorrectionFiles = {};
var phoneCorrectionPreviews = {};

var APPLY_DRAFT_KEY = "pigem_apply_wizard_draft";
var APPLY_PHONE_TICKET_KEY = "pigem_apply_phone_ticket";
var APPLY_CONTACT_OTP_KEY = "pigem_apply_pending_email_otp";
var sendingContactOtp = false;
var APPLY_DRAFT_FIELDS = [
  "first_name", "middle_name", "last_name", "birth_date", "email", "phone", "phone_alt",
  "house_no", "house_suffix", "unit_no", "unit_type", "floor_no", "building_name", "street", "subdivision",
  "barangay", "city", "province", "landmark", "remarks", "id_type", "id_number"
];

function saveApplyDraftState() {
  if (sessionStorage.getItem(APPLICATION_HANDOFF_WATCH)) return;
  try {
    var vals = {};
    for (var i = 0; i < APPLY_DRAFT_FIELDS.length; i++) {
      var fid = APPLY_DRAFT_FIELDS[i];
      var el = document.getElementById(fid);
      if (el) vals[fid] = el.value;
    }
    var agree1 = document.getElementById("agree_sub");
    var agree2 = document.getElementById("agree_tu");
    var draft = {
      currentPanel: applyResumePanel || currentPanel,
      selectedPlanId: selectedPlanId,
      isContactOtpVerified: isContactOtpVerified,
      verifiedEmailAddress: verifiedEmailAddress,
      pinLocationState: _pinLocationState,
      addressNeedsPin: _addressNeedsPin,
      agree_sub: agree1 ? agree1.checked : false,
      agree_tu: agree2 ? agree2.checked : false,
      values: vals
    };
    sessionStorage.setItem(APPLY_DRAFT_KEY, JSON.stringify(draft));
  } catch (e) {}
}

function restoreApplyDraftState(hasExplicitUrlPlan) {
  try {
    var raw = sessionStorage.getItem(APPLY_DRAFT_KEY);
    if (!raw) return;
    var draft = JSON.parse(raw);
    if (!draft || typeof draft !== "object") return;
    if (!hasExplicitUrlPlan && draft.selectedPlanId) {
      selectedPlanId = draft.selectedPlanId;
    }
    var vals = draft.values || {};
    for (var i = 0; i < APPLY_DRAFT_FIELDS.length; i++) {
      var fid = APPLY_DRAFT_FIELDS[i];
      var el = document.getElementById(fid);
      if (el && typeof vals[fid] === "string") {
        el.value = vals[fid];
      }
    }
    if (draft.isContactOtpVerified && draft.verifiedEmailAddress) {
      var curEm = (document.getElementById("email") ? document.getElementById("email").value : "").trim().toLowerCase();
      if (curEm && curEm === String(draft.verifiedEmailAddress).toLowerCase()) {
        isContactOtpVerified = true;
        verifiedEmailAddress = curEm;
        var otpButton = document.getElementById("btn-send-otp");
        otpButton.textContent = "Email verified";
        otpButton.disabled = true;
        var st = document.getElementById("email-otp-inline-status");
        if (st) {
          st.style.display = "block";
          st.innerHTML = '<span class="badge status-approved">Verified</span> <span style="color:var(--good);font-weight:600;">Email verified (' + escapeHtml(verifiedEmailAddress) + ').</span>';
        }
      }
    }
    if (draft.pinLocationState?.lat && draft.pinLocationState?.lng) {
      _pinLocationState = draft.pinLocationState;
      document.getElementById("lat").value = _pinLocationState.lat;
      document.getElementById("lng").value = _pinLocationState.lng;
    }
    _addressNeedsPin = draft.addressNeedsPin === true;
    if (!referralAgentId && draft.referralAgentId) referralAgentId = draft.referralAgentId;
    var agree1 = document.getElementById("agree_sub");
    var agree2 = document.getElementById("agree_tu");
    if (agree1 && typeof draft.agree_sub === "boolean") agree1.checked = draft.agree_sub;
    if (agree2 && typeof draft.agree_tu === "boolean") agree2.checked = draft.agree_tu;
    renderPlanChoices();
    if (typeof updateIdFormatHint === "function") updateIdFormatHint();
    var targetPanel = Math.min(Number(draft.currentPanel || 0), 4);
    if (!applyCaptchaVerified) applyResumePanel = targetPanel;
    if (targetPanel >= 0 && targetPanel < TOTAL_PANELS) {
      showPanel(applyCaptchaVerified ? targetPanel : 0);
    }
  } catch (e) {}
}

async function initApplyPage() {
  var params = new URLSearchParams(window.location.search);
  if (params.get("phone_returned") === "1") {
    showApplicationReturnedToDesktop();
    return;
  }
  var phoneToken = new URLSearchParams(window.location.hash.slice(1)).get("phone");
  if (phoneToken || (params.get("phone_correction") === "1" && sessionStorage.getItem("pigem_phone_correction"))) {
    if (await openMobilePhoneTransfer(phoneToken)) return;
  }
  if (params.get("qr_upload") === "1" || params.get("phone_correction") === "1") {
    showApplicationHandoff("QR link expired", "Create a new QR code on your desktop and scan it again.", true);
    return;
  }

  var urlPlan = params.get("plan");
  if (!urlPlan) {
    try {
      urlPlan = sessionStorage.getItem("pigem_selected_plan") || "";
    } catch (e) {}
  }
  var urlAgent = params.get("agent") || params.get("ref");

  if (urlPlan) selectedPlanId = String(urlPlan);
  if (urlAgent) {
    referralAgentId = urlAgent;
    var banner = document.getElementById("agent-ref-banner");
    if (banner) {
      banner.hidden = false;
      banner.innerHTML = "<b>Agent Referral Active:</b> Your application is linked to Agent ID <b>" + escapeHtml(referralAgentId) + "</b>.";
    }
  }

  var phoneTicket = sessionStorage.getItem(APPLY_PHONE_TICKET_KEY);
  var ticketAge = phoneTicket ? Date.now() / 1000 - Number(phoneTicket.split(".")[0]) : Infinity;
  if (ticketAge >= 0 && ticketAge < 7200) {
    applicationScreeningTicket = phoneTicket;
    applyCaptchaVerified = true;
  }
  renderPlanChoices();
  setupDeviceUploadUI();
  attachApplyLiveValidation();
  var desktopWatch = JSON.parse(sessionStorage.getItem(APPLICATION_HANDOFF_WATCH));
  refreshApplicationHandoffButtons();
  if (desktopWatch) startApplicationHandoffMonitor(desktopWatch);
  else {
    restoreApplyDraftState(Boolean(urlPlan));
    await restoreApplicationHandoffPhotos();
  }
  updateContactOtpButton(document.getElementById("email").value.trim().toLowerCase());

  document.addEventListener("input", function (ev) {
    if (ev && ev.target && ev.target.id) saveApplyDraftState();
  });
  document.addEventListener("change", function (ev) {
    if (ev && ev.target && ev.target.id) saveApplyDraftState();
  });
  window.addEventListener("resize", function () {
    setupDeviceUploadUI();
    refreshApplicationHandoffButtons();
  });

  try {
    if (typeof dbSyncLiveSettingsAndContent === "function") {
      await dbSyncLiveSettingsAndContent(false);
    }
    var liveContent = (typeof getWebsiteContent === "function") ? getWebsiteContent() : null;
    window._latestWebsiteContent = liveContent;
    var mInfo = (typeof getMaintenanceBlockInfo === "function")
      ? getMaintenanceBlockInfo(liveContent)
      : { blocked: typeof isMaintenanceOn === "function" && isMaintenanceOn() };
    if (mInfo && mInfo.blocked && !(typeof isManagerOrAdminPreview === "function" && isManagerOrAdminPreview())) {
      if (typeof renderMaintenanceScreenHtml === "function") {
        renderMaintenanceScreenHtml(mInfo.title || "Website Under Maintenance", mInfo.message);
      } else {
        closePopup();
        document.body.innerHTML =
          '<main class="auth-page">' +
            '<div class="card auth-card center" style="max-width:520px">' +
              '<h2>' + escapeHtml(mInfo.title || "Website Under Maintenance") + '</h2>' +
              '<p class="muted mt">' + escapeHtml(mInfo.message || "Online fiber applications are temporarily paused for scheduled maintenance.") + '</p>' +
              '<div style="margin-top:18px"><a href="index.html" class="btn btn-red">Back to Home Page</a></div>' +
            '</div>' +
          '</main>';
      }
      return;
    }
    renderPlanChoices();
  } catch (e) {}
  if (!desktopWatch) showApplyCaptcha();
}

function attachApplyLiveValidation() {
  var dobEl = document.getElementById("birth_date");
  if (dobEl && typeof getMaxAdultBirthDate === "function") {
    dobEl.setAttribute("max", getMaxAdultBirthDate(18));
    var checkDob = function () {
      if (!dobEl.value) {
        if (typeof clearFieldError === "function") clearFieldError("birth_date");
        return;
      }
      var res = validateAdultBirthDate(dobEl.value, 18);
      if (!res.valid && typeof setFieldError === "function") {
        setFieldError("birth_date", res.message);
      } else if (typeof clearFieldError === "function") {
        clearFieldError("birth_date");
      }
    };
    dobEl.addEventListener("change", checkDob);
    dobEl.addEventListener("blur", checkDob);
  }

  var nameIds = [
    { id: "first_name", label: "First Name", allowNA: false, allowEmpty: false },
    { id: "middle_name", label: "Middle Name", allowNA: true, allowEmpty: true },
    { id: "last_name", label: "Last Name", allowNA: false, allowEmpty: false }
  ];
  var attachNameCheck = function (spec) {
    var el = document.getElementById(spec.id);
    if (!el) return;
    var checkOne = function () {
      var val = el.value.trim();
      if (!val) {
        if (typeof clearFieldError === "function") clearFieldError(spec.id);
        return;
      }
      var r = validatePersonName(val, spec.label, spec.allowNA, spec.allowEmpty);
      if (!r.valid && typeof setFieldError === "function") {
        setFieldError(spec.id, r.message);
      } else if (typeof clearFieldError === "function") {
        clearFieldError(spec.id);
      }
    };
    el.addEventListener("input", checkOne);
    el.addEventListener("blur", checkOne);
  };
  for (var n = 0; n < nameIds.length; n++) {
    attachNameCheck(nameIds[n]);
  }

  var emailEl = document.getElementById("email");
  if (emailEl) {
    emailEl.addEventListener("blur", normalizeApplyGmail);
    emailEl.addEventListener("input", function () {
      if (typeof clearFieldError === "function") clearFieldError("email");
      if (emailEl.value.trim().toLowerCase() !== verifiedEmailAddress) {
        isContactOtpVerified = false;
        var st = document.getElementById("email-otp-inline-status");
        if (st) st.style.display = "none";
        updateContactOtpButton(emailEl.value.trim().toLowerCase());
      }
    });
    var onEmailBlur = function () {
      var val = emailEl.value.trim().toLowerCase();
      if (val && typeof isCustomerGmail === "function" && isCustomerGmail(val)) {
        checkContactDetailsAlreadyInSystem(true);
      }
    };
    emailEl.addEventListener("blur", onEmailBlur);
    emailEl.addEventListener("change", onEmailBlur);
  }

  var phoneEl = document.getElementById("phone");
  if (phoneEl) {
    phoneEl.addEventListener("input", function () {
      if (typeof clearFieldError === "function") clearFieldError("phone");
      var digits = phoneEl.value.trim().replace(/\D/g, "");
      if (digits.length === 11 && /^09\d{9}$/.test(digits)) {
        checkContactDetailsAlreadyInSystem(false);
      }
    });
    var onPhoneBlur = function () {
      var digits = phoneEl.value.trim().replace(/\D/g, "");
      if (digits.length >= 10) {
        checkContactDetailsAlreadyInSystem(false);
      }
    };
    phoneEl.addEventListener("blur", onPhoneBlur);
    phoneEl.addEventListener("change", onPhoneBlur);
  }

  var altPhoneEl = document.getElementById("phone_alt");
  if (altPhoneEl) {
    var checkAltPhone = function () {
      var raw = altPhoneEl.value.trim();
      if (!raw) {
        if (typeof clearFieldError === "function") clearFieldError("phone_alt");
        return;
      }
      var digits = raw.replace(/\D/g, "");
      if (digits.length !== 11 || !FORM_VALIDATOR.isValidMobile(digits)) {
        if (typeof setFieldError === "function") {
          setFieldError("phone_alt", "Secondary mobile number must be 11 digits starting with 09 (or leave blank).");
        }
      } else if (typeof clearFieldError === "function") {
        clearFieldError("phone_alt");
      }
    };
    altPhoneEl.addEventListener("input", checkAltPhone);
    altPhoneEl.addEventListener("blur", checkAltPhone);
  }
}

function showMobileTransferPanel() {
  document.querySelectorAll(".form-wrap > :not(#panel-qr-mobile)").forEach(function (section) {
    section.hidden = true;
  });
  document.getElementById("panel-qr-mobile").hidden = false;
}

async function openMobilePhoneTransfer(token) {
  refreshApplicationHandoffButtons(true);
  showApplicationHandoff("Opening transfer", "Opening the QR link…", true);
  try {
    var transfer = token
      ? await phoneTransfer("open", { token: token })
      : { mode: "correction", upload: sessionStorage.getItem("pigem_phone_correction") };
    if (transfer.mode === "application") {
      sessionStorage.removeItem("pigem_phone_correction");
      acceptApplicationSnapshot(transfer);
      sessionStorage.setItem(APPLY_PHONE_TICKET_KEY, transfer.screening_ticket || "");
      if (transfer.edit) sessionStorage.setItem(APPLICATION_HANDOFF_EDIT, transfer.edit);
      history.replaceState(null, "", window.location.pathname);
      document.getElementById("application-handoff").hidden = true;
      document.getElementById("apply-step-progress").hidden = false;
      return false;
    }
    if (transfer.mode !== "correction" || !transfer.upload) throw new Error("This QR link could not be opened.");
    phoneCorrectionToken = transfer.upload;
    sessionStorage.setItem("pigem_phone_correction", phoneCorrectionToken);
    history.replaceState(null, "", window.location.pathname + "?phone_correction=1");
    showMobileTransferPanel();
    refreshApplicationHandoffButtons();
    document.getElementById("phone-mobile-fields").hidden = false;
    document.getElementById("phone-mobile-status").textContent = "Choose the requested photos, then select Send photos.";
  } catch (error) {
    refreshApplicationHandoffButtons();
    showApplicationHandoff("Could not open transfer", error.message || "Generate a new QR code on your desktop and scan it again.", true);
  }
  return true;
}

function handleMobileQrUpload(side, input) {
  var file = input.files[0];
  if (!file) return;
  var status = document.getElementById("qr-" + side + "-status");
  if (!file.type.startsWith("image/")) {
    status.textContent = "Choose a JPG or PNG image.";
    return;
  }
  phoneCorrectionFiles[side] = file;
  if (phoneCorrectionPreviews[side]) URL.revokeObjectURL(phoneCorrectionPreviews[side]);
  phoneCorrectionPreviews[side] = URL.createObjectURL(file);
  document.getElementById("qr-" + side + "-preview").src = phoneCorrectionPreviews[side];
  document.getElementById("qr-" + side + "-preview-box").hidden = false;
  status.textContent = "Photo selected.";
}

async function phonePhotoAsJpeg(file) {
  if (!file) return "";
  var bitmap = await createImageBitmap(file);
  try {
    var scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    var ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    bitmap.close();
  }
}

async function sendMobileCorrectionPhotos(button) {
  if (button.disabled) return;
  var status = document.getElementById("phone-mobile-status");
  if (!phoneCorrectionFiles.front && !phoneCorrectionFiles.back) {
    status.textContent = "Choose at least one ID photo.";
    return;
  }
  button.disabled = true;
  status.textContent = "Sending photos…";
  try {
    var photos = await Promise.all([
      phonePhotoAsJpeg(phoneCorrectionFiles.front), phonePhotoAsJpeg(phoneCorrectionFiles.back)
    ]);
    await phoneTransfer("photos", { token: phoneCorrectionToken, front: photos[0], back: photos[1] });
    sessionStorage.removeItem("pigem_phone_correction");
    document.getElementById("phone-mobile-fields").hidden = true;
    status.textContent = "Photos sent. Return to your computer to review and submit your correction.";
  } catch (error) {
    status.textContent = error.name === "InvalidStateError" ? "Choose a JPG or PNG image." : (error.message || "Could not send photos. Try again.");
    button.disabled = false;
  }
}

function leaveApplicationForm(event) {
  if (sessionStorage.getItem(APPLICATION_HANDOFF_EDIT)) {
    event.preventDefault();
    returnApplicationToDesktop();
    return false;
  }
  if (!document.getElementById("panel-qr-mobile").hidden) return true;
  var hasDetails = APPLY_DRAFT_FIELDS.some(function (key) {
    var field = document.getElementById(key);
    return field && field.value.trim() !== field.defaultValue && field.value.trim() !== "";
  });
  if (!hasDetails && !selectedFrontFile && !selectedBackFile) return true;
  event.preventDefault();
  openPopup(
    '<h2>Go back to the website?</h2><p class="muted mt">You can keep your filled-in details for this tab. Choose your ID photos again when you return.</p>' +
    '<div class="row mt apply-leave-actions">' +
    '<button type="button" class="btn btn-outline" onclick="closePopup()">Keep editing</button>' +
    '<button type="button" class="btn btn-outline" onclick="exitApplicationForm(false)">Leave without saving</button>' +
    '<button type="button" class="btn btn-red" onclick="exitApplicationForm(true)">Save and leave</button></div>',
    { closeOnBackdrop: true, closeOnEscape: true }
  );
  return false;
}

function exitApplicationForm(save) {
  if (save) saveApplyDraftState();
  else {
    sessionStorage.removeItem(APPLY_DRAFT_KEY);
    sessionStorage.removeItem("pigem_selected_plan");
    sessionStorage.removeItem(APPLY_PHONE_TICKET_KEY);
    sessionStorage.removeItem(APPLY_CONTACT_OTP_KEY);
  }
  window.location.assign("index.html");
}

function showApplyCaptcha() {
  if (applyCaptchaVerified || document.getElementById("apply-captcha-box")) return;
  openPopup(
    '<h2>Security check</h2><p class="muted mt">Complete the checkbox to continue your application.</p>' +
    '<div class="captcha-inline mt"><div id="apply-captcha-box"></div>' +
    '<p id="apply-captcha-status" class="small" role="status"></p></div>',
    { showCloseX: true, closeOnBackdrop: false, closeOnEscape: true }
  );
  renderApplyCaptchaBox();
}

function requireApplyCaptcha() {
  if (applyCaptchaVerified) return true;
  showApplyCaptcha();
  return false;
}

async function renderApplyCaptchaBox() {
  var box = document.getElementById("apply-captcha-box");
  if (!box) return;
  var health = await apiCheckHealth();
  if (!box.isConnected) return;
  var siteKey = health?.recaptcha_site_key || CONFIG.RECAPTCHA_SITE_KEY;
  box.innerHTML = '<div id="g-apply-recaptcha"></div>';

  function tryRenderGoogle() {
    if (!box.isConnected) return true;
    if (typeof grecaptcha !== "undefined" && grecaptcha.render) {
      try {
        applyCaptchaWidget = grecaptcha.render("g-apply-recaptcha", {
          sitekey: siteKey,
          size: box.getBoundingClientRect().width >= 304 ? "normal" : "compact",
          callback: onApplyCaptchaVerified,
          "error-callback": function () { renderApplyCaptchaFallback(box); }
        });
        return true;
      } catch (err) {
        return false;
      }
    }
    return false;
  }

  if (!tryRenderGoogle()) {
    var attempts = 0;
    var timer = setInterval(function () {
      attempts++;
      if (tryRenderGoogle() || attempts > 15) {
        clearInterval(timer);
        if (attempts > 15 && !box.querySelector("iframe")) {
          renderApplyCaptchaFallback(box);
        }
      }
    }, 250);
  }
}

function renderApplyCaptchaFallback(box) {
  box.textContent = "The security check could not load. Refresh the page and try again.";
}

async function onApplyCaptchaVerified(token) {
  var status = document.getElementById("apply-captcha-status");
  if (!token || !status || applyCaptchaVerified) return;
  status.textContent = "Verifying…";
  var result = await apiVerifyCaptcha(token, true);
  if (!status.isConnected) return;
  if (!result?.verified) {
    status.textContent = "Verification failed. Please try the checkbox again.";
    if (typeof grecaptcha !== "undefined") grecaptcha.reset(applyCaptchaWidget);
    return;
  }
  applyCaptchaVerified = true;
  applicationScreeningTicket = result.screeningTicket || "";
  closePopup();
  if (applyResumePanel > 0) {
    var panel = applyResumePanel;
    applyResumePanel = 0;
    showPanel(panel);
  }
}

function renderPlanChoices() {
  var plans = getActivePlans();
  var box = document.getElementById("plan-choice-box");
  if (!box) return;
  if (plans.length && !plans.some(function (plan) { return String(plan.id) === selectedPlanId; })) {
    selectedPlanId = String(plans[0].id);
  }
  var html = "";
  for (var i = 0; i < plans.length; i++) {
    var p = plans[i];
    var pid = String(p.id);
    var isPicked = pid === String(selectedPlanId);
    var picked = isPicked ? "picked" : "";
    html +=
      '<div class="plan-choice-card ' + picked + '" data-plan-id="' + escapeHtml(pid) + '" role="radio" aria-checked="' + (isPicked ? "true" : "false") + '" tabindex="0" onclick="pickPlan(\'' + escapeHtml(pid) + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();pickPlan(\'' + escapeHtml(pid) + '\');}">' +
        '<b>' + escapeHtml(p.name) + '</b>' +
        '<span class="small muted">' + escapeHtml(String(p.speed)) + ' Mbps &bull; ' + formatPeso(p.price) + '/mo</span>' +
      '</div>';
  }
  box.innerHTML = html;
}

function pickPlan(planId) {
  selectedPlanId = String(planId);
  try {
    sessionStorage.setItem("pigem_selected_plan", selectedPlanId);
  } catch (e) {}
  saveApplyDraftState();
  renderPlanChoices();
  if (typeof clearFieldError === "function") clearFieldError("plan-choice-box");
}

var applyResumePanel = 0;
var applyCaptchaVerified = false;
var applicationScreeningTicket = "";
var applyCaptchaWidget;

async function openPhoneQrModal() {
  if (applicationHandoffBusy || applicationSubmissionRunning || !requireApplyCaptcha()) return;
  var button = document.getElementById("btn-phone-qr");
  var status = document.getElementById("apply-phone-status");
  var main = document.querySelector("main");
  applicationHandoffBusy = true;
  button.disabled = true;
  main.inert = true;
  status.textContent = "Creating phone link…";
  try {
    var snapshot = await applicationHandoffSnapshot();
    var link = await phoneTransfer("create", { mode: "application", credential: applicationScreeningTicket, path: location.pathname, ...snapshot });
    if (!link.watch) throw new Error("Could not start the transfer. Try again.");
    var watch = { token: link.watch, url: link.url, qr: link.qr, percent: applicationHandoffPercent(snapshot.draft.currentPanel) };
    sessionStorage.setItem(APPLICATION_HANDOFF_WATCH, JSON.stringify(watch));
    if (applicationScreeningTicket) sessionStorage.setItem(APPLY_PHONE_TICKET_KEY, applicationScreeningTicket);
    clearApplicationHandoffEditor();
    status.textContent = "";
    main.inert = false;
    startApplicationHandoffMonitor(watch);
  } catch (error) {
    status.textContent = error.message || "Could not create a phone link. Try again.";
  } finally {
    button.disabled = false;
    main.inert = false;
    applicationHandoffBusy = false;
  }
}

async function checkContactDetailsAlreadyInSystem(checkEmailOnly) {
  if (typeof dbCheckExistingContactInSystem !== "function") return { ok: true };
  var emailEl = document.getElementById("email");
  var phoneEl = document.getElementById("phone");
  var email = emailEl ? emailEl.value.trim().toLowerCase() : "";
  var phone = (!checkEmailOnly && phoneEl) ? phoneEl.value.trim().replace(/\D/g, "") : "";

  var dup = await dbCheckExistingContactInSystem(email, phone);
  var hasConflict = false;

  if (email && dup.emailTaken) {
    var emailMsg = "This Gmail address (" + email + ") is already in the system" +
      (dup.existingEmailRef ? " (Ref: " + dup.existingEmailRef + ")" : "") +
      ". Please enter a different @gmail.com address.";
    if (typeof setFieldError === "function") setFieldError("email", emailMsg);
    flashErrorBubble("email", "Gmail Already in System", emailMsg);
    hasConflict = true;
  }
  if (!checkEmailOnly && phone && dup.phoneTaken) {
    var phoneMsg = "This mobile number (" + phone + ") is already in the system" +
      (dup.existingPhoneRef ? " (Ref: " + dup.existingPhoneRef + ")" : "") +
      ". Please enter a different 11-digit mobile number.";
    if (typeof setFieldError === "function") setFieldError("phone", phoneMsg);
    flashErrorBubble("phone", "Mobile Number Already in System", phoneMsg);
    hasConflict = true;
  }

  return { ok: !hasConflict, dup: dup };
}

function normalizeApplyGmail() {
  var input = document.getElementById("email");
  var value = input.value.trim().toLowerCase();
  if (/^[a-z0-9][a-z0-9._+-]*$/.test(value)) value += "@gmail.com";
  input.value = value;
  return value;
}

function pendingContactOtp(email) {
  try {
    var pending = JSON.parse(sessionStorage.getItem(APPLY_CONTACT_OTP_KEY));
    return pending?.email === email && Number.isFinite(pending.expiresAt) ? pending : null;
  } catch (error) {
    return null;
  }
}

function updateContactOtpButton(email) {
  var button = document.getElementById("btn-send-otp");
  button.disabled = isContactOtpVerified || sendingContactOtp;
  button.textContent = isContactOtpVerified ? "Email verified" :
    (sendingContactOtp ? "Sending code…" : (pendingContactOtp(email) ? "Enter code" : "Send code"));
}

function openContactOtpPopup(pending) {
  openPopup(
    '<h2>Verify your email</h2><p class="muted mt">Enter the 6-digit code sent to ' + escapeHtml(pending.email) + '.</p>' +
    '<div class="mt"><label for="contact-otp-code">Email verification code</label>' +
    '<input id="contact-otp-code" class="apply-otp-input" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000" aria-describedby="contact-otp-timer"></div>' +
    '<p id="contact-otp-timer" class="small muted mt" role="timer"></p>' +
    '<p id="contact-otp-status" class="small mt" role="status"></p>' +
    '<div class="row between mt"><button type="button" id="contact-otp-resend" class="btn btn-outline" onclick="sendContactOtp(true)">Resend code</button>' +
    '<button type="button" id="contact-otp-verify" class="btn btn-red" onclick="verifyContactOtp()">Verify email</button></div>',
    { showCloseX: true, closeOnBackdrop: true, closeOnEscape: true }
  );
  var input = document.getElementById("contact-otp-code");
  var timer = document.getElementById("contact-otp-timer");
  var resend = document.getElementById("contact-otp-resend");
  var verify = document.getElementById("contact-otp-verify");
  var interval = setInterval(tick, 250);
  function tick() {
    if (!timer.isConnected) {
      clearInterval(interval);
      return;
    }
    var seconds = Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000));
    if (seconds) {
      var text = "Resend available in " + Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
      if (timer.textContent !== text) timer.textContent = text;
      resend.disabled = true;
      return;
    }
    timer.textContent = "";
    document.getElementById("contact-otp-status").textContent = "This code expired. Request a new one.";
    input.disabled = true;
    verify.disabled = true;
    resend.disabled = false;
    clearInterval(interval);
  }
  input.addEventListener("input", function () {
    input.value = input.value.replace(/[^0-9]/g, "").slice(0, 6);
    clearFieldError(input);
  });
  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      verifyContactOtp();
    }
  });
  tick();
  (input.disabled ? resend : input).focus();
}

async function sendContactOtp(resend) {
  if (sendingContactOtp || isContactOtpVerified) return;
  clearFieldError("email");
  var email = normalizeApplyGmail();
  if (!isCustomerGmail(email)) {
    flashErrorBubble("email", "Gmail Address", "Please enter a valid @gmail.com address first.");
    document.getElementById("email").focus();
    return;
  }
  var pending = pendingContactOtp(email);
  if (pending && (!resend || Date.now() < pending.expiresAt)) {
    openContactOtpPopup(pending);
    return;
  }

  sendingContactOtp = true;
  updateContactOtpButton(email);
  var resendButton = document.getElementById("contact-otp-resend");
  if (resendButton) resendButton.disabled = true;
  try {
    var existingCheck = await checkContactDetailsAlreadyInSystem(true);
    if (!existingCheck.ok) return;
    var otp = generateSecuredOtp("apply_email_" + email);
    var first = document.getElementById("first_name").value.trim();
    var last = document.getElementById("last_name").value.trim();
    var result = await apiSendOtpEmail(email, otp.code, "verify your email address for your internet service application",
      [first, last].filter(Boolean).join(" ") || "Applicant", otp.refTag);
    if (!result?.sent) throw new Error("Couldn’t send the code. Try again.");
    pending = { email: email, expiresAt: otp.expiresAt };
    sessionStorage.setItem(APPLY_CONTACT_OTP_KEY, JSON.stringify(pending));
    if (currentPanel === 2 && document.getElementById("email").value.trim().toLowerCase() === email) openContactOtpPopup(pending);
  } catch (error) {
    var status = document.getElementById("contact-otp-status");
    if (status) status.textContent = "Couldn’t send the code. Try again.";
    else if (document.getElementById("email").value.trim().toLowerCase() === email) setFieldError("email", "Couldn’t send the code. Try again.");
  } finally {
    sendingContactOtp = false;
    if (resendButton?.isConnected) resendButton.disabled = false;
    updateContactOtpButton(document.getElementById("email").value.trim().toLowerCase());
  }
}

function verifyContactOtp() {
  var input = document.getElementById("contact-otp-code");
  if (!input || input.disabled || sendingContactOtp) return;
  clearFieldError(input);
  var email = normalizeApplyGmail();
  var pending = pendingContactOtp(email);
  if (!pending || Date.now() >= pending.expiresAt) {
    setFieldError(input, "This code expired. Request a new one.");
    return;
  }
  if (!/^\d{6}$/.test(input.value)) {
    setFieldError(input, "Enter all 6 digits.");
    return;
  }
  var check = verifySecuredOtp("apply_email_" + email, input.value);
  if (!check.valid) {
    setFieldError(input, check.reason);
    return;
  }

  sessionStorage.removeItem(APPLY_CONTACT_OTP_KEY);
  isContactOtpVerified = true;
  verifiedEmailAddress = email;
  closePopup();
  saveApplyDraftState();

  var btn = document.getElementById("btn-send-otp");
  if (btn) {
    btn.textContent = "Email verified";
    btn.disabled = true;
  }
  document.querySelector("#panel-2 button[onclick='nextPanel()']")?.focus();
  var st = document.getElementById("email-otp-inline-status");
  if (st) {
    st.style.display = "block";
    st.innerHTML = '<span class="badge status-approved">Verified</span> <span style="color:var(--good);font-weight:600;">Email verified (Ref no: ' + escapeHtml(check.refTag || "VSCF") + ').</span>';
  }
  if (typeof clearFieldError === "function") clearFieldError("email");
}

function updateIdFormatHint() {
  var type = document.getElementById("id_type").value;
  var hintEl = document.getElementById("id-format-hint");
  if (!hintEl) return;
  if (!type) {
    hintEl.textContent = "";
    return;
  }
  var meta = typeof getIdType === "function" ? getIdType(type) : null;
  hintEl.textContent = (meta && meta.hint) ? meta.hint : "Type the ID number exactly as printed.";
}

function handleIdFileSelect(side, inputEl) {
  var file = inputEl && inputEl.files && inputEl.files[0];
  if (!file) return;

  if (String(file.type || "").indexOf("image/") !== 0 || !file.size) {
    inputEl.value = "";
    setFieldError("id-" + side + "-box", "Choose a clear ID photo in JPG or PNG format.");
    return;
  }

  clearFieldError("id-" + side + "-box");
  var warnEl = document.getElementById("id-screen-warn");
  if (warnEl) {
    warnEl.hidden = true;
    warnEl.innerHTML = "";
  }

  if (side === "front") {
    selectedFrontFile = file;
    var fnFront = document.getElementById("id-front-filename");
    if (fnFront) fnFront.innerHTML = "<b style='color:var(--good)'>Selected:</b> " + escapeHtml(file.name);
    var boxF = document.getElementById("id-front-preview-box");
    var imgF = document.getElementById("id-front-preview");
    if (boxF && imgF) {
      imgF.src = URL.createObjectURL(file);
      boxF.hidden = false;
    }
  } else {
    selectedBackFile = file;
    var fnBack = document.getElementById("id-back-filename");
    if (fnBack) fnBack.innerHTML = "<b style='color:var(--good)'>Selected:</b> " + escapeHtml(file.name);
    var boxB = document.getElementById("id-back-preview-box");
    var imgB = document.getElementById("id-back-preview");
    if (boxB && imgB) {
      imgB.src = URL.createObjectURL(file);
      boxB.hidden = false;
    }
  }
  checkSelectedIdQuality(side, file);
  validateSelectedIdQuality(false);
}

var selectedIdChecks = { front: null, back: null };

function checkSelectedIdQuality(side, file) {
  var previous = selectedIdChecks[side];
  if (previous && previous.file === file) return previous.promise;
  var check = { file: file };
  selectedIdChecks[side] = check;
  var box = document.getElementById("id-" + side + "-quality");
  if (box) {
    box.hidden = false;
    box.className = "notice mt";
    box.textContent = "Checking " + side + " photo...";
  }
  check.promise = analyzeClientIdQuality(file).then(function (result) {
    if (selectedIdChecks[side] !== check) return result;
    if (box) {
      box.className = "notice mt " + (result.passed ? "ok" : "warn");
      box.textContent = result.passed
        ? "Photo quality check passed. Make sure all printed details and corners are visible."
        : "Early quality warning (" + side + " photo): " + result.issues.join(" ") + " You may re-upload a clearer photo or continue.";
    }
    return result;
  });
  return check.promise;
}

function isSevereIdPhoto(result) {
  var metrics = result.metrics;
  return !result.passed && metrics && (metrics.brightness < 30 || metrics.blur_score < 12 || (metrics.center_blur_score < 8 && metrics.blur_score < 180) ||
    (metrics.brightness > 225 && metrics.glare_ratio > 0.55));
}

async function validateSelectedIdQuality(submitting) {
  var front = selectedFrontFile;
  var back = selectedBackFile;
  var checks = await Promise.all([
    front ? checkSelectedIdQuality("front", front) : { passed: true }, back ? checkSelectedIdQuality("back", back) : { passed: true }
  ]);
  var samePhoto = await sameIdPhotoFiles(front, back);
  if (front !== selectedFrontFile || back !== selectedBackFile) return { severe: [], warning: false };
  var severe = checks.map(function (result, index) {
    return isSevereIdPhoto(result) ? (index === 0 ? "front" : "back") : "";
  }).filter(Boolean);
  var warning = document.getElementById("id-screen-warn");
  var message = samePhoto ? "Warning: Both ID photos appear identical. Please choose separate front and back photos, or continue and watch My Account for a correction request." : severe.length
    ? "Early quality warning: The " + severe.join(" and ") + " ID photo appears blurry or unclear. You can re-upload a clearer photo now, or continue submitting for automated screening."
    : "Early quality warning: Check the marked photo above. You can replace it or continue.";
  if (warning) {
    warning.hidden = !samePhoto && checks.every(function (result) { return result.passed; });
    warning.textContent = message;
  }
  if (!submitting) return true;
  return { severe: severe, warning: samePhoto || checks.some(function (result) { return !result.passed; }) };
}

function showPanel(index) {
  if (sessionStorage.getItem(APPLICATION_HANDOFF_WATCH)) return;
  if (typeof checkPublicMaintenance === "function") checkPublicMaintenance();
  var mNow = (typeof getMaintenanceBlockInfo === "function") ? getMaintenanceBlockInfo() : null;
  if (mNow && mNow.blocked && !(typeof isManagerOrAdminPreview === "function" && isManagerOrAdminPreview())) {
    if (typeof renderMaintenanceScreenHtml === "function") {
      renderMaintenanceScreenHtml(mNow.title || "Website Under Maintenance", mNow.message);
    }
    return;
  }
  currentPanel = index;
  saveApplyDraftState();
  sendPhoneApplicationProgress(index);
  for (var i = 0; i < TOTAL_PANELS; i++) {
    var el = document.getElementById("panel-" + i);
    if (el) el.hidden = (i !== index);
  }
  var loadingPanel = document.getElementById("panel-loading");
  if (loadingPanel) loadingPanel.hidden = true;

  var pct = Math.round(((index + 1) / TOTAL_PANELS) * 100);
  document.getElementById("section-title").textContent = SECTION_TITLES[index];
  document.getElementById("section-pct").textContent = pct + "%";
  var bar = document.getElementById("section-bar");
  bar.style.width = pct + "%";
  bar.parentElement.setAttribute("aria-valuenow", String(pct));

  if (index === 3) {
    setTimeout(initMapPin, 180);
  }
  var heading = document.querySelector("#panel-" + index + " h3");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  window.scrollTo(0, 0);
}

function validateCurrentPanel() {
  var panelEl = document.getElementById("panel-" + currentPanel);
  if (typeof clearAllFieldErrors === "function" && panelEl) clearAllFieldErrors(panelEl);
  var firstInvalidEl = null;

  function markInvalid(fieldId, name, msg, elToFocus) {
    flashErrorBubble(fieldId, name, msg);
    if (!firstInvalidEl) {
      firstInvalidEl = elToFocus || document.getElementById(fieldId);
    }
  }

  if (currentPanel === 0) {
    if (!selectedPlanId || !getPlanById(selectedPlanId)) {
      markInvalid("plan-choice-box", "Plan Selection", "Please pick an internet plan.");

      return false;
    }
    return true;
  }

  if (currentPanel === 1) {
    var first = document.getElementById("first_name").value.trim();
    var middle = document.getElementById("middle_name").value.trim();
    var last = document.getElementById("last_name").value.trim();
    var birth = document.getElementById("birth_date").value;

    var fCheck = validatePersonName(first, "First Name", false, false);
    var mCheck = validatePersonName(middle, "Middle Name", true, true);
    var lCheck = validatePersonName(last, "Last Name", false, false);
    var dobCheck = validateAdultBirthDate(birth, 18);

    if (!fCheck.valid) markInvalid("first_name", "First Name", fCheck.message);
    if (!mCheck.valid) markInvalid("middle_name", "Middle Name", mCheck.message);
    if (!lCheck.valid) markInvalid("last_name", "Last Name", lCheck.message);
    if (!dobCheck.valid) markInvalid("birth_date", "Birth Date", dobCheck.message);

    if (firstInvalidEl) {
      firstInvalidEl.scrollIntoView({ behavior: "smooth", block: "center" });
      firstInvalidEl.focus();
      return false;
    }
    return true;
  }

  if (currentPanel === 2) {
    var email = normalizeApplyGmail();
    var phone = document.getElementById("phone").value.trim().replace(/\D/g, "");
    var phoneAltRaw = document.getElementById("phone_alt").value.trim();
    var phoneAltDigits = phoneAltRaw.replace(/\D/g, "");

    if (!email || !isCustomerGmail(email)) markInvalid("email", "Gmail Address", "Enter a valid @gmail.com address.");
    else if (!isContactOtpVerified || verifiedEmailAddress !== email) {
      markInvalid("contact_otp", "Email OTP", "Verify your Gmail address using the code sent to your inbox.", document.getElementById("btn-send-otp"));
    }
    if (!FORM_VALIDATOR.isValidMobile(phone)) markInvalid("phone", "Mobile Number", "Enter a valid 11-digit mobile number starting with 09.");

    if (phoneAltRaw && (phoneAltDigits.length !== 11 || !FORM_VALIDATOR.isValidMobile(phoneAltDigits))) {
      var altMsg = "Secondary mobile number must be an 11-digit number starting with 09 (or leave blank).";
      markInvalid("phone_alt", "Secondary Mobile Number", altMsg, document.getElementById("phone_alt"));
    }

    if (firstInvalidEl) {
      firstInvalidEl.scrollIntoView({ behavior: "smooth", block: "center" });
      firstInvalidEl.focus();
      return false;
    }
    return true;
  }

  if (currentPanel === 3) {
    var house = document.getElementById("house_no").value.trim();
    var bldg = document.getElementById("building_name").value.trim();
    var street = document.getElementById("street").value.trim();
    var subd = document.getElementById("subdivision").value.trim();
    var brgy = document.getElementById("barangay").value.trim();
    var city = document.getElementById("city").value.trim();
    var prov = document.getElementById("province").value.trim();
    var landmark = document.getElementById("landmark").value.trim();

    var latNum = parseFloat(document.getElementById("lat").value);
    var lngNum = parseFloat(document.getElementById("lng").value);
    var phBoundsOk = !isNaN(latNum) && !isNaN(lngNum) && isWithinPhilippinesBounds(latNum, lngNum);
    var phResolvedOk = !_pinLocationState.resolved || _pinLocationState.inPhilippines;
    if (!phBoundsOk || !phResolvedOk) {
      refreshCoverageBanner();
      var mapBox = document.getElementById("map");
      var message = isNaN(latNum) || isNaN(lngNum)
        ? "Pin your installation address on the map."
        : "Choose an installation address in the Philippines.";
      setFieldError("map", message);
      mapBox?.focus();
      return false;
    }

    if (_addressNeedsPin) {
      setFieldError("map", "The address changed. Update the map pin or place it manually before continuing.");
      document.getElementById("map").focus();
      return false;
    }

    if (!house) markInvalid("house_no", "House No.", "Enter house, block, or lot number.");
    if (!bldg) markInvalid("building_name", "Building Name", "Enter building name or N/A.");
    if (!street) markInvalid("street", "Street Name", "Enter your street name.");
    if (!subd) markInvalid("subdivision", "Subdivision", "Enter subdivision or N/A.");
    if (!brgy) markInvalid("barangay", "Barangay", "Enter barangay name.");
    if (!city) markInvalid("city", "City", "Enter city or municipality.");
    if (!prov) markInvalid("province", "Province", "Enter province or district.");
    if (!landmark) markInvalid("landmark", "Landmark", "Enter a nearby landmark.");

    if (firstInvalidEl) {
      firstInvalidEl.scrollIntoView({ behavior: "smooth", block: "center" });
      firstInvalidEl.focus();
      return false;
    }

    var pinMatch = doesPinMatchAddressFields(_pinLocationState, city, prov);
    if (!pinMatch.matches) {
      refreshCoverageBanner();
      markInvalid("city", "City / Municipality", pinMatch.reason);
      markInvalid("province", "Province / District", pinMatch.reason);
      var cityEl = document.getElementById("city");
      if (cityEl) {
        cityEl.scrollIntoView({ behavior: "smooth", block: "center" });
        cityEl.focus();
      }

      return false;
    }
    return true;
  }

  if (currentPanel === 4) {
    var idType = document.getElementById("id_type").value;
    var idNumber = document.getElementById("id_number").value.trim();

    if (!idType) markInvalid("id_type", "Valid ID Type", "Select your government ID type.");
    if (!idNumber || idNumber.length < 4) markInvalid("id_number", "ID Number", "Enter the valid number on your ID card.");
    if (!selectedFrontFile) markInvalid("id_front", "Front of Valid ID", "Upload photo of the FRONT of your ID.");

    if (firstInvalidEl) {
      firstInvalidEl.scrollIntoView({ behavior: "smooth", block: "center" });
      firstInvalidEl.focus();
      return false;
    }
    return true;
  }

  if (currentPanel === 5) {
    if (!document.getElementById("agree_sub").checked) {
      markInvalid("agree_sub", "Terms Agreement", "Please check to accept the Subscriber Certificate.");
    }
    if (firstInvalidEl) {
      firstInvalidEl.scrollIntoView({ behavior: "smooth", block: "center" });

      return false;
    }
    return true;
  }

  return true;
}

var _pinLocationState = {
  lat: null,
  lng: null,
  resolved: false,
  inPhilippines: true,
  boundsOk: true,
  country: "Philippines",
  countryCode: "ph",
  barangay: "",
  city: "",
  province: "",
  displayName: "",
  isServiceableArea: true,
  reverseData: null
};
var _pinSeq = 0;
var _pinLookupPromise = null;
var _addressNeedsPin = false;
var MAP_ADDRESS_FIELDS = ["street", "subdivision", "barangay", "city", "province"];
var _mapInputsBound = false;

function renderCoverageBannerBox(banner, bg, border, color, title, body) {
  banner.hidden = false;
  banner.className = "notice mt";
  banner.style.background = bg;
  banner.style.borderColor = border;
  banner.style.color = color;
  while (banner.firstChild) banner.removeChild(banner.firstChild);
  var strong = document.createElement("strong");
  strong.textContent = title;
  var div = document.createElement("div");
  div.className = "small";
  div.style.marginTop = "4px";
  div.textContent = body;
  banner.appendChild(strong);
  banner.appendChild(div);
}

function refreshCoverageBanner() {
  var banner = document.getElementById("map-coverage-banner");
  if (!banner) return;
  var latVal = parseFloat((document.getElementById("lat") || {}).value);
  var lngVal = parseFloat((document.getElementById("lng") || {}).value);
  if (!Number.isFinite(latVal) || !Number.isFinite(lngVal)) {
    banner.hidden = true;
    return;
  }
  var boundsOk = isWithinPhilippinesBounds(latVal, lngVal);
  if (!boundsOk || (_pinLocationState.resolved && !_pinLocationState.inPhilippines)) {
    var foreignLabel = _pinLocationState.displayName || _pinLocationState.country || "Outside Philippines";
    renderCoverageBannerBox(
      banner,
      "#fef2f2",
      "#fca5a5",
      "#991b1b",
      "Philippines Only — Installation Blocked Here",
      "Pinned location (" + foreignLabel + ") is outside the Philippines. Move the pin to an address inside the Philippines to continue."
    );
    return;
  }
  var typedBrgy = ((document.getElementById("barangay") || {}).value || "").trim();
  var typedCity = ((document.getElementById("city") || {}).value || "").trim();
  var typedProv = ((document.getElementById("province") || {}).value || "").trim();
  var pinMatch = doesPinMatchAddressFields(_pinLocationState, typedCity, typedProv);
  if (!pinMatch.matches) {
    renderCoverageBannerBox(
      banner,
      "#fef2f2",
      "#fca5a5",
      "#991b1b",
      "Pinned Map Area Does Not Match Address Fields",
      pinMatch.reason
    );
    return;
  }
  var areaText = [
    typedBrgy,
    typedCity,
    typedProv,
    _pinLocationState.barangay,
    _pinLocationState.city,
    _pinLocationState.province,
    _pinLocationState.displayName
  ].filter(Boolean).join(", ");
  if (!areaText) {
    banner.hidden = true;
    return;
  }
  if (isServiceArea(areaText)) {
    renderCoverageBannerBox(
      banner,
      "#f0fdf4",
      "#86efac",
      "#166534",
      "Serviceable Area Confirmed",
      "This address is within PIGEM primary coverage (Metro Manila / NCR, Bulacan, Cavite, Laguna, Rizal, Cebu)."
    );
    return;
  }
  renderCoverageBannerBox(
    banner,
    "#fefce8",
    "#fde047",
    "#854d0e",
    "Outside Standard Coverage Area — Application Can Still Continue",
    "This Philippine address is outside PIGEM primary serviceable areas (Metro Manila / NCR, Bulacan, Cavite, Laguna, Rizal, Cebu). You can still continue and submit; our screening report will mark this clearly for Agent verification."
  );
}

function bindMapFieldListeners() {
  if (_mapInputsBound) return;
  _mapInputsBound = true;
  MAP_ADDRESS_FIELDS.forEach(function (id) {
    var field = document.getElementById(id);
    var originalValue = "";
    field.addEventListener("focus", function () { originalValue = field.value; });
    field.addEventListener("input", function () {
      _addressNeedsPin = true;
      _pinSeq++;
      _pinLookupPromise = null;
      document.getElementById("map-status").textContent = "Address changed. The pin updates after you finish editing, or you can move it yourself.";
      refreshCoverageBanner();
    });
    field.addEventListener("change", function () {
      var locality = MAP_ADDRESS_FIELDS.indexOf(id);
      if (locality >= 2 && originalValue.trim() && normalizeGeoText(originalValue) !== normalizeGeoText(field.value)) {
        clearPreviousAddress(MAP_ADDRESS_FIELDS.slice(0, locality));
      }
      if (["city", "province", "barangay"].every(function (key) {
        return document.getElementById(key).value.trim();
      })) updatePinFromAddress();
      saveApplyDraftState();
    });
  });
  var searchEl = document.getElementById("map-search");
  if (searchEl) {
    searchEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (typeof searchMapAddress === "function") searchMapAddress();
      }
    });
  }
}

async function enforceLiveMaintenanceOnStep() {
  try {
    var liveContent = (typeof getWebsiteContent === "function") ? getWebsiteContent() : window._latestWebsiteContent;
    if (liveContent) window._latestWebsiteContent = liveContent;
    var mInfo = (typeof getMaintenanceBlockInfo === "function")
      ? getMaintenanceBlockInfo(liveContent)
      : { blocked: typeof isMaintenanceOn === "function" && isMaintenanceOn() };
    if (mInfo && mInfo.blocked && !(typeof isManagerOrAdminPreview === "function" && isManagerOrAdminPreview())) {
      if (typeof renderMaintenanceScreenHtml === "function") {
        renderMaintenanceScreenHtml(mInfo.title || "Website Under Maintenance", mInfo.message);
      } else if (typeof checkPublicMaintenance === "function") {
        checkPublicMaintenance();
      }
      return true;
    }
  } catch (e) {}
  return false;
}

async function nextPanel() {
  if (!requireApplyCaptcha()) return;
  if (await enforceLiveMaintenanceOnStep()) return;
  if (currentPanel === 2) {
    if (!validateCurrentPanel()) return;
    var contactCheck = await checkContactDetailsAlreadyInSystem(false);
    if (!contactCheck.ok) return;
    showPanel(3);
    return;
  }
  if (currentPanel === 3 && _pinLookupPromise) {
    var lookup = _pinLookupPromise;
    await lookup;
    if (currentPanel !== 3 || (_pinLookupPromise && _pinLookupPromise !== lookup)) return;
  }
  if (!validateCurrentPanel()) return;
  if (currentPanel === 4 && !(await validateSelectedIdQuality())) return;

  if (currentPanel < TOTAL_PANELS - 1) {
    showPanel(currentPanel + 1);
  }
}

async function prevPanel() {
  if (await enforceLiveMaintenanceOnStep()) return;
  if (currentPanel > 0) {
    showPanel(currentPanel - 1);
  }
}

function resetInstallationPin() {
  _pinSeq++;
  _pinLookupPromise = null;
  _addressNeedsPin = false;
  _pinLocationState = {};
  document.getElementById("lat").value = "";
  document.getElementById("lng").value = "";
  if (leafletMarker) leafletMarker.remove();
  leafletMarker = null;
  if (leafletMap) leafletMap.setView(CONFIG.MAP_CENTER, 15);
  document.getElementById("map-status").textContent = "Search for your address or place the pin on the map.";
  document.getElementById("map-search").value = "";
  document.getElementById("map-coverage-banner").hidden = true;
}

function useMapCenter() {
  if (!leafletMap) return;
  var center = leafletMap.getCenter();
  chooseInstallationPin(center.lat, center.lng);
}

function showInstallationMarker(lat, lng, zoom) {
  if (zoom) leafletMap.setView([lat, lng], zoom);
  if (leafletMarker) {
    leafletMarker.setLatLng([lat, lng]);
    return;
  }
  leafletMarker = L.marker([lat, lng], { draggable: true }).addTo(leafletMap);
  leafletMarker.on("click", function () {
    if (_addressNeedsPin) confirmCurrentMapPin();
  });
  leafletMarker.on("dragend", function () {
    var position = leafletMarker.getLatLng();
    chooseInstallationPin(position.lat, position.lng);
  });
}

function initMapPin() {
  bindMapFieldListeners();
  if (!leafletMap) {
    var lat = Number(_pinLocationState.lat);
    var lng = Number(_pinLocationState.lng);
    var hasPin = Boolean(_pinLocationState.lat && _pinLocationState.lng);
    leafletMap = L.map("map", { tap: false }).setView(hasPin ? [lat, lng] : CONFIG.MAP_CENTER, 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(leafletMap);
    if (hasPin) showInstallationMarker(lat, lng);
    leafletMap.on("click", function (event) {
      chooseInstallationPin(event.latlng.lat, event.latlng.lng);
    });
  }
  if (!leafletMarker && _pinLocationState.lat && _pinLocationState.lng) {
    showInstallationMarker(Number(_pinLocationState.lat), Number(_pinLocationState.lng), 15);
  }
  leafletMap.invalidateSize();
  if (!_pinLookupPromise) refreshCoverageBanner();
}

async function mapGeocoding(path, params) {
  var endpoints = [];
  if (CONFIG.LOCATIONIQ_API_KEY) {
    var query = new URLSearchParams(params);
    query.set("key", CONFIG.LOCATIONIQ_API_KEY);
    endpoints.push("https://us1.locationiq.com/v1/" + path + "?" + query);
  }
  endpoints.push("https://nominatim.openstreetmap.org/" + path + "?" + new URLSearchParams(params));
  for (var url of endpoints) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 4500);
    try {
      var response = await fetch(url, { signal: controller.signal, headers: { "Accept-Language": "en" } });
      if (!response.ok) continue;
      var data = await response.json();
      if (path === "search" ? Array.isArray(data) && data.length : data?.address) return data;
    } catch (error) {
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function applyInstallationPin(lat, lng, data, useTypedAddress, zoom) {
  var location = evaluateMapLocation(lat, lng, data);
  _pinLocationState = Object.assign({ lat: lat, lng: lng, resolved: true }, location);
  _addressNeedsPin = false;
  document.getElementById("lat").value = lat.toFixed(6);
  document.getElementById("lng").value = lng.toFixed(6);
  showInstallationMarker(lat, lng, zoom);
  clearFieldError("map");

  if (!useTypedAddress && data?.address && location.inPhilippines) {
    var address = data.address;
    document.getElementById("street").value = address.road || address.pedestrian || address.footway || address.street || "";
    document.getElementById("subdivision").value = address.neighbourhood || address.residential || address.hamlet || address.subdivision || "N/A";
    document.getElementById("barangay").value = location.barangay;
    document.getElementById("city").value = location.city;
    document.getElementById("province").value = location.province;
  }
  document.getElementById("map-status").textContent = !location.inPhilippines
    ? "Choose an installation location in the Philippines."
    : (useTypedAddress ? "Map pin updated. Check that it marks your exact installation address."
      : (location.displayName ? "Pinned location: " + location.displayName : "Location pinned. Fill in the address details below."));
  refreshCoverageBanner();
  saveApplyDraftState();
}

function clearPreviousAddress(fields) {
  (fields || MAP_ADDRESS_FIELDS).concat(["house_no", "house_suffix", "unit_no", "floor_no", "landmark", "remarks"]).forEach(function (id) {
    document.getElementById(id).value = "";
    clearFieldError(id);
  });
  document.getElementById("building_name").value = "N/A";
  document.getElementById("unit_type").selectedIndex = 0;
}

function confirmCurrentMapPin() {
  var status = document.getElementById("map-status");
  if (!leafletMarker) {
    status.textContent = "Choose a pin on the map first.";
    return;
  }
  var city = document.getElementById("city").value;
  var province = document.getElementById("province").value;
  var match = doesPinMatchAddressFields(_pinLocationState, city, province);
  if (!match.matches) {
    status.textContent = match.reason;
    return;
  }
  _pinSeq++;
  _pinLookupPromise = null;
  _addressNeedsPin = false;
  clearFieldError("map");
  status.textContent = "Map pin confirmed. Check that it marks the installation address.";
  refreshCoverageBanner();
  saveApplyDraftState();
}

function startMapLookup(work) {
  var sequence = ++_pinSeq;
  _pinLookupPromise = work(sequence).finally(function () {
    if (sequence === _pinSeq) _pinLookupPromise = null;
  });
  return _pinLookupPromise;
}

function chooseInstallationPin(lat, lng, zoom) {
  var status = document.getElementById("map-status");
  if (_pinLocationState.lat === lat && _pinLocationState.lng === lng && !_addressNeedsPin) return;
  return startMapLookup(async function (sequence) {
    var moved = _pinLocationState.lat !== lat || _pinLocationState.lng !== lng;
    if (moved) clearPreviousAddress();
    showInstallationMarker(lat, lng, zoom);
    _pinLocationState = { lat: lat, lng: lng, resolved: false };
    document.getElementById("lat").value = lat.toFixed(6);
    document.getElementById("lng").value = lng.toFixed(6);
    _addressNeedsPin = false;
    document.getElementById("map-coverage-banner").hidden = true;
    status.textContent = "Looking up the pinned address…";
    var data = await mapGeocoding("reverse", { format: "json", lat: lat, lon: lng });
    if (sequence === _pinSeq) applyInstallationPin(lat, lng, data, !moved);
  });
}

function lookupInstallationAddress(query, useTypedAddress) {
  if (!query) return;
  initMapPin();
  var status = document.getElementById("map-status");
  status.textContent = "Looking for the address on the map…";
  return startMapLookup(async function (sequence) {
    var matches = await mapGeocoding("search", {
      format: "json", limit: "1", countrycodes: "ph", addressdetails: "1", q: query
    });
    if (sequence !== _pinSeq) return;
    var match = matches?.[0];
    if (!match || !Number.isFinite(Number(match.lat)) || !Number.isFinite(Number(match.lon))) {
      status.textContent = "Address not found. Search for the area or place the pin yourself. If the existing pin is correct, tap it.";
      return;
    }
    var lat = Number(match.lat);
    var lng = Number(match.lon);
    if (useTypedAddress) {
      var location = evaluateMapLocation(lat, lng, match);
      var city = document.getElementById("city").value;
      var province = document.getElementById("province").value;
      if (!location.inPhilippines || !doesPinMatchAddressFields(Object.assign({ resolved: true }, location), city, province).matches) {
        status.textContent = "The map result differs from the address you entered. Place the pin manually.";
        return;
      }
    } else if (_pinLocationState.lat !== lat || _pinLocationState.lng !== lng) {
      clearPreviousAddress();
    }
    applyInstallationPin(lat, lng, match, useTypedAddress, 16);
  });
}

function searchMapAddress() {
  return lookupInstallationAddress(document.getElementById("map-search").value.trim(), false);
}

function updatePinFromAddress() {
  var parts = MAP_ADDRESS_FIELDS.map(function (id) { return document.getElementById(id).value.trim(); });
  return lookupInstallationAddress(parts.filter(function (value) { return value && value.toUpperCase() !== "N/A"; }).join(", "), true);
}

function useCurrentLocation() {
  initMapPin();
  var status = document.getElementById("map-status");
  if (!navigator.geolocation) {
    status.textContent = "Location detection is unavailable. Search the map or choose a pin.";
    return;
  }
  var button = document.getElementById("btn-use-loc");
  button.disabled = true;
  status.textContent = "Detecting your location…";
  var sequence = ++_pinSeq;
  _pinLookupPromise = null;
  navigator.geolocation.getCurrentPosition(function (position) {
    button.disabled = false;
    if (sequence === _pinSeq) chooseInstallationPin(position.coords.latitude, position.coords.longitude, 17);
  }, function () {
    button.disabled = false;
    if (sequence === _pinSeq) status.textContent = "Could not detect your location. Search the map or choose a pin.";
  }, { timeout: 10000, enableHighAccuracy: true });
}

function advanceLoadingStep(stepNum) {
  for (var i = 1; i <= 3; i++) {
    var el = document.getElementById("step-ld-" + i);
    if (!el) continue;
    if (i < stepNum) {
      el.className = "reg-step-item done";
      el.querySelector(".reg-step-icon").innerHTML = "&#10003;";
    } else if (i === stepNum) {
      el.className = "reg-step-item active";
      el.querySelector(".reg-step-icon").textContent = String(i);
    } else {
      el.className = "reg-step-item";
      el.querySelector(".reg-step-icon").textContent = String(i);
    }
  }
}

function resetApplyWizardToStep1() {
  applyCaptchaVerified = false;
  applyResumePanel = 0;
  applicationScreeningTicket = "";
  applyCaptchaWidget = undefined;
  try {
    sessionStorage.removeItem(APPLY_DRAFT_KEY);
    sessionStorage.removeItem(APPLY_PHONE_TICKET_KEY);
    sessionStorage.removeItem(APPLY_CONTACT_OTP_KEY);
  } catch (e) {}
  resetInstallationPin();
  selectedIdChecks = { front: null, back: null };
  var loadingScreen = document.getElementById("panel-loading");
  if (loadingScreen) loadingScreen.hidden = true;
  var fieldIds = [
    "first_name", "middle_name", "last_name", "birth_date", "email", "phone", "phone_alt",
    "house_no", "house_suffix", "unit_no", "floor_no", "street", "subdivision",
    "barangay", "city", "province", "landmark", "remarks", "id_number"
  ];
  for (var i = 0; i < fieldIds.length; i++) {
    var el = document.getElementById(fieldIds[i]);
    if (el) el.value = "";
  }
  var bldgEl = document.getElementById("building_name");
  if (bldgEl) bldgEl.value = "N/A";
  var agree1 = document.getElementById("agree_sub");
  var agree2 = document.getElementById("agree_tu");
  if (agree1) agree1.checked = false;
  if (agree2) agree2.checked = false;
  selectedFrontFile = null;
  selectedBackFile = null;
  isContactOtpVerified = false;
  verifiedEmailAddress = "";
  var otpBtn = document.getElementById("btn-send-otp");
  if (otpBtn) {
    otpBtn.textContent = "Send code";
    otpBtn.disabled = false;
  }
  var otpSt = document.getElementById("email-otp-inline-status");
  if (otpSt) otpSt.style.display = "none";
  var warnBox = document.getElementById("id-screen-warn");
  if (warnBox) warnBox.hidden = true;
  var fpBox = document.getElementById("id-front-preview-box");
  var bpBox = document.getElementById("id-back-preview-box");
  if (fpBox) fpBox.hidden = true;
  if (bpBox) bpBox.hidden = true;
  var fnLbl = document.getElementById("id-front-filename");
  var bnLbl = document.getElementById("id-back-filename");
  if (fnLbl) fnLbl.textContent = "No Front ID photo selected yet";
  if (bnLbl) bnLbl.textContent = "No Back ID photo selected yet";
  if (typeof clearAllFieldErrors === "function") clearAllFieldErrors();
  showPanel(0);
}

var applicationSubmissionRunning = false;

async function submitRegistration() {
  if (applicationSubmissionRunning) return;
  applicationSubmissionRunning = true;
  try {
    return await performApplicationSubmission();
  } finally {
    applicationSubmissionRunning = false;
  }
}

async function performApplicationSubmission() {
  if (!requireApplyCaptcha()) return;
  var savedApplication = null;
  if (await enforceLiveMaintenanceOnStep()) return;
  if (!validateCurrentPanel()) return;
  if (currentPanel === 4 && !(await validateSelectedIdQuality())) return;

  var first = document.getElementById("first_name").value.trim();
  var middle = document.getElementById("middle_name").value.trim();
  var last = document.getElementById("last_name").value.trim();
  var fullName = [first, (middle.toUpperCase() === "N/A" ? "" : middle), last].filter(Boolean).join(" ");
  var email = document.getElementById("email").value.trim().toLowerCase();
  var birth = document.getElementById("birth_date").value;
  var idType = document.getElementById("id_type").value;
  var idNumber = document.getElementById("id_number").value.trim();
  var p = getPlanById(selectedPlanId);

  for (var i = 0; i < TOTAL_PANELS; i++) {
    var pEl = document.getElementById("panel-" + i);
    if (pEl) pEl.hidden = true;
  }
  var loadingScreen = document.getElementById("panel-loading");
  if (loadingScreen) loadingScreen.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });

  try {

    advanceLoadingStep(1);
    var photoCheck = await validateSelectedIdQuality(true);
    if (!photoCheck) {
      if (loadingScreen) loadingScreen.hidden = true;
      return;
    }

    advanceLoadingStep(2);

    var screening = {
      preliminary: true,
      upload_photo_warning: photoCheck.warning,
      state: "queued",
      background_state: "queued",
      phase: "Waiting for document check",
      eta_seconds: 0,
      fallback_original_only: false,
      advisory: "Automated ID quality and details screening is running."
    };
    var subLat = parseFloat((document.getElementById("lat") || {}).value);
    var subLng = parseFloat((document.getElementById("lng") || {}).value);
    var subBrgy = ((document.getElementById("barangay") || {}).value || "").trim();
    var subCity = ((document.getElementById("city") || {}).value || "").trim();
    var subProv = ((document.getElementById("province") || {}).value || "").trim();
    var locCheckText = [
      subBrgy,
      subCity,
      subProv,
      _pinLocationState.barangay,
      _pinLocationState.city,
      _pinLocationState.province,
      _pinLocationState.displayName
    ].filter(Boolean).join(", ");
    var inPhLoc = (isNaN(subLat) || isNaN(subLng) ? true : isWithinPhilippinesBounds(subLat, subLng)) &&
      (!_pinLocationState.resolved || _pinLocationState.inPhilippines);
    var isSvcLoc = inPhLoc && isServiceArea(locCheckText);
    var locAdvisory = !inPhLoc
      ? "Pinned location appears outside the Philippines."
      : (isSvcLoc
        ? "Within PIGEM serviceable areas (Metro Manila, Bulacan, Cavite, Laguna, Rizal, Cebu)."
        : "Outside PIGEM primary serviceable areas (Metro Manila, Bulacan, Cavite, Laguna, Rizal, Cebu) — Flagged for Agent facility verification.");
    var pinMatchCheck = doesPinMatchAddressFields(_pinLocationState, subCity, subProv);
    screening.location_screening = {
      in_philippines: inPhLoc,
      is_serviceable_area: isSvcLoc,
      pin_matches_fields: pinMatchCheck.matches,
      pinned_area: [_pinLocationState.city || subCity, _pinLocationState.province || subProv].filter(Boolean).join(", "),
      typed_area: [subCity, subProv].filter(Boolean).join(", "),
      advisory: locAdvisory
    };
    screening.coverage_outside_area = !isSvcLoc;
    if (!isSvcLoc) {
      if (Array.isArray(screening.notes)) {
        if (screening.notes.indexOf(locAdvisory) === -1) screening.notes.unshift(locAdvisory);
      } else {
        screening.notes = [locAdvisory];
      }
      if (!screening.advisory || screening.preliminary) {
        screening.advisory = locAdvisory;
      }
    }

    var addrData = {
      house_no: document.getElementById("house_no").value.trim(),
      house_suffix: document.getElementById("house_suffix").value.trim(),
      unit_no: document.getElementById("unit_no").value.trim(),
      unit_type: document.getElementById("unit_type").value,
      floor_no: document.getElementById("floor_no").value.trim(),
      building_name: document.getElementById("building_name").value.trim(),
      street: document.getElementById("street").value.trim(),
      subdivision: document.getElementById("subdivision").value.trim(),
      barangay: document.getElementById("barangay").value.trim(),
      city: document.getElementById("city").value.trim(),
      province: document.getElementById("province").value.trim(),
      landmark: document.getElementById("landmark").value.trim()
    };

    var latNum = parseFloat(document.getElementById("lat").value);
    var lngNum = parseFloat(document.getElementById("lng").value);
    var dupCheck = typeof dbFindDuplicateCustomerApplication === "function"
      ? await dbFindDuplicateCustomerApplication(email, Object.assign({}, addrData, {
          lat: latNum,
          lng: lngNum,
          plan: selectedPlanId,
          full_name: fullName,
          phone: document.getElementById("phone").value.trim()
        }))
      : { isDuplicate: false };

    if (dupCheck && dupCheck.isDuplicate) {
      if (loadingScreen) loadingScreen.hidden = true;
      var existing = dupCheck.existingApp;
      if (existing && existing.status === "Needs Correction" &&
          String(existing.email || "").trim().toLowerCase() === email.trim().toLowerCase()) {
        openPopup('<div class="center"><h3>Your application needs a correction</h3>' +
          '<p>Application <b>' + escapeHtml(dupCheck.existingRef) + '</b> is waiting for your update.</p>' +
          '<p>Open your account and correct that application. You do not need to submit a new one.</p>' +
          '<a class="btn btn-red" href="customer.html">Open my applications</a></div>',
          { showCloseX: true, closeOnBackdrop: true });
        return;
      }
      openPopup('<div class="center"><h3>Application already on file</h3>' +
        '<p>We found an existing application that may match this submission.</p>' +
        '<p>Check your applications or contact PIGEM if you think this is a mistake.</p>' +
        '<a class="btn btn-red" href="customer.html">Open my applications</a></div>',
        { showCloseX: true, closeOnBackdrop: true });
      return;
    }

    var accountInfo = await dbCreateAccountFromApplication(fullName, email);
    var applicationRef = generateApplicationReference();
    var appFolder = applicationRef + "_original";
    var frontPath = await dbUploadDocument(selectedFrontFile, appFolder, "id-front");
    var backPath = await dbUploadDocument(selectedBackFile, appFolder, "id-back");

    advanceLoadingStep(3);
    var baseAppPayload = Object.assign({}, addrData, {
      ref_no: applicationRef,
      customer_id: accountInfo.user.id,
      agent_id: referralAgentId,
      agent_link_code: referralAgentId,
      plan: selectedPlanId,
      first_name: first,
      middle_name: middle,
      last_name: last,
      full_name: fullName,
      customer_name: fullName,
      birth_date: birth,
      phone: document.getElementById("phone").value.trim(),
      phone_alt: document.getElementById("phone_alt").value.trim(),
      email: email,
      address_line: formatAddress(addrData),
      lat: latNum,
      lng: lngNum,
      id_type: idType,
      id_number: idNumber,
      id_image_url: frontPath,
      id_back_image_url: backPath,
      id_front_path: frontPath,
      id_back_path: backPath,
      remarks: document.getElementById("remarks").value.trim(),
      agree_tu: document.getElementById("agree_tu").checked,
      screening: screening
    });


    var photoRequest = "";
    if (photoCheck.severe.length) {
      photoRequest = "Early quality warning: Your " + photoCheck.severe.join(" and ") + " ID photo may be unclear. Our automated screening engine is checking your upload now—if it cannot be verified, you will be able to upload a clearer photo in your Customer Account.";
    }
    var saved = await dbCreateApplication(baseAppPayload);
    savedApplication = saved;
    if (loadingScreen) loadingScreen.hidden = true;
    var isAlreadyActive = accountInfo.status === "active";
    openPopup(
      '<div class="center">' +
        '<h2>Application submitted</h2><p class="small muted mt">Reference number</p>' +
        '<div class="big-ref">' + escapeHtml(saved.ref_no) + '</div>' +
        '<p class="small muted mt" id="apply-email-delivery-note">' +
          (isAlreadyActive ? 'Sign in to track your application.' : 'Open the activation email in Gmail to set up your account.') +
        '</p></div>',
      { showCloseX: true, closeOnBackdrop: true, closeOnEscape: true, onClose: resetApplyWizardToStep1 }
    );

    var subject = "PIGEM Application Confirmation - Reference No. " + saved.ref_no;
    var body =
      "Dear " + fullName + ",\n\n" +
      "Thank you for submitting your internet service application with PIGEM Combined Facilities Support Services.\n\n" +
      "Reference Number: " + saved.ref_no + "\n" +
      "Plan: Red Fiber " + p.name + " (" + p.speed + " Mbps - " + formatPeso(p.price) + "/mo)\n" +
      "Status: Processing\n\n" +
      "Please check your email notification for your 6-digit Activation OTP Code and Account Activation link.";

    var confirmEmailPromise = apiSendApplicationConfirmationEmail(email, fullName, saved.ref_no, p, formatAddress(addrData), accountInfo);
    confirmEmailPromise.then(function (mailRes) {
      var noteEl = document.getElementById("apply-email-delivery-note");
      if (!noteEl) return;
      if (!isAlreadyActive && !mailRes?.sent) {
        noteEl.textContent = "We couldn’t send your activation email. Contact PIGEM support with your reference number.";
      }
    }).catch(function () {});

    var followUp = [
      dbAddNotification({ user_id: accountInfo.user.id, email: email, subject: subject, body: body, target_tab: "tab-apps", target_id: saved.id }),
      dbAddNotification({ role: "agent", subject: "New Application " + saved.ref_no, body: fullName + " submitted " + saved.ref_no, target_tab: "tab-queue", target_id: saved.id }),
      dbAddNotification({ role: "manager", subject: "New Application " + saved.ref_no, body: fullName + " submitted " + saved.ref_no + " (" + p.name + ")", target_tab: "tab-queue", target_id: saved.id }),
      confirmEmailPromise,
      dbAddActivity("application_submitted", saved.ref_no + " (" + email + ")")
    ];
    void Promise.allSettled(followUp);
    completeApplicationHandoff();
  } catch (err) {
    if (loadingScreen) loadingScreen.hidden = true;
    if (savedApplication) {
      openPopup('<h3>Application saved</h3><p>Your reference is <b>' +
        escapeHtml(savedApplication.ref_no || savedApplication.reference_no) +
        '</b>.</p><p>Check your Gmail for next steps. Contact PIGEM with your reference number if you need help.</p>',
        { showCloseX: true, onClose: resetApplyWizardToStep1 });
      return;
    }
    showPanel(5);
    var brand = '<span class="row" style="align-items:center;gap:10px"><img src="' +
      escapeHtml(getImageUrl("black-logo-white-mode.png")) +
      '" alt="" width="36" height="36" style="object-fit:contain"> <span>Application could not be submitted</span></span>';
    showAlert(brand, escapeHtml(err.message || "Please try submitting again."), "bad");
  }
}

initApplyPage();
