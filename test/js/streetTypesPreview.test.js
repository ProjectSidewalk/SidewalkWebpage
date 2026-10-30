/**
 * The /v3/api-docs/streetTypes preview (#5840): a table of the city's OSM street types, most common first, each with
 * its count and a bar scaled to the most common. Fed from a canned /v3/api/streetTypes response.
 */

import { loadModules } from './loader.js';
import { routeFetch, stubApiDocsLibraries, textOf } from './support/apiDocsHarness.js';

stubApiDocsLibraries();

const STREET_TYPES = {
  street_types: [
    { name: 'primary', description: 'A major road.', count: 250 },
    { name: 'residential', description: 'A street people live on.', count: 1000 },
    { name: 'service', description: 'An alley or driveway.', count: 500 },
  ],
};

/** Loads the preview onto a page with its container, and runs it with the given options. */
async function renderPreview(options = {}, response = STREET_TYPES) {
  document.body.innerHTML = '<div id="street-types-preview"></div>';
  routeFetch({ '/v3/api/streetTypes': response });
  const { StreetTypesPreview } = await loadModules('frontend/js/api-docs/streetTypesPreview.js');
  await StreetTypesPreview.setup(options).init();
  return document.getElementById('street-types-preview');
}

describe('the street types table', () => {
  it('lists the street types, most common first, with their description and count', async () => {
    const container = await renderPreview();
    const table = container.querySelector('table');
    expect([...table.querySelectorAll('th')].map(textOf))
      .toEqual(['Street Type', 'Description', 'Street Segment Count']);
    expect([...table.querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map(textOf))).toEqual([
      ['residential', 'A street people live on.', '1,000'],
      ['service', 'An alley or driveway.', '500'],
      ['primary', 'A major road.', '250'],
    ]);
  });

  it("scales each type's bar to the most common type", async () => {
    const container = await renderPreview();
    expect([...container.querySelectorAll('.count-bar-fill')].map((bar) => bar.style.width))
      .toEqual(['100%', '50%', '25%']);
  });

  it('puts the table in a named scroll region in place of the loading text', async () => {
    const container = await renderPreview();
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild.getAttribute('aria-label')).toBe('Street types');
  });

  it('draws an empty table for a city with no street types', async () => {
    const container = await renderPreview({}, { street_types: [] });
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
    expect(container.querySelectorAll('th')).toHaveLength(3);
  });

  it('caps the width of the preview, or leaves it alone when told to', async () => {
    expect((await renderPreview({ maxWidth: 700 })).style.maxWidth).toBe('700px');
    expect((await renderPreview({ maxWidth: 0 })).style.maxWidth).toBe('');
  });
});

describe('when something fails', () => {
  it('says the request failed, with its status', async () => {
    const container = await renderPreview({}, { status: 500 });
    expect(textOf(container)).toBe('Failed to load street types: HTTP error! Status: 500');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('rejects, fetching nothing, when the page lacks its container', async () => {
    document.body.innerHTML = '';
    const fetchStub = routeFetch({});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { StreetTypesPreview } = await loadModules('frontend/js/api-docs/streetTypesPreview.js');
    await expect(StreetTypesPreview.init()).rejects.toThrow('Container element not found');
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
