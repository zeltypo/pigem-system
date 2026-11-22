const agentDynamsoft = (() => {
  const enabled = new URLSearchParams(window.location.search).get("dynamsoft-trial") === "1";
  const template = "DetectAndNormalizeDocument_Default";
  const previews = new Map();
  let license = "";
  let router;
  let pendingCapture = Promise.resolve();

  function requestLicense() {
    if (!enabled) return false;
    if (!license) {
      license = (window.prompt("Enter your Dynamsoft JavaScript trial key. Use fictional ID photos for this trial.") || "").trim();
    }
    return Boolean(license);
  }

  async function startRouter() {
    if (!window.Dynamsoft?.CVR) {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/dynamsoft-capture-vision-bundle@3.6.5000/dist/dcv.bundle.min.js";
      script.integrity = "sha384-2mt9k5dhFHSa/sDrRhxWX98W8LbpVswcb66alj4eNwBFuwHiwG3rFPFdeD7SEL+5";
      script.crossOrigin = "anonymous";
      try {
        await withAgentReadTimeout(new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = reject;
          document.head.append(script);
        }), 12000);
      } catch (error) {
        script.remove();
        throw error;
      }
    }
    const sdk = window.Dynamsoft;
    await sdk.License.LicenseManager.initLicense(license, true);
    await sdk.Core.CoreModule.loadWasm(["DDN"]);
    const instance = await sdk.CVR.CaptureVisionRouter.createInstance();
    try {
      const settings = await instance.getSimplifiedSettings(template);
      settings.documentSettings.colourMode = sdk.DDN.EnumImageColourMode.ICM_COLOUR;
      settings.documentSettings.contrast = 5;
      settings.timeout = 8000;
      await instance.updateSettings(template, settings);
      return instance;
    } catch (error) {
      await instance.dispose();
      throw error;
    }
  }

  function looksLikeWholeCard(points, width, height) {
    const margin = Math.max(3, Math.min(width, height) * 0.02);
    if (points?.length !== 4 || !points.every(({ x, y }) =>
      x >= margin && y >= margin && x < width - margin && y < height - margin
    )) return false;
    const area = Math.abs(points.reduce((sum, point, index) => {
      const next = points[(index + 1) % 4];
      return sum + point.x * next.y - next.x * point.y;
    }, 0)) / 2;
    return area >= width * height * 0.25;
  }

  async function prepare(url, signal) {
    if (!router) {
      router = withAgentReadTimeout(startRouter(), 22000).catch((error) => {
        license = "";
        router = null;
        throw error;
      });
    }
    const instance = await router;
    if (signal.aborted) return null;
    const response = await fetch(url, { signal, referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error("Original photo unavailable.");
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement("canvas");
    try {
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    } finally {
      bitmap.close();
    }
    if (signal.aborted) return null;
    const result = await instance.capture(canvas, template);
    const enhancedType = window.Dynamsoft.Core.EnumCapturedResultItemType.CRIT_ENHANCED_IMAGE;
    const items = (result.items || []).filter(item => item.type === enhancedType);
    if (result.errorCode || items.length !== 1) return null;
    const item = items[0];
    if (!looksLikeWholeCard(item.location?.points, canvas.width, canvas.height)) return null;
    return item.toBlob("image/jpeg");
  }

  function show(container, image, status, original) {
    if (previews.has(container)) return;
    const controller = new AbortController();
    const preview = { controller, objectUrl: "" };
    previews.set(container, preview);
    image.src = original;
    status.textContent = "Preparing trial preview…";

    const work = pendingCapture.then(() => {
      if (controller.signal.aborted) return null;
      return withAgentReadTimeout(prepare(original, controller.signal), 35000);
    });
    pendingCapture = work.catch(() => {});
    work.then(blob => {
      if (!container.isConnected || controller.signal.aborted) return;
      if (!blob?.size) {
        status.textContent = "Original photo shown. A full-card crop could not be confirmed.";
        return;
      }
      preview.objectUrl = URL.createObjectURL(blob);
      image.src = preview.objectUrl;
      status.textContent = "Dynamsoft trial preview. Compare with the original for missing details.";
    }).catch(() => {
      if (!controller.signal.aborted && container.isConnected) {
        status.textContent = "Trial preview unavailable. Choose Enhanced reading copy to use OpenCV.";
      }
      controller.abort();
    });
  }

  function clear() {
    for (const { controller, objectUrl } of previews.values()) {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
    previews.clear();
  }

  return { enabled, requestLicense, show, clear };
})();
