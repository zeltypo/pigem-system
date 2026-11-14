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
    if (qrBtn) qrBtn.style.display = "inline-flex";
  } else {
    for (var j = 0; j < camBtns.length; j++) {
      camBtns[j].style.display = "inline-flex";
    }
    if (qrBtn) qrBtn.style.display = "none";
  }
}

var _qrPollTimer = null;
var _qrActiveSid = "";
var _qrLoadedUrls = { front: "", back: "" };


var APPLY_DRAFT_KEY = "pigem_apply_wizard_draft";
var APPLY_DRAFT_FIELDS = [
  "first_name", "middle_name", "last_name", "birth_date", "email", "phone", "phone_alt",
  "house_no", "house_suffix", "unit_no", "floor_no", "building_name", "street", "subdivision",
  "barangay", "city", "province", "landmark", "remarks", "id_type", "id_number"
];

function saveApplyDraftState() {
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
      currentPanel: currentPanel,
      selectedPlanId: selectedPlanId,
      isContactOtpVerified: isContactOtpVerified,
      verifiedEmailAddress: verifiedEmailAddress,
      pinLocationState: _pinLocationState,
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
      if (el && typeof vals[fid] === "string" && vals[fid] !== "") {
        el.value = vals[fid];
      }
    }
    if (draft.isContactOtpVerified && draft.verifiedEmailAddress) {
      var curEm = (document.getElementById("email") ? document.getElementById("email").value : "").trim().toLowerCase();
      if (!curEm || curEm === String(draft.verifiedEmailAddress).toLowerCase()) {
        isContactOtpVerified = true;
        verifiedEmailAddress = draft.verifiedEmailAddress;
        var st = document.getElementById("email-otp-inline-status");
        if (st) {
          st.style.display = "block";
          st.innerHTML = '<span class="badge status-approved">Verified</span> <span style="color:var(--good);font-weight:600;">Email verified (' + escapeHtml(verifiedEmailAddress) + ').</span>';
        }
      }
    }
    if (draft.pinLocationState && draft.pinLocationState.lat) {
      _pinLocationState = draft.pinLocationState;
    }
    var agree1 = document.getElementById("agree_sub");
    var agree2 = document.getElementById("agree_tu");
    if (agree1 && typeof draft.agree_sub === "boolean") agree1.checked = draft.agree_sub;
    if (agree2 && typeof draft.agree_tu === "boolean") agree2.checked = draft.agree_tu;
    renderPlanChoices();
    if (typeof updateIdFormatHint === "function") updateIdFormatHint();
    var targetPanel = Number(draft.currentPanel || 0);
    if (targetPanel >= 0 && targetPanel < TOTAL_PANELS) {
      showPanel(targetPanel);
    }
  } catch (e) {}
}

async function initApplyPage() {
  var params = new URLSearchParams(window.location.search);
  var qrUpload = params.get("qr_upload");
  var qrSid = params.get("sid");

  if (qrUpload === "1" && qrSid) {
    initMobileQrMode(qrSid);
    return;
  }

  try {
    if (typeof dbGetWebsiteContent === "function") {
      var liveContent = await dbGetWebsiteContent();
      window._latestWebsiteContent = liveContent;
      var mInfo = typeof getMaintenanceBlockInfo === "function" ? getMaintenanceBlockInfo(liveContent) : { blocked: typeof isMaintenanceOn === "function" && isMaintenanceOn() };
      if (mInfo && mInfo.blocked && !(typeof isManagerOrAdminPreview === "function" && isManagerOrAdminPreview())) {
        closePopup();
        document.body.innerHTML =
          '<main class="auth-page">' +
            '<div class="card auth-card center" style="max-width:520px">' +
              '<h2>' + escapeHtml(mInfo.title || "Website Under Maintenance") + '</h2>' +
              '<p class="muted mt">' + escapeHtml(mInfo.message || "Online fiber applications are temporarily paused for scheduled maintenance.") + '</p>' +
              '<div style="margin-top:18px"><a href="index.html" class="btn btn-red">Back to Home Page</a></div>' +
            '</div>' +
          '</main>';
        return;
      }
    }
  } catch (e) {}

  var urlPlan = params.get("plan");
  var urlAgent = params.get("agent") || params.get("ref");

  if (urlPlan) selectedPlanId = urlPlan;
  if (urlAgent) {
    referralAgentId = urlAgent;
    var banner = document.getElementById("agent-ref-banner");
    if (banner) {
      banner.hidden = false;
      banner.innerHTML = "<b>Agent Referral Active:</b> Your application is linked to Agent ID <b>" + escapeHtml(referralAgentId) + "</b>.";
    }
  }

  renderPlanChoices();
  setupDeviceUploadUI();
  attachApplyLiveValidation();
  restoreApplyDraftState(Boolean(urlPlan));

  document.addEventListener("input", function (ev) {
    if (ev && ev.target && ev.target.id) saveApplyDraftState();
  });
  document.addEventListener("change", function (ev) {
    if (ev && ev.target && ev.target.id) saveApplyDraftState();
  });
  window.addEventListener("resize", setupDeviceUploadUI);

  if (sessionStorage.getItem("pigem_captcha_verified") !== "true") {
    setTimeout(showApplySecurityCaptchaModal, 150);
  } else {
    applyCaptchaVerified = true;
  }
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
    emailEl.addEventListener("input", function () {
      if (typeof clearFieldError === "function") clearFieldError("email");
      if (verifiedEmailAddress && emailEl.value.trim().toLowerCase() !== verifiedEmailAddress) {
        isContactOtpVerified = false;
        var st = document.getElementById("email-otp-inline-status");
        if (st) st.style.display = "none";
        var btn = document.getElementById("btn-send-otp");
        if (btn) btn.textContent = "Send Email OTP";
      }
    });
  }

  var phoneEl = document.getElementById("phone");
  if (phoneEl) {
    phoneEl.addEventListener("input", function () {
      if (typeof clearFieldError === "function") clearFieldError("phone");
    });
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

function initMobileQrMode(sid) {
  _qrActiveSid = String(sid || "").replace(/[^a-zA-Z0-9_-]/g, "");
  var prog = document.querySelector(".prog");
  if (prog) prog.style.display = "none";
  var refBanner = document.getElementById("agent-ref-banner");
  if (refBanner) refBanner.hidden = true;
  for (var i = 0; i < TOTAL_PANELS; i++) {
    var p = document.getElementById("panel-" + i);
    if (p) p.hidden = true;
  }
  var mobilePanel = document.getElementById("panel-qr-mobile");
  if (mobilePanel) mobilePanel.hidden = false;
  var badge = document.getElementById("qr-mobile-session-badge");
  if (badge) badge.textContent = "Session: " + _qrActiveSid;
}

async function handleMobileQrUpload(side, inputEl) {
  var file = inputEl && inputEl.files && inputEl.files[0];
  if (!file) return;
  var ftype = String(file.type || "").toLowerCase();
  var fname = String(file.name || "").toLowerCase();
  var isImageMime = ftype.indexOf("image/") === 0;
  var isImageExt = /\.(jpe?g|png|webp|heic|heif|bmp|gif)$/.test(fname);
  var hasNoExt = !/\.[a-z0-9]{2,5}$/.test(fname);
  var allowedOpaqueMime = !ftype || ftype === "application/octet-stream";
  if (!isImageMime && !isImageExt && !(allowedOpaqueMime && hasNoExt)) {
    showAlert("Invalid File", "Please capture or choose a valid image photo.", "warn");
    inputEl.value = "";
    return;
  }
  var statusEl = document.getElementById(side === "front" ? "qr-front-status" : "qr-back-status");
  if (statusEl) statusEl.innerHTML = "<b>Uploading...</b> Syncing to your computer...";
  try {
    var uploadedUrl = await dbUploadQrSessionFile(_qrActiveSid, side, file);
    if (statusEl) statusEl.innerHTML = "<b style='color:var(--good)'>Uploaded &amp; Synced!</b>";
    var box = document.getElementById(side === "front" ? "qr-front-preview-box" : "qr-back-preview-box");
    var img = document.getElementById(side === "front" ? "qr-front-preview" : "qr-back-preview");
    if (box && img) {
      img.src = uploadedUrl;
      box.hidden = false;
    }
    var files = await dbListQrSessionFiles(_qrActiveSid);
    if (files.frontUrl && files.backUrl) {
      var doneNote = document.getElementById("qr-mobile-done-note");
      if (doneNote) doneNote.hidden = false;
    }
  } catch (err) {
    if (statusEl) statusEl.innerHTML = "<span style='color:#b42318;'>Upload failed: " + escapeHtml(err.message || "Try again") + "</span>";
  }
}

function showApplySecurityCaptchaModal() {
  openPopup(
    '<div class="center" style="padding:10px 4px;">' +
      '<div style="width:52px;height:52px;border-radius:50%;background:#e0f2fe;color:#0284c7;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg></div>' +
      '<h3 style="font-size:18px;margin-bottom:4px;">PIGEM Security Verification</h3>' +
      '<p class="small muted" style="margin-bottom:16px;">Please confirm you are not a robot before proceeding to the application form.</p>' +
      '<div id="g-apply-recaptcha-wrap" style="display:flex;justify-content:center;margin:16px auto;min-height:78px;">' +
        '<div id="g-apply-recaptcha-box" class="g-recaptcha" data-sitekey="' + CONFIG.RECAPTCHA_SITE_KEY + '" data-callback="onApplyCaptchaVerified"></div>' +
      '</div>' +
      '<div id="apply-captcha-fallback-box" style="margin-top:8px; display:none;">' +
        '<div id="apply-popup-captcha-card" class="captcha-container" onclick="triggerApplyPopupCaptcha()">' +
          '<div style="display:flex;align-items:center;gap:12px;">' +
            '<div id="apply-popup-captcha-check" class="captcha-box-inner"></div>' +
            '<span id="apply-popup-captcha-text" style="font-weight:600;font-size:14px;color:var(--text);">I\'m not a robot</span>' +
          '</div>' +
          '<div style="text-align:right;line-height:1.2;">' +
            '<div style="font-size:11px;font-weight:800;color:var(--muted);">CAPTCHA</div>' +
            '<div style="font-size:10px;color:var(--muted);">Security Verification</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>',
    { showCloseX: true, closeOnBackdrop: true }
  );

  if (typeof grecaptcha !== "undefined" && grecaptcha.render) {
    try {
      grecaptcha.render("g-apply-recaptcha-box", {
        sitekey: CONFIG.RECAPTCHA_SITE_KEY,
        callback: onApplyCaptchaVerified,
        "error-callback": function () {
          var fb = document.getElementById("apply-captcha-fallback-box");
          if (fb) fb.style.display = "block";
        }
      });
    } catch (e) {
      var fbCatch = document.getElementById("apply-captcha-fallback-box");
      if (fbCatch) fbCatch.style.display = "block";
    }
  } else {
    var fbInit = document.getElementById("apply-captcha-fallback-box");
    if (fbInit) fbInit.style.display = "block";
  }
}

async function onApplyCaptchaVerified(token) {
  if (token && typeof apiVerifyCaptcha === "function") {
    var vRes = await apiVerifyCaptcha(token);
    if (!vRes || vRes.verified === false) {
      showAlert("Security Verification", "Could not verify security token. Please try again.", "warn");
      return;
    }
  }
  sessionStorage.setItem("pigem_captcha_verified", "true");
  applyCaptchaVerified = true;
  closePopup();
  var cCard = document.getElementById("apply-captcha-card");
  var cCheck = document.getElementById("apply-captcha-check");
  if (cCard && cCheck) {
    cCard.classList.add("verified");
    cCheck.innerHTML = "&#10003;";
  }
}

function triggerApplyPopupCaptcha() {
  var check = document.getElementById("apply-popup-captcha-check");
  var card = document.getElementById("apply-popup-captcha-card");
  var text = document.getElementById("apply-popup-captcha-text");
  if (!check || !card) return;

  check.innerHTML = '<div class="captcha-spinner"></div>';
  if (text) text.textContent = "Verifying security credentials...";

  setTimeout(function () {
    check.innerHTML = "&#10003;";
    card.classList.add("verified");
    if (text) text.textContent = "I'm not a robot";
    setTimeout(function () {
      onApplyCaptchaVerified();
    }, 400);
  }, 600);
}

function renderPlanChoices() {
  var plans = getActivePlans();
  var box = document.getElementById("plan-choice-box");
  if (!box) return;
  var html = "";
  for (var i = 0; i < plans.length; i++) {
    var p = plans[i];
    var picked = String(p.id) === String(selectedPlanId) ? "picked" : "";
    html +=
      '<label class="' + picked + '" onclick="pickPlan(\'' + p.id + '\')">' +
        '<input type="radio" name="plan" value="' + p.id + '" ' + (picked ? "checked" : "") + '>' +
        '<b>' + p.name + '</b>' +
        '<span class="small muted">' + p.speed + ' Mbps &bull; ' + formatPeso(p.price) + '/mo</span>' +
      '</label>';
  }
  box.innerHTML = html;
}

function pickPlan(planId) {
  selectedPlanId = String(planId);
  renderPlanChoices();
}

var applyCaptchaVerified = false;

function triggerApplyCaptcha() {
  if (applyCaptchaVerified) return;
  var check = document.getElementById("apply-captcha-check");
  var card = document.getElementById("apply-captcha-card");
  var text = document.getElementById("apply-captcha-text");
  if (!check || !card) return;

  check.innerHTML = '<div class="captcha-spinner"></div>';
  if (text) text.textContent = "Verifying security credentials...";

  setTimeout(function () {
    applyCaptchaVerified = true;
    check.innerHTML = "&#10003;";
    card.classList.add("verified");
    if (text) text.textContent = "I'm not a robot";
  }, 600);
}

async function applyQrRemoteFile(side, url) {
  if (!url || _qrLoadedUrls[side] === url) return;
  _qrLoadedUrls[side] = url;
  try {
    var blob;
    if (url.indexOf("data:") === 0) {
      var parts = url.split(",");
      var mime = (parts[0].match(/:(.*?);/) || [])[1] || "image/jpeg";
      var bin = atob(parts[1]);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      blob = new Blob([arr], { type: mime });
    } else {
      var resp = await fetch(url);
      if (!resp.ok) return;
      blob = await resp.blob();
    }
    var file = new File([blob], "phone-id-" + side + ".jpg", { type: blob.type || "image/jpeg" });
    if (side === "front") {
      selectedFrontFile = file;
      var fnF = document.getElementById("id-front-filename");
      if (fnF) fnF.innerHTML = "<b style='color:var(--good)'>Received from Phone:</b> Front ID Photo";
      var boxF = document.getElementById("id-front-preview-box");
      var imgF = document.getElementById("id-front-preview");
      if (boxF && imgF) { imgF.src = url; boxF.hidden = false; }
      var qfStat = document.getElementById("qr-sync-front-state");
      if (qfStat) qfStat.innerHTML = "<b style='color:var(--good)'>Received!</b>";
    } else {
      selectedBackFile = file;
      var fnB = document.getElementById("id-back-filename");
      if (fnB) fnB.innerHTML = "<b style='color:var(--good)'>Received from Phone:</b> Back ID Photo";
      var boxB = document.getElementById("id-back-preview-box");
      var imgB = document.getElementById("id-back-preview");
      if (boxB && imgB) { imgB.src = url; boxB.hidden = false; }
      var qbStat = document.getElementById("qr-sync-back-state");
      if (qbStat) qbStat.innerHTML = "<b style='color:var(--good)'>Received!</b>";
    }
    var warnEl = document.getElementById("id-screen-warn");
    if (warnEl) { warnEl.hidden = true; warnEl.innerHTML = ""; }
  } catch (e) {}
}

function stopPhoneQrPolling() {
  if (_qrPollTimer) {
    clearInterval(_qrPollTimer);
    _qrPollTimer = null;
  }
}

function openPhoneQrModal() {
  stopPhoneQrPolling();
  if (!_qrActiveSid) {
    _qrActiveSid = "QR-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  }
  var baseUrl = window.location.href.split("?")[0].split("#")[0];
  var currentUrl = baseUrl + "?qr_upload=1&sid=" + encodeURIComponent(_qrActiveSid);
  var qrImgUrl = "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" + encodeURIComponent(currentUrl);

  openPopup(
    '<div class="center">' +
      '<h3>Continue ID Upload on Phone</h3>' +
      '<p class="small muted mt">Scan this QR code with your phone to capture or upload ONLY the Front &amp; Back photos of your Valid ID without restarting your application.</p>' +
      '<div class="mt-big" style="background:#fff; padding:16px; border-radius:12px; display:inline-block; border:1px solid var(--line);">' +
        '<img src="' + qrImgUrl + '" alt="Scan with Phone" style="width:180px; height:180px; display:block;" />' +
      '</div>' +
      '<div class="notice mt" style="text-align:left;font-size:13px;">' +
        '<div>Front ID Status: <span id="qr-sync-front-state">' + (selectedFrontFile ? "<b style='color:var(--good)'>Received!</b>" : "<span class='muted'>Waiting for phone...</span>") + '</span></div>' +
        '<div class="mt">Back ID Status: <span id="qr-sync-back-state">' + (selectedBackFile ? "<b style='color:var(--good)'>Received!</b>" : "<span class='muted'>Waiting for phone...</span>") + '</span></div>' +
      '</div>' +
      '<div class="small muted mt">Or open this link on your mobile browser:</div>' +
      '<input type="text" readonly value="' + currentUrl + '" style="font-size:12px; text-align:center; margin-top:6px;" onclick="this.select()" />' +
      '<div class="row mt-big" style="justify-content:center">' +
        '<button type="button" class="btn btn-red" onclick="stopPhoneQrPolling(); closePopup()">Done / Close</button>' +
      '</div>' +
    '</div>'
  );

  _qrPollTimer = setInterval(async function () {
    if (!document.getElementById("popup-modal")) {
      stopPhoneQrPolling();
      return;
    }
    var files = await dbListQrSessionFiles(_qrActiveSid);
    if (files.frontUrl) await applyQrRemoteFile("front", files.frontUrl);
    if (files.backUrl) await applyQrRemoteFile("back", files.backUrl);
  }, 2500);
}

async function sendContactOtp() {
  if (typeof clearFieldError === "function") clearFieldError("email");
  var email = document.getElementById("email").value.trim().toLowerCase();

  if (!email || !isCustomerGmail(email)) {
    flashErrorBubble("email", "Gmail Address", "Please enter a valid @gmail.com address first.");
    document.getElementById("email").focus();
    return;
  }

  var btn = document.getElementById("btn-send-otp");
  btn.disabled = true;
  btn.textContent = "Sending OTP...";

  var otpRec = typeof generateSecuredOtp === "function"
    ? generateSecuredOtp("apply_email_" + email)
    : { code: String(Math.floor(100000 + Math.random() * 900000)), refTag: "VSCF" };

  isContactOtpVerified = false;
  var first = (document.getElementById("first_name").value || "").trim();
  var last = (document.getElementById("last_name").value || "").trim();
  var applicantName = [first, last].filter(Boolean).join(" ") || "Applicant";

  var emailRes = await apiSendOtpEmail(
    email,
    otpRec.code,
    "verify your email address for your internet service application",
    applicantName,
    otpRec.refTag
  );

  btn.disabled = false;
  btn.textContent = "Resend Email OTP";

  openApplyOtpModal(email, otpRec.refTag, emailRes);
}

function openApplyOtpModal(email, refTag, emailRes) {
  var sentOk = !(emailRes && emailRes.sent === false);
  var statusLine = sentOk
    ? 'We sent a 6-digit verification code to <b>' + escapeHtml(email) + '</b> (Ref no: <b>' + escapeHtml(refTag || "VSCF") + '</b>). Valid for 5 minutes.'
    : '<span style="color:#dc2626;font-weight:700;">Delivery notice:</span> ' + escapeHtml((emailRes && emailRes.reason) || "Could not deliver email right now.");

  openPopup(
    '<h3 style="margin:0 0 6px;">Email Verification (OTP)</h3>' +
    '<p class="small muted" style="line-height:1.5;">' + statusLine + '</p>' +
    '<div class="mt-big">' +
      '<label for="modal-contact-otp-code">Enter 6-Digit Email OTP</label>' +
      '<input id="modal-contact-otp-code" type="text" maxlength="6" inputmode="numeric" placeholder="000000" style="text-align:center;font-size:20px;font-weight:800;letter-spacing:6px;">' +
    '</div>' +
    '<div class="row between mt-big" style="gap:8px;">' +
      '<button type="button" class="btn btn-outline btn-small" onclick="sendContactOtp()">Resend OTP</button>' +
      '<button type="button" class="btn btn-red" onclick="verifyContactOtpModal()">Verify Email OTP</button>' +
    '</div>',
    { showCloseX: true, closeOnBackdrop: true }
  );
  setTimeout(function () {
    var inp = document.getElementById("modal-contact-otp-code");
    if (inp) inp.focus();
  }, 60);
}

function verifyContactOtpModal() {
  if (typeof clearFieldError === "function") clearFieldError("modal-contact-otp-code");
  var email = document.getElementById("email").value.trim().toLowerCase();
  var codeInp = document.getElementById("modal-contact-otp-code");
  var entered = (codeInp ? codeInp.value : "").trim();
  var check = typeof verifySecuredOtp === "function"
    ? verifySecuredOtp("apply_email_" + email, entered)
    : { valid: false, reason: "Please request an OTP first." };

  if (!check.valid) {
    if (typeof setFieldError === "function" && codeInp) {
      setFieldError("modal-contact-otp-code", check.reason || "Incorrect 6-digit OTP code.");
    }
    return;
  }

  isContactOtpVerified = true;
  verifiedEmailAddress = email;
  closePopup();

  var btn = document.getElementById("btn-send-otp");
  if (btn) btn.textContent = "Email Verified";
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

  if (String(file.type || "").indexOf("image/") !== 0 || file.size < 4096) {
    inputEl.value = "";
    showAlert(
      "Invalid ID Photo",
      "Please select a clear, full-resolution image file (JPG or PNG, at least 4 KB) showing your Valid Government ID.",
      "warn"
    );
    return;
  }

  var otherFile = side === "front" ? selectedBackFile : selectedFrontFile;
  if (otherFile && otherFile.size === file.size && otherFile.name === file.name) {
    inputEl.value = "";
    showAlert(
      "Duplicate ID Image Detected",
      "You selected the exact same image file (" + escapeHtml(file.name) + ") for both the Front and Back of your Valid ID. Please upload two distinct photos showing the Front side and the Back side of your ID.",
      "warn"
    );
    return;
  }

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
  window._allowLowQualityIdOnce = false;
  if (typeof analyzeClientIdQuality === "function") {
    analyzeClientIdQuality(file).then(function (qRes) {
      if (!qRes || !qRes.metrics) return;
      var m = qRes.metrics;
      var wEl = document.getElementById("id-screen-warn");
      if (!wEl) return;
      var metricsSummary = "Sharpness: <b>" + (m.blur_score != null ? m.blur_score : "OK") + "</b> &bull; Brightness: <b>" + (m.brightness != null ? m.brightness : "OK") + "</b> &bull; Glare: <b>" + (m.glare_ratio != null ? Math.round(m.glare_ratio * 100) + "%" : "0%") + "</b>";
      if (qRes.issues && qRes.issues.length > 0) {
        wEl.style.background = "#fef2f2";
        wEl.style.borderColor = "#fecaca";
        wEl.style.color = "#991b1b";
        wEl.innerHTML = "<b>ID Image Quality Warning (" + (side === "front" ? "Front ID" : "Back ID") + "):</b> " + escapeHtml(qRes.issues.join(" ")) + "<div style='margin-top:4px;font-size:12px;'>" + metricsSummary + "</div>";
        wEl.hidden = false;
      } else {
        wEl.style.background = "#f0fdf4";
        wEl.style.borderColor = "#bbf7d0";
        wEl.style.color = "#166534";
        wEl.innerHTML = "<b>ID Image Quality Check Passed (" + (side === "front" ? "Front ID" : "Back ID") + "):</b> Photo is clear and readable.<div style='margin-top:4px;font-size:12px;'>" + metricsSummary + "</div>";
        wEl.hidden = false;
      }
    });
  }
}

function showPanel(index) {
  currentPanel = index;
  saveApplyDraftState();
  for (var i = 0; i < TOTAL_PANELS; i++) {
    var el = document.getElementById("panel-" + i);
    if (el) el.hidden = (i !== index);
  }
  var loadingPanel = document.getElementById("panel-loading");
  if (loadingPanel) loadingPanel.hidden = true;

  var pct = Math.round(((index + 1) / TOTAL_PANELS) * 100);
  document.getElementById("section-title").textContent = SECTION_TITLES[index];
  document.getElementById("section-pct").textContent = pct + "%";
  document.getElementById("section-bar").style.width = pct + "%";

  if (index === 3) {
    setTimeout(initMapPin, 180);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function validateCurrentPanel() {
  var panelEl = document.getElementById("panel-" + currentPanel);
  if (typeof clearAllFieldErrors === "function" && panelEl) clearAllFieldErrors(panelEl);
    var firstInvalidEl = null;
  var invalidReasons = [];

  function markInvalid(fieldId, name, msg, elToFocus) {
    flashErrorBubble(fieldId, name, msg);
    invalidReasons.push("&bull; <b>" + escapeHtml(name) + ":</b> " + escapeHtml(msg));
    if (!firstInvalidEl) {
      firstInvalidEl = elToFocus || document.getElementById(fieldId);
    }
  }

  function showInvalidSummaryPopup() {
    if (invalidReasons.length > 0 && typeof showAlert === "function") {
      showAlert(
        "Cannot Proceed — Please Check Required Fields",
        "<div style='text-align:left;line-height:1.6;'>Please complete or correct the following before proceeding:<br><br>" + invalidReasons.join("<br>") + "</div>",
        "warn"
      );
    }
  }

  if (currentPanel === 0) {
    if (!selectedPlanId) {
      markInvalid("plan-choice-box", "Plan Selection", "Please pick an internet plan.");
      showInvalidSummaryPopup();
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
      showInvalidSummaryPopup();
      return false;
    }
    return true;
  }

  if (currentPanel === 2) {
    var email = document.getElementById("email").value.trim().toLowerCase();
    var phone = document.getElementById("phone").value.trim().replace(/\D/g, "");
    var phoneAltRaw = document.getElementById("phone_alt").value.trim();
    var phoneAltDigits = phoneAltRaw.replace(/\D/g, "");

    if (!email || !isCustomerGmail(email)) markInvalid("email", "Gmail Address", "Enter a valid @gmail.com address.");
    else if (!isContactOtpVerified || verifiedEmailAddress !== email) {
      markInvalid("contact_otp", "Email OTP", "Click 'Send Email OTP' on the right to verify your Gmail address.", document.getElementById("btn-send-otp"));
    }
    if (!FORM_VALIDATOR.isValidMobile(phone)) markInvalid("phone", "Mobile Number", "Enter a valid 11-digit mobile number starting with 09.");

    if (phoneAltRaw && (phoneAltDigits.length !== 11 || !FORM_VALIDATOR.isValidMobile(phoneAltDigits))) {
      var altMsg = "Secondary mobile number must be an 11-digit number starting with 09 (or leave blank).";
      markInvalid("phone_alt", "Secondary Mobile Number", altMsg, document.getElementById("phone_alt"));
    }

    if (firstInvalidEl) {
      firstInvalidEl.scrollIntoView({ behavior: "smooth", block: "center" });
      firstInvalidEl.focus();
      showInvalidSummaryPopup();
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
      showAlert(
        "Philippines Only",
        "PIGEM Fiber installation is available only in the Philippines. Pinned location (" + (_pinLocationState.displayName || _pinLocationState.country || "Outside Philippines") + ") cannot proceed.",
        "warn"
      );
      var mapBox = document.getElementById("map");
      if (mapBox) mapBox.scrollIntoView({ behavior: "smooth", block: "center" });
      showInvalidSummaryPopup();
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
      showInvalidSummaryPopup();
      return false;
    }

    var pinMatch = doesPinMatchAddressFields(_pinLocationState, city, prov);
    if (!pinMatch.matches) {
      refreshCoverageBanner();
      markInvalid("city", "City / Municipality", pinMatch.reason);
      markInvalid("province", "Province / District", pinMatch.reason);
      showAlert("Pin & Address Mismatch", pinMatch.reason, "warn");
      var cityEl = document.getElementById("city");
      if (cityEl) {
        cityEl.scrollIntoView({ behavior: "smooth", block: "center" });
        cityEl.focus();
      }
      showInvalidSummaryPopup();
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
    if (!selectedBackFile) markInvalid("id_back", "Back of Valid ID", "Upload photo of the BACK of your ID.");

    if (firstInvalidEl) {
      firstInvalidEl.scrollIntoView({ behavior: "smooth", block: "center" });
      firstInvalidEl.focus();
      showInvalidSummaryPopup();
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
      showInvalidSummaryPopup();
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
var _pinLookupResolve = null;
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
  var boundsOk = !isNaN(latVal) && !isNaN(lngVal) && isWithinPhilippinesBounds(latVal, lngVal);
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
  ["barangay", "city", "province"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("input", refreshCoverageBanner);
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
    if (typeof dbSyncLiveSettingsAndContent === "function") {
      await dbSyncLiveSettingsAndContent();
    }
    var liveContent = (typeof dbGetWebsiteContent === "function") ? await dbGetWebsiteContent() : window._latestWebsiteContent;
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
  if (await enforceLiveMaintenanceOnStep()) return;
  if (currentPanel === 3) {
    var latVal = parseFloat(document.getElementById("lat").value);
    var lngVal = parseFloat(document.getElementById("lng").value);
    if (!isNaN(latVal) && !isNaN(lngVal)) {
      if (_pinLookupPromise) {
        await Promise.race([
          _pinLookupPromise,
          new Promise(function (resolve) { setTimeout(resolve, 4500); })
        ]);
      } else if (!_pinLocationState.resolved || Math.abs(_pinLocationState.lat - latVal) > 0.0001 || Math.abs(_pinLocationState.lng - lngVal) > 0.0001) {
        await Promise.race([
          updatePinAndAddress(latVal, lngVal),
          new Promise(function (resolve) { setTimeout(resolve, 4500); })
        ]);
      }
    }
  }
  if (!validateCurrentPanel()) return;
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

function initMapPin() {
  bindMapFieldListeners();
  if (!leafletMap) {
    var lat = parseFloat(document.getElementById("lat").value) || CONFIG.MAP_CENTER[0];
    var lng = parseFloat(document.getElementById("lng").value) || CONFIG.MAP_CENTER[1];

    leafletMap = L.map("map", { tap: false }).setView([lat, lng], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(leafletMap);

    leafletMarker = L.marker([lat, lng], { draggable: true }).addTo(leafletMap);

    leafletMarker.on("dragend", function () {
      var pos = leafletMarker.getLatLng();
      updatePinAndAddress(pos.lat, pos.lng);
    });

    leafletMap.on("click", function (event) {
      leafletMarker.setLatLng(event.latlng);
      updatePinAndAddress(event.latlng.lat, event.latlng.lng);
    });
  }
  setTimeout(function () {
    if (leafletMap) leafletMap.invalidateSize();
    var curLat = parseFloat(document.getElementById("lat").value);
    var curLng = parseFloat(document.getElementById("lng").value);
    if (isNaN(curLat) || isNaN(curLng)) {
      curLat = CONFIG.MAP_CENTER[0];
      curLng = CONFIG.MAP_CENTER[1];
    }
    if (!_pinLocationState.resolved && !_pinLookupPromise) {
      updatePinAndAddress(curLat, curLng);
    } else {
      refreshCoverageBanner();
    }
  }, 150);
}

async function updatePinAndAddress(lat, lng) {
  var mySeq = ++_pinSeq;
  if (_pinLookupResolve) {
    try { _pinLookupResolve(); } catch (_err) {}
  }
  _pinLookupPromise = new Promise(function (resolve) {
    _pinLookupResolve = resolve;
  });
  _pinLocationState.lat = lat;
  _pinLocationState.lng = lng;
  _pinLocationState.resolved = false;
  document.getElementById("lat").value = lat.toFixed(6);
  document.getElementById("lng").value = lng.toFixed(6);
  var statusEl = document.getElementById("map-status");
  statusEl.style.color = "";
  statusEl.textContent = "Looking up address for pinned location...";
  refreshCoverageBanner();

  var data = null;
  if (CONFIG.LOCATIONIQ_API_KEY) {
    try {
      var liqUrl =
        "https://us1.locationiq.com/v1/reverse?key=" +
        encodeURIComponent(CONFIG.LOCATIONIQ_API_KEY) +
        "&lat=" + lat +
        "&lon=" + lng +
        "&format=json&normalizeaddress=1";
      var liqRes = await fetch(liqUrl, { headers: { "Accept-Language": "en" } });
      if (liqRes.ok) {
        data = await liqRes.json();
      }
    } catch (liqErr) {
      data = null;
    }
  }

  if (!data) {
    try {
      var nomUrl = "https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=" + lat + "&lon=" + lng;
      var nomRes = await fetch(nomUrl, { headers: { "Accept-Language": "en" } });
      if (nomRes.ok) {
        data = await nomRes.json();
      }
    } catch (nomErr) {
      data = null;
    }
  }

  if (mySeq !== _pinSeq) return;
  if (data && data.address) {
    var addr = data.address || {};
    var locEval = evaluateMapLocation(lat, lng, data);
    _pinLocationState = {
      lat: lat,
      lng: lng,
      resolved: true,
      inPhilippines: locEval.inPhilippines,
      boundsOk: locEval.boundsOk,
      country: locEval.country,
      countryCode: locEval.countryCode,
      barangay: locEval.barangay,
      city: locEval.city,
      province: locEval.province,
      displayName: locEval.displayName,
      isServiceableArea: locEval.isServiceableArea,
      reverseData: data
    };
    if (!locEval.inPhilippines) {
      statusEl.style.color = "#b91c1c";
      statusEl.textContent = "Pinned outside the Philippines: " + (locEval.displayName || locEval.country || "Outside PH") + ". Installation is available in the Philippines only.";
    } else {
      var road = addr.road || addr.pedestrian || addr.footway || addr.street || "";
      var subd = addr.neighbourhood || addr.residential || addr.hamlet || addr.subdivision || "";
      if (road) document.getElementById("street").value = road;
      if (subd) document.getElementById("subdivision").value = subd;
      else if (!document.getElementById("subdivision").value) document.getElementById("subdivision").value = "N/A";
      if (locEval.barangay) document.getElementById("barangay").value = locEval.barangay;
      if (locEval.city) document.getElementById("city").value = locEval.city;
      if (locEval.province) document.getElementById("province").value = locEval.province;
      statusEl.style.color = "";
      statusEl.textContent = "Pinned location: " + (locEval.displayName || "Address updated");
    }
  } else {
    var inBoundsOnly = isWithinPhilippinesBounds(lat, lng);
    _pinLocationState = {
      lat: lat,
      lng: lng,
      resolved: true,
      inPhilippines: inBoundsOnly,
      boundsOk: inBoundsOnly,
      country: inBoundsOnly ? "Philippines" : "Outside Philippines",
      countryCode: inBoundsOnly ? "ph" : "",
      barangay: "",
      city: "",
      province: "",
      displayName: "",
      isServiceableArea: null,
      reverseData: null
    };
    if (!inBoundsOnly) {
      statusEl.style.color = "#b91c1c";
      statusEl.textContent = "Pinned outside the Philippines (" + lat.toFixed(5) + ", " + lng.toFixed(5) + "). Installation is available in the Philippines only.";
    } else {
      statusEl.style.color = "";
      statusEl.textContent = "Location pinned (" + lat.toFixed(5) + ", " + lng.toFixed(5) + "). You can type or edit your address fields below.";
    }
  }
  if (_pinLookupResolve) {
    var doneResolve = _pinLookupResolve;
    _pinLookupResolve = null;
    _pinLookupPromise = null;
    doneResolve();
  }
  refreshCoverageBanner();
}

async function searchMapAddress() {
  var q = document.getElementById("map-search").value.trim();
  if (!q) return;
  initMapPin();
  var statusEl = document.getElementById("map-status");
  statusEl.textContent = "Searching map for '" + q + "'...";

  var list = null;
  if (CONFIG.LOCATIONIQ_API_KEY) {
    try {
      var liqSearch =
        "https://us1.locationiq.com/v1/search?key=" +
        encodeURIComponent(CONFIG.LOCATIONIQ_API_KEY) +
        "&format=json&limit=1&countrycodes=ph&q=" +
        encodeURIComponent(q);
      var r1 = await fetch(liqSearch, { headers: { "Accept-Language": "en" } });
      if (r1.ok) list = await r1.json();
    } catch (e1) {
      list = null;
    }
  }

  if (!list || !Array.isArray(list) || list.length === 0) {
    try {
      var nomSearch = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ph&q=" + encodeURIComponent(q);
      var r2 = await fetch(nomSearch, { headers: { "Accept-Language": "en" } });
      if (r2.ok) list = await r2.json();
    } catch (e2) {
      list = null;
    }
  }

  if (!list || list.length === 0) {
    statusEl.textContent = "Place not found. Please drag the pin manually or type your address below.";
    return;
  }
  var lat = parseFloat(list[0].lat);
  var lng = parseFloat(list[0].lon);
  leafletMap.setView([lat, lng], 16);
  leafletMarker.setLatLng([lat, lng]);
  await updatePinAndAddress(lat, lng);
}

function useCurrentLocation() {
  initMapPin();
  var statusEl = document.getElementById("map-status");
  var btn = document.getElementById("btn-use-loc");

  if (!navigator.geolocation) {
    statusEl.textContent = "Browser does not support automatic location detection. Please search or drag the pin.";
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Locating...";
  }
  if (statusEl) statusEl.textContent = "Detecting current GPS location...";

  function onGeoSuccess(pos) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<img data-img="icons/location.png" src="https://wuunqfxyejxwrawtjdrf.supabase.co/storage/v1/object/public/website-assets/icons/location.png" alt="Location (not available)" class="icon-img"> Use My Location';
    }
    var lat = pos.coords.latitude;
    var lng = pos.coords.longitude;
    if (leafletMap && leafletMarker) {
      leafletMap.invalidateSize();
      leafletMap.setView([lat, lng], 17);
      leafletMarker.setLatLng([lat, lng]);
    }
    updatePinAndAddress(lat, lng);
  }

  function onGeoError() {
    navigator.geolocation.getCurrentPosition(
      onGeoSuccess,
      function () {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<img data-img="icons/location.png" src="https://wuunqfxyejxwrawtjdrf.supabase.co/storage/v1/object/public/website-assets/icons/location.png" alt="Location (not available)" class="icon-img"> Use My Location';
        }
        var msg = "Location permission denied or unavailable. Please search your street/barangay in the box above.";
        if (statusEl) statusEl.textContent = msg;
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }

  navigator.geolocation.getCurrentPosition(
    onGeoSuccess,
    onGeoError,
    { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 }
  );
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
  try { sessionStorage.removeItem(APPLY_DRAFT_KEY); } catch (e) {}
  window._allowLowQualityIdOnce = false;
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
  if (otpBtn) otpBtn.textContent = "Send Email OTP";
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

async function submitRegistration() {
  if (await enforceLiveMaintenanceOnStep()) return;
  if (!validateCurrentPanel()) return;

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
    var screeningActive = Boolean(getSystemSettings().ai_enabled);
    var preScreenRes = null;

    if (screeningActive && typeof apiVerifyIdPreSubmit === "function") {
      preScreenRes = await apiVerifyIdPreSubmit(selectedFrontFile, selectedBackFile, idType, {
        full_name: fullName,
        first_name: first,
        middle_name: middle,
        last_name: last,
        birth_date: birth,
        id_type: idType,
        id_number: idNumber
      });

      if (preScreenRes) {
        var ocrInfo = preScreenRes.ocr || {};
        var qualityInfo = preScreenRes.quality || {};
        var isNotGovId = (ocrInfo.is_valid_government_id === false || ocrInfo.is_Philippine_id === false);
        var hasQualityIssues = Boolean(qualityInfo.severe || qualityInfo.acceptable === false || qualityInfo.passed === false || (qualityInfo.issues && qualityInfo.issues.length > 0));
        var shouldBlockQuality = Boolean(qualityInfo.severe || (hasQualityIssues && !window._allowLowQualityIdOnce));

        if (isNotGovId || shouldBlockQuality) {
          if (!isNotGovId && !qualityInfo.severe) {
            window._allowLowQualityIdOnce = true;
          }
          var qMetrics = qualityInfo.metrics || {};
          var metricText = (qMetrics.blur_score != null)
            ? (" [Sharpness: " + qMetrics.blur_score + ", Brightness: " + (qMetrics.brightness != null ? qMetrics.brightness : "OK") + ", Glare: " + (qMetrics.glare_ratio != null ? Math.round(qMetrics.glare_ratio * 100) + "%" : "0%") + "]")
            : "";
          var rejectReason = isNotGovId
            ? ("The uploaded Front ID image does not appear to be a valid Philippine government-issued ID" +
              (ocrInfo.detected_document_type ? " (detected: " + ocrInfo.detected_document_type + ")" : "") +
              ". Please upload clear photos of an authentic Valid ID before submitting.")
            : ("Your uploaded ID photo triggered image quality warnings (" +
              ((qualityInfo.issues && qualityInfo.issues.length) ? qualityInfo.issues.join("; ") : "blurry, dark, or glare detected") +
              ")" + metricText + ". Please upload a clearer, well-lit photo before submitting.");

          if (loadingScreen) loadingScreen.hidden = true;
          showPanel(4);
          var warnBox = document.getElementById("id-screen-warn");
          if (warnBox) {
            warnBox.style.background = "#fef2f2";
            warnBox.style.borderColor = "#fecaca";
            warnBox.style.color = "#991b1b";
            warnBox.innerHTML = "<b>Valid ID Check Failed:</b> " + escapeHtml(rejectReason);
            warnBox.hidden = false;
          }
          showAlert(isNotGovId ? "Invalid Valid ID Document Blocked" : "ID Image Quality Warning", escapeHtml(rejectReason), "bad");
          return;
        }
      }
    }

    advanceLoadingStep(2);
    var accountInfo = await dbCreateAccountFromApplication(fullName, email);
    var appFolder = "applications/" + (accountInfo.user.id || "public") + "/original";
    var frontPath = await dbUploadDocument(selectedFrontFile, appFolder, "id-front");
    var backPath = await dbUploadDocument(selectedBackFile, appFolder, "id-back");

    var screening = preScreenRes && preScreenRes.status !== "offline"
      ? Object.assign({}, preScreenRes, { preliminary: false, state: "completed", phase: preScreenRes.overall_status || "Screened" })
      : {
          preliminary: true,
          state: screeningActive ? "queued" : "paused",
          phase: screeningActive ? "Queued for Screening" : "Manual Review Active",
          eta_seconds: screeningActive ? 35 : 0,
          advisory: screeningActive
            ? "Screening in progress. Original submission is available below."
            : "Manual document review is active."
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

    advanceLoadingStep(3);
    var latNum = parseFloat(document.getElementById("lat").value);
    var lngNum = parseFloat(document.getElementById("lng").value);
    var dupCheck = typeof dbFindDuplicateCustomerApplication === "function"
      ? await dbFindDuplicateCustomerApplication(email, Object.assign({}, addrData, {
          lat: latNum,
          lng: lngNum,
          plan: selectedPlanId,
          full_name: fullName
        }))
      : { isDuplicate: false };

    var baseAppPayload = Object.assign({}, addrData, {
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

    if (dupCheck && dupCheck.isDuplicate) {
      var rejectedSaved = await dbCreateApplication(Object.assign({}, baseAppPayload, {
        status: "Rejected",
        provider_remarks: dupCheck.reason,
        customer_instruction: "Auto-Rejected: " + dupCheck.reason
      }));
      await dbAddNotification({
        user_id: accountInfo.user.id,
        email: email,
        subject: "Application Auto-Rejected (Duplicate) - " + rejectedSaved.ref_no,
        body: dupCheck.reason,
        target_tab: "tab-apps",
        target_id: rejectedSaved.id
      });
      await dbAddNotification({
        role: "agent",
        subject: "Duplicate Application Auto-Rejected - " + rejectedSaved.ref_no,
        body: fullName + " (" + email + ") auto-rejected: " + dupCheck.reason,
        target_tab: "tab-queue",
        target_id: rejectedSaved.id
      });
      if (typeof apiSendStatusEmail === "function") {
        await apiSendStatusEmail(email, fullName, rejectedSaved.ref_no, "Rejected", dupCheck.reason);
      }
      await dbAddActivity("application_auto_rejected_duplicate", rejectedSaved.ref_no + " (" + email + ")");
      for (var dk = 1; dk <= 3; dk++) {
        var dItem = document.getElementById("step-ld-" + dk);
        if (dItem) {
          dItem.className = "reg-step-item done";
          dItem.querySelector(".reg-step-icon").innerHTML = "&#10003;";
        }
      }
      openPopup(
        '<div class="center">' +
          '<h3 style="color:#b42318;">Application Auto-Rejected</h3>' +
          '<p class="small muted mt">Reference Number: <b>' + escapeHtml(rejectedSaved.ref_no) + '</b></p>' +
          '<div class="notice mt" style="text-align:left;line-height:1.6;border-color:#fca5a5;background:#fef2f2;color:#991b1b;">' +
            '<b>Reason:</b> ' + escapeHtml(dupCheck.reason) +
          '</div>' +
          '<p class="small muted mt">Click outside or press X to return to Step 1.</p>' +
        '</div>',
        { showCloseX: true, closeOnBackdrop: true, onClose: resetApplyWizardToStep1 }
      );
      return;
    }

    var saved = await dbCreateApplication(baseAppPayload);

    if (!screeningActive) {
      var pausedScreening = Object.assign({}, screening, {
        state: "paused",
        phase: "Original Copy Ready (Manual Review)",
        eta_seconds: 0,
        fallback_original_only: true,
        severity: "info",
        advisory: "Auto-screening is currently paused. Original uploaded ID copies are ready for manual verification."
      });
      await dbUpdateApplication(saved.id, { screening: pausedScreening });
      if (typeof dbNotifyScreeningUnavailable === "function") {
        await dbNotifyScreeningUnavailable(saved.ref_no, fullName, "Original uploaded ID copies are ready for manual verification.");
      }
    } else if (!(preScreenRes && preScreenRes.status !== "offline") && typeof apiStartBackgroundScreening === "function") {
      apiStartBackgroundScreening(saved.id).then(async function (bgRes) {
        if (!bgRes || (!bgRes.queued && !bgRes.screened)) {
          var fallbackScreening = Object.assign({}, screening, {
            state: "unavailable",
            phase: "Original Copy Ready (Manual Review)",
            eta_seconds: 0,
            fallback_original_only: true,
            severity: "info",
            advisory: "Auto-screening is currently unavailable. Original uploaded ID copies are ready for manual verification."
          });
          await dbUpdateApplication(saved.id, { screening: fallbackScreening });
        }
      });
    }

    await new Promise(function (r) { setTimeout(r, 300); });

    var subject = "PIGEM Application Confirmation - Reference No. " + saved.ref_no;
    var body =
      "Dear " + fullName + ",\n\n" +
      "Thank you for submitting your internet service application with PIGEM Combined Facilities Support Services.\n\n" +
      "Reference Number: " + saved.ref_no + "\n" +
      "Plan: Red Fiber " + p.name + " (" + p.speed + " Mbps - " + formatPeso(p.price) + "/mo)\n" +
      "Status: Processing\n\n" +
      "Please check your email notification for your 6-digit Activation OTP Code and Account Activation link.";

    await dbAddNotification({ user_id: accountInfo.user.id, email: email, subject: subject, body: body, target_tab: "tab-apps", target_id: saved.id });
    await dbAddNotification({ role: "agent", subject: "New Application " + saved.ref_no, body: fullName + " submitted " + saved.ref_no, target_tab: "tab-queue", target_id: saved.id });
    await dbAddNotification({ role: "manager", subject: "New Application " + saved.ref_no, body: fullName + " submitted " + saved.ref_no + " (" + p.name + ")", target_tab: "tab-queue", target_id: saved.id });
    await apiSendApplicationConfirmationEmail(email, fullName, saved.ref_no, p, formatAddress(addrData), accountInfo);
    await dbAddActivity("application_submitted", saved.ref_no + " (" + email + ")");

    for (var k = 1; k <= 3; k++) {
      var item = document.getElementById("step-ld-" + k);
      if (item) {
        item.className = "reg-step-item done";
        item.querySelector(".reg-step-icon").innerHTML = "&#10003;";
      }
    }

    var isAlreadyActive = accountInfo.status === "active";

    openPopup(
      '<div class="center">' +
        '<h3>Application Submitted!</h3>' +
        '<p class="small muted mt">Your Application Reference Number is:</p>' +
        '<div class="big-ref">' + escapeHtml(saved.ref_no) + '</div>' +
        '<div class="notice mt" style="text-align:left;line-height:1.6;">' +
          '<b>Account Summary:</b><br>' +
          'Customer Email: <b>' + escapeHtml(email) + '</b><br>' +
          (isAlreadyActive
            ? 'Your Customer Account is already active. You may sign in anytime to track your application.'
            : 'We emailed your one-time activation link to <b>' + escapeHtml(email) + '</b>. Please check your Gmail inbox to create your own username and password and activate your Customer Account.') +
        '</div>' +
        '<p class="small muted mt">Click outside or press X to return to Step 1.</p>' +
      '</div>',
      { showCloseX: true, closeOnBackdrop: true, onClose: resetApplyWizardToStep1 }
    );
  } catch (err) {
    if (loadingScreen) loadingScreen.hidden = true;
    showPanel(5);
    showAlert("Submission Error", err.message || "Could not submit application.", "bad");
  }
}

initApplyPage();
