/** Tests for the admin stories moderation queue: what each row shows and what Hide and Delete send (#5840). */

import { loadModules, mockModule } from './loader.js';
import { routeFetch, flush, textOf } from './support/routeFetch.js';

const ConfirmDialog = { confirm: vi.fn() };
mockModule('frontend/js/common/ConfirmDialog.js', () => ({ ConfirmDialog }));

const { StoriesPage } = await loadModules('frontend/js/admin-dashboard/StoriesPage.js');

const FEED = '/adminapi/stories?n=200';

/** One StoryForAdmin payload, visible and photoless unless overridden. */
function story(overrides = {}) {
  return {
    story_id: 11,
    label_id: 501,
    label_type: 'NoCurbRamp',
    user_id: 'u1',
    username: 'ada lovelace',
    text: 'I have to roll into the street here.',
    display_name_mode: 'username',
    hidden: false,
    moderated_by: null,
    moderated_at: null,
    created_at: '2026-09-01T12:00:00Z',
    media: null,
    ...overrides,
  };
}

/**
 * Builds the view's two containers, answers the feed, and starts the page.
 * @param {any} feedAnswer - What the feed endpoint answers; see routeFetch.
 * @param {Record<string, any>} [extraRoutes] - The moderation endpoints' answers.
 * @returns {Promise<{page: object, fetchStub: import('vitest').Mock}>}
 */
async function load(feedAnswer, extraRoutes = {}) {
  document.body.innerHTML = `
    <div class="coverage-status" id="stories-status" role="status" aria-live="polite">Loading stories…</div>
    <div class="stories-queue" id="stories-queue"></div>`;
  const fetchStub = routeFetch({ [FEED]: feedAnswer, ...extraRoutes });
  const page = new StoriesPage({ feedUrl: FEED });
  page.init();
  await flush();
  return { page, fetchStub };
}

const status = () => document.getElementById('stories-status').textContent;
const rows = () => [...document.querySelectorAll('.stories-queue-row')];

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  ConfirmDialog.confirm = vi.fn(() => Promise.resolve(true));
});

describe('the queue summary', () => {
  test('counts the stories and how many are hidden', async () => {
    await load({ stories: [story(), story({ story_id: 12, hidden: true })] });
    expect(status()).toBe('2 stories · 1 hidden · newest first');
    expect(rows()).toHaveLength(2);
  });

  test('uses the singular for one story', async () => {
    await load({ stories: [story()] });
    expect(status()).toBe('1 story · 0 hidden · newest first');
  });

  test('says there are none rather than showing an empty table', async () => {
    await load({ stories: [] });
    expect(status()).toBe('No stories yet.');
    expect(rows()).toHaveLength(0);
  });

  test('says the load failed on a server error', async () => {
    await load({ status: 500 });
    expect(status()).toBe('Could not load stories. Reload to try again.');
  });

  test('says the load failed when the request never reaches the server', async () => {
    await load(new TypeError('Failed to fetch'));
    expect(status()).toBe('Could not load stories. Reload to try again.');
  });
});

describe('a story row', () => {
  test('links the author and says what name the public sees', async () => {
    await load({ stories: [story(), story({ story_id: 12, username: 'bo', display_name_mode: 'anonymous' })] });
    const [named, anon] = rows();
    expect(named.querySelector('.stories-queue-who a').getAttribute('href')).toBe('/admin/user/ada%20lovelace');
    expect(textOf(named.querySelector('.stories-queue-public-as'))).toBe('shows publicly as: ada lovelace');
    expect(textOf(anon.querySelector('.stories-queue-public-as'))).toBe('shows publicly as: Anonymous');
  });

  test('shows story text as plain text, never as markup', async () => {
    await load({ stories: [story({ text: '<img src=x onerror=alert(1)>' })] });
    const text = rows()[0].querySelector('.stories-queue-text');
    expect(text.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(text.querySelector('img')).toBeNull();
  });

  test('names the label and only mentions moderation once it has happened', async () => {
    await load({ stories: [story(), story({ story_id: 12, moderated_at: '2026-09-02T12:00:00Z' })] });
    const [fresh, moderated] = rows().map((r) => r.querySelector('.stories-queue-meta'));
    expect(fresh.querySelector('a').textContent).toBe('NoCurbRamp #501');
    expect(fresh.querySelector('a').getAttribute('href')).toBe('/admin/label/501');
    expect(fresh.textContent).not.toContain('last moderated');
    expect(moderated.textContent).toContain('last moderated');
  });

  test('shows a photo with its alt text, or a stand-in when the author gave none', async () => {
    await load({ stories: [
      story({ media: { url: 'https://cdn.example/a.jpg', alt_text: 'A curb with no ramp' } }),
      story({ story_id: 12, media: { url: 'https://cdn.example/b.jpg', alt_text: null } }),
      story({ story_id: 13 }),
    ] });
    const [withAlt, noAlt, noPhoto] = rows().map((r) => r.querySelector('.stories-queue-media img'));
    expect(withAlt.getAttribute('src')).toBe('https://cdn.example/a.jpg');
    expect(withAlt.alt).toBe('A curb with no ramp');
    expect(noAlt.alt).toBe('Story photo (no description)');
    expect(noPhoto).toBeNull();
  });

  test('marks a hidden story and offers Unhide; a visible one offers Hide', async () => {
    await load({ stories: [story({ hidden: true }), story({ story_id: 12 })] });
    const [hidden, shown] = rows();
    expect(hidden.classList.contains('stories-queue-row--hidden')).toBe(true);
    expect(hidden.querySelector('.stories-queue-chip').hidden).toBe(false);
    expect(hidden.querySelector('.stories-queue-btn').textContent).toBe('Unhide');
    expect(shown.classList.contains('stories-queue-row--hidden')).toBe(false);
    expect(shown.querySelector('.stories-queue-chip').hidden).toBe(true);
    expect(shown.querySelector('.stories-queue-btn').textContent).toBe('Hide');
  });
});

describe('the label link', () => {
  test('opens the label popup in place once one is ready', async () => {
    const { page } = await load({ stories: [story()] });
    const popup = { showLabel: vi.fn() };
    page.setLabelPopup(popup);
    const event = new MouseEvent('click', { cancelable: true });
    rows()[0].querySelector('.stories-queue-meta a').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(popup.showLabel).toHaveBeenCalledWith(501, 'AdminStories');
  });

  test('falls back to following the link when no popup is ready', async () => {
    await load({ stories: [story()] });
    // Notes whether the page stopped the link, then stops it here, since jsdom can't follow it.
    let followed;
    document.addEventListener('click', (e) => {
      followed = !e.defaultPrevented;
      e.preventDefault();
    }, { once: true });
    rows()[0].querySelector('.stories-queue-meta a').dispatchEvent(new MouseEvent('click', { bubbles: true,
      cancelable: true }));
    expect(followed).toBe(true);
  });
});

describe('hiding a story', () => {
  test('sends the new state and flips the row once the server agrees', async () => {
    const { fetchStub } = await load({ stories: [story()] }, { '/adminapi/stories/11/visibility': { success: true } });
    const button = rows()[0].querySelector('.stories-queue-btn');
    button.click();
    expect(button.disabled).toBe(true);
    await flush();

    const [url, opts] = fetchStub.mock.calls.at(-1);
    expect(url).toBe('/adminapi/stories/11/visibility');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body)).toEqual({ hidden: true });
    expect(button.textContent).toBe('Unhide');
    expect(button.disabled).toBe(false);
    expect(rows()[0].classList.contains('stories-queue-row--hidden')).toBe(true);

    button.click();
    await flush();
    expect(JSON.parse(fetchStub.mock.calls.at(-1)[1].body)).toEqual({ hidden: false });
    expect(button.textContent).toBe('Hide');
  });

  test('leaves the row as it was when the server refuses, and frees the button', async () => {
    await load({ stories: [story()] }, { '/adminapi/stories/11/visibility': { status: 403 } });
    const button = rows()[0].querySelector('.stories-queue-btn');
    button.click();
    await flush();
    expect(button.textContent).toBe('Hide');
    expect(button.disabled).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('deleting a story', () => {
  const deleteButton = () => rows()[0].querySelector('.stories-queue-btn--danger');

  test('asks first, then deletes and drops the row', async () => {
    const { fetchStub } = await load({ stories: [story()] }, { '/adminapi/stories/11': { success: true } });
    deleteButton().click();
    await flush();
    expect(ConfirmDialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true }));
    expect(fetchStub).toHaveBeenLastCalledWith('/adminapi/stories/11', { method: 'DELETE' });
    expect(rows()).toHaveLength(0);
  });

  test('does nothing when the admin cancels', async () => {
    ConfirmDialog.confirm = vi.fn(() => Promise.resolve(false));
    const { fetchStub } = await load({ stories: [story()] });
    deleteButton().click();
    await flush();
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(1);
  });

  test('keeps the row when the delete fails', async () => {
    await load({ stories: [story()] }, { '/adminapi/stories/11': { status: 500 } });
    deleteButton().click();
    await flush();
    expect(rows()).toHaveLength(1);
    expect(console.error).toHaveBeenCalled();
  });
});
