/**
 * Tests for the story composer's label-aware dialog title (#4722 QA): the heading names the label the story will
 * attach to — "Write your story about this Missing Curb Ramp" — and falls back to the generic wording for a label
 * whose type name doesn't read as a thing you can have a story "about" (Other, Can't See the Sidewalk).
 *
 * The title lives in private fields, so the class is built for real against the dialog skeleton it queries.
 */

import { loadModules, mockModule } from './loader.js';
import { composerMarkup, installDialogs } from './support/storyHarness.js';

// Echo the key, with any interpolation appended so both halves are assertable.
mockModule('i18next', () => ({ default: {
  t: (key, opts) => (opts && opts.labelType !== undefined ? `${key}[${opts.labelType}]` : key),
} }));

/** @returns {HTMLDialogElement} A fresh copy of the composer dialog. */
function setupDom() {
  document.body.innerHTML = composerMarkup();
  return document.querySelector('.story-composer');
}

let StoryComposer;

/** @returns {object} A composer on a fresh dialog. */
function newComposer() {
  return new StoryComposer(setupDom(), {});
}

const title = () => document.querySelector('.story-composer__title').textContent;

beforeEach(async () => {
  ({ StoryComposer } = await loadModules('frontend/js/common/label-detail/StoryComposer.js'));
  window.logWebpageActivity = vi.fn();
  installDialogs();
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
