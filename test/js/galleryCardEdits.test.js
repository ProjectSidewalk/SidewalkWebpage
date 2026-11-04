/**
 * Tests for how a Gallery card keeps up with its label once drawn (frontend/js/gallery/cards/Card.js, #5840).
 *
 * The expanded view edits a label in place (type #3671, severity and tags #2575, delete #3591) and the small card
 * behind it has to show the result without a reload; the container also re-renders and re-fits the same card objects
 * on every page turn. What is pinned here is what the reader sees: the type's name, icon and rating block, the tag
 * list, the faded deleted card, and the vote state the card reports to the filter.
 */

import { loadModules, mockModule } from './loader.js';
import { fakeTracker, fakePanoOverlays } from './fakes.js';

mockModule('i18next', () => ({ default: { t: (key, opts) => (opts ? `${key}:${JSON.stringify(opts)}` : key) } }));

/** Every SeverityDisplay and TagDisplay drawn, in order, so a test can read what the reader was last shown. */
const drawn = { severity: [], tags: [] };

mockModule('frontend/js/gallery/displays/SeverityDisplay.js', () => ({
  SeverityDisplay: class {
    constructor(container, severity, labelType) { drawn.severity.push({ container, severity, labelType }); }
  },
}));
mockModule('frontend/js/gallery/displays/TagDisplay.js', () => ({
  TagDisplay: class {
    constructor(container, tags, appliedTags) { drawn.tags.push({ container, tags, appliedTags }); }
  },
}));
mockModule('frontend/js/gallery/displays/ValidationInfoDisplay.js', () => ({
  ValidationInfoDisplay: class { updateValCounts() {} setAiValidation() {} },
}));
mockModule('frontend/js/gallery/validation/ValidationMenu.js', () => ({
  ValidationMenu: class { showValidationOnCard() {} },
}));
fakePanoOverlays();

/**
 * One label payload, shaped like an entry from POST /label/labels (LabelFormats.validationLabelMetadataToJson).
 * @param {object} [overrides] - Fields to change.
 * @returns {object} The label.
 */
function label(overrides = {}) {
  return {
    label_id: 1, label_type: 'CurbRamp', pano_id: 'pano-1', region_id: 7, severity: 2, canvas_x: 180, canvas_y: 360,
    canvas_width: 720, canvas_height: 480, correct: null, agree_count: 0, disagree_count: 0, unsure_count: 0,
    user_validation: null, ai_validation: null, tags: ['narrow'], ai_generated: false, comments: [],
    ...overrides,
  };
}

describe('a Gallery card after it is drawn', () => {
  let Card;
  const cardFilter = { getAppliedTagNames: () => ['narrow'] };

  /**
   * Builds a card from a label payload, with no imagery so nothing is requested.
   * @param {object} [overrides] - Fields to change on the label.
   * @returns {Card} The card, not yet rendered.
   */
  const makeCard = (overrides) => new Card(
    { label: label(overrides), cropUrl: null, gsvImageUrl: null }, {}, fakeTracker(), cardFilter,
  );

  /**
   * Builds a card and renders it into a fresh grid.
   * @param {object} [overrides] - Fields to change on the label.
   * @returns {{card: Card, el: HTMLElement}} The card and its element in the document.
   */
  function renderCard(overrides) {
    document.body.innerHTML = '<div id="cards"></div>';
    const card = makeCard(overrides);
    card.render(document.getElementById('cards'));
    return { card, el: document.getElementById(`gallery_card_${card.getLabelId()}`) };
  }

  beforeAll(async () => {
    window.structuredClone ??= (v) => JSON.parse(JSON.stringify(v)); // Missing from this jsdom.
    ({ Card } = await loadModules('frontend/js/gallery/cards/Card.js'));
  });

  beforeEach(() => {
    drawn.severity = [];
    drawn.tags = [];
  });

  describe('when it is first drawn', () => {
    it('shows a rating block for a rated type and none for an unrated one', () => {
      expect(renderCard().el.querySelector('.card-severity')).not.toBeNull();
      expect(drawn.severity.at(-1)).toMatchObject({ severity: 2, labelType: 'CurbRamp' });

      expect(renderCard({ label_type: 'Signal', severity: null }).el.querySelector('.card-severity')).toBeNull();
    });

    it('marks an AI-made label on its image, and only an AI-made one', () => {
      expect(renderCard({ ai_generated: true }).el.querySelector('.gallery-marker-wrapper .ai-icon-marker-card'))
        .not.toBeNull();
      expect(renderCard().el.querySelector('.ai-icon-marker-card')).toBeNull();
    });

    it('draws its tags with the sidebar\'s applied ones, so those are shown first', () => {
      const { el } = renderCard();

      expect(drawn.tags.at(-1)).toEqual({
        container: el.querySelector('.card-tags'), tags: ['narrow'], appliedTags: ['narrow'],
      });
    });

    it('falls back to the boxed Explore frame for a label that predates the recorded canvas size', () => {
      const card = makeCard({ canvas_width: undefined, canvas_height: undefined });

      expect(card.getProperty('original_canvas_width')).toBe(720);
      expect(card.getProperty('original_canvas_height')).toBe(480);
    });

    // The validation filter matches on this, so a card answering the wrong one shows up under the wrong checkbox.
    it('files itself under the validation state its votes add up to', () => {
      expect(makeCard({ correct: true, agree_count: 2 }).getProperty('correctness')).toBe('correct');
      expect(makeCard({ correct: false, disagree_count: 2 }).getProperty('correctness')).toBe('incorrect');
      expect(makeCard({ unsure_count: 1 }).getProperty('correctness')).toBe('unsure');
      expect(makeCard().getProperty('correctness')).toBe('unvalidated');
    });
  });

  describe('when the container renders it again', () => {
    it('drops the dimming the expanded view left on it', () => {
      const { card, el } = renderCard();
      el.classList.add('expanded-view-background-card'); // What ExpandedView puts on the cards behind it.

      card.render(document.getElementById('cards'));

      expect(el.classList.contains('expanded-view-background-card')).toBe(false);
    });

    it('re-fits its tags while on the page, and leaves them alone once it is off it', () => {
      const { card, el } = renderCard();
      const before = drawn.tags.length;

      card.refitTags();
      expect(drawn.tags).toHaveLength(before + 1);

      el.remove();
      card.refitTags();
      expect(drawn.tags).toHaveLength(before + 1);
    });

    it('does not ask again for an image it already has', async () => {
      document.body.innerHTML = '<div id="cards"></div>';
      const card = new Card(
        { label: label(), cropUrl: '/cropImage/CurbRamp/1', gsvImageUrl: null }, {}, fakeTracker(), cardFilter,
      );
      card.render(document.getElementById('cards'));
      const image = document.querySelector('.static-gallery-image');
      const loaded = card.loadImage();
      image.onload();
      await expect(loaded).resolves.toBe(true);
      image.onload = null;
      image.removeAttribute('src');

      await expect(card.loadImage()).resolves.toBe(true);
      expect(image.getAttribute('src')).toBeNull();
    });
  });

  describe('when the expanded view changes its type (#3671)', () => {
    it('renames it, swaps its icon and retitles its image', () => {
      const { card, el } = renderCard();

      card.updateLabelType('Obstacle');

      expect(card.getLabelType()).toBe('Obstacle');
      expect(el.querySelector('.card-header__type').textContent).toBe('common:obstacle');
      expect(el.querySelector('.label-icon').getAttribute('src')).toContain('Obstacle');
      expect(el.querySelector('.static-gallery-image').alt)
        .toBe('gallery:card-image-alt:{"labelType":"common:obstacle"}');
    });

    it('takes the rating block away for an unrated type and brings it back for a rated one', () => {
      const { card, el } = renderCard();

      card.updateLabelType('NoSidewalk');
      expect(el.querySelector('.card-severity')).toBeNull();

      card.updateLabelType('Obstacle');
      // First in the data row, where a card drawn as a rated type has it.
      expect(el.querySelector('.card-data').firstElementChild.className).toBe('card-severity');
    });

    it('keeps the block it has when moving between two rated types', () => {
      const { card, el } = renderCard();
      const block = el.querySelector('.card-severity');

      card.updateLabelType('Obstacle');

      expect(el.querySelectorAll('.card-severity')).toHaveLength(1);
      expect(el.querySelector('.card-severity')).toBe(block);
    });

    it('leaves the card untouched when the type did not change', () => {
      const { card, el } = renderCard();
      el.querySelector('.card-header__type').textContent = 'as drawn';

      card.updateLabelType('CurbRamp');

      expect(el.querySelector('.card-header__type').textContent).toBe('as drawn');
    });
  });

  describe('when the expanded view edits its severity and tags (#2575)', () => {
    it('redraws both, replacing the old tags rather than adding to them', () => {
      const { card, el } = renderCard();
      el.querySelector('.card-tags').append(document.createElement('span'));

      card.updateSeverityAndTags(3, ['steep']);

      expect(card.getProperty('severity')).toBe(3);
      expect(card.getProperty('tags')).toEqual(['steep']);
      expect(drawn.severity.at(-1)).toMatchObject({ severity: 3, labelType: 'CurbRamp' });
      expect(drawn.tags.at(-1).tags).toEqual(['steep']);
      // Only the header TagDisplay fills is left, so a now-empty tag list shows no stale pills.
      expect(el.querySelector('.card-tags').innerHTML).toBe('<div class="label-tags-header"></div>');
    });

    it('redraws only the tags on an unrated type, which has no rating to show', () => {
      const { card } = renderCard({ label_type: 'Signal', severity: null });
      const before = drawn.severity.length;

      card.updateSeverityAndTags(null, []);

      expect(drawn.severity).toHaveLength(before);
      expect(drawn.tags.at(-1).tags).toEqual([]);
    });
  });

  describe('when the expanded view deletes or restores it (#3591)', () => {
    it('fades it, and remembers whether the viewer may undo that', () => {
      const { card, el } = renderCard();

      card.setDeleted(true, true);
      expect(el.classList.contains('gallery-card--deleted')).toBe(true);
      expect(card.getProperties()).toMatchObject({ deleted: true, can_restore: true });

      card.setDeleted(false, false);
      expect(el.classList.contains('gallery-card--deleted')).toBe(false);
      expect(card.getProperties()).toMatchObject({ deleted: false, can_restore: false });
    });
  });

  describe('its votes', () => {
    it('takes the comments the expanded view opens with', () => {
      const card = makeCard();
      const comments = [{ comment: 'Looks fine', mine: false }];

      card.updateComments(comments);

      expect(card.getProperty('comments')).toBe(comments);
    });

    it('reads a re-read with no vote fields as no votes, not as missing ones', () => {
      const card = makeCard({ user_validation: 'Agree', ai_validation: 'Agree' });

      card.setVotes({ num_agree: 0, num_disagree: 0, num_unsure: 0 });

      expect(card.getProperty('user_validation')).toBeNull();
      expect(card.getProperty('ai_validation')).toBeNull();
    });

    it('records its votes under its page\'s own source on a report, and Gallery\'s own otherwise', () => {
      const onReport = new Card(
        { label: label(), cropUrl: null, gsvImageUrl: null }, {}, fakeTracker(), cardFilter, { voteSource: 'Report' },
      );

      expect(onReport.getVoteSource()).toBe('Report');
      expect(makeCard().getVoteSource()).toBeNull();
    });

    it('counts a repeat of the viewer\'s own vote once', () => {
      const card = makeCard({ user_validation: 'Agree', agree_count: 1 });

      card.updateUserValidation('Agree');

      expect(card.getProperty('val_counts')).toEqual({ Agree: 1, Disagree: 0, Unsure: 0 });
    });

    it('moves a changed vote from one count to the other', () => {
      const card = makeCard({ user_validation: 'Agree', agree_count: 1 });

      card.updateUserValidation('Disagree');

      expect(card.getProperty('val_counts')).toEqual({ Agree: 0, Disagree: 1, Unsure: 0 });
      expect(card.getProperty('user_validation')).toBe('Disagree');
    });
  });
});
