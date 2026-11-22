const agentDynamsoft = (() => {
  const enabled = new URLSearchParams(window.location.search).get("dynamsoft-trial") === "1";
  const template = "DetectAndNormalizeDocument_Default";
  const detectTemplate = "DetectDocumentBoundaries_Default";
  const normalizeTemplate = "NormalizeDocument_Default";
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
      settings.documentSettings.minQuadrilateralAreaRatio = 20;
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
    return area >= width * height * 0.18;
  }

  async function prepare(url, signal, rotation) {
    if (!license) throw new Error("Trial license unavailable.");
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
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const angle = { rotate_90_cw: Math.PI / 2, rotate_90_ccw: -Math.PI / 2, rotate_180: Math.PI }[rotation] || 0;
      const quarterTurn = Math.abs(angle) === Math.PI / 2;
      canvas.width = quarterTurn ? height : width;
      canvas.height = quarterTurn ? width : height;
      const context = canvas.getContext("2d");
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(angle);
      context.drawImage(bitmap, -width / 2, -height / 2, width, height);
    } finally {
      bitmap.close();
    }
    if (signal.aborted) return null;
    const types = window.Dynamsoft.Core.EnumCapturedResultItemType;
    const result = await instance.capture(canvas, template);
    if (result.errorCode) throw new Error("Document scanner returned an error.");
    const enhanced = (result.items || []).filter(item => item.type === types.CRIT_ENHANCED_IMAGE);
    if (enhanced.length === 1 && looksLikeWholeCard(enhanced[0].location?.points, canvas.width, canvas.height)) {
      return { blob: await enhanced[0].toBlob("image/jpeg") };
    }
    if (signal.aborted) return null;
    const detected = await instance.capture(canvas, detectTemplate);
    if (detected.errorCode) throw new Error("Document border detection failed.");
    const quads = (detected.items || []).filter(item => item.type === types.CRIT_DETECTED_QUAD);
    const points = quads.length === 1 ? quads[0].location?.points : null;
    if (!looksLikeWholeCard(points, canvas.width, canvas.height)) {
      return { message: "No single full-card outline found. Showing the original photo." };
    }
    const centerX = points.reduce((sum, point) => sum + point.x, 0) / 4;
    const centerY = points.reduce((sum, point) => sum + point.y, 0) / 4;
    const padded = points.map(({ x, y }) => ({
      x: Math.round(centerX + (x - centerX) * 1.10),
      y: Math.round(centerY + (y - centerY) * 1.10)
    }));
    if (!looksLikeWholeCard(padded, canvas.width, canvas.height)) {
      return { message: "The card is too close to the photo edge for a padded crop. Showing the original photo." };
    }
    const settings = await instance.getSimplifiedSettings(normalizeTemplate);
    settings.roi.points = padded;
    settings.roiMeasuredInPercentage = false;
    settings.documentSettings.colourMode = window.Dynamsoft.DDN.EnumImageColourMode.ICM_COLOUR;
    settings.documentSettings.contrast = 5;
    settings.timeout = 8000;
    await instance.updateSettings(normalizeTemplate, settings);
    if (signal.aborted) return null;
    const normalized = await instance.capture(canvas, normalizeTemplate);
    if (normalized.errorCode) throw new Error("Document normalization failed.");
    const copies = (normalized.items || []).filter(item => item.type === types.CRIT_ENHANCED_IMAGE);
    return copies.length === 1 ? { blob: await copies[0].toBlob("image/jpeg") } : null;
  }

  function show(container, image, status, original, rotation) {
    if (previews.has(container)) return;
    const controller = new AbortController();
    const preview = { controller, objectUrl: "" };
    previews.set(container, preview);
    image.src = original;
    status.textContent = "Preparing trial preview…";

    const work = pendingCapture.then(() => {
      if (controller.signal.aborted) return null;
      return withAgentReadTimeout(prepare(original, controller.signal, rotation), 48000);
    });
    pendingCapture = work.catch(() => {});
    work.then(result => {
      if (!container.isConnected || controller.signal.aborted) return;
      const blob = result?.blob;
      if (!blob?.size) {
        status.textContent = result?.message || "No cropped copy was returned. Showing the original photo.";
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
