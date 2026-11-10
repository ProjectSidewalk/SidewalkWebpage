/**
 * Tests for the training-example panel on a label's admin page (frontend/js/shared-label/GoldExamplePin.js, #1445):
 * which reasons it offers, how it shows the label's current pin, and what Pin and Remove send and say. The reason is
 * what a validator who misses the example is told, so the menu must offer exactly the type's Disagree reasons (#5840).
 */

import { loadModules } from './loader.js';
import { reasonText } from './support/goldExampleHarness.js';
import { flush, routeFetch, sentRequests } from './support/routeFetch.js';

const PIN_URL = '/adminapi/goldExamples';

/** The panel from sharedLabel.scala.html, as an admin sees it. */
const MARKUP = `
  <section class="spotlight__gold" id="spotlight-gold">
    <select class="ps-select" id="spotlight-gold-reason"></select>
    <button type="button" id="spotlight-gold-pin"></button>
    <button type="button" id="spotlight-gold-unpin" hidden>Remove</button>
    <p class="spotlight__gold-status" id="spotlight-gold-status" role="status" aria-live="polite"></p>
  </section>`;

let GoldExamplePin;

beforeEach(async () => {
  ({ GoldExamplePin } = await loadModules('frontend/js/shared-label/GoldExamplePin.js'));
  document.body.innerHTML = MARKUP;
});

/**
 * Builds the panel for a label.
 * @param {{labelType?: string, goldReason?: ?string}} [config] - The label's type and current pin.
 */
function mount({ labelType = 'CurbRamp', goldReason = null } = {}) {
  new GoldExamplePin(document.getElementById('spotlight-gold'), { labelId: 42, labelType, goldReason });
}

/** @returns {HTMLSelectElement} The reason menu. */
const select = () => /** @type {HTMLSelectElement} */ (document.getElementById('spotlight-gold-reason'));
/** @returns {HTMLButtonElement} The Pin / Update button. */
const pinButton = () => /** @type {HTMLButtonElement} */ (document.getElementById('spotlight-gold-pin'));
/** @returns {HTMLButtonElement} The Remove button. */
const unpinButton = () => /** @type {HTMLButtonElement} */ (document.getElementById('spotlight-gold-unpin'));
/** @returns {string} The status line. */
const status = () => document.getElementById('spotlight-gold-status').textContent;

/**
 * Picks a reason and presses Pin, then waits for the reply.
 * @param {string} reason - The reason id to pick.
 */
async function pin(reason) {
  select().value = reason;
  pinButton().click();
  await flush();
}

describe('the panel', () => {
  test('offers the label type\'s Disagree reasons, in order, for a label that isn\'t an example', () => {
    mount();
    expect([...select().options].map((o) => [o.value, o.textContent])).toEqual(
      ['wrong-type', 'driveway', 'driveway-transition'].map((id) => [id, reasonText(id)]),
    );
    expect(pinButton().textContent).toBe('Use as training example');
    expect(unpinButton().hidden).toBe(true);
    expect(status()).toBe('');
  });

  test('a label that is an example shows its reason and offers to update or remove it', () => {
    mount({ goldReason: 'driveway' });
    expect(select().value).toBe('driveway');
    expect(pinButton().textContent).toBe('Update reason');
    expect(unpinButton().hidden).toBe(false);
  });

  test('a pinned reason the label\'s type no longer offers is left unselected and flagged', () => {
    mount({ labelType: 'Obstacle', goldReason: 'driveway' });
    expect(select().value).toBe('wrong-type');
    expect(status()).toBe('The pinned reason no longer fits this label type; pick another.');
    expect(pinButton().textContent).toBe('Update reason');
    expect(unpinButton().hidden).toBe(false);
  });

  test('a type with no canned reasons can\'t be pinned, and says why', () => {
    mount({ labelType: 'Other' });
    expect(select().options).toHaveLength(0);
    expect(select().disabled).toBe(true);
    expect(pinButton().disabled).toBe(true);
    expect(status()).toBe('This label type has no reasons to teach with.');
  });
});

describe('pinning', () => {
  test('sends the label and the picked reason, then shows the label as an example', async () => {
    const stub = routeFetch({ [`POST ${PIN_URL}`]: { success: true, reason: 'driveway-transition' } });
    mount();
    await pin('driveway-transition');

    expect(sentRequests(stub)).toEqual([
      { method: 'POST', url: PIN_URL, body: { label_id: 42, reason: 'driveway-transition' } },
    ]);
    expect(status()).toBe('Saved. Validators will see this label.');
    expect(pinButton().textContent).toBe('Update reason');
    expect(unpinButton().hidden).toBe(false);
  });

  test.each([
    ['no_such_label', 'No label with this id.'],
    ['label_unusable', 'A deleted or tutorial label can\'t be shown in Validate, so it can\'t teach.'],
    ['reason_not_offered', 'This label type doesn\'t offer that reason for a No.'],
    ['bad_request', 'Could not save.'],
  ])('a refusal coded %s tells the admin "%s" and leaves the pin as it was', async (code, message) => {
    routeFetch({ [`POST ${PIN_URL}`]: { status: 400, body: { success: false, error: code } } });
    mount();
    await pin('driveway');
    expect(status()).toBe(message);
    expect(pinButton().textContent).toBe('Use as training example');
    expect(unpinButton().hidden).toBe(true);
  });

  test('a refusal with no readable body falls back to a plain failure', async () => {
    routeFetch({ [`POST ${PIN_URL}`]: { status: 502 } });
    mount();
    await pin('driveway');
    expect(status()).toBe('Could not save.');
  });

  test('a request that never reaches the server says so and reports the error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    routeFetch({ [`POST ${PIN_URL}`]: new TypeError('offline') });
    mount();
    await pin('driveway');
    expect(status()).toBe('Could not save.');
    expect(error).toHaveBeenCalledWith('Gold example pin failed.', expect.any(TypeError));
    expect(unpinButton().hidden).toBe(true);
  });
});

describe('removing', () => {
  test('stops using the label as an example and offers to pin it again', async () => {
    const stub = routeFetch({ [`DELETE ${PIN_URL}/42`]: { success: true } });
    mount({ goldReason: 'driveway' });
    unpinButton().click();
    await flush();

    expect(sentRequests(stub).map(({ method, url }) => `${method} ${url}`)).toEqual([`DELETE ${PIN_URL}/42`]);
    expect(status()).toBe('Removed.');
    expect(pinButton().textContent).toBe('Use as training example');
    expect(unpinButton().hidden).toBe(true);
  });

  test('a removal that fails says so, reports the error, and keeps the pin', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    routeFetch({ [`DELETE ${PIN_URL}/42`]: { status: 404, body: { success: false, error: 'not_found' } } });
    mount({ goldReason: 'driveway' });
    unpinButton().click();
    await flush();

    expect(status()).toBe('Could not remove.');
    expect(error).toHaveBeenCalledWith('Gold example unpin failed.', expect.any(Error));
    expect(pinButton().textContent).toBe('Update reason');
    expect(unpinButton().hidden).toBe(false);
  });
});
