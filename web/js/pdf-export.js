function savePigemExport(blob, filename) {
  var url = URL.createObjectURL(blob);
  var link = document.createElement("a");
  link.href = url;
  link.download = String(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
}

var pigemPdfLogo;

function loadPigemPdfLogo() {
  if (!pigemPdfLogo) {
    pigemPdfLogo = fetch(getImageUrl("black-logo-white-mode.png"), {
      signal: AbortSignal.timeout(5000)
    }).then(async function (response) {
      if (!response.ok) return null;
      return new Uint8Array(await response.arrayBuffer());
    }).catch(function () { return null; });
  }
  return pigemPdfLogo;
}

async function exportPigemPdf(report, filename, print) {
  // Open the tab while the click still counts as a user action.
  var preview = print ? window.open("", "_blank") : null;
  if (preview) preview.opener = null;
  var blob;
  try {
    blob = buildPigemPdf(report, await loadPigemPdfLogo()).output("blob");
  } catch (error) {
    if (preview) preview.close();
    showAlert("PDF unavailable", "Refresh the page and try again.");
    return;
  }
  if (preview && !preview.closed) {
    var url = URL.createObjectURL(blob);
    preview.location.replace(url);
    setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
    return;
  }
  savePigemExport(blob, filename);
  if (print) showAlert("PDF downloaded", "Open the PDF to print it.");
}

function buildPigemPdf(report, logo) {
  var doc = new window.jspdf.jsPDF({ unit: "pt", format: "letter", orientation: "portrait", compress: true });
  var margin = 72;
  var width = 468;
  var bottom = 697;
  var y;

  function plain(value) {
    return String(value == null || value === "" ? "-" : value)
      .replace(/₱/g, "PHP ").replace(/[—–]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  }

  function font(size, bold) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
  }

  function pageHeader() {
    var logoDrawn = false;
    if (logo) {
      try {
        var image = doc.getImageProperties(logo);
        var scale = Math.min(36 / image.width, 34 / image.height);
        var logoWidth = image.width * scale;
        var logoHeight = image.height * scale;
        doc.addImage(logo, "PNG", margin, margin + (34 - logoHeight) / 2, logoWidth, logoHeight, "pigem-logo");
        logoDrawn = true;
      } catch (error) {}
    }
    if (!logoDrawn) {
      doc.setFillColor(161, 20, 41);
      doc.roundedRect(margin, margin, 34, 34, 5, 5, "F");
      doc.setTextColor(255, 255, 255);
      font(20, true);
      doc.text("P", margin + 17, margin + 24, { align: "center" });
    }
    doc.setTextColor(36, 45, 60);
    font(9, true);
    doc.text("PIGEM  /  COMBINED FACILITIES SUPPORT SERVICES", margin + 46, margin + 12);
    font(15, true);
    var title = doc.splitTextToSize(plain(report.title), width - 46);
    doc.text(title, margin + 46, margin + 31);
    y = Math.max(margin + 42, margin + 34 + title.length * 17);
    doc.setDrawColor(188, 198, 210);
    doc.line(margin, y, margin + width, y);
    y += 20;
  }

  function newPage() {
    doc.addPage();
    pageHeader();
  }

  function paragraph(title, text) {
    font(9, true);
    doc.setTextColor(116, 17, 34);
    doc.text(plain(title), margin, y);
    y += 16;
    font(10, false);
    doc.setTextColor(36, 45, 60);
    var lines = doc.splitTextToSize(plain(text), width);
    lines.forEach(function (line) {
      if (y > bottom) {
        newPage();
        font(10, false);
      }
      doc.text(line, margin, y);
      y += 14;
    });
    y += 12;
  }

  pageHeader();
  if (report.subtitle) paragraph("OVERVIEW", report.subtitle);
  if (report.note) paragraph(report.noteTitle || "NOTES", report.note);

  var columns = report.columns && report.columns.length ? report.columns : ["Details"];
  var widths = columns.map(function (_, index) {
    return width * (report.widths ? report.widths[index] : 1 / columns.length);
  });
  var lineHeight = 11;
  var pad = 5;
  function wrapped(cells, bold) {
    font(8, bold);
    return columns.map(function (_, index) {
      return doc.splitTextToSize(plain(cells[index]), widths[index] - 2 * pad);
    });
  }
  function drawRow(lines, start, count, heading, index) {
    var height = count * lineHeight + 2 * pad;
    if (heading) doc.setFillColor(36, 45, 60);
    else if (index % 2 === 0) doc.setFillColor(241, 244, 248);
    else doc.setFillColor(255, 255, 255);
    doc.rect(margin, y, width, height, "F");
    doc.setTextColor(heading ? 255 : 36, heading ? 255 : 45, heading ? 255 : 60);
    font(8, heading);
    var x = margin;
    lines.forEach(function (cell, column) {
      cell.slice(start, start + count).forEach(function (line, offset) {
        doc.text(line, x + pad, y + pad + 7 + offset * lineHeight);
      });
      x += widths[column];
    });
    y += height;
  }
  function tableHeader() {
    var headers = wrapped(columns, true);
    drawRow(headers, 0, Math.max.apply(null, headers.map(function (cell) { return cell.length; })), true, 0);
  }

  if (y + 58 > bottom) newPage();
  if (report.section) {
    font(10, true);
    doc.setTextColor(36, 45, 60);
    doc.text(plain(report.section), margin, y);
    y += 12;
  }
  tableHeader();
  var rows = report.rows && report.rows.length ? report.rows : [["No records found."]];
  rows.forEach(function (row, index) {
    var lines = wrapped(row, false);
    var length = Math.max.apply(null, lines.map(function (cell) { return cell.length; }));
    for (var offset = 0; offset < length;) {
      var room = Math.floor((bottom - y - 2 * pad) / lineHeight);
      if (room < 1 || (offset === 0 && length <= 30 && length > room)) {
        newPage();
        tableHeader();
        room = Math.floor((bottom - y - 2 * pad) / lineHeight);
      }
      var count = Math.min(room, length - offset);
      drawRow(lines, offset, count, false, index);
      offset += count;
    }
  });

  var pages = doc.getNumberOfPages();
  for (var page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(188, 198, 210);
    doc.line(margin, 705, margin + width, 705);
    font(8, false);
    doc.setTextColor(70, 80, 96);
    doc.text("For PIGEM staff use only", margin, 719);
    doc.text("Page " + page + " of " + pages, margin + width, 719, { align: "right" });
  }
  doc.setProperties({ title: plain(report.title), author: "PIGEM" });
  return doc;
}
