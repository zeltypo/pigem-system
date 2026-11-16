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
  let reportExport;
  d.exportPigemPdf = (report, filename, print) => { reportExport = { report, filename, print }; };
  d.getAgentReportData = () => ({ title: 'Test', columns: ['Ref'], rows: [['TEST']], pieSlices: [] });
  d.printActiveDashboardReport();
  assert.equal(reportExport.report.rows[0][0], 'TEST');
  assert.equal(reportExport.print, true);
  assert.equal(reportExport.filename, 'PIGEM-report.pdf');

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
    id_type: 'Student ID', id_image_url: '/fictional-front.jpg', screening: { state: 'unavailable' } }];
  a.activeDetailAppId = 'demo';
  await a.renderDetailModalContent();
  assert(an['det-body'].innerHTML.includes('Screening recommendation'));
  assert(an['det-body'].innerHTML.includes('Checking the ID photos'));
  fs.writeFileSync('tests/review-preview.html', `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="../web/style.css"><title>Fictional review preview</title><main id="app-detail-modal" style="max-width:1050px;margin:auto;padding:16px"><h1>Fictional review preview</h1><p>Layout check only. No live applicant records.</p>${an['det-body'].innerHTML}</main>`);

  assert(!/\b(?:OCR|OpenAI|API|AI)\b/.test(an['det-body'].innerHTML.replace(/<[^>]+>/g, ' ')),
    'Agent-visible text must use plain labels');
  const previewMarkup = an['det-body'].innerHTML;
  assert(previewMarkup.indexOf('Screening recommendation') < previewMarkup.indexOf('Valid ID Photos'));
  assert(previewMarkup.indexOf('Valid ID Photos') < previewMarkup.indexOf('Applicant Details'));
  assert(!previewMarkup.includes('Send Update Request to Customer'));
  assert(!previewMarkup.includes('Save Status Update'));
  a.agentDetailMode = 'correction';
  await a.renderDetailModalContent();
  assert(an['det-body'].innerHTML.includes('Send Update Request to Customer'));
  assert(!an['det-body'].innerHTML.includes('Save Status Update'));
  a.agentDetailMode = 'status';
  await a.renderDetailModalContent();
  assert(an['det-body'].innerHTML.includes('Save Status Update'));
  assert(!an['det-body'].innerHTML.includes('Send Update Request to Customer'));
  a.agentDetailMode = 'documents';

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
  applyContext.selectedBackFile = null;
  assert.equal(await applyContext.validateSelectedIdQuality(), true, 'A back photo is optional');
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
  const output = {
    dataset: { front: '/front.jpg', back: '/back.jpg', name: 'Maya Dela Cruz', birth: '2001-01-25', number: '12345' },
  };
  const photos = [];
  reader.fetch = async (url, options) => {
    assert(!options.method && !options.body, 'Document checking may only download existing photos');
    photos.push(url);
    return { ok: true, blob: async () => url };
  };
  let workerClosed = false;
  reader.Tesseract = { createWorker: async () => ({
    recognize: async photo => ({ data: photo === '/front.jpg'
      ? { text: 'NAME: Maya Dela Cruz\nDATE OF BIRTH: 2001-01-25\nID NUMBER: 12345', confidence: 90 }
      : { text: 'unreliable', confidence: 25 } }),
    terminate: async () => { workerClosed = true; },
  }) };
  await reader.showAgentIdFindings(output);
  assert.deepEqual(photos, ['/front.jpg', '/back.jpg']);
  assert(output.textContent.includes('Name: Matches'));
  assert(output.textContent.includes('Birth date: Matches'));
  assert(output.textContent.includes('ID number: Matches'));
  assert(output.textContent.includes('Back ID photo: text is unclear'));
  assert(!output.textContent.includes('unreliable'));
  assert(workerClosed);
  await reader.showAgentIdFindings(output);
  assert.equal(photos.length, 2, 'Rendering the same open application must not read its photos twice');
  const mismatch = reader.compareAgentIdDetails('ID NUMBER: 12345', { number: '12354' });
  assert(mismatch.includes('ID number: Check difference (photo reads 12345)'));
  const missing = reader.compareAgentIdDetails('DATE OF ISSUE: 2001-01-25', { birth: '2001-01-25' });
  assert(missing.includes('Birth date: Could not verify'));

  const numberDraft = reader.getFindingCorrectionDraft({
    fields: reader.compareAgentIdFields('ID NUMBER: 12345', { number: '12354' }), unclearSides: [],
  });
  assert.deepEqual(Array.from(numberDraft.fields), ['id_number']);
  assert(numberDraft.message.includes('ID number'));
  const photoDraft = reader.getFindingCorrectionDraft({ fields: [], unclearSides: ['Back'] });
  assert.deepEqual(Array.from(photoDraft.fields), ['id_photo']);
  assert.deepEqual(Array.from(photoDraft.sides), ['back']);
  assert(photoDraft.message.includes('back'));
  assert(!photoDraft.message.includes('front'));

  let printExport;
  a.document.querySelector = () => ({
    _documentFindings: { fields: [], unclearSides: ['Front'], unavailableSides: [] },
  });
  a.exportPigemPdf = (report, filename, print) => { printExport = { report, filename, print }; };
  a.printApplicantCopy();
  assert.equal(printExport.print, true);
  assert.equal(printExport.filename, 'PIGEM-DEMO-ONLY.pdf');
  assert(printExport.report.note.includes('Front ID photo: text is unclear'));
  assert(!JSON.stringify(printExport.report).includes('/fictional-front.jpg'));
  a.downloadApplicantCopy();
  assert.equal(printExport.print, false);

  const { sandbox: statusEmail } = context('web/js/api.js');
  statusEmail.apiSendEmail = async (to, subject, body, options) => ({ to, subject, body, options });
  const approved = await statusEmail.apiSendStatusEmail('demo@example.test', 'Maya', 'TEST', 'Approved');
  assert(approved.body.includes('Check your account for installation updates'));
  const rejected = await statusEmail.apiSendStatusEmail('demo@example.test', 'Maya', 'TEST', 'Rejected', 'The provider has no open slot.');
  assert(rejected.subject.includes('Rejected'));
  assert(rejected.body.includes('The provider has no open slot.'));
  const { sandbox: login } = context('web/js/login.js');
  login.isValidUsername = value => /^[a-z0-9_.]{3,30}$/i.test(value);
  login.isCustomerGmail = value => /^[^@\s]+@gmail\.com$/i.test(value);
  assert.equal(login.validateLoginIdentifier(' @Test_Agent ', true).value, 'Test_Agent');
  assert(login.validateLoginIdentifier('demo@gmail.com', true).error);
  assert.equal(login.validateLoginIdentifier('DEMO@GMAIL.COM', false).value, 'demo@gmail.com');
  assert(login.validateLoginIdentifier('demo@example.test', false).error);
  assert(login.validateLoginIdentifier('x', false).error);
  login.apiVerifyCaptcha = async () => ({ verified: false });
  await login.window.onLoginCaptchaVerified('rejected');
  assert.equal(login.loginCaptchaVerified, false);
  let finishCaptcha;
  login.apiVerifyCaptcha = () => new Promise(resolve => { finishCaptcha = resolve; });
  const pendingCaptcha = login.window.onLoginCaptchaVerified('test');
  login.window.onLoginCaptchaExpired();
  finishCaptcha({ verified: true });
  await pendingCaptcha;
  assert.equal(login.loginCaptchaVerified, false, 'A late reply must not restore an expired security check');
  const { sandbox: header } = context('web/js/config.js');
  const accountButton = { removeAttribute: key => { delete accountButton[key]; } };
  const customerLink = { hidden: true };
  header.document.querySelectorAll = selector => selector === '.account-btn' ? [accountButton] : [customerLink];
  header.dbHasPublicCustomerSession = async () => true;
  await header.setupPublicHeader();
  assert.equal(accountButton.textContent, 'Apply');
  assert.equal(customerLink.hidden, false);
  header.dbHasPublicCustomerSession = async () => false;
  await header.setupPublicHeader();
  assert.equal(accountButton.textContent, 'Customer Login');
  assert.equal(accountButton.href, 'login.html');
  assert.equal(accountButton.target, undefined);
  assert.equal(customerLink.hidden, true);
  const { sandbox: queue, nodes: queueNodes } = context('web/js/agent.js');
  queueNodes['agent-cards-box'] = {};
  queueNodes['q-filter'] = { value: 'Demo' };
  queue.currentAgent = { username: 'agent' };
  queue.isAssignedToStaff = (assigned, user) => assigned === user.username;
  queue.statusBadge = status => status;
  queue.allApps = [
    { id: 'shared', full_name: 'Demo Shared', reference_no: 'REF-SHARED', status: 'Pending Review' },
    { id: 'claimed', full_name: 'Demo Claimed', reference_no: 'REF-CLAIMED', status: 'Under Agent Review', assigned_agent: 'agent' },
  ];
  queue.activeBranch = 'queue';
  queue.renderAgentCards();
  assert(queueNodes['agent-cards-box'].innerHTML.includes('<strong>Demo Shared'));
  const sharedMarkup = queueNodes['agent-cards-box'].innerHTML;
  assert(sharedMarkup.includes('class="agent-queue-header"><details'));
  assert(sharedMarkup.includes('>Claim</button></div></div>'));
  assert(sharedMarkup.indexOf('</details>') < sharedMarkup.indexOf('>Claim</button>'));
  assert(sharedMarkup.indexOf('>Claim</button>') < sharedMarkup.indexOf('class="agent-queue-details"'));
  assert(!queueNodes['agent-cards-box'].innerHTML.includes('<select'));
  let prompt;
  queue.openPopup = html => { prompt = html; };
  queue.confirmAgentClaim('shared');
  assert(prompt.includes('Check documents first') && prompt.includes('Yes, claim'));
  queue.activeBranch = 'claimed';
  queue.renderAgentCards();
  assert(queueNodes['agent-cards-box'].innerHTML.includes('<option value="correction">Needs correction'));
  assert(!queueNodes['agent-cards-box'].innerHTML.includes('REF-SHARED'));
  console.log('PASS: quality blocking and replacement races, automatic checks, plain staff labels, corrections, notifications and reports');
})().catch(error => { console.error(error); process.exitCode = 1; });
