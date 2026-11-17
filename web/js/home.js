var pendingApplyPlanId = null;

function openApplyWithCaptcha(planId) {
  pendingApplyPlanId = String(planId || "1000");
  try {
    sessionStorage.setItem("pigem_selected_plan", pendingApplyPlanId);
  } catch (e) {}
  var liveContent = (typeof getWebsiteContent === "function") ? getWebsiteContent() : window._latestWebsiteContent;
  var mInfo = (typeof getMaintenanceBlockInfo === "function")
    ? getMaintenanceBlockInfo(liveContent)
    : { blocked: typeof isMaintenanceOn === "function" && isMaintenanceOn() };
  if (mInfo && mInfo.blocked) {
    if (typeof renderMaintenanceScreenHtml === "function" && !(typeof isManagerOrAdminPreview === "function" && isManagerOrAdminPreview())) {
      renderMaintenanceScreenHtml(mInfo.title || "Website Under Maintenance", mInfo.message);
      return;
    }
    showAlert(
      mInfo.title || "Website Under Maintenance",
      mInfo.message || "Online fiber applications are temporarily paused while the system is under maintenance. Please try again later.",
      "warn"
    );
    return;
  }
  var targetUrl = "apply.html?plan=" + encodeURIComponent(pendingApplyPlanId);
  if (sessionStorage.getItem("pigem_captcha_verified") === "true") {
    window.location.href = targetUrl;
    return;
  }
  showGoogleCaptchaPopup();
}

var homeCaptchaWidgetId = null;

function showGoogleCaptchaPopup() {
  homeCaptchaWidgetId = null;
  openPopup(
    '<div class="center" style="padding:16px 8px 8px;">' +
      '<div style="width:48px;height:48px;border-radius:50%;background:#fee2e2;color:#c8102e;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;">' +
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>' +
      '</div>' +
      '<h3 style="font-size:18px;margin-bottom:6px;">Security Verification</h3>' +
      '<p class="small muted" style="margin-bottom:18px;">Please check the box below to proceed with your application.</p>' +
      '<div style="display:flex;justify-content:center;align-items:center;margin:8px 0 12px;min-height:78px;">' +
        '<div id="home-captcha-box" style="min-width:304px;min-height:78px;display:flex;align-items:center;justify-content:center;">' +
          '<span class="small muted">Loading security check...</span>' +
        '</div>' +
      '</div>' +
    '</div>',
    { showCloseX: true, closeOnBackdrop: true }
  );
  renderHomeCaptchaBox();
}

function renderHomeCaptchaBox() {
  var siteKey = (typeof CONFIG !== "undefined" && CONFIG.RECAPTCHA_SITE_KEY)
    ? CONFIG.RECAPTCHA_SITE_KEY
    : "6Lcj2iQuAAAAAOBQYN7bVm4ks-_V_a0aSYlge11B";

  function doRender() {
    var box = document.getElementById("home-captcha-box");
    if (!box) return;
    box.innerHTML = "";
    try {
      homeCaptchaWidgetId = grecaptcha.render(box, {
        sitekey: siteKey,
        callback: onGoogleCaptchaPassed
      });
    } catch (err) {
      console.warn("Home reCAPTCHA render notice:", err);
    }
  }

  if (typeof ensureGoogleRecaptcha === "function") {
    ensureGoogleRecaptcha(doRender);
  } else if (typeof grecaptcha !== "undefined" && grecaptcha.render) {
    doRender();
  } else {
    var count = 0;
    var t = setInterval(function () {
      count++;
      if ((typeof grecaptcha !== "undefined" && grecaptcha.render) || count > 40) {
        clearInterval(t);
        if (typeof grecaptcha !== "undefined" && grecaptcha.render) doRender();
      }
    }, 150);
  }
}

async function onGoogleCaptchaPassed(token) {
  if (token && typeof apiVerifyCaptcha === "function") {
    var checkRes = await apiVerifyCaptcha(token);
    if (!checkRes || checkRes.verified === false) {
      showAlert("Security Verification", "Could not verify security token. Please check the box again.", "warn");
      if (typeof grecaptcha !== "undefined" && grecaptcha.reset && homeCaptchaWidgetId !== null) {
        try { grecaptcha.reset(homeCaptchaWidgetId); } catch (e) {}
      }
      return;
    }
  }
  var liveContent = (typeof getWebsiteContent === "function") ? getWebsiteContent() : window._latestWebsiteContent;
  var mInfo = (typeof getMaintenanceBlockInfo === "function") ? getMaintenanceBlockInfo(liveContent) : null;
  if (mInfo && mInfo.blocked && !(typeof isManagerOrAdminPreview === "function" && isManagerOrAdminPreview())) {
    closePopup();
    if (typeof renderMaintenanceScreenHtml === "function") {
      renderMaintenanceScreenHtml(mInfo.title || "Website Under Maintenance", mInfo.message);
    }
    return;
  }
  sessionStorage.setItem("pigem_captcha_verified", "true");
  closePopup();
  var targetUrl = "apply.html" + (pendingApplyPlanId ? "?plan=" + encodeURIComponent(pendingApplyPlanId) : "");
  window.location.href = targetUrl;
}

function buildPlanCard(plan) {
  var borderClass = plan.featured ? "card plan red-border" : "card plan";
  var buttonClass = plan.featured ? "btn btn-red btn-full" : "btn btn-full";
  var planId = escapeHtml(String(plan.id));
  var planName = escapeHtml(String(plan.name));

  var listHtml = "";
  for (var i = 0; i < CONFIG.PLAN_INCLUSIONS.length; i++) {
    listHtml += "<li>" + CONFIG.PLAN_INCLUSIONS[i] + "</li>";
  }

  return (
    '<div class="' + borderClass + '" data-plan-id="' + planId + '">' +
      '<span class="tag">' + escapeHtml(plan.tag || "Fiber for your home") + '</span>' +
      '<h3 class="mt">' + planName + '</h3>' +
      '<div class="speed">' + escapeHtml(String(plan.speed)) + ' <span>Mbps</span></div>' +
      '<p class="price">' + formatPeso(plan.price) + ' <span>/ month</span></p>' +
      '<ul>' + listHtml + '</ul>' +
      '<button type="button" class="' + buttonClass + '">Apply for ' + planName + '</button>' +
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

  var rawHeroSlides = (Array.isArray(content.hero_slides) && content.hero_slides.length > 0)
    ? content.hero_slides
    : (DEFAULT_CONTENT.hero_slides || []);
  var slideCountLimit = Math.max(1, Math.min(4, Number(content.hero_slide_count || DEFAULT_CONTENT.hero_slide_count || 3)));
  startSlider("home-slider", rawHeroSlides.slice(0, slideCountLimit));

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

var homePlanCards = document.getElementById("plan-cards");
if (homePlanCards) {
  homePlanCards.addEventListener("click", function (event) {
    var button = event.target.closest("button");
    if (!button) return;
    var card = button.closest("[data-plan-id]");
    if (card) openApplyWithCaptcha(card.dataset.planId);
  });
}
