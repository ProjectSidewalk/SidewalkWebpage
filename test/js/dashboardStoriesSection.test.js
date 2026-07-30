/**
 * Tests for the "Your stories" list on the user dashboard (public/js/user-dashboard/StoriesSection.js, issues #4054
 * and #4656).
 *
 * Two contracts matter here beyond rendering: an author can edit a story from the list (the row's Edit hands the
 * story to the shared StoryComposer, with the character cap and problem-vs-feature phrasing taken from the payload
 * rather than re-derived here), and Delete is a hard, unrecoverable retraction — so it must never fire without a
 * confirmation.
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
        created_at: '2026-07-01T12:00:00Z', media: null, ...overrides,
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

    it('re-fetches the list after a save, so an edited story\'s row shows the new text', async () => {
        await renderSection();
        stories = [story({ text: 'Now repaved.' })];

        composer.opts.onSubmitted();
        await Promise.resolve();
        await Promise.resolve();

        expect(document.querySelector('.ud-story-text').textContent).toBe('Now repaved.');
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
