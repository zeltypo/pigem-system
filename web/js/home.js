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

function showGoogleCaptchaPopup() {
  openPopup(
    '<div class="center" style="padding:14px 4px 6px;">' +
      '<div style="width:52px;height:52px;border-radius:50%;background:#e0f2fe;color:#0284c7;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;">' +
        '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>' +
      '</div>' +
      '<h3 style="font-size:18px;margin-bottom:4px;">PIGEM Security Verification</h3>' +
      '<p class="small muted" style="margin-bottom:16px;">Please confirm you are not a robot before proceeding to the application form.</p>' +
      '<div id="captcha-fallback-box" style="margin-top:8px; display:block;">' +
        '<div id="home-captcha-card" class="captcha-container" role="button" tabindex="0" aria-label="Verify I am not a robot" onclick="triggerHomeCaptcha()" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();triggerHomeCaptcha();}">' +
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
    '</div>',
    { showCloseX: true, closeOnBackdrop: true }
  );
}

async function onGoogleCaptchaPassed(token) {
  if (token && typeof apiVerifyCaptcha === "function") {
    var checkRes = await apiVerifyCaptcha(token);
    if (!checkRes || checkRes.verified === false) {
      showAlert("Security Verification", "Could not verify security token. Please check the box again.", "warn");
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
