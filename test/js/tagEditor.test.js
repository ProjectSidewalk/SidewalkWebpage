/**
 * Tests for TagEditor, the label card's inline tag pills (#2575): which tags a label type offers, pressing and
 * releasing them, a mutually exclusive pair releasing its partner, and the one /label/tags fetch a page makes, retried
 * after a failure. The card's own Edit/Done flow around it is labelDetailEditGating.test.js's. (#5840)
 */

import { loadModules, mockModule } from './loader.js';
import { routeFetch } from './support/routeFetch.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

/** The city's tags as GET /label/tags lists them. */
const TAGS = [
  { tag: 'narrow', label_type: 'Obstacle', mutually_exclusive_with: null },
  { tag: 'tree', label_type: 'Obstacle', mutually_exclusive_with: null },
  { tag: 'points into traffic', label_type: 'CurbRamp', mutually_exclusive_with: null },
  { tag: 'tactile warning', label_type: 'CurbRamp', mutually_exclusive_with: 'missing tactile warning' },
  { tag: 'missing tactile warning', label_type: 'CurbRamp', mutually_exclusive_with: 'tactile warning' },
  { tag: 'street has a sidewalk', label_type: 'NoSidewalk', mutually_exclusive_with: 'street has no sidewalks' },
];

let TagEditor;
let container;

/** @returns {HTMLButtonElement[]} The rendered pills. */
const pills = () => [...container.querySelectorAll('button.tag-pill')];
/**
 * @param {string} tag - A tag name.
 * @returns {HTMLButtonElement} Its pill.
 */
const pill = (tag) => container.querySelector(`[data-tag="${tag}"]`);
/** @returns {string[]} The tags whose pills read as pressed. */
const pressed = () => pills().filter((p) => p.getAttribute('aria-pressed') === 'true').map((p) => p.dataset.tag);

beforeEach(async () => {
  ({ TagEditor } = await loadModules('frontend/js/common/label-detail/TagEditor.js'));
  document.body.innerHTML = '<div class="label-detail__tags"></div>';
  container = document.querySelector('.label-detail__tags');
});

describe('opening the editor', () => {
  test('offers every tag of the label\'s type, with its current tags pressed', async () => {
    routeFetch({ '/label/tags': TAGS });
    const editor = new TagEditor(container);
    await editor.open('CurbRamp', ['tactile warning']);

    expect(editor.isOpen).toBe(true);
    expect(pills().map((p) => p.dataset.tag))
      .toEqual(['points into traffic', 'tactile warning', 'missing tactile warning']);
    expect(pressed()).toEqual(['tactile warning']);
    expect(pill('tactile warning').classList.contains('tag-pill--active')).toBe(true);
    expect(pill('tactile warning').type).toBe('button');
  });

  test('labels each pill with its translated name, colons made key-safe', async () => {
    routeFetch({ '/label/tags': [{ tag: 'material: brick', label_type: 'Obstacle', mutually_exclusive_with: null }] });
    await new TagEditor(container).open('Obstacle', []);
    expect(container.querySelector('.tag-pill__label').textContent).toBe('common:tag.material- brick');
  });

  test('a type with no tags shows no pills', async () => {
    routeFetch({ '/label/tags': TAGS });
    await new TagEditor(container).open('Occlusion', []);
    expect(pills()).toEqual([]);
  });

  test('the tag list is fetched once per page, however many editors open', async () => {
    const fetchStub = routeFetch({ '/label/tags': TAGS });
    await new TagEditor(container).open('Obstacle', []);
    await new TagEditor(container).open('CurbRamp', []);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  test('a failed fetch rejects, and the next open tries again', async () => {
    const fetchStub = routeFetch({ '/label/tags': { status: 500 } });
    const editor = new TagEditor(container);
    await expect(editor.open('Obstacle', [])).rejects.toThrow('HTTP 500');

    const retry = routeFetch({ '/label/tags': TAGS });
    await editor.open('Obstacle', []);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(pills()).toHaveLength(2);
  });

  test('closing before the tags arrive leaves the tag area alone', async () => {
    routeFetch({ '/label/tags': TAGS });
    const editor = new TagEditor(container);
    const opening = editor.open('Obstacle', []);
    editor.close();
    container.textContent = 'read-only tags';
    await opening;
    expect(container.textContent).toBe('read-only tags');
  });

  test('if the host moves to a label of another type mid-fetch, only the newer type\'s pills show', async () => {
    routeFetch({ '/label/tags': TAGS });
    const editor = new TagEditor(container);
    const first = editor.open('Obstacle', []);
    const second = editor.open('CurbRamp', []);
    await Promise.all([first, second]);
    expect(pills().map((p) => p.dataset.tag)).toContain('tactile warning');
    expect(pill('narrow')).toBeNull();
  });
});

describe('pressing tags', () => {
  /**
   * @param {string} labelType - The label's type.
   * @param {string[]} current - Its tags as they stand.
   * @returns {Promise<object>} An open editor.
   */
  async function openEditor(labelType, current) {
    routeFetch({ '/label/tags': TAGS });
    const editor = new TagEditor(container);
    await editor.open(labelType, current);
    return editor;
  }

  test('pressing adds a tag and releasing removes it', async () => {
    const editor = await openEditor('Obstacle', ['narrow']);
    pill('tree').click();
    expect(editor.selectedTags).toEqual(['narrow', 'tree']);
    expect(pressed()).toEqual(['narrow', 'tree']);

    pill('narrow').click();
    expect(editor.selectedTags).toEqual(['tree']);
    expect(pill('narrow').getAttribute('aria-pressed')).toBe('false');
    expect(pill('narrow').classList.contains('tag-pill--active')).toBe(false);
  });

  test('pressing one of a mutually exclusive pair releases the other', async () => {
    const editor = await openEditor('CurbRamp', ['points into traffic', 'tactile warning']);
    pill('missing tactile warning').click();
    expect(editor.selectedTags).toEqual(['points into traffic', 'missing tactile warning']);
    expect(pressed()).toEqual(['points into traffic', 'missing tactile warning']);
  });

  test('pressing one of a pair whose partner isn\'t pressed releases nothing', async () => {
    const editor = await openEditor('CurbRamp', ['points into traffic']);
    pill('tactile warning').click();
    expect(editor.selectedTags).toEqual(['points into traffic', 'tactile warning']);
  });

  test('a partner the label still carries but the catalog no longer offers is dropped too', async () => {
    // A tag renamed or retired since the label was tagged has no pill, but the pair rule still applies to it.
    const editor = await openEditor('NoSidewalk', ['street has no sidewalks']);
    pill('street has a sidewalk').click();
    expect(editor.selectedTags).toEqual(['street has a sidewalk']);
  });

  test('a copy of the selection can\'t change the editor\'s', async () => {
    const editor = await openEditor('Obstacle', ['narrow']);
    editor.selectedTags.push('tree');
    expect(editor.selectedTags).toEqual(['narrow']);
  });

  test('closing clears the pills and hands back what was pressed', async () => {
    const editor = await openEditor('Obstacle', []);
    pill('tree').click();
    expect(editor.close()).toEqual(['tree']);
    expect(editor.isOpen).toBe(false);
    expect(container.children).toHaveLength(0);
  });
});
