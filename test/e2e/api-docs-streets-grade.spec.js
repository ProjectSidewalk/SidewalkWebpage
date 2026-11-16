/**
 * The Streets API docs page documents exactly the properties /v3/api/streets serves, street grade included (#5431).
 *
 * #5431 put the ten street-grade fields on /v3/api/streets and documented them on /v3/api-docs/streets. The Scala
 * specs pin the endpoint's output, but nothing tied the hand-written field table to it, so a field added to one and
 * not the other would ship unnoticed. This spec reads both from the running app and requires them to agree.
 *
 * The field list is not copied here: the backend's one declaration is `StreetGradientApiFields.statFields` in Scala,
 * which no JS can read. The docs page marks its grade rows `data-field-group="street-grade"`, and the response is
 * the one the page's own preview fetches, so each side is read where a reader would meet it. Grade values are null
 * in CI's seed (it has no street_gradient rows); a null still has its key, which is all this checks.
 */
const {test, expect, loadAndSettle} = require('./fixtures');
const {PAGES} = require('./pages');

const PATH = '/v3/api-docs/streets';

test(`${PATH} documents every /v3/api/streets property, grade fields included`, async ({
  page, context, consoleErrors,
}) => {
  const entry = PAGES.find((p) => p.path === PATH);
  if (!entry) throw new Error(`${PATH} is not in pages.js — update this spec or the table`);

  // Registered before navigation: the preview requests the streets of one region during init.
  const streetsResponse = page.waitForResponse((r) => new URL(r.url()).pathname === '/v3/api/streets');
  await loadAndSettle(page, context, entry);
  const streets = await (await streetsResponse).json();

  const fieldTable = page.locator('[aria-labelledby="geojson-fields"] table');
  const propertyNames = async (rows) => (await rows.locator('td:first-child code').allTextContents())
    .map((text) => text.trim().match(/^properties\.(\w+)$/)?.[1])
    .filter(Boolean);
  const documented = await propertyNames(fieldTable.locator('tbody tr'));
  const documentedGrade = await propertyNames(fieldTable.locator('tbody tr[data-field-group="street-grade"]'));

  expect(documentedGrade, 'the docs page has no street-grade field rows').not.toEqual([]);
  expect(streets.features.length, 'the preview fetched no streets to compare against').toBeGreaterThan(0);

  // Every street carries every key, null or not, so one feature speaks for the response.
  const served = Object.keys(streets.features[0].properties);
  expect(documentedGrade.filter((name) => !served.includes(name)), 'documented grade fields the API does not serve')
    .toEqual([]);
  expect(served.filter((name) => !documented.includes(name)), 'served properties the docs do not document')
    .toEqual([]);
  expect(documented.filter((name) => !served.includes(name)), 'documented properties the API does not serve')
    .toEqual([]);

  expect(consoleErrors).toEqual([]);
});
