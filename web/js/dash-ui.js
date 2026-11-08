var dashCurrentUser = null;
var dashSearchApps = [];
var dashOnSelectApp = null;

function initDashUI(user, apps, onSelectAppCallback) {
  dashCurrentUser = user;
  dashSearchApps = apps || [];
  dashOnSelectApp = onSelectAppCallback || null;

  if (user && user.email) {
    try {
      sessionStorage.setItem("pigem_user_cache", JSON.stringify({ email: user.email, role: user.role }));
    } catch (e) {}
  }

  var savedTheme = readSaved("pigem_theme", "light");
  setThemeMode(savedTheme);

  var splash = document.getElementById("splash");
  if (splash) {
    setTimeout(function () {
      splash.classList.add("hide");
      if (user && user.role && typeof startDashboardTour === "function") {
        setTimeout(function () { startDashboardTour(user.role, false); }, 350);
      }
    }, 1200);
  } else if (user && user.role && typeof startDashboardTour === "function") {
    setTimeout(function () { startDashboardTour(user.role, false); }, 500);
  }

  renderAvatarBtn(user);
  renderProfileDrawer(user);
  refreshNotifBell(user);

  document.addEventListener("click", function (e) {
    var sWrap = document.querySelector(".top-search");
    var sDrop = document.getElementById("top-search-results");
    if (sDrop && sWrap && !sWrap.contains(e.target)) {
      sDrop.classList.add("hidden");
    }
  });
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
  var list = await dbListNotifications(user.email, user.role);
  var countEl = document.getElementById("notif-count");
  var bodyEl = document.getElementById("notif-list");
  if (countEl) {
    countEl.textContent = list.length;
    countEl.classList.toggle("hidden", list.length === 0);
  }
  if (bodyEl) {
    if (list.length === 0) {
      bodyEl.innerHTML = '<p class="muted" style="font-size:13px">No notifications yet.</p>';
    } else {
      var h = "";
      for (var i = 0; i < Math.min(list.length, 12); i++) {
        var n = list[i];
        h += '<div style="padding:10px 0; border-bottom:1px solid var(--line); font-size:12px">' +
          '<b style="display:block; margin-bottom:3px;">' + escapeHtml(n.title) + '</b>' +
          '<div style="line-height:1.5;">' + autoLinkUrls(n.message) + '</div>' +
          '<div class="muted" style="font-size:11px; margin-top:4px">' + formatDate(n.created_at) + '</div>' +
          '</div>';
      }
      bodyEl.innerHTML = h;
    }
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
    btn.textContent = getInitials(user.full_name || user.email);
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
    : '<div class="avatar-btn" style="width:68px;height:68px;font-size:22px;margin:0 auto 8px;cursor:default">' + escapeHtml(getInitials(user.full_name)) + '</div>';

  box.innerHTML =
    '<div style="text-align:center; padding-bottom:14px; border-bottom:1px solid var(--line)">' +
      avatarHtml +
      '<div style="font-weight:800; font-size:16px">' + escapeHtml(user.full_name) + '</div>' +
      (user.username ? '<div style="font-size:12.5px; font-weight:700; color:var(--red); margin-top:2px">@' + escapeHtml(user.username) + '</div>' : '') +
      '<div class="muted" style="font-size:12px">' + escapeHtml(user.email) + ' - ' + escapeHtml((user.role || "").toUpperCase()) + '</div>' +
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

    '<div style="margin-top:14px; padding-bottom:14px; border-bottom:1px solid var(--line)">' +
      '<div style="font-size:12px; font-weight:700; margin-bottom:8px">Change Password (OTP Verification)</div>' +
      '<div id="prof-pw-msg" class="msg"></div>' +
      '<button type="button" class="btn btn-outline btn-sm" style="width:100%" onclick="sendProfilePwOtp()">Send 6-Digit Code to ' + escapeHtml(user.email) + '</button>' +
      '<div id="prof-pw-step2" class="hidden" style="margin-top:10px">' +
        '<div class="field"><label>6-Digit Code</label><input id="prof-pw-code" type="text" maxlength="6" /></div>' +
        '<div class="field"><label>New Password</label><input id="prof-pw-new" type="password" data-pw-check="1" /></div>' +
        '<button type="button" class="btn btn-red btn-sm" style="width:100%" onclick="confirmProfilePwOtp()">Update Password</button>' +
      '</div>' +
    '</div>' +

    '<div style="margin-top:16px">' +
      '<button type="button" class="btn btn-red" style="width:100%" onclick="signOutAndGoLogin()">Sign Out</button>' +
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

async function confirmProfilePwOtp() {
  if (!dashCurrentUser) return;
  var code = document.getElementById("prof-pw-code").value.trim();
  var newPw = document.getElementById("prof-pw-new").value;
  if (typeof isStrongPassword === "function" && !isStrongPassword(newPw)) {
    showMsg("prof-pw-msg", "error", "Password must be at least 8 characters with uppercase, lowercase, number, and special symbol.");
    return;
  }
  try {
    await dbFinishPasswordReset(dashCurrentUser.email, code, newPw);
    document.getElementById("prof-pw-step2").classList.add("hidden");
    showMsg("prof-pw-msg", "ok", "Password updated!");
  } catch (err) {
    showMsg("prof-pw-msg", "error", err.message);
  }
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
    }, 1200);
  }
});
