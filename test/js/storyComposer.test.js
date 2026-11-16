/**
 * Tests for StoryComposer, the dialog a viewer writes or edits a lived-experience story in (#4054): the counter and
 * phrasing, the photo and its description, the discard guard, what a new story and an in-place edit send, how a
 * refusal reads, and the draft a signed-out writer keeps across a sign-in. The title and the rate-limit wording have
 * suites of their own (storyComposerTitle, storyRateLimitMessage). (#5840)
 */

import { loadModules, mockModule } from './loader.js';
import { navigationAttempts } from './fakes.js';
import { flush, routeFetch, sentRequests } from './support/routeFetch.js';
import {
  composerMarkup, confirmDialog, fakeDraftStore, fakeFilePicker, fakeObjectUrls, installDialogs, photoFile,
} from './support/storyHarness.js';

/** The error keys the locale files carry; any other key the server sends has no translation. */
const TRANSLATED = new Set([
  'labelmap:story.error.text-too-long',
  'labelmap:story.error.already-exists',
]);

// Echo the key, with any interpolation, so a test can read which string was picked and what it was handed.
mockModule('i18next', () => ({ default: {
  language: 'en',
  t: (key, opts) => (opts ? `${key} ${JSON.stringify(opts)}` : key),
  exists: (key) => TRANSLATED.has(key),
} }));

let StoryComposer;
let urls;
let drafts;

/**
 * Builds a composer against a fresh copy of the dialog.
 * @param {object} [opts] - The constructor's options.
 * @returns {{composer: object, $: (part: string) => HTMLElement, picker: {pick: (file: ?File) => void}}} The
 *     composer, a lookup for its `story-composer__<part>` elements, and its file picker.
 */
function mount(opts = {}) {
  document.body.innerHTML = composerMarkup();
  const dialog = document.querySelector('.story-composer');
  const $ = (part) => dialog.querySelector(`.story-composer__${part}`);
  const picker = fakeFilePicker(/** @type {HTMLInputElement} */ ($('photo-input')));
  return { composer: new StoryComposer(dialog, opts), $, picker };
}

/** @returns {HTMLDialogElement} The composer's dialog. */
const dialog = () => document.querySelector('.story-composer');

/**
 * Types into the story box the way a keyboard does, so the counter and error react.
 * @param {HTMLElement} text - The story textarea.
 * @param {string} value - What the writer typed.
 */
function type(text, value) {
  /** @type {HTMLTextAreaElement} */ (text).value = value;
  text.dispatchEvent(new Event('input'));
}

/**
 * @param {import('vitest').Mock} fetchStub - From routeFetch.
 * @returns {Record<string, any>} The last request's form fields.
 */
const lastForm = (fetchStub) => Object.fromEntries(sentRequests(fetchStub).at(-1).body.entries());

/**
 * A story of the viewer's own, as the card's GET /label/:id/stories sends it (StoryForView).
 * @param {object} [overrides] - Fields to replace.
 * @returns {Record<string, any>} The story.
 */
function ownStory(overrides = {}) {
  return {
    story_id: 3, label_id: 7, text: 'The ramp floods every spring.', display_name: null, is_own: true,
    hidden: false, created_at: '2026-07-01T12:00:00Z', media: null, ...overrides,
  };
}

/** A story photo, as StoryFormats.mediaToJson sends it. */
const MEDIA = {
  story_media_id: 41, media_type: 'image', mime_type: 'image/jpeg', url: 'https://media.test/41.jpg',
  width: 800, height: 600, alt_text: 'Water pooled at the ramp',
};

beforeEach(async () => {
  ({ StoryComposer } = await loadModules('frontend/js/common/label-detail/StoryComposer.js'));
  installDialogs();
  urls = fakeObjectUrls();
  ({ drafts } = fakeDraftStore());
  window.logWebpageActivity = vi.fn();
});

describe('opening the composer', () => {
  test('starts empty, with the counter against the server cap, focused on the story box', async () => {
    const { composer, $ } = mount();
    await composer.open(7, 500);

    expect(dialog().open).toBe(true);
    expect($('text').value).toBe('');
    expect($('text').maxLength).toBe(500);
    expect($('counter').textContent).toBe('0 / 500');
    expect(document.activeElement).toBe($('text'));
    expect($('submit').textContent).toBe('labelmap:story.submit');
    expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=StoryComposerOpen_labelId=7');
  });

  test('before the cap is known, the counter shows a bare count', async () => {
    // The card can be opened before its /stories fetch lands, which is where the cap comes from.
    const { composer, $ } = mount();
    await composer.open(7, null);
    type($('text'), 'Hi');
    expect($('counter').textContent).toBe('2');
  });

  test('a signed-out viewer is offered sign-in instead of posting under a name', async () => {
    const { composer, $ } = mount({ currUsername: null });
    await composer.open(7, 500);
    expect($('name-username').closest('.story-composer__check-row').hidden).toBe(true);
    expect($('signin-cta').hidden).toBe(false);
  });

  test('a signed-in viewer can post under their username, which the option names', async () => {
    const { composer, $ } = mount({ currUsername: 'mikey' });
    await composer.open(7, 500);
    expect($('name-username').closest('.story-composer__check-row').hidden).toBe(false);
    expect($('username-option').textContent).toBe('mikey');
    expect($('signin-cta').hidden).toBe(true);
    expect($('name-anon').checked).toBe(true);
  });

  test('reopening clears what was left from last time', async () => {
    const { composer, $, picker } = mount({ currUsername: 'mikey' });
    await composer.open(7, 500);
    type($('text'), 'Half a thought');
    picker.pick(photoFile());
    $('name-username').checked = true;

    await composer.open(8, 500);
    expect($('text').value).toBe('');
    expect($('photo-preview').hidden).toBe(true);
    expect($('name-anon').checked).toBe(true);
  });

  test('two composers on one page keep separate radio groups and titles', () => {
    document.body.innerHTML = `${composerMarkup()}${composerMarkup()}`;
    const [a, b] = document.querySelectorAll('.story-composer');
    for (const d of [a, b]) {
      fakeFilePicker(d.querySelector('.story-composer__photo-input'));
      new StoryComposer(d, {});
    }
    const groupOf = (d) => d.querySelector('.story-composer__name-anon').name;
    expect(groupOf(a)).not.toBe(groupOf(b));
    expect(a.querySelector('.story-composer__name-username').name).toBe(groupOf(a));
    expect(a.getAttribute('aria-labelledby')).not.toBe(b.getAttribute('aria-labelledby'));
    expect(document.getElementById(a.getAttribute('aria-labelledby'))).toBe(a.querySelector('h3'));
  });
});

describe('the privacy note', () => {
  test('links to the dashboard where stories are managed', () => {
    const { $ } = mount();
    expect($('privacy').innerHTML).toBe('labelmap:story.privacy-note');
  });

  test('drops the link on the dashboard itself, which would point at the same page', () => {
    const { $ } = mount({ omitDashboardLink: true });
    expect($('privacy').textContent).toBe('labelmap:story.privacy-note-brief');
  });
});

describe('problem or feature phrasing', () => {
  test.each([
    ['feature', '-positive'],
    ['neutral', '-positive'],
    ['problem', ''],
    [null, ''],
  ])('a label whose access impact is %s gets the matching intro and placeholder', (impact, suffix) => {
    const { composer, $ } = mount();
    composer.setCopyVariant(impact);
    expect($('intro').textContent).toBe(`labelmap:story.composer-intro${suffix}`);
    expect($('text').placeholder).toBe(`labelmap:story.text-placeholder${suffix}`);
  });
});

describe('typing a story', () => {
  test('the counter follows the text, and typing clears an earlier error', async () => {
    const { composer, $ } = mount();
    await composer.open(7, 500);
    $('submit').click();
    expect($('error').hidden).toBe(false);

    type($('text'), 'Crack');
    expect($('counter').textContent).toBe('5 / 500');
    expect($('error').hidden).toBe(true);
  });

  test('with text typed, the first Escape only leaves the story box', async () => {
    const { composer, $ } = mount();
    await composer.open(7, 500);
    type($('text'), 'Something worth keeping');
    const dialogHeard = vi.fn();
    dialog().addEventListener('keydown', dialogHeard);

    const down = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    $('text').dispatchEvent(down);
    $('text').dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));

    expect(down.defaultPrevented).toBe(true);
    expect(dialogHeard).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe($('text'));
    expect(dialog().open).toBe(true);
  });

  test('in an empty story box, Escape goes straight to the dialog so one press closes it', async () => {
    const { composer, $ } = mount();
    await composer.open(7, 500);
    const down = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    $('text').dispatchEvent(down);
    $('text').dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
    expect(down.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe($('text'));
  });

  test('other keys in the story box are left alone', async () => {
    const { composer, $ } = mount();
    await composer.open(7, 500);
    type($('text'), 'Some text');
    const down = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    $('text').dispatchEvent(down);
    $('text').dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
    expect(down.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe($('text'));
  });
});

describe('adding a photo', () => {
  test('a picked image shows as a preview, and focus moves to its description', async () => {
    const { composer, $, picker } = mount();
    await composer.open(7, 500);
    picker.pick(photoFile());

    expect($('photo-preview').hidden).toBe(false);
    expect($('photo-attach').hidden).toBe(true);
    expect($('photo-thumb').getAttribute('src')).toBe([...urls.live][0]);
    expect(document.activeElement).toBe($('alt-input'));
  });

  test('a file that isn\'t an image is refused and cleared', async () => {
    const { composer, $, picker } = mount();
    await composer.open(7, 500);
    picker.pick(photoFile('notes.pdf', 'application/pdf'));

    expect($('error').textContent).toBe('labelmap:story.error.photo-invalid');
    expect($('error').hidden).toBe(false);
    expect($('photo-input').files).toHaveLength(0);
    expect($('photo-preview').hidden).toBe(true);
  });

  test('cancelling the file chooser changes nothing', async () => {
    const { composer, $, picker } = mount();
    await composer.open(7, 500);
    picker.pick(null);
    expect($('photo-preview').hidden).toBe(true);
    expect($('error').hidden).toBe(true);
  });

  test('picking a second photo replaces the first and frees its preview', async () => {
    const { composer, $, picker } = mount();
    await composer.open(7, 500);
    picker.pick(photoFile('one.jpg'));
    picker.pick(photoFile('two.jpg'));
    expect(urls.live.size).toBe(1);
    expect($('photo-thumb').getAttribute('src')).toBe([...urls.live][0]);
  });

  test('typing a description clears an earlier error', async () => {
    const { composer, $, picker } = mount();
    await composer.open(7, 500);
    picker.pick(photoFile('notes.pdf', 'application/pdf'));
    picker.pick(photoFile());
    $('submit').click(); // No text yet.
    expect($('error').hidden).toBe(false);
    $('alt-input').dispatchEvent(new Event('input'));
    expect($('error').hidden).toBe(true);
  });

  test('removing the photo brings back the attach button and empties the description', async () => {
    const { composer, $, picker } = mount();
    await composer.open(7, 500);
    picker.pick(photoFile());
    $('alt-input').value = 'A wide crack';
    $('photo-remove').click();

    expect($('photo-preview').hidden).toBe(true);
    expect($('photo-attach').hidden).toBe(false);
    expect($('photo-thumb').hasAttribute('src')).toBe(false);
    expect($('alt-input').value).toBe('');
    expect(urls.live.size).toBe(0);
    expect(document.activeElement).toBe($('photo-input'));
  });

  test('closing the dialog frees the preview', async () => {
    const { composer, picker } = mount();
    await composer.open(7, 500);
    picker.pick(photoFile());
    dialog().close();
    expect(urls.live.size).toBe(0);
  });
});

describe('closing with work in progress', () => {
  test('an untouched composer closes from Cancel or the X without asking', async () => {
    const { composer, $ } = mount();
    await composer.open(7, 500);
    type($('text'), '   '); // Whitespace isn't a story.
    $('cancel').click();
    await flush();
    expect(dialog().open).toBe(false);

    await composer.open(7, 500);
    $('close').click();
    await flush();
    expect(dialog().open).toBe(false);
    expect(confirmDialog).not.toHaveBeenCalled();
  });

  test('typed text asks before it is thrown away, and keeping it leaves the dialog open', async () => {
    const { composer, $ } = mount();
    await composer.open(7, 500);
    type($('text'), 'My chair tipped here.');
    confirmDialog.mockResolvedValueOnce(false);
    $('cancel').click();
    await flush();

    expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      message: 'labelmap:story.discard-confirm', danger: true,
    }));
    expect(dialog().open).toBe(true);
  });

  test('agreeing to discard closes the dialog', async () => {
    const { composer, $ } = mount();
    await composer.open(7, 500);
    type($('text'), 'My chair tipped here.');
    $('close').click();
    await flush();
    expect(dialog().open).toBe(false);
  });

  test('a picked photo alone counts as work worth asking about', async () => {
    const { composer, $, picker } = mount();
    await composer.open(7, 500);
    picker.pick(photoFile());
    $('cancel').click();
    await flush();
    expect(confirmDialog).toHaveBeenCalledTimes(1);
  });

  test('Escape on a pristine composer lets the browser close it', async () => {
    const { composer } = mount();
    await composer.open(7, 500);
    const cancel = new Event('cancel', { cancelable: true });
    dialog().dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(false);
    expect(confirmDialog).not.toHaveBeenCalled();
  });

  test('Escape with typed text holds the dialog open and asks first', async () => {
    const { composer, $ } = mount();
    await composer.open(7, 500);
    type($('text'), 'My chair tipped here.');
    const cancel = new Event('cancel', { cancelable: true });
    dialog().dispatchEvent(cancel);
    await flush();
    expect(cancel.defaultPrevented).toBe(true);
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(dialog().open).toBe(false);
  });
});

describe('publishing a new story', () => {
  test('an empty story is caught before anything is sent', async () => {
    const fetchStub = routeFetch({});
    const { composer, $ } = mount();
    await composer.open(7, 500);
    type($('text'), '  ');
    $('submit').click();
    await flush();

    expect($('error').textContent).toBe('labelmap:story.error.text-missing');
    expect(document.activeElement).toBe($('text'));
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test('sends the trimmed text anonymously, then closes and tells the host and the page', async () => {
    const fetchStub = routeFetch({ 'POST /userapi/stories': {} });
    const onSubmitted = vi.fn();
    const changed = vi.fn();
    document.addEventListener('ps:story:changed', changed);
    const { composer, $ } = mount({ currUsername: 'mikey', onSubmitted });
    await composer.open(7, 500);
    type($('text'), '  The ramp floods.  ');
    $('submit').click();
    await flush();

    expect(lastForm(fetchStub)).toEqual({ label_id: '7', text: 'The ramp floods.', display_name_mode: 'anonymous' });
    expect(dialog().open).toBe(false);
    expect(onSubmitted).toHaveBeenCalledWith(false);
    expect(changed.mock.calls[0][0].detail).toEqual({ storyId: null });
    expect(window.logWebpageActivity)
      .toHaveBeenCalledWith('Click_module=StorySubmitClient_labelId=7_hasPhoto=false');
    document.removeEventListener('ps:story:changed', changed);
  });

  test('posts under the username when the writer chose it, with the photo and its description', async () => {
    const fetchStub = routeFetch({ 'POST /userapi/stories': {} });
    const { composer, $, picker } = mount({ currUsername: 'mikey' });
    await composer.open(7, 500);
    type($('text'), 'The ramp floods.');
    $('name-username').checked = true;
    const photo = photoFile();
    picker.pick(photo);
    $('alt-input').value = ' Water at the ramp ';
    $('submit').click();
    await flush();

    expect(lastForm(fetchStub)).toEqual({
      label_id: '7', text: 'The ramp floods.', display_name_mode: 'username', photo, alt_text: 'Water at the ramp',
    });
    expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=StorySubmitClient_labelId=7_hasPhoto=true');
  });

  test('a photo without a description goes without one', async () => {
    const fetchStub = routeFetch({ 'POST /userapi/stories': {} });
    const { composer, $, picker } = mount();
    await composer.open(7, 500);
    type($('text'), 'The ramp floods.');
    picker.pick(photoFile());
    $('submit').click();
    await flush();
    expect(lastForm(fetchStub)).not.toHaveProperty('alt_text');
  });

  test('a host that listens only for the page signal (the dashboard) needs no callback', async () => {
    routeFetch({ 'POST /userapi/stories': {} });
    const changed = vi.fn();
    document.addEventListener('ps:story:changed', changed);
    const { composer, $ } = mount();
    await composer.open(7, 500);
    type($('text'), 'The ramp floods.');
    $('submit').click();
    await flush();
    expect(changed).toHaveBeenCalledTimes(1);
    document.removeEventListener('ps:story:changed', changed);
  });

  test('while sending, the button says so and a second click sends nothing more', async () => {
    let answer;
    const fetchStub = routeFetch({ 'POST /userapi/stories': () => new Promise((resolve) => { answer = resolve; }) });
    const { composer, $ } = mount();
    await composer.open(7, 500);
    type($('text'), 'The ramp floods.');
    $('submit').click();
    $('submit').click();

    expect($('submit').disabled).toBe(true);
    expect($('submit').textContent).toBe('labelmap:story.submitting');
    answer({ status: 409, body: { error: 'story.error.already-exists', message: 'Already' } });
    await flush();
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect($('submit').disabled).toBe(false);
    expect($('submit').textContent).toBe('labelmap:story.submit');
  });
});

describe('when the server refuses a story', () => {
  /**
   * Submits a story the server answers with the given status and body.
   * @param {number} status - The HTTP status.
   * @param {any} [body] - The JSON reply; undefined for a reply that isn't JSON.
   * @returns {Promise<HTMLElement>} The error line.
   */
  async function refusedWith(status, body) {
    routeFetch({ 'POST /userapi/stories': { status, body } });
    const { composer, $ } = mount();
    await composer.open(7, 500);
    type($('text'), 'The ramp floods.');
    $('submit').click();
    await flush();
    expect(dialog().open).toBe(true);
    return $('error');
  }

  test('a translated reason is shown with the limit the server names', async () => {
    const error = await refusedWith(400, { error: 'story.error.text-too-long', message: 'Too long', max: 300 });
    expect(error.textContent).toBe('labelmap:story.error.text-too-long {"max":300}');
    expect(error.hidden).toBe(false);
  });

  test('without a limit in the reply, the cap the composer opened with fills in', async () => {
    const error = await refusedWith(409, { error: 'story.error.already-exists', message: 'Already' });
    expect(error.textContent).toBe('labelmap:story.error.already-exists {"max":500}');
  });

  test('a wait the reason has no timed wording for still reads as the plain reason', async () => {
    const error = await refusedWith(409, {
      error: 'story.error.already-exists', message: 'Already', retry_after_seconds: 600,
    });
    expect(error.textContent).toBe('labelmap:story.error.already-exists {"max":500}');
  });

  test('an untranslated reason falls back to the server\'s own English', async () => {
    const error = await refusedWith(400, { error: 'story.error.links-not-allowed', message: 'No links, please.' });
    expect(error.textContent).toBe('No links, please.');
  });

  test('a photo too big for the server to even read says so', async () => {
    // Play's size cutoff answers before our controller, so the reply carries no JSON to translate.
    const error = await refusedWith(413);
    expect(error.textContent).toBe('labelmap:story.error.photo-too-large');
  });

  test('any other failure without a reason gets the generic message', async () => {
    expect((await refusedWith(502)).textContent).toBe('labelmap:story.error.generic');
    expect((await refusedWith(500, {})).textContent).toBe('labelmap:story.error.generic');
  });

  test('a dropped connection gets the generic message and frees the button', async () => {
    routeFetch({ 'POST /userapi/stories': new TypeError('Failed to fetch') });
    const { composer, $ } = mount();
    await composer.open(7, 500);
    type($('text'), 'The ramp floods.');
    $('submit').click();
    await flush();
    expect($('error').textContent).toBe('labelmap:story.error.generic');
    expect($('submit').disabled).toBe(false);
  });
});

describe('editing a story in place', () => {
  test('prefills the story, its photo and description, and offers no sign-in', () => {
    const { composer, $ } = mount({ currUsername: 'mikey' });
    composer.openForEdit(ownStory({ display_name: 'mikey', media: MEDIA }), 500);

    expect(dialog().open).toBe(true);
    expect($('text').value).toBe('The ramp floods every spring.');
    expect($('counter').textContent).toBe('29 / 500');
    expect($('name-username').checked).toBe(true);
    expect($('name-anon').checked).toBe(false);
    expect($('photo-thumb').getAttribute('src')).toBe(MEDIA.url);
    expect($('photo-preview').hidden).toBe(false);
    expect($('photo-attach').hidden).toBe(true);
    expect($('alt-input').value).toBe('Water pooled at the ramp');
    expect($('signin-cta').hidden).toBe(true);
    expect($('submit').textContent).toBe('labelmap:story.save');
    expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=StoryEditOpen_storyId=3');
  });

  test('a photo posted without a description opens with an empty one', () => {
    const { composer, $ } = mount();
    composer.openForEdit(ownStory({ media: { ...MEDIA, alt_text: null } }), null);
    expect($('alt-input').value).toBe('');
    expect($('counter').textContent).toBe('29');
  });

  test.each([
    ['the card\'s resolved byline', { display_name: null }, true],
    ['the dashboard\'s raw mode', { display_name_mode: 'anonymous', display_name: 'ignored' }, true],
    ['the dashboard\'s raw mode', { display_name_mode: 'username' }, false],
  ])('reads anonymity from %s', (_shape, fields, anonymous) => {
    const { composer, $ } = mount({ currUsername: 'mikey' });
    composer.openForEdit(ownStory(fields), 500);
    expect($('name-anon').checked).toBe(anonymous);
  });

  test('a story posted under a name stays anonymous for a viewer the composer knows no username for', () => {
    // The admin view of someone's dashboard edits a story the admin didn't write.
    const { composer, $ } = mount({ currUsername: null });
    composer.openForEdit(ownStory({ display_name_mode: 'username' }), 500);
    expect($('name-anon').checked).toBe(true);
  });

  test('an untouched edit closes without asking; a changed one asks about the changes', async () => {
    const { composer, $, picker } = mount();
    composer.openForEdit(ownStory({ media: MEDIA }), 500);
    $('cancel').click();
    await flush();
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(dialog().open).toBe(false);

    composer.openForEdit(ownStory({ media: MEDIA }), 500);
    picker.pick(photoFile());
    $('cancel').click();
    await flush();
    expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      message: 'labelmap:story.discard-changes-confirm',
    }));
  });

  test('saving sends the changes to the story, not a new one, and keeps the photo with its new description',
    async () => {
      const fetchStub = routeFetch({ 'PUT /userapi/stories/3': {} });
      const onSubmitted = vi.fn();
      const changed = vi.fn();
      document.addEventListener('ps:story:changed', changed);
      const { composer, $ } = mount({ onSubmitted });
      composer.openForEdit(ownStory({ media: MEDIA }), 500);
      type($('text'), 'The ramp floods every spring and fall.');
      $('alt-input').value = 'Deep water at the ramp';
      $('submit').click();
      await flush();

      expect(sentRequests(fetchStub)[0].method).toBe('PUT');
      expect(lastForm(fetchStub)).toEqual({
        text: 'The ramp floods every spring and fall.', display_name_mode: 'anonymous',
        alt_text: 'Deep water at the ramp',
      });
      expect(onSubmitted).toHaveBeenCalledWith(true);
      expect(changed.mock.calls[0][0].detail).toEqual({ storyId: 3 });
      expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=StoryUpdateClient_storyId=3');
      expect($('submit').textContent).toBe('labelmap:story.save');
      document.removeEventListener('ps:story:changed', changed);
    });

  test('a kept photo whose description was cleared sends no description', async () => {
    const fetchStub = routeFetch({ 'PUT /userapi/stories/3': {} });
    const { composer, $ } = mount();
    composer.openForEdit(ownStory({ media: MEDIA }), 500);
    $('alt-input').value = '';
    $('submit').click();
    await flush();
    expect(lastForm(fetchStub)).toEqual({ text: 'The ramp floods every spring.', display_name_mode: 'anonymous' });
  });

  test('removing the photo asks the server to remove it, even after a replacement was picked and dropped',
    async () => {
      const fetchStub = routeFetch({ 'PUT /userapi/stories/3': {} });
      const { composer, $, picker } = mount();
      composer.openForEdit(ownStory({ media: MEDIA }), 500);
      picker.pick(photoFile());
      $('photo-remove').click();
      $('submit').click();
      await flush();
      expect(lastForm(fetchStub)).toEqual({
        text: 'The ramp floods every spring.', display_name_mode: 'anonymous', remove_photo: 'true',
      });
    });

  test('a story that never had a photo sends no photo change', async () => {
    const fetchStub = routeFetch({ 'PUT /userapi/stories/3': {} });
    const { composer, $ } = mount();
    composer.openForEdit(ownStory(), 500);
    $('submit').click();
    await flush();
    expect(lastForm(fetchStub)).toEqual({ text: 'The ramp floods every spring.', display_name_mode: 'anonymous' });
  });

  test('a replacement photo is sent in the old one\'s place', async () => {
    const fetchStub = routeFetch({ 'PUT /userapi/stories/3': {} });
    const { composer, $, picker } = mount();
    composer.openForEdit(ownStory({ media: MEDIA }), 500);
    const photo = photoFile('new.png', 'image/png');
    picker.pick(photo);
    $('submit').click();
    await flush();
    // The description written for the old photo carries over to the new one.
    expect(lastForm(fetchStub)).toEqual({
      text: 'The ramp floods every spring.', display_name_mode: 'anonymous', photo, alt_text: MEDIA.alt_text,
    });
  });

  test('a host can send edits elsewhere: the admin view uses the moderation route', async () => {
    const fetchStub = routeFetch({ 'PUT /adminapi/stories/3': {} });
    const { composer, $ } = mount({ updateUrlFor: (id) => `/adminapi/stories/${id}` });
    composer.openForEdit(ownStory(), 500);
    $('submit').click();
    await flush();
    expect(sentRequests(fetchStub)[0].url).toBe('/adminapi/stories/3');
  });

  test('a refused edit reads its reason, and the button goes back to Save', async () => {
    routeFetch({ 'PUT /userapi/stories/3': { status: 404, body: { message: 'Story not found.' } } });
    const { composer, $ } = mount();
    composer.openForEdit(ownStory(), 500);
    $('submit').click();
    await flush();
    expect($('error').textContent).toBe('Story not found.');
    expect($('submit').textContent).toBe('labelmap:story.save');
  });

  test('a new story after an edit is a new story again', async () => {
    const fetchStub = routeFetch({ 'POST /userapi/stories': {} });
    const { composer, $ } = mount();
    composer.openForEdit(ownStory({ media: MEDIA }), 500);
    await composer.open(9, 500);
    expect($('photo-preview').hidden).toBe(true);
    type($('text'), 'Another label.');
    $('submit').click();
    await flush();
    expect(sentRequests(fetchStub)[0].method).toBe('POST');
    expect(lastForm(fetchStub)).toHaveProperty('label_id', '9');
  });
});

describe('keeping a draft across sign-in', () => {
  test('signing in stashes the draft, photo and all, and leaves for the sign-in page', async () => {
    const navigations = navigationAttempts();
    const { composer, $, picker } = mount();
    await composer.open(7, 500);
    type($('text'), 'Half-written story');
    const photo = photoFile();
    picker.pick(photo);
    $('alt-input').value = 'The ramp';
    $('signin-btn').click();
    await vi.waitFor(() => expect(navigations).toHaveBeenCalledTimes(1));

    expect(drafts.get(7)).toEqual({
      labelId: 7, text: 'Half-written story', altText: 'The ramp', useUsername: false,
      photoBlob: photo, photoName: 'curb.jpg', photoType: 'image/jpeg',
    });
    expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=StorySignInCta_labelId=7');
  });

  test('a draft without a photo stashes without one', async () => {
    const navigations = navigationAttempts();
    const { composer, $ } = mount();
    await composer.open(7, 500);
    type($('text'), 'Just words');
    $('signin-btn').click();
    await vi.waitFor(() => expect(navigations).toHaveBeenCalledTimes(1));
    expect(drafts.get(7)).toMatchObject({ photoBlob: null, photoName: null, photoType: null });
  });

  test('if the draft can\'t be stashed, sign-in goes ahead anyway', async () => {
    const { failing } = fakeDraftStore();
    failing.add('put');
    const navigations = navigationAttempts();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { composer, $ } = mount();
    await composer.open(7, 500);
    $('signin-btn').click();
    await vi.waitFor(() => expect(navigations).toHaveBeenCalledTimes(1));
    expect(consoleError).toHaveBeenCalledWith('Could not stash story draft before sign-in:', expect.any(Error));
  });

  test('coming back, the draft is restored for its label and then forgotten', async () => {
    const photo = photoFile('ramp.png', 'image/png');
    drafts.set(7, {
      labelId: 7, text: 'Half-written story', altText: 'The ramp', useUsername: true,
      photoBlob: photo, photoName: 'ramp.png', photoType: 'image/png',
    });
    const { composer, $ } = mount({ currUsername: 'mikey' });
    await composer.open(7, 500);

    expect($('text').value).toBe('Half-written story');
    expect($('counter').textContent).toBe('18 / 500');
    expect($('name-username').checked).toBe(true);
    expect($('alt-input').value).toBe('The ramp');
    expect($('photo-preview').hidden).toBe(false);
    const restored = $('photo-input').files[0];
    expect([restored.name, restored.type]).toEqual(['ramp.png', 'image/png']);
    await vi.waitFor(() => expect(drafts.has(7)).toBe(false));
  });

  test('a draft that asked for the username stays anonymous if the viewer still has none', async () => {
    drafts.set(7, {
      labelId: 7, text: 'Words', altText: '', useUsername: true, photoBlob: null, photoName: null, photoType: null,
    });
    const { composer, $ } = mount({ currUsername: null });
    await composer.open(7, 500);
    expect($('text').value).toBe('Words');
    expect($('name-anon').checked).toBe(true);
    expect($('photo-preview').hidden).toBe(true);
  });

  test('another label\'s draft is left for that label', async () => {
    drafts.set(8, { labelId: 8, text: 'For label 8' });
    const { composer, $ } = mount();
    await composer.open(7, 500);
    expect($('text').value).toBe('');
    expect(drafts.has(8)).toBe(true);
  });

  test('if the host moves to another label mid-restore, the draft stays put for its own label', async () => {
    drafts.set(7, { labelId: 7, text: 'For label 7' });
    const { composer, $ } = mount();
    const first = composer.open(7, 500);
    composer.openForEdit(ownStory({ label_id: 8 }), 500);
    await first;
    expect($('text').value).toBe('The ramp floods every spring.');
    expect(drafts.has(7)).toBe(true);
  });

  test('an unreadable draft store just leaves the composer empty', async () => {
    const { failing } = fakeDraftStore();
    failing.add('open');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { composer, $ } = mount();
    await composer.open(7, 500);
    expect($('text').value).toBe('');
    expect(consoleError).toHaveBeenCalledWith('Could not read stashed story draft:', expect.any(Error));
  });

  test('a failed read is reported the same way', async () => {
    const { failing } = fakeDraftStore();
    failing.add('get');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { composer } = mount();
    await composer.open(7, 500);
    expect(consoleError).toHaveBeenCalledWith('Could not read stashed story draft:', expect.any(Error));
  });

  test('a draft that can\'t be forgotten is still restored', async () => {
    const store = fakeDraftStore();
    store.drafts.set(7, { labelId: 7, text: 'Keep me', useUsername: false, photoBlob: null });
    store.failing.add('delete');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { composer, $ } = mount();
    await composer.open(7, 500);
    await vi.waitFor(() => expect(consoleError)
      .toHaveBeenCalledWith('Could not clear stashed story draft:', expect.any(Error)));
    expect($('text').value).toBe('Keep me');
  });
});
