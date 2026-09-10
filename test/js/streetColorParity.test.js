/**
 * Guards the street palette against the map and its legend drifting apart (#5258).
 *
 * The sidebar's street swatches stand for the lines the map draws, and before these tokens existed the two named
 * different colors — the legend showed pure black and a light grey while the layer drew asphalt-500 and asphalt-300.
 * Nothing caught it, because each side was independently valid. So the invariant worth pinning is not any particular
 * color but that both sides read the *same* custom property, which is checked here against the sources rather than a
 * rendered page: the layer's paint lives in JS and the swatch's stroke in CSS, and no single runtime holds both.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');

const MAIN_CSS = read('public/css/main.css');
const SIDEBAR_CSS = read('public/css/components/filter-sidebar.css');
const STREETS_JS = read('public/js/ps-map/addStreetsToMap.js');

const AUDITED_TOKEN = '--color-street-audited';
const UNAUDITED_TOKEN = '--color-street-unaudited';

/**
 * The custom property a CSS rule strokes its path with.
 * @param {string} css - The stylesheet's source.
 * @param {string} selector - The rule's selector, matched literally.
 * @returns {string|null} The token name, or null if the rule doesn't stroke a var().
 */
function strokeToken(css, selector) {
    const rule = css.slice(css.indexOf(selector));
    const match = rule.slice(0, rule.indexOf('}')).match(/stroke:\s*var\((--[\w-]+)\)/);
    return match ? match[1] : null;
}

describe('the street audit-state palette', () => {
    it('defines both street tokens once, in main.css', () => {
        expect(MAIN_CSS.match(new RegExp(`${AUDITED_TOKEN}:`, 'g'))).toHaveLength(1);
        expect(MAIN_CSS.match(new RegExp(`${UNAUDITED_TOKEN}:`, 'g'))).toHaveLength(1);
    });

    it('draws the map lines from the tokens rather than from a color of its own', () => {
        expect(STREETS_JS).toContain(`getPropertyValue('${AUDITED_TOKEN}')`);
        expect(STREETS_JS).toContain(`getPropertyValue('${UNAUDITED_TOKEN}')`);
        // A hex literal in the paint block is the drift this guards against — the legend could never see it.
        // Comments are stripped first: issue references like "#4384" live there and are not colors.
        const paintSection = STREETS_JS.slice(STREETS_JS.indexOf('paint:'), STREETS_JS.indexOf('line-width'))
            .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
        expect(paintSection).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    });

    it('strokes each legend swatch with the token the map draws that state in', () => {
        expect(strokeToken(SIDEBAR_CSS, '.filter-sidebar__street-icon--audited path'))
            .toBe(AUDITED_TOKEN);
        expect(strokeToken(SIDEBAR_CSS, '.filter-sidebar__street-icon--unaudited path'))
            .toBe(UNAUDITED_TOKEN);
        // Outdated is audited-and-dashed, not a third color: it must track the audited token, never diverge.
        expect(strokeToken(SIDEBAR_CSS, '.filter-sidebar__street-icon--outdated path'))
            .toBe(AUDITED_TOKEN);
    });
});
