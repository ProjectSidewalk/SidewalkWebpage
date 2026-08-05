/**
 * Tests for the "Your stories" list on the user dashboard (public/js/user-dashboard/StoriesSection.js, issues #4054
 * and #4656).
 *
 * Two contracts matter here beyond rendering: an author can edit a story from the list (the row's Edit hands the
 * story to the shared StoryComposer, with the character cap and problem-vs-feature phrasing taken from the payload
 * rather than re-derived here), and Delete is a hard, unrecoverable retraction — so it must never fire without a
 * confirmation. The list refreshes on the page-level `ps:story:changed` signal (emitted by StoryComposer and the
 * label card's own delete path), which also repairs the focus the re-render drops.
 *
 * StoriesSection is a page-global `class` that reaches for globals, so the source is eval'd into jsdom with its
 * collaborators (fetch, i18next, moment, StoryComposer, ConfirmDialog) stubbed.
 */

const fs = require('fs');
const path = require('path');

const SECTION_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/user-dashboard/StoriesSection.js'), 'utf8'
);

/** One story payload, shaped like an entry from GET /userapi/stories/mine. */
function story(overrides = {}) {
    return {
        story_id: 11, label_id: 501, label_type: 'SurfaceProblem', is_access_problem: true,
        text: 'The cracked panel here tips my chair.', display_name_mode: 'anonymous', hidden: false,
        created_at: '2026-07-01T12:00:00Z', media: null, label_image_url: null, ...overrides,
    };
}

describe('the dashboard\'s "Your stories" list', () => {
    /** @returns {Array<HTMLElement>} The rendered rows, in document order. */
    const rows = () => Array.from(document.querySelectorAll('.ud-story-row'));
    /** @returns {Array<string>} The control labels in the first row's meta line, in order. */
    const firstRowControls = () =>
        Array.from(document.querySelectorAll('.ud-story-row:first-child .ud-story-meta button'))
            .map((btn) => btn.className);

    let composer;
    let confirmResult;
    let stories;

    /** Drains the microtask queue (a macrotask runs after all pending promise continuations). */
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    /**
     * Renders the section against the stubbed payload.
     * @param {object} [opts] Overrides for the StoriesSection options (e.g. composerDialog: null).
     * @returns {Promise<StoriesSection>} The rendered section.
     */
    async function renderSection(opts = {}) {
        document.body.innerHTML = '<div id="ud-stories"></div><dialog id="ud-story-composer"></dialog>';
        const section = new window.StoriesSection(document.getElementById('ud-stories'), {
            labelPopup: null,
            composerDialog: document.getElementById('ud-story-composer'),
            currUsername: 'ada',
            ...opts,
        });
        await section.render();
        return section;
    }

    beforeAll(() => {
        window.i18next = { t: (key) => key };
        window.moment = () => ({ format: () => 'Jul 1, 2026' });
        window.camelToKebab = (s) => s.toLowerCase();
        // Records what the section asks of the shared composer; behavior itself is StoryComposer's own contract.
        window.StoryComposer = class {
            constructor(dialog, opts) {
                composer = this;
                this.dialog = dialog;
                this.opts = opts;
                this.setCopyVariant = jest.fn();
                this.openForEdit = jest.fn();
            }
        };
        window.ConfirmDialog = { confirm: jest.fn(() => Promise.resolve(confirmResult)) };
        window.eval(`${SECTION_SRC}\nwindow.StoriesSection = StoriesSection;`);
    });

    beforeEach(() => {
        composer = null;
        confirmResult = true;
        stories = [story()];
        window.ConfirmDialog.confirm.mockClear();
        window.fetch = jest.fn((url, init) => {
            if (init && init.method === 'DELETE') return Promise.resolve({ ok: true });
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ max_text_length: 1200, stories }) });
        });
    });

    it('offers Edit before Delete on each story', async () => {
        await renderSection();

        expect(firstRowControls()).toEqual(['ud-story-edit', 'ud-story-delete']);
        expect(document.querySelector('.ud-story-edit').textContent).toBe('labelmap:story.edit');
        // Rows repeat the same visible "Edit"/"Delete", so each control's accessible name says which story.
        expect(document.querySelector('.ud-story-edit').getAttribute('aria-label')).toBe('labelmap:story.edit-aria');
        expect(document.querySelector('.ud-story-delete').getAttribute('aria-label'))
            .toBe('labelmap:story.delete-aria');
    });

    it('fills the thumbnail from the photo, else the backend\'s label preview, else a placeholder', async () => {
        stories = [
            story({ story_id: 11, media: { url: '/storyMedia/7', alt_text: 'wet leaves' } }),
            story({ story_id: 12, label_image_url: '/cropImage/SurfaceProblem/501?exp=1&sig=x' }),
            story({ story_id: 13 }),
        ];
        await renderSection();

        const [photo, labelPreview, none] = rows().map((r) => r.querySelector('.ud-story-thumb'));
        expect(photo.src).toContain('/storyMedia/7');
        expect(photo.alt).toBe('wet leaves');
        expect(labelPreview.src).toContain('/cropImage/SurfaceProblem/501');
        expect(none.tagName).toBe('SPAN');
        expect(none.className).toContain('ud-story-thumb--none');
    });

    it('hands the story, the backend cap, and the label type\'s phrasing to the composer', async () => {
        await renderSection();

        document.querySelector('.ud-story-edit').click();

        expect(composer.setCopyVariant).toHaveBeenCalledWith(true);
        expect(composer.openForEdit).toHaveBeenCalledWith(expect.objectContaining({ story_id: 11 }), 1200);
    });

    it('passes a positive access feature\'s phrasing through unchanged', async () => {
        stories = [story({ label_type: 'CurbRamp', is_access_problem: false })];
        await renderSection();

        document.querySelector('.ud-story-edit').click();

        expect(composer.setCopyVariant).toHaveBeenCalledWith(false);
    });

    it('re-fetches the list on the story-changed signal, so an edited story\'s row shows the new text', async () => {
        await renderSection();
        stories = [story({ text: 'Now repaved.' })];

        // What StoryComposer emits after a successful save — from this list's composer or the label popup's.
        document.dispatchEvent(new CustomEvent('ps:story:changed', { detail: { storyId: 11 } }));
        await flush();

        expect(document.querySelector('.ud-story-text').textContent).toBe('Now repaved.');
    });

    it('returns focus to the edited row\'s Edit button once the re-render detaches the old one', async () => {
        await renderSection();

        // After a save the composer dialog closes and the re-render replaces the row, dropping focus to <body>;
        // only then does the section repair it (a save from the popup's composer keeps focus in the popup).
        document.dispatchEvent(new CustomEvent('ps:story:changed', { detail: { storyId: 11 } }));
        await flush();

        expect(document.activeElement).toBe(document.querySelector('.ud-story-edit'));
    });

    it('still lists stories when no composer dialog is on the page, minus the Edit control', async () => {
        await renderSection({ composerDialog: null });

        expect(rows()).toHaveLength(1);
        expect(firstRowControls()).toEqual(['ud-story-delete']);
    });

    it('confirms before deleting, and leaves the story alone when the author backs out', async () => {
        confirmResult = false;
        await renderSection();

        await document.querySelector('.ud-story-delete').click();

        expect(window.ConfirmDialog.confirm).toHaveBeenCalled();
        expect(window.fetch).not.toHaveBeenCalledWith(expect.anything(), { method: 'DELETE' });
        expect(rows()).toHaveLength(1);
    });

    it('retracts the story once confirmed, and drops its row', async () => {
        await renderSection();

        document.querySelector('.ud-story-delete').click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(window.fetch).toHaveBeenCalledWith('/userapi/stories/11', { method: 'DELETE' });
        expect(rows()).toHaveLength(0);
        expect(document.querySelector('.ud-nudge').textContent).toBe('dashboard:stories.none');
    });
});
