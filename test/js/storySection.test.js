/**
 * Tests for StorySection, the lived-experience stories disclosure on the label card (#4054): which share button a
 * label gets, how each story row reads, the author's own edit and delete, the photo lightbox, the reopen after a
 * sign-in bounce, and the story-anchored deep link (#4722), where the first render containing the linked story opens
 * the disclosure, highlights the row and scrolls it into view exactly once. The composer is a stand-in that records
 * what the section asks of it; its own behavior is storyComposer.test.js's. (#5840)
 */

import { loadModules, mockModule } from './loader.js';
import { flush, routeFetch, sentRequests, textOf } from './support/routeFetch.js';
import { confirmDialog, installDialogs, storiesMarkup } from './support/storyHarness.js';

mockModule('i18next', () => ({ default: { t: (key) => key, language: 'en' } }));

/** What the section asked of its composer. */
let composer;

mockModule('frontend/js/common/label-detail/StoryComposer.js', () => ({
  StoryComposer: class {
    constructor(dialog, opts) { composer.opts = opts; }
    open(...args) { composer.opened.push(args); }
    openForEdit(...args) { composer.edited.push(args); }
    setCopyVariant(impact) { composer.variants.push(impact); }
    setLabelType(name) { composer.labelTypes.push(name); }
  },
}));

/**
 * One story, shaped like an entry from GET /label/:labelId/stories (StoryForView).
 * @param {object} [overrides] - Fields to replace.
 * @returns {Record<string, any>} The story.
 */
function story(overrides = {}) {
  return {
    story_id: 11, label_id: 1, text: 'The cracked panel here tips my chair.', display_name: null, is_own: false,
    hidden: false, created_at: '2026-07-01T12:00:00Z', media: null, ...overrides,
  };
}

/** A story photo, as StoryFormats.mediaToJson sends it. */
const MEDIA = {
  story_media_id: 41, media_type: 'image', mime_type: 'image/jpeg', url: 'https://media.test/41.jpg',
  width: 800, height: 600, alt_text: 'A lifted sidewalk panel',
};

let StorySection;
/** The stories the endpoint answers with; a test reassigns it. */
let stories;
let fetchStub;

/**
 * @param {string} part - The class suffix after `label-detail__`.
 * @returns {HTMLElement} That element of the card.
 */
const $ = (part) => document.querySelector(`.label-detail__${part}`);
/** @returns {HTMLElement[]} The rendered story rows. */
const rows = () => [...document.querySelectorAll('.label-detail__story')];
/** @returns {HTMLDetailsElement} The disclosure. */
const details = () => /** @type {HTMLDetailsElement} */ ($('stories-details'));
/** @returns {HTMLElement} The share button inside the disclosure's summary. */
const summaryShare = () => document.querySelector('.label-detail__stories-summary .label-detail__story-share');
/** @returns {?HTMLElement} The highlighted row, or null. */
const linkedRow = () => document.querySelector('.label-detail__story--linked');

/**
 * Builds the section against a fresh card, the way LabelDetail does.
 * @param {object} [opts] - Constructor options beyond LabelDetail's defaults.
 * @returns {object} The section.
 */
function mount(opts = {}) {
  document.body.innerHTML = storiesMarkup();
  return new StorySection(document.getElementById('root'), { currUsername: null, highlightStoryId: null, ...opts });
}

/**
 * Builds the section and shows label 1, once its stories have loaded.
 * @param {object} [opts] - Constructor options.
 * @returns {Promise<object>} The section.
 */
async function renderSection(opts = {}) {
  const section = mount(opts);
  section.setLabel(1, null);
  await flush();
  return section;
}

beforeEach(async () => {
  ({ StorySection } = await loadModules('frontend/js/common/label-detail/StorySection.js'));
  composer = { opts: null, opened: [], edited: [], variants: [], labelTypes: [] };
  installDialogs();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }); // No reduced-motion preference.
  window.HTMLElement.prototype.scrollIntoView = vi.fn(); // jsdom doesn't implement it.
  window.logWebpageActivity = vi.fn();
  stories = [story()];
  fetchStub = routeFetch({
    '/label/': () => ({ max_text_length: 500, access_impact: 'problem', stories }),
    'DELETE /userapi/stories/': {},
  });
});

describe('a label with no stories', () => {
  test('hides the section and invites a story from the footer instead', async () => {
    stories = [];
    await renderSection();
    expect($('stories').hidden).toBe(true);
    expect($('story-share--footer').hidden).toBe(false);
    expect($('stories-count').hidden).toBe(true);
    expect(details().open).toBe(false);
  });

  test('the footer pill opens the composer with the cap from the stories reply', async () => {
    stories = [];
    await renderSection();
    $('story-share--footer').click();
    expect(composer.opened).toEqual([[1, 500]]);
  });

  test('if the stories can\'t load, the footer pill still offers sharing', async () => {
    routeFetch({ '/label/': { status: 500 } });
    await renderSection();
    expect($('stories').hidden).toBe(true);
    expect($('story-share--footer').hidden).toBe(false);
    expect(composer.variants).toEqual([]);
  });

  test('a dropped connection is reported, and the footer pill stays', async () => {
    routeFetch({ '/label/': new TypeError('Failed to fetch') });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await renderSection();
    expect(consoleError).toHaveBeenCalledWith(expect.any(TypeError));
    expect($('story-share--footer').hidden).toBe(false);
  });
});

describe('a label with stories', () => {
  test('shows the section open, with the count, and hides the footer pill', async () => {
    stories = [story({ story_id: 11 }), story({ story_id: 12 })];
    await renderSection();
    expect(sentRequests(fetchStub)[0].url).toBe('/label/1/stories');
    expect($('stories').hidden).toBe(false);
    expect($('story-share--footer').hidden).toBe(true);
    expect($('stories-count').textContent).toBe('2');
    expect($('stories-count').hidden).toBe(false);
    expect(details().open).toBe(true);
    expect(summaryShare().hidden).toBe(false);
  });

  test('passes the label\'s access impact to the composer, so its wording fits a problem or a feature', async () => {
    routeFetch({ '/label/': { max_text_length: 500, access_impact: 'feature', stories: [] } });
    await renderSection();
    expect(composer.variants).toEqual(['feature']);
  });

  test('the summary\'s share button opens the composer without toggling the disclosure', async () => {
    await renderSection();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    summaryShare().dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(composer.opened).toEqual([[1, 500]]);
    expect(details().open).toBe(true);
  });

  test('expanding the disclosure by hand is logged, collapsing it is not', async () => {
    stories = [];
    await renderSection();
    $('stories-summary').click();
    expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=StorySectionExpand_labelId=1');

    window.logWebpageActivity.mockClear();
    details().open = true;
    $('stories-summary').click();
    expect(window.logWebpageActivity).not.toHaveBeenCalled();
  });

  test('a reply for a label the card has since left is dropped', async () => {
    let answerFirst;
    routeFetch({
      '/label/1/': () => new Promise((resolve) => { answerFirst = resolve; }),
      '/label/2/': { max_text_length: 500, access_impact: 'problem', stories: [story({ story_id: 22 })] },
    });
    const section = mount();
    section.setLabel(1, null);
    section.setLabel(2, null);
    await flush();
    answerFirst({ max_text_length: 500, access_impact: 'problem', stories: [story({ story_id: 11 })] });
    await flush();
    expect(rows().map((r) => r.dataset.storyId)).toEqual(['22']);
  });

  test('moving to another label clears the old list straight away', async () => {
    const section = await renderSection();
    routeFetch({ '/label/': () => new Promise(() => {}) });
    section.setLabel(2, null);
    expect(rows()).toEqual([]);
    expect($('stories').hidden).toBe(true);
    expect(details().open).toBe(false);
  });

  test('the label type rides down to the composer, so its title can name the label', async () => {
    const section = mount();
    section.setLabel(1, 'Missing Curb Ramp');
    await flush();
    // A host that withholds the name (Other / Can't See the Sidewalk) leaves the composer on generic wording.
    section.setLabel(2, null);
    expect(composer.labelTypes).toEqual(['Missing Curb Ramp', null]);
  });
});

describe('a story row', () => {
  test('shows the text, an anonymous byline and the posting date', async () => {
    await renderSection();
    const [row] = rows();
    expect(textOf(row.querySelector('.label-detail__story-text'))).toBe('The cracked panel here tips my chair.');
    expect(textOf(row.querySelector('.label-detail__story-byline'))).toBe('labelmap:story.anonymous · Jul 1, 2026');
    expect(row.querySelector('.label-detail__story-photo-btn')).toBeNull();
    expect(row.querySelector('.label-detail__story-delete')).toBeNull();
  });

  test('names the author who chose to post under their username', async () => {
    stories = [story({ display_name: 'wheelie' })];
    await renderSection();
    expect(document.querySelector('.label-detail__story-who').textContent).toBe('wheelie');
  });

  test('story text is shown as text, never as markup', async () => {
    stories = [story({ text: '<img src=x onerror=alert(1)>' })];
    await renderSection();
    expect(document.querySelector('.label-detail__story-text img')).toBeNull();
    expect(document.querySelector('.label-detail__story-text').textContent).toBe('<img src=x onerror=alert(1)>');
  });

  test('a photo with a description shows as a thumbnail the description names', async () => {
    stories = [story({ media: MEDIA })];
    await renderSection();
    const btn = document.querySelector('.label-detail__story-photo-btn');
    const img = btn.querySelector('img');
    expect(btn.getAttribute('aria-label')).toBe('labelmap:story.enlarge-photo: A lifted sidewalk panel');
    expect(img.getAttribute('src')).toBe(MEDIA.url);
    expect(img.alt).toBe('A lifted sidewalk panel');
    expect(img.loading).toBe('lazy');
  });

  test('clicking a thumbnail enlarges the photo with its description as the caption', async () => {
    stories = [story({ media: MEDIA })];
    await renderSection();
    document.querySelector('.label-detail__story-photo-btn').click();

    const lightbox = /** @type {HTMLDialogElement} */ (document.querySelector('.story-lightbox'));
    expect(lightbox.open).toBe(true);
    expect(document.querySelector('.story-lightbox__img').getAttribute('src')).toBe(MEDIA.url);
    expect(document.querySelector('.story-lightbox__img').alt).toBe('A lifted sidewalk panel');
    expect(document.querySelector('.story-lightbox__caption').textContent).toBe('A lifted sidewalk panel');
    expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=StoryPhotoEnlarge_storyMediaId=41');

    document.querySelector('.story-lightbox__close').click();
    expect(lightbox.open).toBe(false);
  });

  test('a photo without a description still gets a usable name and caption', async () => {
    stories = [story({ media: { ...MEDIA, alt_text: null } })];
    await renderSection();
    const btn = document.querySelector('.label-detail__story-photo-btn');
    expect(btn.getAttribute('aria-label')).toBe('labelmap:story.enlarge-photo');
    expect(btn.querySelector('img').alt).toBe('');
    btn.click();
    expect(document.querySelector('.story-lightbox__img').alt).toBe('');
    expect(document.querySelector('.story-lightbox__caption').textContent)
      .toBe('labelmap:story.no-photo-description');
  });

  test('a story moderators hid is marked for its author', async () => {
    stories = [story({ is_own: true, hidden: true })];
    await renderSection();
    const [row] = rows();
    expect(row.classList.contains('label-detail__story--hidden')).toBe(true);
    expect(row.querySelector('.label-detail__story-chip--hidden').textContent).toBe('labelmap:story.hidden-chip');
  });
});

describe('the viewer\'s own story', () => {
  beforeEach(() => {
    stories = [story({ is_own: true }), story({ story_id: 12 })];
  });

  test('is marked as theirs, with edit, delete and a link to all their stories', async () => {
    await renderSection();
    const [own, other] = rows();
    expect(own.querySelector('.label-detail__story-chip--own').textContent).toBe('labelmap:story.your-story-chip');
    expect(own.querySelector('.label-detail__story-dashboard-link').getAttribute('href'))
      .toBe('/dashboard#your-stories');
    expect(other.querySelector('.label-detail__story-edit')).toBeNull();
    expect(own.classList.contains('label-detail__story--hidden')).toBe(false);
  });

  test('replaces the share button: one story per person per label, so editing is the way to change it',
    async () => {
      await renderSection();
      expect(summaryShare().hidden).toBe(true);
    });

  test('Edit opens the composer on that story', async () => {
    await renderSection();
    document.querySelector('.label-detail__story-edit').click();
    expect(composer.edited).toEqual([[stories[0], 500]]);
  });

  test('following the dashboard link is logged', async () => {
    await renderSection();
    const link = document.querySelector('.label-detail__story-dashboard-link');
    link.addEventListener('click', (e) => e.preventDefault()); // jsdom can't navigate.
    link.click();
    expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=StoryDashboardLink_labelId=1');
  });

  test('Delete asks first, and keeping the story sends nothing', async () => {
    await renderSection();
    confirmDialog.mockResolvedValueOnce(false);
    document.querySelector('.label-detail__story-delete').click();
    await flush();
    expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      message: 'labelmap:story.delete-confirm', danger: true,
    }));
    expect(sentRequests(fetchStub).filter((r) => r.method === 'DELETE')).toEqual([]);
  });

  test('a confirmed delete removes the story, says so, reloads the list and tells the rest of the page',
    async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      const changed = vi.fn();
      document.addEventListener('ps:story:changed', changed);
      mount().setLabel(1, null);
      await vi.advanceTimersByTimeAsync(0);
      stories = [story({ story_id: 12 })];
      document.querySelector('.label-detail__story-delete').click();
      await vi.advanceTimersByTimeAsync(0);

      expect(sentRequests(fetchStub).filter((r) => r.method === 'DELETE').map((r) => r.url))
        .toEqual(['/userapi/stories/11']);
      expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=StoryDeleteClient_storyId=11');
      expect($('story-status').textContent).toBe('labelmap:story.deleted');
      expect(changed.mock.calls[0][0].detail).toEqual({ storyId: 11 });
      expect(rows().map((r) => r.dataset.storyId)).toEqual(['12']);

      // The announcement clears itself, so a later one is read out afresh.
      await vi.advanceTimersByTimeAsync(4000);
      expect($('story-status').textContent).toBe('');
      document.removeEventListener('ps:story:changed', changed);
    });

  test('a delete the server refuses is reported and the story stays', async () => {
    routeFetch({
      '/label/': { max_text_length: 500, access_impact: 'problem', stories },
      'DELETE /userapi/stories/': { status: 403 },
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await renderSection();
    document.querySelector('.label-detail__story-delete').click();
    await flush();
    expect(consoleError).toHaveBeenCalledWith(new Error('HTTP 403'));
    expect($('story-status').textContent).toBe('');
    expect(rows()).toHaveLength(2);
  });
});

describe('after the composer saves', () => {
  test.each([
    [false, 'labelmap:story.submitted'],
    [true, 'labelmap:story.updated'],
  ])('an edit=%s save is announced, opens the disclosure, and reloads the list', async (edited, announcement) => {
    stories = [];
    await renderSection();
    stories = [story()];
    composer.opts.onSubmitted(edited);
    expect($('story-status').textContent).toBe(announcement);
    await flush();
    expect(details().open).toBe(true);
    expect(rows()).toHaveLength(1);
  });

  test('the composer is told who the viewer is, for its post-as choice', () => {
    mount({ currUsername: 'mikey' });
    expect(composer.opts.currUsername).toBe('mikey');
  });
});

describe('coming back from sign-in', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  test('reopens the composer for the label the draft was for, and drops the marker from the address', async () => {
    window.history.replaceState(null, '', '/label/1?resumeStory=1&storyId=4#top');
    stories = [];
    await renderSection();
    expect(composer.opened).toEqual([[1, null]]);
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`)
      .toBe('/label/1?storyId=4#top');
  });

  test('a marker for another label leaves the composer closed', async () => {
    window.history.replaceState(null, '', '/label/1?resumeStory=2');
    await renderSection();
    expect(composer.opened).toEqual([]);
    expect(window.location.search).toBe('?resumeStory=2');
  });
});

describe('the story deep link (#4722)', () => {
  test('every story row carries its story id as the deep-link anchor', async () => {
    stories = [story({ story_id: 11 }), story({ story_id: 12 })];
    await renderSection();
    expect(rows().map((r) => r.dataset.storyId)).toEqual(['11', '12']);
    expect(linkedRow()).toBeNull(); // No deep link, no highlight.
  });

  test('the linked story is highlighted, its disclosure opened, and scrolled into view', async () => {
    stories = [story({ story_id: 11 }), story({ story_id: 12 })];
    await renderSection({ highlightStoryId: 12 });

    const row = linkedRow();
    expect(row).not.toBeNull();
    expect(row.dataset.storyId).toBe('12');
    expect(details().open).toBe(true);
    const scroll = window.HTMLElement.prototype.scrollIntoView;
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    expect(scroll.mock.contexts[0]).toBe(row); // It's the linked row that scrolled, not the list.
  });

  test('honors prefers-reduced-motion by scrolling without animation', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
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
