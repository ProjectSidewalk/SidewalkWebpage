/**
 * Tests for LabelDetail.voteChipFor (public/js/common/label-detail/LabelDetail.js, issue #5015).
 *
 * Each validator comment is drawn with a chip naming its author's vote on the label. The vote is joined server-side
 * per (label_id, user_id) rather than stored with the comment, so the field is absent for a commenter who never
 * voted and null for one whose vote was since cleared — both have to yield no chip rather than an empty pill or a
 * `label-detail__comment-vote--null` class.
 *
 * The glyph is inlined rather than loaded from images/icons/validation/{vote}-outline.svg because those files
 * hardcode `stroke="#242424"` at a width that thins to a sub-pixel hairline at chip size. Inlined, it inherits
 * `currentColor`, which is what keeps the glyph at the chip text's contrast.
 *
 * LabelDetail is a top-level `class` declaration written for the Grunt-concatenation world, so (like
 * labelDetailSubmissionContext.test.js) the source is eval'd into the jsdom global scope with an epilogue that
 * exposes the class. Only the static method is exercised here — constructing a LabelDetail needs a live pano viewer.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/label-detail/LabelDetail.js'), 'utf8'
);

/** The two globals voteChipFor reaches for, stubbed so the assertions read against known strings. */
function stubGlobals() {
    window.util = { camelToKebab: (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase() };
    window.i18next = {
        t: (key, opts) => (key === 'labelmap:commenter-voted' ? `Commenter voted ${opts.vote}` : `t(${key})`)
    };
}

/** Loads a fresh LabelDetail class into the jsdom global scope. */
function loadLabelDetail() {
    stubGlobals();
    window.eval(`${SRC}\nwindow.LabelDetail = LabelDetail;`);
    return window.LabelDetail;
}

describe('LabelDetail.voteChipFor', () => {
    let LabelDetail;

    beforeEach(() => {
        LabelDetail = loadLabelDetail();
    });

    test.each(['Agree', 'Disagree', 'Unsure'])('%s renders a chip carrying the vote word and its modifier', (vote) => {
        const chip = LabelDetail.voteChipFor({ comment: 'Looks right to me.', validation: vote });

        expect(chip.classList.contains('label-detail__comment-vote')).toBe(true);
        expect(chip.classList.contains(`label-detail__comment-vote--${vote.toLowerCase()}`)).toBe(true);
        expect(chip.textContent).toBe(`t(common:${vote.toLowerCase()})`);
    });

    test.each(['Agree', 'Disagree', 'Unsure'])('%s draws its glyph inline, in currentColor', (vote) => {
        const svg = LabelDetail.voteChipFor({ validation: vote }).querySelector('svg');

        // An <img> pointing at the icon file would defeat the point: the file's stroke color and width are baked in.
        expect(svg).not.toBeNull();
        expect(svg.getAttribute('stroke')).toBe('currentColor');
        expect(Number(svg.getAttribute('stroke-width'))).toBeGreaterThan(1);
        expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
        expect(svg.querySelectorAll('path[d=""]').length).toBe(0);
    });

    test('the chip announces whose verdict it is rather than a bare verb', () => {
        // Without this the comment reads to a screen reader as "Agree" running straight into the comment text.
        const chip = LabelDetail.voteChipFor({ validation: 'Agree' });

        expect(chip.getAttribute('role')).toBe('img');
        expect(chip.getAttribute('aria-label')).toBe('Commenter voted t(common:agree)');
        expect(chip.querySelector('svg').getAttribute('aria-hidden')).toBe('true');
    });

    test.each([
        ['a cleared vote', { comment: 'Hard to tell.', validation: null }],
        ['a commenter who never voted', { comment: 'Hard to tell.' }],
        ['a bare string entry', 'Hard to tell.'],
        ['a null entry', null],
        ['a value outside the three votes', { validation: 'Maybe' }],
        ['a prototype key masquerading as a vote', { validation: 'constructor' }]
    ])('%s gets no chip', (_label, comment) => {
        expect(LabelDetail.voteChipFor(comment)).toBeNull();
    });
});
