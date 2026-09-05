/**
 * Tests for the neighborhood line on a Gallery card (public/js/gallery/src/cards/Card.js, issue #4585).
 *
 * A card says which neighborhood its label sits in, looked up from the id -> name map the page carries. The name is
 * city data rather than ours, so it goes in as text; these tests pin that along with the absent-name case, since a
 * card with no known neighborhood must simply not show the line rather than show an empty one.
 *
 * Card is a Grunt-concatenated `class` that reaches for page globals, so the source is eval'd into jsdom with the
 * collaborators it touches during construction stubbed out.
 */

const fs = require('fs');
const path = require('path');

const { assetPathStub } = require('./loadGlobalScript');

const CARD_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/gallery/src/cards/Card.js'), 'utf8'
);

/** One label payload, shaped like an entry from POST /label/labels. */
function label(overrides = {}) {
    return {
        label_id: 1, label_type: 'CurbRamp', region_id: 7, severity: 2, canvas_x: 10, canvas_y: 20,
        agree_count: 1, disagree_count: 0, unsure_count: 0, tags: [], ai_generated: false, ...overrides,
    };
}

describe('a Gallery card\'s location line', () => {
    /** @returns {?HTMLElement} The card's rendered location line. */
    const locationLine = () => document.querySelector('.card-location');

    /**
     * Renders a card into the document.
     * @param {object} [labelOverrides] Overrides for the label payload.
     * @returns {Card} The card under test.
     */
    function renderCard(labelOverrides) {
        document.body.innerHTML = '<div id="cards"></div>';
        const card = new window.Card(label(labelOverrides), null, null);
        card.render(document.getElementById('cards'));
        return card;
    }

    beforeAll(() => {
        window.i18next = { t: (key) => key, language: 'en' };
        window.moment = (value) => value;
        window.util = {
            assetPath: assetPathStub,
            camelToKebab: (s) => s.toLowerCase(),
            EXPLORE_CANVAS_WIDTH: 720,
            EXPLORE_CANVAS_HEIGHT: 480,
            misc: {
                getIconImagePaths: () => ({ iconImagePath: 'icon.png' }),
                labelTypeHasSeverity: () => true,
            },
        };
        // Collaborators the constructor builds but this test doesn't exercise.
        window.SeverityDisplay = class {};
        window.ValidationInfoDisplay = class {};
        window.ValidationMenu = class {};
        window.TagDisplay = class {};
        window.$ = () => ({ tooltip: () => ({ tooltip: () => {} }) });
        window.eval(`${CARD_SRC}\nwindow.Card = Card;`);
    });

    beforeEach(() => {
        window.sg = { regionNames: { 7: 'Herrick Park' }, tracker: { push: jest.fn() } };
    });

    it('names the neighborhood the label sits in', () => {
        renderCard();

        expect(locationLine().querySelector('.card-location__name').textContent).toBe('Herrick Park');
    });

    it('promises on hover where the click leads', () => {
        renderCard();

        expect(locationLine().title).toBe('labelmap:open-label-on-labelmap');
    });

    it('links out to this label on the LabelMap, and says so to a screen reader', () => {
        const card = renderCard();

        expect(locationLine().getAttribute('href')).toBe('/labelMap?labelId=1');
        // The accessible name leads with the visible text, per WCAG 2.5.3.
        expect(locationLine().getAttribute('aria-label')).toBe('Herrick Park: labelmap:open-label-on-labelmap');

        locationLine().click();

        expect(sg.tracker.push).toHaveBeenCalledWith('CardLocationClick', null, { Label_Id: 1, Region_Id: 7 });
        expect(card.getProperty('region_id')).toBe(7);
    });

    it('shows no line at all when the neighborhood is unknown', () => {
        renderCard({ region_id: 999 });

        expect(locationLine()).toBeNull();
    });

    it('shows no line when the page carries no names', () => {
        sg.regionNames = {};
        renderCard();

        expect(locationLine()).toBeNull();
    });

    it('puts the name in as text, so a name is never read as markup', () => {
        sg.regionNames = { 7: '<img src=x onerror="alert(1)">Park' };
        renderCard();

        const name = locationLine().querySelector('.card-location__name');
        expect(name.querySelector('img')).toBeNull();
        expect(name.textContent).toBe('<img src=x onerror="alert(1)">Park');
    });
});
