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
  var asterisk = document.querySelector('.req[data-req-for="' + fieldId + '"]');
  if (!asterisk) return;

  var old = asterisk.querySelectorAll(".req-bubble");
  for (var i = 0; i < old.length; i++) old[i].remove();

  var bubble = document.createElement("span");
  bubble.className = "req-bubble error-pop";
  bubble.innerHTML = "<b style='color:#fff;display:block;margin-bottom:2px;'>" + fieldName + " Required</b>" + message;
  asterisk.appendChild(bubble);

  setTimeout(function () {
    if (bubble && bubble.parentNode) bubble.remove();
  }, 4500);
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

function initApplyPage() {
  var params = new URLSearchParams(window.location.search);
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
  window.addEventListener("resize", setupDeviceUploadUI);

  if (sessionStorage.getItem("pigem_captcha_verified") !== "true") {
    setTimeout(showApplySecurityCaptchaModal, 150);
  } else {
    applyCaptchaVerified = true;
    var cCard = document.getElementById("apply-captcha-card");
    var cCheck = document.getElementById("apply-captcha-check");
    if (cCard && cCheck) {
      cCard.classList.add("verified");
      cCheck.innerHTML = "&#10003;";
    }
  }
}

function showApplySecurityCaptchaModal() {
  openPopup(
    '<div class="center" style="padding:10px 4px;">' +
      '<div style="width:48px;height:48px;border-radius:50%;background:#e0f2fe;color:#0284c7;display:flex;align-items:center;justify-content:center;font-size:24px;margin:0 auto 12px;"><img data-img="icons/shield.png" src="https://wuunqfxyejxwrawtjdrf.supabase.co/storage/v1/object/public/website-assets/icons/shield.png" alt="Security (not available)" class="icon-img" /></div>' +
      '<h3 style="font-size:18px;margin-bottom:4px;">Security Verification</h3>' +
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
      '<div class="row mt-big" style="justify-content:center;">' +
        '<button type="button" class="btn btn-outline btn-small" onclick="window.location.href=\'index.html\'">Return to Home</button>' +
      '</div>' +
    '</div>'
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

function openPhoneQrModal() {
  var currentUrl = window.location.href;
  var qrImgUrl = "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" + encodeURIComponent(currentUrl);

  openPopup(
    '<div class="center">' +
      '<h3>Continue on Phone</h3>' +
      '<p class="small muted mt">Scan this QR code with your phone camera to open this application form directly on your phone and take photos of your Valid ID.</p>' +
      '<div class="mt-big" style="background:#fff; padding:16px; border-radius:12px; display:inline-block; border:1px solid var(--line);">' +
        '<img src="' + qrImgUrl + '" alt="Scan with Phone" style="width:180px; height:180px; display:block;" />' +
      '</div>' +
      '<div class="small muted mt-big">Or open this link on your mobile browser:</div>' +
      '<input type="text" readonly value="' + currentUrl + '" style="font-size:12px; text-align:center; margin-top:6px;" onclick="this.select()" />' +
      '<div class="row mt-big" style="justify-content:center">' +
        '<button type="button" class="btn btn-red" onclick="closePopup()">OK, Got It</button>' +
      '</div>' +
    '</div>'
  );
}

async function sendContactOtp() {
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

  var row = document.getElementById("otp-Verify-row");
  if (row) row.hidden = false;
  var inp = document.getElementById("contact_otp_code");
  if (inp) {
    inp.disabled = false;
    inp.value = "";
  }

  var statusText = document.getElementById("otp-status-text");
  if (statusText) {
    if (emailRes && emailRes.sent) {
      statusText.innerHTML =
        "<b>6-Digit Email OTP sent!</b> Check <b>" + escapeHtml(email) +
        "</b> (Ref no: <b>" + escapeHtml(otpRec.refTag) + "</b>). Valid for 5 minutes.";
    } else {
      var errDetail = (emailRes && emailRes.reason) || "Could not deliver verification email right now.";
      statusText.innerHTML = "<span style='color:#dc2626;font-weight:700;'>Email delivery notice:</span> " + escapeHtml(errDetail);
    }
  }

  btn.disabled = false;
  btn.textContent = "Resend Email OTP";
}

function verifyContactOtp() {
  var email = document.getElementById("email").value.trim().toLowerCase();
  var entered = (document.getElementById("contact_otp_code").value || "").trim();
  var check = typeof verifySecuredOtp === "function"
    ? verifySecuredOtp("apply_email_" + email, entered)
    : { valid: false, reason: "Please request an OTP first." };

  if (!check.valid) {
    flashErrorBubble("contact_otp", "Email OTP", check.reason || "Incorrect 6-digit OTP code.");
    return;
  }

  isContactOtpVerified = true;
  verifiedEmailAddress = email;
  var badge = document.getElementById("otp-badge");
  if (badge) {
    badge.hidden = false;
    badge.className = "badge status-approved";
    badge.textContent = "Email Verified";
  }
  var input = document.getElementById("contact_otp_code");
  if (input) input.disabled = true;

  var statusText = document.getElementById("otp-status-text");
  if (statusText) {
    statusText.innerHTML = "<span style='color:var(--good);font-weight:700;'>Email address verified (Ref no: " + escapeHtml(check.refTag || "VSCF") + ").</span>";
  }
}

function updateIdFormatHint() {
  var type = document.getElementById("id_type").value;
  var hintEl = document.getElementById("id-format-hint");
  if (!hintEl) return;

  var hints = {
    "Philippine National ID (PhilSys)": "Format: 16 digits (e.g. 1234-5678-9012-3456)",
    "Driver's License": "Format: 1 letter + 10 digits (e.g. N01-23-456789)",
    "Passport": "Format: 9 alphanumeric characters (e.g. P1234567A)",
    "UMID": "Format: 12 digits (e.g. 0012-3456789-0)",
    "SSS ID": "Format: 10 digits (e.g. 34-1234567-8)",
    "PRC ID": "Format: 7 digits registration number",
    "Postal ID": "Format: 12-digit PRN code",
    "Voter's ID": "Format: 16-character alphanumeric code"
  };
  hintEl.textContent = hints[type] || "";
}

function handleIdFileSelect(side, inputEl) {
  var file = inputEl && inputEl.files && inputEl.files[0];
  if (!file) return;

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
}

function showPanel(index) {
  currentPanel = index;
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
  var firstInvalidEl = null;

  function markInvalid(fieldId, name, msg, elToFocus) {
    flashErrorBubble(fieldId, name, msg);
    if (!firstInvalidEl) {
      firstInvalidEl = elToFocus || document.getElementById(fieldId);
    }
  }

  if (currentPanel === 0) {
    if (!selectedPlanId) {
      markInvalid("plan", "Plan Selection", "Please pick an internet plan.");
      return false;
    }
    return true;
  }

  if (currentPanel === 1) {
    var first = document.getElementById("first_name").value.trim();
    var middle = document.getElementById("middle_name").value.trim();
    var last = document.getElementById("last_name").value.trim();
    var birth = document.getElementById("birth_date").value;

    if (!first) markInvalid("first_name", "First Name", "Please enter your first name.");
    if (!middle) {
      middle = "N/A";
      document.getElementById("middle_name").value = "N/A";
    }
    if (!last) markInvalid("last_name", "Last Name", "Please enter your last name.");
    if (!birth) markInvalid("birth_date", "Birth Date", "Please select your birth date.");

    if (firstInvalidEl) {
      firstInvalidEl.scrollIntoView({ behavior: "smooth", block: "center" });
      firstInvalidEl.focus();
      return false;
    }
    return true;
  }

  if (currentPanel === 2) {
    var email = document.getElementById("email").value.trim().toLowerCase();
    var phone = document.getElementById("phone").value.trim().replace(/\D/g, "");

    if (!email || !isCustomerGmail(email)) markInvalid("email", "Gmail Address", "Enter a valid @gmail.com address.");
    if (!phone || phone.length !== 11) markInvalid("phone", "Mobile Number", "Enter an 11-digit mobile number.");
    if (!isContactOtpVerified || verifiedEmailAddress !== email) {
      markInvalid("contact_otp", "Email OTP", "Please send and verify your 6-digit Email OTP code.", document.getElementById("btn-send-otp"));
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
      return false;
    }
    return true;
  }

  if (currentPanel === 5) {
    if (!document.getElementById("agree_sub").checked) {
      markInvalid("agree_sub", "Terms Agreement", "Please check to accept the Subscriber Certificate.");
    }
    if (!applyCaptchaVerified) {
      var card = document.getElementById("apply-captcha-card");
      if (card) {
        card.style.borderColor = "#c8102e";
        setTimeout(function () { card.style.borderColor = "#cbd5e1"; }, 1500);
      }
      markInvalid("agree_sub", "Security Verification", "Please verify the 'I\'m not a robot' CAPTCHA before submitting.");
    }
    if (firstInvalidEl) {
      firstInvalidEl.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    return true;
  }

  return true;
}

function nextPanel() {
  if (!validateCurrentPanel()) return;
  if (currentPanel < TOTAL_PANELS - 1) {
    showPanel(currentPanel + 1);
  }
}

function prevPanel() {
  if (currentPanel > 0) {
    showPanel(currentPanel - 1);
  }
}

function initMapPin() {
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
  }, 150);
}

async function updatePinAndAddress(lat, lng) {
  document.getElementById("lat").value = lat.toFixed(6);
  document.getElementById("lng").value = lng.toFixed(6);
  var statusEl = document.getElementById("map-status");
  statusEl.textContent = "Looking up address for pinned location...";

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

  if (data && data.address) {
    var addr = data.address || {};
    var road = addr.road || addr.pedestrian || addr.footway || addr.street || "";
    var subd = addr.neighbourhood || addr.residential || addr.hamlet || addr.subdivision || "";
    var brgy = addr.suburb || addr.village || addr.quarter || addr.city_district || "";
    var city = addr.city || addr.town || addr.municipality || "";
    var prov = addr.state || addr.province || addr.region || "";

    if (road) document.getElementById("street").value = road;
    if (subd) document.getElementById("subdivision").value = subd;
    else if (!document.getElementById("subdivision").value) document.getElementById("subdivision").value = "N/A";
    if (brgy) document.getElementById("barangay").value = brgy;
    if (city) document.getElementById("city").value = city;
    if (prov) document.getElementById("province").value = prov;

    statusEl.textContent = "Pinned location: " + (data.display_name || "Address updated");
  } else {
    statusEl.textContent = "Location pinned (" + lat.toFixed(5) + ", " + lng.toFixed(5) + "). You can type or edit your address fields below.";
  }
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

async function submitRegistration() {
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
    await new Promise(function (r) { setTimeout(r, 350); });

    advanceLoadingStep(2);
    var accountInfo = await dbCreateAccountFromApplication(fullName, email);
    var frontPath = await dbUploadDocument(selectedFrontFile, accountInfo.user.id || "public", "id-front");
    var backPath = await dbUploadDocument(selectedBackFile, accountInfo.user.id || "public", "id-back");

    var screening = {
      preliminary: true,
      state: getSystemSettings().ai_enabled ? "queued" : "paused",
      phase: getSystemSettings().ai_enabled ? "Queued for Screening" : "Manual Review Active",
      eta_seconds: getSystemSettings().ai_enabled ? 35 : 0,
      advisory: getSystemSettings().ai_enabled
        ? "Screening in progress. Original submission is available below."
        : "Manual document review is active."
    };

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
    var saved = await dbCreateApplication(Object.assign({}, addrData, {
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
      lat: parseFloat(document.getElementById("lat").value),
      lng: parseFloat(document.getElementById("lng").value),
      id_type: idType,
      id_number: idNumber,
      id_image_url: frontPath,
      id_back_image_url: backPath,
      id_front_path: frontPath,
      id_back_path: backPath,
      remarks: document.getElementById("remarks").value.trim(),
      agree_tu: document.getElementById("agree_tu").checked,
      screening: screening
    }));

    var screeningActive = Boolean(getSystemSettings().ai_enabled);
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
    } else if (typeof apiStartBackgroundScreening === "function") {
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

    await dbAddNotification({ user_id: accountInfo.user.id, email: email, subject: subject, body: body });
    await dbAddNotification({ role: "agent", subject: "New Application " + saved.ref_no, body: fullName + " submitted " + saved.ref_no });
    await dbAddNotification({ role: "manager", subject: "New Application " + saved.ref_no, body: fullName + " submitted " + saved.ref_no + " (" + p.name + ")" });
    await apiSendApplicationConfirmationEmail(email, fullName, saved.ref_no, p, formatAddress(addrData), accountInfo);
    await dbAddActivity("application_submitted", saved.ref_no + " (" + email + ")");

    for (var k = 1; k <= 3; k++) {
      var item = document.getElementById("step-ld-" + k);
      if (item) {
        item.className = "reg-step-item done";
        item.querySelector(".reg-step-icon").innerHTML = "&#10003;";
      }
    }

    openPopup(
      '<div class="center">' +
        '<h3>Application Submitted!</h3>' +
        '<p class="small muted mt">Your Application Reference Number is:</p>' +
        '<div class="big-ref">' + escapeHtml(saved.ref_no) + '</div>' +
        '<div class="notice mt" style="text-align:left;">' +
          '<b>Check Your Email Notification:</b><br>' +
          'We sent your confirmation details, 6-digit Activation OTP code, and Account Activation link to <b>' + escapeHtml(email) + '</b>. ' +
          'Please open your email inbox (or Spam folder) and use the activation link inside the email to activate your Customer Account.' +
        '</div>' +
        '<div class="row mt-big" style="justify-content:center">' +
          '<a class="btn btn-red" href="index.html">Return to Home</a>' +
        '</div>' +
      '</div>'
    );
  } catch (err) {
    if (loadingScreen) loadingScreen.hidden = true;
    showPanel(5);
    showAlert("Submission Error", err.message || "Could not submit application.", "bad");
  }
}

initApplyPage();
