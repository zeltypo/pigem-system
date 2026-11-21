function dashboardUserLabel(user) {
  var label = { agent: "Agent", manager: "Manager" }[user.role];
  return user.full_name + (label ? " · " + label : "");
}

var dashCurrentUser = null;
var dashSearchApps = [];
var dashOnSelectApp = null;
var dashNotifItems = [];
var _dashSecurityStarted = false;
var _dashSessionTimer = null;
var _dashIdleTimer = null;
var DASH_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
var _dashSessionRedirecting = false;

function confirmDashboardSignOut() {
  if (dashCurrentUser?.role !== "customer") {
    openConfirmPopup("Sign out?", "Are you sure you want to sign out?", "Sign Out",
      function () { return signOutAndGoLogin("", true); }, true);
    return;
  }
  openPopup(
    '<div class="row between"><h2>Sign out?</h2><button type="button" class="btn btn-outline" onclick="closePopup()">Cancel</button></div>' +
    '<p class="mt muted">You can sign in again to view your applications.</p>' +
    '<div class="row mt" style="justify-content:flex-end"><button type="button" class="btn btn-red" onclick="signOutAndGoLogin(&quot;&quot;, true)">Sign Out</button></div>',
    { closeOnBackdrop: true, closeOnEscape: true }
  );
}

function startDashSecurityWatchers() {
  if (_dashSecurityStarted || !dashCurrentUser) return;
  _dashSecurityStarted = true;
  if (dashCurrentUser.role !== "customer") {
    var session = getActiveSessionPair();
    var activityKey = "pigem_activity_" + (session.tok || dashCurrentUser.id);
    var lastActivity = Date.now();
    var lastSaved = 0;

    function touchActivity() {
      lastActivity = Date.now();
      if (lastActivity - lastSaved >= 10000) {
        lastSaved = lastActivity;
        try { localStorage.setItem(activityKey, String(lastSaved)); } catch (error) {}
      }
    }

    touchActivity();
    ["pointerdown", "keydown", "scroll", "touchstart"].forEach(function (event) {
      window.addEventListener(event, touchActivity, { passive: true });
    });

    _dashIdleTimer = setInterval(function () {
      if (_dashSessionRedirecting) return;
      var sharedActivity = 0;
      try { sharedActivity = Number(localStorage.getItem(activityKey)) || 0; } catch (error) {}
      if (Date.now() - Math.max(lastActivity, sharedActivity) < DASH_IDLE_TIMEOUT_MS) return;
      _dashSessionRedirecting = true;
      clearInterval(_dashIdleTimer);
      clearInterval(_dashSessionTimer);
      try { localStorage.removeItem(activityKey); } catch (error) {}
      signOutAndGoLogin("idle", true);
    }, 15000);

  }

  var verifySingleDevice = async function () {
    if (!dashCurrentUser || _dashSessionRedirecting || typeof dbVerifyActiveSession !== "function") return;
    if (dashCurrentUser.role === "customer" && navigator.onLine === false) return;
    try {
      var chk = await dbVerifyActiveSession(dashCurrentUser.id, window.PORTAL_ALLOWED_ROLES || null);
      if (chk && chk.valid === false) {
        _dashSessionRedirecting = true;
        clearInterval(_dashIdleTimer);
        clearInterval(_dashSessionTimer);
        if (chk.reason === "wrong_portal") {
          window.location.replace(chk.redirectUrl || (typeof getLoginPage === "function" ? getLoginPage() : "index.html"));
          return;
        }
        if (chk.reason === "missing") {
          window.location.replace(typeof getLoginPage === "function" ? getLoginPage() : "index.html");
          return;
        }
        if (["other_device", "account_switched", "disabled"].includes(chk.reason)) {
          signOutAndGoLogin(chk.reason, false);
        } else {
          signOutAndGoLogin("", false);
        }
      }
    } catch (e) {}
  };

  _dashSessionTimer = setInterval(verifySingleDevice, 8000);
  window.addEventListener("focus", verifySingleDevice);
  if (dashCurrentUser.role === "customer") window.addEventListener("online", verifySingleDevice);
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
    topNameEl.textContent = dashboardUserLabel(user);
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

var _expandedNotifIndex = -1;

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
        var isExpanded = (_expandedNotifIndex === i);
        h += '<div class="notif-item-clickable' + (isUnread ? ' notif-unread' : '') + '" onclick="onNotificationItemClick(' + i + ', false)">' +
          '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin-bottom:3px;">' +
            '<b style="font-size:13px; color:var(--text);">' + escapeHtml(staffNotificationText(n.title)) + '</b>' +
            (isUnread ? '<span class="notif-unread-dot" title="Unread"></span>' : '<span class="muted" style="font-size:10.5px;">Read</span>') +
          '</div>' +
          '<div style="line-height:1.5; font-size:12.5px; color:var(--muted);' + (isExpanded ? ' white-space:pre-wrap; color:var(--text); margin-top:4px; padding:8px 10px; background:var(--soft); border-radius:6px;' : '') + '">' + autoLinkUrls(staffNotificationText(n.message)) + '</div>' +
          '<div class="muted" style="font-size:11px; margin-top:6px; display:flex; justify-content:space-between; align-items:center; gap:8px;">' +
            '<span>' + formatDate(n.created_at) + '</span>' +
            '<span style="display:inline-flex; gap:10px; align-items:center;">' +
              '<button type="button" class="link-btn" style="font-size:11.5px; font-weight:700;" onclick="event.stopPropagation(); onNotificationItemClick(' + i + ', false)">' + (isExpanded ? 'Hide Details' : 'View') + '</button>' +
              '<button type="button" class="link-btn" style="font-size:11.5px; font-weight:700; color:var(--red);" onclick="event.stopPropagation(); onNotificationItemClick(' + i + ', true)">Go to Record &rarr;</button>' +
            '</span>' +
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

function onNotificationItemClick(index, navigateOut) {
  var item = dashNotifItems[index];
  if (!item) return;

  item.is_read = true;
  if (item.id != null && typeof dbMarkNotificationRead === "function") {
    dbMarkNotificationRead(item.id, dashCurrentUser);
  }
  _expandedNotifIndex = (_expandedNotifIndex === index && !navigateOut) ? -1 : index;
  renderNotifBellState();

  if (!navigateOut) {
    return;
  }

  var m = document.getElementById("notif-modal");
  if (m) m.classList.add("hidden");

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

async function toggleNotifModal() {
  var m = document.getElementById("notif-modal");
  if (!m) return;
  var wasHidden = m.classList.contains("hidden");
  m.classList.toggle("hidden");

  if (wasHidden && dashCurrentUser) await refreshNotifBell(dashCurrentUser);
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
  if (!d) return;
  var box = document.getElementById("profile-drawer-body");
  var activeUser = dashCurrentUser || window.currentCustomer || null;
  if (box && activeUser && box.getAttribute("data-rendered-user") !== String(activeUser.id || activeUser.email || "1")) {
    renderProfileDrawer(activeUser);
  }
  d.classList.toggle("hidden");
}

function renderProfileDrawer(user) {
  var box = document.getElementById("profile-drawer-body");
  if (!box || !user) return;
  box.setAttribute("data-rendered-user", String(user.id || user.email || "1"));
  var savedTheme = readSaved("pigem_theme", "light");
  var avatarHtml = user.avatar_url
    ? '<img src="' + escapeHtml(user.avatar_url) + '" style="width:68px;height:68px;border-radius:999px;object-fit:cover;margin:0 auto 8px;border:2px solid #c8102e" />'
    : '<div class="avatar-btn" style="width:68px;height:68px;font-size:22px;margin:0 auto 8px;cursor:default">' + escapeHtml(getInitials(user.full_name || user.username)) + '</div>';

  var subLine = user.email
    ? (escapeHtml(user.email) + " - " + escapeHtml((user.role || "").toUpperCase()))
    : ("Internal Staff - " + escapeHtml((user.role || "").toUpperCase()));

  var pwSection = '<div style="margin-top:14px; padding-bottom:14px; border-bottom:1px solid var(--line)">' +
        '<div style="font-size:12px; font-weight:700; margin-bottom:8px">Change Password</div>' +
        '<div id="prof-pw-msg" class="msg"></div>' +
        '<div class="field"><label for="prof-pw-current">Current Password</label><input id="prof-pw-current" type="password" autocomplete="current-password" required placeholder="Enter current password" /></div>' +
        '<div class="field"><label for="prof-pw-new">New Password</label><input id="prof-pw-new" type="password" autocomplete="new-password" required data-pw-check="1" placeholder="Strong new password" /></div>' +
        (user.role === "customer" ? '<div class="field"><label for="prof-pw-confirm">Confirm New Password</label><input id="prof-pw-confirm" type="password" autocomplete="new-password" required placeholder="Enter new password again"></div>' : '') +
        '<button type="button" class="btn btn-red btn-sm" style="width:100%" onclick="confirmDirectProfilePassword()">Update Password</button>' +
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
        '<button type="button" data-theme-btn="light" class="btn btn-sm ' + (savedTheme === "light" ? "btn-red" : "btn-outline") + '" onclick="setThemeMode(\'light\')"><img data-img="icons/sun.png" src="https://wuunqfxyejxwrawtjdrf.supabase.co/storage/v1/object/public/website-assets/icons/sun.png" alt="Light" class="icon-img" />Light</button>' +
        '<button type="button" data-theme-btn="dark" class="btn btn-sm ' + (savedTheme === "dark" ? "btn-red" : "btn-outline") + '" onclick="setThemeMode(\'dark\')"><img data-img="icons/moon.png" src="https://wuunqfxyejxwrawtjdrf.supabase.co/storage/v1/object/public/website-assets/icons/moon.png" alt="Dark" class="icon-img" />Dark</button>' +
        '<button type="button" data-theme-btn="device" class="btn btn-sm ' + (savedTheme === "device" ? "btn-red" : "btn-outline") + '" onclick="setThemeMode(\'device\')"><img data-img="icons/monitor.png" src="https://wuunqfxyejxwrawtjdrf.supabase.co/storage/v1/object/public/website-assets/icons/monitor.png" alt="Device" class="icon-img" />Device</button>' +
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
        '<img data-img="icons/link.png" src="https://wuunqfxyejxwrawtjdrf.supabase.co/storage/v1/object/public/website-assets/icons/link.png" alt="" class="icon-img" />Back to Website' +
      '</a>' +
      '<button type="button" class="btn btn-red" style="width:100%" onclick="confirmDashboardSignOut()">Sign Out</button>' +
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
  var newUsername = usernameEl ? usernameEl.value.trim().replace(/^@/, "") : (dashCurrentUser.username || "");
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
    try {
      sessionStorage.setItem("pigem_user_cache", JSON.stringify({ user: dashCurrentUser, ts: Date.now() }));
    } catch (e) {}
    pendingAvatarDataUrl = "";
    renderAvatarBtn(dashCurrentUser);
    renderProfileDrawer(dashCurrentUser);
    var nameLabel = document.getElementById("top-user-name");
    if (nameLabel) nameLabel.textContent = dashboardUserLabel(dashCurrentUser);
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
    clearFieldError("prof-pw-confirm");
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
  var confirmEl = document.getElementById("prof-pw-confirm");
  if (confirmEl && confirmEl.value !== newPw) {
    setFieldError(confirmEl, "Enter the same new password again.");
    confirmEl.focus();
    return;
  }
  try {
    await dbChangeStaffPasswordDirect(dashCurrentUser.id, curPw, newPw);
    if (curEl) curEl.value = "";
    if (newEl) newEl.value = "";
    if (confirmEl) confirmEl.value = "";
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

var _pigemCalendarState = {};

function _getPigemCalendarState(boxId, apps) {
  var now = new Date();
  if (!_pigemCalendarState[boxId]) {
    _pigemCalendarState[boxId] = {
      year: now.getFullYear(),
      month: now.getMonth(),
      selectedDay: now.getDate(),
      reportMode: "monthly",
      showTable: false,
      apps: apps || []
    };
  } else if (apps) {
    _pigemCalendarState[boxId].apps = apps;
  }
  var st = _pigemCalendarState[boxId];
  var maxDay = new Date(st.year, st.month + 1, 0).getDate();
  if (st.selectedDay > maxDay) st.selectedDay = maxDay;
  if (st.selectedDay < 1) st.selectedDay = 1;
  return st;
}

function changePigemCalendarMonth(boxId, delta) {
  var st = _getPigemCalendarState(boxId);
  var nextDate = new Date(st.year, st.month + Number(delta || 0), 1);
  st.year = nextDate.getFullYear();
  st.month = nextDate.getMonth();
  var maxDay = new Date(st.year, st.month + 1, 0).getDate();
  if (st.selectedDay > maxDay) st.selectedDay = maxDay;
  renderCalendar(boxId, st.apps);
}

function setPigemCalendarMonth(boxId, monthVal) {
  var st = _getPigemCalendarState(boxId);
  var m = parseInt(monthVal, 10);
  if (!isNaN(m) && m >= 0 && m <= 11) {
    st.month = m;
    var maxDay = new Date(st.year, st.month + 1, 0).getDate();
    if (st.selectedDay > maxDay) st.selectedDay = maxDay;
    renderCalendar(boxId, st.apps);
  }
}

function setPigemCalendarYear(boxId, yearVal) {
  var st = _getPigemCalendarState(boxId);
  var y = parseInt(yearVal, 10);
  if (!isNaN(y) && y >= 2000 && y <= 2100) {
    st.year = y;
    var maxDay = new Date(st.year, st.month + 1, 0).getDate();
    if (st.selectedDay > maxDay) st.selectedDay = maxDay;
    renderCalendar(boxId, st.apps);
  }
}

function resetPigemCalendarToday(boxId) {
  var st = _getPigemCalendarState(boxId);
  var now = new Date();
  st.year = now.getFullYear();
  st.month = now.getMonth();
  st.selectedDay = now.getDate();
  st.reportMode = "daily";
  renderCalendar(boxId, st.apps);
}

function selectPigemCalendarDay(boxId, dayNum) {
  var st = _getPigemCalendarState(boxId);
  st.selectedDay = Number(dayNum) || 1;
  st.reportMode = "daily";
  renderCalendar(boxId, st.apps);
}

function setPigemCalendarReportMode(boxId, mode) {
  var st = _getPigemCalendarState(boxId);
  if (["daily", "monthly", "yearly"].indexOf(mode) !== -1) {
    st.reportMode = mode;
    renderCalendar(boxId, st.apps);
  }
}

function onPigemCalendarDateInput(boxId, ymd) {
  if (!ymd) return;
  var parts = String(ymd).split("-");
  if (parts.length !== 3) return;
  var st = _getPigemCalendarState(boxId);
  st.year = parseInt(parts[0], 10) || st.year;
  st.month = Math.max(0, Math.min(11, (parseInt(parts[1], 10) || 1) - 1));
  st.selectedDay = parseInt(parts[2], 10) || 1;
  st.reportMode = "daily";
  renderCalendar(boxId, st.apps);
}

function togglePigemCalendarReportTable(boxId) {
  var st = _getPigemCalendarState(boxId);
  st.showTable = !st.showTable;
  renderCalendar(boxId, st.apps);
}

function _buildPigemCalendarReportPayload(boxId) {
  var st = _getPigemCalendarState(boxId);
  var monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var list = Array.isArray(st.apps) ? st.apps : [];
  var mode = st.reportMode || "monthly";
  var ymdStr = st.year + "-" + String(st.month + 1).padStart(2, "0") + "-" + String(st.selectedDay).padStart(2, "0");

  var matched = list.filter(function (a) {
    if (!a || !a.created_at) return false;
    var d = new Date(a.created_at);
    if (isNaN(d.getTime())) return false;
    if (mode === "daily") {
      return d.getFullYear() === st.year && d.getMonth() === st.month && d.getDate() === st.selectedDay;
    }
    if (mode === "monthly") {
      return d.getFullYear() === st.year && d.getMonth() === st.month;
    }
    if (mode === "yearly") {
      return d.getFullYear() === st.year;
    }
    return true;
  });

  var label = mode === "daily"
    ? ("Daily Report — " + monthNames[st.month] + " " + st.selectedDay + ", " + st.year + " (" + ymdStr + ")")
    : (mode === "monthly"
      ? ("Monthly Report — " + monthNames[st.month] + " " + st.year)
      : ("Yearly Report — " + st.year));

  var cntPend = matched.filter(function (a) { return a.status === "Pending Review" || a.status === "Under Agent Review"; }).length;
  var cntEnc  = matched.filter(function (a) { return a.status === "Encoding"; }).length;
  var cntFix  = matched.filter(function (a) { return a.status === "Needs Correction"; }).length;
  var cntApp  = matched.filter(function (a) { return a.status === "Approved" || a.status === "Submitted to Provider" || a.status === "Installed"; }).length;
  var cntRej  = matched.filter(function (a) { return a.status === "Rejected"; }).length;

  var slices = [
    { label: "Pending / Review", value: cntPend, color: "#2563eb" },
    { label: "Encoding", value: cntEnc, color: "#0284c7" },
    { label: "Needs Correction", value: cntFix, color: "#d97706" },
    { label: "Approved", value: cntApp, color: "#15803d" },
    { label: "Rejected", value: cntRej, color: "#dc2626" }
  ];

  var columns = ["Reference No.", "Applicant Name", "Plan", "City", "Assigned Agent", "Status", "Submitted At"];
  var rows = matched.map(function (a) {
    return [
      a.reference_no || a.ref_no || "-",
      a.full_name || "-",
      a.plan_name || "-",
      a.city || "-",
      a.assigned_agent || "Unassigned",
      a.status || "-",
      typeof formatDate === "function" ? formatDate(a.created_at) : (a.created_at || "-")
    ];
  });

  var fileSuffix = mode === "daily"
    ? ymdStr
    : (mode === "monthly" ? (st.year + "-" + String(st.month + 1).padStart(2, "0")) : String(st.year));

  return {
    title: "Calendar Applications Report (" + mode.charAt(0).toUpperCase() + mode.slice(1) + ")",
    timeframeLabel: label,
    mode: mode,
    ymdStr: ymdStr,
    matched: matched,
    counts: { total: matched.length, pending: cntPend, encoding: cntEnc, correction: cntFix, approved: cntApp, rejected: cntRej },
    slices: slices,
    columns: columns,
    rows: rows,
    fileBase: "PIGEM-calendar-" + mode + "-" + fileSuffix
  };
}

function exportPigemCalendarReport(boxId, action) {
  var payload = _buildPigemCalendarReportPayload(boxId);
  if (action === "csv") {
    exportReportToCsv(payload.columns, payload.rows, payload.fileBase + ".csv");
    return;
  }
  if (action === "print") {
    exportDashboardReport(payload.title, payload.timeframeLabel, payload.slices, payload.columns, payload.rows, payload.fileBase + ".pdf", true);
    return;
  }
  exportDashboardReport(payload.title, payload.timeframeLabel, payload.slices, payload.columns, payload.rows, payload.fileBase + ".pdf", false);
}

function renderCalendar(boxId, apps) {
  var box = document.getElementById(boxId);
  if (!box) return;
  var st = _getPigemCalendarState(boxId, apps);
  var now = new Date();
  var year = st.year;
  var month = st.month;
  var monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var firstDay = new Date(year, month, 1).getDay();
  var daysInMonth = new Date(year, month + 1, 0).getDate();

  var byDay = {};
  var list = st.apps || [];
  var minYear = Math.min(2024, now.getFullYear() - 2, year);
  var maxYear = Math.max(now.getFullYear() + 2, year);
  for (var i = 0; i < list.length; i++) {
    var d = new Date(list[i].created_at);
    if (!isNaN(d.getTime())) {
      var dy = d.getFullYear();
      if (dy < minYear) minYear = dy;
      if (dy > maxYear) maxYear = dy;
      if (dy === year && d.getMonth() === month) {
        var dayNum = d.getDate();
        byDay[dayNum] = (byDay[dayNum] || 0) + 1;
      }
    }
  }

  var safeBoxId = escapeHtml(boxId);
  var monthOpts = "";
  for (var m = 0; m < 12; m++) {
    monthOpts += '<option value="' + m + '"' + (m === month ? " selected" : "") + '>' + monthNames[m] + '</option>';
  }
  var yearOpts = "";
  for (var y = minYear; y <= maxYear; y++) {
    yearOpts += '<option value="' + y + '"' + (y === year ? " selected" : "") + '>' + y + '</option>';
  }

  var html =
    '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">' +
      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
        '<button type="button" class="btn btn-outline btn-sm" style="padding:4px 9px;font-weight:700" title="Previous Month" onclick="changePigemCalendarMonth(\'' + safeBoxId + '\', -1)">&larr; Prev</button>' +
        '<select aria-label="Select Month" style="padding:5px 8px;border-radius:8px;border:1px solid var(--line);font-weight:700;background:var(--card);color:var(--text)" onchange="setPigemCalendarMonth(\'' + safeBoxId + '\', this.value)">' + monthOpts + '</select>' +
        '<select aria-label="Select Year" style="padding:5px 8px;border-radius:8px;border:1px solid var(--line);font-weight:700;background:var(--card);color:var(--text)" onchange="setPigemCalendarYear(\'' + safeBoxId + '\', this.value)">' + yearOpts + '</select>' +
        '<button type="button" class="btn btn-outline btn-sm" style="padding:4px 9px;font-weight:700" title="Next Month" onclick="changePigemCalendarMonth(\'' + safeBoxId + '\', 1)">Next &rarr;</button>' +
        '<button type="button" class="btn btn-outline btn-sm" style="padding:4px 9px;font-size:11.5px" onclick="resetPigemCalendarToday(\'' + safeBoxId + '\')">Today</button>' +
      '</div>' +
      '<span class="muted" style="font-size:12px">Today: ' + monthNames[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear() + '</span>' +
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
    var isToday = (year === now.getFullYear() && month === now.getMonth() && day === now.getDate());
    var isSelected = (day === st.selectedDay);
    var count = byDay[day] || 0;
    var selStyle = isSelected
      ? "cursor:pointer;outline:2px solid #c8102e;background:rgba(200,16,46,0.07);"
      : "cursor:pointer;";
    html += '<div class="day' + (isToday ? ' today' : '') + '" style="' + selStyle + '" title="Click to view Daily Report for ' + monthNames[month] + ' ' + day + ', ' + year + '" onclick="selectPigemCalendarDay(\'' + safeBoxId + '\', ' + day + ')">' +
      '<b>' + day + '</b>' +
      (count > 0 ? '<div class="dot">' + count + ' app' + (count > 1 ? 's' : '') + '</div>' : '') +
      '</div>';
  }
  html += '</div>';

  var rep = _buildPigemCalendarReportPayload(boxId);
  var mode = rep.mode;

  html +=
    '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">' +
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
          '<b style="font-size:13px">Calendar Application Report:</b>' +
          '<button type="button" class="btn btn-sm ' + (mode === "daily" ? "btn-red" : "btn-outline") + '" style="padding:3px 10px;font-size:12px" onclick="setPigemCalendarReportMode(\'' + safeBoxId + '\', \'daily\')">Daily</button>' +
          '<button type="button" class="btn btn-sm ' + (mode === "monthly" ? "btn-red" : "btn-outline") + '" style="padding:3px 10px;font-size:12px" onclick="setPigemCalendarReportMode(\'' + safeBoxId + '\', \'monthly\')">Monthly</button>' +
          '<button type="button" class="btn btn-sm ' + (mode === "yearly" ? "btn-red" : "btn-outline") + '" style="padding:3px 10px;font-size:12px" onclick="setPigemCalendarReportMode(\'' + safeBoxId + '\', \'yearly\')">Yearly</button>' +
          (mode === "daily"
            ? '<input type="date" aria-label="Select exact day" value="' + escapeHtml(rep.ymdStr) + '" style="padding:3px 8px;border-radius:6px;border:1px solid var(--line);font-size:12px" onchange="onPigemCalendarDateInput(\'' + safeBoxId + '\', this.value)" />'
            : '') +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
          '<button type="button" class="btn btn-outline btn-sm" style="padding:3px 9px;font-size:11.5px" onclick="togglePigemCalendarReportTable(\'' + safeBoxId + '\')">' + (st.showTable ? "Hide Table" : "View Table (" + rep.counts.total + ")") + '</button>' +
          '<button type="button" class="btn btn-outline btn-sm" style="padding:3px 9px;font-size:11.5px" onclick="exportPigemCalendarReport(\'' + safeBoxId + '\', \'csv\')">Export CSV</button>' +
          '<button type="button" class="btn btn-outline btn-sm" style="padding:3px 9px;font-size:11.5px" onclick="exportPigemCalendarReport(\'' + safeBoxId + '\', \'print\')">Print</button>' +
          '<button type="button" class="btn btn-red btn-sm" style="padding:3px 10px;font-size:11.5px" onclick="exportPigemCalendarReport(\'' + safeBoxId + '\', \'pdf\')">Download PDF Report</button>' +
        '</div>' +
      '</div>' +
      '<div class="small" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border-radius:8px;background:var(--soft);border:1px solid var(--line)">' +
        '<b>' + escapeHtml(rep.timeframeLabel) + ':</b>' +
        '<span class="badge badge-gray">Total: ' + rep.counts.total + '</span>' +
        '<span class="badge badge-blue">Pending/Review: ' + rep.counts.pending + '</span>' +
        '<span class="badge badge-blue">Encoding: ' + rep.counts.encoding + '</span>' +
        '<span class="badge badge-yellow">Needs Correction: ' + rep.counts.correction + '</span>' +
        '<span class="badge badge-green">Approved: ' + rep.counts.approved + '</span>' +
        '<span class="badge badge-red">Rejected: ' + rep.counts.rejected + '</span>' +
      '</div>';

  if (st.showTable) {
    html += '<div class="table-wrap" style="margin-top:8px;max-height:240px;overflow:auto"><table><thead><tr>';
    for (var c = 0; c < rep.columns.length; c++) {
      html += '<th>' + escapeHtml(rep.columns[c]) + '</th>';
    }
    html += '</tr></thead><tbody>';
    if (!rep.rows.length) {
      html += '<tr><td colspan="' + rep.columns.length + '" class="muted" style="text-align:center;padding:12px">No applications recorded for this ' + escapeHtml(mode) + ' period.</td></tr>';
    } else {
      for (var r = 0; r < rep.rows.length; r++) {
        html += '<tr>';
        for (var k = 0; k < rep.rows[r].length; k++) {
          html += '<td>' + (k === 0 ? '<b>' + escapeHtml(rep.rows[r][k]) + '</b>' : escapeHtml(rep.rows[r][k])) + '</td>';
        }
        html += '</tr>';
      }
    }
    html += '</tbody></table></div>';
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
  var safeName = (filename || "PIGEM-report.csv").replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!/\.csv$/i.test(safeName)) safeName += ".csv";
  var csvRows = [(columns || []).map(function (h) { return '"' + String(h || "").replace(/"/g, '""') + '"'; }).join(",")];
  for (var i = 0; i < (rows || []).length; i++) {
    csvRows.push((rows[i] || []).map(function (v) {
      return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    }).join(","));
  }
  var csvContent = "\uFEFF" + csvRows.join("\r\n");
  try {
    if (window.navigator && typeof window.navigator.msSaveOrOpenBlob === "function") {
      var msBlob = new Blob([csvContent], { type: "application/octet-stream" });
      window.navigator.msSaveOrOpenBlob(msBlob, safeName);
      return;
    }
    var blob = new Blob([csvContent], { type: "application/octet-stream" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.style.display = "none";
    link.href = url;
    link.setAttribute("download", safeName);
    link.setAttribute("target", "_self");
    document.body.appendChild(link);
    link.click();
    setTimeout(function () {
      if (link.parentNode) document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 30000);
    if (typeof showAlert === "function") {
      showAlert("CSV Report Downloaded", "Your CSV spreadsheet (<b>" + escapeHtml(safeName) + "</b>) has been generated and downloaded (" + (rows || []).length + " records).", "good");
    }
  } catch (err) {
    var dataUri = "data:application/octet-stream;charset=utf-8," + encodeURIComponent(csvContent);
    var dlLink = document.createElement("a");
    dlLink.href = dataUri;
    dlLink.download = safeName;
    document.body.appendChild(dlLink);
    dlLink.click();
    document.body.removeChild(dlLink);
  }
}

function exportDashboardReport(title, timeframe, slices, columns, rows, filename, print) {
  var metrics = (slices || []).map(function (slice) { return slice.label + " " + slice.value; });
  exportPigemPdf({
    title: title,
    subtitle: (timeframe || "All dates") + " | " + (rows || []).length + " records",
    noteTitle: "Summary", note: metrics.join("  |  "),
    section: "Report details", columns: columns, rows: rows
  }, (filename || "PIGEM-report.pdf").replace(/\.html$/, ".pdf"), print);
}

function printActiveDashboardReport() {
  var data = typeof getAgentReportData === "function" ? getAgentReportData() :
    typeof getMgrReportData === "function" ? getMgrReportData() :
    typeof getActiveReportData === "function" ? getActiveReportData() : null;
  if (data) exportDashboardReport(data.title, data.timeframeLabel, data.pieSlices, data.columns, data.rows, null, true);
}

window.addEventListener("keydown", function (e) {
  if (e.key !== "Escape") return;
  var popBg = document.getElementById("popup-bg");
  if (popBg && popBg.classList.contains("show") && typeof closePopup === "function") {
    closePopup();
    return;
  }
  var agModal = document.getElementById("ag-modal");
  if (agModal && agModal.classList.contains("show") && typeof closeDetailModal === "function") {
    closeDetailModal();
    return;
  }
  var mgrModal = document.getElementById("mgr-modal");
  if (mgrModal && mgrModal.classList.contains("show") && typeof closeMgrModal === "function") {
    closeMgrModal();
    return;
  }
  var notifPanel = document.getElementById("notif-panel");
  if (notifPanel && notifPanel.classList.contains("show") && typeof toggleNotifPanel === "function") {
    toggleNotifPanel();
    return;
  }
  var profDrawer = document.getElementById("prof-drawer");
  if (profDrawer && profDrawer.classList.contains("show") && typeof toggleProfileDrawer === "function") {
    toggleProfileDrawer();
  }
});


function staffNotificationText(value) {
  var text = String(value || "");
  if (dashCurrentUser && ["agent", "manager"].includes(dashCurrentUser.role)) {
    text = text.replace(/\b(OpenAI|OpenCV|Gemini|FastAPI|OCR|API|AI)\b/gi, "document check");
  }
  return text;
}
