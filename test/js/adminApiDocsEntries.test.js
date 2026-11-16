/**
 * Tests for the admin dashboard's and the API docs' page entries (frontend/js/pages/admin/, pages/api-docs/), #5840.
 * Each entry boots one page class or preview, so one table per directory checks that each boots its own with the
 * values its page data carries; the pages and previews are fakes here, their behavior covered by suites of their own.
 */

import { loadModules, mockModule } from './loader.js';
import { flush } from './support/routeFetch.js';

/** What the fakes saw during one page load; rebuilt per test. */
let h;

/**
 * A stand-in for an admin page class that records how it was built and what it was asked to do.
 * @param {string} name - The class's name, the key its record goes under in `h.pages`.
 * @returns {object} The module's exports: the fake class under that name.
 */
function fakePageModule(name) {
  return {
    [name]: class {
      constructor(...args) {
        this.record = { args, calls: [] };
        h.pages[name] = this.record;
      }

      init() { this.record.calls.push('init'); }

      setLabelPopup(popup) { this.record.calls.push(['setLabelPopup', popup]); }
    },
  };
}

/**
 * A stand-in for API docs preview modules whose `setup(opts).init()` records the options.
 * @param {...string} names - The preview classes the module exports.
 * @returns {object} The module's exports.
 */
function fakePreviewModule(...names) {
  return Object.fromEntries(names.map((name) => [name, {
    setup: (opts) => ({
      init: () => {
        h.previews[name] = opts;
        return h.previewInit(name);
      },
    }),
  }]));
}

const ADMIN_PAGES = ['AcrossCitiesPage', 'ActivityPage', 'ApiAnalyticsPage', 'ContributorsPage', 'FunnelsSection',
  'CoveragePage', 'HealthPage', 'HumanVsAiPage', 'ImageryPage', 'LabelMapPage', 'ManagementPage', 'OverviewPage',
  'PartnersPage', 'DataQualityPage', 'SidewalksPage', 'StoriesPage', 'StreetStatusPage', 'TeamPage'];
for (const name of ADMIN_PAGES) {
  mockModule(`frontend/js/admin-dashboard/${name}.js`, () => fakePageModule(name));
}

const PREVIEWS = {
  accessScoreIntersectionsPreview: ['AccessScoreIntersectionsPreview'],
  accessScoreRegionsPreview: ['AccessScoreRegionsPreview'],
  accessScoreStreetsPreview: ['AccessScoreStreetsPreview'],
  aggregateStatsPreview: ['AggregateStatsPreview'],
  labelClustersPreview: ['LabelClustersPreview'],
  labelTagsPreview: ['LabelTagsPreview'],
  labelTypesPreview: ['LabelTypesPreview'],
  overallStatsPreview: ['OverallStatsPreview'],
  placesPreview: ['PlacesPreview'],
  rawLabelsPreview: ['RawLabelsPreview'],
  regionsPreview: ['RegionsPreview'],
  sidewalkPresencePreview: ['SidewalkPresencePreview'],
  statsByDayPreview: ['AggregateStatsByDayPreview', 'OverallStatsByDayPreview'],
  streetGradePreview: ['StreetGradePreview'],
  streetsPreview: ['StreetsPreview'],
  streetTypesPreview: ['StreetTypesPreview'],
  userStatsPreview: ['UserStatsPreview'],
  validationResultTypesPreview: ['ValidationResultTypesPreview'],
  validationsPreview: ['ValidationsPreview'],
};
for (const [file, names] of Object.entries(PREVIEWS)) {
  mockModule(`frontend/js/api-docs/${file}.js`, () => fakePreviewModule(...names));
}

mockModule('frontend/js/api-docs/apiDocs.js', () => ({
  generateTableOfContents: () => h.docs.push('toc'),
  setupScrollSpy: () => h.docs.push('scrollSpy'),
}));
mockModule('frontend/js/api-docs/bibtexDownload.js', () => ({ setupBibtexDownload: () => h.docs.push('bibtex') }));
// Loaded for what it sets up on the page: the stats it fetches have their own suite.
mockModule('frontend/js/common/aggregateStats.js', () => ({}));
mockModule('frontend/js/admin-dashboard/AdminShell.js', () => ({}));
mockModule('prismjs', () => ({ default: { highlightAll: () => h.docs.push('highlight') } }));
mockModule('prismjs/components/prism-json', () => ({}));
mockModule('prismjs/components/prism-csv', () => ({}));
mockModule('frontend/js/common/label-detail/LabelPopup.js', () => ({
  LabelPopup: (...args) => { h.popupArgs = args; return h.popupResult(); },
}));
mockModule('frontend/js/common/pano-viewer/viewerClassFor.js', () => ({
  viewerClassFor: (src) => { h.imagerySource = src; return h.Viewer; },
}));
mockModule('frontend/js/ps-map/createPSMap.js', () => ({
  createPSMap: (params) => { h.mapParams = params; return h.mapResult(); },
}));

/**
 * Loads an entry with the given page-entry data and lets its ready handler finish.
 * @param {string} entry - Path under frontend/js/pages/.
 * @param {Record<string, string>} [data] - The page-entry `data-*` values, camelCased.
 * @param {string} [markup] - The rest of the page.
 * @returns {Promise<void>} Resolves once the page has started.
 */
async function boot(entry, data = {}, markup = '') {
  document.body.innerHTML = `<div id="page-entry"></div>${markup}`;
  Object.assign(document.getElementById('page-entry').dataset, data);
  delete document.documentElement.dataset.apiEndpoint;
  await loadModules(`frontend/js/pages/${entry}`);
  await flush();
}

beforeEach(() => {
  h = { pages: {}, previews: {}, docs: [], Viewer: function Viewer() {} };
  h.popup = { id: 'popup' };
  h.popupResult = () => Promise.resolve(h.popup);
  h.previewInit = () => Promise.resolve();
  h.mapResult = () => Promise.resolve([]);
  window.appManager = { ready: (fn) => fn() };
});

describe('admin dashboard entries', () => {
  test.each([
    ['acrossCities', 'AcrossCitiesPage', { storiesPath: '/admin/stories', mapboxToken: 'pk' },
      [expect.objectContaining({ storiesPath: '/admin/stories', mapboxToken: 'pk' })]],
    ['apiAnalytics', 'ApiAnalyticsPage', {}, [expect.any(Object)]],
    ['contributors', 'ContributorsPage', {}, [expect.any(Object)]],
    ['contributors', 'FunnelsSection', {}, [expect.objectContaining({ hostId: 'funnel-blocks' })]],
    ['coverage', 'CoveragePage', { mapboxToken: 'pk' }, [expect.objectContaining({ mapboxToken: 'pk' })]],
    ['health', 'HealthPage', {}, [expect.any(Object)]],
    ['humansVsAi', 'HumanVsAiPage', {}, [expect.any(Object)]],
    ['imagery', 'ImageryPage', { mapboxToken: 'pk', priorityUrl: '/p', pipelineUrl: '/q', pipelineDays: '30' },
      [expect.objectContaining({ mapboxToken: 'pk', priorityUrl: '/p', pipelineUrl: '/q', pipelineDays: 30 })]],
    ['management', 'ManagementPage', { assignableRoles: '["Researcher","Administrator"]' },
      [expect.any(Object), ['Researcher', 'Administrator']]],
    ['overview', 'OverviewPage', {}, [expect.any(Object)]],
    ['partners', 'PartnersPage', { isOwner: 'true' }, [{ isOwner: true }]],
    ['partners', 'PartnersPage', {}, [{ isOwner: false }]],
    ['quality', 'DataQualityPage', {}, [expect.any(Object)]],
    ['sidewalks', 'SidewalksPage', { mapboxToken: 'pk', presenceUrl: '/sp' },
      [expect.objectContaining({ mapboxToken: 'pk', presenceUrl: '/sp' })]],
    ['streetStatus', 'StreetStatusPage', { mapboxToken: 'pk', trendWeeks: '12' },
      [expect.objectContaining({ mapboxToken: 'pk', trendWeeks: 12 })]],
    ['team', 'TeamPage', { teamId: '7' }, [7, expect.any(Object)]],
  ])('%s boots its %s with the page\'s values', async (entry, page, data, args) => {
    await boot(`admin/${entry}.js`, data);
    expect(h.pages[page].args).toEqual(args);
    expect(h.pages[page].calls).toEqual(['init']);
  });

  test('labelMap hands its page the viewer for the city\'s imagery, and the admin\'s token and name', async () => {
    await boot('admin/labelMap.js', {
      mapboxToken: 'pk', imagerySource: 'gsv', imageryAccessToken: 'tok', username: 'a',
    });
    expect(h.imagerySource).toBe('gsv');
    expect(h.pages.LabelMapPage.args)
      .toEqual([{ mapboxToken: 'pk', viewerType: h.Viewer, accessToken: 'tok', username: 'a' }]);
  });

  test.each([['activity', 'ActivityPage', 'Activity'], ['stories', 'StoriesPage', 'Stories']])(
    '%s opens its labels in an admin popup once the viewer is up, or keeps its links if that fails',
    async (entry, page, logName) => {
      await boot(`admin/${entry}.js`, { imagerySource: 'gsv', imageryAccessToken: 'tok', username: 'a' });
      expect(h.popupArgs).toEqual([true, h.Viewer, 'tok', 'a']);
      expect(h.pages[page].calls).toEqual(['init', ['setLabelPopup', h.popup]]);

      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failure = new Error('viewer down');
      h.popupResult = () => Promise.reject(failure);
      await boot(`admin/${entry}.js`);
      expect(h.pages[page].calls).toEqual(['init']);
      expect(error).toHaveBeenCalledWith(
        `${logName} page: label popup failed to initialize; links will navigate instead.`, failure);
    });
});

describe('API docs entries', () => {
  test.each([
    ['accessScoreIntersections', 'AccessScoreIntersectionsPreview', { mapboxApiKey: 'pk' }],
    ['accessScoreRegions', 'AccessScoreRegionsPreview', { mapboxApiKey: 'pk' }],
    ['accessScoreStreets', 'AccessScoreStreetsPreview', { mapboxApiKey: 'pk' }],
    ['aggregateStatsByDay', 'AggregateStatsByDayPreview', { apiBaseUrl: '/v3/api' }],
    ['aggregateStats', 'AggregateStatsPreview', { maxWidth: 1000 }],
    ['labelClusters', 'LabelClustersPreview', { mapboxApiKey: 'pk' }],
    ['labelTypes', 'LabelTypesPreview', { maxWidth: 1000 }],
    ['overallStatsByDay', 'OverallStatsByDayPreview', { apiBaseUrl: '/v3/api', cityName: 'Seattle' }],
    ['overallStats', 'OverallStatsPreview', { apiBaseUrl: '/v3/api', cityName: 'Seattle' }],
    ['places', 'PlacesPreview', { mapboxApiKey: 'pk' }],
    ['rawLabels', 'RawLabelsPreview', { mapboxApiKey: 'pk' }],
    ['regions', 'RegionsPreview', { mapboxApiKey: 'pk' }],
    ['sidewalkPresence', 'SidewalkPresencePreview', { mapboxApiKey: 'pk' }],
    ['streetGrade', 'StreetGradePreview', { mapboxApiKey: 'pk' }],
    ['streets', 'StreetsPreview', { mapboxApiKey: 'pk' }],
    ['streetTypes', 'StreetTypesPreview', { maxWidth: 1000 }],
    ['userStats', 'UserStatsPreview', { containerHeight: 500, apiBaseUrl: '/v3/api', cityName: 'Seattle' }],
    ['validationResultTypes', 'ValidationResultTypesPreview', { maxWidth: 1000 }],
    ['validations', 'ValidationsPreview', { maxChartsToShow: 6, minValidationsToShow: 10 }],
  ])('%s names its endpoint for the download buttons and starts its %s', async (entry, preview, opts) => {
    await boot(`api-docs/${entry}.js`, { mapboxApiKey: 'pk', cityName: 'Seattle' });
    expect(document.documentElement.dataset.apiEndpoint).toBe(entry);
    expect(document.documentElement.dataset.apiBaseUrl).toBe('/v3/api');
    expect(h.previews[preview]).toEqual(opts);
  });

  test('labelEdits, which has no preview, still names its endpoint', async () => {
    await boot('api-docs/labelEdits.js');
    expect(document.documentElement.dataset.apiEndpoint).toBe('labelEdits');
  });

  test('labelTags builds the contents list and scroll spy once its preview has drawn its headings', async () => {
    await boot('api-docs/labelTags.js');
    expect(h.previews.LabelTagsPreview).toEqual({ maxWidth: 1000 });
    expect(h.docs).toEqual(['toc', 'scrollSpy']);
  });

  test('the index shows both previews and builds the contents list after the tag summary', async () => {
    await boot('api-docs/index.js');
    expect(h.previews.LabelTypesPreview).toEqual({ maxWidth: 1000 });
    expect(h.previews.LabelTagsPreview).toEqual({ maxWidth: 1000, displayMode: 'summary' });
    expect(h.docs).toEqual(['toc']);
  });

  test.each([
    ['labelTags', 'Error initializing label tags preview or refreshing TOC:'],
    ['index', 'Error initializing label tags summary:'],
  ])('%s logs a tag preview that fails and builds no contents list', async (entry, message) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('500');
    h.previewInit = (name) => (name === 'LabelTagsPreview' ? Promise.reject(failure) : Promise.resolve());
    await boot(`api-docs/${entry}.js`);
    expect(error).toHaveBeenCalledWith(message, failure);
    expect(h.docs).toEqual([]);
  });

  test('cities draws the world map of deployments, at once and without scroll zoom', async () => {
    await boot('api-docs/cities.js', { mapboxApiKey: 'pk' }, '<div id="cities-preview"></div>');
    expect(document.documentElement.dataset.apiEndpoint).toBe('cities');
    expect(h.mapParams).toMatchObject({
      mapName: 'cities-preview', mapboxApiKey: 'pk', loadCities: true, scrollWheelZoom: false, animateCityFit: false,
    });
  });

  test('cities shows an error in place of a map that fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('500');
    h.mapResult = () => Promise.reject(failure);
    await boot('api-docs/cities.js', {}, '<div id="cities-preview"></div>');
    expect(error).toHaveBeenCalledWith('Cities preview error:', failure);
    expect(document.querySelector('#cities-preview [role="alert"]').textContent).toBe('Failed to load cities data.');
  });

  test('every docs page highlights its code once, by hand, and wires the BibTeX download', async () => {
    await boot('api-docs/layout.js');
    expect(h.docs).toEqual(['highlight', 'bibtex']);
  });
});
