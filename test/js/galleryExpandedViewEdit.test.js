/**
 * Gallery's expanded view passing an edit made on the label card back to the grid card (#3671, #5853), and the
 * same for a vote, a comment, and a delete or restore (#5840).
 *
 * A type change reaches the view only after the card has re-read the new type's votes, by which time the user may
 * have paged on, so each change has to land on its own label's grid card rather than whichever one is open.
 */
import { loadModules, mockModule } from './loader.js';

let cardOpts;
mockModule('i18next', () => ({ default: { t: (key) => key } }));
mockModule('frontend/js/common/ReasonPopover.js', () => ({ closeReasonPopover: vi.fn() }));
mockModule('frontend/js/common/label-detail/PopupPanoManager.js', () => ({
  PopupPanoManager: { DEEP_LINK_BUILD_WAIT_MS: 0 },
}));
mockModule('frontend/js/common/label-detail/LabelDetail.js', () => ({
  LabelDetail: {
    create: async (_root, opts) => {
      cardOpts = opts;
      return { panoManager: {}, showLabel: vi.fn(), saveOpenEdits: vi.fn() };
    },
    urlLabelId: () => null,
    syncUrlLabelId: vi.fn(),
  },
}));

/**
 * A grid card stand-in with what the view reads to open on it and the edit sync it calls.
 * @param {number} labelId
 * @returns {Object}
 */
function stubCard(labelId) {
  let labelType = 'Obstacle';
  return {
    getLabelId: () => labelId,
    getLabelType: () => labelType,
    getCropUrl: () => '',
    getCropMarker: () => null,
    getBackupImageData: () => null,
    getProperties: () => ({ label_id: labelId, label_type: labelType, val_counts: {}, tags: [], comments: [] }),
    updateLabelType: vi.fn((t) => { labelType = t; }),
    updateSeverityAndTags: vi.fn(),
    setVotes: vi.fn(),
    setAiGenerated: vi.fn(),
    updateUserValidation: vi.fn(),
    updateComments: vi.fn(),
    setDeleted: vi.fn(),
  };
}

const cards = { 7: stubCard(7), 8: stubCard(8) };
let view;

beforeEach(async () => {
  for (const id of [7, 8]) cards[id] = stubCard(id);
  document.body.innerHTML = `
    <div class="gallery-expanded-view"></div>
    <div id="gallery_card_7"></div><div id="gallery_card_8"></div>`;
  for (const id of [7, 8]) document.getElementById(`gallery_card_${id}`).scrollIntoView = () => {};
  const cardContainer = {
    getCardByIndex: (i) => [cards[7], cards[8]][i],
    findCardByLabelId: (id) => cards[id],
    getCurrentPage: () => 1,
    getCardsPerPage: () => 10,
    getCurrentCards: () => ({ getSize: () => 2 }),
    getCurrentPageCards: () => [cards[7], cards[8]],
    isLastPage: () => false,
    isListMode: () => false,
  };
  const { ExpandedView } = await loadModules('frontend/js/gallery/expandedview/ExpandedView.js');
  view = await ExpandedView.create(document.querySelector('.gallery-expanded-view'), {}, cardContainer, {});
});

const edited = (labelType) => ({
  label_id: 7, label_type: labelType, severity: 2, tags: [], num_agree: 1, num_disagree: 0, num_unsure: 0,
  user_validation: null, ai_validation: null, ai_generated: false,
});

describe('an edit from the expanded view (#5853)', () => {
  test('lands on the edited label\'s grid card even after paging on', () => {
    view.updateCardIndex(0);
    view.updateCardIndex(1);
    cardOpts.onEdit(edited('SurfaceProblem'));
    expect(cards[7].updateLabelType).toHaveBeenCalledWith('SurfaceProblem');
    expect(cards[7].setVotes).toHaveBeenCalled();
    expect(cards[7].setAiGenerated).toHaveBeenCalledWith(false); // A new type can take the AI badge away (#5925).
    expect(cards[8].updateLabelType).not.toHaveBeenCalled();
  });

  test('replaces the grid card\'s votes only when the type changed', () => {
    view.updateCardIndex(0);
    cardOpts.onEdit(edited('Obstacle'));
    expect(cards[7].updateSeverityAndTags).toHaveBeenCalled();
    expect(cards[7].setVotes).not.toHaveBeenCalled();
  });
});

describe('other changes from the expanded view (#5840)', () => {
  test('a vote lands on its own label\'s grid card after paging on, and one for a card not loaded is dropped', () => {
    view.updateCardIndex(0);
    view.updateCardIndex(1);

    cardOpts.onVote('Disagree', { label_id: 7 });
    cardOpts.onVote('Agree', { label_id: 99 });

    expect(cards[7].updateUserValidation).toHaveBeenCalledWith('Disagree');
    expect(cards[8].updateUserValidation).not.toHaveBeenCalled();
  });

  test('a comment list lands on its label\'s grid card, so reopening the label shows it', () => {
    const comments = [{ comment: 'curb is cracked', mine: true }];

    cardOpts.onComments({ label_id: 8, comments });
    cardOpts.onComments({ label_id: 99, comments });

    expect(cards[8].updateComments).toHaveBeenCalledWith(comments);
  });

  test('a delete marks the grid card and files the admin\'s Disagree, keeping their comment', () => {
    cardOpts.onDelete({ label_id: 7, deleted: true, can_restore: true, user_validation: 'Disagree' });

    expect(cards[7].setDeleted).toHaveBeenCalledWith(true, true);
    expect(cards[7].updateUserValidation).toHaveBeenCalledWith('Disagree', { dropOwnComment: false });
  });

  test('a restore clears the delete and its vote, and a change for a card not loaded is dropped', () => {
    cardOpts.onDelete({ label_id: 8, deleted: false });
    cardOpts.onDelete({ label_id: 99, deleted: true, can_restore: false, user_validation: null });
    cardOpts.onEdit({ ...edited('Obstacle'), label_id: 99 });

    expect(cards[8].setDeleted).toHaveBeenCalledWith(false, false);
    expect(cards[8].updateUserValidation).toHaveBeenCalledWith(null, { dropOwnComment: false });
    expect(cards[7].setDeleted).not.toHaveBeenCalled();
    expect(cards[7].updateLabelType).not.toHaveBeenCalled();
  });
});
