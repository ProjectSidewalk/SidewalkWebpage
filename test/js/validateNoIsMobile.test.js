/**
 * Keeps `util.isMobile()` out of the Validate bundle (#5580).
 *
 * `util.isMobile()` is the server's user-agent verdict, and a phone can reach /validate, so in Validate it answers
 * neither question the code actually asks. Which page this is reads `svv.legacyMobile`; which controls to build reads
 * `svv.touchControls`; which layout is showing reads `Main.isNarrowLayout()`. A new call would quietly reintroduce
 * the user-agent fork this issue removes, so any one outside the allow-list fails here.
 *
 * The allow-list is the one honest device-class gate: offering Explore exactly when the server would serve it rather
 * than bounce a mobile user agent to /mobileLanding. #5665 removes that bounce, and these entries go with it.
 */

const fs = require('fs');
const path = require('path');

const { REPO_ROOT } = require('./loadGlobalScript');

const VALIDATE_DIR = path.join(REPO_ROOT, 'frontend/js/validate');
const ALLOWED = new Set(['modal/ModalMissionComplete.js', 'modal/ModalNoNewMission.js']);

/**
 * @param {string} dir - A directory to walk.
 * @returns {string[]} Every .js file under it.
 */
function jsFilesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFilesUnder(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

test('no Validate module asks util.isMobile() outside the allow-list', () => {
  const offenders = jsFilesUnder(VALIDATE_DIR)
    .map((file) => path.relative(VALIDATE_DIR, file).split(path.sep).join('/'))
    .filter((rel) => !ALLOWED.has(rel))
    .flatMap((rel) => fs.readFileSync(path.join(VALIDATE_DIR, rel), 'utf8').split('\n')
      .map((line, i) => ({ rel, line, n: i + 1 }))
      // Comments may name it, as Main.js does to explain why it isn't used.
      .filter(({ line }) => line.includes('util.isMobile(') && !/^\s*(\/\/|\*)/.test(line))
      .map(({ rel, n }) => `${rel}:${n}`));

  expect(offenders).toEqual([]);
});

test('the allow-list names files that still exist and still need it', () => {
  for (const rel of ALLOWED) {
    expect(fs.readFileSync(path.join(VALIDATE_DIR, rel), 'utf8')).toContain('util.isMobile(');
  }
});
