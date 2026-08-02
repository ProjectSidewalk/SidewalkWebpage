/**
 * Tests for the composer's daily-cap message: when the server says how long the wait is, the message names it as a
 * duration ("You can publish another in 3 hours") rather than the old "try again tomorrow" — which was never true,
 * since the cap is a rolling 24-hour window and "tomorrow" depends on a timezone the server doesn't know.
 *
 * The formatter is a private static, so it's exercised through the public error path: a stubbed fetch returns the
 * 429 body the controller produces, and the rendered error text is asserted.
 */

const fs = require('fs');
const path = require('path');

const COMPOSER_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/label-detail/StoryComposer.js'), 'utf8'
);

/** The elements StoryComposer's constructor looks up, in a <dialog> host. */
function setupDom() {
    document.body.innerHTML = `
        <dialog class="story-composer">
            <h3 class="story-composer__title"></h3>
            <p class="story-composer__intro"></p>
            <textarea class="story-composer__text"></textarea>
            <span class="story-composer__counter"></span>
            <button type="button" class="story-composer__photo-attach"></button>
            <input type="file" class="story-composer__photo-input">
            <div class="story-composer__photo-preview" hidden>
                <img class="story-composer__photo-thumb" alt="">
                <button type="button" class="story-composer__photo-remove"></button>
            </div>
            <input class="story-composer__alt-input">
            <div class="story-composer__check-row"><input type="radio" class="story-composer__name-anon"></div>
            <div class="story-composer__check-row">
                <input type="radio" class="story-composer__name-username">
                <span class="story-composer__username-option"></span>
            </div>
            <p class="story-composer__privacy"></p>
            <div class="story-composer__signin-cta"><button class="story-composer__signin-btn"></button></div>
            <p class="story-composer__error" hidden></p>
            <button type="button" class="story-composer__cancel"></button>
            <button type="button" class="story-composer__close"></button>
            <button type="button" class="story-composer__submit"></button>
        </dialog>`;
    return document.querySelector('.story-composer');
}

/** The two real English strings, so the assertions read as the user would see them. */
const STRINGS = {
    'labelmap:story.error.rate-limited':
        'You’ve published as many stories as we allow in a day. Please try again later.',
    'labelmap:story.error.rate-limited-retry':
        'You’ve published as many stories as we allow in a day. You can publish another {{when}}.',
    'labelmap:story.error.generic': 'Something went wrong.',
};

/** Drains the microtask queue so the submit promise chain settles. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const errorText = () => document.querySelector('.story-composer__error').textContent;

/** Runs a submission that the server refuses with `body` at HTTP 429. */
async function submitAndFail(body) {
    const composer = new window.StoryComposer(setupDom(), {});
    window.fetch = jest.fn().mockResolvedValue({
        ok: false, status: 429, json: () => Promise.resolve(body),
    });
    await composer.open(7, 5000);
    document.querySelector('.story-composer__text').value = 'The curb here is impassable in my chair.';
    document.querySelector('.story-composer__submit').click();
    await flush();
    await flush();
}

beforeEach(() => {
    window.eval(`${COMPOSER_SRC}\nwindow.StoryComposer = StoryComposer;`);
    window.i18next = {
        language: 'en',
        exists: (key) => key in STRINGS,
        t: (key, opts) => (STRINGS[key] || key).replace('{{when}}', (opts && opts.when) || ''),
    };
    window.logWebpageActivity = jest.fn();
    window.HTMLDialogElement.prototype.showModal = jest.fn();
    window.HTMLDialogElement.prototype.close = jest.fn();
    document.documentElement.lang = 'en';
    // open() looks for a stashed draft in IndexedDB, which jsdom has none of; the composer already handles that by
    // logging and carrying on, so silence the expected noise rather than let it bury a real failure.
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    console.error.mockRestore();
});

describe('the daily-cap message', () => {
    const RATE_LIMITED = { error: 'story.error.rate-limited', message: 'fallback' };

    test('names the wait in hours when the server says how long it is', async () => {
        await submitAndFail({ ...RATE_LIMITED, retry_after_seconds: 3 * 3600 });
        expect(errorText()).toBe(
            'You’ve published as many stories as we allow in a day. You can publish another in 3 hours.');
    });

    test('switches to minutes for a short wait, rounding up', async () => {
        // 20.5 minutes: "in 21 minutes" is a promise we can keep; "in 20" would refuse them again.
        await submitAndFail({ ...RATE_LIMITED, retry_after_seconds: 1230 });
        expect(errorText()).toContain('in 21 minutes');
    });

    test('an 80-minute wait stays in minutes rather than rounding to "1 hour"', async () => {
        await submitAndFail({ ...RATE_LIMITED, retry_after_seconds: 80 * 60 });
        expect(errorText()).toContain('in 80 minutes');
    });

    test('falls back to the untimed message when the server sends no wait', async () => {
        await submitAndFail(RATE_LIMITED);
        expect(errorText()).toBe('You’ve published as many stories as we allow in a day. Please try again later.');
    });

    test('a nonsense wait is ignored rather than rendered', async () => {
        await submitAndFail({ ...RATE_LIMITED, retry_after_seconds: 'soon' });
        expect(errorText()).toBe('You’ve published as many stories as we allow in a day. Please try again later.');
    });

    test('the phrase is formatted in the reader\'s language', async () => {
        window.i18next.language = 'es';
        await submitAndFail({ ...RATE_LIMITED, retry_after_seconds: 3 * 3600 });
        expect(errorText()).toContain('dentro de 3 horas');
    });
});
