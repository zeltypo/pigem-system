async function phoneTransfer(action, payload) {
  var response = await fetch(_apiEndpoint("/phone-transfer/" + action), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(22000) : undefined
  });
  var data = await response.json().catch(function () { return {}; });
  if (!response.ok || !data) throw new Error(typeof data?.detail === "string" ? data.detail : "Phone transfer is unavailable. Try again.");
  return data;
}

function showPhoneTransferLink(link, title, instructions) {
  openPopup(
    '<h2>' + escapeHtml(title) + '</h2>' +
    '<p class="muted mt">' + escapeHtml(instructions) + '</p>' +
    '<img class="phone-transfer-code" src="' + escapeHtml(link.qr) + '" alt="Scan this QR code with your phone camera">' +
    '<label for="phone-transfer-link">Or copy this link to your phone</label>' +
    '<input id="phone-transfer-link" type="url" readonly value="' + escapeHtml(link.url) + '" onclick="this.select()">' +
    '<p class="small muted mt">Use this link within 15 minutes. Keep it private.</p>' +
    '<p id="phone-transfer-status" class="small mt" role="status"></p>',
    { showCloseX: true, closeOnBackdrop: true, closeOnEscape: true }
  );
}
