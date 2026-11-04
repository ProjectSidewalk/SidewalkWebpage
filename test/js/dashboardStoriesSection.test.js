/**
 * Tests for the "Your stories" list on the user dashboard (frontend/js/user-dashboard/StoriesSection.js, issues #4054
 * and #4656).
 *
 * Two contracts matter here beyond rendering: an author can edit a story from the list (the row's Edit hands the
 * story to the shared StoryComposer, with the character cap and problem-vs-feature phrasing taken from the payload
 * rather than re-derived here), and Delete is a hard, unrecoverable retraction — so it must never fire without a
 * confirmation. The list refreshes on the page-level `ps:story:changed` signal (emitted by StoryComposer and the
 * label card's own delete path), which also repairs the focus the re-render drops.
 */

import { loadModules, mockModule } from './loader.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

let composer;
let confirmResult;

// Records what the section asks of the shared composer; behavior itself is StoryComposer's own contract.
mockModule('frontend/js/common/label-detail/StoryComposer.js', () => ({
  StoryComposer: class {
    constructor(dialog, opts) {
      composer = this;
      this.dialog = dialog;
      this.opts = opts;
      this.setCopyVariant = vi.fn();
      this.openForEdit = vi.fn();
    }
  },
}));
const confirmDialog = { confirm: vi.fn(() => Promise.resolve(confirmResult)) };
mockModule('frontend/js/common/ConfirmDialog.js', () => ({ ConfirmDialog: confirmDialog }));

/** One story payload, shaped like an entry from GET /userapi/stories/mine. */
function story(overrides = {}) {
  return {
    story_id: 11, label_id: 501, label_type: 'SurfaceProblem', access_impact: 'problem',
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

  let stories;
  let StoriesSection;

  /** Drains the microtask queue (a macrotask runs after all pending promise continuations). */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  /**
     * Renders the section against the stubbed payload.
     * @param {object} [opts] - Overrides for the StoriesSection options (e.g. composerDialog: null).
     * @returns {Promise<StoriesSection>} The rendered section.
     */
  async function renderSection(opts = {}) {
    document.body.innerHTML = '<div id="ud-stories"></div><dialog id="ud-story-composer"></dialog>';
    const section = new StoriesSection(document.getElementById('ud-stories'), {
      labelPopup: null,
      composerDialog: document.getElementById('ud-story-composer'),
      currUsername: 'ada',
      storiesUrl: '/userapi/stories/mine',
      storyUrlFor: (storyId) => `/userapi/stories/${storyId}`,
      ...opts,
    });
    await section.render();
    return section;
  }

  beforeAll(async () => {
    ({ StoriesSection } = await loadModules('frontend/js/user-dashboard/StoriesSection.js'));
  });

  beforeEach(() => {
    composer = null;
    confirmResult = true;
    stories = [story()];
    confirmDialog.confirm.mockClear();
    window.fetch = vi.fn((url, init) => {
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

    expect(composer.setCopyVariant).toHaveBeenCalledWith('problem');
    expect(composer.openForEdit).toHaveBeenCalledWith(expect.objectContaining({ story_id: 11 }), 1200);
  });

  it('passes a positive access feature\'s phrasing through unchanged', async () => {
    stories = [story({ label_type: 'CurbRamp', access_impact: 'feature' })];
    await renderSection();

    document.querySelector('.ud-story-edit').click();

    expect(composer.setCopyVariant).toHaveBeenCalledWith('feature');
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

    expect(confirmDialog.confirm).toHaveBeenCalled();
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

  it('marks a story moderators hid, so its author can see why it is not public', async () => {
    stories = [story({ hidden: true }), story({ story_id: 12 })];
    await renderSection();

    const [hidden, shown] = rows();
    expect(hidden.classList.contains('ud-story-row--hidden')).toBe(true);
    expect(hidden.querySelector('.ud-story-chip').textContent).toBe('labelmap:story.hidden-chip');
    expect(shown.classList.contains('ud-story-row--hidden')).toBe(false);
    expect(shown.querySelector('.ud-story-chip')).toBeNull();
  });

  it('swaps a thumbnail that fails to load for the empty placeholder', async () => {
    stories = [story({ label_image_url: '/cropImage/SurfaceProblem/501?exp=1&sig=x' })];
    await renderSection();

    document.querySelector('img.ud-story-thumb').dispatchEvent(new Event('error'));

    expect(document.querySelector('img.ud-story-thumb')).toBeNull();
    expect(document.querySelector('.ud-story-thumb--none')).not.toBeNull();
  });

  it('opens the label in the dashboard\'s popup when there is one', async () => {
    const labelPopup = { showLabel: vi.fn() };
    await renderSection({ labelPopup });

    const link = document.querySelector('.ud-story-meta a');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);

    expect(labelPopup.showLabel).toHaveBeenCalledWith(501, 'DashboardStories');
    expect(click.defaultPrevented).toBe(true);
  });

  it('lets the label link go to the label page when there is no popup', async () => {
    await renderSection();

    const link = document.querySelector('.ud-story-meta a');
    let leftToBrowser = null;
    // Runs after the section's handler: notes whether the browser would follow the link, then stops jsdom trying.
    document.addEventListener('click', (e) => {
      leftToBrowser = !e.defaultPrevented;
      e.preventDefault();
    }, { once: true });
    link.click();

    expect(link.getAttribute('href')).toBe('/label/501');
    expect(leftToBrowser).toBe(true);
  });

  it('logs and shows nothing when the list fails to load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }));

    await renderSection();

    expect(rows()).toHaveLength(0);
    expect(error).toHaveBeenCalledWith('Stories section failed to load.', expect.any(Error));
  });

  it('keeps the row when the server refuses the delete', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await renderSection();
    window.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 403 }));

    document.querySelector('.ud-story-delete').click();
    await flush();

    expect(rows()).toHaveLength(1);
    expect(error).toHaveBeenCalledWith('Story delete failed.', expect.any(Error));
  });

  it('keeps the other stories, and no empty-state nudge, after deleting one of several', async () => {
    stories = [story(), story({ story_id: 12 })];
    await renderSection();

    document.querySelector('.ud-story-delete').click();
    await flush();

    expect(rows().map((r) => r.dataset.storyId)).toEqual(['12']);
    expect(document.querySelector('.ud-nudge')).toBeNull();
  });

  it('refreshes on a brand-new story without grabbing focus for any row', async () => {
    await renderSection();
    stories = [story({ story_id: 12, text: 'Just posted.' }), story()];

    document.dispatchEvent(new CustomEvent('ps:story:changed', { detail: {} }));
    await flush();

    expect(rows()).toHaveLength(2);
    expect(document.activeElement).toBe(document.body);
  });

  it('leaves focus where the label popup put it after a save made there', async () => {
    await renderSection();
    document.body.insertAdjacentHTML('beforeend', '<button id="popup-close">Close</button>');
    document.getElementById('popup-close').focus();

    document.dispatchEvent(new CustomEvent('ps:story:changed', { detail: { storyId: 11 } }));
    await flush();

    expect(document.activeElement).toBe(document.getElementById('popup-close'));
  });
});
