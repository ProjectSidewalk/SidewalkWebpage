/**
 * Tests for the Gallery card's cached copy of the viewer's own comment (frontend/js/gallery/cards/Card.js, #5475).
 *
 * The card carries the label's comments from the page payload, and both the reason pop-up and the expanded view
 * read the viewer's own one from it: it says which chip is on record. The server deletes that comment when the vote
 * is cleared, or changed away from a canned reason it doesn't offer; typed words survive a change. The cache follows
 * at the same moment, so the pop-up marks only a reason the server still holds.
 */

import { loadModules, mockModule } from './loader.js';

mockModule('i18next', () => ({ default: { t: (key) => key, language: 'en' } }));
mockModule('frontend/js/gallery/displays/SeverityDisplay.js', () => ({ SeverityDisplay: class {} }));
mockModule('frontend/js/gallery/displays/ValidationInfoDisplay.js', () => ({
  ValidationInfoDisplay: class { updateValCounts() {} },
}));
mockModule('frontend/js/gallery/validation/ValidationMenu.js', () => ({
  ValidationMenu: class { showValidationOnCard() {} },
}));
mockModule('frontend/js/gallery/displays/TagDisplay.js', () => ({ TagDisplay: class {} }));
mockModule('frontend/js/common/pano-viewer/PanoViewerLogo.js', () => ({
  createPanoViewerLogo: () => ({ showSourceLogo() {}, hide() {} }),
}));
mockModule('frontend/js/common/pano-viewer/PanoAttribution.js', () => ({
  createPanoAttribution: () => ({ show() {}, hide() {}, setCredit() {} }),
}));

const own = { comment: 'This is a driveway', reason: 'driveway', mine: true, commenter: 0, validation: 'Disagree' };
const theirs = { comment: 'Looks fine to me', mine: false, commenter: 1, validation: 'Agree' };

let Card;

beforeAll(async () => {
  ({ Card } = await loadModules('frontend/js/gallery/cards/Card.js'));
});

/**
 * @param {?string} userValidation - The viewer's vote on the label when the page loaded.
 * @returns {Card} A card carrying one comment of the viewer's and one of someone else's.
 */
function makeCard(userValidation) {
  const label = {
    label_id: 1, label_type: 'CurbRamp', region_id: 7, severity: 2, canvas_x: 180, canvas_y: 360,
    agree_count: 1, disagree_count: 1, unsure_count: 0, tags: [], ai_generated: false,
    user_validation: userValidation, comments: [theirs, own],
  };
  return new Card({ label, cropUrl: null, gsvImageUrl: 'https://maps.example/still.jpg', cropMarker: null }, {},
    { push: () => {} }, { getAppliedTagNames: () => [] });
}

describe('the own-comment cache on a Gallery card (#5475)', () => {
  test('a changed vote drops a canned reason it doesn\'t offer, as the server does, and keeps everyone else\'s', () => {
    const card = makeCard('Disagree');
    const shared = card.getProperty('comments');
    card.updateUserValidation('Unsure');
    expect(card.getProperty('comments')).toEqual([theirs]);
    // In place: the expanded view holds this same array and pushes comments made there into it, so a new
    // array here would leave those comments behind when the label is reopened.
    expect(card.getProperty('comments')).toBe(shared);
  });

  test('a changed vote keeps typed words and moves their vote chip, as the server does', () => {
    const card = makeCard('Unsure');
    const typed = { comment: 'Hard to tell in the shade', mine: true, commenter: 0, validation: 'Unsure' };
    card.getProperty('comments').splice(1, 1, typed);
    card.updateUserValidation('Disagree');
    expect(card.getProperty('comments')).toEqual([theirs, { ...typed, validation: 'Disagree' }]);
  });

  test('an admin\'s delete files a vote but leaves the comment, so its relay keeps the cache', () => {
    const card = makeCard('Agree');
    card.updateUserValidation('Disagree', { dropOwnComment: false });
    expect(card.getProperty('comments')).toEqual([theirs, own]);
  });

  test('a cleared vote drops it too, typed words included', () => {
    const card = makeCard('Disagree');
    card.getProperty('comments').push({ comment: 'Hard to tell', mine: true, commenter: 0, validation: 'Disagree' });
    card.updateUserValidation(null);
    expect(card.getProperty('comments')).toEqual([theirs]);
  });

  test('a first vote leaves a comment that predates it alone, since the server inserts rather than replaces', () => {
    const card = makeCard(null);
    card.updateUserValidation('Disagree');
    expect(card.getProperty('comments')).toEqual([theirs, own]);
  });

  test('a first vote gives a comment that outlived its old vote the new vote\'s chip, as the server feed does', () => {
    const card = makeCard(null);
    const orphan = { comment: 'Hard to tell', mine: true, commenter: 0, validation: null };
    card.getProperty('comments').splice(1, 1, orphan);
    card.updateUserValidation('Unsure');
    expect(card.getProperty('comments')).toEqual([theirs, { ...orphan, validation: 'Unsure' }]);
  });
});
