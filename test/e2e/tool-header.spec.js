/**
 * The tool header (#5958, common/toolHeader.scala.html) on each of the four tools' pages.
 *
 * ToolHeaderViewSpec covers what the component renders. Only a browser can say that the header reached each page,
 * that the mark's file was served (a wrong path is a broken image with a clean console), and that the name is the
 * page's one `<h1>` where the page has no other. The pages load from pages.spec.js's table, so their stubs stay
 * defined in one place.
 */
const {test, expect, loadAndSettle} = require('./fixtures');
const {PAGES} = require('./pages');

/** `name` is the English the header shows; `heading` is false where the page's `<h1>` is its own subject. */
const TOOLS = [
  {path: '/accessScore', name: 'AccessScore', mark: 'access-score', heading: true},
  {path: '/gallery', name: 'Gallery', mark: 'gallery', heading: true},
  {path: '/labelMap', name: 'LabelMap', mark: 'label-map', heading: true},
  {path: '/report/neighborhood/tyron-park', name: 'Reports', mark: 'reports', heading: false},
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
    await expect(mark).toHaveAttribute('src', new RegExp(`/logos/tools/${tool.mark}[^/]*\\.svg`));
    // Decorative beside its name, so it must stay out of the accessibility tree.
    await expect(mark).toHaveAttribute('alt', '');
    const loaded = await mark.evaluate((img) => img.complete && img.naturalWidth > 0);
    expect(loaded, `${tool.mark}.svg did not load`).toBe(true);

    // Visible ones only: the sign-in dialog every page carries has headings of its own, hidden until it opens.
    const pageHeadings = page.locator('h1:visible');
    await expect(pageHeadings).toHaveCount(1);
    if (tool.heading) {
      await expect(pageHeadings).toHaveText(tool.name);
    } else {
      await expect(header.locator('h1')).toHaveCount(0);
    }
  });
}
