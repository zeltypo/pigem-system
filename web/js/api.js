function _getPortalBaseUrl() {
  var origin = "https://pigem-seven.vercel.app";
  if (typeof window !== "undefined" && window.location && window.location.origin && window.location.origin.indexOf("http") === 0) {
    origin = window.location.origin;
  } else if (typeof CONFIG !== "undefined" && CONFIG.PUBLIC_URL) {
    origin = CONFIG.PUBLIC_URL;
  }
  if (typeof window !== "undefined" && window.location && window.location.pathname) {
    var p = window.location.pathname;
    if (p.indexOf("/web/html/") !== -1) return origin + "/web/html";
  }
  return origin;
}

function _apiEndpoint(path) {
  var base = (typeof CONFIG !== "undefined" && CONFIG.API_URL) ? CONFIG.API_URL : "/api";
  return base.replace(/\/$/, "") + path;
}

function generateOtpRefTag() {
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  var tag = "";
  for (var i = 0; i < 4; i++) {
    tag += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return tag;
}

function ensureGoogleRecaptcha(callback) {
  if (typeof callback !== "function") return;

  function tryTrigger() {
    if (typeof grecaptcha !== "undefined" && typeof grecaptcha.render === "function") {
      try {
        grecaptcha.ready(callback);
        return true;
      } catch (e) {
        callback();
        return true;
      }
    }
    return false;
  }

  if (tryTrigger()) return;

  if (typeof document !== "undefined" && !document.querySelector('script[src*="google.com/recaptcha/api.js"]')) {
    var sc = document.createElement("script");
    sc.src = "https://www.google.com/recaptcha/api.js";
    sc.async = true;
    sc.defer = true;
    document.head.appendChild(sc);
  }

  var attempts = 0;
  var timer = setInterval(function () {
    attempts++;
    if (tryTrigger() || attempts > 50) {
      clearInterval(timer);
    }
  }, 150);
}

async function apiVerifyCaptcha(token) {
  var clean = String(token || "").trim();
  if (!clean) return { verified: false };

  try {
    var res = await fetch(_apiEndpoint("/verify-captcha"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: clean })
    });
    if (!res.ok) {
      if (clean.length > 20) return { verified: true, fallback: true };
      return { verified: false };
    }
    var data = await res.json();
    return { verified: data.verified === true };
  } catch (err) {
    if (clean.length > 20) return { verified: true, fallback: true };
    return { verified: false, fallback: true };
  }
}

function apiStartBackgroundScreening(applicationId) {
  if (!applicationId) return Promise.resolve({ queued: false });

  return (async function () {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 300000) : null;
    try {
      var headers = { "Content-Type": "application/json" };
      if (typeof dbGetToken === "function") {
        var token = await dbGetToken();
        if (token) headers["Authorization"] = "Bearer " + token;
      }
      var fetchOpts = {
        method: "POST",
        headers: headers,
        keepalive: true,
        body: JSON.stringify({ application_id: String(applicationId) })
      };
      if (controller) fetchOpts.signal = controller.signal;

      var res = await fetch(_apiEndpoint("/screen-async"), fetchOpts);
      if (timer) clearTimeout(timer);
      if (!res.ok) return { screened: false, offline: true, status: res.status };
      return await res.json();
    } catch (err) {
      if (timer) clearTimeout(timer);
      return { queued: false, offline: true };
    }
  })();
}

async function apiRunScreening(idFrontFile, customerDetails, idBackFile) {
  var offlineResult = {
    preliminary: true,
    status: "offline",
    overall_status: "Manual Review",
    blur_score: "N/A",
    name_match: false,
    birth_date_match: false,
    id_number_match: false,
    issues: ["Automated screening service is currently unavailable. Manual verification is active."]
  };

  if (!idFrontFile) return offlineResult;

  try {
    var details = customerDetails || {};
    var formData = new FormData();

    formData.append("id_front", idFrontFile);
    var backBlob = idBackFile || details.id_back || null;
    if (backBlob) {
      formData.append("id_back", backBlob);
    }

    formData.append("full_name", details.full_name || "");
    formData.append("first_name", details.first_name || "");
    formData.append("middle_name", details.middle_name || "");
    formData.append("last_name", details.last_name || "");
    formData.append("birth_date", details.birth_date || "");
    formData.append("id_type", details.id_type || "");
    formData.append("id_number", details.id_number || "");

    var headers = {};
    if (typeof dbGetToken === "function") {
      var token = await dbGetToken();
      if (token) headers["Authorization"] = "Bearer " + token;
    }

    var response = await fetch(_apiEndpoint("/screen"), {
      method: "POST",
      headers: headers,
      body: formData
    });

    if (!response.ok) return offlineResult;
    var data = await response.json();
    var q = data.quality || {};
    var notes = data.ai || {};
    var compsObj = data.comparisons || {};
    var comps = Array.isArray(compsObj) ? compsObj : (compsObj.fields || []);

    var nameComp = comps.find(function (c) {
      return c.key === "name" || c.key === "full_name" || c.field === "Full Name" || c.field === "full_name";
    });
    var dobComp = comps.find(function (c) {
      return c.key === "birth_date" || c.field === "Birth Date" || c.field === "birth_date";
    });
    var idComp = comps.find(function (c) {
      return c.key === "id_number" || c.field === "ID Number" || c.field === "id_number";
    });
    var docComp = comps.find(function (c) {
      return c.key === "document_type" || c.key === "id_type" || c.field === "ID Type Match";
    });

    data.name_match = Boolean(nameComp && (nameComp.status === "match" || nameComp.matched === true));
    data.birth_date_match = Boolean(dobComp && (dobComp.status === "match" || dobComp.matched === true));
    data.id_number_match = Boolean(idComp && (idComp.status === "match" || idComp.matched === true));
    data.id_type_match = !(data.ocr && data.ocr.id_type_matches_declared === false) && !(docComp && docComp.status === "mismatch");
    data.detected_id_type = (data.ocr && (data.ocr.detected_document_type || data.ocr.detected_id_type)) || (docComp && docComp.found_on_id) || "";
    var ocrAvailable = Boolean(data.ocr && data.ocr.available === true);
    data.document_valid = ocrAvailable && data.ocr.is_valid_government_id === true && data.id_type_match;

    var hasQualityIssue = Boolean(q.issues && q.issues.length > 0);
    var hasFieldGap = !(data.name_match && data.birth_date_match && data.id_number_match && data.document_valid);
    data.overall_status = !ocrAvailable ? "Manual Review" : ((hasQualityIssue || hasFieldGap || !data.document_valid) ? "Needs Review" : "Ready for Agent Review");
    if (!ocrAvailable) data.status = "offline";
    data.blur_score = (q.metrics && q.metrics.blur_score) || q.blur_score || "OK";
    var aiFindings = (notes.findings && notes.findings.length) ? notes.findings : (notes.notes || []);
    if (!data.id_type_match && data.detected_id_type) {
      var mismatchMsg = "Selected ID Type does not match the uploaded document (detected: " + data.detected_id_type + ").";
      if (aiFindings.indexOf(mismatchMsg) === -1) aiFindings = [mismatchMsg].concat(aiFindings);
    }
    data.issues = aiFindings.length ? aiFindings : (q.issues || []);
    if (data.ocr) {
      if (typeof data.ocr.is_Philippine_id === "undefined" && typeof data.ocr.is_valid_government_id !== "undefined") {
        data.ocr.is_Philippine_id = data.ocr.is_valid_government_id;
      }
      if (!data.ocr.detected_id_type && data.ocr.detected_document_type) {
        data.ocr.detected_id_type = data.ocr.detected_document_type;
      }
    }
    return data;
  } catch (error) {
    return offlineResult;
  }
}

async function analyzeClientIdQuality(fileObj) {
  return new Promise(function (resolve) {
    if (!fileObj || typeof Image === "undefined" || typeof document === "undefined") {
      resolve({ passed: false, issues: ["We could not check this photo. Please select a readable JPG or PNG image."], metrics: {} });
      return;
    }
    if (fileObj.size > 5 * 1024 * 1024) {
      resolve({ passed: false, issues: ["Choose a photo smaller than 5 MB."], metrics: {} });
      return;
    }
    var url = URL.createObjectURL(fileObj);
    var img = new Image();
    img.onload = function () {
      try {
        var w = img.naturalWidth || img.width || 0;
        var h = img.naturalHeight || img.height || 0;
        var scale = Math.min(1, 480 / Math.max(w, h, 1));
        var cw = Math.max(16, Math.round(w * scale));
        var ch = Math.max(16, Math.round(h * scale));
        var canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, cw, ch);
        var px = ctx.getImageData(0, 0, cw, ch).data;
        var gray = new Float32Array(cw * ch);
        var sumBright = 0;
        var brightPixels = 0;
        var detailPixels = 0;
        for (var i = 0, p = 0; i < px.length; i += 4, p++) {
          var g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          gray[p] = g;
          sumBright += g;
          if (g > 246) brightPixels++;
          if (g < 150) detailPixels++;
        }
        var meanBright = sumBright / (cw * ch);
        var glareRatio = brightPixels / (cw * ch);
        var lapSum = 0;
        var lapSqSum = 0;
        var centerLapSq = 0;
        var centerCount = 0;
        var count = 0;
        for (var y = 1; y < ch - 1; y++) {
          for (var x = 1; x < cw - 1; x++) {
            var idx = y * cw + x;
            var lap = -4 * gray[idx] + gray[idx - 1] + gray[idx + 1] + gray[idx - cw] + gray[idx + cw];
            lapSum += lap;
            lapSqSum += lap * lap;
          if (x >= cw * 0.3 && x < cw * 0.7 && y >= ch * 0.3 && y < ch * 0.7) {
            centerLapSq += lap * lap;
            centerCount++;
          }
            count++;
          }
        }
        var lapMean = count > 0 ? lapSum / count : 0;
        var lapVar = count > 0 ? (lapSqSum / count) - (lapMean * lapMean) : 100;
        var issues = [];
        if (w < 260 || h < 160) {
          issues.push("This photo is too small. Please choose the original, full-size photo.");
        }

        var centerBlur = centerCount ? centerLapSq / centerCount : lapVar;
        if (lapVar < 32 || (centerBlur < 12 && lapVar < 180)) {
          issues.push("The photo looks blurry. Hold the camera steady and take a sharper photo.");
        }
        if (meanBright < 42) {
          issues.push("The photo is too dark. Take another photo in a well-lit area.");
        } else if (meanBright > 210 && glareRatio > 0.35 && detailPixels / (cw * ch) < 0.02) {
          issues.push("Bright areas appear washed out. Check that the printed fields are readable.");
        }
        URL.revokeObjectURL(url);
        resolve({
          passed: issues.length === 0,
          issues: issues,
          metrics: {
            blur_score: Math.round(lapVar),
            center_blur_score: Math.round(centerBlur),
            brightness: Math.round(meanBright),
            glare_ratio: Number(glareRatio.toFixed(3))
          }
        });
      } catch (e) {
        URL.revokeObjectURL(url);
        resolve({ passed: false, issues: ["We could not check this photo. Please select a readable JPG or PNG image."], metrics: {} });
      }
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      resolve({ passed: false, issues: ["We could not check this photo. Please select a readable JPG or PNG image."], metrics: {} });
    };
    img.src = url;
  });
}

async function apiSendEmail(toEmail, subjectText, messageText, options) {
  options = options || {};
  if (typeof options === "string") {
    options = { template_type: options };
  }
  var templateType = options.template_type || "general";
  var payload = options.payload || null;
  var htmlContent = options.html_content || null;

  try {
    var headers = { "Content-Type": "application/json" };
    if (typeof dbGetToken === "function") {
      var token = await dbGetToken();
      if (token) headers["Authorization"] = "Bearer " + token;
    }

    var res = await fetch(_apiEndpoint("/notify"), {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        to: toEmail,
        subject: subjectText,
        message: messageText || "",
        template_type: templateType,
        payload: payload,
        html_content: htmlContent
      })
    });

    if (res.ok) {
      var data = await res.json();
      return {
        sent: data.sent === true,
        id: data.id,
        unconfigured: Boolean(data.unconfigured),
        sandbox_restricted: Boolean(data.sandbox_restricted),
        reason: data.reason || data.error || ""
      };
    }

    var errData = {};
    try { errData = await res.json(); } catch (e) {}
    return {
      sent: false,
      status: res.status,
      reason: errData.reason || errData.detail || errData.error || "Server error",
      unconfigured: Boolean(errData.unconfigured),
      sandbox_restricted: Boolean(errData.sandbox_restricted)
    };
  } catch (error) {
    return { sent: false, offline: true, reason: error.message };
  }
}

async function apiSendOtpEmail(toEmail, code, purpose, recipientName, refTag) {
  var pName = recipientName || "Valued Subscriber";
  var tag = refTag || generateOtpRefTag();
  var purposeLabel = purpose || "verify your contact details and continue your transaction";
  var subj = "PIGEM Verification Code (Ref no: " + tag + ")";
  var msg =
    "NEVER SHARE YOUR OTP especially on social media and SMS or email links. Your code is for your eyes only.\n\n" +
    "Your OTP to " + purposeLabel + " is " + code + ". Ref no: " + tag + ". This code is only valid for 5 minutes upon receiving this email.";
  return await apiSendEmail(toEmail, subj, msg, {
    template_type: "otp",
    payload: {
      otp_code: String(code),
      code: String(code),
      purpose_label: purposeLabel,
      customer_name: pName,
      ref_tag: tag
    }
  });
}

async function apiSendApplicationConfirmationEmail(toEmail, customerName, refNo, planObj, addressStr, accountInfo) {
  var p = planObj || {};
  var tag = generateOtpRefTag();
  var subj = "PIGEM Application Received - Reference No. " + refNo + " (Ref no: " + tag + ")";
  var isExisting = Boolean(accountInfo && accountInfo.status === "active");
  var actCode = (accountInfo && accountInfo.code) ? String(accountInfo.code) : "";
  var username = (accountInfo && accountInfo.user && accountInfo.user.username) ? String(accountInfo.user.username) : "";
  var baseUrl = _getPortalBaseUrl();
  var actLink = baseUrl + "/activate.html?email=" + encodeURIComponent(toEmail) + (actCode ? "&code=" + encodeURIComponent(actCode) : "") + (username ? "&username=" + encodeURIComponent(username) : "");
  var portalLink = baseUrl + "/login.html";
  var msg = isExisting
    ? ("Thank you for applying. Reference No: " + refNo + ". Sign in to check your status at " + portalLink)
    : ("Thank you for applying. Reference No: " + refNo + ". One-Time Activation Code: " + actCode + ". Create your password once at " + actLink);

  return await apiSendEmail(toEmail, subj, msg, {
    template_type: "activation",
    payload: {
      ref_no: refNo,
      ref_tag: tag,
      customer_name: customerName || "Valued Subscriber",
      customer_email: toEmail,
      username: username,
      plan_name: p.name ? ("Red Fiber " + p.name) : "Red Fiber Plan",
      speed: p.speed ? (p.speed + " Mbps") : "Standard Speed",
      price: p.price ? ("₱" + Number(p.price).toLocaleString("en-PH")) : "₱1,400",
      address: addressStr || "Dasmariñas City, Cavite",
      activation_link: actLink,
      portal_link: portalLink,
      activation_code: actCode,
      is_existing_account: isExisting
    }
  });
}

async function apiSendCorrectionEmail(toEmail, customerName, refNo, remarks, targetSummary) {
  var tag = generateOtpRefTag();
  var subj = "PIGEM Action Needed - Reference No. " + refNo + " (Ref no: " + tag + ")";
  var msg = remarks || ("Action needed on your application " + refNo + ". Please sign in to your Customer Portal to submit the requested update.");
  return await apiSendEmail(toEmail, subj, msg, {
    template_type: "correction",
    payload: {
      ref_no: refNo,
      ref_tag: tag,
      customer_name: customerName,
      remarks: remarks || "",
      portal_link: _getPortalBaseUrl() + "/login.html",
      target_summary: targetSummary || "Information / Document Clarification Required"
    }
  });
}

function getApplicationStatusNotice(status, remarks) {
  var message = String(remarks || "").trim();
  if (message) return message;
  if (status === "Approved") {
    return "Your application was approved. Check your account for installation updates.";
  }
  if (status === "Rejected") {
    return "Your application was not approved. Sign in to view the update or contact PIGEM for help.";
  }
  return "Sign in to your account to see the latest update.";
}

async function apiSendStatusEmail(toEmail, customerName, refNo, status, remarks, targetSummary) {
  var st = String(status || "").trim().toLowerCase();
  if (st === "needs correction") {
    return await apiSendCorrectionEmail(toEmail, customerName, refNo, remarks, targetSummary);
  }

  var statuses = { approved: "Approved", rejected: "Rejected" };
  var customerStatus = statuses[st] || "Processing";
  var notice = getApplicationStatusNotice(customerStatus, remarks);

  var tag = generateOtpRefTag();
  var subj = "PIGEM Application Update - Reference No. " + refNo + " [" + customerStatus + "]";
  var msg = "Application " + refNo + " status: " + customerStatus + "\n\n" + notice;
  return await apiSendEmail(toEmail, subj, msg, {
    template_type: "status_update",
    payload: {
      ref_no: refNo,
      ref_tag: tag,
      customer_name: customerName,
      status_label: customerStatus,
      status: customerStatus,
      remarks: notice,
      portal_link: _getPortalBaseUrl() + "/login.html"
    }
  });
}

async function apiSendPromotionalEmail(toEmail, customerName, headline, bodyText, promoPlans) {
  var tag = generateOtpRefTag();
  var subj = headline + " - PIGEM Support Services";
  return await apiSendEmail(toEmail, subj, bodyText, {
    template_type: "promo",
    payload: {
      ref_tag: tag,
      customer_name: customerName,
      promo_title: headline,
      headline: headline,
      body: bodyText,
      promo_plans: promoPlans || []
    }
  });
}

async function apiCheckHealth() {
  var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  var timer = controller ? setTimeout(function () { controller.abort(); }, 8000) : null;
  try {
    var opts = controller ? { signal: controller.signal } : {};
    var response = await fetch(_apiEndpoint("/health"), opts);
    if (timer) clearTimeout(timer);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    if (timer) clearTimeout(timer);
    return null;
  }
}

async function apiGeneratePoliteRemark(rawRemark, chosenField) {
  var text = String(rawRemark || "").trim();
  var field = chosenField || "auto";

  var headers = { "Content-Type": "application/json" };
  try {
    if (typeof dbGetToken === "function") {
      var token = await dbGetToken();
      if (token) headers["Authorization"] = "Bearer " + token;
    }
  } catch (e) {}

  var res = await fetch(_apiEndpoint("/polite-remark"), {
    method: "POST",
    headers: headers,
    body: JSON.stringify({ raw_remark: text, chosen_field: field })
  });

  if (!res.ok) {
    throw new Error("Message helper service is currently unavailable. Please select a preset or type the customer message manually.");
  }

  var data = await res.json();
  return {
    polite_message: data.polite_message || data.message || "",
    target_fields: data.target_fields || data.fields || [],
    available: data.available !== false
  };
}


var automaticDocumentChecksRunning = false;
var automaticDocumentAttempts = {};
var automaticDocumentFailures = {};
function documentCheckUnavailable(id) {
  return automaticDocumentFailures[id] === true;
}
async function checkPendingDocuments(applications, onComplete) {
  if (automaticDocumentChecksRunning || !isAiEnabled()) return;
  automaticDocumentChecksRunning = true;
  try {
    for (var application of applications) {
      var state = (application.screening || {}).state;
      if (!["Pending Review", "Under Agent Review"].includes(application.status)) continue;
      if (!["pending_agent", "queued", "checking", "unavailable", "paused", undefined].includes(state)) continue;
      var key = application.id + "|" + (application.updated_at || application.created_at || "");
      var attempt = automaticDocumentAttempts[key] || { count: 0, next: 0 };
      if (attempt.count >= 3 || Date.now() < attempt.next) continue;
      attempt.count++;
      attempt.next = Date.now() + 60000;
      automaticDocumentAttempts[key] = attempt;
      var result = await apiStartBackgroundScreening(application.id);
      automaticDocumentFailures[application.id] = !result || (!result.screened && !result.queued);
      if (result && result.screened || automaticDocumentFailures[application.id]) await onComplete(application.id);
      if (result && (result.status === 401 || result.status === 403)) break;
    }
  } finally {
    automaticDocumentChecksRunning = false;
  }
}

async function showSelectedPhotoQuality(input) {
  var file = input.files && input.files[0];
  var id = input.id + "-quality";
  var box = document.getElementById(id);
  if (!box) {
    box = document.createElement("div");
    box.id = id;
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    input.insertAdjacentElement("afterend", box);
  }
  box.className = "notice mt";
  box.textContent = file ? "Checking photo..." : "";
  if (!file) return;
  var result = await analyzeClientIdQuality(file);
  if (input.files[0] !== file) return;
  box.className = "notice mt " + (result.passed ? "ok" : "bad");
  box.textContent = result.passed
    ? "Photo quality check passed. Check that all printed details are visible."
    : "Please replace this photo. " + result.issues.join(" ");
}
