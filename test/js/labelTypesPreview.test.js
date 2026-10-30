/**
 * The label types preview on the API docs index (#5840): a table of the label types /v3/api/labelTypes serves, with
 * their icons and a swatch of each color. Fed from a canned response.
 */

import { loadModules } from './loader.js';
import { routeFetch, stubApiDocsLibraries, textOf } from './support/apiDocsHarness.js';

stubApiDocsLibraries();

function labelType(name, color, isPrimary) {
  return {
    name, color, is_primary: isPrimary, display_name: `${name} display`, description: `About ${name}.`,
    icon_url: `/icons/${name}.png`, small_icon_url: `/icons/${name}_small.png`, tiny_icon_url: `/icons/${name}_tiny.png`,
  };
}

const LABEL_TYPES = {
  label_types: [
    labelType('CurbRamp', '#90C31F', true),
    // Dark enough that the swatch needs light text.
    labelType('Dark', '#202020', true),
    labelType('Occlusion', '#B3B3B3', false),
  ],
};

/** Loads the preview onto a page with its container, and runs it with the given options. */
async function renderPreview(options = {}, response = LABEL_TYPES) {
  document.body.innerHTML = '<div id="label-types-preview"></div>';
  routeFetch({ '/v3/api/labelTypes': response });
  const { LabelTypesPreview } = await loadModules('frontend/js/api-docs/labelTypesPreview.js');
  await LabelTypesPreview.setup(options).init();
  return document.getElementById('label-types-preview');
}

/** @returns {string[][]} Each body row of a table, as its cells' text. */
const bodyRows = (table) => [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map(textOf));

describe('the label types table', () => {
  it('lists the primary label types, with their names, description and color code', async () => {
    const container = await renderPreview();
    const table = container.querySelector('table');
    expect([...table.querySelectorAll('th')].map(textOf)).toEqual([
      'Name', 'Display Name', 'Description', 'Standard Icon', 'Small Icon', 'Tiny Icon', 'Color Preview', 'Color Code',
    ]);
    expect(bodyRows(table)).toEqual([
      ['CurbRamp', 'CurbRamp display', 'About CurbRamp.', '', '', '', 'CurbRamp', '#90C31F'],
      ['Dark', 'Dark display', 'About Dark.', '', '', '', 'Dark', '#202020'],
    ]);
  });

  it('lists every label type when not limited to the primary ones', async () => {
    const container = await renderPreview({ showPrimaryOnly: false });
    expect(bodyRows(container.querySelector('table')).map(([name]) => name)).toEqual(['CurbRamp', 'Dark', 'Occlusion']);
  });

  it('shows each icon size the API links', async () => {
    const container = await renderPreview();
    const icons = [...container.querySelector('tbody tr').querySelectorAll('img')];
    expect(icons.map((img) => [img.getAttribute('src'), img.alt, img.height])).toEqual([
      ['/icons/CurbRamp.png', 'CurbRamp icon', 32],
      ['/icons/CurbRamp_small.png', 'CurbRamp small icon', 24],
      ['/icons/CurbRamp_tiny.png', 'CurbRamp tiny icon', 16],
    ]);
  });

  it('fills each swatch with its color, and marks the light ones for dark text', async () => {
    const container = await renderPreview();
    const [light, dark] = container.querySelectorAll('td.color-cell');
    expect(light.style.backgroundColor).toBe('rgb(144, 195, 31)');
    expect(light.classList.contains('light-color')).toBe(true);
    expect(dark.classList.contains('light-color')).toBe(false);
  });

  it('puts the table in a named, focusable scroll region in place of the loading text', async () => {
    const container = await renderPreview();
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild.getAttribute('aria-label')).toBe('Label types');
  });

  it('caps the width of the preview, or leaves it alone when told to', async () => {
    expect((await renderPreview({ maxWidth: 640 })).style.maxWidth).toBe('640px');
    expect((await renderPreview({ maxWidth: null })).style.maxWidth).toBe('');
  });
});

describe('when something fails', () => {
  it('says the request failed, with its status', async () => {
    const container = await renderPreview({}, { status: 502 });
    expect(textOf(container)).toBe('Failed to load label types: HTTP error! Status: 502');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('rejects, fetching nothing, when the page lacks its container', async () => {
    document.body.innerHTML = '';
    const fetchStub = routeFetch({});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { LabelTypesPreview } = await loadModules('frontend/js/api-docs/labelTypesPreview.js');
    await expect(LabelTypesPreview.init()).rejects.toThrow('Container element not found');
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
