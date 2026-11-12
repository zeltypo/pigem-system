// ============================================================================
// FILE: web/js/config.js
// PURPOSE: Global Cloud Configuration, Strict OOP/Helper Validators & UI Modals
// ----------------------------------------------------------------------------
// SHARED SCRIPT IMPORTS / BROWSER APIS USED:
//   - Browser `window`, `document`, `localStorage`, and `CustomEvent` APIs
//   - Exports global `CONFIG`, `validatePersonName`, `validateAdultBirthDate`,
//     `getStaffIdentifier`, `isAssignedToStaff`, and `attachEnterKeyNavigation`
// ============================================================================

var ROOT = window.ROOT || "";

var CONFIG = {

  SUPABASE_URL: "https://wuunqfxyejxwrawtjdrf.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1dW5xZnh5ZWp4d3Jhd3RqZHJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxNTE3MTEsImV4cCI6MjEwNzcyNzcxMX0.4Wt-6pJpLS4OUf_93bFn1513omGESvMn_E0ulnONf2g",

  PUBLIC_URL: "https://pigem-system-web.vercel.app",
  API_URL: "/api",

  ASSET_SOURCE: "supabase",

  LOCATIONIQ_API_KEY: "pk.3597a6e1a756561513401f40ea9ee840",

  RECAPTCHA_SITE_KEY: "6LfLGBQuAAAAAP3l2jkVbG41srUfH3mv2io15vXD",

  PLANS: [
    { id: "1000", name: "Plan 1000", speed: 100, price: 1000, tag: "Fiber for your home", featured: false },
    { id: "1400", name: "Plan 1400", speed: 300, price: 1400, tag: "Most chosen", featured: true },
    { id: "1900", name: "Plan 1900", speed: 500, price: 1900, tag: "Fiber for your home", featured: false }
  ],

  PLAN_INCLUSIONS: [
    "Unlimited pure fiber internet",
    "No lock-in",
    "Zero modem fee",
    "50% discount on the ₱2,000 one-time installation fee"
  ],

  STATUSES: ["Pending Review", "Under Agent Review", "Encoding", "Approved", "Rejected", "Needs Correction"],

  MAP_CENTER: [14.3294, 120.9367],

  SERVICE_AREAS: [
    "metro manila", "ncr", "national capital region", "manila", "quezon city", "makati", "pasig", "taguig",
    "caloocan", "pasay", "paranaque", "parañaque", "las pinas", "las piñas", "muntinlupa", "marikina",
    "mandaluyong", "san juan", "valenzuela", "malabon", "navotas", "pateros",
    "bulacan", "cavite", "laguna", "rizal", "cebu"
  ],

  UNIT_TYPES: ["House", "Townhouse", "Apartment", "Condominium", "Dormitory", "Commercial"],

  ID_TYPES: [
    { name: "Philippine National ID (PhilSys)", hint: "PhilSys Card Number: 16 digits (1234-5678-9012-3456) or PSN: 12 digits.", pattern: /^(\d{12}|\d{16})$/ },
    { name: "National ID", hint: "PhilSys Card Number: 16 digits (1234-5678-9012-3456) or PSN: 12 digits.", pattern: /^(\d{12}|\d{16})$/ },
    { name: "Driver's License", hint: "1 letter + 10 digits (N01-23-456789).", pattern: /^[A-Z]\d{10}$/ },
    { name: "Philippine Driver's License", hint: "1 letter + 10 digits (N01-23-456789).", pattern: /^[A-Z]\d{10}$/ },
    { name: "Passport", hint: "1-2 letters, 7 digits, optional letter at the end (P1234567A).", pattern: /^[A-Z]{1,2}\d{7}[A-Z]?$/ },
    { name: "Philippine Passport", hint: "1-2 letters, 7 digits, optional letter at the end (P1234567A).", pattern: /^[A-Z]{1,2}\d{7}[A-Z]?$/ },
    { name: "UMID", hint: "CRN: 12 digits (0111-2345678-9).", pattern: /^\d{12}$/ },
    { name: "Unified Multi-Purpose ID", hint: "CRN: 12 digits (0111-2345678-9).", pattern: /^\d{12}$/ },
    { name: "SSS ID", hint: "SSS: 10 digits (34-1234567-8).", pattern: /^\d{10,11}$/ },
    { name: "SSS/GSIS with photo", hint: "SSS: 10 digits (34-1234567-8). GSIS: 11 digits.", pattern: /^\d{10,11}$/ },
    { name: "PRC ID", hint: "PRC: 7 digits.", pattern: /^[A-Z0-9]{5,15}$/ },
    { name: "Postal ID", hint: "PRN: 12 to 13 characters as printed.", pattern: /^[A-Z0-9]{6,15}$/ },
    { name: "Voter's ID", hint: "VIN: letters and digits as printed.", pattern: /^[A-Z0-9]{6,28}$/ }
  ]
};

var DEFAULT_CONTENT = {
  logo_image: "black-logo-white-mode.png",
  dark_logo_image: "white-logo-dark-mode.png",
  hero_slide_count: 3,
  hero_slides: [],
  area_text: "Available in select Metro Manila, Bulacan, Cavite, Laguna, Rizal, and Cebu areas.",
  announcement: {
    active: false,
    headline: "",
    body: ""
  },
  about_slides: [],
  client_images: ["Clients/client-infus8.png", "Clients/client-radius.png", "Clients/client-maxcyc.png"],
  vehicle_images: [
    "Vehicles/vehicle-1.png", "Vehicles/vehicle-2.png", "Vehicles/vehicle-3.png",
    "Vehicles/vehicle-4.png", "Vehicles/vehicle-5.png", "Vehicles/vehicle-6.png"
  ],
  permit_images: [
    "Permits/permit-1.png", "Permits/permit-2.png", "Permits/permit-3.png",
    "Permits/permit-4.png", "Permits/permit-5.png", "Permits/permit-6.png",
    "Permits/permit-7.png", "Permits/permit-8.png", "Permits/permit-9.png"
  ],
  asset_library: {
    Banners: [],
    Logos: ["black-logo-white-mode.png", "white-logo-dark-mode.png"],
    Clients: ["Clients/client-infus8.png", "Clients/client-radius.png", "Clients/client-maxcyc.png"],
    Vehicles: [
      "Vehicles/vehicle-1.png", "Vehicles/vehicle-2.png", "Vehicles/vehicle-3.png",
      "Vehicles/vehicle-4.png", "Vehicles/vehicle-5.png", "Vehicles/vehicle-6.png"
    ],
    Permits: [
      "Permits/permit-1.png", "Permits/permit-2.png", "Permits/permit-3.png",
      "Permits/permit-4.png", "Permits/permit-5.png", "Permits/permit-6.png",
      "Permits/permit-7.png", "Permits/permit-8.png", "Permits/permit-9.png"
    ]
  },
  about: {
    story: "PIGEM Combined Facilities Support Services is an electrical and telecommunications services company based in Dasmariñas City, Cavite. It was established on December 28, 2021 by Mr. Mario Eusebio I. Pangilinan.",
    story2: "PIGEM started by providing temporary support for an existing telecommunications project. Since then, the team has grown from three employees to around 40 trained installers and technicians who handle internet service applications, field coordination, and installation support.",
    mission: "To help customers move through the application process with clear guidance and dependable support.",
    vision: "To become a trusted local partner for customers who need help with internet service applications.",
    values: "Responsibility, Efficiency, Commitment, Integrity, and Teamwork."
  },
  faqs: [
    { q: "Where is Red Fiber available?", a: "Red Fiber is available in select areas of Metro Manila, Bulacan, Cavite, Laguna, Rizal, and Cebu. Pin your exact location on the application form and our team will confirm if your area can be served." },
    { q: "What do I need to apply?", a: "One valid government ID (clear front and back photos), your contact details, and your complete installation address." },
    { q: "Is there a lock-in period?", a: "No. All plans have no lock-in period and zero modem fee." },
    { q: "How will I know the status of my application?", a: "After you submit, you will receive a reference number and an email link to activate your customer account. Log in anytime to check your status." },
    { q: "What if there is a problem with my application?", a: "We will email you and show what needs to be updated in your account. You can update your details or upload a clearer ID there." },
    { q: "How long is installation after approval?", a: "Please allow 3 to 5 business days after approval for installation scheduling." }
  ]
};

// Data Accessor `getImageUrl` (params: filePath): Retrieves or refreshes data to get image url.
function getImageUrl(filePath) {
  if (!filePath) return "";
  if (filePath.indexOf("data:") === 0 || filePath.indexOf("http://") === 0 || filePath.indexOf("https://") === 0) return filePath;
  var clean = String(filePath).replace(/^\/+/, "").replace(/^assets\/images\//, "");
  var base = (CONFIG.SUPABASE_URL || "https://wuunqfxyejxwrawtjdrf.supabase.co").replace(/\/+$/, "");
  return base + "/storage/v1/object/public/website-assets/" + clean;
}

// Helper `imageFallback` (params: img, filePath): Executes workflow logic for `imageFallback`.
function imageFallback(img, filePath) {
  img.onerror = null;
}

// UI State Controller `showSystemMaintenanceNotice` (params: customMsg): Updates modal, tab, or panel state to show system maintenance notice.
function showSystemMaintenanceNotice(customMsg) {
  var existing = document.getElementById("sys-maintenance-banner");
  if (existing) return;
  var banner = document.createElement("div");
  banner.id = "sys-maintenance-banner";
  banner.style.cssText = "background:#dc2626; color:#ffffff; padding:12px 18px; font-size:13.5px; text-align:center; position:sticky; top:0; z-index:99999; font-weight:700; box-shadow:0 3px 10px rgba(0,0,0,0.25);";
  banner.innerHTML = "<b>System Notice:</b> " + (customMsg || "Cloud Asset Storage and Database is temporarily degraded or undergoing maintenance. Hotline: 101-733 (RED) | (046) 458-0908.");
  if (document.body) {
    document.body.insertBefore(banner, document.body.firstChild);
  }
}

// Data Accessor `getActiveThemeLogoFilename`: Retrieves or refreshes data to get active theme logo filename.
function getActiveThemeLogoFilename() {
  var wc = getWebsiteContent();
  var isDark = document.documentElement.getAttribute("data-theme") === "dark";
  var lightLogo = (wc.logo_image && wc.logo_image !== "logo.png") ? wc.logo_image : "black-logo-white-mode.png";
  var darkLogo = wc.dark_logo_image || "white-logo-dark-mode.png";
  return isDark ? darkLogo : lightLogo;
}

// Data Accessor `loadPageImages`: Retrieves or refreshes data to load page images.
function loadPageImages() {
  var activeLogo = getActiveThemeLogoFilename();

  var images = document.querySelectorAll("img[data-img]");
  for (var i = 0; i < images.length; i++) {
    var filePath = images[i].getAttribute("data-img");
    if (filePath === "logo.png" || filePath === "black-logo-white-mode.png" || filePath === "white-logo-dark-mode.png") {
      filePath = activeLogo;
    }
    images[i].setAttribute("onerror", "imageFallback(this, '" + filePath + "')");
    images[i].src = getImageUrl(filePath);
  }

  var brandImgs = document.querySelectorAll(".brand img, .logo img, .simple-bar img, .sidebar-logo");
  for (var b = 0; b < brandImgs.length; b++) {
    if (brandImgs[b].classList && (brandImgs[b].classList.contains("icon-img") || brandImgs[b].classList.contains("icon-placeholder"))) continue;
    brandImgs[b].setAttribute("onerror", "imageFallback(this, '" + activeLogo + "')");
    brandImgs[b].src = getImageUrl(activeLogo);
  }
}

// Data Accessor `readSaved` (params: key, defaultValue): Retrieves or refreshes data to read saved.
function readSaved(key, defaultValue) {
  var raw = localStorage.getItem(key);
  if (!raw) return defaultValue;
  try { return JSON.parse(raw); } catch (e) { return defaultValue; }
}

// Helper `writeSaved` (params: key, value): Executes workflow logic for `writeSaved`.
function writeSaved(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// Data Accessor `getActivePlans`: Retrieves or refreshes data to get active plans.
function getActivePlans() { return readSaved("pigem_plans", CONFIG.PLANS); }
// Action Handler `saveActivePlans` (params: plans): Validates inputs and persists changes to save active plans.
function saveActivePlans(plans) {
  writeSaved("pigem_plans", plans);
  if (typeof dbSaveLivePlans === "function") dbSaveLivePlans(plans);
}

// Data Accessor `getWebsiteContent`: Retrieves or refreshes data to get website content.
function getWebsiteContent() {
  var saved = readSaved("pigem_website_content", {});
  var merged = Object.assign({}, DEFAULT_CONTENT, saved);
  merged.asset_library = Object.assign({}, DEFAULT_CONTENT.asset_library, saved.asset_library || {});
  return merged;
}
// Action Handler `saveWebsiteContent` (params: content): Validates inputs and persists changes to save website content.
function saveWebsiteContent(content) {
  writeSaved("pigem_website_content", content);
  if (typeof dbSaveLiveWebsiteContent === "function") dbSaveLiveWebsiteContent(content);
}

// Data Accessor `getSystemSettings`: Retrieves or refreshes data to get system settings.
function getSystemSettings() {
  return Object.assign({
    ai_enabled: true,
    maintenance_mode: false,
    maintenance_message: "The website, application form, and account activation are currently under scheduled maintenance while we update our content. Please come back shortly."
  }, readSaved("pigem_system_settings", {}));
}
// Action Handler `saveSystemSettings` (params: settings): Validates inputs and persists changes to save system settings.
function saveSystemSettings(settings) {
  writeSaved("pigem_system_settings", settings);
  if (typeof dbSaveLiveSystemSettings === "function") dbSaveLiveSystemSettings(settings);
}

// Utility `formatPeso` (params: amount): Normalizes or transforms values (format peso).
function formatPeso(amount) {
  return "₱" + Number(amount).toLocaleString("en-US");
}

// Utility `formatDate` (params: dateString): Normalizes or transforms values (format date).
function formatDate(dateString) {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

// Utility `formatDay` (params: dateString): Normalizes or transforms values (format day).
function formatDay(dateString) {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString("en-US", { dateStyle: "medium" });
}

// Data Accessor `getPlanById` (params: planId): Retrieves or refreshes data to get plan by id.
function getPlanById(planId) {
  var plans = getActivePlans();
  for (var i = 0; i < plans.length; i++) {
    if (String(plans[i].id) === String(planId)) return plans[i];
  }
  return { id: planId, name: "Plan " + planId, speed: "-", price: planId };
}

// Data Accessor `getIdType` (params: name): Retrieves or refreshes data to get id type.
function getIdType(name) {
  for (var i = 0; i < CONFIG.ID_TYPES.length; i++) {
    if (CONFIG.ID_TYPES[i].name === name) return CONFIG.ID_TYPES[i];
  }
  return { name: name, hint: "Type the number exactly as printed.", pattern: /^[A-Z0-9]{4,25}$/ };
}

// Utility `formatAddress` (params: app): Normalizes or transforms values (format address).
function formatAddress(app) {
  var parts = [
    app.house_no ? app.house_no + (app.house_suffix ? " " + app.house_suffix : "") : "",
    app.unit_no,
    app.floor_no ? "Floor " + app.floor_no : "",
    app.building_name && app.building_name !== "N/A" ? app.building_name : "",
    app.street,
    app.subdivision,
    app.barangay ? "Brgy. " + app.barangay : "",
    app.city,
    app.province
  ];
  var clean = [];
  for (var i = 0; i < parts.length; i++) {
    if (parts[i]) clean.push(parts[i]);
  }
  return clean.join(", ");
}

// Validator/Check `isServiceArea` (params: addressText): Evaluates rule (is service area) and returns result.
function isServiceArea(addressText) {
  var text = String(addressText || "").toLowerCase();
  for (var i = 0; i < CONFIG.SERVICE_AREAS.length; i++) {
    if (text.indexOf(CONFIG.SERVICE_AREAS[i]) !== -1) return true;
  }
  return false;
}

// Data Accessor `getDefaultStatusInstruction` (params: status, note): Retrieves or refreshes data to get default status instruction.
function getDefaultStatusInstruction(status, note) {
  if (status === "Needs Correction") return note || "Please update the information or ID requested below.";
  if (status === "Encoding") return note || "Your application passed initial verification and is now being encoded into the provider portal.";
  if (status === "Approved") return note || "Approved. Please wait 3 to 5 business days for installation scheduling. Watch your email and phone for updates.";
  if (status === "Rejected") return note || "Your application did not pass provider validation.";
  return "We are reviewing your application. Please check your email for updates.";
}

// Helper `makeBadge` (params: status): Executes workflow logic for `makeBadge`.
function makeBadge(status) {
  var cssName = String(status || "Processing").toLowerCase().replace(/ /g, "-");
  return '<span class="badge status-' + cssName + '">' + status + "</span>";
}

// UI State Controller `openPopup` (params: htmlContent, isWideOrOpts): Updates modal, tab, or panel state to open popup.
function openPopup(htmlContent, isWideOrOpts) {
  closePopup();
  var opts = (isWideOrOpts && typeof isWideOrOpts === "object")
    ? isWideOrOpts
    : { wide: Boolean(isWideOrOpts), closeOnBackdrop: true, showCloseX: false };
  var back = document.createElement("div");
  back.id = "popup-modal";
  back.className = "popup-back";
  var closeBtnHtml = opts.showCloseX
    ? '<button type="button" class="popup-close-x" id="popup-close-x-btn" aria-label="Close">&times;</button>'
    : '';
  back.innerHTML = '<div class="popup' + (opts.wide ? " wide" : "") + '">' + closeBtnHtml + htmlContent + "</div>";
  document.body.appendChild(back);
  var handleClose = function () {
    closePopup();
    if (typeof opts.onClose === "function") opts.onClose();
  };
  var xBtn = document.getElementById("popup-close-x-btn");
  if (xBtn) xBtn.addEventListener("click", handleClose);
  if (opts.closeOnBackdrop !== false) {
    back.addEventListener("click", function (ev) {
      if (ev.target === back) handleClose();
    });
  }
  if (typeof initPasswordEyeToggles === "function") initPasswordEyeToggles(back);
  if (typeof attachEnterKeyNavigation === "function") attachEnterKeyNavigation(back);
}

// UI State Controller `closePopup`: Updates modal, tab, or panel state to close popup.
function closePopup() {
  var existing = document.getElementById("popup-modal");
  if (existing) existing.remove();
}

// UI State Controller `showAlert` (params: title, message, type): Updates modal, tab, or panel state to show alert.
function showAlert(title, message, type) {
  openPopup(
    "<h3>" + title + "</h3>" +
    '<div class="notice ' + (type || "") + ' mt">' + message + "</div>" +
    '<div class="row mt" style="justify-content:flex-end"><button class="btn btn-red" onclick="closePopup()">OK</button></div>'
  );
}

// Helper `previewImage` (params: filePath, titleText): Executes workflow logic for `previewImage`.
function previewImage(filePath, titleText) {
  var headerHtml = titleText
    ? '<div class="row between"><h3>' + escapeHtml(titleText) + '</h3><button class="btn btn-small" onclick="closePopup()">Close</button></div>'
    : '<div class="row" style="justify-content:flex-end"><button class="btn btn-small" onclick="closePopup()">Close</button></div>';
  openPopup(
    headerHtml +
    '<img class="mt" src="' + getImageUrl(filePath) + '" onerror="imageFallback(this, \'' + filePath + '\')" style="margin:12px auto 0; max-height:74vh; border-radius:10px;">',
    true
  );
}

// UI State Controller `toggleMenu`: Updates modal, tab, or panel state to toggle menu.
function toggleMenu() {
  document.body.classList.toggle("menu-open");
}

var sliderTimers = {};
// Helper `startSlider` (params: sliderId, slides): Executes workflow logic for `startSlider`.
function startSlider(sliderId, slides) {
  var box = document.getElementById(sliderId);
  if (!box) return;

  if (!slides || slides.length === 0) {
    box.innerHTML = "";
    box.style.display = "none";
    clearInterval(sliderTimers[sliderId]);
    return;
  }
  box.style.display = "";

  var html = "";
  var dots = "";
  for (var i = 0; i < slides.length; i++) {
    html +=
      '<div class="slide' + (i === 0 ? " active" : "") + '">' +
        '<img src="' + getImageUrl(slides[i].image) + '" onerror="imageFallback(this, \'' + slides[i].image + '\')" alt="' + (slides[i].title || "Banner (not available)") + '">' +
        (slides[i].title || slides[i].text
          ? '<div class="slide-text"><div class="container"><h1>' + (slides[i].title || "") + "</h1><p>" + (slides[i].text || "") + "</p></div></div>"
          : "") +
      "</div>";
    dots += '<button class="' + (i === 0 ? "active" : "") + '" onclick="goToSlide(\'' + sliderId + "', " + i + ')" aria-label="Slide ' + (i + 1) + '"></button>';
  }
  html +=
    '<button class="slider-arrow prev" onclick="moveSlide(\'' + sliderId + '\', -1)" aria-label="Previous">&#8249;</button>' +
    '<button class="slider-arrow next" onclick="moveSlide(\'' + sliderId + '\', 1)" aria-label="Next">&#8250;</button>' +
    '<div class="slider-dots">' + dots + "</div>";
  box.innerHTML = html;
  box.setAttribute("data-index", "0");

  clearInterval(sliderTimers[sliderId]);
  sliderTimers[sliderId] = setInterval(function () { moveSlide(sliderId, 1); }, 5000);
}

// Helper `goToSlide` (params: sliderId, index): Executes workflow logic for `goToSlide`.
function goToSlide(sliderId, index) {
  var box = document.getElementById(sliderId);
  var slides = box.querySelectorAll(".slide");
  var dots = box.querySelectorAll(".slider-dots button");
  if (slides.length === 0) return;
  if (index < 0) index = slides.length - 1;
  if (index >= slides.length) index = 0;
  for (var i = 0; i < slides.length; i++) {
    slides[i].classList.toggle("active", i === index);
    dots[i].classList.toggle("active", i === index);
  }
  box.setAttribute("data-index", String(index));
}

// Helper `moveSlide` (params: sliderId, step): Executes workflow logic for `moveSlide`.
function moveSlide(sliderId, step) {
  var box = document.getElementById(sliderId);
  var current = Number(box.getAttribute("data-index") || 0);
  goToSlide(sliderId, current + step);
}

var stripTimers = {};

// UI Renderer `buildStrip` (params: stripId, files, titlePrefix): Builds and updates DOM elements for strip.
function buildStrip(stripId, files, titlePrefix) {
  var box = document.getElementById(stripId);
  if (!box) return;
  var altLabel = titlePrefix ? String(titlePrefix) : "Gallery Image";
  var popupTitle = titlePrefix ? String(titlePrefix) : "";
  var html = "";
  for (var round = 0; round < 2; round++) {
    for (var i = 0; i < files.length; i++) {
      html += '<img draggable="false" src="' + getImageUrl(files[i]) + '" onerror="imageFallback(this, \'' + files[i] + '\')" alt="' + altLabel + '" onclick="if(!window._stripDragged) previewImage(\'' + files[i] + "', '" + popupTitle + '\')">';
    }
  }
  box.innerHTML = '<div class="strip-track">' + html + "</div>";

  var paused = false;
  var isDown = false;
  var startX = 0;
  var scrollStart = 0;

  box.onmouseenter = function () { paused = true; };
  box.onmouseleave = function () { paused = false; isDown = false; };
  box.ontouchstart = function () { paused = true; };
  box.ontouchend = function () {
    setTimeout(function () { paused = false; }, 1800);
  };

  box.onmousedown = function (e) {
    isDown = true;
    paused = true;
    window._stripDragged = false;
    startX = e.pageX - box.offsetLeft;
    scrollStart = box.scrollLeft;
  };
  box.onmousemove = function (e) {
    if (!isDown) return;
    e.preventDefault();
    var x = e.pageX - box.offsetLeft;
    var walk = x - startX;
    if (Math.abs(walk) > 6) window._stripDragged = true;
    box.scrollLeft = scrollStart - walk;
  };
  box.onmouseup = function () {
    isDown = false;
    setTimeout(function () { window._stripDragged = false; }, 80);
  };

  if (stripTimers[stripId]) clearInterval(stripTimers[stripId]);
  stripTimers[stripId] = setInterval(function () {
    if (paused) return;
    box.scrollLeft += 1;
    var half = box.scrollWidth / 2;
    if (half > 0 && box.scrollLeft >= half) {
      box.scrollLeft -= half;
    }
  }, 25);
}

// Data Accessor `getHomeForRole` (params: role): Retrieves or refreshes data to get home for role.
function getHomeForRole(role) {
  if (role === "admin") return ROOT + "admin.html";
  if (role === "manager") return ROOT + "manager.html";
  if (role === "agent") return ROOT + "agent.html";
  return ROOT + "customer.html";
}

// Helper `evaluatePasswordRules` (params: pw): Executes workflow logic for `evaluatePasswordRules`.
function evaluatePasswordRules(pw) {
  var val = String(pw || "");
  return {
    length: val.length >= 8,
    upper: /[A-Z]/.test(val),
    lower: /[a-z]/.test(val),
    digit: /[0-9]/.test(val),
    special: /[^A-Za-z0-9\s]/.test(val)
  };
}

// Validator/Check `isStrongPassword` (params: pw): Evaluates rule (is strong password) and returns result.
function isStrongPassword(pw) {
  var r = evaluatePasswordRules(pw);
  return Boolean(r.length && r.upper && r.lower && r.digit && r.special);
}

var PASSWORD_REQUIREMENT_TEXT = "Password must be at least 8 characters and include 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special symbol.";

// Data Accessor `getSiteBaseUrl`: Retrieves or refreshes data to get site base url.
function getSiteBaseUrl() {
  var path = window.location.pathname || "/";
  var folder = path.substring(0, path.lastIndexOf("/"));
  return window.location.origin + folder;
}

// Helper `attachPasswordRegexChecklist` (params: inputEl): Executes workflow logic for `attachPasswordRegexChecklist`.
function attachPasswordRegexChecklist(inputEl) {
  if (!inputEl || inputEl.getAttribute("data-regex-attached") === "1") return;
  var id = inputEl.id || "";
  var needsChecklist =
    inputEl.getAttribute("data-pw-check") === "1" ||
    id === "adm-pw" ||
    id === "act-pass" ||
    id === "ag-reg-pw" ||
    id === "m-ag-pw" ||
    id === "adm-new-pw" ||
    id === "adm-reset-pw" ||
    id === "mgr-ag-pass" ||
    id === "prof-new-pw" ||
    id === "prof-pw-new" ||
    id === "rec-new-pw";

  if (!needsChecklist) return;
  inputEl.setAttribute("data-regex-attached", "1");

  var box = document.createElement("div");
  box.className = "pw-regex-box";
  box.style.display = "none";
  box.innerHTML =
    '<div class="pw-regex-title">Remaining Password Requirements:</div>' +
    '<div class="pw-regex-grid">' +
      '<span data-rule="length">&#9675; At least 8 characters</span>' +
      '<span data-rule="upper">&#9675; 1 uppercase letter (A-Z)</span>' +
      '<span data-rule="lower">&#9675; 1 lowercase letter (a-z)</span>' +
      '<span data-rule="digit">&#9675; 1 number (0-9)</span>' +
      '<span data-rule="special">&#9675; 1 special symbol (!@#$...)</span>' +
    '</div>';

  var targetParent = inputEl.closest(".pw-wrap") || inputEl;
  if (targetParent.parentNode) {
    targetParent.parentNode.insertBefore(box, targetParent.nextSibling);
  }

  // Data Accessor `refreshRules` (params: forceCheck): Retrieves or refreshes data to refresh rules.
  function refreshRules(forceCheck) {
    var val = String(inputEl.value || "");
    if (!val && !forceCheck) {
      box.style.display = "none";
      return;
    }
    var rules = evaluatePasswordRules(val);
    var items = box.querySelectorAll("[data-rule]");
    var pendingCount = 0;
    for (var i = 0; i < items.length; i++) {
      var key = items[i].getAttribute("data-rule");
      var passed = Boolean(rules[key]);
      items[i].style.display = passed ? "none" : "block";
      items[i].classList.toggle("passed", passed);
      if (!passed) pendingCount++;
    }
    box.style.display = (val.length > 0 && pendingCount > 0) || (forceCheck && pendingCount > 0) ? "block" : "none";
  }

  inputEl.addEventListener("input", function () { refreshRules(false); });
  inputEl.addEventListener("blur", function () {
    if (!inputEl.value) box.style.display = "none";
  });
}

// UI State Controller `setFieldError` (params: inputOrId, message): Updates modal, tab, or panel state to set field error.
function setFieldError(inputOrId, message) {
  var el = typeof inputOrId === "string" ? document.getElementById(inputOrId) : inputOrId;
  if (!el) return;
  el.classList.add("input-invalid");
  var anchor = el.closest(".email-otp-inline") || el.closest(".pw-wrap") || el;
  var parent = anchor.parentNode;
  if (!parent) return;
  var errId = "ferr-" + (el.id || ("f" + Math.random().toString(36).slice(2, 7)));
  var errEl = parent.querySelector('.field-error[data-for="' + (el.id || "") + '"]') || document.getElementById(errId);
  if (!errEl) {
    errEl = document.createElement("div");
    errEl.id = errId;
    errEl.className = "field-error";
    if (el.id) errEl.setAttribute("data-for", el.id);
    if (anchor.nextSibling) parent.insertBefore(errEl, anchor.nextSibling);
    else parent.appendChild(errEl);
  }
  errEl.textContent = String(message || "Invalid value.");
  errEl.style.display = "block";
}

// Helper `clearFieldError` (params: inputOrId): Executes workflow logic for `clearFieldError`.
function clearFieldError(inputOrId) {
  var el = typeof inputOrId === "string" ? document.getElementById(inputOrId) : inputOrId;
  if (!el) return;
  el.classList.remove("input-invalid");
  var anchor = el.closest(".email-otp-inline") || el.closest(".pw-wrap") || el;
  var parent = anchor.parentNode;
  if (!parent) return;
  var errEl = el.id
    ? parent.querySelector('.field-error[data-for="' + el.id + '"]')
    : (anchor.nextSibling && anchor.nextSibling.classList && anchor.nextSibling.classList.contains("field-error") ? anchor.nextSibling : null);
  if (errEl) {
    errEl.textContent = "";
    errEl.style.display = "none";
  }
}

// Helper `clearAllFieldErrors` (params: rootEl): Executes workflow logic for `clearAllFieldErrors`.
function clearAllFieldErrors(rootEl) {
  var scope = rootEl || document;
  var errs = scope.querySelectorAll(".field-error");
  for (var i = 0; i < errs.length; i++) {
    errs[i].textContent = "";
    errs[i].style.display = "none";
  }
  var invs = scope.querySelectorAll(".input-invalid");
  for (var j = 0; j < invs.length; j++) {
    invs[j].classList.remove("input-invalid");
  }
}

// Utility `formatElapsedTimeAgo` (params: isoDate): Normalizes or transforms values (format elapsed time ago).
function formatElapsedTimeAgo(isoDate) {
  if (!isoDate) return "recently";
  var t = new Date(isoDate).getTime();
  if (isNaN(t)) return "recently";
  var diffMs = Math.max(0, Date.now() - t);
  var hours = Math.floor(diffMs / 3600000);
  var days = Math.floor(hours / 24);
  var months = Math.floor(days / 30);
  if (months >= 1) {
    var remDays = days % 30;
    return months + " month" + (months > 1 ? "s" : "") + (remDays > 0 ? " and " + remDays + " day" + (remDays > 1 ? "s" : "") : "") + " ago";
  }
  if (days >= 1) {
    return days + " day" + (days > 1 ? "s" : "") + " ago";
  }
  if (hours >= 1) {
    return hours + " hour" + (hours > 1 ? "s" : "") + " ago";
  }
  var mins = Math.max(1, Math.floor(diffMs / 60000));
  return mins + " minute" + (mins > 1 ? "s" : "") + " ago";
}

// Helper `initPasswordEyeToggles` (params: rootEl): Executes workflow logic for `initPasswordEyeToggles`.
function initPasswordEyeToggles(rootEl) {
  var container = rootEl || document;
  var pwInputs = container.querySelectorAll('input[type="password"], input[data-pw-field="1"]');
  for (var i = 0; i < pwInputs.length; i++) {
    var inp = pwInputs[i];
    inp.setAttribute("data-pw-field", "1");
    if (inp.getAttribute("data-eye-ready") === "1") {
      attachPasswordRegexChecklist(inp);
      continue;
    }
    inp.setAttribute("data-eye-ready", "1");

    var wrap = document.createElement("div");
    wrap.className = "pw-wrap";
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pw-eye";
    btn.setAttribute("aria-label", "Toggle password visibility");
    btn.setAttribute("aria-pressed", "false");
    btn.title = "Show or Hide Field";
    btn.innerHTML =
      '<svg class="eye-open" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
      '<svg class="eye-closed" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

    (function (inputEl, buttonEl) {
      buttonEl.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var currentType = (inputEl.getAttribute("type") || inputEl.type || "password").toLowerCase();
        var nextType = currentType === "password" ? "text" : "password";
        try {
          inputEl.type = nextType;
        } catch (err) {}
        inputEl.setAttribute("type", nextType);
        var isRevealed = nextType === "text";
        buttonEl.setAttribute("aria-pressed", isRevealed ? "true" : "false");
        buttonEl.classList.toggle("is-revealed", isRevealed);
        inputEl.classList.toggle("pw-field-revealed", isRevealed);
        var openIcon = buttonEl.querySelector(".eye-open");
        var closedIcon = buttonEl.querySelector(".eye-closed");
        if (openIcon && closedIcon) {
          openIcon.style.display = isRevealed ? "none" : "block";
          closedIcon.style.display = isRevealed ? "block" : "none";
        }
      });
    })(inp, btn);

    wrap.appendChild(btn);
    attachPasswordRegexChecklist(inp);
  }
}

// UI State Controller `setupPublicHeader`: Updates modal, tab, or panel state to setup public header.
async function setupPublicHeader() {
  if (typeof dbGetCurrentUser !== "function") return;
  var user = await dbGetCurrentUser();
  if (!user || user.role !== "customer") return;

  var accountButtons = document.querySelectorAll(".account-btn");
  for (var i = 0; i < accountButtons.length; i++) {
    accountButtons[i].textContent = "Apply";
    accountButtons[i].href = ROOT + "apply.html";
    accountButtons[i].target = "_blank";
  }
  var customerLinks = document.querySelectorAll(".customer-only");
  for (var j = 0; j < customerLinks.length; j++) {
    customerLinks[j].hidden = false;
  }
}

// Validator/Check `isManagerOrAdminPreview`: Evaluates rule (is manager or admin preview) and returns result.
function isManagerOrAdminPreview() {
  if (window.location.search.indexOf("preview_cms=1") !== -1) {
    sessionStorage.setItem("pigem_cms_preview", "1");
    return true;
  }
  if (sessionStorage.getItem("pigem_cms_preview") === "1") return true;
  if (sessionStorage.getItem("pigem_session_staff")) return true;
  if (sessionStorage.getItem("pigem_session_admin")) return true;
  return false;
}

// Validator/Check `checkPublicMaintenance`: Evaluates rule (check public maintenance) and returns result.
function checkPublicMaintenance() {
  var path = window.location.pathname.toLowerCase();
  var isCoveredPage =
    document.body.classList.contains("public-page") ||
    path.indexOf("index.html") !== -1 ||
    path.indexOf("about.html") !== -1 ||
    path.indexOf("apply.html") !== -1 ||
    path.indexOf("activate.html") !== -1 ||
    path.indexOf("privacy.html") !== -1 ||
    path.indexOf("terms.html") !== -1 ||
    path.endsWith("/");

  if (!isCoveredPage) return;

  var settings = getSystemSettings();
  if (!settings.maintenance_mode) {
    var oldBar = document.getElementById("mgr-preview-bar");
    if (oldBar) oldBar.remove();
    return;
  }

  if (isManagerOrAdminPreview()) {
    if (!document.getElementById("mgr-preview-bar")) {
      var bar = document.createElement("div");
      bar.id = "mgr-preview-bar";
      bar.className = "notice warn";
      bar.style.borderRadius = "0";
      bar.style.textAlign = "center";
      bar.innerHTML =
        "<b>Manager Preview Mode:</b> The Public Website, Application Form, and Account Activation are currently <b>Under Maintenance</b> for customers while you edit content.";
      document.body.insertBefore(bar, document.body.firstChild);
    }
    return;
  }

  closePopup();
  document.body.innerHTML =
    '<main class="auth-page">' +
      '<div class="card auth-card center" style="max-width:520px">' +
        '<img src="' + getImageUrl(getActiveThemeLogoFilename()) + '" alt="PIGEM" style="height:64px; margin:0 auto 14px" />' +
        '<h2>Website Under Maintenance</h2>' +
        '<p class="muted mt">' +
          (settings.maintenance_message || "The website, application form, and account activation are currently under scheduled maintenance while we update our content. Please come back shortly.") +
        '</p>' +
      '</div>' +
    '</main>';
}

// Event Listener: Initializes handlers or syncs state when `DOMContentLoaded` fires
window.addEventListener("DOMContentLoaded", async function () {
  if (typeof initPasswordEyeToggles === "function") {
    initPasswordEyeToggles();
  }
  if (typeof attachEnterKeyNavigation === "function") {
    attachEnterKeyNavigation(document);
  }
  if (typeof dbSyncLiveSettingsAndContent === "function") {
    await dbSyncLiveSettingsAndContent();
  }
  loadPageImages();
  checkPublicMaintenance();
  setupPublicHeader();
});

class BaseFieldValidator {
  constructor() {
    this._emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    this._gmailRegex = /^[a-zA-Z0-9._%+-]+@gmail\.com$/i;
    this._usernameRegex = /^[a-zA-Z0-9._]{3,30}$/;
    this._mobileRegex = /^09\d{9}$/;
    this._stripSeparatorsRegex = /[\s\-]+/g;
  }

  validate(value) {
    throw new Error("Subclasses must implement validate().");
  }

  cleanIdValue(rawValue) {
    return String(rawValue || "").toUpperCase().replace(this._stripSeparatorsRegex, "");
  }
}

class ApplicantFormValidator extends BaseFieldValidator {
  isValidUsername(username) {
    var clean = String(username || "").trim();
    if (!clean) return false;
    return this._usernameRegex.test(clean);
  }

  isValidEmail(email) {
    var clean = String(email || "").trim();
    if (!clean) return false;
    return this._emailRegex.test(clean);
  }

  isCustomerGmail(email) {
    var clean = String(email || "").trim();
    if (!clean) return false;
    return this._gmailRegex.test(clean);
  }

  isStaffBusinessEmail(email) {
    var clean = String(email || "").trim().toLowerCase();
    if (!clean || !this._emailRegex.test(clean)) return false;
    if (this._gmailRegex.test(clean) || /@(googlemail|yahoo|outlook|hotmail)\.com$/i.test(clean)) {
      return false;
    }
    return true;
  }

  isValidMobile(phone) {
    var digits = String(phone || "").replace(/\D/g, "");
    if (digits.length === 11) {
      if (this._mobileRegex.test(digits)) {
        return true;
      }
    }
    return false;
  }

  validateIdByType(idTypeName, rawNumber) {
    var cleaned = this.cleanIdValue(rawNumber);
    if (!cleaned) {
      return { valid: false, message: "Please enter your Valid ID number." };
    }
    var spec = getIdType(idTypeName);
    if (spec && spec.pattern) {
      if (!spec.pattern.test(cleaned)) {
        return { valid: false, message: spec.hint || "Invalid ID format." };
      }
    }
    return { valid: true, message: "Valid format." };
  }

  validate(formFields) {
    if (!formFields) return { valid: false, field: "form" };
    if (!this.isCustomerGmail(formFields.email)) {
      return { valid: false, field: "email" };
    }
    if (!this.isValidMobile(formFields.phone)) {
      return { valid: false, field: "phone" };
    }
    var idCheck = this.validateIdByType(formFields.id_type, formFields.id_number);
    if (!idCheck.valid) {
      return { valid: false, field: "id_number", message: idCheck.message };
    }
    return { valid: true, field: "" };
  }
}

var FORM_VALIDATOR = new ApplicantFormValidator();

// Validator/Check `isCustomerGmail` (params: email): Evaluates rule (is customer gmail) and returns result.
function isCustomerGmail(email) {
  return FORM_VALIDATOR.isCustomerGmail(email);
}

// Validator/Check `isStaffBusinessEmail` (params: email): Evaluates rule (is staff business email) and returns result.
function isStaffBusinessEmail(email) {
  return FORM_VALIDATOR.isStaffBusinessEmail(email);
}

// Validator/Check `isValidUsername` (params: username): Evaluates rule (is valid username) and returns result.
function isValidUsername(username) {
  return FORM_VALIDATOR.isValidUsername(username);
}

// Helper `sanitizeUsernameSeed` (params: fullName, email): Executes workflow logic for `sanitizeUsernameSeed`.
function sanitizeUsernameSeed(fullName, email) {
  var emailPart = String(email || "").split("@")[0].toLowerCase().replace(/[^a-z0-9._]/g, "");
  var namePart = String(fullName || "").toLowerCase().replace(/\s+/g, ".").replace(/[^a-z0-9._]/g, "");
  var base = (emailPart.length >= 3 ? emailPart : namePart).replace(/^[._]+|[._]+$/g, "").replace(/[._]{2,}/g, "_");
  if (base.length < 3) {
    base = "user_" + String(Date.now()).slice(-4);
  }
  return base.slice(0, 24);
}

var DASHBOARD_TUTORIAL_STEPS = {
  customer: [
    {
      selector: "#st-total",
      title: "Step 1: Application Summary Cards",
      text: "See your total submitted applications and whether each is Processing, Approved, or Rejected."
    },
    {
      selector: "#cust-app-list",
      title: "Step 2: My Submitted Applications",
      text: "Click any application card on the left to open its live timeline and status instructions."
    },
    {
      selector: "#cust-detail-box",
      title: "Step 3: Status Details and Requested Updates",
      text: "If our verification team requests a correction, an update box appears here so you can edit the field or upload a clearer ID photo."
    },
    {
      selector: "#avatar-btn",
      title: "Step 4: Account Profile and Theme",
      text: "Click your profile circle to switch between Light Mode and Dark Mode or update your username and password."
    }
  ],
  agent: [
    {
      selector: "#nav-overview",
      title: "Step 1: Workspace Overview",
      text: "See your assigned applications, incoming queue count, and status breakdown at a glance."
    },
    {
      selector: "#nav-queue",
      title: "Step 2: Application Queue (Unclaimed)",
      text: "Claim newly submitted customer applications so you can inspect their requirements and Valid ID."
    },
    {
      selector: "#nav-claimed",
      title: "Step 3: My Claimed Applications",
      text: "Open any claimed application to run or refresh automated document screening and compare OCR fields."
    },
    {
      selector: "#nav-encoding",
      title: "Step 4: Encoding Queue",
      text: "One-click access to verified applications that are currently being encoded into the provider portal."
    },
    {
      selector: "#nav-correction",
      title: "Step 5: Needs Correction",
      text: "One-click access to applications waiting for the customer to submit a corrected detail or clearer ID photo."
    },
    {
      selector: "#nav-approved",
      title: "Step 6: Approved Applications",
      text: "View all applications that passed provider validation and are scheduled for installation."
    },
    {
      selector: "#nav-rejected",
      title: "Step 7: Rejected Applications",
      text: "View applications that did not pass provider validation along with recorded validator remarks."
    }
  ],
  manager: [
    {
      selector: "#nav-overview",
      title: "Step 1: Executive Overview",
      text: "Monitor total applications, approval rates, barangay distribution, and daily trends."
    },
    {
      selector: "#nav-app-all",
      title: "Step 2: All Applications and Status Shortcuts",
      text: "Inspect any application or use the sidebar shortcuts for Encoding, Needs Correction, Approved, and Rejected."
    },
    {
      selector: "#nav-agent-links",
      title: "Step 3: Agent Accounts and Private Invite Links",
      text: "Create a new Agent account directly or generate a private one-time registration link for a new Agent."
    },
    {
      selector: "#nav-cms-banners",
      title: "Step 4: Website Content (CMS)",
      text: "Update homepage banners, fiber plans, logos, and customer announcements."
    }
  ],
  admin: [
    {
      selector: "#nav-overview",
      title: "Step 1: System Overview",
      text: "Monitor active user accounts, total applications, and system status."
    },
    {
      selector: "#nav-maintenance",
      title: "Step 2: Maintenance Control",
      text: "Toggle public website Maintenance Mode with instant in-app status notices to staff."
    },
    {
      selector: "#nav-ai",
      title: "Step 3: Automated Screening Control",
      text: "Enable or pause the cloud document screening pipeline and review screening logs."
    },
    {
      selector: "#nav-accounts",
      title: "Step 4: Accounts and Private Agent Links",
      text: "Create Manager or Agent accounts using usernames or generate private one-time Agent registration links."
    },
    {
      selector: "#nav-logs",
      title: "Step 5: Audit and Login Logs",
      text: "Inspect chronological system events and login history across all portals."
    }
  ]
};

var _tourState = {
  portal: "",
  steps: [],
  index: 0,
  userKey: ""
};

// Helper `startDashboardTour` (params: portalName, forceManual): Executes workflow logic for `startDashboardTour`.
function startDashboardTour(portalName, forceManual) {
  var p = String(portalName || window.DASH_PORTAL || "").toLowerCase();
  if (!DASHBOARD_TUTORIAL_STEPS[p]) return;

  var userEmail = "";
  try {
    var rawUser = sessionStorage.getItem("pigem_user_cache");
    if (rawUser) userEmail = (JSON.parse(rawUser).email || "").toLowerCase();
  } catch (e) {}
  var storageKey = "pigem_tour_done_" + p + "_" + (userEmail || "default");

  if (!forceManual && localStorage.getItem(storageKey) === "1") {
    return;
  }

  _tourState.portal = p;
  _tourState.steps = DASHBOARD_TUTORIAL_STEPS[p];
  _tourState.index = 0;
  _tourState.userKey = storageKey;
  renderDashboardTourStep();
}

// UI Renderer `renderDashboardTourStep`: Builds and updates DOM elements for dashboard tour step.
function renderDashboardTourStep() {
  removeDashboardTourElements();
  var steps = _tourState.steps || [];
  if (_tourState.index < 0 || _tourState.index >= steps.length) {
    finishDashboardTour();
    return;
  }

  var step = steps[_tourState.index];
  var target = document.querySelector(step.selector);

  var prevHighlight = document.querySelectorAll(".tour-target-highlight");
  for (var i = 0; i < prevHighlight.length; i++) {
    prevHighlight[i].classList.remove("tour-target-highlight");
  }

  var bubble = document.createElement("div");
  bubble.id = "dashboard-tour-bubble";
  bubble.className = "tour-bubble";

  var total = steps.length;
  var currentNum = _tourState.index + 1;

  bubble.innerHTML =
    '<div class="tour-bubble-arrow"></div>' +
    '<div class="row between" style="margin-bottom:6px;">' +
      '<span class="badge" style="background:var(--red);color:#fff;font-size:11px;">Step ' + currentNum + ' of ' + total + '</span>' +
      '<button type="button" class="btn btn-small btn-outline" style="padding:2px 8px;font-size:11px;" onclick="finishDashboardTour()">Skip</button>' +
    '</div>' +
    '<div style="font-weight:700;font-size:14.5px;margin-bottom:4px;color:var(--text);">' + step.title + '</div>' +
    '<div style="font-size:13px;color:var(--muted);line-height:1.5;margin-bottom:12px;">' + step.text + '</div>' +
    '<div class="row between">' +
      (_tourState.index > 0
        ? '<button type="button" class="btn btn-small btn-outline" onclick="stepDashboardTour(-1)">&larr; Previous</button>'
        : '<span></span>') +
      (_tourState.index < total - 1
        ? '<button type="button" class="btn btn-small btn-red" onclick="stepDashboardTour(1)">Next &rarr;</button>'
        : '<button type="button" class="btn btn-small btn-red" onclick="finishDashboardTour()">Finish Tutorial</button>') +
    '</div>';

  document.body.appendChild(bubble);

  if (target) {
    var parentSub = target.closest(".nav-sub");
    if (parentSub && parentSub.classList.contains("hidden")) {
      parentSub.classList.remove("hidden");
    }
    target.classList.add("tour-target-highlight");
    try {
      target.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } catch (e) {}
    var rect = target.getBoundingClientRect();
    var topPos = Math.max(16, Math.min(window.innerHeight - 210, rect.top - 6));
    var leftPos = rect.right + 16;
    if (leftPos + 320 > window.innerWidth) {
      leftPos = Math.max(16, rect.left);
      topPos = Math.min(window.innerHeight - 210, rect.bottom + 12);
      bubble.classList.add("tour-bubble-top");
    }
    bubble.style.top = topPos + "px";
    bubble.style.left = leftPos + "px";
  } else {
    bubble.style.top = "84px";
    bubble.style.right = "24px";
  }
}

// Helper `stepDashboardTour` (params: delta): Executes workflow logic for `stepDashboardTour`.
function stepDashboardTour(delta) {
  _tourState.index += delta;
  renderDashboardTourStep();
}

// Helper `removeDashboardTourElements`: Executes workflow logic for `removeDashboardTourElements`.
function removeDashboardTourElements() {
  var old = document.getElementById("dashboard-tour-bubble");
  if (old) old.remove();
  var highlighted = document.querySelectorAll(".tour-target-highlight");
  for (var i = 0; i < highlighted.length; i++) {
    highlighted[i].classList.remove("tour-target-highlight");
  }
}

// Helper `finishDashboardTour`: Executes workflow logic for `finishDashboardTour`.
function finishDashboardTour() {
  if (_tourState.userKey) {
    localStorage.setItem(_tourState.userKey, "1");
  }
  removeDashboardTourElements();
}

// UI State Controller `showPortalGuide` (params: guideId, onDone): Updates modal, tab, or panel state to show portal guide.
function showPortalGuide(guideId, onDone) {
  var map = {
    customer_portal_guide: "customer",
    agent_workspace_guide: "agent",
    manager_dashboard_guide: "manager",
    admin_technical_guide: "admin"
  };
  var portal = map[guideId] || window.DASH_PORTAL || "";
  if (portal && DASHBOARD_TUTORIAL_STEPS[portal]) {
    startDashboardTour(portal, true);
    return;
  }
  if (typeof onDone === "function") onDone();
}

// Helper `finishPortalGuide`: Executes workflow logic for `finishPortalGuide`.
function finishPortalGuide() {
  finishDashboardTour();
  closePopup();
}

// UI State Controller `openConfirmPopup` (params: title, messageHtml, confirmLabel, onConfirm, isDanger): Updates modal, tab, or panel state to open confirm popup.
function openConfirmPopup(title, messageHtml, confirmLabel, onConfirm, isDanger) {
  window._pendingConfirmAction = typeof onConfirm === "function" ? onConfirm : null;
  var btnClass = isDanger ? "btn btn-red" : "btn btn-green";
  openPopup(
    '<div class="row between" style="margin-bottom:8px;">' +
      '<h3>' + title + '</h3>' +
      '<button type="button" class="btn btn-outline btn-sm" onclick="closePopup()">Cancel</button>' +
    '</div>' +
    '<div class="notice ' + (isDanger ? "warn" : "") + ' mt" style="font-size:13.5px;line-height:1.55;">' + messageHtml + '</div>' +
    '<div class="row mt" style="justify-content:flex-end;gap:8px;">' +
      '<button type="button" class="btn btn-outline" onclick="closePopup()">Cancel</button>' +
      '<button type="button" class="' + btnClass + '" onclick="runPendingConfirmAction()">' + (confirmLabel || "Confirm") + '</button>' +
    '</div>'
  );
}

// Helper `runPendingConfirmAction`: Executes workflow logic for `runPendingConfirmAction`.
function runPendingConfirmAction() {
  var fn = window._pendingConfirmAction;
  window._pendingConfirmAction = null;
  closePopup();
  if (typeof fn === "function") fn();
}

// `validatePersonName` (params: name, fieldLabel, allowNA, allowEmpty): Enforces letters, spaces, hyphens, apostrophes, and periods only on applicant/staff names (no digits or symbols).
function validatePersonName(name, fieldLabel, allowNA, allowEmpty) {
  var label = fieldLabel || "Name";
  var clean = String(name || "").trim();
  if (!clean) {
    if (allowEmpty) return { valid: true, message: "" };
    return { valid: false, message: label + " is required." };
  }
  if (allowNA && /^(n\/a|na|none)$/i.test(clean)) {
    return { valid: true, message: "" };
  }
  if (/\d/.test(clean)) {
    return { valid: false, message: label + " must contain letters only and cannot include numbers." };
  }
  if (!/^[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F\s.'-]*$/.test(clean) || !/[A-Za-z\u00C0-\u024F]/.test(clean)) {
    return { valid: false, message: label + " must contain valid letters only without invalid symbols." };
  }
  return { valid: true, message: "" };
}

// Validator/Check `isValidPersonName` (params: name, allowNA, allowEmpty): Evaluates rule (is valid person name) and returns result.
function isValidPersonName(name, allowNA, allowEmpty) {
  return validatePersonName(name, "Name", allowNA, allowEmpty).valid;
}

// `getMaxAdultBirthDate` (params: minAge): Computes the latest allowed YYYY-MM-DD birth date so applicants must be at least minAge (18+) years old.
function getMaxAdultBirthDate(minAge) {
  var years = typeof minAge === "number" ? minAge : 18;
  var now = new Date();
  var y = now.getFullYear() - years;
  var m = String(now.getMonth() + 1).padStart(2, "0");
  var d = String(now.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

// `validateAdultBirthDate` (params: dateStr, minAge): Validates birth date format, rejects future dates, and enforces the minimum age requirement (default 18).
function validateAdultBirthDate(dateStr, minAge) {
  var years = typeof minAge === "number" ? minAge : 18;
  var clean = String(dateStr || "").trim();
  if (!clean) {
    return { valid: false, message: "Please select your Date of Birth." };
  }
  var match = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return { valid: false, message: "Please enter a valid Date of Birth." };
  }
  var y = parseInt(match[1], 10);
  var m = parseInt(match[2], 10);
  var day = parseInt(match[3], 10);
  var dob = new Date(y, m - 1, day);
  if (dob.getFullYear() !== y || dob.getMonth() !== m - 1 || dob.getDate() !== day || y < 1900) {
    return { valid: false, message: "The Date of Birth entered is not a valid calendar date." };
  }
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  dob.setHours(0, 0, 0, 0);
  if (dob > today) {
    return { valid: false, message: "Date of Birth cannot be today or a future date." };
  }
  var age = today.getFullYear() - y;
  var monthDiff = (today.getMonth() + 1) - m;
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < day)) {
    age -= 1;
  }
  if (age < years) {
    return {
      valid: false,
      age: age,
      message: "Applicant must be at least " + years + " years old to apply (calculated age: " + Math.max(0, age) + ")."
    };
  }
  return { valid: true, age: age, message: "" };
}

// `getStaffIdentifier` (params: user): Returns `@username` (falling back to email) as the canonical assignment identifier for internal staff without email.
function getStaffIdentifier(user) {
  if (!user) return "";
  if (user.username) {
    return "@" + String(user.username).replace(/^@/, "").trim();
  }
  return String(user.email || user.full_name || "").trim();
}

// `isAssignedToStaff` (params: assignedVal, staffUser): Matches an application's `assigned_agent` string against a staff user's username or legacy email identifier.
function isAssignedToStaff(assignedVal, staffUser) {
  var val = String(assignedVal || "").trim().toLowerCase();
  if (!val || !staffUser) return false;
  var uname = String(staffUser.username || "").replace(/^@/, "").trim().toLowerCase();
  var email = String(staffUser.email || "").trim().toLowerCase();
  if (uname && (val === uname || val === "@" + uname)) return true;
  if (email && val === email) return true;
  return false;
}

// `attachEnterKeyNavigation` (params: rootEl): Binds Enter-key flow inside forms/modals so pressing Enter advances to the next input and submits on the last field.
function attachEnterKeyNavigation(rootEl) {
  if (window.__pigemEnterNavBound) return;
  window.__pigemEnterNavBound = true;
  // Event Listener: Initializes handlers or syncs state when `keydown` fires
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.altKey) return;
    var el = e.target;
    if (!el || !el.tagName) return;
    var tag = el.tagName.toUpperCase();
    if (tag !== "INPUT" && tag !== "SELECT") return;
    var inputType = String(el.type || "text").toLowerCase();
    if (inputType === "submit" || inputType === "button" || inputType === "reset" || inputType === "file" || inputType === "checkbox" || inputType === "radio") {
      return;
    }
    if (el.classList && el.classList.contains("no-enter-jump")) return;
    var scope = el.closest(".popup, form, .panel, .auth-card, main, body") || document.body;
    var rawFields = scope.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([disabled]):not([readonly]), select:not([disabled])');
    var visibleFields = [];
    for (var i = 0; i < rawFields.length; i++) {
      var f = rawFields[i];
      if (f.offsetParent !== null && !f.closest("[hidden]")) {
        visibleFields.push(f);
      }
    }
    var idx = visibleFields.indexOf(el);
    if (idx === -1) return;
    if (idx < visibleFields.length - 1) {
      e.preventDefault();
      var nextEl = visibleFields[idx + 1];
      nextEl.focus();
      if (typeof nextEl.select === "function" && nextEl.tagName.toUpperCase() === "INPUT" && nextEl.type !== "date") {
        try { nextEl.select(); } catch (err) {}
      }
      return;
    }
    var panel = el.closest(".panel");
    if (panel) {
      var nextBtn = panel.querySelector("[data-next]");
      if (nextBtn && nextBtn.offsetParent !== null) {
        e.preventDefault();
        nextBtn.focus();
      }
    }
  });
}
