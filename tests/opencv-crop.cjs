// Run with the downloaded production OpenCV build: node tests/opencv-crop.cjs <opencv.js>
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const cv = await require(path.resolve(process.argv[2]));
  const source = fs.readFileSync('web/js/agent.js', 'utf8');
  const scope = {};
  vm.createContext(scope);
  vm.runInContext(source.slice(source.indexOf('function getAgentCardShape('), source.indexOf('async function enhanceAgentIdPhoto(')), scope);
  function check(name, draw, expected) {
    const gray = new cv.Mat(700, 1000, cv.CV_8UC1, new cv.Scalar(45));
    try {
      draw(gray);
      const crop = scope.findAgentIdCorners(gray, cv);
      assert.equal(Boolean(crop), expected, name);
      if (crop) {
        assert(crop.width > 500 && crop.height > 300, name + ': preserve the card');
      }
      console.log('PASS:', name);
    } finally { gray.delete(); }
  }
  check('Clear card', m => cv.rectangle(m, new cv.Point(180, 150), new cv.Point(820, 550), new cv.Scalar(215), -1), true);
  check('Dim card', m => cv.rectangle(m, new cv.Point(180, 150), new cv.Point(820, 550), new cv.Scalar(75), -1), true);
  check('Rounded card corners', m => {
    cv.rectangle(m, new cv.Point(210, 150), new cv.Point(790, 550), new cv.Scalar(215), -1);
    cv.rectangle(m, new cv.Point(180, 180), new cv.Point(820, 520), new cv.Scalar(215), -1);
    for (const x of [210, 790]) for (const y of [180, 520]) cv.circle(m, new cv.Point(x, y), 30, new cv.Scalar(215), -1);
  }, true);
  check('Clipped card keeps whole photo', m => cv.rectangle(m, new cv.Point(0, 150), new cv.Point(640, 550), new cv.Scalar(215), -1), false);
  check('No edges keeps whole photo', () => {}, false);
})().catch(error => { console.error(error); process.exitCode = 1; });
