/**
 * Tests for LabelCardView (public/js/common/LabelCardView.js).
 *
 * The shared populator behind Explore's hover card and Validate's label card (#4730). The two tools feed it the
 * same facts but ship slightly different markup — Explore opts into the not-rated nudge, Validate into the no-info
 * line — so the tests run it against both variants and pin the behaviors that used to live in two forked copies:
 * the rating chip and its wash, the tag pills staying inert, the truncation rules, and the two empty states.
 *
 * The class is a plain top-level declaration (no window assignment), so the source is eval'd with an explicit
 * export, the same way share-widget.test.js loads ShareWidget.
 */

const fs = require('fs');
const path = require('path');

const VIEW_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/LabelCardView.js'), 'utf8'
);

/**
 * Builds the card markup the way views/components/labelCard.scala.html renders it: the not-rated nudge and the
 * no-info line are opt-in, everything else always present. Kept structurally in sync with that template.
 */
function buildCard({ notRated = false, noInfo = false } = {}) {
    document.body.innerHTML = `
      <div id="card" class="label-anchored-panel label-hover-card">
        <div class="label-hover-card__header">
          <img class="label-hover-card__icon" alt="">
          <span class="label-hover-card__type"></span>
        </div>
        <div class="label-hover-card__body">
          <span class="label-hover-card__severity">
            <img class="label-hover-card__severity-icon" alt="">
            <span class="label-hover-card__severity-text"></span>
          </span>
          ${notRated ? `<span class="label-hover-card__not-rated">
            <span class="label-hover-card__not-rated-icon" aria-hidden="true">?</span>
            <span class="label-hover-card__not-rated-text"></span>
          </span>` : ''}
          <span class="label-hover-card__tags"></span>
          <span class="label-hover-card__description"></span>
          ${noInfo ? '<span class="label-hover-card__no-info">No available information</span>' : ''}
        </div>
        <div class="label-hover-card__actions"></div>
      </div>`;
    return document.getElementById('card');
}

const q = (sel) => document.querySelector(sel);

describe('LabelCardView', () => {
    let LabelCardView;

    beforeEach(() => {
        // i18next echoes its key so assertions can name the key they expect; the smiley/color helpers are keyed so
        // per-severity values are distinguishable.
        window.i18next = { t: (key) => key };
        window.util = {
            camelToKebab: (s) => s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
            misc: {
                getIconImagePaths: (type) => ({ iconImagePath: `/icons/${type}.svg` }),
                // CurbRamp plays the positive type (rated for quality), Obstacle the negative one.
                getRatingLevelKeys: () => ({ 1: 'level-one', 2: 'level-two', 3: 'level-three' }),
                isPositiveLabelType: (type) => type === 'CurbRamp',
                getSmileyIconPath: (severity, type) => `/smiley/${type}-${severity}.svg`,
                getSeverityLevelColors: (severity) => ({ wash: `wash-${severity}` }),
                labelTypeHasSeverity: (type) => type !== 'Occlusion',
            },
        };
        window.eval(`${VIEW_SRC}\nwindow.LabelCardView = LabelCardView;`);
        LabelCardView = window.LabelCardView;
    });

    describe('header', () => {
        it('shows the type icon and localized type name, and returns the name', () => {
            const view = new LabelCardView(buildCard());
            const typeName = view.render({ labelType: 'CurbRamp' });

            expect(q('.label-hover-card__icon').src).toContain('/icons/CurbRamp.svg');
            expect(q('.label-hover-card__type').textContent).toBe('common:curb-ramp');
            expect(typeName).toBe('common:curb-ramp');
        });
    });

    describe('rating chip', () => {
        it('names the dimension: severity for a negative type, quality for a positive one', () => {
            const view = new LabelCardView(buildCard());

            view.render({ labelType: 'Obstacle', severity: 3 });
            expect(q('.label-hover-card__severity-text').textContent).toBe('common:severity: common:level-three');
            expect(q('.label-hover-card__severity').style.display).toBe('flex');
            expect(q('.label-hover-card__severity-icon').src).toContain('/smiley/Obstacle-3.svg');

            view.render({ labelType: 'CurbRamp', severity: 1 });
            expect(q('.label-hover-card__severity-text').textContent).toBe('common:quality: common:level-one');
        });

        it('carries the rating level wash, and clears it when the next level has no colors', () => {
            const view = new LabelCardView(buildCard());

            view.render({ labelType: 'Obstacle', severity: 2 });
            expect(q('.label-hover-card__severity').style.getPropertyValue('--level-wash')).toBe('wash-2');

            // A level without colors must not inherit the previous label's wash.
            window.util.misc.getSeverityLevelColors = () => null;
            view.render({ labelType: 'Obstacle', severity: 3 });
            expect(q('.label-hover-card__severity').style.getPropertyValue('--level-wash')).toBe('');
        });

        it('hides the chip when the label is unrated, including the N/A 0 old data carries', () => {
            const view = new LabelCardView(buildCard());

            view.render({ labelType: 'Obstacle', severity: null });
            expect(q('.label-hover-card__severity').style.display).toBe('none');

            view.render({ labelType: 'Obstacle', severity: 0 });
            expect(q('.label-hover-card__severity').style.display).toBe('none');
        });
    });

    describe('not-rated nudge', () => {
        it('shows on an unrated label, asking for the dimension the type is rated on', () => {
            const view = new LabelCardView(buildCard({ notRated: true }));

            view.render({ labelType: 'Obstacle', severity: null });
            expect(q('.label-hover-card__not-rated').style.display).toBe('flex');
            expect(q('.label-hover-card__not-rated-text').textContent)
                .toBe('audit:center-ui.context-menu.rate-severity-prompt');

            view.render({ labelType: 'CurbRamp', severity: null });
            expect(q('.label-hover-card__not-rated-text').textContent)
                .toBe('audit:center-ui.context-menu.rate-quality-prompt');
        });

        it('hides for rated labels and for types that take no rating', () => {
            const view = new LabelCardView(buildCard({ notRated: true }));

            view.render({ labelType: 'Obstacle', severity: 2 });
            expect(q('.label-hover-card__not-rated').style.display).toBe('none');

            view.render({ labelType: 'Occlusion', severity: null });
            expect(q('.label-hover-card__not-rated').style.display).toBe('none');
        });
    });

    describe('tags', () => {
        it('renders one inert pill per tag name, with markup-looking text kept as text', () => {
            const view = new LabelCardView(buildCard());
            view.render({ labelType: 'Obstacle', severity: 1, tagNames: ['pole', '<b>not markup</b>'] });

            const pills = document.querySelectorAll('.label-hover-card__tags .tag-pill .tag-pill__label');
            expect([...pills].map((p) => p.textContent)).toEqual(['pole', '<b>not markup</b>']);
            expect(q('.label-hover-card__tags b')).toBeNull();
            expect(q('.label-hover-card__tags').style.display).toBe('flex');
        });

        it('replaces the previous label\'s pills instead of hiding them behind display:none', () => {
            const view = new LabelCardView(buildCard());
            view.render({ labelType: 'Obstacle', severity: 1, tagNames: ['pole', 'trash-can'] });
            view.render({ labelType: 'Obstacle', severity: 1, tagNames: [] });

            expect(q('.label-hover-card__tags').style.display).toBe('none');
            expect(document.querySelectorAll('.tag-pill').length).toBe(0);
        });

        it('draws the divider only when a chip sits above the tags', () => {
            const withNudge = new LabelCardView(buildCard({ notRated: true }));
            withNudge.render({ labelType: 'Obstacle', severity: 2, tagNames: ['pole'] });
            expect(q('.label-hover-card__tags').classList.contains('label-hover-card__tags--divided')).toBe(true);

            // The not-rated nudge counts as a chip too.
            withNudge.render({ labelType: 'Obstacle', severity: null, tagNames: ['pole'] });
            expect(q('.label-hover-card__tags').classList.contains('label-hover-card__tags--divided')).toBe(true);

            // No rating shown at all (Validate's markup, unrated label): nothing to divide from.
            const plain = new LabelCardView(buildCard());
            plain.render({ labelType: 'Obstacle', severity: null, tagNames: ['pole'] });
            expect(q('.label-hover-card__tags').classList.contains('label-hover-card__tags--divided')).toBe(false);
        });
    });

    describe('description', () => {
        it('shows the full text when no max length is set', () => {
            const long = 'a'.repeat(200);
            const view = new LabelCardView(buildCard());
            view.render({ labelType: 'Obstacle', severity: 1, description: long });

            expect(q('.label-hover-card__description').textContent).toBe(long);
            expect(q('.label-hover-card__description').style.display).toBe('inline');
        });

        it('truncates on code points with an ellipsis when a max length is set', () => {
            const view = new LabelCardView(buildCard(), { descriptionMaxLength: 10 });
            view.render({ labelType: 'Obstacle', severity: 1, description: '😀😀😀😀😀😀😀😀😀😀😀' });

            // 11 emoji cut to 9 + ellipsis: the cut can't land inside a surrogate pair.
            expect(q('.label-hover-card__description').textContent).toBe(`${'😀'.repeat(9)}…`);

            view.render({ labelType: 'Obstacle', severity: 1, description: '1234567890' });
            expect(q('.label-hover-card__description').textContent).toBe('1234567890');
        });

        it('treats a whitespace-only description as absent', () => {
            const view = new LabelCardView(buildCard());
            view.render({ labelType: 'Obstacle', severity: 1, description: '   ' });

            expect(q('.label-hover-card__description').style.display).toBe('none');
            expect(q('.label-hover-card__description').textContent).toBe('');
        });
    });

    describe('empty state', () => {
        it('shows the no-info line when the markup has one and the label has nothing to say', () => {
            const view = new LabelCardView(buildCard({ noInfo: true }));

            view.render({ labelType: 'Obstacle', severity: null });
            expect(q('.label-hover-card__no-info').style.display).toBe('inline');
            expect(q('.label-hover-card__body').style.display).toBe('');

            view.render({ labelType: 'Obstacle', severity: 2 });
            expect(q('.label-hover-card__no-info').style.display).toBe('none');
        });

        it('collapses the body when the markup has no no-info line', () => {
            const view = new LabelCardView(buildCard());

            view.render({ labelType: 'Occlusion', severity: null });
            expect(q('.label-hover-card__body').style.display).toBe('none');

            view.render({ labelType: 'Obstacle', severity: null, tagNames: ['pole'] });
            expect(q('.label-hover-card__body').style.display).toBe('flex');
        });
    });
});
