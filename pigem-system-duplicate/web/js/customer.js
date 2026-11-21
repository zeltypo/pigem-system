function previousCustomerSubmissions(latest, currentScreening) {
  if (!latest || !latest.submitted_at) return [];
  var history = Array.isArray(latest.previous_submissions) ? latest.previous_submissions : [];
  var snapshot = Object.assign({}, latest);
  delete snapshot.previous_submissions;
  if (!snapshot.screening_findings && currentScreening) {
    snapshot.screening_findings =
      currentScreening.correction_findings ||
      currentScreening.background_findings ||
      (currentScreening.browser_check && currentScreening.browser_check.findings) ||
      null;
  }
  return history.concat(snapshot);
}

var currentCustomer = null;
var myApps = [];
var selectedAppId = null;

var _custQrPollTimer = null;
var _custQrLoadedUrls = { front: "", back: "" };
var custQrFrontFile = null;
var custQrBackFile = null;

function isCustomerDesktopMode() {
  var isMobileUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || "");
  return !isMobileUa && (typeof window === "undefined" || window.innerWidth > 768);
}

function updateCustomerQrButtonVisibility() {
  var btn = document.getElementById("btn-cust-phone-qr");
  if (!btn) return;
  btn.style.display = isCustomerDesktopMode() ? "inline-flex" : "none";
}

function stopCustomerPhoneQrPolling() {
  if (_custQrPollTimer) {
    clearInterval(_custQrPollTimer);
    _custQrPollTimer = null;
  }
}

async function applyCustomerQrRemoteFile(side, url) {
  if (!url || _custQrLoadedUrls[side] === url) return;
  _custQrLoadedUrls[side] = url;
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
    var file = new File([blob], "phone-id-" + side + "-corrected.jpg", { type: blob.type || "image/jpeg" });
    if (side === "front") {
      custQrFrontFile = file;
      var fnF = document.getElementById("fix-front-qr-status");
      if (fnF) fnF.innerHTML = "<b style='color:var(--good)'>Received from Phone:</b> Front ID Photo";
      var boxF = document.getElementById("fix-front-preview-box");
      var imgF = document.getElementById("fix-front-preview");
      if (boxF && imgF) { imgF.src = url; boxF.hidden = false; }
      var qfStat = document.getElementById("cust-qr-sync-front-state");
      if (qfStat) qfStat.innerHTML = "<b style='color:var(--good)'>Received!</b>";
      if (typeof clearFieldError === "function") clearFieldError("fix-file");
      checkCustomerFixPhotoQuality("front", file);
    } else {
      custQrBackFile = file;
      var fnB = document.getElementById("fix-back-qr-status");
      if (fnB) fnB.innerHTML = "<b style='color:var(--good)'>Received from Phone:</b> Back ID Photo";
      var boxB = document.getElementById("fix-back-preview-box");
      var imgB = document.getElementById("fix-back-preview");
      if (boxB && imgB) { imgB.src = url; boxB.hidden = false; }
      var qbStat = document.getElementById("cust-qr-sync-back-state");
      if (qbStat) qbStat.innerHTML = "<b style='color:var(--good)'>Received!</b>";
      if (typeof clearFieldError === "function") clearFieldError("fix-file-back");
      checkCustomerFixPhotoQuality("back", file);
    }
  } catch (e) {}
}

async function openCustomerPhoneQrModal() {
  var button = document.getElementById("btn-cust-phone-qr");
  var status = document.getElementById("cust-phone-status");
  var applicationId = selectedAppId;
  var session = getActiveSessionPair(["customer"]);
  button.disabled = true;
  status.textContent = "Creating phone link…";
  stopCustomerPhoneQrPolling();
  try {
    var link = await phoneTransfer("create", { mode: "correction", customer_id: session.id, credential: session.tok });
    if (selectedAppId !== applicationId || !button.isConnected) return;
    status.textContent = "";
    var qr = document.getElementById("cust-phone-transfer");
    qr.innerHTML = phoneTransferLinkContent(link, "Send ID photos from your phone", "Scan to upload the requested ID photos. The photos will appear here.");
    qr.hidden = false;
    document.getElementById("phone-transfer-link").focus();
    var modal = document.getElementById("popup-modal");
    var receiving = false;
    _custQrPollTimer = setInterval(async function () {
      if (!modal.isConnected || selectedAppId !== applicationId) {
        stopCustomerPhoneQrPolling();
        return;
      }
      if (receiving) return;
      receiving = true;
      try {
        var photos = await phoneTransfer("receive", { token: link.receiver });
        if (!modal.isConnected || selectedAppId !== applicationId) return;
        if (!photos.front && !photos.back) return;
        if (photos.front) await applyCustomerQrRemoteFile("front", photos.front);
        if (photos.back) await applyCustomerQrRemoteFile("back", photos.back);
        if ((photos.front && !custQrFrontFile) || (photos.back && !custQrBackFile)) return;
        stopCustomerPhoneQrPolling();
        document.getElementById("phone-transfer-status").textContent = "Photos received. Review them below, then resubmit your application.";
        phoneTransfer("finish", { token: link.receiver }).catch(function () {});
      } catch (error) {
        var message = document.getElementById("phone-transfer-status");
        if (message && modal.isConnected) message.textContent = error.message || "Waiting to reconnect…";
        if (error.message && error.message.includes("expired")) stopCustomerPhoneQrPolling();
      } finally {
        receiving = false;
      }
    }, 3000);
  } catch (error) {
    status.textContent = error.message || "Could not create a phone link. Try again.";
  } finally {
    button.disabled = false;
  }
}

async function checkCustomerFixPhotoQuality(side, file) {
  var inputId = side === "back" ? "fix-file-back" : "fix-file";
  var inputEl = document.getElementById(inputId);
  var boxId = inputId + "-quality";
  var box = document.getElementById(boxId);
  if (!box && inputEl) {
    box = document.createElement("div");
    box.id = boxId;
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    inputEl.insertAdjacentElement("afterend", box);
  }
  if (!box) return;
  if (!file) {
    box.hidden = true;
    box.textContent = "";
    return;
  }
  box.hidden = false;
  box.className = "notice mt";
  box.textContent = "Checking photo...";
  if (typeof analyzeClientIdQuality !== "function") return;
  var result = await analyzeClientIdQuality(file);
  box.className = "notice mt " + (result.passed ? "ok" : "warn");
  box.textContent = result.passed
    ? "Photo quality check passed. Check that all printed details are visible."
    : "Early quality warning: " + result.issues.join(" ") + " You can upload a clearer photo now or continue resubmitting.";
  var front = custQrFrontFile || document.getElementById("fix-file")?.files?.[0];
  var back = custQrBackFile || document.getElementById("fix-file-back")?.files?.[0];
  var duplicateBox = document.getElementById("fix-duplicate-warning");
  if (!duplicateBox) {
    duplicateBox = document.createElement("div");
    duplicateBox.id = "fix-duplicate-warning";
    duplicateBox.className = "notice warn mt";
    duplicateBox.setAttribute("role", "status");
    box.insertAdjacentElement("afterend", duplicateBox);
  }
  duplicateBox.hidden = !(await sameIdPhotoFiles(front, back));
  duplicateBox.textContent = "Warning: The selected ID photos are identical. You can upload separate photos or continue; another correction may be requested.";
}

function onCustomerLocalFixFileChange(side, inputEl) {
  if (side === "front") {
    custQrFrontFile = null;
    var stF = document.getElementById("fix-front-qr-status");
    if (stF) stF.innerHTML = "";
    var boxF = document.getElementById("fix-front-preview-box");
    var imgF = document.getElementById("fix-front-preview");
    if (boxF && imgF) {
      var f = inputEl && inputEl.files && inputEl.files[0];
      if (f) {
        imgF.src = URL.createObjectURL(f);
        boxF.hidden = false;
      } else {
        boxF.hidden = true;
      }
    }
  } else {
    custQrBackFile = null;
    var stB = document.getElementById("fix-back-qr-status");
    if (stB) stB.innerHTML = "";
    var boxB = document.getElementById("fix-back-preview-box");
    var imgB = document.getElementById("fix-back-preview");
    if (boxB && imgB) {
      var b = inputEl && inputEl.files && inputEl.files[0];
      if (b) {
        imgB.src = URL.createObjectURL(b);
        boxB.hidden = false;
      } else {
        boxB.hidden = true;
      }
    }
  }
  if (typeof showSelectedPhotoQuality === "function") showSelectedPhotoQuality(inputEl);
}

window.openDashTabById = function (tabId, targetId) {
  if (targetId && findMyApp(targetId)) {
    selectMyApp(targetId);
  }
};

window.PORTAL_ALLOWED_ROLES = ["customer"];

window.addEventListener("DOMContentLoaded", async function () {
  currentCustomer = await requireLogin(["customer"]);
  if (!currentCustomer) return;

  initDashUI(currentCustomer, myApps, function (id) { selectMyApp(id, true); });
  window.addEventListener("resize", updateCustomerQrButtonVisibility);

  await loadMyApplications();

  setInterval(async function () {
    if (document.hidden || navigator.onLine === false || document.getElementById("popup-modal")) return;
    var activeTag = document.activeElement ? document.activeElement.tagName : "";

    if (custQrFrontFile ||
        custQrBackFile ||
        _custQrPollTimer ||
        document.getElementById("fix-file")?.files?.length ||
        document.getElementById("fix-file-back")?.files?.length ||
        document.getElementById("btn-fix")?.disabled) return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(activeTag) || document.activeElement?.closest("#my-applications, #profile-drawer, #notif-modal")) return;
    await loadMyApplications();
    if (typeof refreshNotifBell === "function") refreshNotifBell(currentCustomer);
  }, 8000);
});

function showCustomerLoginUpdates() {
  if (!myApps.length || sessionStorage.getItem("pigem_show_application_updates") !== String(currentCustomer.id)) return;
  if (document.getElementById("popup-modal")) return;
  sessionStorage.removeItem("pigem_show_application_updates");
  var items = myApps.map(function (app) {
    return '<li><b>' + escapeHtml(app.reference_no || app.ref_no || "Application") + '</b> ' +
      (app.status === "Needs Correction" && !app.correction_declined
        ? '<span class="badge badge-yellow">Needs Correction</span>'
        : customerStatusBadge(app.status === "Needs Correction" ? "Processing" : app.status)) + '</li>';
  }).join("");
  openPopup(
    '<h2>Application updates</h2><ul class="customer-update-list">' + items + '</ul>' +
    '<div class="row mt"><button class="btn btn-red" type="button" onclick="closePopup()">View applications</button></div>',
    { showCloseX: true, closeOnBackdrop: true, closeOnEscape: true }
  );
}

function renderAppList() {
  var listEl = document.getElementById("cust-app-list");
  if (!listEl) return;
  if (myApps.length === 0) {
    listEl.innerHTML =
      '<div class="muted" style="padding:18px 0; text-align:center">' +
      'You have not submitted any applications yet.' +
      '</div>';
    return;
  }

  var html = myApps.map(function (app) {
    var ref = escapeHtml(app.reference_no || app.ref_no);
    var id = escapeHtml(app.id);
    var needsFix = app.status === "Needs Correction" && !app.correction_declined;
    return '<div class="q-card customer-application-row">' +
      '<div class="q-head"><div><div class="q-name">' + ref + ' · ' + escapeHtml(app.plan_name) + '</div>' +
      '<div class="q-sub">' + customerStatusBadge(app.status === "Needs Correction" ? "Processing" : app.status) + '</div></div>' +
      '<div class="row customer-application-actions">' +
      '<button type="button" class="btn btn-outline" data-view="' + id + '">View</button>' +
      (needsFix ? '<button type="button" class="btn btn-red" data-correct="' + id + '">Correct</button>' : '') +
      '</div></div></div>';
  }).join("");
  listEl.innerHTML = html;
  listEl.querySelectorAll("[data-view]").forEach(function (button) {
    button.onclick = function () { selectMyApp(button.dataset.view, true); };
  });
  listEl.querySelectorAll("[data-correct]").forEach(function (button) {
    button.onclick = function () { openCustomerCorrection(button.dataset.correct); };
  });
}

async function loadMyApplications() {
  try {
    myApps = await dbListApplicationsForCustomer(currentCustomer || "");
  } catch (e) {
    myApps = myApps || [];
  }
  if (typeof updateDashSearchApps === "function") {
    updateDashSearchApps(myApps);
  }

  renderAppList();
  showCustomerLoginUpdates();
}

function findMyApp(id) {
  for (var i = 0; i < myApps.length; i++) {
    if (myApps[i].id === id) return myApps[i];
  }
  return null;
}

function selectMyApp(id, showModal) {
  if (selectedAppId !== id) {
    stopCustomerPhoneQrPolling();
    _custQrLoadedUrls = { front: "", back: "" };
    custQrFrontFile = null;
    custQrBackFile = null;
  }
  selectedAppId = id;
  var app = findMyApp(id);
  if (showModal && app && typeof openPopup === "function") {
    var displayEmail = (app.corrected_copy && app.corrected_copy.contact_email) || app.email || "-";
    var addrStr = [app.house_no, app.street, app.subdivision, app.barangay, app.city, app.province].filter(Boolean).join(", ");
    var frontImg = app.cropped_id_url || app.id_image_url || app.id_front_path || "";
    var backImg = app.cropped_back_url || app.id_back_image_url || app.id_back_path || "";
    var modalHtml =
      '<div style="text-align:left;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding-bottom:10px;border-bottom:1px solid var(--line);margin-bottom:12px;">' +
          '<div>' +
            '<div class="muted" style="font-size:11px;text-transform:uppercase;font-weight:700;">Application Summary</div>' +
            '<h3 style="font-size:18px;margin:2px 0 0;">' + escapeHtml(app.reference_no || "-") + '</h3>' +
          '</div>' +
          '<div>' + customerStatusBadge(app.status) + '</div>' +
        '</div>' +
        '<div class="kv" style="margin-bottom:12px;">' +
          '<div><span>Selected Plan</span><b>' + escapeHtml(app.plan_name || "-") + '</b></div>' +
          '<div><span>Applicant Name</span><b>' + escapeHtml(app.full_name || "-") + '</b></div>' +
          '<div><span>Birth Date</span><b>' + escapeHtml(app.birth_date || "-") + '</b></div>' +
          '<div><span>Email Address</span><b>' + escapeHtml(displayEmail) + '</b></div>' +
          '<div><span>Mobile Number</span><b>' + escapeHtml(app.phone || "-") + '</b></div>' +
          '<div><span>Primary Valid ID</span><b>' + escapeHtml((app.id_type || "-") + " — " + (app.id_number || "-")) + '</b></div>' +
          '<div><span>Installation Address</span><b>' + escapeHtml(addrStr || "-") + '</b></div>' +
          '<div><span>Nearest Landmark</span><b>' + escapeHtml(app.landmark || "-") + '</b></div>' +
          '<div><span>Submitted Date</span><b>' + formatDate(app.created_at) + '</b></div>' +
        '</div>' +
        (app.status === "Approved" && !app.agent_remarks ? '<p class="notice good mt">Please wait 3–5 business days for installation scheduling.</p>' : '') +
        (app.status === "Rejected" && !app.agent_remarks ? '<p class="notice bad mt">Your application could not be approved. Contact PIGEM for help.</p>' : '') +
        (app.agent_remarks
          ? '<div class="msg info show" style="margin-bottom:12px;"><b>Verification Team Note:</b><br>' + escapeHtml(app.agent_remarks) + '</div>'
          : '') +
        ((frontImg || backImg)
          ? '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">' +
              (frontImg ? '<div style="border:1px solid var(--line);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:11px;font-weight:700;margin-bottom:4px;">Front of Valid ID</div><img src="' + escapeHtml(frontImg) + '" alt="Front ID" style="max-height:120px;margin:0 auto;border-radius:6px;object-fit:contain;" /></div>' : '') +
              (backImg ? '<div style="border:1px solid var(--line);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:11px;font-weight:700;margin-bottom:4px;">Back of Valid ID</div><img src="' + escapeHtml(backImg) + '" alt="Back ID" style="max-height:120px;margin:0 auto;border-radius:6px;object-fit:contain;" /></div>' : '') +
            '</div>'
          : '') +
        '<div style="display:flex;justify-content:flex-end;gap:8px;">' +
          '<button type="button" class="btn btn-outline btn-sm" onclick="closePopup()">Close</button>' +
        '</div>' +
      '</div>';
    openPopup(modalHtml, { closeOnBackdrop: true, closeOnEscape: true });
  }
}

function openCustomerCorrection(id) {
  var app = findMyApp(id);
  if (!app || app.status !== "Needs Correction" || app.correction_declined) return;
  selectMyApp(id, false);
  stopCustomerPhoneQrPolling();
  _custQrLoadedUrls = { front: "", back: "" };
  custQrFrontFile = null;
  custQrBackFile = null;
  var fields = app.correction_fields || [];
  var html = '<h2>Correct application</h2><p class="small muted mt">' +
    escapeHtml(app.reference_no || app.ref_no) + '</p><p class="notice warn mt">' +
    escapeHtml(app.agent_remarks || "Update the requested details or ID photos.") + '</p>';

  var hiName  = fields.indexOf("name") !== -1 ? 'style="border:2px solid #c8102e; background:#fff8f8; color:#1f2430; -webkit-text-fill-color:#1f2430"' : '';
  var hiBdate = fields.indexOf("birth_date") !== -1 ? 'style="border:2px solid #c8102e; background:#fff8f8; color:#1f2430; -webkit-text-fill-color:#1f2430"' : '';
  var hiEmail = fields.indexOf("email") !== -1 ? 'style="border:2px solid #c8102e; background:#fff8f8; color:#1f2430; -webkit-text-fill-color:#1f2430"' : '';
  var hiPhone = fields.indexOf("phone") !== -1 ? 'style="border:2px solid #c8102e; background:#fff8f8; color:#1f2430; -webkit-text-fill-color:#1f2430"' : '';
  var hiIdNo  = fields.indexOf("id_number") !== -1 ? 'style="border:2px solid #c8102e; background:#fff8f8; color:#1f2430; -webkit-text-fill-color:#1f2430"' : '';
  var hiAddr  = fields.indexOf("address") !== -1 ? 'style="border:2px solid #c8102e; background:#fff8f8; color:#1f2430; -webkit-text-fill-color:#1f2430"' : '';
  var photoSides = (app.screening && app.screening.correction_photo_sides) || [];
  var needsFront = fields.includes("id_photo") && (!photoSides.length || photoSides.includes("front"));
  var needsBack = fields.includes("id_photo") && (!photoSides.length || photoSides.includes("back"));
  var hiPhoto = fields.indexOf("id_photo") !== -1 ? 'style="border:2px solid #c8102e; background:#fff8f8; color:#1f2430; -webkit-text-fill-color:#1f2430; padding:8px; border-radius:8px"' : '';

  var cleanExistingMid = (app.middle_name && String(app.middle_name).toUpperCase() !== "N/A") ? app.middle_name : "";

  html +=
    '<div style="margin-top:18px; padding-top:16px; border-top:2px solid #c8102e">' +
      '<h3 style="margin-bottom:6px; color:#c8102e">Needs Correction - Submit Updated Details</h3>' +
      '<p class="muted" style="font-size:13px; margin-bottom:12px">Please update the requested field(s) or upload clear <b>Front and Back</b> photos of your Valid ID below and click <b>Resubmit Application</b> so your application can proceed to approval and installation.</p>' +
      '<div id="fix-msg" class="msg"></div>' +
      '<div class="grid-3">' +
        '<div class="field">' +
          '<label>First Name ' + (fields.indexOf("name") !== -1 ? '<span class="badge badge-red">Update</span>' : '') + '</label>' +
          '<input id="fix-fname" type="text" ' + hiName + ' value="' + escapeHtml(app.first_name || "") + '" oninput="if(typeof clearFieldError===\'function\') clearFieldError(this)" />' +
        '</div>' +
        '<div class="field">' +
          '<label>Middle Name <span class="muted">(Optional)</span></label>' +
          '<input id="fix-mname" type="text" ' + hiName + ' placeholder="Optional" value="' + escapeHtml(cleanExistingMid) + '" oninput="if(typeof clearFieldError===\'function\') clearFieldError(this)" />' +
        '</div>' +
        '<div class="field">' +
          '<label>Last Name ' + (fields.indexOf("name") !== -1 ? '<span class="badge badge-red">Update</span>' : '') + '</label>' +
          '<input id="fix-lname" type="text" ' + hiName + ' value="' + escapeHtml(app.last_name || "") + '" oninput="if(typeof clearFieldError===\'function\') clearFieldError(this)" />' +
        '</div>' +
      '</div>' +
      '<div class="grid-2">' +
        '<div class="field">' +
          '<label>Birth Date ' + (fields.indexOf("birth_date") !== -1 ? '<span class="badge badge-red">Update Required</span>' : '') + '</label>' +
          '<input id="fix-bdate" type="date" ' + hiBdate + ' value="' + escapeHtml(app.birth_date || "") + '" onchange="showSelectedPhotoQuality(this)" />' +
        '</div>' +
        '<div class="field">' +
          '<label>Primary ID Number (' + escapeHtml(app.id_type) + ') ' + (fields.indexOf("id_number") !== -1 ? '<span class="badge badge-red">Update Required</span>' : '') + '</label>' +
          '<input id="fix-idno" type="text" ' + hiIdNo + ' value="' + escapeHtml(app.id_number || "") + '" oninput="if(typeof clearFieldError===\'function\') clearFieldError(this)" />' +
        '</div>' +
      '</div>' +
      '<div class="grid-2">' +
        '<div class="field">' +
          '<label>Application Email Address ' + (fields.indexOf("email") !== -1 ? '<span class="badge badge-red">Update Required</span>' : '') + '</label>' +
          '<input id="fix-email" type="text" inputmode="email" ' + hiEmail + ' value="' + escapeHtml(displayEmail || "") + '" placeholder="Gmail username or address" oninput="if(typeof clearFieldError===\'function\') clearFieldError(this)" />' +
        '</div>' +
        '<div class="field">' +
          '<label>Mobile Number ' + (fields.indexOf("phone") !== -1 ? '<span class="badge badge-red">Update Required</span>' : '') + '</label>' +
          '<input id="fix-phone" type="text" ' + hiPhone + ' value="' + escapeHtml(app.phone || "") + '" placeholder="09XXXXXXXXX" maxlength="11" oninput="if(typeof clearFieldError===\'function\') clearFieldError(this)" />' +
        '</div>' +
      '</div>' +
      '<div class="field">' +
        '<label>Street / Barangay / City ' + (fields.indexOf("address") !== -1 ? '<span class="badge badge-red">Update Required</span>' : '') + '</label>' +
        '<input id="fix-street" type="text" ' + hiAddr + ' value="' + escapeHtml(app.street || "") + '" oninput="if(typeof clearFieldError===\'function\') clearFieldError(this)" />' +
      '</div>' +
      '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px">' +
        '<div>' +
          '<b style="font-size:13.5px">Valid ID Photos (Front &amp; Back)</b>' +
          '<div class="tiny muted">Upload clear photos from this computer or scan the QR code to capture with your phone.</div>' +
        '</div>' +
        '<button type="button" id="btn-cust-phone-qr" class="btn btn-red btn-sm" style="display:' + (isCustomerDesktopMode() ? 'inline-flex' : 'none') + '; align-items:center; gap:6px" onclick="openCustomerPhoneQrModal()">' +
          '<img data-img="icons/qr-phone.png" src="/api/assets/icons/qr-phone.png" alt="" class="icon-img" style="width:16px;height:16px" /> Upload ID photos from phone' +
        '</button>' +
      '</div>' +
      '<p id="cust-phone-status" class="small muted" role="status"></p><div id="cust-phone-transfer" class="notice mt" hidden></div>' +
      '<div class="grid-2" ' + hiPhoto + '>' +
        '<div class="field" style="margin-bottom:0">' +
          '<label for="fix-file">Front of Valid ID Photo ' + (needsFront ? '<span class="badge badge-red">Upload Clear Front</span>' : '(Optional)') + '</label>' +
          '<input id="fix-file" type="file" accept="image/*" onchange="onCustomerLocalFixFileChange(\'front\', this)" />' +
          '<div id="fix-front-qr-status" class="small" style="margin-top:4px"></div>' +
          '<div id="fix-front-preview-box" class="mt" hidden>' +
            '<img id="fix-front-preview" alt="Front ID Preview" style="max-height:110px; border-radius:6px; border:1px solid var(--line); object-fit:contain" />' +
          '</div>' +
          '<div class="tiny muted" style="margin-top:3px">Clear, well-lit photo of the Front side showing your name, photo, and ID number.</div>' +
        '</div>' +
        '<div class="field" style="margin-bottom:0">' +
          '<label for="fix-file-back">Back of Valid ID Photo ' + (needsBack ? '<span class="badge badge-red">Upload Clear Back</span>' : '(Optional)') + '</label>' +
          '<input id="fix-file-back" type="file" accept="image/*" onchange="onCustomerLocalFixFileChange(\'back\', this)" />' +
          '<div id="fix-back-qr-status" class="small" style="margin-top:4px"></div>' +
          '<div id="fix-back-preview-box" class="mt" hidden>' +
            '<img id="fix-back-preview" alt="Back ID Preview" style="max-height:110px; border-radius:6px; border:1px solid var(--line); object-fit:contain" />' +
          '</div>' +
          '<div class="tiny muted" style="margin-top:3px">Clear, well-lit photo of the Back side of the same Valid ID card.</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">' +
        '<button id="btn-fix" type="button" class="btn btn-red" style="flex:1;min-width:220px;" onclick="submitCustomerCorrection(\'' + escapeHtml(app.id) + '\')">Resubmit Application</button>' +
      '</div>' +
    '</div>';

  openPopup(html, { wide: true, showCloseX: true, closeOnBackdrop: false, closeOnEscape: true });
  updateCustomerQrButtonVisibility();
}

function confirmDeclineCorrection(appId) {
  var app = findMyApp(appId);
  if (!app || typeof openPopup !== "function") return;
  openPopup(
    '<div style="padding:4px 2px;">' +
      '<h3 style="color:#b42318;margin-bottom:6px;">Confirm Declining Correction</h3>' +
      '<p class="small" style="line-height:1.6;margin-bottom:12px;">Are you sure? It is better to submit the requested correction so your application (<b>' + escapeHtml(app.reference_no || app.ref_no) + '</b>) can proceed cleanly instead of being closed.</p>' +
      '<div class="field" style="margin-bottom:14px;">' +
        '<label for="decline-correction-reason">Reason (Optional)</label>' +
        '<textarea id="decline-correction-reason" rows="2" placeholder="Optional reason for choosing not to correct..."></textarea>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;">' +
        '<button type="button" class="btn btn-outline btn-sm" onclick="closePopup()">Keep Application &amp; Edit</button>' +
        '<button type="button" class="btn btn-red btn-sm" onclick="executeDeclineCorrection(\'' + escapeHtml(appId) + '\')">Yes, Close Application</button>' +
      '</div>' +
    '</div>',
    { showCloseX: true, closeOnBackdrop: true }
  );
}

async function executeDeclineCorrection(appId) {
  var app = findMyApp(appId);
  if (!app) return;
  var reasonEl = document.getElementById("decline-correction-reason");
  var reason = reasonEl ? reasonEl.value.trim() : "";
  try {
    await dbDeclineApplicationCorrection(appId, reason);
    var targetEmail = (app.corrected_copy && app.corrected_copy.contact_email) || app.email;
    if (targetEmail && typeof apiSendStatusEmail === "function") {
      await apiSendStatusEmail(
        targetEmail,
        app.full_name || "Customer",
        app.reference_no || app.ref_no,
        "Rejected",
        reason || "Customer chose not to submit the requested correction."
      );
    }
    closePopup();
    showAlert("Application Closed", "Your application " + escapeHtml(app.reference_no || app.ref_no) + " has been closed as requested.");
    await loadMyApplications();
  } catch (err) {
    closePopup();
    showAlert("Action Failed", escapeHtml(err.message || "Could not close application."), "bad");
  }
}

async function submitCustomerCorrection(appId) {
  var app = findMyApp(appId);
  if (!app) return;

  var btn = document.getElementById("btn-fix");
  hideMsg("fix-msg");
  if (typeof clearAllFieldErrors === "function") clearAllFieldErrors();

  try {
    var oldName = String(app.full_name || "").trim();
    var oldBdate = String(app.birth_date || "").trim();
    var oldEmail = String((app.corrected_copy && app.corrected_copy.contact_email) || app.email || "").trim().toLowerCase();
    var oldPhone = String(app.phone || "").trim();
    var oldIdNo = String(app.id_number || "").trim();
    var oldStreet = String(app.street || "").trim();

    var fname = document.getElementById("fix-fname").value.trim();
    var mname = document.getElementById("fix-mname") ? document.getElementById("fix-mname").value.trim() : "";
    var lname = document.getElementById("fix-lname").value.trim();
    var cleanMid = (mname && mname.toUpperCase() !== "N/A") ? mname : "";
    var fullName = [fname, cleanMid, lname].filter(Boolean).join(" ").trim();
    var bdate = document.getElementById("fix-bdate") ? document.getElementById("fix-bdate").value : oldBdate;
    var emailInput = document.getElementById("fix-email");
    var newEmail = emailInput.value.trim().toLowerCase() || oldEmail;
    if (/^[a-z0-9][a-z0-9._+-]*$/.test(newEmail)) newEmail += "@gmail.com";
    emailInput.value = newEmail;
    var phone = document.getElementById("fix-phone").value.trim() || app.phone;
    var idNo = document.getElementById("fix-idno").value.trim() || app.id_number;
    var street = document.getElementById("fix-street").value.trim() || app.street;

    var fileInput = document.getElementById("fix-file");
    var file = (fileInput && fileInput.files && fileInput.files[0]) || custQrFrontFile || null;
    var fileBackInput = document.getElementById("fix-file-back");
    var fileBack = (fileBackInput && fileBackInput.files && fileBackInput.files[0]) || custQrBackFile || null;

    var hasErr = false;
    var fnCheck = typeof validatePersonName === "function" ? validatePersonName(fname, "First Name", false, false) : { valid: Boolean(fname) };
    if (!fnCheck.valid) { setFieldError("fix-fname", fnCheck.message || "First Name is required."); hasErr = true; }
    var mnCheck = typeof validatePersonName === "function" ? validatePersonName(cleanMid, "Middle Name", false, true) : { valid: true };
    if (!mnCheck.valid) { setFieldError("fix-mname", mnCheck.message); hasErr = true; }
    var lnCheck = typeof validatePersonName === "function" ? validatePersonName(lname, "Last Name", false, false) : { valid: Boolean(lname) };
    if (!lnCheck.valid) { setFieldError("fix-lname", lnCheck.message || "Last Name is required."); hasErr = true; }
    var bdCheck = typeof validateAdultBirthDate === "function" ? validateAdultBirthDate(bdate, 18) : { valid: Boolean(bdate) };
    if (!bdCheck.valid) { setFieldError("fix-bdate", bdCheck.message || "Applicant must be at least 18 years old."); hasErr = true; }
    if (!/^09\d{9}$/.test(phone)) { setFieldError("fix-phone", "Mobile number must be 11 digits starting with 09."); hasErr = true; }

    var fields = app.correction_fields || [];
    if (fields.indexOf("name") !== -1 && fullName === oldName && !file && !fileBack) {
      setFieldError("fix-fname", "Update your Name to match your Valid ID or upload a new photo.");
      hasErr = true;
    }
    if (fields.indexOf("birth_date") !== -1 && bdate === oldBdate && !file && !fileBack) {
      setFieldError("fix-bdate", "Update your Birth Date to match your Valid ID.");
      hasErr = true;
    }
    if (newEmail !== oldEmail && typeof isCustomerGmail === "function" && !isCustomerGmail(newEmail)) {
      setFieldError("fix-email", "Customer email updates must use a valid @gmail.com address.");
      hasErr = true;
    }
    if (fields.indexOf("email") !== -1 && fields.indexOf("phone") === -1 && newEmail === oldEmail) {
      setFieldError("fix-email", "Please enter an updated @gmail.com Email Address.");
      hasErr = true;
    }
    if (fields.indexOf("phone") !== -1 && fields.indexOf("email") === -1 && phone === oldPhone) {
      setFieldError("fix-phone", "Please enter an updated Mobile Number.");
      hasErr = true;
    }
    var requestedSides = (app.screening && app.screening.correction_photo_sides) || [];
    if (fields.includes("id_photo") && requestedSides.includes("front") && !file) {
      setFieldError("fix-file", "Upload a clearer photo of the front of your ID.");
      hasErr = true;
    }
    if (fields.includes("id_photo") && requestedSides.includes("back") && !fileBack) {
      setFieldError("fix-file-back", "Upload a clearer photo of the back of your ID.");
      hasErr = true;
    }
    if (fields.indexOf("id_photo") !== -1 && !requestedSides.length && !file && !fileBack) {
      setFieldError("fix-file", "Please upload a clearer Front and/or Back photo of your Valid ID before resubmitting.");
      hasErr = true;
    }
    if (hasErr) return;
    var earlyQualityWarnings = [];
    if (await sameIdPhotoFiles(file, fileBack)) earlyQualityWarnings.push("Front and back ID photos are identical. Separate photos are recommended.");
    for (var item of [{ file: file, side: "Front", id: "fix-file" }, { file: fileBack, side: "Back", id: "fix-file-back" }]) {
      if (!item.file || typeof analyzeClientIdQuality !== "function") continue;
      var quality = await analyzeClientIdQuality(item.file);
      if (!quality.passed && Array.isArray(quality.issues) && quality.issues.length) {
        earlyQualityWarnings.push(item.side + " ID: " + quality.issues.join(" "));
      }
    }

    var changedList = [];
    if (fullName !== oldName) changedList.push("Name (" + fullName + ")");
    if (bdate !== oldBdate) changedList.push("Birth Date (" + bdate + ")");
    if (newEmail !== oldEmail) changedList.push("Email Address (" + newEmail + ")");
    if (phone !== oldPhone) changedList.push("Mobile Number (" + phone + ")");
    if (idNo !== oldIdNo) changedList.push("ID Number (" + idNo + ")");
    if (street !== oldStreet) changedList.push("Address");
    if (file) changedList.push("New Front Valid ID Photo");
    if (fileBack) changedList.push("New Back Valid ID Photo");
    if (changedList.length === 0) {
      showMsg("fix-msg", "error", "No changes detected. Please update the requested detail or upload clearer Front / Back Valid ID photos.");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Submitting Update...";

    var existingOrig = (app.original_submission && app.original_submission.full_name)
      ? app.original_submission
      : ((app.original_copy && app.original_copy.full_name) ? app.original_copy : null);
    var orig = existingOrig ? Object.assign({}, existingOrig) : {
      full_name: app.full_name,
      first_name: app.first_name,
      middle_name: app.middle_name,
      last_name: app.last_name,
      birth_date: app.birth_date,
      email: app.email,
      contact_email: app.email,
      phone: app.phone,
      id_type: app.id_type,
      id_number: app.id_number,
      house_no: app.house_no,
      building_name: app.building_name,
      street: app.street,
      subdivision: app.subdivision,
      barangay: app.barangay,
      city: app.city,
      province: app.province,
      landmark: app.landmark,
      latitude: app.latitude != null ? app.latitude : app.lat,
      longitude: app.longitude != null ? app.longitude : app.lng,
      id_image_url: app.id_image_url || app.id_front_path || "",
      id_front_path: app.id_front_path || app.id_image_url || "",
      id_back_image_url: app.id_back_image_url || app.id_back_path || "",
      id_back_path: app.id_back_path || app.id_back_image_url || "",
      submitted_at: app.created_at
    };
    if (!orig.screening_findings && app.screening && !app.has_correction) {
      orig.screening_findings =
        app.screening.correction_findings ||
        app.screening.background_findings ||
        (app.screening.browser_check && app.screening.browser_check.findings) ||
        null;
    }

    var idUrl = app.id_image_url || app.id_front_path;
    var idBackUrl = app.id_back_image_url || app.id_back_path || "";
    var ownerId = app.customer_id || (currentCustomer && currentCustomer.id);
    var refTag = app.reference_no || app.ref_no || "app";
    if (file) {
      idUrl = await dbUploadIdPhoto(file, refTag + "-front-corrected", ownerId);
    }
    if (fileBack) {
      idBackUrl = await dbUploadIdPhoto(fileBack, refTag + "-back-corrected", ownerId);
    }

    var correctedSnapshot = {
      previous_submissions: previousCustomerSubmissions(app.corrected_copy, app.screening),
      requested_fields: Array.isArray(app.correction_fields) ? app.correction_fields : [],
      reviewed_findings: (app.screening && app.screening.correction_findings) || null,
      id_type: app.id_type,
      full_name: fullName,
      first_name: fname,
      middle_name: cleanMid,
      last_name: lname,
      birth_date: bdate,
      contact_email: newEmail,
      phone: phone,
      id_number: idNo,
      house_no: app.house_no,
      building_name: app.building_name,
      street: street,
      subdivision: app.subdivision,
      barangay: app.barangay,
      city: app.city,
      province: app.province,
      landmark: app.landmark,
      latitude: app.latitude != null ? app.latitude : app.lat,
      longitude: app.longitude != null ? app.longitude : app.lng,
      id_image_url: idUrl,
      id_front_path: idUrl,
      id_back_image_url: idBackUrl,
      id_back_path: idBackUrl,
      changed_fields: changedList,
      submitted_at: new Date().toISOString()
    };

    var updatedScreening = {
      state: "queued",
      background_state: "queued",
      phase: "Waiting for document check",
      eta_seconds: 0,
      fallback_original_only: false,
      upload_photo_warning: earlyQualityWarnings.length > 0,
      early_quality_warnings: earlyQualityWarnings,
      openai_response_id: (app.screening && app.screening.openai_response_id) || "",
      flagged_front_sha256: app.screening && app.screening.flagged_front_sha256,
      flagged_back_sha256: app.screening && app.screening.flagged_back_sha256,
      last_customer_changes: changedList
    };

    var resumeStatus = app.assigned_agent ? "Under Agent Review" : "Pending Review";

    await dbUpdateApplication(app.id, {
      first_name: fname,
      middle_name: cleanMid,
      last_name: lname,
      full_name: fullName,
      customer_name: fullName,
      birth_date: bdate,
      phone: phone,
      id_number: idNo,
      street: street,
      id_front_path: idUrl,
      id_image_url: idUrl,
      id_back_path: idBackUrl,
      id_back_image_url: idBackUrl,
      id_cropped_url: file ? "" : (app.id_cropped_url || ""),
      cropped_id_path: file ? "" : (app.cropped_id_path || ""),
      id_back_cropped_url: fileBack ? "" : (app.id_back_cropped_url || ""),
      ai_result: null,
      screening: updatedScreening,
      original_copy: orig,
      original_submission: orig,
      corrected_copy: correctedSnapshot,
      has_correction: true,
      status: resumeStatus,
      correction_note: "Customer updated: " + changedList.join(", "),
      customer_instruction: "Your updated details (" + changedList.join(", ") + ") were received and your application is continuing in Processing.",
      agent_remarks: "Customer submitted update: " + changedList.join(", ")
    }, app.updated_at);

    if ((file || fileBack) && typeof dbCreateDocumentRecord === "function") {
      await dbCreateDocumentRecord(app.id, {
        id_type: app.id_type || "",
        id_number: idNo || app.id_number || "",
        front_image_url: idUrl,
        back_image_url: idBackUrl,
        doc_type: "valid_id",
        file_path: idUrl,
        version: "corrected"
      });
    }

    await dbAddAiLog(
      app.id,
      app.reference_no,
      "Customer (" + fullName + ")",
      "Submitted requested update (" + changedList.join(", ") + "). Returned to Processing."
    );

    await dbAddNotification({
      user_id: app.assigned_agent || null,
      role: "agent",
      title: "Customer Update Submitted: " + app.reference_no,
      message: fullName + " updated " + changedList.join(", ") + " for " + app.reference_no + ".",
      target_tab: "tab-queue",
      target_id: app.id
    });

    await dbAddLog(currentCustomer.email, "Customer submitted update (" + changedList.join(", ") + ") for " + app.reference_no);
    stopCustomerPhoneQrPolling();
    _custQrLoadedUrls = { front: "", back: "" };
    custQrFrontFile = null;
    custQrBackFile = null;
    showAlert("Update Received", "Thank you! Your updates (" + changedList.join(", ") + ") have been submitted and your application continues in Processing.");
    await loadMyApplications();
  } catch (err) {
    showMsg("fix-msg", "error", err.message || "Could not submit update.");
    btn.disabled = false;
    btn.textContent = "Resubmit Application";
  }
}
