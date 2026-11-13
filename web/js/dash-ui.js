var dashCurrentUser = null;
var dashSearchApps = [];
var dashOnSelectApp = null;
var dashNotifItems = [];
var _dashSecurityStarted = false;
var _dashLastActivityAt = Date.now();
var _dashSessionTimer = null;
var _dashIdleTimer = null;
var DASH_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

var _dashSessionRedirecting = false;

function startDashSecurityWatchers() {
  if (_dashSecurityStarted || !dashCurrentUser) return;
  _dashSecurityStarted = true;
  _dashLastActivityAt = Date.now();

  var touchActivity = function () {
    _dashLastActivityAt = Date.now();
  };
  var evs = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];
  for (var i = 0; i < evs.length; i++) {
    window.addEventListener(evs[i], touchActivity, { passive: true });
  }

  _dashIdleTimer = setInterval(function () {
    if (!dashCurrentUser || _dashSessionRedirecting) return;
    if (Date.now() - _dashLastActivityAt >= DASH_IDLE_TIMEOUT_MS) {
      _dashSessionRedirecting = true;
      clearInterval(_dashIdleTimer);
      clearInterval(_dashSessionTimer);
      signOutAndGoLogin("idle", true);
    }
  }, 15000);

  var verifySingleDevice = async function () {
    if (!dashCurrentUser || _dashSessionRedirecting || typeof dbVerifyActiveSession !== "function") return;
    try {
      var chk = await dbVerifyActiveSession(dashCurrentUser.id, window.PORTAL_ALLOWED_ROLES || null);
      if (chk && chk.valid === false) {
        _dashSessionRedirecting = true;
        clearInterval(_dashIdleTimer);
        clearInterval(_dashSessionTimer);
        if (chk.reason === "account_switched" || chk.reason === "wrong_portal") {
          window.location.replace(chk.redirectUrl || (typeof getLoginPage === "function" ? getLoginPage() : "index.html"));
          return;
        }
        if (chk.reason === "missing") {
          window.location.replace(typeof getLoginPage === "function" ? getLoginPage() : "index.html");
          return;
        }
        if (chk.reason === "other_device" || chk.reason === "disabled") {
          signOutAndGoLogin(chk.reason, false);
        } else {
          signOutAndGoLogin("", false);
        }
      }
    } catch (e) {}
  };

  _dashSessionTimer = setInterval(verifySingleDevice, 8000);
  window.addEventListener("focus", verifySingleDevice);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) verifySingleDevice();
  });
}

var _dashNotifTimer = null;

function toggleDashSidebar() {
  document.body.classList.toggle("dash-sidebar-open");
}

function closeDashSidebar() {
  document.body.classList.remove("dash-sidebar-open");
}

function initDashUI(user, apps, onSelectAppCallback) {
  dashCurrentUser = user;
  dashSearchApps = apps || [];
  dashOnSelectApp = onSelectAppCallback || null;

  if (user) {
    try {
      sessionStorage.setItem("pigem_user_cache", JSON.stringify({
        email: user.email || ("@" + (user.username || "")),
        role: user.role
      }));
      if (user.id && typeof SESSION_KEY !== "undefined") {
        var curTok = sessionStorage.getItem(SESSION_TOKEN_KEY) || localStorage.getItem(SESSION_TOKEN_KEY) || user.session_token || "";
        sessionStorage.setItem(SESSION_KEY, user.id);
        if (curTok) sessionStorage.setItem(SESSION_TOKEN_KEY, curTok);
        if (user.role) {
          sessionStorage.setItem(SESSION_KEY + "_role", String(user.role).toLowerCase());
          if (typeof getRoleSessionKey === "function") {
            var rKey = getRoleSessionKey(user.role);
            localStorage.setItem(rKey, user.id);
            if (curTok) localStorage.setItem(rKey + "_tok", curTok);
          }
        }
      }
    } catch (e) {}
  }

  var savedTheme = readSaved("pigem_theme", "light");
  setThemeMode(savedTheme);

  var splash = document.getElementById("splash");
  if (splash) {
    splash.classList.add("hide");
  }

  var topNameEl = document.getElementById("top-user-name");
  if (topNameEl && user && user.full_name) {
    topNameEl.textContent = user.full_name;
  }

  renderAvatarBtn(user);
  renderProfileDrawer(user);
  refreshNotifBell(user);
  updateOverviewOnlyVisibility(true);
  startDashSecurityWatchers();

  if (_dashNotifTimer) clearInterval(_dashNotifTimer);
  _dashNotifTimer = setInterval(function () {
    if (dashCurrentUser && !document.hidden && !_dashSessionRedirecting) {
      refreshNotifBell(dashCurrentUser);
    }
  }, 10000);

  var sideEl = document.querySelector(".dash-side");
  if (sideEl && !sideEl.getAttribute("data-mob-bound")) {
    sideEl.setAttribute("data-mob-bound", "1");
    sideEl.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest("button") : null;
      if (!btn) return;
      var oc = String(btn.getAttribute("onclick") || "");
      if (oc.indexOf("toggleNavGroup") !== -1) return;
      closeDashSidebar();
    });
  }

  document.addEventListener("click", function (e) {
    var sWrap = document.querySelector(".top-search");
    var sDrop = document.getElementById("top-search-results");
    if (sDrop && sWrap && !sWrap.contains(e.target)) {
      sDrop.classList.add("hidden");
    }
  });
}

function updateOverviewOnlyVisibility(isOverview) {
  var notifBtn = document.getElementById("notif-btn");
  if (notifBtn) {
    notifBtn.classList.remove("overview-hidden");
  }
  var avatarBtn = document.getElementById("avatar-btn");
  if (avatarBtn) {
    avatarBtn.classList.remove("overview-hidden");
  }
}

function updateDashSearchApps(apps) {
  dashSearchApps = apps || [];
}

function setThemeMode(mode) {
  writeSaved("pigem_theme", mode);
  var effective = mode;
  if (mode === "device") {
    var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    effective = prefersDark ? "dark" : "light";
  }
  if (effective === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  if (typeof loadPageImages === "function") {
    loadPageImages();
  }

  var btns = document.querySelectorAll("[data-theme-btn]");
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle("btn-red", btns[i].getAttribute("data-theme-btn") === mode);
    btns[i].classList.toggle("btn-outline", btns[i].getAttribute("data-theme-btn") !== mode);
  }
}

function toggleNavGroup(btn) {
  var next = btn.nextElementSibling;
  if (!next) return;
  var isHidden = next.classList.toggle("hidden");
  var arrow = btn.querySelector(".chev");
  if (arrow) arrow.textContent = isHidden ? ">" : "v";
}

function onTopSearchInput(inputEl) {
  var q = (inputEl.value || "").trim().toLowerCase();
  var box = document.getElementById("top-search-results");
  if (!box) return;
  if (!q) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }

  var html = "";

  var navBtns = document.querySelectorAll(".dash-side [data-nav-label]");
  for (var i = 0; i < navBtns.length; i++) {
    var label = navBtns[i].getAttribute("data-nav-label") || "";
    var target = navBtns[i].getAttribute("data-nav-target") || "";
    if (label.toLowerCase().indexOf(q) !== -1) {
      html += '<a href="#" onclick="jumpToNav(\'' + escapeHtml(target) + '\'); return false;">' +
        '<b>Section: ' + escapeHtml(label) + '</b>' +
        '<div class="muted" style="font-size:11px">Jump to dashboard section</div></a>';
    }
  }

  var matched = 0;
  for (var j = 0; j < dashSearchApps.length; j++) {
    if (matched >= 6) break;
    var a = dashSearchApps[j];
    var hay = ((a.reference_no || "") + " " + (a.full_name || "") + " " + (a.email || "") + " " + (a.city || "") + " " + (a.status || "")).toLowerCase();
    if (hay.indexOf(q) !== -1) {
      matched++;
      html += '<a href="#" onclick="jumpToApp(\'' + escapeHtml(a.id) + '\'); return false;">' +
        '<b>' + escapeHtml(a.reference_no) + ' - ' + escapeHtml(a.full_name) + '</b>' +
        '<div class="muted" style="font-size:11px">' + escapeHtml(a.plan_name || "") + ' - ' + escapeHtml(a.status || "") + '</div></a>';
    }
  }

  if (!html) {
    html = '<div class="muted" style="padding:10px 12px; font-size:12px">No matching section or application found.</div>';
  }
  box.innerHTML = html;
  box.classList.remove("hidden");
}

function jumpToNav(target) {
  var box = document.getElementById("top-search-results");
  if (box) box.classList.add("hidden");
  if (typeof window.showTab === "function") {
    window.showTab(target);
  }
}

function jumpToApp(appId) {
  var box = document.getElementById("top-search-results");
  if (box) box.classList.add("hidden");
  if (typeof dashOnSelectApp === "function") {
    dashOnSelectApp(appId);
  }
}

function autoLinkUrls(text) {
  var escaped = escapeHtml(text || "");
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color:var(--red); text-decoration:underline; word-break:break-all;">$1</a>');
}

async function refreshNotifBell(user) {
  if (!user) return;
  var list = await dbListNotifications(user, user.role);
  var localReadMap = (typeof getLocalReadNotifMap === "function") ? getLocalReadNotifMap(user) : {};

  if (user.role === "admin" && typeof checkApiHealth === "function") {
    try {
      var health = await checkApiHealth();
      if (health && Array.isArray(health.services)) {
        for (var hIdx = 0; hIdx < health.services.length; hIdx++) {
          var svc = health.services[hIdx];
          if (svc && !svc.online) {
            var sysNotifId = "sys-api-" + hIdx;
            list.unshift({
              id: sysNotifId,
              title: "API Reminder: " + (svc.name || "Service") + " Not Configured / Offline",
              message: svc.detail || "Review API keys and Vercel environment configuration in the APIs section.",
              target_tab: "tab-apis",
              target_id: svc.name || "",
              is_read: Boolean(localReadMap[sysNotifId]),
              created_at: new Date().toISOString()
            });
          }
        }
      }
    } catch (e) {}
  }

  dashNotifItems = list || [];
  renderNotifBellState();
}

function renderNotifBellState() {
  var countEl = document.getElementById("notif-count");
  var bodyEl = document.getElementById("notif-list");
  var unreadCount = 0;
  for (var u = 0; u < dashNotifItems.length; u++) {
    if (!dashNotifItems[u].is_read) unreadCount++;
  }
  if (countEl) {
    countEl.textContent = unreadCount;
    countEl.classList.toggle("hidden", unreadCount === 0);
  }
  if (bodyEl) {
    if (dashNotifItems.length === 0) {
      bodyEl.innerHTML = '<div class="notif-empty"><p class="muted" style="font-size:13px; text-align:center; padding:18px 8px;">No notifications yet.</p></div>';
    } else {
      var h = "";
      if (unreadCount > 0) {
        h += '<div style="display:flex; justify-content:space-between; align-items:center; padding:0 2px 10px; margin-bottom:6px; border-bottom:1px solid var(--line); font-size:12px;">' +
          '<span class="muted"><b>' + unreadCount + '</b> unread notification' + (unreadCount === 1 ? '' : 's') + '</span>' +
          '<button type="button" class="link-btn" style="font-size:12px;" onclick="markAllDashNotificationsRead()">Mark all as read</button>' +
        '</div>';
      }
      for (var i = 0; i < Math.min(dashNotifItems.length, 20); i++) {
        var n = dashNotifItems[i];
        var isUnread = !n.is_read;
        h += '<div class="notif-item-clickable' + (isUnread ? ' notif-unread' : '') + '" onclick="onNotificationItemClick(' + i + ')">' +
          '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin-bottom:3px;">' +
            '<b style="font-size:13px; color:var(--text);">' + escapeHtml(n.title) + '</b>' +
            (isUnread ? '<span class="notif-unread-dot" title="Unread"></span>' : '') +
          '</div>' +
          '<div style="line-height:1.5; font-size:12.5px; color:var(--muted);">' + autoLinkUrls(n.message) + '</div>' +
          '<div class="muted" style="font-size:11px; margin-top:6px; display:flex; justify-content:space-between; align-items:center;">' +
            '<span>' + formatDate(n.created_at) + '</span>' +
            '<span style="color:var(--red); font-weight:700;">View &rarr;</span>' +
          '</div>' +
          '</div>';
      }
      bodyEl.innerHTML = h;
    }
  }
}

async function markAllDashNotificationsRead() {
  for (var i = 0; i < dashNotifItems.length; i++) {
    dashNotifItems[i].is_read = true;
    if (dashNotifItems[i].id && String(dashNotifItems[i].id).indexOf("sys-api-") === 0 && typeof dbMarkNotificationRead === "function") {
      await dbMarkNotificationRead(dashNotifItems[i].id, dashCurrentUser);
    }
  }
  if (typeof dbMarkAllNotificationsRead === "function") {
    await dbMarkAllNotificationsRead(dashCurrentUser);
  }
  renderNotifBellState();
}

function onNotificationItemClick(index) {
  var item = dashNotifItems[index];
  var m = document.getElementById("notif-modal");
  if (m) m.classList.add("hidden");
  if (!item) return;

  item.is_read = true;
  if (item.id != null && typeof dbMarkNotificationRead === "function") {
    dbMarkNotificationRead(item.id, dashCurrentUser);
  }
  renderNotifBellState();

  var targetTab = item.target_tab || "";
  var targetId = item.target_id || "";
  var titleLow = String(item.title || "").toLowerCase();
  var msgLow = String(item.message || "").toLowerCase();
  var combinedLow = titleLow + " " + msgLow;
  var role = (dashCurrentUser && dashCurrentUser.role) ? String(dashCurrentUser.role).toLowerCase() : "";

  if (!targetId && dashSearchApps && dashSearchApps.length) {
    for (var i = 0; i < dashSearchApps.length; i++) {
      var ref = String(dashSearchApps[i].reference_no || dashSearchApps[i].ref_no || "").toLowerCase();
      if (ref && combinedLow.indexOf(ref) !== -1) {
        targetId = dashSearchApps[i].id;
        break;
      }
    }
  }

  if (!targetTab) {
    if (titleLow.indexOf("password reset") !== -1) {
      targetTab = "tab-accounts";
      if (!targetId) targetId = "reset";
    } else if (titleLow.indexOf("api") !== -1) {
      targetTab = role === "admin" ? "tab-apis" : "tab-overview";
    } else if (titleLow.indexOf("screening") !== -1) {
      if (role === "admin") targetTab = "tab-ai";
      else if (role === "manager") targetTab = "tab-app-all";
      else if (role === "agent") targetTab = "tab-queue";
      else targetTab = "tab-overview";
    } else if (titleLow.indexOf("maintenance") !== -1 || titleLow.indexOf("website") !== -1) {
      if (role === "admin") targetTab = "tab-maintenance";
      else if (role === "manager") targetTab = "tab-cms-banners";
      else targetTab = "tab-overview";
    } else if (targetId || titleLow.indexOf("application") !== -1 || titleLow.indexOf("correction") !== -1 || titleLow.indexOf("update") !== -1) {
      if (role === "agent") targetTab = "tab-queue";
      else if (role === "manager") targetTab = "tab-app-all";
      else if (role === "customer") targetTab = "tab-apps";
    }
  }

  if (targetTab && typeof window.openDashTabById === "function") {
    window.openDashTabById(targetTab, targetId);
    return;
  }
  if (targetTab) {
    var navBtn = document.querySelector('[data-tab="' + targetTab + '"], [data-nav-target="' + String(targetTab).replace(/^tab-/, "") + '"]');
    if (navBtn) {
      navBtn.click();
    }
  }
  if (targetId && typeof dashOnSelectApp === "function") {
    dashOnSelectApp(targetId);
  }
}

function toggleNotifModal() {
  var m = document.getElementById("notif-modal");
  if (m) m.classList.toggle("hidden");
}

function getInitials(name) {
  var parts = String(name || "U").trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return String(name || "U").slice(0, 2).toUpperCase();
}

function renderAvatarBtn(user) {
  var btn = document.getElementById("avatar-btn");
  if (!btn || !user) return;
  if (user.avatar_url) {
    btn.innerHTML = '<img src="' + escapeHtml(user.avatar_url) + '" alt="Profile" />';
  } else {
    btn.textContent = getInitials(user.full_name || user.username || user.email || "U");
  }
}

function toggleProfileDrawer() {
  var d = document.getElementById("profile-drawer");
  if (d) d.classList.toggle("hidden");
}

function renderProfileDrawer(user) {
  var box = document.getElementById("profile-drawer-body");
  if (!box || !user) return;
  var savedTheme = readSaved("pigem_theme", "light");
  var avatarHtml = user.avatar_url
    ? '<img src="' + escapeHtml(user.avatar_url) + '" style="width:68px;height:68px;border-radius:999px;object-fit:cover;margin:0 auto 8px;border:2px solid #c8102e" />'
    : '<div class="avatar-btn" style="width:68px;height:68px;font-size:22px;margin:0 auto 8px;cursor:default">' + escapeHtml(getInitials(user.full_name || user.username)) + '</div>';

  var subLine = user.email
    ? (escapeHtml(user.email) + " - " + escapeHtml((user.role || "").toUpperCase()))
    : ("Internal Staff - " + escapeHtml((user.role || "").toUpperCase()));

  var pwSection = (!user.email || user.role !== "customer")
    ? '<div style="margin-top:14px; padding-bottom:14px; border-bottom:1px solid var(--line)">' +
        '<div style="font-size:12px; font-weight:700; margin-bottom:8px">Change Password</div>' +
        '<div id="prof-pw-msg" class="msg"></div>' +
        '<div class="field"><label>Current Password</label><input id="prof-pw-current" type="password" placeholder="Enter current password" /></div>' +
        '<div class="field"><label>New Password</label><input id="prof-pw-new" type="password" data-pw-check="1" placeholder="Strong new password" /></div>' +
        '<button type="button" class="btn btn-red btn-sm" style="width:100%" onclick="confirmDirectProfilePassword()">Update Password</button>' +
      '</div>'
    : '<div style="margin-top:14px; padding-bottom:14px; border-bottom:1px solid var(--line)">' +
        '<div style="font-size:12px; font-weight:700; margin-bottom:8px">Change Password (OTP Verification)</div>' +
        '<div id="prof-pw-msg" class="msg"></div>' +
        '<button type="button" class="btn btn-outline btn-sm" style="width:100%" onclick="sendProfilePwOtp()">Send 6-Digit Code to ' + escapeHtml(user.email) + '</button>' +
        '<div id="prof-pw-step2" class="hidden" style="margin-top:10px">' +
          '<div class="field"><label>6-Digit Code</label><input id="prof-pw-code" type="text" maxlength="6" /></div>' +
          '<div class="field"><label>New Password</label><input id="prof-pw-new" type="password" data-pw-check="1" /></div>' +
          '<button type="button" class="btn btn-red btn-sm" style="width:100%" onclick="confirmProfilePwOtp()">Update Password</button>' +
        '</div>' +
      '</div>';

  box.innerHTML =
    '<div style="text-align:center; padding-bottom:14px; border-bottom:1px solid var(--line)">' +
      avatarHtml +
      '<div style="font-weight:800; font-size:16px">' + escapeHtml(user.full_name) + '</div>' +
      (user.username ? '<div style="font-size:12.5px; font-weight:700; color:var(--red); margin-top:2px">@' + escapeHtml(user.username) + '</div>' : '') +
      '<div class="muted" style="font-size:12px">' + subLine + '</div>' +
      (user.intro ? '<div style="font-size:12px; margin-top:6px; font-style:italic">"' + escapeHtml(user.intro) + '"</div>' : '') +
    '</div>' +

    '<div style="margin-top:14px; padding-bottom:14px; border-bottom:1px solid var(--line)">' +
      '<div style="font-size:12px; font-weight:700; margin-bottom:8px">Appearance / Theme</div>' +
      '<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px">' +
        '<button type="button" data-theme-btn="light" class="btn btn-sm ' + (savedTheme === "light" ? "btn-red" : "btn-outline") + '" onclick="setThemeMode(\'light\')"><img data-img="icons/sun.png" src="https://wuunqfxyejxwrawtjdrf.supabase.co/storage/v1/object/public/website-assets/icons/sun.png" alt="Light (not available)" class="icon-img" />Light</button>' +
        '<button type="button" data-theme-btn="dark" class="btn btn-sm ' + (savedTheme === "dark" ? "btn-red" : "btn-outline") + '" onclick="setThemeMode(\'dark\')"><img data-img="icons/moon.png" src="https://wuunqfxyejxwrawtjdrf.supabase.co/storage/v1/object/public/website-assets/icons/moon.png" alt="Dark (not available)" class="icon-img" />Dark</button>' +
        '<button type="button" data-theme-btn="device" class="btn btn-sm ' + (savedTheme === "device" ? "btn-red" : "btn-outline") + '" onclick="setThemeMode(\'device\')"><img data-img="icons/monitor.png" src="https://wuunqfxyejxwrawtjdrf.supabase.co/storage/v1/object/public/website-assets/icons/monitor.png" alt="Device (not available)" class="icon-img" />Device</button>' +
      '</div>' +
    '</div>' +

    '<div style="margin-top:14px; padding-bottom:14px; border-bottom:1px solid var(--line)">' +
      '<div style="font-size:12px; font-weight:700; margin-bottom:8px">Edit Profile</div>' +
      '<div id="prof-msg" class="msg"></div>' +
      '<div class="field"><label>Display Name</label><input id="prof-name" type="text" value="' + escapeHtml(user.full_name || "") + '" /></div>' +
      '<div class="field"><label>Username</label><input id="prof-username" type="text" minlength="3" maxlength="30" value="' + escapeHtml(user.username || "") + '" placeholder="username" /></div>' +
      '<div class="field"><label>' + (user.role === "customer" ? "Short Bio" : "Short Bio / Role Note") + '</label><input id="prof-intro" type="text" value="' + escapeHtml(user.intro || "") + '" placeholder="' + (user.role === "customer" ? "Add a short bio or note" : "e.g. Senior Fiber Verification Agent") + '" /></div>' +
      '<div class="field"><label>Profile Photo</label><input id="prof-photo" type="file" accept="image/*" onchange="onProfilePhotoPick(this)" /></div>' +
      '<button type="button" class="btn btn-dark btn-sm" style="width:100%" onclick="saveProfileChanges()">Save Profile</button>' +
    '</div>' +

    pwSection +

    '<div style="margin-top:16px">' +
      '<a href="index.html" target="_blank" rel="noopener" class="btn btn-outline" style="width:100%; margin-bottom:8px; display:inline-flex; align-items:center; justify-content:center;">' +
        '<img data-img="icons/link.png" src="https://wuunqfxyejxwrawtjdrf.supabase.co/storage/v1/object/public/website-assets/icons/link.png" alt="" class="icon-img" />Open Main Website' +
      '</a>' +
      '<button type="button" class="btn btn-red" style="width:100%" onclick="signOutAndGoLogin(\'\', true)">Sign Out</button>' +
    '</div>';
  if (typeof initPasswordEyeToggles === "function") initPasswordEyeToggles(box);
}

var pendingAvatarDataUrl = "";

function onProfilePhotoPick(inputEl) {
  var file = inputEl.files && inputEl.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () {
    pendingAvatarDataUrl = reader.result;
  };
  reader.readAsDataURL(file);
}

async function saveProfileChanges() {
  if (!dashCurrentUser) return;
  hideMsg("prof-msg");
  var newName = document.getElementById("prof-name").value.trim() || dashCurrentUser.full_name;
  var usernameEl = document.getElementById("prof-username");
  var newUsername = usernameEl ? usernameEl.value.trim().toLowerCase() : (dashCurrentUser.username || "");
  var newIntro = document.getElementById("prof-intro").value.trim();

  var changes = {
    full_name: newName,
    intro: newIntro
  };
  if (newUsername) {
    changes.username = newUsername;
  }
  if (pendingAvatarDataUrl) {
    changes.avatar_url = pendingAvatarDataUrl;
  }

  try {
    var updated = (typeof dbUpdateMyProfile === "function")
      ? await dbUpdateMyProfile(dashCurrentUser.id, changes)
      : null;
    dashCurrentUser = Object.assign({}, dashCurrentUser, changes, updated || {});
    pendingAvatarDataUrl = "";
    renderAvatarBtn(dashCurrentUser);
    renderProfileDrawer(dashCurrentUser);
    var nameLabel = document.getElementById("top-user-name");
    if (nameLabel) nameLabel.textContent = dashCurrentUser.full_name;
    showMsg("prof-msg", "ok", "Profile updated!");
  } catch (err) {
    showMsg("prof-msg", "error", err.message || "Could not update profile.");
  }
}

async function sendProfilePwOtp() {
  if (!dashCurrentUser) return;
  try {
    var code = await dbStartPasswordReset(dashCurrentUser.email);
    await apiSendOtpEmail(dashCurrentUser.email, code, "Password Change Verification");
    document.getElementById("prof-pw-step2").classList.remove("hidden");
    showMsg("prof-pw-msg", "info", "Verification code sent to your email. Please check your inbox or spam folder.");
  } catch (err) {
    showMsg("prof-pw-msg", "error", err.message);
  }
}

async function confirmDirectProfilePassword() {
  if (!dashCurrentUser) return;
  hideMsg("prof-pw-msg");
  if (typeof clearFieldError === "function") {
    clearFieldError("prof-pw-current");
    clearFieldError("prof-pw-new");
  }
  var curEl = document.getElementById("prof-pw-current");
  var newEl = document.getElementById("prof-pw-new");
  var curPw = curEl ? curEl.value : "";
  var newPw = newEl ? newEl.value : "";
  if (!curPw) {
    if (typeof setFieldError === "function") setFieldError("prof-pw-current", "Please enter your current password.");
    else showMsg("prof-pw-msg", "error", "Please enter your current password.");
    return;
  }
  if (typeof isStrongPassword === "function" && !isStrongPassword(newPw)) {
    if (typeof setFieldError === "function") setFieldError("prof-pw-new", "Password must be at least 8 characters with uppercase, lowercase, number, and special symbol.");
    else showMsg("prof-pw-msg", "error", "New password must be at least 8 characters with uppercase, lowercase, number, and special symbol.");
    return;
  }
  try {
    await dbChangeStaffPasswordDirect(dashCurrentUser.id, curPw, newPw);
    if (curEl) curEl.value = "";
    if (newEl) newEl.value = "";
    showMsg("prof-pw-msg", "ok", "Password updated successfully.");
  } catch (err) {
    var errMsg = err.message || "Could not update password.";
    if (typeof setFieldError === "function" && errMsg.toLowerCase().indexOf("current password") !== -1) {
      setFieldError("prof-pw-current", errMsg);
    } else if (typeof setFieldError === "function" && errMsg.toLowerCase().indexOf("reuse") !== -1) {
      setFieldError("prof-pw-new", errMsg);
    } else {
      showMsg("prof-pw-msg", "error", errMsg);
    }
  }
}

async function confirmProfilePwOtp() {
  if (!dashCurrentUser) return;
  hideMsg("prof-pw-msg");
  if (typeof clearFieldError === "function") {
    clearFieldError("prof-pw-code");
    clearFieldError("prof-pw-new");
  }
  var code = document.getElementById("prof-pw-code").value.trim();
  var newPw = document.getElementById("prof-pw-new").value;
  if (!code || code.length < 6) {
    if (typeof setFieldError === "function") setFieldError("prof-pw-code", "Please enter the 6-digit verification code.");
    return;
  }
  if (typeof isStrongPassword === "function" && !isStrongPassword(newPw)) {
    if (typeof setFieldError === "function") setFieldError("prof-pw-new", "Password must be at least 8 characters with uppercase, lowercase, number, and special symbol.");
    else showMsg("prof-pw-msg", "error", "Password must be at least 8 characters with uppercase, lowercase, number, and special symbol.");
    return;
  }
  try {
    await dbFinishPasswordReset(dashCurrentUser.email, code, newPw);
    document.getElementById("prof-pw-step2").classList.add("hidden");
    showMsg("prof-pw-msg", "ok", "Password updated!");
  } catch (err) {
    var msg = err.message || "Could not update password.";
    if (typeof setFieldError === "function" && msg.toLowerCase().indexOf("code") !== -1) {
      setFieldError("prof-pw-code", msg);
    } else if (typeof setFieldError === "function" && msg.toLowerCase().indexOf("reuse") !== -1) {
      setFieldError("prof-pw-new", msg);
    } else {
      showMsg("prof-pw-msg", "error", msg);
    }
  }
}

function renderPieChart(boxId, slices, centerTitle) {
  var box = document.getElementById(boxId);
  if (!box) return;
  var list = (slices || []).filter(function (s) { return Number(s.value || 0) > 0; });
  var total = 0;
  for (var i = 0; i < (slices || []).length; i++) {
    total += Number(slices[i].value || 0);
  }
  var r = 56;
  var c = 2 * Math.PI * r;
  var circlesHtml = "";
  var offset = 0;

  if (total <= 0) {
    circlesHtml = '<circle cx="78" cy="78" r="' + r + '" fill="none" stroke="#e4e7ec" stroke-width="22"></circle>';
  } else {
    for (var j = 0; j < list.length; j++) {
      var val = Number(list[j].value || 0);
      var dash = (val / total) * c;
      circlesHtml += '<circle cx="78" cy="78" r="' + r + '" fill="none" stroke="' + (list[j].color || "#c8102e") + '" stroke-width="22" ' +
        'stroke-dasharray="' + dash.toFixed(2) + " " + c.toFixed(2) + '" stroke-dashoffset="-' + offset.toFixed(2) + '" ' +
        'transform="rotate(-90 78 78)"></circle>';
      offset += dash;
    }
  }

  var legendHtml = "";
  for (var k = 0; k < (slices || []).length; k++) {
    var sl = slices[k];
    var cnt = Number(sl.value || 0);
    var pct = total > 0 ? Math.round((cnt / total) * 100) : 0;
    legendHtml +=
      '<div class="pie-legend-row">' +
        '<div style="display:flex;align-items:center;gap:8px;min-width:0;">' +
          '<span class="pie-dot" style="background:' + (sl.color || "#c8102e") + ';"></span>' +
          '<span>' + escapeHtml(sl.label) + '</span>' +
        '</div>' +
        '<b>' + cnt + ' <span class="muted" style="font-weight:500;">(' + pct + '%)</span></b>' +
      '</div>';
  }

  box.innerHTML =
    '<div class="pie-wrap">' +
      '<div class="pie-svg-box">' +
        '<svg viewBox="0 0 156 156" width="156" height="156">' + circlesHtml + '</svg>' +
        '<div class="pie-center-label"><b>' + total + '</b><span>' + escapeHtml(centerTitle || "Total") + '</span></div>' +
      '</div>' +
      '<div class="pie-legend">' + legendHtml + '</div>' +
    '</div>';
}

function renderBars(boxId, rows) {
  var box = document.getElementById(boxId);
  if (!box) return;
  var maxVal = 1;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].value > maxVal) maxVal = rows[i].value;
  }
  var html = '<div class="bars">';
  for (var j = 0; j < rows.length; j++) {
    var r = rows[j];
    var pct = Math.round((r.value / maxVal) * 100);
    html += '<div class="bar-row">' +
      '<span>' + escapeHtml(r.label) + '</span>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%; background:' + (r.color || "#c8102e") + '"></div></div>' +
      '<b>' + r.value + '</b>' +
      '</div>';
  }
  html += '</div>';
  box.innerHTML = html;
}

function renderColumns(boxId, cols) {
  var box = document.getElementById(boxId);
  if (!box) return;
  var maxVal = 1;
  for (var i = 0; i < cols.length; i++) {
    if (cols[i].value > maxVal) maxVal = cols[i].value;
  }
  var html = '<div class="columns">';
  for (var j = 0; j < cols.length; j++) {
    var c = cols[j];
    var pct = Math.max(6, Math.round((c.value / maxVal) * 100));
    html += '<div class="col">' +
      '<b>' + c.value + '</b>' +
      '<div class="col-bar" style="height:' + pct + '%; background:' + (c.color || "#c8102e") + '"></div>' +
      '<span>' + escapeHtml(c.label) + '</span>' +
      '</div>';
  }
  html += '</div>';
  box.innerHTML = html;
}

function renderCalendar(boxId, apps) {
  var box = document.getElementById(boxId);
  if (!box) return;
  var now = new Date();
  var year = now.getFullYear();
  var month = now.getMonth();
  var monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var firstDay = new Date(year, month, 1).getDay();
  var daysInMonth = new Date(year, month + 1, 0).getDate();

  var byDay = {};
  var list = apps || [];
  for (var i = 0; i < list.length; i++) {
    var d = new Date(list[i].created_at);
    if (!isNaN(d.getTime()) && d.getFullYear() === year && d.getMonth() === month) {
      var dayNum = d.getDate();
      byDay[dayNum] = (byDay[dayNum] || 0) + 1;
    }
  }

  var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
    '<b>' + monthNames[month] + ' ' + year + '</b>' +
    '<span class="muted" style="font-size:12px">Today: ' + monthNames[month] + ' ' + now.getDate() + '</span>' +
    '</div>';

  html += '<div class="calendar">';
  var dows = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  for (var w = 0; w < 7; w++) {
    html += '<div class="dow">' + dows[w] + '</div>';
  }
  for (var blank = 0; blank < firstDay; blank++) {
    html += '<div class="day" style="opacity:0.35"></div>';
  }
  for (var day = 1; day <= daysInMonth; day++) {
    var isToday = day === now.getDate();
    var count = byDay[day] || 0;
    html += '<div class="day' + (isToday ? ' today' : '') + '">' +
      '<b>' + day + '</b>' +
      (count > 0 ? '<div class="dot">' + count + ' app' + (count > 1 ? 's' : '') + '</div>' : '') +
      '</div>';
  }
  html += '</div>';
  box.innerHTML = html;
}

window.addEventListener("DOMContentLoaded", function () {
  var splash = document.getElementById("splash");
  if (splash) {
    setTimeout(function () {
      splash.classList.add("hide");
    }, 250);
  }
});

function getLocalTodayIso() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function getLocalMonthIso() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function getReportTimeframeLabel(tfMode, exactDate, monthStr) {
  if (tfMode === "daily") return "Daily (" + (exactDate || getLocalTodayIso()) + ")";
  if (tfMode === "monthly") return "Monthly (" + (monthStr || getLocalMonthIso()) + ")";
  return "All Time";
}

function matchesReportTimeframeValue(isoStr, tfMode, exactDate, monthStr) {
  if (tfMode === "all") return true;
  if (!isoStr) return false;
  var d = new Date(isoStr);
  if (isNaN(d.getTime())) return false;
  var localYmd = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  if (tfMode === "daily") return localYmd === (exactDate || getLocalTodayIso());
  if (tfMode === "monthly") return localYmd.slice(0, 7) === (monthStr || getLocalMonthIso());
  return true;
}

function renderDashReportView(opts) {
  var data = opts.data || {};
  var sumEl = document.getElementById(opts.summaryId);
  if (sumEl) {
    sumEl.innerHTML = "<b>" + escapeHtml(data.title || "Report") + "</b> &mdash; Timeframe: <b>" +
      escapeHtml(data.timeframeLabel || "All Time") + "</b> &bull; Total Matching Records: <b>" +
      ((data.rows || []).length) + "</b>" +
      (opts.actorLabel ? (" &bull; Generated by <b>" + escapeHtml(opts.actorLabel) + "</b>") : "");
  }

  var pTitle = document.getElementById(opts.pieTitleId);
  var bTitle = document.getElementById(opts.barTitleId);
  if (pTitle) pTitle.textContent = data.pieTitle || "Distribution";
  if (bTitle) bTitle.textContent = data.barTitle || "Breakdown";

  renderPieChart(opts.pieBoxId, data.pieSlices || [], data.pieCenter || "Total");
  renderBars(opts.barBoxId, data.barRows || []);

  var wrap = document.getElementById(opts.tableWrapId);
  if (!wrap) return;
  var cols = data.columns || [];
  var rows = data.rows || [];
  var badges = data.badges || [];
  var badgeCol = typeof opts.badgeColIdx === "number" ? opts.badgeColIdx : -1;

  var th = "<thead><tr>";
  for (var c = 0; c < cols.length; c++) {
    th += "<th>" + escapeHtml(cols[c]) + "</th>";
  }
  th += "</tr></thead>";

  var tb = "<tbody>";
  if (rows.length === 0) {
    tb += '<tr><td colspan="' + Math.max(1, cols.length) + '" class="muted">No records found for this date/filter combination.</td></tr>';
  } else {
    for (var r = 0; r < rows.length; r++) {
      tb += "<tr>";
      for (var k = 0; k < rows[r].length; k++) {
        var val = rows[r][k];
        if (k === badgeCol && badges[r]) {
          tb += '<td><span class="badge ' + badges[r] + '">' + escapeHtml(val) + '</span></td>';
        } else if (k === 0) {
          tb += '<td><b>' + escapeHtml(val) + '</b></td>';
        } else {
          tb += '<td>' + escapeHtml(val) + '</td>';
        }
      }
      tb += "</tr>";
    }
  }
  tb += "</tbody>";
  wrap.innerHTML = "<table>" + th + tb + "</table>";
}

function exportReportToCsv(columns, rows, filename) {
  var csvRows = [(columns || []).map(function (h) { return '"' + String(h || "").replace(/"/g, '""') + '"'; }).join(",")];
  for (var i = 0; i < (rows || []).length; i++) {
    csvRows.push(rows[i].map(function (v) {
      return '"' + String(v || "").replace(/"/g, '""') + '"';
    }).join(","));
  }
  var blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  var url = URL.createObjectURL(blob);
  var link = document.createElement("a");
  link.href = url;
  link.download = filename || "PIGEM-report.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function downloadFormattedHtmlReport(title, timeframeLabel, pieSlices, columns, rows, filename) {
  var cols = columns || [];
  var dataRows = rows || [];
  var rowsHtml = "";
  for (var i = 0; i < dataRows.length; i++) {
    rowsHtml += "<tr>" + dataRows[i].map(function (cell) {
      return "<td style='padding:8px;border:1px solid #d0d5dd;'>" + escapeHtml(cell) + "</td>";
    }).join("") + "</tr>";
  }
  var summaryMetrics = (pieSlices || []).map(function (s) {
    return "<li style='margin-bottom:4px;'><b>" + escapeHtml(s.label) + ":</b> " + s.value + "</li>";
  }).join("");

  var htmlDoc =
    "<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'><title>" + escapeHtml(title || "Report") + "</title></head>" +
    "<body style='font-family:Arial,sans-serif;padding:28px;color:#111827;'>" +
      "<h1 style='margin:0;color:#c8102e;'>PIGEM COMBINED FACILITIES SUPPORT SERVICES</h1>" +
      "<h2 style='margin:6px 0 12px;'>" + escapeHtml(title || "Operational Report") + "</h2>" +
      "<p style='font-size:13px;color:#475467;'>Timeframe: <b>" + escapeHtml(timeframeLabel || "All Time") + "</b> | Total Records: <b>" + dataRows.length + "</b> | Generated: " + escapeHtml(new Date().toLocaleString()) + "</p>" +
      "<ul style='font-size:13px;background:#f8fafc;padding:12px 24px;border:1px solid #e4e7ec;border-radius:8px;'>" + summaryMetrics + "</ul>" +
      "<table style='width:100%;border-collapse:collapse;font-size:12.5px;margin-top:16px;'>" +
        "<thead><tr>" + cols.map(function (c) { return "<th style='padding:8px;border:1px solid #d0d5dd;background:#f1f5f9;text-align:left;'>" + escapeHtml(c) + "</th>"; }).join("") + "</tr></thead>" +
        "<tbody>" + (rowsHtml || "<tr><td colspan='" + Math.max(1, cols.length) + "' style='padding:10px;border:1px solid #d0d5dd;'>No records found.</td></tr>") + "</tbody>" +
      "</table>" +
    "</body></html>";

  var blob = new Blob([htmlDoc], { type: "text/html;charset=utf-8;" });
  var url = URL.createObjectURL(blob);
  var link = document.createElement("a");
  link.href = url;
  link.download = filename || "PIGEM-summary-report.html";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
