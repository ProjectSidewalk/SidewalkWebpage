/**
 * Tests for the admin Training Examples list (frontend/js/admin-dashboard/GoldExamplesPage.js, #1445): what each row
 * shows, how the columns sort, and what Remove sends. Admins use it to spot a pin that can't be served and to see which
 * examples validators keep missing (#5840).
 */

import { loadModules, mockModule } from './loader.js';
import { reasonText } from './support/goldExampleHarness.js';
import { flush, routeFetch, sentRequests, textOf } from './support/routeFetch.js';

// The dialog itself is tested on its own; here it just answers whatever the test sets.
const ConfirmDialog = { confirm: vi.fn() };
mockModule('frontend/js/common/ConfirmDialog.js', () => ({ ConfirmDialog }));

const LIST_URL = '/adminapi/goldExamples';

/** The list section of goldExamples.scala.html. */
const MARKUP = `
  <div class="gold-examples-status" id="gold-examples-status" role="status" aria-live="polite">Loading examples…</div>
  <div id="gold-examples-list"></div>`;

/**
 * @param {number} hours - How long ago.
 * @returns {string} That moment as the ISO timestamp the server sends.
 */
const hoursAgo = (hours) => new Date(Date.now() - hours * 3600e3).toISOString();

/**
 * One row of /adminapi/goldExamples, as GoldExampleController.summaryJson writes it.
 * @param {number} labelId - The pinned label.
 * @param {object} [overrides] - Fields to replace.
 * @returns {object} The row.
 */
const example = (labelId, overrides = {}) => ({
  label_id: labelId,
  label_type: 'CurbRamp',
  reason: 'driveway',
  pinned_by: 'ada',
  pinned_at: hoursAgo(labelId),
  problem: null,
  answered: 10,
  missed: 2,
  crop_url: `/crops/${labelId}.jpg`,
  ...overrides,
});

let GoldExamplesPage;

beforeEach(async () => {
  ({ GoldExamplesPage } = await loadModules('frontend/js/admin-dashboard/GoldExamplesPage.js'));
});

/**
 * Builds the page, answers the list request, and waits for it to draw.
 * @param {any} list - What the list endpoint answers; see routeFetch.
 * @param {Record<string, any>} [routes] - Answers for the remove endpoint.
 * @returns {Promise<import('vitest').Mock>} The fetch stub.
 */
async function load(list, routes = {}) {
  document.body.innerHTML = MARKUP;
  const stub = routeFetch({ [LIST_URL]: list, ...routes });
  new GoldExamplesPage().init();
  await flush();
  return stub;
}

/** @returns {string} The status line's text. */
const status = () => textOf(document.getElementById('gold-examples-status'));
/** @returns {HTMLTableRowElement[]} The table's body rows, in order. */
const rows = () => [...document.querySelectorAll('#gold-examples-list tbody tr')];
/** @returns {number[]} Each row's label id, in order. */
const order = () => rows().map((tr) => Number(tr.querySelector('[data-unpin]').dataset.unpin));
/**
 * @param {string} label - A column header's text.
 * @returns {HTMLTableCellElement} That header.
 */
const header = (label) => [...document.querySelectorAll('#gold-examples-list th')].find((th) => th.textContent === label);

describe('the list', () => {
  test('shows each example with its crop, label, reason, who pinned it, when, and how validators did', async () => {
    await load({ gold_examples: [example(12, { pinned_by: 'Bo <b>', pinned_at: hoursAgo(3), answered: 7, missed: 4 })] });

    expect(status()).toBe('1 pinned.');
    const cells = [...rows()[0].querySelectorAll('td')];
    expect(cells[0].querySelector('img').getAttribute('src')).toBe('/crops/12.jpg');
    const link = cells[1].querySelector('a');
    expect(link.getAttribute('href')).toBe('/admin/label/12');
    expect(link.textContent).toBe('Label 12');
    expect(textOf(cells[1].querySelector('.gold-examples-type'))).toBe('CurbRamp');
    expect(textOf(cells[2])).toBe(reasonText('driveway'));
    // A username is text, never markup.
    expect(textOf(cells[3])).toBe('Bo <b>');
    expect(textOf(cells[4])).toBe('3h ago');
    expect(textOf(cells[5])).toBe('7');
    expect(textOf(cells[6])).toBe('4');
    expect(cells[7].querySelector('button').textContent).toBe('Remove');
  });

  test('an example with no crop says so, and a reason the locale files lack shows its id', async () => {
    await load({ gold_examples: [example(12, { crop_url: null, reason: 'brand-new-reason' })] });
    const cells = rows()[0].querySelectorAll('td');
    expect(cells[0].querySelector('img')).toBeNull();
    expect(textOf(cells[0])).toBe('no crop');
    expect(textOf(cells[2])).toBe('brand-new-reason');
  });

  test('flags each example the server can\'t serve, and why', async () => {
    await load({ gold_examples: [
      example(1, { problem: 'label_deleted' }),
      example(2, { problem: 'reason_not_offered' }),
      example(3, { problem: 'imagery_gone' }),
      example(4),
    ] });
    const badges = rows().map((tr) => tr.querySelector('.ac-badge')?.textContent ?? null);
    expect(badges).toEqual(['label deleted', 'reason no longer fits', 'imagery gone', null]);
  });

  test('an empty list says there are no examples yet and draws no table', async () => {
    await load({ gold_examples: [] });
    expect(status()).toBe('No training examples yet.');
    expect(document.getElementById('gold-examples-list').innerHTML).toBe('');
  });

  test('a list that fails to load says so and reports the error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await load({ status: 500 });
    expect(status()).toBe('Could not load the training examples.');
    expect(error).toHaveBeenCalledWith('Gold examples page: load failed.', expect.any(Error));
  });
});

describe('sorting', () => {
  const EXAMPLES = [
    example(30, { label_type: 'Obstacle', reason: 'ample-space', pinned_by: 'cyd', answered: 5, missed: 0 }),
    example(10, { reason: 'wrong-type', pinned_by: 'Bo', answered: 20, missed: 9 }),
    example(20, { reason: 'driveway', pinned_by: 'ada', answered: 5, missed: 3 }),
  ];

  test('starts newest pin first, marking the Pinned column as the sorted one', async () => {
    await load({ gold_examples: EXAMPLES });
    expect(order()).toEqual([10, 20, 30]);
    const pinned = header('Pinned');
    expect(pinned.getAttribute('aria-sort')).toBe('descending');
    expect(pinned.dataset.dir).toBe('desc');
    expect(pinned.classList.contains('ac-sorted')).toBe(true);
  });

  test('Label groups by label type in the canonical order, then label id; a second click reverses it', async () => {
    await load({ gold_examples: EXAMPLES });
    header('Label').click();
    expect(order()).toEqual([10, 20, 30]);
    expect(header('Label').getAttribute('aria-sort')).toBe('ascending');
    // Only the sorted column carries the marker.
    expect(header('Pinned').hasAttribute('aria-sort')).toBe(false);

    header('Label').click();
    expect(order()).toEqual([30, 20, 10]);
    expect(header('Label').getAttribute('aria-sort')).toBe('descending');
  });

  test('Reason groups by label type, then reads the reasons A to Z', async () => {
    await load({ gold_examples: EXAMPLES });
    header('Reason').click();
    // "This is a driveway" before "This is the wrong label type"; Obstacle comes after every CurbRamp.
    expect(order()).toEqual([20, 10, 30]);
  });

  test('a reason the locale files lack sorts by its id among its type\'s reasons', async () => {
    await load({ gold_examples: [...EXAMPLES, example(40, { reason: 'u-turn' })] });
    header('Reason').click();
    // The raw id "u-turn" reads after the CurbRamp texts it sits among; Obstacle still comes last.
    expect(order()).toEqual([20, 10, 40, 30]);
  });

  test('Pinned by reads names A to Z whatever their case', async () => {
    await load({ gold_examples: EXAMPLES });
    header('Pinned by').click();
    expect(order()).toEqual([20, 10, 30]);
  });

  test('Answered and Missed start biggest first, and a tie falls back to the newest pin', async () => {
    await load({ gold_examples: EXAMPLES });
    header('Answered').click();
    expect(order()).toEqual([10, 20, 30]);
    header('Answered').click();
    // 20 and 30 tie on 5 answers either way round; the newer pin leads.
    expect(order()).toEqual([20, 30, 10]);

    header('Missed').click();
    expect(order()).toEqual([10, 20, 30]);
  });

  test('the numeric headers are not marked as text, and Crop and Remove do not sort', async () => {
    await load({ gold_examples: EXAMPLES });
    expect(header('Answered').hasAttribute('class')).toBe(false);
    expect(header('Label').className).toBe('ac-th-text');
    for (const label of ['Crop', '']) {
      const th = header(label);
      expect(th.hasAttribute('data-sort')).toBe(false);
      expect(th.hasAttribute('tabindex')).toBe(false);
    }
    header('Crop').click();
    rows()[0].querySelector('td').click();
    expect(order()).toEqual([10, 20, 30]);
  });

  test('a header sorts from the keyboard with Enter or Space, and ignores other keys', async () => {
    await load({ gold_examples: EXAMPLES });
    const press = (key) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      header('Pinned by').dispatchEvent(event);
      return event;
    };

    expect(press('Tab').defaultPrevented).toBe(false);
    expect(order()).toEqual([10, 20, 30]);

    expect(press('Enter').defaultPrevented).toBe(true);
    expect(order()).toEqual([20, 10, 30]);
    expect(press(' ').defaultPrevented).toBe(true);
    expect(order()).toEqual([30, 10, 20]);

    // A key on a cell outside the headers is left alone.
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    rows()[0].querySelector('td').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('removing an example', () => {
  test('asks first, naming the label, then removes it and redraws the list', async () => {
    ConfirmDialog.confirm.mockResolvedValue(true);
    let list = [example(1), example(2, { label_type: 'Obstacle', reason: 'ample-space' })];
    const stub = await load(() => ({ gold_examples: list }), {
      [`DELETE ${LIST_URL}/2`]: () => {
        list = list.filter((ex) => ex.label_id !== 2);
        return { success: true };
      },
    });

    rows()[1].querySelector('[data-unpin]').click();
    await flush();

    expect(ConfirmDialog.confirm).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Stop using label 2 (Obstacle) as a training example?'),
      confirmText: 'Remove',
      danger: true,
    }));
    expect(sentRequests(stub).map(({ method, url }) => `${method} ${url}`)).toEqual([
      `GET ${LIST_URL}`, `DELETE ${LIST_URL}/2`, `GET ${LIST_URL}`,
    ]);
    expect(order()).toEqual([1]);
    expect(status()).toBe('1 pinned.');
  });

  test('removing the last example leaves the empty-list message', async () => {
    ConfirmDialog.confirm.mockResolvedValue(true);
    let list = [example(1)];
    await load(() => ({ gold_examples: list }), {
      [`DELETE ${LIST_URL}/1`]: () => {
        list = [];
        return { success: true };
      },
    });
    rows()[0].querySelector('[data-unpin]').click();
    await flush();
    expect(rows()).toEqual([]);
    expect(status()).toBe('No training examples yet.');
  });

  test('cancelling the question sends nothing', async () => {
    ConfirmDialog.confirm.mockResolvedValue(false);
    const stub = await load({ gold_examples: [example(1)] });
    rows()[0].querySelector('[data-unpin]').click();
    await flush();
    expect(sentRequests(stub)).toHaveLength(1);
    expect(order()).toEqual([1]);
  });

  test('a removal the server refuses says so, reports the error, and keeps the row', async () => {
    ConfirmDialog.confirm.mockResolvedValue(true);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await load({ gold_examples: [example(1)] }, { [`DELETE ${LIST_URL}/1`]: { status: 404, body: {} } });
    rows()[0].querySelector('[data-unpin]').click();
    await flush();
    expect(status()).toBe('Could not remove the example.');
    expect(error).toHaveBeenCalledWith('Gold examples page: remove failed.', expect.any(Error));
    expect(order()).toEqual([1]);
  });
});
