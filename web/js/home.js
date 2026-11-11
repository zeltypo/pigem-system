var pendingApplyPlanId = null;

function openApplyWithCaptcha(planId) {
  pendingApplyPlanId = planId || "";
  if (sessionStorage.getItem("pigem_captcha_verified") === "true") {
    window.location.href = "apply.html" + (pendingApplyPlanId ? "?plan=" + encodeURIComponent(pendingApplyPlanId) : "");
    return;
  }
  showGoogleCaptchaPopup();
}

function showGoogleCaptchaPopup() {
  openPopup(
    '<div class="center" style="padding:10px 4px;">' +
      '<div style="width:48px;height:48px;border-radius:50%;background:#e0f2fe;color:#0284c7;display:flex;align-items:center;justify-content:center;font-size:24px;margin:0 auto 12px;"><img data-img="icons/shield.png" src="https://wuunqfxyejxwrawtjdrf.supabase.co/storage/v1/object/public/website-assets/icons/shield.png" alt="Security (not available)" class="icon-img" /></div>' +
      '<h3 style="font-size:18px;margin-bottom:4px;">Security Verification</h3>' +
      '<p class="small muted" style="margin-bottom:16px;">Please confirm you are not a robot before proceeding to the application form.</p>' +
      '<div id="g-recaptcha-wrap" style="display:flex;justify-content:center;margin:16px auto;min-height:78px;">' +
        '<div id="g-recaptcha-box" class="g-recaptcha" data-sitekey="' + CONFIG.RECAPTCHA_SITE_KEY + '" data-callback="onGoogleCaptchaPassed"></div>' +
      '</div>' +
      '<div id="captcha-fallback-box" style="margin-top:8px; display:none;">' +
        '<div id="home-captcha-card" class="captcha-container" onclick="triggerHomeCaptcha()">' +
          '<div style="display:flex;align-items:center;gap:12px;">' +
            '<div id="home-captcha-check" class="captcha-box-inner"></div>' +
            '<span id="home-captcha-text" style="font-weight:600;font-size:14px;color:var(--text);">I\'m not a robot</span>' +
          '</div>' +
          '<div style="text-align:right;line-height:1.2;">' +
            '<div style="font-size:11px;font-weight:800;color:var(--muted);">CAPTCHA</div>' +
            '<div style="font-size:10px;color:var(--muted);">Security Verification</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="row mt-big" style="justify-content:center;">' +
        '<button type="button" class="btn btn-outline btn-small" onclick="closePopup()">Cancel</button>' +
      '</div>' +
    '</div>'
  );

  if (typeof grecaptcha !== "undefined" && grecaptcha.render) {
    try {
      grecaptcha.render("g-recaptcha-box", {
        sitekey: CONFIG.RECAPTCHA_SITE_KEY,
        callback: onGoogleCaptchaPassed,
        'error-callback': function () {
          var fb = document.getElementById("captcha-fallback-box");
          if (fb) fb.style.display = "block";
        }
      });
    } catch (e) {
      var fbCatch = document.getElementById("captcha-fallback-box");
      if (fbCatch) fbCatch.style.display = "block";
    }
  } else {
    var fbInit = document.getElementById("captcha-fallback-box");
    if (fbInit) fbInit.style.display = "block";
  }
}

async function onGoogleCaptchaPassed(token) {
  if (token && typeof apiVerifyCaptcha === "function") {
    var checkRes = await apiVerifyCaptcha(token);
    if (!checkRes || checkRes.verified === false) {
      showAlert("Security Verification", "Could not verify security token. Please check the box again.", "warn");
      return;
    }
  }
  sessionStorage.setItem("pigem_captcha_verified", "true");
  closePopup();
  var targetUrl = "apply.html" + (pendingApplyPlanId ? "?plan=" + encodeURIComponent(pendingApplyPlanId) : "");
  window.location.href = targetUrl;
}

function triggerHomeCaptcha() {
  var check = document.getElementById("home-captcha-check");
  var card = document.getElementById("home-captcha-card");
  var text = document.getElementById("home-captcha-text");
  if (!check || !card) return;

  check.innerHTML = '<div class="captcha-spinner"></div>';
  if (text) text.textContent = "Verifying security credentials...";

  setTimeout(function () {
    check.innerHTML = "&#10003;";
    card.classList.add("verified");
    if (text) text.textContent = "I'm not a robot";
    setTimeout(function () {
      onGoogleCaptchaPassed();
    }, 400);
  }, 600);
}

function buildPlanCard(plan) {
  var borderClass = plan.featured ? "card plan red-border" : "card plan";
  var buttonClass = plan.featured ? "btn btn-red btn-full" : "btn btn-full";

  var listHtml = "";
  for (var i = 0; i < CONFIG.PLAN_INCLUSIONS.length; i++) {
    listHtml += "<li>" + CONFIG.PLAN_INCLUSIONS[i] + "</li>";
  }

  return (
    '<div class="' + borderClass + '">' +
      '<span class="tag">' + (plan.tag || "Fiber for your home") + '</span>' +
      '<h3 class="mt">' + plan.name + '</h3>' +
      '<div class="speed">' + plan.speed + ' <span>Mbps</span></div>' +
      '<p class="price">' + formatPeso(plan.price) + ' <span>/ month</span></p>' +
      '<ul>' + listHtml + '</ul>' +
      '<button type="button" onclick="openApplyWithCaptcha(\'' + plan.id + '\')" class="' + buttonClass + '">Apply for ' + plan.name + '</button>' +
    '</div>'
  );
}

function initHomePage() {
  var content = getWebsiteContent();

  var annBar = document.getElementById("site-announcement-bar");
  if (annBar) {
    if (content.announcement && content.announcement.active && content.announcement.headline) {
      annBar.style.display = "block";
      annBar.innerHTML =
        "<b>" + String(content.announcement.headline).replace(/</g, "&lt;") + ":</b> " +
        String(content.announcement.body || "").replace(/</g, "&lt;");
    } else {
      annBar.style.display = "none";
      annBar.innerHTML = "";
    }
  }

  startSlider("home-slider", content.hero_slides || DEFAULT_CONTENT.hero_slides);

  var areaBar = document.getElementById("area-bar");
  if (areaBar && content.area_text) {
    areaBar.textContent = content.area_text;
  }

  var plans = getActivePlans();
  var planBox = document.getElementById("plan-cards");
  if (planBox) {
    var html = "";
    for (var i = 0; i < plans.length; i++) {
      html += buildPlanCard(plans[i]);
    }
    planBox.innerHTML = html;
  }

  var faqBox = document.getElementById("faq-list");
  if (faqBox && content.faqs) {
    var faqHtml = "";
    for (var j = 0; j < content.faqs.length; j++) {
      faqHtml +=
        "<details>" +
          "<summary>" + content.faqs[j].q + "</summary>" +
          "<p>" + content.faqs[j].a + "</p>" +
        "</details>";
    }
    faqBox.innerHTML = faqHtml;
  }

  var logosBox = document.querySelector(".logos");
  var clientImgs = content.client_images || DEFAULT_CONTENT.client_images;
  if (logosBox && clientImgs && clientImgs.length) {
    logosBox.innerHTML = clientImgs.map(function (imgPath) {
      return '<img data-img="' + imgPath + '" src="' + getImageUrl(imgPath) + '" alt="Client Partner" onerror="imageFallback(this, \'' + imgPath + '\')" onclick="previewImage(\'' + imgPath + '\', \'\')">';
    }).join("");
  }
}

window.onLiveContentSynced = initHomePage;
initHomePage();
