/**
 * Tests for AccessScoreClusterSheet (frontend/js/access-score/AccessScoreClusterSheet.js): the arrows that step
 * to the next cluster through a host-supplied navigator (#5748), as the label card's do. They appear with the
 * navigator, read its reach for their disabled states and follow its refreshes, hand the landing cluster to the
 * host, and answer the arrow keys; the sheet reports the cluster it shows, when its cards are in, and when it
 * closes.
 */

import {stubI18next} from './support/accessScoreDockHarness.js';
import {loadModules} from './loader.js';

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe('AccessScoreClusterSheet', () => {
  let AccessScoreClusterSheet;
  let sheet;
  let callbacks;
  let nav;

  beforeAll(async () => {
    stubI18next();
    // jsdom implements neither; the sheet reads `open` and the host listens for 'close'.
    window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    window.HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
    ({AccessScoreClusterSheet} = await loadModules('frontend/js/common/LabelMiniCard.js',
      'frontend/js/access-score/AccessScoreClusterSheet.js'));
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    window.fetch = vi.fn((input) => {
      const id = Number(String(input).split('/').pop());
      return Promise.resolve({ok: true, status: 200, json: () => Promise.resolve({
        label_id: id, label_type: 'CurbRamp', severity: 1, tags: [], crop_url: null, backup_image_url: null,
        num_agree: 0, num_disagree: 0, num_unsure: 0, user_validation: null, from_current_user: false,
      })});
    });
    callbacks = {onOpenLabel: vi.fn(), log: vi.fn(), onClose: vi.fn(), onLoaded: vi.fn(), onNavigate: vi.fn()};
    sheet = new AccessScoreClusterSheet(callbacks);
    const reach = {1: {next: 2, prev: null}, 2: {next: null, prev: 1}};
    nav = {
      next: vi.fn((id) => reach[id]?.next ?? null), prev: vi.fn((id) => reach[id]?.prev ?? null),
      hasNext: vi.fn((id) => reach[id]?.next !== null), hasPrev: vi.fn((id) => reach[id]?.prev !== null),
      onRefresh: vi.fn(),
    };
  });

  const props = (id) => ({label_cluster_id: id, label_type: 'CurbRamp', street_edge_id: 5, label_ids: [id * 10],
    median_severity: 1, cluster_size: 1});
  const prev = () => sheet.dialog.querySelector('.acs-sheet__paging--prev');
  const next = () => sheet.dialog.querySelector('.acs-sheet__paging--next');

  test('the arrows appear with a navigator, read its reach, and hand the landing cluster to the host', async () => {
    expect(prev().hidden).toBe(true);
    expect(next().hidden).toBe(true);
    sheet.setNavigator(nav);
    expect(prev().hidden).toBe(false);
    expect(nav.onRefresh).toHaveBeenCalledTimes(1);
    await sheet.open(props(1));
    expect(sheet.clusterId).toBe(1);
    expect(sheet.dialog.open).toBe(true);
    expect(callbacks.onLoaded).toHaveBeenCalledWith(1);
    expect(prev().disabled).toBe(true);
    expect(next().disabled).toBe(false);
    next().click();
    expect(nav.next).toHaveBeenCalledWith(1);
    expect(callbacks.onNavigate).toHaveBeenCalledWith(2);
    expect(callbacks.log).toHaveBeenCalledWith('SheetPage', 'next');
    // The host opens the landing cluster; the arrows re-read their reach from it.
    await sheet.open(props(2));
    expect(prev().disabled).toBe(false);
    expect(next().disabled).toBe(true);
    // At the end of the line, the key does nothing; back along the trail, it does.
    sheet.dialog.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(callbacks.onNavigate).toHaveBeenCalledTimes(1);
    sheet.dialog.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowLeft', bubbles: true}));
    expect(callbacks.onNavigate).toHaveBeenLastCalledWith(1);
    expect(callbacks.log).toHaveBeenCalledWith('SheetPage', 'prev');
    // A refetch that changes what is reachable re-reads the arrows.
    const refresh = nav.onRefresh.mock.calls[0][0];
    nav.hasNext.mockReturnValue(true);
    refresh();
    expect(next().disabled).toBe(false);
    // Closing reports the cluster that was on show.
    sheet.close();
    expect(callbacks.onClose).toHaveBeenCalledWith(2);
    // The same navigator again subscribes once.
    sheet.setNavigator(nav);
    expect(nav.onRefresh).toHaveBeenCalledTimes(1);
  });

  test('without a navigator the arrows stay hidden and the keys do nothing', async () => {
    await sheet.open(props(1));
    await settle();
    expect(prev().hidden).toBe(true);
    sheet.dialog.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(callbacks.onNavigate).not.toHaveBeenCalled();
  });
});
