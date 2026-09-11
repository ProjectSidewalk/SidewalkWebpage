/**
 * Tests for LabelMiniCard (public/js/common/LabelMiniCard.js, #5217): what a card shows for a label, and that its
 * vote chips post the validation payload every static-image surface sends, clear on a second click, roll back on a
 * refusal, and lock where there is nothing to judge or the label is the reader's own.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');

/** A `/label/id` JSON with a crop, two agrees, and no vote of the reader's own. */
function label(overrides = {}) {
    return {
        label_id: 42, label_type: 'CurbRamp', severity: 2, tags: ['narrow'], crop_url: 'https://example.test/42.jpg',
        backup_image_url: null, num_agree: 2, num_disagree: 1, num_unsure: 0, user_validation: null,
        from_current_user: false, heading: 12.5, pitch: -3, zoom: 1, canvas_x: 310, canvas_y: 220,
        timestamp: '2026-09-01T12:00:00Z', ...overrides,
    };
}

/** A settled fetch: `ok` false answers with the status the card should treat as a refusal. */
const response = (ok = true) => Promise.resolve({ok, status: ok ? 200 : 500, json: () => Promise.resolve({})});

const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe('LabelMiniCard', () => {
    let fetchMock;
    let postedBodies;

    beforeAll(() => {
        window.i18next = {
            language: 'en',
            t: (key, opts) => {
                const bare = key.replace(/^[a-z]+:/, '');
                if (!opts || Object.keys(opts).length === 0) return bare;
                return `${bare} ${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(' ')}`;
            },
        };
        window.util = {
            misc: {
                getSeverityLevelColors: (severity) => ({wash: `var(--wash-${severity})`}),
                getRatingLevelKeys: () => ({1: 'good', 2: 'okay', 3: 'bad'}),
                getIconImagePaths: (type) => ({iconImagePath: `/assets/icons/${type}.svg`}),
                labelTypeHasSeverity: (type) => type !== 'Signal',
            },
            assetPath: (p) => `/assets/${p}`,
            lazyIdentityFetch: (...args) => window.fetch(...args),
        };
        window.Toast = {show: jest.fn()};
        window.BadgeAchievements = {recordValidation: jest.fn()};
        window.eval(`${read('public/js/common/LabelMiniCard.js')}\nwindow.LabelMiniCard = LabelMiniCard;`);
    });

    beforeEach(() => {
        postedBodies = [];
        fetchMock = jest.fn((url, options) => {
            postedBodies.push(JSON.parse(options.body));
            return response(true);
        });
        window.fetch = fetchMock;
        window.Toast.show.mockClear();
        window.BadgeAchievements.recordValidation.mockClear();
        document.body.innerHTML = '<ul id="host"></ul>';
    });

    const mount = (data, opts = {}) => {
        const card = new window.LabelMiniCard(data, {source: 'TestSurface', ...opts});
        document.getElementById('host').appendChild(card.element);
        return card;
    };
    const chip = (card, action) => card.element.querySelector(`[data-action="${action}"]`);
    const count = (card, action) => chip(card, action).querySelector('.lmc__vote-count').textContent;

    test('renders the crop, the badge, the rating word, the tags, the date, and the counts', () => {
        const card = mount(label());
        const el = card.element;
        expect(el.dataset.labelId).toBe('42');
        expect(el.classList.contains('lmc--sheet')).toBe(true);
        expect(el.querySelector('.lmc__image').getAttribute('src')).toBe('https://example.test/42.jpg');
        expect(el.querySelector('.lmc__badge').getAttribute('src')).toBe('/assets/icons/CurbRamp.svg');
        expect(el.querySelector('.lmc__rating').textContent).toBe('okay');
        expect(el.querySelector('.lmc__rating').style.getPropertyValue('--lmc-wash')).toBe('var(--wash-2)');
        expect(el.querySelector('.lmc__tag').textContent).toBe('tag.narrow defaultValue=narrow');
        expect(el.querySelector('.lmc__date')).not.toBeNull();
        expect(count(card, 'Agree')).toBe('2');
        expect(count(card, 'Disagree')).toBe('1');
        expect(count(card, 'Unsure')).toBe('0');
        expect(chip(card, 'Agree').getAttribute('aria-pressed')).toBe('false');
        expect(chip(card, 'Agree').querySelector('img').getAttribute('src'))
            .toBe('/assets/images/icons/validation/agree-outline.svg');
        expect(el.querySelector('.lmc__open').getAttribute('aria-label')).toBe('mini-card.open label=curb-ramp, okay');
    });

    test('a label with no picture shows the type placeholder and locks the chips; the strip size drops the caption', () => {
        const card = mount(label({crop_url: null}), {size: 'strip', className: 'host-item'});
        const el = card.element;
        expect(el.classList.contains('lmc--strip')).toBe(true);
        expect(el.classList.contains('host-item')).toBe(true);
        expect(el.querySelector('.lmc__placeholder')).not.toBeNull();
        expect(el.querySelector('.lmc__image')).toBeNull();
        expect(el.querySelector('.lmc__body')).toBeNull();
        for (const action of ['Agree', 'Disagree', 'Unsure']) {
            expect(chip(card, action).disabled).toBe(true);
            expect(chip(card, action).getAttribute('data-ps-tooltip')).toBe('mini-card.no-image-to-judge');
        }
    });

    test('the backup image stands in for a missing crop, and the reader\'s own label is locked with the reason', () => {
        const card = mount(label({crop_url: null, backup_image_url: 'https://example.test/pano.jpg', from_current_user: true}));
        expect(card.element.querySelector('.lmc__image').getAttribute('src')).toBe('https://example.test/pano.jpg');
        expect(chip(card, 'Agree').disabled).toBe(true);
        expect(chip(card, 'Agree').getAttribute('data-ps-tooltip')).toBe('own-label-disabled');
    });

    test('the picture opens the label', () => {
        const onOpen = jest.fn();
        const card = mount(label(), {onOpen});
        card.element.querySelector('.lmc__open').click();
        expect(onOpen).toHaveBeenCalledWith(42);
    });

    test('a vote posts the static-crop validation payload, counts up at once, and ticks the badge', async () => {
        const onVote = jest.fn();
        const card = mount(label(), {onVote});
        chip(card, 'Agree').click();
        // Optimistic: the count and the pressed state move before the server answers.
        expect(count(card, 'Agree')).toBe('3');
        expect(chip(card, 'Agree').getAttribute('aria-pressed')).toBe('true');
        expect(chip(card, 'Disagree').disabled).toBe(true); // in flight
        await settle();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('/labelmap/validate');
        expect(fetchMock.mock.calls[0][1].method).toBe('POST');
        expect(postedBodies[0]).toMatchObject({
            label_id: 42, label_type: 'CurbRamp', validation_result: 'Agree', severity: 2, tags: ['narrow'],
            canvas_x: 310, canvas_y: 220, heading: 12.5, pitch: -3, zoom: 1, canvas_width: 720, canvas_height: 480,
            source: 'TestSurface', undone: false, redone: false, viewer_type: 'StaticCrop',
        });
        expect(typeof postedBodies[0].start_timestamp).toBe('string');
        expect(chip(card, 'Disagree').disabled).toBe(false);
        expect(chip(card, 'Agree').querySelector('img').getAttribute('src'))
            .toBe('/assets/images/icons/validation/agree-filled.svg');
        expect(window.BadgeAchievements.recordValidation).toHaveBeenCalledTimes(1);
        expect(onVote).toHaveBeenCalledWith('Agree', expect.objectContaining({num_agree: 3, user_validation: 'Agree'}));
    });

    test('the pressed chip clears the vote (undone), and switching chips is a redo', async () => {
        const log = jest.fn();
        const card = mount(label({user_validation: 'Agree'}), {log});
        expect(chip(card, 'Agree').getAttribute('aria-pressed')).toBe('true');
        chip(card, 'Agree').click();
        await settle();
        expect(postedBodies[0]).toMatchObject({validation_result: 'Agree', undone: true, redone: false});
        expect(count(card, 'Agree')).toBe('1');
        expect(chip(card, 'Agree').getAttribute('aria-pressed')).toBe('false');
        expect(log).toHaveBeenCalledWith('ClearVote_result=Agree_labelId=42');
        expect(window.BadgeAchievements.recordValidation).not.toHaveBeenCalled();

        chip(card, 'Disagree').click();
        await settle();
        expect(postedBodies[1]).toMatchObject({validation_result: 'Disagree', undone: false, redone: false});
        chip(card, 'Unsure').click();
        await settle();
        // Moving an existing vote is a redo, not a first validation.
        expect(postedBodies[2]).toMatchObject({validation_result: 'Unsure', undone: false, redone: true});
        expect(count(card, 'Disagree')).toBe('1');
        expect(count(card, 'Unsure')).toBe('1');
    });

    test('a refused vote rolls the counts back and says so', async () => {
        window.fetch = jest.fn(() => response(false));
        const onVote = jest.fn();
        const card = mount(label(), {onVote});
        chip(card, 'Disagree').click();
        expect(count(card, 'Disagree')).toBe('2');
        await settle();
        expect(count(card, 'Disagree')).toBe('1');
        expect(chip(card, 'Disagree').getAttribute('aria-pressed')).toBe('false');
        expect(chip(card, 'Disagree').disabled).toBe(false);
        expect(window.Toast.show).toHaveBeenCalledTimes(1);
        expect(onVote).not.toHaveBeenCalled();
    });

    test('update() re-renders from fresh JSON in place', () => {
        const card = mount(label());
        const root = card.element;
        card.update(label({num_agree: 9, user_validation: 'Agree', severity: 3}));
        expect(card.element).toBe(root);
        expect(count(card, 'Agree')).toBe('9');
        expect(chip(card, 'Agree').getAttribute('aria-pressed')).toBe('true');
        expect(root.querySelector('.lmc__rating').textContent).toBe('bad');
    });

    test('a picture that fails to load falls back to the placeholder', () => {
        const card = mount(label());
        card.element.querySelector('.lmc__image').dispatchEvent(new Event('error'));
        expect(card.element.querySelector('.lmc__image')).toBeNull();
        expect(card.element.querySelector('.lmc__placeholder')).not.toBeNull();
    });
});
