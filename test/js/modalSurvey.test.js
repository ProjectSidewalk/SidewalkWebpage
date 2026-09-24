/**
 * Tests the Explore survey dialog (public/js/explore/src/modal/ModalSurvey.js): where focus lands on open, which
 * closes count as a skip, and what a submit posts.
 *
 * jsdom has no <dialog> implementation, so showModal/close are stubbed on the prototype to flip `open` and fire
 * `close` the way a browser does (asynchronously).
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.resolve(__dirname, '../../public/js/explore/src/modal/ModalSurvey.js'), 'utf8');

function installDialogStub() {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
    const first = this.querySelector('button, input, textarea');
    if (first) first.focus();
  };
  HTMLDialogElement.prototype.close = function () {
    if (!this.open) return;
    this.open = false;
    setTimeout(() => this.dispatchEvent(new Event('close')));
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

let logged;
let posted;
let survey;

beforeEach(() => {
  document.body.innerHTML = `
    <dialog id="survey-modal-container" tabindex="-1" closedby="none">
      <button type="button" id="survey-skip-button">×</button>
      <form id="survey-form">
        <input type="radio" name="1" value="a" required>
        <textarea name="2"></textarea>
        <button type="submit">Submit</button>
      </form>
    </dialog>`;
  installDialogStub();
  logged = [];
  posted = [];
  window.logWebpageActivity = (name) => logged.push(name);
  window.fetch = jest.fn((url, opts) => {
    posted.push(JSON.parse(opts.body));
    return Promise.resolve({ ok: true });
  });
  const noop = () => {};
  window.svl = {
    popUpMessage: { disableInteractions: noop, enableInteractions: noop },
    ribbon: { disableModeSwitch: noop, enableModeSwitch: noop },
    zoomControl: { disableZoomIn: noop, disableZoomOut: noop, enableZoomIn: noop, enableZoomOut: noop },
  };
  window.eval(`${SRC}\nwindow.ModalSurvey = ModalSurvey;`);
  survey = new window.ModalSurvey();
});

test('opens with focus on the dialog itself, not the skip X', () => {
  survey.open();

  expect(document.activeElement).toBe(document.getElementById('survey-modal-container'));
});

test('a close that is not a submit is logged as a skip', async () => {
  survey.open();
  document.getElementById('survey-skip-button').click();
  await flush();

  expect(document.getElementById('survey-modal-container').open).toBe(false);
  expect(logged).toEqual(['SurveySkip']);
});

test('a submit posts the answers as name/value pairs and is not a skip', async () => {
  survey.open();
  const form = /** @type {HTMLFormElement} */ (document.getElementById('survey-form'));
  form.querySelector('input').checked = true;
  form.querySelector('textarea').value = 'because';
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();

  expect(posted).toEqual([[{ name: '1', value: 'a' }, { name: '2', value: 'because' }]]);
  expect(document.getElementById('survey-modal-container').open).toBe(false);
  expect(logged).toEqual([]);
});

test('a skip after an earlier submit is still a skip', async () => {
  survey.open();
  document.getElementById('survey-form').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
  survey.open();
  document.getElementById('survey-skip-button').click();
  await flush();

  expect(logged).toEqual(['SurveySkip']);
});
