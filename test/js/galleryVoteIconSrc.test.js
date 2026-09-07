/**
 * Tests the Gallery card's agree/disagree thumb icons, which swap between their outline and filled artwork on hover
 * and after a vote.
 *
 * The contract worth pinning is that every state builds its URL from the logical path through `util.assetPath`.
 * Editing the name inside an already-resolved URL instead looks right in dev, where no digests are built, and 404s on
 * staged and prod, where the URL carries the outline file's content fingerprint and the filled file's digest is a
 * different string (#5204). So these tests run with a stamp on the page, giving each file its own digest, exactly as
 * a staged build would.
 */

const fs = require('fs');
const path = require('path');

const { loadGlobalScript, REPO_ROOT } = require('./loadGlobalScript');

// A bare `class` declaration, so it has to be evaluated in the page's scope to be reachable, the way its <script>
// tag makes it reachable in the browser.
const SRC = fs.readFileSync(path.join(REPO_ROOT, 'public/js/gallery/src/displays/ValidationInfoDisplay.js'), 'utf8');

/** A distinct digest per file, so a URL built by carrying one file's fingerprint onto another's name is visible. */
const DIGESTS = {
  'images/icons/validation/agree-outline.svg': '00000000000000000000000000000001',
  'images/icons/validation/agree-filled.svg': '00000000000000000000000000000002',
  'images/icons/validation/disagree-outline.svg': '00000000000000000000000000000003',
  'images/icons/validation/disagree-filled.svg': '00000000000000000000000000000004',
  'images/icons/validation/agree-outline-ai.svg': '00000000000000000000000000000005',
  'images/icons/validation/agree-filled-ai.svg': '00000000000000000000000000000006',
};

/**
 * The URL a staged build serves for one of the icons above.
 * @param {string} logicalPath - The icon's path under public/.
 * @returns {string} Its fingerprinted URL.
 */
const urlFor = (logicalPath) => {
  const cut = logicalPath.lastIndexOf('/') + 1;
  return `/assets/${logicalPath.slice(0, cut)}${DIGESTS[logicalPath]}-${logicalPath.slice(cut)}`;
};

/**
 * Builds a display on a fresh container, the way a Gallery card does.
 * @param {?string} aiValidation - The option our AI validated, or null if it didn't validate this label.
 * @returns {Object} The ValidationInfoDisplay under test.
 */
function makeDisplay(aiValidation = null) {
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  return new window.ValidationInfoDisplay(container, 3, 1, aiValidation, null);
}

/**
 * The `src` currently on one thumb's icon.
 * @param {Object} display - The display to read.
 * @param {string} action - 'Agree' or 'Disagree'.
 * @returns {string} The icon's URL.
 */
const srcOf = (display, action) => {
  const container = action === 'Agree' ? display.agreeContainer : display.disagreeContainer;
  return container.querySelector('.validation-info-image').src;
};

beforeEach(() => {
  window.assetDigests = { ...DIGESTS };
  window.i18next = { t: (key) => key };
  loadGlobalScript('public/js/common/utilities.js');
  window.eval(`${SRC}\nwindow.ValidationInfoDisplay = ValidationInfoDisplay;`);
});

afterEach(() => {
  delete window.assetDigests;
  delete window.i18next;
});

describe('Gallery vote icons', () => {
  test('start out on the fingerprinted outline artwork', () => {
    const display = makeDisplay();
    expect(srcOf(display, 'Agree')).toContain(urlFor('images/icons/validation/agree-outline.svg'));
    expect(srcOf(display, 'Disagree')).toContain(urlFor('images/icons/validation/disagree-outline.svg'));
  });

  test("use the filled file's own digest when filled, not the outline file's", () => {
    const display = makeDisplay();
    display.setVoteIconFilled('Agree', true);
    expect(srcOf(display, 'Agree')).toContain(urlFor('images/icons/validation/agree-filled.svg'));
    // The bug this pins: the outline digest surviving onto the filled name, naming a file that isn't there.
    expect(srcOf(display, 'Agree')).not.toContain(DIGESTS['images/icons/validation/agree-outline.svg']);
  });

  test('return to the outline artwork when unfilled', () => {
    const display = makeDisplay();
    display.setVoteIconFilled('Disagree', true);
    display.setVoteIconFilled('Disagree', false);
    expect(srcOf(display, 'Disagree')).toContain(urlFor('images/icons/validation/disagree-outline.svg'));
  });

  test('keep the -ai variant through a fill swap on the option our AI validated', () => {
    const display = makeDisplay('Agree');
    expect(srcOf(display, 'Agree')).toContain(urlFor('images/icons/validation/agree-outline-ai.svg'));
    display.setVoteIconFilled('Agree', true);
    expect(srcOf(display, 'Agree')).toContain(urlFor('images/icons/validation/agree-filled-ai.svg'));
    // The other thumb has no AI vote on it, so it keeps the plain artwork.
    display.setVoteIconFilled('Disagree', true);
    expect(srcOf(display, 'Disagree')).toContain(urlFor('images/icons/validation/disagree-filled.svg'));
  });
});
