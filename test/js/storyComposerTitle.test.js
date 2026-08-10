/**
 * Tests for the story composer's label-aware dialog title (#4722 QA): the heading names the label the story will
 * attach to — "Write your story about this Missing Curb Ramp" — and falls back to the generic wording for a label
 * whose type name doesn't read as a thing you can have a story "about" (Other, Can't See the Sidewalk).
 *
 * StoryComposer is a page-global `class` (Grunt-concatenation world), so the source is eval'd into jsdom. Its title
 * lives behind private instance fields, so the class is constructed for real against the dialog skeleton its
 * constructor queries rather than called off the prototype.
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
            <p class="story-composer__error"></p>
            <button type="button" class="story-composer__cancel"></button>
            <button type="button" class="story-composer__close"></button>
            <button type="button" class="story-composer__submit"></button>
        </dialog>`;
    return document.querySelector('.story-composer');
}

function newComposer() {
    return new window.StoryComposer(setupDom(), {});
}

const title = () => document.querySelector('.story-composer__title').textContent;

beforeEach(() => {
    window.eval(`${COMPOSER_SRC}\nwindow.StoryComposer = StoryComposer;`);
    // Echo the key, with any interpolation appended so both halves are assertable.
    window.i18next = {
        t: (key, opts) => (opts && opts.labelType !== undefined ? `${key}[${opts.labelType}]` : key),
    };
    window.logWebpageActivity = jest.fn();
    window.HTMLDialogElement.prototype.showModal = jest.fn(); // jsdom's is a no-op stub in some versions.
});

describe("the story composer's dialog title", () => {
    test('names the label once the host says which type it is', () => {
        const composer = newComposer();
        composer.setLabelType('Missing Curb Ramp');
        expect(title()).toBe('labelmap:story.composer-title-about[Missing Curb Ramp]');
    });

    test('falls back to the generic wording when the host withholds a type', () => {
        const composer = newComposer();
        composer.setLabelType(null);
        expect(title()).toBe('labelmap:story.composer-title');
    });

    test('a later label replaces the name — the composer outlives the label it was opened for', () => {
        const composer = newComposer();
        composer.setLabelType('Obstacle in Path');
        composer.setLabelType('Surface Problem');
        expect(title()).toBe('labelmap:story.composer-title-about[Surface Problem]');
        composer.setLabelType(''); // An empty name is as good as none.
        expect(title()).toBe('labelmap:story.composer-title');
    });

    test('edit mode keeps the label name, using the edit wording', () => {
        const composer = newComposer();
        composer.setLabelType('Missing Curb Ramp');
        composer.openForEdit({ story_id: 3, text: 'Hi', media: null }, 500);
        expect(title()).toBe('labelmap:story.composer-title-edit-about[Missing Curb Ramp]');
    });

    test('edit mode without a label name uses the plain edit wording', () => {
        const composer = newComposer();
        composer.openForEdit({ story_id: 3, text: 'Hi', media: null }, 500);
        expect(title()).toBe('labelmap:story.composer-title-edit');
    });
});
