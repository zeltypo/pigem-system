function _getPortalBaseUrl() {
  var origin = "https://pigem-system-web.vercel.app";
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

async function apiVerifyCaptcha(token) {
  var clean = String(token || "").trim();
  if (!clean) return { verified: false };

  try {
    var res = await fetch(_apiEndpoint("/verify-captcha"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: clean })
    });
    if (!res.ok) return { verified: false };
    var data = await res.json();
    return { verified: data.verified === true };
  } catch (err) {
    return { verified: true, fallback: true };
  }
}

function apiStartBackgroundScreening(applicationId) {
  if (!applicationId) return Promise.resolve({ queued: false });

  return (async function () {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 55000) : null;
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
      if (!res.ok) return { queued: false, offline: true };
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
      return c.key === "document_type" || c.key === "id_type";
    });

    data.name_match = Boolean(nameComp && (nameComp.status === "match" || nameComp.matched === true));
    data.birth_date_match = Boolean(dobComp && (dobComp.status === "match" || dobComp.matched === true));
    data.id_number_match = Boolean(idComp && (idComp.status === "match" || idComp.matched === true));
    data.document_valid = !(data.ocr && data.ocr.is_valid_government_id === false) && !(docComp && docComp.status === "mismatch");

    var hasQualityIssue = Boolean(q.issues && q.issues.length > 0);
    var hasFieldGap = comps.length > 0 && !(data.name_match && data.birth_date_match && data.id_number_match && data.document_valid);
    data.overall_status = (hasQualityIssue || hasFieldGap || !data.document_valid) ? "Needs Review" : "Verified";
    data.blur_score = (q.metrics && q.metrics.blur_score) || q.blur_score || "OK";
    var aiFindings = (notes.findings && notes.findings.length) ? notes.findings : (notes.notes || []);
    data.issues = aiFindings.length ? aiFindings : (q.issues || []);
    return data;
  } catch (error) {
    return offlineResult;
  }
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

async function apiSendStatusEmail(toEmail, customerName, refNo, status, remarks, targetSummary) {
  var st = (status || "").toLowerCase();
  if (st.indexOf("correction") !== -1 || st.indexOf("need") !== -1) {
    return await apiSendCorrectionEmail(toEmail, customerName, refNo, remarks, targetSummary);
  }
  var customerStatus = "Processing";
  if (st.indexOf("approv") !== -1) customerStatus = "Approved";
  else if (st.indexOf("reject") !== -1) customerStatus = "Rejected";

  var tag = generateOtpRefTag();
  var subj = "PIGEM Application Update - Reference No. " + refNo + " [" + customerStatus + "]";
  var msg = "Application " + refNo + " status: " + customerStatus + (remarks ? ("\n\nRemarks: " + remarks) : "");
  return await apiSendEmail(toEmail, subj, msg, {
    template_type: "status_update",
    payload: {
      ref_no: refNo,
      ref_tag: tag,
      customer_name: customerName,
      status_label: customerStatus,
      status: customerStatus,
      remarks: remarks || "",
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
