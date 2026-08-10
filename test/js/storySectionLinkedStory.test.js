/**
 * Tests for StorySection's story-anchored deep link (#4722): a story share links /label/:id?storyId=<id>, the host
 * passes that id down as highlightStoryId, and the first render containing the story opens the disclosure,
 * highlights the row, and scrolls it into view — exactly once. A story that is gone (deleted, or hidden by
 * moderators) must degrade silently to the plain label page.
 *
 * StorySection is a page-global `class` (Grunt-concatenation world), so the source is eval'd into jsdom with its
 * collaborators (fetch, i18next, moment, StoryComposer) stubbed.
 */

const fs = require('fs');
const path = require('path');

const SECTION_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/label-detail/StorySection.js'), 'utf8'
);

/** One story payload, shaped like an entry from GET /label/:labelId/stories. */
function story(overrides = {}) {
    return {
        story_id: 11, text: 'The cracked panel here tips my chair.', display_name: null, is_own: false,
        hidden: false, created_at: '2026-07-01T12:00:00Z', media: null, ...overrides,
    };
}

/** Drains the microtask queue (a macrotask runs after all pending promise continuations). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Renders the labelDetail skeleton pieces StorySection queries and returns the host root. */
function setupDom() {
    document.body.innerHTML = `
        <div id="root">
            <div class="label-detail__stories" hidden>
                <details class="label-detail__stories-details">
                    <summary class="label-detail__stories-summary">
                        <span class="label-detail__stories-count" hidden></span>
                        <button type="button" class="label-detail__story-share"></button>
                    </summary>
                    <div class="label-detail__stories-list"></div>
                </details>
            </div>
            <button type="button" class="label-detail__story-share--footer" hidden></button>
            <span class="label-detail__story-status"></span>
            <dialog class="story-lightbox">
                <img class="story-lightbox__img" alt="">
                <p class="story-lightbox__caption"></p>
                <button type="button" class="story-lightbox__close"></button>
            </dialog>
            <div class="story-composer"></div>
        </div>`;
    return document.getElementById('root');
}

describe("StorySection's linked-story reveal (#4722)", () => {
    let stories;
    let composerCalls;

    beforeEach(() => {
        window.eval(`${SECTION_SRC}\nwindow.StorySection = StorySection;`);
        composerCalls = { setLabelType: [] };
        window.StoryComposer = class {
            open() {}
            openForEdit() {}
            setCopyVariant() {}
            setLabelType(name) { composerCalls.setLabelType.push(name); }
        };
        window.i18next = { t: (key) => key };
        window.moment = jest.fn(() => ({ format: () => 'DATE' }));
        window.matchMedia = jest.fn().mockReturnValue({ matches: false }); // No reduced-motion preference.
        window.HTMLElement.prototype.scrollIntoView = jest.fn(); // jsdom doesn't implement it.
        window.logWebpageActivity = jest.fn();
        stories = [story()];
        window.fetch = jest.fn().mockImplementation(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ max_text_length: 500, is_access_problem: true, stories }),
        }));
    });

    /** Builds the section against a fresh skeleton and shows label 1. */
    async function renderSection(opts = {}) {
        const section = new window.StorySection(setupDom(), opts);
        section.setLabel(1);
        await flush();
        return section;
    }

    /** The highlighted row, or null. */
    const linkedRow = () => document.querySelector('.label-detail__story--linked');

    test('the label type rides down to the composer, so its title can name the label', async () => {
        const section = new window.StorySection(setupDom(), {});
        section.setLabel(1, 'Missing Curb Ramp');
        await flush();
        expect(composerCalls.setLabelType).toEqual(['Missing Curb Ramp']);

        // A host that withholds the name (Other / Can't See the Sidewalk) leaves the composer on generic wording.
        section.setLabel(2);
        expect(composerCalls.setLabelType).toEqual(['Missing Curb Ramp', null]);
    });

    test('every story row carries its story id as the deep-link anchor', async () => {
        stories = [story({ story_id: 11 }), story({ story_id: 12 })];
        await renderSection();
        expect([...document.querySelectorAll('.label-detail__story')].map((r) => r.dataset.storyId))
            .toEqual(['11', '12']);
        expect(linkedRow()).toBeNull(); // No deep link, no highlight.
    });

    test('the linked story is highlighted, its disclosure opened, and scrolled into view', async () => {
        stories = [story({ story_id: 11 }), story({ story_id: 12 })];
        await renderSection({ highlightStoryId: 12 });

        const row = linkedRow();
        expect(row).not.toBeNull();
        expect(row.dataset.storyId).toBe('12');
        expect(document.querySelector('.label-detail__stories-details').open).toBe(true);
        const scroll = window.HTMLElement.prototype.scrollIntoView;
        expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
        expect(scroll.mock.contexts[0]).toBe(row); // It's the linked row that scrolled, not the list.
    });

    test('honors prefers-reduced-motion by scrolling without animation', async () => {
        window.matchMedia = jest.fn().mockReturnValue({ matches: true });
        await renderSection({ highlightStoryId: 11 });
        expect(window.HTMLElement.prototype.scrollIntoView)
            .toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' });
    });

    test('the reveal is one-shot: later refreshes re-render without the highlight', async () => {
        const section = await renderSection({ highlightStoryId: 11 });
        expect(linkedRow()).not.toBeNull();
        section.refresh();
        await flush();
        expect(linkedRow()).toBeNull();
    });

    test('a linked story that no longer exists degrades silently, and the miss consumes the deep link', async () => {
        stories = [story({ story_id: 11 })];
        const section = await renderSection({ highlightStoryId: 999 });
        expect(linkedRow()).toBeNull();

        // The deep link must not linger past the render that could have shown it: were the section later re-pointed
        // at a label whose list contains that id, a stale highlight would fire mid-browse.
        stories = [story({ story_id: 999 })];
        section.refresh();
        await flush();
        expect(linkedRow()).toBeNull();
        expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    });
});
