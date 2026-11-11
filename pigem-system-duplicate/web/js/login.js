// ============================================================================
// FILE: web/js/login.js
// PURPOSE: Role-Based Sign-In (Customer Gmail/Username vs. Staff Username-Only)
// ----------------------------------------------------------------------------
// SHARED SCRIPT IMPORTS (Loaded before this file via HTML <script> tags):
//   1. Inline Portal Config (`window.LOGIN_SYSTEM`) -> Customer / Staff / Admin gatekeeper
//   2. Google reCAPTCHA v2 (`recaptcha/api.js`)     -> Anti-bot sign-in verification
//   3. web/js/config.js -> Password rules, `attachEnterKeyNavigation` & modal helpers
//   4. web/js/db.js     -> `dbSignIn`, `dbRequestStaffPasswordReset`, OTP password recovery
//   5. web/js/api.js    -> `apiVerifyCaptcha` and `apiSendOtpEmail`
// ============================================================================

var loginCaptchaVerified = false;
var loginAttempts = 0;
var MAX_ATTEMPTS = 5;

var _recoveryState = {
  tab: "password",
  query: "",
  channel: "email",
  account: null,
  timerId: null,
  remainingSec: 300
};

// Data Accessor `getHomeForRole` (params: role): Retrieves or refreshes data to get home for role.
function getHomeForRole(role) {
  var r = String(role || "").toLowerCase();
  if (r === "admin") return (window.ROOT || "") + "admin.html";
  if (r === "manager") return (window.ROOT || "") + "manager.html";
  if (r === "agent") return (window.ROOT || "") + "agent.html";
  return (window.ROOT || "") + "customer.html";
}

window.onLoginCaptchaVerified = async function (token) {
  if (token && typeof apiVerifyCaptcha === "function") {
    var verifyRes = await apiVerifyCaptcha(token);
    if (!verifyRes || verifyRes.verified === false) {
      loginCaptchaVerified = false;
      return;
    }
  }
  loginCaptchaVerified = true;
};

window.onLoginCaptchaExpired = function () {
  loginCaptchaVerified = false;
};

// UI Renderer `renderLoginCaptchaBox`: Builds and updates DOM elements for login captcha box.
function renderLoginCaptchaBox() {
  var box = document.getElementById("login-captcha-box");
  if (!box) return;
  loginCaptchaVerified = false;
  var siteKey = CONFIG.RECAPTCHA_SITE_KEY;
  box.innerHTML = '<div id="g-login-recaptcha" class="g-recaptcha" data-sitekey="' + siteKey + '" data-callback="onLoginCaptchaVerified" data-expired-callback="onLoginCaptchaExpired"></div>';

  // Helper `tryRenderGoogle`: Executes workflow logic for `tryRenderGoogle`.
  function tryRenderGoogle() {
    if (typeof grecaptcha !== "undefined" && grecaptcha.render) {
      try {
        grecaptcha.render("g-login-recaptcha", {
          sitekey: siteKey,
          callback: onLoginCaptchaVerified,
          "expired-callback": onLoginCaptchaExpired,
          "error-callback": function () {
            renderLoginCaptchaFallback(box);
          }
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
          renderLoginCaptchaFallback(box);
        }
      }
    }, 250);
  }
}

// UI Renderer `renderLoginCaptchaFallback` (params: box): Builds and updates DOM elements for login captcha fallback.
function renderLoginCaptchaFallback(box) {
  if (!box) return;
  box.innerHTML =
    '<div id="login-captcha-card" class="captcha-container" onclick="triggerLoginCaptcha()">' +
      '<div style="display:flex;align-items:center;gap:12px;">' +
        '<div id="login-captcha-check" class="captcha-box-inner"></div>' +
        '<span id="login-captcha-text" style="font-weight:600;font-size:14px;color:var(--text);">I\'m not a robot</span>' +
      '</div>' +
      '<div style="text-align:right;line-height:1.2;">' +
        '<div style="font-size:11px;font-weight:800;color:var(--muted);">reCAPTCHA</div>' +
        '<div style="font-size:10px;color:var(--muted);">Security Verification</div>' +
      '</div>' +
    '</div>';
}

// Helper `triggerLoginCaptcha`: Executes workflow logic for `triggerLoginCaptcha`.
function triggerLoginCaptcha() {
  if (loginCaptchaVerified) return;
  var check = document.getElementById("login-captcha-check");
  var card = document.getElementById("login-captcha-card");
  var text = document.getElementById("login-captcha-text");
  if (!check || !card) return;

  check.innerHTML = '<div class="captcha-spinner"></div>';
  if (text) text.textContent = "Verifying security credentials...";

  setTimeout(function () {
    loginCaptchaVerified = true;
    check.innerHTML = "&#10003;";
    card.classList.add("verified");
    if (text) text.textContent = "I\'m not a robot";
  }, 450);
}

// Helper `resetLoginFieldsAndCaptcha`: Executes workflow logic for `resetLoginFieldsAndCaptcha`.
function resetLoginFieldsAndCaptcha() {
  var emailEl = document.getElementById("email");
  var pwEl = document.getElementById("password");
  if (emailEl) emailEl.value = "";
  if (pwEl) pwEl.value = "";
  loginCaptchaVerified = false;
  if (typeof grecaptcha !== "undefined" && grecaptcha.reset) {
    try {
      grecaptcha.reset();
      return;
    } catch (e) {}
  }
  renderLoginCaptchaBox();
}

// Data Accessor `loadRememberedIdentifier`: Retrieves or refreshes data to load remembered identifier.
function loadRememberedIdentifier() {
  var sys = window.SYSTEM || "customer";
  var saved = localStorage.getItem("pigem_remember_" + sys);
  var emailEl = document.getElementById("email");
  var remEl = document.getElementById("remember-me");
  if (saved && emailEl) {
    emailEl.value = saved;
    if (remEl) remEl.checked = true;
  }
}

// Action Handler `saveRememberedIdentifier` (params: identifier): Validates inputs and persists changes to save remembered identifier.
function saveRememberedIdentifier(identifier) {
  var sys = window.SYSTEM || "customer";
  var remEl = document.getElementById("remember-me");
  if (remEl && remEl.checked && identifier) {
    localStorage.setItem("pigem_remember_" + sys, identifier);
  } else {
    localStorage.removeItem("pigem_remember_" + sys);
  }
}

// Validator/Check `checkAdminProvisionState`: Evaluates rule (check admin provision state) and returns result.
async function checkAdminProvisionState() {
  if (window.SYSTEM !== "admin" || typeof dbHasAdminAccount !== "function") return;
  var box = document.getElementById("admin-provision-box");
  if (!box) return;
  var hasAdmin = await dbHasAdminAccount();
  box.hidden = Boolean(hasAdmin);
}

// Event Listener: Initializes handlers or syncs state when `DOMContentLoaded` fires
window.addEventListener("DOMContentLoaded", function () {
  loadRememberedIdentifier();
  renderLoginCaptchaBox();
  checkAdminProvisionState();
});

// UI State Controller `showLockoutPopup`: Updates modal, tab, or panel state to show lockout popup.
function showLockoutPopup() {
  var isCustomer = (window.SYSTEM === "customer");
  var msgHtml = isCustomer
    ? "You have reached " + MAX_ATTEMPTS + " failed login attempts. Please use Account Recovery to verify your identity via OTP."
    : "You have reached " + MAX_ATTEMPTS + " failed login attempts.<br><br><b>Need Help Signing In?</b><br>Contact the System Administrator at Tel: <b>(046) 458-0908</b> or Hotline: <b>101-733</b>, or submit a Password Reset Request below.";
  var actionBtn = isCustomer
    ? '<button class="btn btn-red" onclick="closePopup(); openForgotModal();">Recover Account</button>'
    : '<button class="btn btn-red" onclick="closePopup(); openStaffResetRequestModal();">Request Password Reset</button>';

  openPopup(
    "<h3>Sign-In Temporarily Locked</h3>" +
    '<div class="notice bad mt">' + msgHtml + "</div>" +
    '<div class="row mt-big" style="justify-content:flex-end; gap:8px;">' +
      '<button class="btn" onclick="closePopup()">Close</button>' +
      actionBtn +
    "</div>"
  );
}

// `openStaffResetRequestModal`: Opens the internal Forgot Password request modal showing Administrator contact info on the Staff Login page.
function openStaffResetRequestModal() {
  openPopup(
    '<div class="row between" style="margin-bottom:8px;">' +
      '<h3>Staff Password Reset Request</h3>' +
      '<button type="button" class="btn btn-outline btn-sm" onclick="closePopup()">Close</button>' +
    '</div>' +
    '<p class="small muted">Internal Agents and Managers use username-only accounts. Submit your username below to notify the System Administrator, or call <b>(046) 458-0908</b>.</p>' +
    '<form class="mt" onsubmit="submitStaffResetRequest(event)">' +
      '<label for="staff-reset-username">Your Staff Username</label>' +
      '<input id="staff-reset-username" type="text" placeholder="e.g. maria_santos" required>' +
      '<label for="staff-reset-note" class="mt">Optional Note / Contact Extension</label>' +
      '<input id="staff-reset-note" type="text" placeholder="e.g. Forgot password - Cavite Desk">' +
      '<div id="staff-reset-feedback" class="mt"></div>' +
      '<button type="submit" id="btn-staff-reset-submit" class="btn btn-red btn-full mt-big">Send Request to System Admin</button>' +
    '</form>'
  );
}

// `submitStaffResetRequest` (params: event): Submits a forgot-password request by username to notify the System Administrator in-system.
async function submitStaffResetRequest(event) {
  event.preventDefault();
  var unameEl = document.getElementById("staff-reset-username");
  var noteEl = document.getElementById("staff-reset-note");
  var fbEl = document.getElementById("staff-reset-feedback");
  var btn = document.getElementById("btn-staff-reset-submit");
  var uname = unameEl ? unameEl.value.trim() : "";
  var note = noteEl ? noteEl.value.trim() : "";
  if (fbEl) fbEl.innerHTML = "";
  btn.disabled = true;
  btn.textContent = "Sending Request...";
  try {
    var info = await dbRequestStaffPasswordReset(uname, note);
    if (fbEl) {
      fbEl.innerHTML = '<div class="notice ok"><b>Request Sent!</b> System Administrator has been notified to reset the password for <b>@' + escapeHtml(info.username) + '</b>. You may also reach Admin Support at Tel: <b>(046) 458-0908</b>.</div>';
    }
  } catch (err) {
    if (fbEl) {
      fbEl.innerHTML = '<div class="notice bad">' + escapeHtml(err.message || "Could not submit reset request.") + '</div>';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Send Request to System Admin";
  }
}

// Helper `handleLogin` (params: event): Executes workflow logic for `handleLogin`.
async function handleLogin(event) {
  event.preventDefault();

  var isAdmin = (window.SYSTEM === "admin");
  var isStaff = (window.SYSTEM === "staff");

  if (!isAdmin && loginAttempts >= MAX_ATTEMPTS) {
    showLockoutPopup();
    return;
  }

  var emailEl = document.getElementById("email");
  var pwEl = document.getElementById("password");
  var identifier = (emailEl ? emailEl.value : "").trim().toLowerCase();
  var password = pwEl ? pwEl.value : "";

  if (isAdmin || isStaff) {
    if (identifier.indexOf("@") !== -1) {
      resetLoginFieldsAndCaptcha();
      showAlert("Username Required", "Internal Admin, Manager, and Agent accounts sign in by Username only.", "warn");
      return;
    }
    var cleanU = identifier.replace(/^@/, "");
    if (typeof isValidUsername === "function" && !isValidUsername(cleanU)) {
      resetLoginFieldsAndCaptcha();
      showAlert("Invalid Username", "Please enter your valid username (3 to 30 characters: letters, numbers, dots, underscores).", "warn");
      return;
    }
    identifier = cleanU;
  } else {
    if (identifier.indexOf("@") !== -1) {
      if (typeof isCustomerGmail === "function" && !isCustomerGmail(identifier)) {
        resetLoginFieldsAndCaptcha();
        showAlert("Gmail or Username Required", "Customer Login accepts Customer usernames or @gmail.com email addresses only.", "warn");
        return;
      }
    } else if (typeof isValidUsername === "function" && !isValidUsername(identifier.replace(/^@/, ""))) {
      resetLoginFieldsAndCaptcha();
      showAlert("Invalid Username", "Please enter a valid username (3 to 30 characters) or @gmail.com email address.", "warn");
      return;
    }
  }

  if (!loginCaptchaVerified && typeof grecaptcha !== "undefined" && grecaptcha.getResponse) {
    try {
      var gResp = grecaptcha.getResponse();
      if (gResp && gResp.length > 0) loginCaptchaVerified = true;
    } catch (e) {}
  }

  if (!loginCaptchaVerified) {
    var card = document.getElementById("login-captcha-card") || document.getElementById("login-recaptcha-wrap");
    if (card) {
      card.style.borderColor = "#c8102e";
      setTimeout(function () { card.style.borderColor = "#cbd5e1"; }, 1500);
    }
    showAlert("Security Check", "Please check the 'I\'m not a robot' box before signing in.", "warn");
    return;
  }

  var btn = document.getElementById("btn-login");
  btn.disabled = true;
  var oldText = btn.textContent;
  btn.textContent = "Signing in...";

  try {
    var user = await dbSignIn(identifier, password);
    loginAttempts = 0;
    var bannerEl = document.getElementById("login-attempt-banner");
    if (bannerEl) bannerEl.hidden = true;
    saveRememberedIdentifier(identifier);
    window.location.href = getHomeForRole(user.role);
  } catch (err) {
    resetLoginFieldsAndCaptcha();
    if (emailEl) emailEl.focus();
    btn.disabled = false;
    btn.textContent = oldText;

    var banner = document.getElementById("login-attempt-banner");
    if (isAdmin) {
      if (banner) {
        banner.hidden = false;
        banner.innerHTML = "<b>Sign In Failed:</b> " + escapeHtml(err.message || "Invalid Administrator username or password.");
      }
      showAlert("Sign In Failed", err.message || "Invalid Administrator username or password.", "bad");
      return;
    }

    loginAttempts++;
    if (loginAttempts >= MAX_ATTEMPTS) {
      if (banner) {
        banner.hidden = false;
        banner.innerHTML = "<b>Account Temporarily Locked:</b> 5 failed attempts reached. Contact System Admin at Tel: <b>(046) 458-0908</b>" +
          (isStaff ? ' or <a href="#" onclick="openStaffResetRequestModal(); return false;">Request Password Reset</a>.' : ".");
      }
      showLockoutPopup();
    } else {
      var remaining = MAX_ATTEMPTS - loginAttempts;
      var msgText = (err.message || "Invalid username or password.") + " (Failed attempt " + loginAttempts + " of " + MAX_ATTEMPTS + ", " + remaining + " remaining)";
      if (banner) {
        banner.hidden = false;
        banner.innerHTML = "<b>Sign In Failed:</b> " + escapeHtml(msgText) +
          (isStaff ? "<br><span class='small'>Contact System Admin: Tel (046) 458-0908 | Hotline 101-733</span>" : "");
      }
      showAlert(
        "Sign In Failed",
        msgText + (isStaff ? "<br><br>Need help? Contact System Admin at <b>(046) 458-0908</b> or use <b>Forgot Password?</b>." : ""),
        "bad"
      );
    }
  }
}

// Helper `stopRecoveryCountdown`: Executes workflow logic for `stopRecoveryCountdown`.
function stopRecoveryCountdown() {
  if (_recoveryState.timerId) {
    clearInterval(_recoveryState.timerId);
    _recoveryState.timerId = null;
  }
}

// UI State Controller `openForgotModal` (params: initialTab): Updates modal, tab, or panel state to open forgot modal.
function openForgotModal(initialTab) {
  if (window.SYSTEM !== "customer") {
    showAlert("Administrator Managed", "Internal staff credentials are managed by the System Administrator.", "warn");
    return;
  }
  stopRecoveryCountdown();
  _recoveryState.tab = initialTab || "password";
  _recoveryState.account = null;
  _recoveryState.channel = "email";
  renderRecoveryStep1();
}

// Helper `switchRecoveryTab` (params: tabName): Executes workflow logic for `switchRecoveryTab`.
function switchRecoveryTab(tabName) {
  _recoveryState.tab = tabName;
  renderRecoveryStep1();
}

// UI Renderer `renderRecoveryStep1`: Builds and updates DOM elements for recovery step1.
function renderRecoveryStep1() {
  var tab = _recoveryState.tab || "password";
  var isPw = tab === "password";
  var isUser = tab === "username";
  var isEmail = tab === "email";

  var fieldLabel = isEmail ? "Registered Mobile Number or Full Name" : "Registered Email Address (Gmail)";
  var fieldPlaceholder = isEmail ? "09171234567 or Juan Dela Cruz" : "yourname@gmail.com";
  var fieldType = isEmail ? "text" : "email";
  var helperDesc = isPw
    ? "Enter your registered email address to receive a 6-digit verification code and reset your password."
    : (isUser
      ? "Enter your registered email address to verify your identity and recover your username."
      : "Forgot your email address? Enter your registered 11-digit mobile number or full name to verify and recover your email.");

  openPopup(
    '<div class="row between" style="margin-bottom:8px;">' +
      '<h3 style="margin:0;">What would you like to recover?</h3>' +
      '<button type="button" class="btn btn-small" onclick="closePopup()">Back to Login</button>' +
    '</div>' +
    '<p class="small muted">Select what you need help recovering below:</p>' +
    '<div class="recovery-tabs mt">' +
      '<button type="button" class="recovery-tab-btn' + (isPw ? " active" : "") + '" onclick="switchRecoveryTab(\'password\')">' +
        '<b>Password</b><span>I forgot my password</span>' +
      '</button>' +
      '<button type="button" class="recovery-tab-btn' + (isUser ? " active" : "") + '" onclick="switchRecoveryTab(\'username\')">' +
        '<b>Username</b><span>I forgot my username</span>' +
      '</button>' +
      '<button type="button" class="recovery-tab-btn' + (isEmail ? " active" : "") + '" onclick="switchRecoveryTab(\'email\')">' +
        '<b>Email Address</b><span>I forgot my email</span>' +
      '</button>' +
    '</div>' +
    '<div class="mt-big">' +
      '<p class="small muted" style="margin-bottom:10px;">' + helperDesc + '</p>' +
      '<label for="recovery-query-input">' + fieldLabel + '</label>' +
      '<input id="recovery-query-input" type="' + fieldType + '" placeholder="' + fieldPlaceholder + '" value="' + escapeHtml(_recoveryState.query || "") + '">' +
    '</div>' +
    '<div class="row between mt-big">' +
      '<button type="button" class="btn" onclick="closePopup()">&larr; Back to Login</button>' +
      '<button type="button" id="btn-recovery-send" class="btn btn-red" onclick="startRecoveryVerification()">Continue</button>' +
    '</div>' +
    '<div class="small muted mt" style="border-top:1px solid var(--line); padding-top:10px; font-size:12px;">' +
      'Outdated email address? Call our hotline at <b>(046) 458-0908</b> or <b>101-733 (RED)</b> for assistance.' +
    '</div>'
  );
}

// Helper `startRecoveryVerification`: Executes workflow logic for `startRecoveryVerification`.
async function startRecoveryVerification() {
  var inp = document.getElementById("recovery-query-input");
  var query = inp ? inp.value.trim() : "";
  if (!query) {
    showAlert("Field Required", "Please enter your account detail to continue.", "warn");
    return;
  }
  if (_recoveryState.tab !== "email" && typeof isCustomerGmail === "function" && !isCustomerGmail(query)) {
    showAlert("Gmail Required", "Please enter a valid @gmail.com email address, or switch to the 'Email Address' tab if you forgot your email.", "warn");
    return;
  }

  _recoveryState.query = query;
  var btn = document.getElementById("btn-recovery-send");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Sending Verification Code...";
  }

  try {
    var info = await dbFindAccountForRecovery(query, _recoveryState.tab);
    _recoveryState.account = info;
    _recoveryState.channel = "email";
    _recoveryState.remainingSec = 300;

    await apiSendOtpEmail(
      info.email,
      info.code,
      "recover your " + _recoveryState.tab,
      info.fullName,
      info.refTag
    );
    renderRecoveryOtpPinModal();
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Continue";
    }
    showAlert("Account Not Found", err.message || "Could not find a matching account.", "bad");
  }
}

// UI Renderer `renderRecoveryOtpPinModal`: Builds and updates DOM elements for recovery otp pin modal.
function renderRecoveryOtpPinModal() {
  var info = _recoveryState.account;
  if (!info) return;

  openPopup(
    '<div class="row between" style="margin-bottom:6px;">' +
      '<h3 style="margin:0;">Verification Code</h3>' +
      '<button type="button" class="btn btn-small" onclick="stopRecoveryCountdown(); renderRecoveryStep1();">&larr; Back</button>' +
    '</div>' +
    '<p class="small" style="color:var(--text); line-height:1.5;">We\'ve sent a verification code to your email <b>' + escapeHtml(info.maskedEmail) + '</b></p>' +
    '<div class="small muted mt" style="font-size:12px;">Ref no: <b>' + escapeHtml(info.refTag) + '</b>. Code will expire in 5 minutes.</div>' +
    '<div class="otp-squares mt-big" id="recovery-otp-squares">' +
      '<input type="text" maxlength="1" inputmode="numeric" class="otp-sq" data-sq="0" oninput="handleOtpSquareInput(this, 0)" onkeydown="handleOtpSquareKey(event, 0)">' +
      '<input type="text" maxlength="1" inputmode="numeric" class="otp-sq" data-sq="1" oninput="handleOtpSquareInput(this, 1)" onkeydown="handleOtpSquareKey(event, 1)">' +
      '<input type="text" maxlength="1" inputmode="numeric" class="otp-sq" data-sq="2" oninput="handleOtpSquareInput(this, 2)" onkeydown="handleOtpSquareKey(event, 2)">' +
      '<input type="text" maxlength="1" inputmode="numeric" class="otp-sq" data-sq="3" oninput="handleOtpSquareInput(this, 3)" onkeydown="handleOtpSquareKey(event, 3)">' +
      '<input type="text" maxlength="1" inputmode="numeric" class="otp-sq" data-sq="4" oninput="handleOtpSquareInput(this, 4)" onkeydown="handleOtpSquareKey(event, 4)">' +
      '<input type="text" maxlength="1" inputmode="numeric" class="otp-sq" data-sq="5" oninput="handleOtpSquareInput(this, 5)" onkeydown="handleOtpSquareKey(event, 5)">' +
    '</div>' +
    '<div class="center mt" id="recovery-timer-box" style="font-size:13px; min-height:22px;"></div>' +
    '<div class="mt-big">' +
      '<button type="button" id="btn-verify-pin" class="btn btn-red btn-full" onclick="verifyRecoveryPinCode()">Continue</button>' +
    '</div>' +
    '<div class="small muted mt-big" style="border-top:1px solid var(--line); padding-top:10px; font-size:12px; text-align:center;">' +
      'Outdated email address? Call our hotline at <b>(046) 458-0908</b> or <b>101-733 (RED)</b> for assistance.' +
    '</div>'
  );

  startRecoveryCountdownTimer();
  var firstSq = document.querySelector('#recovery-otp-squares .otp-sq[data-sq="0"]');
  if (firstSq) firstSq.focus();
}

// Helper `handleOtpSquareInput` (params: el, idx): Executes workflow logic for `handleOtpSquareInput`.
function handleOtpSquareInput(el, idx) {
  var val = String(el.value || "").replace(/\D/g, "");
  el.value = val ? val.slice(-1) : "";
  if (el.value && idx < 5) {
    var next = document.querySelector('#recovery-otp-squares .otp-sq[data-sq="' + (idx + 1) + '"]');
    if (next) next.focus();
  }
}

// Helper `handleOtpSquareKey` (params: ev, idx): Executes workflow logic for `handleOtpSquareKey`.
function handleOtpSquareKey(ev, idx) {
  if (ev.key === "Backspace" && !ev.target.value && idx > 0) {
    var prev = document.querySelector('#recovery-otp-squares .otp-sq[data-sq="' + (idx - 1) + '"]');
    if (prev) {
      prev.value = "";
      prev.focus();
    }
  }
}

// Data Accessor `getEnteredOtpSquaresCode`: Retrieves or refreshes data to get entered otp squares code.
function getEnteredOtpSquaresCode() {
  var boxes = document.querySelectorAll("#recovery-otp-squares .otp-sq");
  var code = "";
  for (var i = 0; i < boxes.length; i++) {
    code += String(boxes[i].value || "").trim();
  }
  return code;
}

// Utility `formatTimerMMSS` (params: sec): Normalizes or transforms values (format timer mmss).
function formatTimerMMSS(sec) {
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  return (m < 10 ? "0" + m : String(m)) + ":" + (s < 10 ? "0" + s : String(s));
}

// Helper `startRecoveryCountdownTimer`: Executes workflow logic for `startRecoveryCountdownTimer`.
function startRecoveryCountdownTimer() {
  stopRecoveryCountdown();
  var timerBox = document.getElementById("recovery-timer-box");
  if (!timerBox) return;

  // UI Renderer `renderTick`: Builds and updates DOM elements for tick.
  function renderTick() {
    var box = document.getElementById("recovery-timer-box");
    if (!box) {
      stopRecoveryCountdown();
      return;
    }
    if (_recoveryState.remainingSec > 0) {
      box.innerHTML = '<span class="muted">Resend code in <b>' + formatTimerMMSS(_recoveryState.remainingSec) + '</b></span>';
      _recoveryState.remainingSec--;
    } else {
      stopRecoveryCountdown();
      box.innerHTML = '<a href="#" class="resend-otp-link" onclick="resendRecoveryOtpCode(); return false;">Resend OTP</a>';
    }
  }

  renderTick();
  _recoveryState.timerId = setInterval(renderTick, 1000);
}

// Helper `resendRecoveryOtpCode`: Executes workflow logic for `resendRecoveryOtpCode`.
async function resendRecoveryOtpCode() {
  var box = document.getElementById("recovery-timer-box");
  if (box) {
    box.innerHTML = '<span class="muted"><span class="inline-spinner"></span> Sending new OTP...</span>';
  }
  try {
    var info = await dbFindAccountForRecovery(_recoveryState.account.email, _recoveryState.tab);
    _recoveryState.account = info;
    _recoveryState.remainingSec = 300;
    await apiSendOtpEmail(
      info.email,
      info.code,
      "recover your " + _recoveryState.tab,
      info.fullName,
      info.refTag
    );
    renderRecoveryOtpPinModal();
  } catch (err) {
    if (box) {
      box.innerHTML = '<a href="#" class="resend-otp-link" onclick="resendRecoveryOtpCode(); return false;">Resend OTP</a>';
    }
  }
}

// Helper `verifyRecoveryPinCode`: Executes workflow logic for `verifyRecoveryPinCode`.
function verifyRecoveryPinCode() {
  var entered = getEnteredOtpSquaresCode();
  if (entered.length < 6) {
    showAlert("Incomplete Code", "Please enter all 6 digits of your verification code.", "warn");
    return;
  }
  var info = _recoveryState.account;
  if (!info) return;

  var check = typeof verifySecuredOtp === "function"
    ? verifySecuredOtp("recovery_" + info.email, entered)
    : { valid: entered === String(info.code) };

  if (!check.valid) {
    showAlert("Invalid Code", check.reason || "The 6-digit verification code is incorrect.", "bad");
    return;
  }

  stopRecoveryCountdown();

  if (_recoveryState.tab === "username") {
    openPopup(
      "<h3>Username Recovered</h3>" +
      '<div class="notice good mt">' +
        "Your registered Customer Username is:<br>" +
        '<div style="font-size:20px;font-weight:800;margin-top:6px;">@' + escapeHtml(info.username) + "</div>" +
      "</div>" +
      '<div class="row between mt-big">' +
        '<button type="button" class="btn" onclick="closePopup()">Close</button>' +
        '<button type="button" class="btn btn-red" onclick="fillRecoveredLogin(\'' + escapeHtml(info.username) + '\')">Use Username to Sign In</button>' +
      "</div>"
    );
    return;
  }

  if (_recoveryState.tab === "email") {
    openPopup(
      "<h3>Email Address Recovered</h3>" +
      '<div class="notice good mt">' +
        "Your registered Customer Email Address and Username are:<br>" +
        '<div style="font-size:17px;font-weight:800;margin-top:6px;">' + escapeHtml(info.email) + "</div>" +
        '<div class="small muted" style="margin-top:4px;">Username: <b>@' + escapeHtml(info.username) + "</b></div>" +
      "</div>" +
      '<div class="row between mt-big">' +
        '<button type="button" class="btn" onclick="closePopup()">Close</button>' +
        '<button type="button" class="btn btn-red" onclick="fillRecoveredLogin(\'' + escapeHtml(info.email) + '\')">Use Email to Sign In</button>' +
      "</div>"
    );
    return;
  }

  openPopup(
    "<h3>Create New Password</h3>" +
    '<p class="small muted mt">Identity verified for <b>' + escapeHtml(info.maskedEmail) + "</b>. Enter your new password below.</p>" +
    '<div class="mt">' +
      '<label for="rec-new-pw">New Password</label>' +
      '<input id="rec-new-pw" type="password" data-pw-check="1" placeholder="Create strong password">' +
    "</div>" +
    '<div class="mt">' +
      '<label for="rec-new-pw2">Confirm New Password</label>' +
      '<input id="rec-new-pw2" type="password" placeholder="Repeat new password">' +
    "</div>" +
    '<div class="row between mt-big">' +
      '<button type="button" class="btn" onclick="closePopup()">Cancel</button>' +
      '<button type="button" class="btn btn-red" onclick="confirmResetPassword()">Save New Password</button>' +
    "</div>"
  );
}

// Helper `fillRecoveredLogin` (params: val): Executes workflow logic for `fillRecoveredLogin`.
function fillRecoveredLogin(val) {
  closePopup();
  var emailEl = document.getElementById("email");
  if (emailEl) emailEl.value = val;
}

// Action Handler `confirmResetPassword`: Validates inputs and persists changes to confirm reset password.
async function confirmResetPassword() {
  var info = _recoveryState.account;
  if (!info) return;
  var pw = document.getElementById("rec-new-pw").value;
  var pw2 = document.getElementById("rec-new-pw2").value;

  if (typeof isStrongPassword === "function" && !isStrongPassword(pw)) {
    showAlert("Weak Password", "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.", "warn");
    return;
  }
  if (pw !== pw2) {
    showAlert("Password Mismatch", "New Password and Confirm Password do not match.", "warn");
    return;
  }

  try {
    await dbFinishPasswordReset(info.email, info.code, pw);
    loginAttempts = 0;
    showAlert("Password Updated", "Your password has been updated. You can now sign in with your username or email.", "good");
  } catch (err) {
    showAlert("Reset Failed", err.message || "Could not update password.", "bad");
  }
}
