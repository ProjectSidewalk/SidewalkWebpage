/**
 * The tool header (#5958, common/toolHeader.scala.html) on each of the four tools' pages.
 *
 * ToolHeaderViewSpec covers what the component renders. Only a browser can say that the header reached each page,
 * that the mark's file was served (a wrong path is a broken image with a clean console), that the header is laid
 * out beside the close button rather than under it, and that each page has exactly one `<h1>` whether or not its map
 * panel is open. The pages load from pages.spec.js's table, so their stubs stay defined in one place.
 */
const {test, expect, loadAndSettle} = require('./fixtures');
const {PAGES} = require('./pages');

/**
 * `name` is the English the header shows. `heading` says where the page's `<h1>` is: 'lockup' (the name itself),
 * 'outside' (a map page, whose panel can be collapsed, states it outside the panel) or 'own' (the page's subject).
 */
const TOOLS = [
  {path: '/accessScore', name: 'AccessScore', mark: 'access-score', heading: 'outside'},
  {path: '/gallery', name: 'Gallery', mark: 'gallery', heading: 'lockup'},
  {path: '/labelMap', name: 'LabelMap', mark: 'label-map', heading: 'outside'},
  {path: '/report/neighborhood/tyron-park', name: 'Reports', mark: 'reports', heading: 'own'},
];

for (const tool of TOOLS) {
  test(`${tool.path} opens its sidebar with the ${tool.name} logo and name`, async ({page, context}) => {
    const entry = PAGES.find((p) => p.path === tool.path);
    expect(entry, `${tool.path} is missing from the page table`).toBeTruthy();
    await loadAndSettle(page, context, entry);

    const header = page.locator('.ps-tool-header');
    await expect(header).toHaveCount(1);
    await expect(header).toBeVisible();

    const name = header.locator('.ps-tool-header__name');
    await expect(name).toHaveText(tool.name);

    const mark = header.locator('.ps-tool-header__mark');
    // A staged build serves the file under its digest, `<digest>-<name>.svg`; the dev server under its plain name.
    await expect(mark).toHaveAttribute('src', new RegExp(`/logos/tools/(?:[0-9a-f]+-)?${tool.mark}\\.svg$`));
    // Decorative beside its name, so it must stay out of the accessibility tree.
    await expect(mark).toHaveAttribute('alt', '');
    const loaded = await mark.evaluate((img) => img.complete && img.naturalWidth > 0);
    expect(loaded, `${tool.mark}.svg did not load`).toBe(true);
    // The stylesheet reached the page: unstyled, the mark would still be 40px but the name would not sit beside it.
    const markBox = await mark.boundingBox();
    const nameBox = await name.boundingBox();
    expect(markBox.width).toBe(40);
    expect(nameBox.x).toBeGreaterThan(markBox.x + markBox.width);

    // By role, which skips the hidden headings of the sign-in dialog every page carries.
    const pageHeadings = page.getByRole('heading', {level: 1});
    await expect(pageHeadings).toHaveCount(1);
    if (tool.heading === 'own') {
      await expect(header.locator('h1')).toHaveCount(0);
    } else {
      await expect(pageHeadings).toHaveText(tool.name);
    }
    if (tool.heading !== 'outside') return;

    const closeButton = page.locator('#filter-sidebar-close');
    const chevronBox = await closeButton.locator('img').boundingBox();
    const buttonBox = await closeButton.boundingBox();
    expect(Math.abs(markBox.y - chevronBox.y), 'the mark starts level with the close chevron').toBeLessThan(1);
    expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(buttonBox.x);

    // A refetch dims the panel's controls; the logo keeps its colors and the name its contrast.
    const whileLoading = await page.locator('#filter-sidebar').evaluate((sidebar) => {
      sidebar.classList.add('filter-sidebar--loading');
      const {opacity, filter} = getComputedStyle(sidebar.querySelector('.ps-tool-header'));
      const controls = getComputedStyle(sidebar.querySelector('#labelmap-search-section')).opacity;
      sidebar.classList.remove('filter-sidebar--loading');
      return {opacity, filter, controls};
    });
    expect(whileLoading).toEqual({opacity: '1', filter: 'none', controls: '0.5'});

    // Collapsed, the panel leaves the accessibility tree, and the page must still have its heading.
    await closeButton.click();
    await expect(header).toBeHidden();
    await expect(pageHeadings).toHaveCount(1);
    await expect(pageHeadings).toHaveText(tool.name);
    // Read before the map, whose own controls would otherwise come ahead of the page's name.
    const beforeMap = await pageHeadings.evaluate((h1) => {
      const map = h1.parentElement.querySelector('.choropleth');
      return Boolean(h1.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(beforeMap, 'the h1 precedes the map in the document').toBe(true);
  });
}
