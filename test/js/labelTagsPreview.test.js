/**
 * The label tags preview (#5840): on /v3/api-docs/labelTags, one table of tags per label type, each under a heading
 * the index page links to; on the index, a summary of which tags each type offers. Fed from a canned
 * /v3/api/labelTags response.
 */

import { loadModules } from './loader.js';
import { routeFetch, stubApiDocsLibraries, textOf } from './support/apiDocsHarness.js';

stubApiDocsLibraries();

const LABEL_TAGS = {
  label_tags: [
    { id: 3, label_type: 'Curb Ramp', tag: 'steep', description: 'Too steep.', mutually_exclusive_with: [] },
    { id: 1, label_type: 'Curb Ramp', tag: 'narrow', description: 'Too narrow.', mutually_exclusive_with: ['wide'] },
    { id: 7, label_type: 'Obstacle', tag: 'parked car', description: 'A car on the sidewalk.' },
    { id: 9, label_type: 'Curb Ramp', tag: 'wide', description: 'Wide enough.', mutually_exclusive_with: ['narrow'] },
  ],
};

/** Loads the preview onto a page with its container, and runs it with the given options. */
async function renderPreview(options = {}, response = LABEL_TAGS) {
  document.body.innerHTML = '<div id="label-tags-preview"></div>';
  const fetchStub = routeFetch({ '/v3/api/labelTags': response });
  const { LabelTagsPreview } = await loadModules('frontend/js/api-docs/labelTagsPreview.js');
  await LabelTagsPreview.setup(options).init();
  return { fetchStub, container: document.getElementById('label-tags-preview'), LabelTagsPreview };
}

/** @returns {string[][]} Each body row of a table, as its cells' text. */
const bodyRows = (table) => [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map(textOf));

describe('the detailed view', () => {
  it('gives each label type, alphabetically, a linkable heading over a table of its tags', async () => {
    const { container } = await renderPreview();
    const headings = [...container.querySelectorAll('h3.page-heading')];
    expect(headings.map((h) => h.id)).toEqual(['label-type-curb-ramp', 'label-type-obstacle']);
    expect(textOf(headings[0])).toBe('Curb Ramp #');
    const permalink = headings[0].querySelector('a.permalink');
    expect(permalink.getAttribute('href')).toBe('#label-type-curb-ramp');
    expect(permalink.getAttribute('aria-label')).toBe('common:copy.section-link');
  });

  it("lists a type's tags by name, capitalized, with description and the tags each excludes", async () => {
    const { container } = await renderPreview();
    const [curbRamps, obstacles] = container.querySelectorAll('table');
    expect([...curbRamps.querySelectorAll('th')].map(textOf))
      .toEqual(['Tag Name', 'Example Image', 'Description', 'Mutually Exclusive With']);
    expect(bodyRows(curbRamps)).toEqual([
      ['Narrow', '', 'Too narrow.', 'wide'],
      ['Steep', '', 'Too steep.', ''],
      ['Wide', '', 'Wide enough.', 'narrow'],
    ]);
    expect(bodyRows(obstacles)).toEqual([['Parked car', '', 'A car on the sidewalk.', '']]);
  });

  it("shows each tag's example image, and a placeholder when that image is missing", async () => {
    const { container } = await renderPreview();
    const img = container.querySelector('td.tag-image img');
    expect(img.getAttribute('src')).toBe('/assets/images/examples/tags/1.png');
    expect(img.alt).toBe('narrow tag image');
    img.onerror();
    expect(img.getAttribute('src')).toBe('/assets/images/examples/tags/placeholder.png');
    expect(img.alt).toBe('Image not available');
  });

  it('puts each table in a named, focusable scroll region', async () => {
    const { container } = await renderPreview();
    const wrapper = container.querySelector('.ps-table-wrapper');
    expect(wrapper.getAttribute('role')).toBe('region');
    expect(wrapper.getAttribute('aria-label')).toBe('Curb Ramp tags');
    expect(wrapper.tabIndex).toBe(0);
  });

  it('caps the width of the preview, or leaves it alone when told to', async () => {
    const { container } = await renderPreview({ maxWidth: 800 });
    expect(container.style.maxWidth).toBe('800px');
    const { container: unstyled } = await renderPreview({ maxWidth: 0 });
    expect(unstyled.style.maxWidth).toBe('');
  });

  it('leaves the name of a tag with none blank', async () => {
    const { container } = await renderPreview({}, { label_tags: [{ id: 2, label_type: 'Other', tag: '' }] });
    expect(bodyRows(container.querySelector('table'))).toEqual([['', '', '', '']]);
  });
});

describe('the summary view', () => {
  it("lists each label type's tags, linking the type to its section on the label tags page", async () => {
    const { container } = await renderPreview({ displayMode: 'summary' });
    const table = container.querySelector('table');
    expect([...table.querySelectorAll('th')].map(textOf)).toEqual(['Label Type', 'Available Tags']);
    expect(bodyRows(table)).toEqual([['Curb Ramp', 'Narrow, Steep, Wide'], ['Obstacle', 'Parked car']]);
    expect(table.querySelector('a').getAttribute('href')).toBe('/v3/api-docs/labelTags#label-type-curb-ramp');
    expect(container.querySelector('.ps-table-wrapper').getAttribute('aria-label')).toBe('Label tags by label type');
  });
});

describe('when something fails', () => {
  it('says the request failed, with its status', async () => {
    const { container } = await renderPreview({}, { status: 500 });
    expect(textOf(container)).toBe('Failed to load label tags: HTTP error! Status: 500');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('rejects, fetching nothing, when the page lacks its container', async () => {
    document.body.innerHTML = '';
    const fetchStub = routeFetch({});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { LabelTagsPreview } = await loadModules('frontend/js/api-docs/labelTagsPreview.js');
    await expect(LabelTagsPreview.init()).rejects.toThrow('Container element not found');
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
