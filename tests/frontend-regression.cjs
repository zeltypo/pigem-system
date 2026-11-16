// Run with node tests/frontend-regression.cjs. No live accounts or database writes.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function context(file) {
  const nodes = {};
  const sandbox = { window: { addEventListener() {} }, console,
    document: { getElementById: id => nodes[id] || null, addEventListener() {} },
    setTimeout() {}, setInterval() {}, clearInterval() {},
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    formatDate: value => value || '',
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox);
  return { sandbox, nodes };
}

(async () => {
  const { sandbox: c, nodes } = context('web/js/customer.js');
  c.dbListApplicationsForCustomer = async () => [{ id: 'demo', status: 'Needs Correction' }];
  c.getCustomerStatus = () => 'Processing';
  c.promptCustomerCorrectionReminder = () => {};
  c.renderAppList = () => {};
  let renders = 0;
  c.renderSelectedApp = () => renders++;
  nodes['btn-fix'] = {};
  await c.loadMyApplications(true);
  assert.equal(renders, 0, 'Polling must preserve the correction form and selected files');
  await c.loadMyApplications();
  assert.equal(renders, 1, 'Explicit refresh must still update the detail view');

  const { sandbox: d, nodes: dn } = context('web/js/dash-ui.js');
  let readAll = 0, refreshes = 0;
  dn['notif-modal'] = { classList: { contains: () => true, toggle() {} } };
  d.dashCurrentUser = { id: 'demo' };
  d.markAllDashNotificationsRead = async () => readAll++;
  d.refreshNotifBell = async () => refreshes++;
  await d.toggleNotifModal();
  assert.equal(readAll, 0, 'Opening notifications must not mark them all read');
  assert.equal(refreshes, 1);
  let autoPrints = 0;
  const preview = { document: { open() {}, write() {}, close() {} }, focus() {}, print() { autoPrints++; } };
  d.window.open = () => preview;
  d.getAgentReportData = () => ({ title: 'Test', columns: ['Ref'], rows: [['TEST']], pieSlices: [] });
  d.setTimeout = fn => fn();
  d.printActiveDashboardReport();
  assert.equal(autoPrints, 0, 'Preview must not automatically block the parent with a print dialog');
  let downloadedRows;
  d.downloadFormattedHtmlReport = (title, timeframe, slices, columns, rows) => { downloadedRows = rows; };
  d.window.open = () => null;
  d.printActiveDashboardReport();
  assert.equal(downloadedRows[0][0], 'TEST', 'Blocked popups must offer the full filtered report');

  const { sandbox: quality } = context('web/js/api.js');
  const width = 300, height = 200;
  const pixels = new Uint8Array(width * height * 4).fill(255);
  quality.Image = class {
    naturalWidth = width;
    naturalHeight = height;
    set src(value) { this.onload(); }
  };
  quality.URL = { createObjectURL: () => 'fixture', revokeObjectURL() {} };
  quality.document.createElement = () => ({
    getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) })
  });
  for (let y = 20; y < 180; y += 10) {
    for (let x = 20; x < 280; x += 3) {
      const pixel = (y * width + x) * 4;
      pixels.fill(20, pixel, pixel + 3);
    }
  }
  const digitalId = await quality.analyzeClientIdQuality({});
  assert(digitalId.passed, 'A crisp white-background digital ID must pass the local quality check');
  pixels.fill(255);
  const washedOut = await quality.analyzeClientIdQuality({});
  assert(washedOut.issues.some(issue => issue.includes('washed out')));

  const dbSource = fs.readFileSync('web/js/db.js', 'utf8');
  const normalizeSource = dbSource.slice(dbSource.indexOf('function normalizeAppRecord('), dbSource.indexOf('function ensureDemoSeedApps('));
  vm.runInContext(normalizeSource, d);
  const normalized = d.normalizeAppRecord({ id: 'demo', ai_result: { name_match: true },
    screening: { ocr: { available: true }, comparisons: [
      { key: 'name', status: 'mismatch', found_on_id: 'Different Name' }
    ] } });
  assert.equal(normalized.ai_result.name_match, false, 'New mismatch must replace cached match');
  assert.equal(normalized.ai_result.id_number_match, null, 'An absent field check must not default to matched');

  // Render the real agent template using explicitly fictional data for visual review.
  const { sandbox: a, nodes: an } = context('web/js/agent.js');
  an['det-title'] = {}; an['det-body'] = {};
  a.isAiEnabled = () => false;
  a.documentCheckUnavailable = () => false;
  a.dbListAiLogs = async () => [];
  a.statusBadge = a.customerStatusBadge = status => `<span class="badge">${status}</span>`;
  a.allApps = [{ id: 'demo', reference_no: 'DEMO-ONLY', full_name: 'Sample Applicant',
    plan_name: 'Sample Fiber Plan', status: 'Under Agent Review', city: 'Rosario', province: 'Cavite',
    id_type: 'Student ID', screening: { state: 'unavailable' } }];
  a.activeDetailAppId = 'demo';
  await a.renderDetailModalContent();
  assert(an['det-body'].innerHTML.includes('Verify Manually'));
  fs.writeFileSync('tests/review-preview.html', `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="../web/style.css"><title>Fictional review preview</title><main id="app-detail-modal" style="max-width:1050px;margin:auto;padding:16px"><h1>Fictional review preview</h1><p>Layout check only. No live applicant records.</p>${an['det-body'].innerHTML}</main>`);

  assert(!/\b(?:OCR|OpenAI|API|AI)\b/.test(an['det-body'].innerHTML.replace(/<[^>]+>/g, ' ')),
    'Agent-visible text must use plain labels');
  assert(!an['det-body'].innerHTML.includes('Run / Refresh Document Check'));

  // Exercise the application gate twice: a second click must not bypass the failure.
  const applyContext = { window: { addEventListener() {} }, document: {
    getElementById: id => applyNodes[id] || null
  }, console };
  const applyNodes = { 'id-front-quality': {}, 'id-back-quality': {}, 'id-screen-warn': {} };
  vm.createContext(applyContext);
  vm.runInContext(fs.readFileSync('web/js/apply.js', 'utf8').replace(/initApplyPage\(\);\s*$/, ''), applyContext);
  applyContext.showPanel = index => { applyContext.currentPanel = index; };
  applyContext.analyzeClientIdQuality = async file => ({
    passed: file.clear, issues: file.clear ? [] : ['The photo is blurry.']
  });
  applyContext.selectedFrontFile = { clear: false };
  applyContext.selectedBackFile = { clear: true };
  assert.equal(await applyContext.validateSelectedIdQuality(), false);
  assert.equal(await applyContext.validateSelectedIdQuality(), false);
  assert(applyNodes['id-front-quality'].textContent.includes('Replace'));
  assert(applyNodes['id-back-quality'].textContent.includes('passed'));
  applyContext.selectedFrontFile = { clear: true };
  assert.equal(await applyContext.validateSelectedIdQuality(), true);
  // A late response from an old selection must not overwrite its replacement.
  let oldResolve;
  applyContext.analyzeClientIdQuality = file => file.old
    ? new Promise(resolve => { oldResolve = resolve; })
    : Promise.resolve({ passed: true, issues: [] });
  const oldCheck = applyContext.checkSelectedIdQuality('front', { old: true });
  await applyContext.checkSelectedIdQuality('front', { clear: true });
  oldResolve({ passed: false, issues: ['Old photo'] });
  await oldCheck;
  assert(applyNodes['id-front-quality'].textContent.includes('passed'));

  quality.isAiEnabled = () => true;
  let checksStarted = 0, checksCompleted = 0;
  quality.apiStartBackgroundScreening = async () => { checksStarted++; return { screened: true }; };
  const pending = [{ id: 'fictional', status: 'Pending Review', screening: { state: 'pending_agent' } }];
  await quality.checkPendingDocuments(pending, async () => { checksCompleted++; });
  await quality.checkPendingDocuments(pending, async () => { checksCompleted++; });
  assert.equal(checksStarted, 1, 'Polling must not repeat the same check immediately');
  assert.equal(checksCompleted, 1, 'Automatic results must notify the portal without a button click');
  quality.Image = class { set src(value) { this.onerror(); } };
  assert.equal((await quality.analyzeClientIdQuality({})).passed, false,
    'An undecodable image must not pass the upload check');
  const { sandbox: reader } = context('web/js/agent.js');
  const output = {};
  const button = {
    dataset: { front: '/front.jpg', back: '/back.jpg' },
    parentElement: { querySelector: () => output },
  };
  const photos = [];
  reader.fetch = async (url, options) => {
    assert(!options.method && !options.body, 'The photo reader may only download existing photos');
    photos.push(url);
    return { ok: true, blob: async () => url };
  };
  let workerClosed = false;
  reader.Tesseract = { createWorker: async () => ({
    recognize: async photo => ({ data: photo === '/front.jpg'
      ? { text: 'FICTIONAL STUDENT ID', confidence: 90 }
      : { text: 'unreliable', confidence: 25 } }),
    terminate: async () => { workerClosed = true; },
  }) };
  await reader.readAgentIdText(button);
  assert.deepEqual(photos, ['/front.jpg', '/back.jpg']);
  assert(output.textContent.includes('FICTIONAL STUDENT ID'));
  assert(output.textContent.includes('Could not read text clearly'));
  assert(!output.textContent.includes('unreliable'));
  assert(workerClosed && !button.disabled);
  console.log('PASS: quality blocking and replacement races, automatic checks, plain staff labels, corrections, notifications and reports');
})().catch(error => { console.error(error); process.exitCode = 1; });
