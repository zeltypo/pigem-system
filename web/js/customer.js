var currentCustomer = null;
var myApps = [];
var selectedAppId = null;
var hasShownCorrectionLoginPopup = false;

window.openDashTabById = function (tabId, targetId) {
  if (targetId && findMyApp(targetId)) {
    selectMyApp(targetId);
  }
};

window.addEventListener("DOMContentLoaded", async function () {
  currentCustomer = await requireLogin(["customer"]);
  if (!currentCustomer) return;

  document.getElementById("cust-name").textContent = currentCustomer.full_name;
  await loadMyApplications();
  initDashUI(currentCustomer, myApps, selectMyApp);

  setInterval(async function () {
    var activeTag = document.activeElement ? document.activeElement.tagName : "";
    if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") return;
    await loadMyApplications();
    if (typeof refreshNotifBell === "function") refreshNotifBell(currentCustomer);
  }, 8000);
});

function promptCustomerCorrectionReminder(apps) {
  var pendingFixes = (apps || []).filter(function (a) {
    return a.status === "Needs Correction" && !a.correction_declined;
  });
  var banner = document.getElementById("cust-correction-banner");
  if (banner) {
    if (pendingFixes.length === 0) {
      banner.classList.add("hidden");
      banner.innerHTML = "";
    } else {
      var linksHtml = pendingFixes.map(function (a) {
        return '<button type="button" class="btn btn-red btn-sm" onclick="selectMyApp(\'' + escapeHtml(a.id) + '\')">Open ' + escapeHtml(a.reference_no || a.ref_no) + '</button>';
      }).join(" ");
      banner.classList.remove("hidden");
      banner.innerHTML =
        '<div class="notice" style="background:#fff7ed;border:1.5px solid #fb923c;color:#7c2d12;padding:14px 16px;border-radius:12px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">' +
            '<div>' +
              '<b>Action Needed: ' + pendingFixes.length + ' Application(s) Require Correction</b>' +
              '<div class="small" style="margin-top:4px;line-height:1.5;">Please review and submit the requested updates below. Follow-up email reminders are sent at <b>24 hours</b> (initial) and <b>72 hours</b> (final notice) if left unaddressed, or you may select <i>&ldquo;I choose not to correct&rdquo;</i>.</div>' +
            '</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + linksHtml + '</div>' +
          '</div>' +
        '</div>';
    }
  }

  if (!hasShownCorrectionLoginPopup && pendingFixes.length > 0 && typeof openPopup === "function") {
    hasShownCorrectionLoginPopup = true;
    var listItems = pendingFixes.map(function (a) {
      return '<div style="padding:8px 10px;border:1px solid #fed7aa;background:#fffaf5;border-radius:8px;margin-bottom:8px;">' +
        '<b>' + escapeHtml(a.reference_no || a.ref_no) + '</b> (' + escapeHtml(a.plan_name || "") + ')<br>' +
        '<span class="small" style="color:#7c2d12;">' + escapeHtml(a.agent_remarks || "Please update the flagged details or Valid ID photo.") + '</span>' +
      '</div>';
    }).join("");
    openPopup(
      '<div style="padding:4px 2px;">' +
        '<h3 style="color:#b42318;margin-bottom:6px;">Application Correction Reminder</h3>' +
        '<p class="small muted" style="margin-bottom:12px;">You have <b>' + pendingFixes.length + '</b> application(s) in <b>Needs Correction</b> status:</p>' +
        listItems +
        '<p class="small muted" style="margin:8px 0 14px;line-height:1.5;">Email reminders are sent 24 hours and 72 hours after a correction notice. Please update the requested fields or choose not to proceed.</p>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;">' +
          '<button type="button" class="btn btn-red btn-sm" onclick="selectMyApp(\'' + escapeHtml(pendingFixes[0].id) + '\'); closePopup();">Review &amp; Update Now</button>' +
        '</div>' +
      '</div>',
      { showCloseX: true, closeOnBackdrop: true }
    );
  }
}

function renderAppList() {
  var listEl = document.getElementById("cust-app-list");
  if (!listEl) return;
  if (myApps.length === 0) {
    listEl.innerHTML =
      '<div class="muted" style="padding:18px 0; text-align:center">' +
      'You have not submitted any applications yet.<br><br>' +
      '<a href="apply.html" target="_blank" class="btn btn-red btn-sm">Apply Now</a>' +
      '</div>';
    return;
  }

  var html = "";
  for (var j = 0; j < myApps.length; j++) {
    var a = myApps[j];
    var isSel = a.id === selectedAppId;
    html +=
      '<div class="q-card" style="cursor:pointer; border-color:' + (isSel ? "#c8102e" : "var(--line)") + '" onclick="selectMyApp(\'' + escapeHtml(a.id) + '\')">' +
        '<div class="q-head">' +
          '<div>' +
            '<div class="q-name">' + escapeHtml(a.reference_no) + ' - ' + escapeHtml(a.plan_name) + '</div>' +
            '<div class="q-sub">' + customerStatusBadge(a.status) + ' - Submitted ' + formatDate(a.created_at) + '</div>' +
          '</div>' +
          '<span class="btn btn-outline btn-sm">View -></span>' +
        '</div>' +
      '</div>';
  }
  listEl.innerHTML = html;
}

async function loadMyApplications() {
  myApps = await dbListApplicationsForCustomer(currentCustomer.email);

  var proc = 0, done = 0, rej = 0;
  for (var i = 0; i < myApps.length; i++) {
    var vis = getCustomerStatus(myApps[i].status);
    if (vis === "Approved") done++;
    else if (vis === "Rejected") rej++;
    else proc++;
  }
  document.getElementById("st-total").textContent = myApps.length;
  document.getElementById("st-proc").textContent = proc;
  document.getElementById("st-done").textContent = done;
  var rejEl = document.getElementById("st-rej");
  if (rejEl) rejEl.textContent = rej;

  promptCustomerCorrectionReminder(myApps);

  if (myApps.length === 0) {
    renderAppList();
    return;
  }

  if (!selectedAppId || !findMyApp(selectedAppId)) {
    selectedAppId = myApps[0].id;
  }

  renderAppList();
  renderSelectedApp();
}

function findMyApp(id) {
  for (var i = 0; i < myApps.length; i++) {
    if (myApps[i].id === id) return myApps[i];
  }
  return null;
}

function selectMyApp(id) {
  selectedAppId = id;
  renderAppList();
  renderSelectedApp();
}

function renderSelectedApp() {
  var box = document.getElementById("cust-detail-box");
  var app = findMyApp(selectedAppId);
  if (!app) {
    box.innerHTML = '<p class="muted">Select an application on the left to view its details.</p>';
    return;
  }

  var visStatus = getCustomerStatus(app.status);
  var needsFix = (app.status === "Needs Correction");
  var fields = app.correction_fields || [];

  var fieldLabelsMap = {
    name: "Applicant Name",
    birth_date: "Birth Date",
    email: "Email Address",
    phone: "Mobile Number",
    id_photo: "Valid ID Photo",
    id_number: "Primary ID Number",
    address: "Installation Address"
  };
  var flaggedBadges = fields.map(function (f) {
    return '<span class="badge badge-red" style="margin-right:6px">Update Required: ' + escapeHtml(fieldLabelsMap[f] || f) + '</span>';
  }).join("");

  var guideBox = "";
  if (visStatus === "Approved") {
    guideBox =
      '<div class="msg ok show" style="margin-bottom:16px">' +
        '<b>Application Approved!</b><br>' +
        'Your application has been approved. <b>Please wait 3-5 business days</b> for installation scheduling and dispatch coordination.' +
        (app.agent_remarks ? '<div style="margin-top:6px">Note: ' + escapeHtml(app.agent_remarks) + '</div>' : '') +
      '</div>';
  } else if (visStatus === "Rejected") {
    guideBox =
      '<div class="msg error show" style="margin-bottom:16px">' +
        '<b>Application Rejected:</b><br>' +
        escapeHtml(app.agent_remarks || "Your application could not be approved. Please review the note above or contact PIGEM support.") +
      '</div>';
  } else {

    if (needsFix) {
      guideBox =
        '<div class="msg info show" style="margin-bottom:10px">' +
          '<b>Status: Processing (Needs Correction)</b> - Your application is currently in processing, and a quick update is needed before we can proceed. Follow-up email reminders are automatically scheduled at <b>24 hours</b> (initial) and <b>72 hours</b> (final notice) if left unaddressed.' +
        '</div>' +
        '<div class="msg error show" style="margin-bottom:16px">' +
          '<b>Update Requested:</b><br>' +
          escapeHtml(app.agent_remarks || "Please update the highlighted information or upload a clearer Valid ID below and click Resubmit.") +
          (flaggedBadges ? '<div style="margin-top:8px">' + flaggedBadges + '</div>' : '') +
        '</div>';
    } else {
      guideBox =
        '<div class="msg info show" style="margin-bottom:16px">' +
          '<b>Application Processing:</b><br>' +
          'Your application is currently being reviewed and processed. You will receive an email notification once there is an update.' +
        '</div>';
    }
  }

  var displayEmail = (app.corrected_copy && app.corrected_copy.contact_email) || app.email;

  var html =
    '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px">' +
      '<div>' +
        '<div class="muted" style="font-size:12px">Reference Number</div>' +
        '<h2 style="font-size:20px">' + escapeHtml(app.reference_no) + '</h2>' +
      '</div>' +
      '<div>' + customerStatusBadge(app.status) + '</div>' +
    '</div>' +
    guideBox +
    '<div class="kv">' +
      '<div><span>Selected Plan</span><b>' + escapeHtml(app.plan_name) + '</b></div>' +
      '<div><span>Applicant Name</span><b>' + escapeHtml(app.full_name) + '</b></div>' +
      '<div><span>Birth Date</span><b>' + escapeHtml(app.birth_date || "-") + '</b></div>' +
      '<div><span>Application Email</span><b>' + escapeHtml(displayEmail) + '</b></div>' +
      '<div><span>Mobile Number</span><b>' + escapeHtml(app.phone) + '</b></div>' +
      '<div><span>Primary ID</span><b>' + escapeHtml(app.id_type) + ' - ' + escapeHtml(app.id_number) + '</b></div>' +
      '<div><span>Service Address</span><b>' + escapeHtml((app.street || "") + ", " + (app.barangay || "") + ", " + (app.city || "") + ", " + (app.province || "")) + '</b></div>' +
      '<div><span>Nearest Landmark</span><b>' + escapeHtml(app.landmark || "-") + '</b></div>' +
    '</div>';

  if (needsFix) {
    var hiName  = fields.indexOf("name") !== -1 ? 'style="border:2px solid #c8102e; background:#fff8f8"' : '';
    var hiBdate = fields.indexOf("birth_date") !== -1 ? 'style="border:2px solid #c8102e; background:#fff8f8"' : '';
    var hiEmail = fields.indexOf("email") !== -1 ? 'style="border:2px solid #c8102e; background:#fff8f8"' : '';
    var hiPhone = fields.indexOf("phone") !== -1 ? 'style="border:2px solid #c8102e; background:#fff8f8"' : '';
    var hiIdNo  = fields.indexOf("id_number") !== -1 ? 'style="border:2px solid #c8102e; background:#fff8f8"' : '';
    var hiAddr  = fields.indexOf("address") !== -1 ? 'style="border:2px solid #c8102e; background:#fff8f8"' : '';
    var hiPhoto = fields.indexOf("id_photo") !== -1 ? 'style="border:2px solid #c8102e; background:#fff8f8; padding:8px; border-radius:8px"' : '';

    var cleanExistingMid = (app.middle_name && String(app.middle_name).toUpperCase() !== "N/A") ? app.middle_name : "";

    html +=
      '<div style="margin-top:18px; padding-top:16px; border-top:2px solid #c8102e">' +
        '<h3 style="margin-bottom:6px; color:#c8102e">Needs Correction - Submit Updated Details</h3>' +
        '<p class="muted" style="font-size:13px; margin-bottom:12px">Update the requested field(s) below and click <b>Resubmit Application</b> to continue <b>Processing</b> your application, or choose not to proceed.</p>' +
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
            '<input id="fix-bdate" type="date" ' + hiBdate + ' value="' + escapeHtml(app.birth_date || "") + '" onchange="if(typeof clearFieldError===\'function\') clearFieldError(this)" />' +
          '</div>' +
          '<div class="field">' +
            '<label>Primary ID Number (' + escapeHtml(app.id_type) + ') ' + (fields.indexOf("id_number") !== -1 ? '<span class="badge badge-red">Update Required</span>' : '') + '</label>' +
            '<input id="fix-idno" type="text" ' + hiIdNo + ' value="' + escapeHtml(app.id_number || "") + '" oninput="if(typeof clearFieldError===\'function\') clearFieldError(this)" />' +
          '</div>' +
        '</div>' +
        '<div class="grid-2">' +
          '<div class="field">' +
            '<label>Application Email Address ' + (fields.indexOf("email") !== -1 ? '<span class="badge badge-red">Update Required</span>' : '') + '</label>' +
            '<input id="fix-email" type="email" ' + hiEmail + ' value="' + escapeHtml(displayEmail || "") + '" placeholder="Enter an alternate email if requested..." oninput="if(typeof clearFieldError===\'function\') clearFieldError(this)" />' +
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
        '<div class="field" ' + hiPhoto + '>' +
          '<label>Upload Clearer Valid ID Photo ' + (fields.indexOf("id_photo") !== -1 ? '<span class="badge badge-red">New Photo Required</span>' : '(Optional)') + '</label>' +
          '<input id="fix-file" type="file" accept="image/*" onchange="if(typeof clearFieldError===\'function\') clearFieldError(this)" />' +
        '</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;">' +
          '<button id="btn-fix" type="button" class="btn btn-red" style="flex:1;min-width:200px;" onclick="submitCustomerCorrection(\'' + escapeHtml(app.id) + '\')">Resubmit Application</button>' +
          '<button type="button" class="btn btn-outline" onclick="confirmDeclineCorrection(\'' + escapeHtml(app.id) + '\')">I choose not to correct</button>' +
        '</div>' +
      '</div>';
  }

  box.innerHTML = html;
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
    var newEmail = document.getElementById("fix-email").value.trim().toLowerCase() || oldEmail;
    var phone = document.getElementById("fix-phone").value.trim() || app.phone;
    var idNo = document.getElementById("fix-idno").value.trim() || app.id_number;
    var street = document.getElementById("fix-street").value.trim() || app.street;

    var fileInput = document.getElementById("fix-file");
    var file = fileInput && fileInput.files && fileInput.files[0];

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
    if (fields.indexOf("name") !== -1 && fullName === oldName && !file) {
      setFieldError("fix-fname", "Update your Name to match your Valid ID or upload a new photo.");
      hasErr = true;
    }
    if (fields.indexOf("birth_date") !== -1 && bdate === oldBdate && !file) {
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
    if (fields.indexOf("id_photo") !== -1 && !file) {
      setFieldError("fix-file", "Please upload a clearer photo of your Valid ID before resubmitting.");
      hasErr = true;
    }
    if (hasErr) return;

    var changedList = [];
    if (fullName !== oldName) changedList.push("Name (" + fullName + ")");
    if (bdate !== oldBdate) changedList.push("Birth Date (" + bdate + ")");
    if (newEmail !== oldEmail) changedList.push("Email Address (" + newEmail + ")");
    if (phone !== oldPhone) changedList.push("Mobile Number (" + phone + ")");
    if (idNo !== oldIdNo) changedList.push("ID Number (" + idNo + ")");
    if (street !== oldStreet) changedList.push("Address");
    if (file) changedList.push("New Valid ID Photo");
    if (changedList.length === 0) {
      showMsg("fix-msg", "error", "No changes detected. Please update the requested detail or upload a clearer ID photo.");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Submitting Update...";

    var orig = app.original_submission || app.original_copy || {
      full_name: app.full_name,
      first_name: app.first_name,
      middle_name: app.middle_name,
      last_name: app.last_name,
      birth_date: app.birth_date,
      email: app.email,
      phone: app.phone,
      id_type: app.id_type,
      id_number: app.id_number,
      street: app.street,
      id_image_url: app.id_image_url
    };

    var idUrl = app.id_image_url || app.id_front_path;
    if (file) {
      idUrl = await dbUploadIdPhoto(file, (app.reference_no || app.ref_no || "app") + "-corrected", app.customer_id || (currentCustomer && currentCustomer.id));
    }

    var correctedSnapshot = {
      full_name: fullName,
      first_name: fname,
      middle_name: cleanMid,
      last_name: lname,
      birth_date: bdate,
      contact_email: newEmail,
      phone: phone,
      id_number: idNo,
      street: street,
      id_image_url: idUrl,
      changed_fields: changedList,
      submitted_at: new Date().toISOString()
    };

    var updatedScreening = Object.assign({}, app.screening || {}, {
      state: isAiEnabled() ? "queued" : "paused",
      phase: isAiEnabled() ? "Re-screening Updated Submission" : "Manual Review Active",
      eta_seconds: isAiEnabled() ? 30 : 0,
      correction_fields: [],
      auto_correction_sent: false,
      last_customer_changes: changedList
    });

    var resumeStatus = app.assigned_agent ? "Under Agent Review" : "Pending Review";

    await dbUpdateApplication(app.id, {
      first_name: fname,
      middle_name: cleanMid,
      last_name: lname,
      full_name: fullName,
      birth_date: bdate,
      phone: phone,
      id_number: idNo,
      street: street,
      id_front_path: idUrl,
      id_image_url: idUrl,
      screening: updatedScreening,
      original_copy: orig,
      original_submission: orig,
      corrected_copy: correctedSnapshot,
      has_correction: true,
      status: resumeStatus,
      correction_note: "Customer updated: " + changedList.join(", "),
      customer_instruction: "Your updated details (" + changedList.join(", ") + ") were received and your application is continuing in Processing.",
      agent_remarks: "Customer submitted update: " + changedList.join(", ")
    });

    if (file && typeof dbCreateDocumentRecord === "function") {
      await dbCreateDocumentRecord(app.id, {
        id_type: app.id_type || "",
        id_number: idNo || app.id_number || "",
        front_image_url: idUrl,
        back_image_url: app.id_back_image_url || app.id_back_path || "",
        doc_type: "valid_id",
        file_path: idUrl,
        version: "corrected"
      });
    }

    var rescrActive = isAiEnabled();
    if (!rescrActive) {
      updatedScreening.state = "paused";
      updatedScreening.phase = "Original Copy Ready (Manual Review)";
      updatedScreening.eta_seconds = 0;
      updatedScreening.fallback_original_only = true;
      updatedScreening.advisory = "Auto-screening is currently paused. Customer's updated submission and original ID photo are ready for manual review.";
      await dbUpdateApplication(app.id, { screening: updatedScreening });
    } else if (typeof apiStartBackgroundScreening === "function") {
      apiStartBackgroundScreening(app.id).then(async function (rescrRes) {
        if (!rescrRes || !rescrRes.queued) {
          updatedScreening.state = "unavailable";
          updatedScreening.phase = "Original Copy Ready (Manual Review)";
          updatedScreening.eta_seconds = 0;
          updatedScreening.fallback_original_only = true;
          updatedScreening.advisory = "Auto-screening is currently unavailable. Customer's updated submission and original ID photo are ready for manual review.";
          await dbUpdateApplication(app.id, { screening: updatedScreening });
          if (typeof dbNotifyScreeningUnavailable === "function") {
            await dbNotifyScreeningUnavailable(
              app.reference_no,
              fullName,
              "Customer submitted an update; original uploaded ID photo is ready for manual review."
            );
          }
        }
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
    showAlert("Update Received", "Thank you! Your updates (" + changedList.join(", ") + ") have been submitted and your application continues in Processing.");
    await loadMyApplications();
  } catch (err) {
    showMsg("fix-msg", "error", err.message || "Could not submit update.");
    btn.disabled = false;
    btn.textContent = "Resubmit Application";
  }
}
