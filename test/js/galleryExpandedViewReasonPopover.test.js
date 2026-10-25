/**
 * The Gallery's expanded view and the shared reason pop-up (#5475). The view hides with `visibility`, not by closing
 * a <dialog>, so the pop-up can't see its host go: one holding an "Other…" draft even outlasts the press on ✕. The
 * view therefore closes it itself, both when it closes and when it opens over a grid card whose pop-up is up.
 */
import { loadModules, mockModule } from './loader.js';

const closeReasonPopover = vi.fn();
mockModule('i18next', () => ({ default: { t: (key) => key } }));
mockModule('frontend/js/common/ReasonPopover.js', () => ({ closeReasonPopover }));
mockModule('frontend/js/common/label-detail/PopupPanoManager.js', () => ({
  PopupPanoManager: { DEEP_LINK_BUILD_WAIT_MS: 0 },
}));
mockModule('frontend/js/common/label-detail/LabelDetail.js', () => ({
  LabelDetail: {
    create: async () => ({ panoManager: {}, showLabel: vi.fn() }),
    urlLabelId: () => null,
    syncUrlLabelId: vi.fn(),
  },
}));

/** A grid card stand-in with just what the view reads to open on it. */
function stubCard(labelId) {
  return {
    getLabelId: () => labelId,
    getCropUrl: () => '',
    getCropMarker: () => null,
    getBackupImageData: () => null,
    getProperties: () => ({ label_id: labelId, label_type: 'CurbRamp', val_counts: {}, tags: [], comments: [] }),
  };
}

let view;

beforeEach(async () => {
  closeReasonPopover.mockClear();
  document.body.innerHTML = `
    <div class="gallery-expanded-view"></div>
    <div id="gallery_card_7"></div>`;
  document.getElementById('gallery_card_7').scrollIntoView = () => {};
  const card = stubCard(7);
  const cardContainer = {
    getCardByIndex: () => card,
    getCurrentPage: () => 1,
    getCardsPerPage: () => 10,
    getCurrentCards: () => ({ getSize: () => 1 }),
    getCurrentPageCards: () => [card],
    isLastPage: () => false,
    isListMode: () => false,
  };
  const { ExpandedView } = await loadModules('frontend/js/gallery/expandedview/ExpandedView.js');
  view = await ExpandedView.create(document.querySelector('.gallery-expanded-view'), {}, cardContainer, {});
});

describe('the expanded view and the reason pop-up (#5475)', () => {
  test('opening on a card closes a pop-up left up on the grid', () => {
    view.updateCardIndex(0);
    expect(view.open).toBe(true);
    expect(closeReasonPopover).toHaveBeenCalled();
  });

  test('closing closes the pop-up it may be holding', () => {
    view.updateCardIndex(0);
    closeReasonPopover.mockClear();
    view.closeExpandedView();
    expect(view.open).toBe(false);
    expect(closeReasonPopover).toHaveBeenCalledTimes(1);
  });
});
