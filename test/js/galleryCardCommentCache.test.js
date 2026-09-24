/**
 * Tests for the Gallery card's cached copy of the viewer's own comment (public/js/gallery/src/cards/Card.js, #5475).
 *
 * The card carries the label's comments from the page payload, and both the reason popover and the expanded view
 * read the viewer's own one from it: it says which chip is on record. The server deletes that comment whenever the
 * vote it rode in with is cleared or replaced, so the cache has to drop it at the same moment, or the popover would
 * mark a reason the server no longer holds and refuse to let it be picked again.
 */

const fs = require('fs');
const path = require('path');

const { assetPathStub, installUtilitiesMisc } = require('./loadGlobalScript');

const CARD_SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'public/js/gallery/src/cards/Card.js'), 'utf8');

const own = { comment: 'This is a driveway', reason: 'driveway', mine: true, commenter: 0, validation: 'Disagree' };
const theirs = { comment: 'Looks fine to me', mine: false, commenter: 1, validation: 'Agree' };

function makeCard(userValidation) {
    return new window.Card({
        label_id: 1, label_type: 'CurbRamp', region_id: 7, severity: 2, canvas_x: 180, canvas_y: 360,
        agree_count: 1, disagree_count: 1, unsure_count: 0, tags: [], ai_generated: false,
        user_validation: userValidation, comments: [theirs, own],
    }, null, 'https://maps.example/still.jpg', null);
}

beforeAll(() => {
    // The card wraps its image holder in jQuery for the validation menu it builds.
    window.eval(fs.readFileSync(path.resolve(__dirname, '..', '..', 'public/vendor/jquery/jquery-1.12.2.min.js'), 'utf8'));
    window.i18next = { t: (key) => key, language: 'en' };
    window.moment = (value) => value;
    window.sg = { regionNames: {} };
    window.util = { assetPath: assetPathStub, camelToKebab: (s) => s.toLowerCase(), EXPLORE_CANVAS_WIDTH: 720, EXPLORE_CANVAS_HEIGHT: 480 };
    installUtilitiesMisc();
    window.SeverityDisplay = class {};
    window.ValidationInfoDisplay = class { updateValCounts() {} };
    window.ValidationMenu = class { showValidationOnCard() {} };
    window.TagDisplay = class {};
    window.createPanoViewerLogo = () => ({ showSourceLogo() {}, hide() {} });
    window.createPanoAttribution = () => ({ setCredit() {}, hide() {} });
    window.eval(`${CARD_SRC}\nwindow.Card = Card;`);
});

describe('the own-comment cache on a Gallery card (#5475)', () => {
    test('a changed vote drops the viewer\'s own comment, as the server does, and keeps everyone else\'s', () => {
        const card = makeCard('Disagree');
        card.updateUserValidation('Unsure');
        expect(card.getProperty('comments')).toEqual([theirs]);
    });

    test('a cleared vote drops it too', () => {
        const card = makeCard('Disagree');
        card.updateUserValidation(null);
        expect(card.getProperty('comments')).toEqual([theirs]);
    });

    test('a first vote leaves a comment that predates it alone, since the server inserts rather than replaces', () => {
        const card = makeCard(null);
        card.updateUserValidation('Disagree');
        expect(card.getProperty('comments')).toEqual([theirs, own]);
    });
});
