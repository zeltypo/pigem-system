var loginCaptchaVerified = false;
var loginCaptchaVersion = 0;
var loginCaptchaWidget;
var loginAttempts = 0;
var MAX_ATTEMPTS = 5;
var LOCKOUT_MS = 30 * 60 * 1000;
var lockoutTimer = null;
var lockoutUntil = 0;
function loginAttemptKey(identifier) {
  return "pigem_login_attempts_" + window.SYSTEM + "_" + String(identifier).trim().toLowerCase();
}
function getLoginAttemptState(identifier) {
  var state = readSaved(loginAttemptKey(identifier), { attempts: 0, until: 0 });
  if (state.until && state.until <= Date.now()) {
    state = { attempts: 0, until: 0 };
    writeSaved(loginAttemptKey(identifier), state);
  }
  return state;
}
function showLoginLockout(until, popup) {
  lockoutUntil = until;
  clearInterval(lockoutTimer);
  function tick() {
    var remaining = Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000));
    var banner = document.getElementById("login-attempt-banner");
    var countdown = document.getElementById("login-lockout-countdown");
    var label = Math.floor(remaining / 60) + ":" + String(remaining % 60).padStart(2, "0");
    if (banner) {
      banner.hidden = remaining === 0;
      banner.textContent = remaining ? "Sign-in temporarily locked. Try again in " + label + "." : "";
    }
    if (countdown) countdown.textContent = remaining ? label : "You may sign in again.";
    if (!remaining) clearInterval(lockoutTimer);
  }
  if (popup) showLockoutPopup();
  tick();
  lockoutTimer = setInterval(tick, 1000);
}

var _recoveryState = {
  tab: "password",
  query: "",
  channel: "email",
  account: null,
  timerId: null,
  remainingSec: 300
};

window.onLoginCaptchaVerified = async function (token) {
  var version = ++loginCaptchaVersion;
  loginCaptchaVerified = false;
  if (!token || typeof apiVerifyCaptcha !== "function") return;
  var status = document.getElementById("login-captcha-status");
  if (status) status.textContent = "Checking…";
  var result = await apiVerifyCaptcha(token);
  if (version !== loginCaptchaVersion) return;
  loginCaptchaVerified = Boolean(result && result.verified === true);
  if (status) status.textContent = loginCaptchaVerified ? "" : "Security check failed. Try the checkbox again.";
  if (!loginCaptchaVerified && loginCaptchaWidget != null) grecaptcha.reset(loginCaptchaWidget);
};

window.onLoginCaptchaExpired = function () {
  loginCaptchaVersion++;
  loginCaptchaVerified = false;
  var status = document.getElementById("login-captcha-status");
  if (status) status.textContent = "";
};

async function renderLoginCaptchaBox() {
  var box = document.getElementById("login-captcha-box");
  if (!box) return;
  loginCaptchaVerified = false;
  var health = await apiCheckHealth();
  if (!box.isConnected) return;
  var siteKey = health?.recaptcha_site_key || CONFIG.RECAPTCHA_SITE_KEY;
  box.innerHTML = '<div id="g-login-recaptcha"></div>';

  function tryRenderGoogle() {
    if (typeof grecaptcha !== "undefined" && grecaptcha.render) {
      try {
        loginCaptchaWidget = grecaptcha.render("g-login-recaptcha", {
          sitekey: siteKey,
          size: window.SYSTEM === "customer" && box.clientWidth < 304 ? "compact" : "normal",
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

function renderLoginCaptchaFallback(box) {
  if (!box) return;
  box.textContent = "The security check could not load. Refresh the page and try again.";
}

function resetLoginFieldsAndCaptcha() {
  var pwEl = document.getElementById("password");
  if (pwEl) pwEl.value = "";
  window.onLoginCaptchaExpired();
  if (typeof grecaptcha !== "undefined" && grecaptcha.reset) {
    try {
      grecaptcha.reset(loginCaptchaWidget);
      return;
    } catch (e) {}
  }
  renderLoginCaptchaBox();
}

async function checkAdminProvisionState() {
  if (window.SYSTEM !== "admin" || typeof dbHasAdminAccount !== "function") return;
  var box = document.getElementById("admin-provision-box");
  if (!box) return;
  var hasAdmin = await dbHasAdminAccount();
  box.hidden = Boolean(hasAdmin);
}

function showSessionReasonBanner() {
  var params = new URLSearchParams(window.location.search);
  var reason = String(params.get("reason") || "").toLowerCase();
  if (!reason) return false;
  if (window.history && typeof window.history.replaceState === "function") {
    window.history.replaceState(null, "", window.location.pathname);
  }
  var banner = document.getElementById("login-attempt-banner");
  if (!banner) return true;
  if (reason === "idle") {
    banner.hidden = false;
    banner.innerHTML = "<b>Session Ended:</b> Please sign in again to continue.";
  } else if (reason === "other_device") {
    banner.hidden = false;
    banner.innerHTML = "<b>Signed Out:</b> Another browser or device recently logged into this account, so this session was automatically signed out.";
  } else if (reason === "account_switched") {
    banner.hidden = false;
    banner.textContent = "Another account is now using this portal in this browser.";
  } else if (reason === "disabled") {
    banner.hidden = false;
    banner.innerHTML = "<b>Account Disabled:</b> This account has been deactivated. Contact System Admin at Tel: <b>(046) 458-0908</b>.";
  } else if (reason === "wrong_portal") {
    banner.hidden = false;
    banner.innerHTML = "<b>Portal Restricted:</b> That dashboard belongs to a different account role. Please sign in with the matching account.";
  }
  return true;
}

window.addEventListener("DOMContentLoaded", function () {
  var field = document.getElementById("email");
  try {
    if (window.SYSTEM !== "customer" && field && !field.value) field.value = localStorage.getItem("pigem_login_name_" + window.SYSTEM) || "";
  } catch (error) {}
  showSessionReasonBanner();
  renderLoginCaptchaBox();
  checkAdminProvisionState();
  var idEl = document.getElementById("email");
  var pwEl = document.getElementById("password");
  if (idEl && typeof clearFieldError === "function") idEl.addEventListener("input", function () { clearFieldError("email"); });
  if (idEl) {
    var refreshLockout = function () {
      var value = idEl.value.trim().replace(/^@/, "");
      var state = getLoginAttemptState(value);
      if (state.until > Date.now()) showLoginLockout(state.until, false);
      else if (lockoutTimer) {
        clearInterval(lockoutTimer); lockoutTimer = null; lockoutUntil = 0;
        var banner = document.getElementById("login-attempt-banner");
        if (banner) banner.hidden = true;
      }
    };
    idEl.addEventListener("input", refreshLockout);
    refreshLockout();
  }
  if (pwEl && typeof clearFieldError === "function") pwEl.addEventListener("input", function () { clearFieldError("password"); });
});

function showLockoutPopup() {
  var isCustomer = (window.SYSTEM === "customer");
  var msgHtml = "You have reached five failed sign-in attempts. Please wait 30 minutes before trying again.<br><b id='login-lockout-countdown'></b>";
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

var _staffRecoveryTab = "password";

function switchStaffRecoveryTab(tabName) {
  _staffRecoveryTab = (tabName === "username") ? "username" : "password";
  openStaffResetRequestModal(_staffRecoveryTab);
}

function openStaffResetRequestModal(initialTab) {
  var tab = (initialTab === "username") ? "username" : "password";
  _staffRecoveryTab = tab;
  var isPw = tab === "password";
  var isUser = tab === "username";
  var fieldLabel = isPw ? "Your Staff Username" : "Your Full Name (or Staff Username)";
  var fieldPlaceholder = isPw ? "e.g. maria_santos" : "e.g. Maria Santos";

  openPopup(
    '<h3>Sign-in problems?</h3>' +
    '<p class="small muted">Recover your Internal Staff Username or Password:</p>' +
    '<div class="recovery-tabs mt">' +
      '<button type="button" class="recovery-tab-btn' + (isPw ? " active" : "") + '" onclick="switchStaffRecoveryTab(\'password\')">' +
        '<b>Forgot Password</b><span>Request password reset from Admin</span>' +
      '</button>' +
      '<button type="button" class="recovery-tab-btn' + (isUser ? " active" : "") + '" onclick="switchStaffRecoveryTab(\'username\')">' +
        '<b>Forgot Username</b><span>Retrieve your @username</span>' +
      '</button>' +
    '</div>' +
    '<div class="notice mt" style="font-size:12.5px; line-height:1.5; margin-bottom:12px;">' +
      '<b>Internal Access Support:</b> Forgot your username or password? Submit a recovery request below or contact System Admin at Tel: <b>(046) 458-0908</b> / Hotline: <b>101-733</b>.' +
    '</div>' +
    '<form class="mt" onsubmit="submitStaffResetRequest(event)" novalidate>' +
      '<label for="staff-reset-username">' + fieldLabel + '</label>' +
      '<input id="staff-reset-username" type="text" placeholder="' + fieldPlaceholder + '">' +
      '<label for="staff-reset-note" class="mt">Optional Note / Contact Extension</label>' +
      '<input id="staff-reset-note" type="text" placeholder="e.g. Forgot ' + tab + ' - Cavite Desk">' +
      '<div id="staff-reset-feedback" class="mt"></div>' +
      '<button type="submit" id="btn-staff-reset-submit" class="btn btn-red btn-full mt-big">Send Request to System Admin</button>' +
    '</form>',
    { showCloseX: true, closeOnBackdrop: true }
  );
}

async function submitStaffResetRequest(event) {
  event.preventDefault();
  if (typeof clearFieldError === "function") clearFieldError("staff-reset-username");
  var unameEl = document.getElementById("staff-reset-username");
  var noteEl = document.getElementById("staff-reset-note");
  var fbEl = document.getElementById("staff-reset-feedback");
  var btn = document.getElementById("btn-staff-reset-submit");
  var uname = unameEl ? unameEl.value.trim() : "";
  var note = noteEl ? noteEl.value.trim() : "";
  if (!uname) {
    if (typeof setFieldError === "function") {
      setFieldError("staff-reset-username", _staffRecoveryTab === "username" ? "Please enter your full name or staff username." : "Please enter your staff username.");
    }
    return;
  }
  if (fbEl) fbEl.innerHTML = "";
  btn.disabled = true;
  btn.textContent = "Sending Request...";
  try {
    var reqNote = (_staffRecoveryTab === "username" ? "[Forgot Username] " : "[Forgot Password] ") + note;
    var info = await dbRequestStaffPasswordReset(uname, reqNote.trim());
    if (fbEl) {
      fbEl.innerHTML = _staffRecoveryTab === "username"
        ? '<div class="notice ok"><b>Account Found &amp; Admin Notified!</b> Your staff username is <b>@' + escapeHtml(info.username) + '</b>. System Administrator has also been notified.</div>'
        : '<div class="notice ok"><b>Request Sent!</b> System Administrator has been notified to reset the password for <b>@' + escapeHtml(info.username) + '</b>. You may also reach Admin Support at Tel: <b>(046) 458-0908</b>.</div>';
    }
  } catch (err) {
    if (typeof setFieldError === "function") setFieldError("staff-reset-username", err.message || "Could not submit reset request.");
    else if (fbEl) fbEl.innerHTML = '<div class="notice bad">' + escapeHtml(err.message || "Could not submit reset request.") + '</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = "Send Request to System Admin";
  }
}

function validateLoginIdentifier(raw, usernameOnly) {
  var value = String(raw || "").trim().replace(/^@/, "");
  if (!value) return { error: usernameOnly ? "Enter your username." : "Enter your username or Gmail address." };
  if (value.includes("@")) {
    if (usernameOnly) return { error: "Enter your username here." };
    if (!isCustomerGmail(value)) return { error: "Enter a valid Gmail address." };
    return { value: value.toLowerCase() };
  }
  if (!isValidUsername(value)) {
    return { error: "Use 3–30 letters, numbers, dots, or underscores for your username." };
  }
  return { value: value };
}

async function handleLogin(event) {
  event.preventDefault();
  if (typeof clearAllFieldErrors === "function") clearAllFieldErrors();

  var isAdmin = (window.SYSTEM === "admin");
  var isStaff = (window.SYSTEM === "staff");

  var emailEl = document.getElementById("email");
  var pwEl = document.getElementById("password");
  var login = validateLoginIdentifier(emailEl ? emailEl.value : "", isAdmin || isStaff);
  var password = pwEl ? pwEl.value : "";
  if (login.error) setFieldError("email", login.error);
  if (!password) setFieldError("password", "Enter your password.");
  if (login.error || !password) return;
  var attemptState = getLoginAttemptState(login.value);
  if (attemptState.until > Date.now()) {
    showLoginLockout(attemptState.until, true);
    return;
  }

  if (!loginCaptchaVerified) {
    var captchaStatus = document.getElementById("login-captcha-status");
    if (captchaStatus) {
      captchaStatus.textContent = "Complete the security check before signing in.";
      captchaStatus.focus();
      return;
    }
    var card = document.getElementById("login-captcha-card") || document.getElementById("login-recaptcha-wrap");
    if (card) {
      card.style.borderColor = "#c8102e";
      setTimeout(function () { card.style.borderColor = "#cbd5e1"; }, 1500);
    }
    var bannerCap = document.getElementById("login-attempt-banner");
    if (bannerCap) {
      bannerCap.hidden = false;
      bannerCap.innerHTML = "<b>Security Check:</b> Please complete the 'I'm not a robot' verification before signing in.";
    }
    return;
  }

  var btn = document.getElementById("btn-login");
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  var oldText = btn.textContent;
  btn.textContent = "Signing in...";

  try {
    var user = await dbSignIn(login.value, password);
    try {
      if (window.SYSTEM === "customer") sessionStorage.setItem("pigem_show_application_updates", String(user.id));
      else localStorage.setItem("pigem_login_name_" + window.SYSTEM, login.value);
    } catch (error) {}
    loginAttempts = 0;
    writeSaved(loginAttemptKey(login.value), { attempts: 0, until: 0 });
    var bannerEl = document.getElementById("login-attempt-banner");
    if (bannerEl) bannerEl.hidden = true;
    window.location.replace(getHomeForRole(user.role));
  } catch (err) {
    resetLoginFieldsAndCaptcha();
    if (emailEl) emailEl.focus();
    btn.disabled = false;
    btn.textContent = oldText;

    var banner = document.getElementById("login-attempt-banner");
    loginAttempts = attemptState.attempts + 1;
    if (err.lockedUntil) loginAttempts = MAX_ATTEMPTS;
    if (loginAttempts >= MAX_ATTEMPTS) {
      var until = err.lockedUntil || Date.now() + LOCKOUT_MS;
      writeSaved(loginAttemptKey(login.value), { attempts: MAX_ATTEMPTS, until: until });
      showLoginLockout(until, true);
    } else {
      writeSaved(loginAttemptKey(login.value), { attempts: loginAttempts, until: 0 });
      var remaining = MAX_ATTEMPTS - loginAttempts;
      var msgText = (err.message || "Invalid username or password.") + " (Failed attempt " + loginAttempts + " of " + MAX_ATTEMPTS + ", " + remaining + " remaining)";
      if (window.SYSTEM === "customer") {
        if (banner) banner.hidden = true;
        var message = err.message || "Sign-in failed. Check your username and password.";
        if (message.includes("activate.html") || message.toLowerCase().includes("activate your account")) {
          message = "Open the activation email we sent after you applied and set your password.";
        }
        setFieldError("password", message + " (" + remaining + " attempts remaining)");
        return;
      }
      if (typeof setFieldError === "function") setFieldError("password", msgText);
      if (banner) {
        banner.hidden = false;
        banner.innerHTML = "<b>Sign In Failed:</b> " + escapeHtml(msgText) +
          (isStaff ? "<br><span class='small'>Contact System Admin: Tel (046) 458-0908 | Hotline 101-733</span>" : "");
      }
    }
  }
}

function stopRecoveryCountdown() {
  if (_recoveryState.timerId) {
    clearInterval(_recoveryState.timerId);
    _recoveryState.timerId = null;
  }
}

function openForgotModal(initialTab) {
  if (window.SYSTEM !== "customer") {
    showAlert("Administrator Managed", "Internal staff credentials are managed by the System Administrator.", "warn");
    return;
  }
  stopRecoveryCountdown();
  _recoveryState.tab = initialTab || "password";
  _recoveryState.query = "";
  _recoveryState.account = null;
  _recoveryState.channel = "email";
  renderRecoveryStep1();
}

function switchRecoveryTab(tabName) {
  _recoveryState.tab = tabName;
  renderRecoveryStep1();
}

function renderRecoveryStep1() {
  var tab = (_recoveryState.tab === "username") ? "username" : "password";
  _recoveryState.tab = tab;
  var isPw = tab === "password";
  var isUser = tab === "username";

  var fieldLabel = "Registered Gmail Address";
  var fieldPlaceholder = "yourname@gmail.com";
  var helperDesc = isPw
    ? "Enter your registered @gmail.com email address to receive a 6-digit verification code and reset your password."
    : "Enter your registered @gmail.com email address to verify your identity and recover your Customer Username.";

  openPopup(
    '<h3>Sign-in problems?</h3>' +
    '<p class="small muted">First time signing in? Open the activation link sent to your Gmail after you submitted an application. Check Spam if you can’t find it.</p>' +
    '<div class="recovery-tabs mt">' +
      '<button type="button" class="recovery-tab-btn' + (isPw ? " active" : "") + '" onclick="switchRecoveryTab(\'password\')">' +
        '<b>Forgot Password</b><span>Reset your password via Gmail OTP</span>' +
      '</button>' +
      '<button type="button" class="recovery-tab-btn' + (isUser ? " active" : "") + '" onclick="switchRecoveryTab(\'username\')">' +
        '<b>Forgot Username</b><span>Retrieve your @username</span>' +
      '</button>' +
    '</div>' +
    '<div class="mt-big">' +
      '<p class="small muted" style="margin-bottom:10px;">' + helperDesc + '</p>' +
      '<label for="recovery-query-input">' + fieldLabel + '</label>' +
      '<input id="recovery-query-input" type="email" placeholder="' + fieldPlaceholder + '" value="' + escapeHtml(_recoveryState.query || "") + '">' +
    '</div>' +
    '<div class="row between mt-big">' +
      '<button type="button" class="btn" onclick="closePopup()">&larr; Back to Login</button>' +
      '<button type="button" id="btn-recovery-send" class="btn btn-red" onclick="startRecoveryVerification()">Continue</button>' +
    '</div>' +
    '<div class="small muted mt" style="border-top:1px solid var(--line); padding-top:10px; font-size:12px;">' +
      'Forgot or lost access to your registered Gmail address? Contact Customer Support at Tel: <b>(046) 458-0908</b> or Hotline: <b>101-733 (RED)</b>.' +
    '</div>',
    { showCloseX: true, closeOnBackdrop: true }
  );
}

async function startRecoveryVerification() {
  if (typeof clearFieldError === "function") clearFieldError("recovery-query-input");
  var inp = document.getElementById("recovery-query-input");
  var query = inp ? inp.value.trim() : "";
  if (/^[a-z0-9][a-z0-9._+-]*$/i.test(query)) query = query.toLowerCase() + "@gmail.com";
  if (inp) inp.value = query;
  if (!query) {
    if (typeof setFieldError === "function") setFieldError("recovery-query-input", "Please enter your registered @gmail.com email address.");
    return;
  }
  if (typeof isCustomerGmail === "function" && !isCustomerGmail(query)) {
    if (typeof setFieldError === "function") setFieldError("recovery-query-input", "Please enter a valid @gmail.com email address.");
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

    var emailRes = await apiSendOtpEmail(
      info.email,
      info.code,
      "recover your " + _recoveryState.tab,
      info.fullName,
      info.refTag
    );
    renderRecoveryOtpPinModal(emailRes);
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Continue";
    }
    if (typeof setFieldError === "function") setFieldError("recovery-query-input", err.message || "Could not find a matching account.");
  }
}

function renderRecoveryOtpPinModal(emailRes) {
  var info = _recoveryState.account;
  if (!info) return;
  var sentOk = !(emailRes && emailRes.sent === false);
  var deliveryBanner = sentOk
    ? '<p class="small" style="color:var(--text); line-height:1.5;">We\'ve sent a verification code to your email <b>' + escapeHtml(info.maskedEmail) + '</b></p>'
    : '<p class="small" style="color:#dc2626; line-height:1.5;"><b>Delivery notice:</b> ' + escapeHtml((emailRes && emailRes.reason) || "Could not send email right now. Click Resend OTP below.") + '</p>';

  openPopup(
    '<div class="row between" style="margin-bottom:6px;">' +
      '<h3 style="margin:0;">Verification Code</h3>' +
      '<button type="button" class="btn btn-small" onclick="stopRecoveryCountdown(); renderRecoveryStep1();">&larr; Back</button>' +
    '</div>' +
    deliveryBanner +
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

function handleOtpSquareInput(el, idx) {
  var val = String(el.value || "").replace(/\D/g, "");
  el.value = val ? val.slice(-1) : "";
  if (el.value && idx < 5) {
    var next = document.querySelector('#recovery-otp-squares .otp-sq[data-sq="' + (idx + 1) + '"]');
    if (next) next.focus();
  }
}

function handleOtpSquareKey(ev, idx) {
  if (ev.key === "Backspace" && !ev.target.value && idx > 0) {
    var prev = document.querySelector('#recovery-otp-squares .otp-sq[data-sq="' + (idx - 1) + '"]');
    if (prev) {
      prev.value = "";
      prev.focus();
    }
  }
}

function getEnteredOtpSquaresCode() {
  var boxes = document.querySelectorAll("#recovery-otp-squares .otp-sq");
  var code = "";
  for (var i = 0; i < boxes.length; i++) {
    code += String(boxes[i].value || "").trim();
  }
  return code;
}

function formatTimerMMSS(sec) {
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  return (m < 10 ? "0" + m : String(m)) + ":" + (s < 10 ? "0" + s : String(s));
}

function startRecoveryCountdownTimer() {
  stopRecoveryCountdown();
  var timerBox = document.getElementById("recovery-timer-box");
  if (!timerBox) return;

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

async function resendRecoveryOtpCode() {
  var box = document.getElementById("recovery-timer-box");
  if (box) {
    box.innerHTML = '<span class="muted"><span class="inline-spinner"></span> Sending new OTP...</span>';
  }
  try {
    var info = await dbFindAccountForRecovery(_recoveryState.account.email, _recoveryState.tab);
    _recoveryState.account = info;
    _recoveryState.remainingSec = 300;
    var emailRes = await apiSendOtpEmail(
      info.email,
      info.code,
      "recover your " + _recoveryState.tab,
      info.fullName,
      info.refTag
    );
    renderRecoveryOtpPinModal(emailRes);
  } catch (err) {
    if (box) {
      box.innerHTML = '<a href="#" class="resend-otp-link" onclick="resendRecoveryOtpCode(); return false;">Resend OTP</a>';
    }
  }
}

function verifyRecoveryPinCode() {
  if (typeof clearFieldError === "function") clearFieldError("recovery-otp-msg-anchor");
  var entered = getEnteredOtpSquaresCode();
  var timerBox = document.getElementById("recovery-timer-box");
  if (entered.length < 6) {
    if (timerBox) timerBox.innerHTML = '<div class="field-error" style="text-align:center;">Please enter all 6 digits of your verification code.</div>';
    return;
  }
  var info = _recoveryState.account;
  if (!info) return;

  var check = typeof verifySecuredOtp === "function"
    ? verifySecuredOtp("recovery_" + info.email, entered)
    : { valid: entered === String(info.code) };

  if (!check.valid) {
    if (timerBox) timerBox.innerHTML = '<div class="field-error" style="text-align:center;">' + escapeHtml(check.reason || "The 6-digit verification code is incorrect.") + '</div>';
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
      "</div>",
      { showCloseX: true, closeOnBackdrop: true }
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
    "</div>",
    { showCloseX: true, closeOnBackdrop: true }
  );
}

function fillRecoveredLogin(val) {
  closePopup();
  var emailEl = document.getElementById("email");
  if (emailEl) emailEl.value = val;
}

async function confirmResetPassword() {
  if (typeof clearFieldError === "function") {
    clearFieldError("rec-new-pw");
    clearFieldError("rec-new-pw2");
  }
  var info = _recoveryState.account;
  if (!info) return;
  var pw = document.getElementById("rec-new-pw").value;
  var pw2 = document.getElementById("rec-new-pw2").value;

  if (typeof isStrongPassword === "function" && !isStrongPassword(pw)) {
    if (typeof setFieldError === "function") setFieldError("rec-new-pw", "Password must be at least 8 characters with uppercase, lowercase, number, and special symbol.");
    return;
  }
  if (pw !== pw2) {
    if (typeof setFieldError === "function") setFieldError("rec-new-pw2", "New Password and Confirm Password do not match.");
    return;
  }

  try {
    await dbFinishPasswordReset(info.email, info.code, pw);
    loginAttempts = 0;
    showAlert("Password Updated", "Your password has been updated. You can now sign in with your username or email.", "good");
  } catch (err) {
    if (typeof setFieldError === "function") setFieldError("rec-new-pw", err.message || "Could not update password.");
  }
}
