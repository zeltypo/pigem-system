async function phoneTransfer(action, payload) {
  var response = await fetch(_apiEndpoint("/phone-transfer/" + action), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(22000) : undefined
  });
  var data = await response.json().catch(function () { return {}; });
  if (!response.ok || !data) {
    var error = new Error(typeof data?.detail === "string" ? data.detail : "Phone transfer is unavailable. Try again.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function phoneTransferLinkContent(link, title, instructions) {
  return '<h2>' + escapeHtml(title) + '</h2>' +
    '<p class="muted mt">' + escapeHtml(instructions) + '</p>' +
    '<img class="phone-transfer-code" src="' + escapeHtml(link.qr) + '" alt="Scan this QR code with your phone camera">' +
    '<label for="phone-transfer-link">Or copy this link to your phone</label>' +
    '<input id="phone-transfer-link" type="url" readonly value="' + escapeHtml(link.url) + '" onclick="this.select()">' +
    '<p class="small muted mt">Use this link within 15 minutes. Keep it private.</p>' +
    '<p id="phone-transfer-status" class="small mt" role="status"></p>';
}

var APPLICATION_HANDOFF_WATCH = "pigem_apply_handoff_watch";
var APPLICATION_HANDOFF_EDIT = "pigem_apply_handoff_edit";
var applicationHandoffPhotos = null;
var applicationHandoffBusy = false;
var applicationHandoffPolling = false;

function applicationHandoffPercent(step) {
  return Math.round(step * 100 / TOTAL_PANELS);
}

async function applicationHandoffSnapshot() {
  if (_pinLookupPromise) await _pinLookupPromise;
  saveApplyDraftState();
  var draft = JSON.parse(sessionStorage.getItem(APPLY_DRAFT_KEY));
  draft.referralAgentId = referralAgentId;
  var photos = await Promise.all([phonePhotoAsJpeg(selectedFrontFile), phonePhotoAsJpeg(selectedBackFile)]);
  return { draft: draft, front: photos[0], back: photos[1] };
}

function acceptApplicationSnapshot(snapshot) {
  if (!snapshot.draft) return;
  sessionStorage.setItem(APPLY_DRAFT_KEY, JSON.stringify(snapshot.draft));
  sessionStorage.setItem("pigem_selected_plan", snapshot.draft.selectedPlanId);
  applicationHandoffPhotos = snapshot;
}

async function restoreApplicationHandoffPhotos() {
  var snapshot = applicationHandoffPhotos;
  applicationHandoffPhotos = null;
  if (!snapshot) return;
  for (var side of ["front", "back"]) {
    if (!snapshot[side]) continue;
    var response = await fetch(snapshot[side]);
    var blob = await response.blob();
    handleIdFileSelect(side, { files: [new File([blob], "transferred-id-" + side + ".jpg", { type: "image/jpeg" })] });
  }
}

function showApplicationHandoff(title, message, focus) {
  document.querySelectorAll(".form-wrap > :not(#application-handoff)").forEach(function (element) { element.hidden = true; });
  document.getElementById("application-handoff").hidden = false;
  var heading = document.getElementById("application-handoff-title");
  heading.textContent = title;
  setApplicationHandoffStatus(message);
  if (focus) heading.focus();
}

function setApplicationHandoffStatus(message) {
  var status = document.getElementById("application-handoff-status");
  if (status.textContent !== message) status.textContent = message;
}

function clearApplicationHandoffEditor() {
  APPLY_DRAFT_FIELDS.forEach(function (id) {
    var field = document.getElementById(id);
    if (field.tagName === "SELECT") field.selectedIndex = 0;
    else field.value = "";
  });
  document.getElementById("agree_sub").checked = false;
  document.getElementById("agree_tu").checked = false;
  document.getElementById("email-otp-inline-status").textContent = "";
  document.getElementById("email-otp-inline-status").style.display = "none";
  selectedIdChecks = { front: null, back: null };
  selectedFrontFile = null;
  selectedBackFile = null;
  document.querySelectorAll(".form-wrap input[type=file]").forEach(function (input) { input.value = ""; });
  for (var side of ["front", "back"]) {
    var image = document.getElementById("id-" + side + "-preview");
    if (image.src.startsWith("blob:")) URL.revokeObjectURL(image.src);
    image.removeAttribute("src");
    document.getElementById("id-" + side + "-preview-box").hidden = true;
    document.getElementById("id-" + side + "-quality").hidden = true;
    document.getElementById("id-" + side + "-filename").textContent = "No photo selected";
  }
  isContactOtpVerified = false;
  verifiedEmailAddress = "";
  resetInstallationPin();
  document.getElementById("agent-ref-banner").hidden = true;
  document.getElementById("id-screen-warn").hidden = true;
  clearAllFieldErrors(document.querySelector("main"));
}

function showHandoffProgress(percent) {
  document.getElementById("application-handoff-progress").hidden = false;
  document.getElementById("application-handoff-percent").value = percent;
  document.getElementById("application-handoff-percent-text").textContent = percent + "%";
}

function refreshApplicationHandoffButtons(hideNavigation) {
  var params = new URLSearchParams(location.search);
  var correctionUpload = params.get("phone_correction") === "1";
  hideNavigation = hideNavigation || params.get("phone_returned") === "1";
  var editingRemotely = !correctionUpload && Boolean(sessionStorage.getItem(APPLICATION_HANDOFF_EDIT));
  var monitoring = !correctionUpload && Boolean(sessionStorage.getItem(APPLICATION_HANDOFF_WATCH));
  document.getElementById("btn-back-website").hidden = Boolean(hideNavigation || editingRemotely || monitoring);
  document.getElementById("btn-return-desktop").hidden = Boolean(hideNavigation || !editingRemotely);
  if (hideNavigation || correctionUpload || editingRemotely || monitoring) document.getElementById("btn-phone-qr").hidden = true;
}

function showApplicationReturnedToDesktop() {
  refreshApplicationHandoffButtons(true);
  showApplicationHandoff("Returned to desktop", "Continue on your desktop. To switch devices again, scan the new QR code from there.", true);
}

function startApplicationHandoffMonitor(watch) {
  showApplicationHandoff("Continue on another device", "Waiting for the other device to open the application.", true);
  document.getElementById("application-handoff-code").src = watch.qr;
  document.getElementById("application-handoff-link").value = watch.url;
  document.getElementById("application-handoff-qr").hidden = false;
  document.getElementById("application-handoff-cancel").hidden = false;
  showHandoffProgress(watch.percent);
  refreshApplicationHandoffButtons();
  if (!applicationHandoffPolling) pollApplicationHandoff(watch);
}

async function pollApplicationHandoff(watch) {
  applicationHandoffPolling = true;
  try {
    var result = await phoneTransfer("application/state", { token: watch.token });
    if (!sessionStorage.getItem(APPLICATION_HANDOFF_WATCH)) return;
    if (result.status === "returned" || result.status === "cancelled") {
      await resumeApplicationOnDesktop(watch, result);
      return;
    }
    if (result.status === "submitted") {
      clearCompletedApplicationHandoff();
      showHandoffProgress(100);
      showApplicationHandoff("Application submitted", "Your application was submitted from the other device.", true);
      phoneTransfer("application/ack", { token: watch.token }).catch(function () {});
      return;
    }
    var waiting = result.status === "waiting";
    document.getElementById("application-handoff-qr").hidden = !waiting;
    document.getElementById("application-handoff-cancel").hidden = !waiting && result.status !== "expired";
    setApplicationHandoffStatus(waiting ? "Waiting for the other device to open the application." :
      (result.status === "expired" ? "The QR code expired. Resume on this computer to continue." :
        "This application is open on another device. Select Back to desktop there to continue here."));
    if (Number.isInteger(result.percent)) showHandoffProgress(result.percent);
  } catch (error) {
    if (!sessionStorage.getItem(APPLICATION_HANDOFF_WATCH)) return;
    setApplicationHandoffStatus(error.status === 410 ? "The transfer session ended. You can reopen the original desktop draft." :
      "Couldn’t check progress. Reconnecting…");
    if (error.status === 410) {
      document.getElementById("application-handoff-qr").hidden = true;
      document.getElementById("application-handoff-cancel").hidden = false;
    }
  } finally {
    applicationHandoffPolling = false;
    if (sessionStorage.getItem(APPLICATION_HANDOFF_WATCH)) setTimeout(function () {
      if (sessionStorage.getItem(APPLICATION_HANDOFF_WATCH)) pollApplicationHandoff(watch);
    }, document.hidden ? 20000 : 5000);
  }
}

async function resumeApplicationOnDesktop(watch, snapshot) {
  if (!sessionStorage.getItem(APPLICATION_HANDOFF_WATCH)) return;
  acceptApplicationSnapshot(snapshot);
  sessionStorage.removeItem(APPLICATION_HANDOFF_WATCH);
  document.getElementById("application-handoff").hidden = true;
  document.getElementById("apply-step-progress").hidden = false;
  document.getElementById("application-handoff-qr").hidden = true;
  document.getElementById("application-handoff-link").value = "";
  document.getElementById("application-handoff-code").removeAttribute("src");
  setupDeviceUploadUI();
  refreshApplicationHandoffButtons();
  restoreApplyDraftState(false);
  updateContactOtpButton(document.getElementById("email").value.trim().toLowerCase());
  await restoreApplicationHandoffPhotos();
  showApplyCaptcha();
  phoneTransfer("application/ack", { token: watch.token }).catch(function () {});
}

async function cancelApplicationHandoff() {
  var watch = JSON.parse(sessionStorage.getItem(APPLICATION_HANDOFF_WATCH));
  if (!watch || applicationHandoffBusy) return;
  applicationHandoffBusy = true;
  var button = document.getElementById("application-handoff-cancel");
  button.disabled = true;
  try {
    var snapshot = await phoneTransfer("application/cancel", { token: watch.token });
    await resumeApplicationOnDesktop(watch, snapshot);
  } catch (error) {
    if (error.status === 410) await resumeApplicationOnDesktop(watch, {});
    else document.getElementById("application-handoff-status").textContent = error.message;
  } finally {
    applicationHandoffBusy = false;
    button.disabled = false;
  }
}

function clearCompletedApplicationHandoff() {
  for (var key of [APPLY_DRAFT_KEY, APPLY_PHONE_TICKET_KEY, APPLY_CONTACT_OTP_KEY,
                  APPLICATION_HANDOFF_EDIT, APPLICATION_HANDOFF_WATCH, "pigem_selected_plan"]) sessionStorage.removeItem(key);
  clearApplicationHandoffEditor();
  applyCaptchaVerified = false;
  applicationScreeningTicket = "";
  document.getElementById("btn-return-desktop").hidden = true;
  document.getElementById("btn-phone-qr").hidden = true;
  document.getElementById("application-handoff-cancel").hidden = true;
  document.getElementById("application-handoff-qr").hidden = true;
  document.getElementById("application-handoff-link").value = "";
  document.getElementById("application-handoff-code").removeAttribute("src");
}

var applicationProgressRequest = Promise.resolve();
function sendPhoneApplicationProgress(step) {
  var token = sessionStorage.getItem(APPLICATION_HANDOFF_EDIT);
  if (!token) return;
  applicationProgressRequest = applicationProgressRequest.then(function () {
    if (sessionStorage.getItem(APPLICATION_HANDOFF_EDIT) === token) {
      return phoneTransfer("application/update", { token: token, status: "editing", percent: applicationHandoffPercent(step) });
    }
  }).catch(function () {});
}

async function returnApplicationToDesktop() {
  var token = sessionStorage.getItem(APPLICATION_HANDOFF_EDIT);
  if (!token || applicationHandoffBusy || applicationSubmissionRunning) return;
  applicationHandoffBusy = true;
  var button = document.getElementById("btn-return-desktop");
  var main = document.querySelector("main");
  var status = document.getElementById("apply-phone-status");
  button.disabled = true;
  main.inert = true;
  status.textContent = "Sending your latest changes to the desktop…";
  try {
    var snapshot = await applicationHandoffSnapshot();
    await phoneTransfer("application/update", { token: token, status: "returned", ...snapshot });
    clearCompletedApplicationHandoff();
    history.replaceState(null, "", location.pathname + "?phone_returned=1");
    status.textContent = "";
    main.inert = false;
    showApplicationReturnedToDesktop();
  } catch (error) {
    status.textContent = error.message || "Couldn’t return the application. Please try again.";
  } finally {
    button.disabled = false;
    main.inert = false;
    applicationHandoffBusy = false;
  }
}

function completeApplicationHandoff() {
  var token = sessionStorage.getItem(APPLICATION_HANDOFF_EDIT);
  if (!token) return;
  clearCompletedApplicationHandoff();
  phoneTransfer("application/update", { token: token, status: "submitted" }).catch(function () {
    return phoneTransfer("application/update", { token: token, status: "submitted" });
  }).catch(function () {});
}
