/* ============================================================================
 * PIGEM STUDY DUPLICATE — web/js/home.js (Public Landing Page & Plan Showcase)
 * ============================================================================
 * ROLE IN ARCHITECTURE:
 *   Powers `web/html/index.html` and `web/html/about.html`:
 *   - Loads dynamic fiber plans (`Plan 1000`, `Plan 1400`, `Plan 1900`) from Supabase
 *   - Renders CMS hero banners, announcements, and partner/client logos from
 *     the `website-assets` storage bucket.
 * ============================================================================ */

var pendingApplyPlanId = null;

function openApplyFromHome(planId) {
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
  window.location.href = "apply.html?plan=" + encodeURIComponent(pendingApplyPlanId);
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
    if (card) openApplyFromHome(card.dataset.planId);
  });
}
