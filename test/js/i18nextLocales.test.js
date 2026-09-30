/**
 * Runs the vendored i18next and i18next-http-backend over our real locale files, set up by the real AppManager.
 *
 * This is the check to lean on when bumping either library: it loads every supported language the way a page does
 * and confirms that each language's own strings, plurals, interpolation, the distance formatter, the fallback to
 * English, the regional English overlays, and the country overrides all still come out right.
 *
 * It says nothing about whether a language is fully translated: `make lint-locales` owns that.
 *
 * Both libraries are found by folder rather than by filename, so a version bump needs no edit here. The only
 * stand-in is `fetch`, which serves public/locales/ from disk and 404s anything that isn't there.
 * The page is told which files exist the way the server tells it, by listing public/locales/.
 */

const fs = require('fs');
const path = require('path');
const { loadGlobalScript, loadVendored, REPO_ROOT, assetPathStub } = require('./loadGlobalScript');

const LOCALES_DIR = path.join(REPO_ROOT, 'public/locales');
const LANGUAGES = fs.readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
const NAMESPACES = fs.readdirSync(path.join(LOCALES_DIR, 'en'))
    .filter((file) => file.endsWith('.json') && !/-(india|zurich)\.json$/.test(file))
    .map((file) => file.replace('.json', ''));
const LOCALE_FILES = LANGUAGES.flatMap((language) => fs.readdirSync(path.join(LOCALES_DIR, language))
    .map((file) => `locales/${language}/${file}`));
const UNIT_WORDS = { unitAbbr: 'km', unitAbbrSmall: 'm', unitName: 'kilometers', unitNameSingular: 'kilometer' };
const PLURAL_SUFFIX = /_(zero|one|other)$/;

/** Reads one locale file, or null where that language has no such file. */
function readLocale(language, namespace) {
    const file = path.join(LOCALES_DIR, language, `${namespace}.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

/** Flattens nested translations into `a.b.c` keys, the form `t()` takes. */
function flatten(tree, prefix = '', out = {}) {
    for (const [key, value] of Object.entries(tree ?? {})) {
        const full = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object') flatten(value, full, out);
        else out[full] = value;
    }
    return out;
}

/** The keys whose string comes back from `t()` exactly as written: no plural forms, variables, or nested keys. */
function plainKeys(strings) {
    return Object.keys(strings).filter((key) => !PLURAL_SUFFIX.test(key) && !/\{\{|\$t\(/.test(strings[key]));
}

// One English string that the stand-in `fetch` leaves out of every other language, so there is always a string to
// watch fall back to English: the real files are kept complete by `make lint-locales`.
const WITHHELD = plainKeys(flatten(readLocale('en', 'common'))).find((key) => !key.includes('.'));

/**
 * Starts i18next the way a page does and waits for its translations.
 * @param {string} language - The reader's language.
 * @param {object} [options]
 * @param {string} [options.countryId] - The deployment's country, which decides the override namespaces.
 * @param {(url: string) => Promise<object>} [options.fetch] - Replaces the stand-in `fetch`.
 * @param {string[]} [options.missing] - Files, as `<language>/<namespace>.json`, the stand-in `fetch` 404s anyway.
 * @param {string[]} [options.localeFiles] - The locale files the page is told exist, if not the real ones.
 * @returns {Promise<{requested: string[], consoleError: jest.SpyInstance}>} The locale files the page asked for,
 *   as `<language>/<namespace>.json`, and what it reported as errors.
 */
async function startPage(language, { countryId = 'usa', fetch, missing = [], localeFiles = LOCALE_FILES } = {}) {
    const requested = [];
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    window.fetch = fetch ?? (async (url) => {
        const relative = String(url).replace('/assets/locales/', '');
        requested.push(relative);
        const file = path.join(LOCALES_DIR, relative);
        const found = fs.existsSync(file) && !missing.includes(relative);
        let body = found ? fs.readFileSync(file, 'utf8') : '';
        if (found && relative !== 'en/common.json' && relative.endsWith('/common.json')) {
            const strings = JSON.parse(body);
            delete strings[WITHHELD];
            body = JSON.stringify(strings);
        }
        return { ok: found, status: found ? 200 : 404, statusText: '', headers: new Map(), text: async () => body };
    });
    loadVendored('i18next');
    loadVendored('i18next-http-backend');
    window.util = {
        assetPath: assetPathStub,
        isMetric: () => true,
        math: {
            metersToFeet: (meters) => meters * 3.28084,
            kmsToMiles: (km) => km * 0.621371,
            roundToTwentyFive: (n) => Math.round(n / 25) * 25,
        },
    };
    loadGlobalScript('public/js/common/AppManager.js');
    await window.appManager._setupI18next({
        language, supportedLanguages: LANGUAGES, localeFiles, defaultNS: 'common', namespaces: NAMESPACES, countryId,
        unitWords: UNIT_WORDS,
    });
    return { requested, consoleError };
}

/** Takes down what `startPage` put up, so the next page starts from nothing. */
function stopPage() {
    jest.restoreAllMocks();
    for (const name of ['appManager', 'i18next', 'i18nextHttpBackend', 'util', 'fetch']) delete window[name];
}

describe('the vendored i18next over our locale files', () => {
    describe.each(LANGUAGES)('in %s', (language) => {
        let page;

        beforeAll(async () => {
            page = await startPage(language);
        });

        afterAll(stopPage);

        test('loads without an error, asking only for languages we have', () => {
            expect(page.consoleError).not.toHaveBeenCalled();
            expect(window.i18next.language).toBe(language);
            expect([...new Set(page.requested.map((file) => file.split('/')[0]))].sort())
                .toEqual([...new Set([language, 'en'])].sort());
        });

        test('shows its own strings, not the English ones', () => {
            const wrong = [];
            for (const namespace of NAMESPACES) {
                const own = flatten(readLocale(language, namespace));
                for (const key of plainKeys(own)) {
                    if (language !== 'en' && namespace === 'common' && key === WITHHELD) continue;
                    if (window.i18next.t(`${namespace}:${key}`) !== own[key]) wrong.push(`${namespace}:${key}`);
                }
            }
            expect(wrong).toEqual([]);
        });

        test('falls back to English for a string it does not have', () => {
            expect(window.i18next.t(`common:${WITHHELD}`)).toBe(readLocale('en', 'common')[WITHHELD]);
        });

        test('picks the plural form the count calls for', () => {
            const own = flatten(readLocale(language, 'common'));
            const english = flatten(readLocale('en', 'common'));
            const key = Object.keys(english).find((k) => k.endsWith('_one') && `${k.slice(0, -4)}_other` in english)
                .slice(0, -4);
            const expected = (suffix, count) => (own[`${key}_${suffix}`] ?? english[`${key}_${suffix}`])
                .replace(/\{\{count(, number)?\}\}/, new Intl.NumberFormat(language).format(count));
            // Chinese has a single plural form, so a count of one reads the `_other` string there.
            const singular = new Intl.PluralRules(language).select(1);
            expect(window.i18next.t(`common:${key}`, { count: 1 })).toBe(expected(singular, 1));
            expect(window.i18next.t(`common:${key}`, { count: 5 })).toBe(expected('other', 5));
        });

        test('renders a distance through our formatter, with the unit the page was given', () => {
            const rendered = window.i18next.t('accessscore:length', { meters: 412 });
            expect(rendered).toContain(new Intl.NumberFormat(language).format(400));
            expect(rendered).toContain(UNIT_WORDS.unitAbbrSmall);
            expect(rendered).not.toContain('{{');
        });
    });

    describe.each(['en-US', 'en-NZ'])('the %s overlay', (language) => {
        afterEach(stopPage);

        test('uses plain English for everything it leaves alone', async () => {
            await startPage(language);
            const namespace = NAMESPACES.find((ns) => readLocale(language, ns));
            const overlay = flatten(readLocale(language, namespace));
            const english = flatten(readLocale('en', namespace));
            const inherited = plainKeys(english).find((key) => !(key in overlay));
            expect(window.i18next.t(`${namespace}:${inherited}`)).toBe(english[inherited]);
        });
    });

    describe.each([['india', 'india'], ['switzerland', 'zurich']])('a deployment in %s', (countryId, suffix) => {
        afterEach(stopPage);

        test('reads its override strings in place of the standard ones', async () => {
            const { consoleError } = await startPage('en', { countryId });
            const namespace = NAMESPACES.find((ns) => readLocale('en', `${ns}-${suffix}`));
            const overrides = flatten(readLocale('en', `${namespace}-${suffix}`));
            const key = plainKeys(overrides)[0];
            expect(window.i18next.t(`${namespace}:${key}`)).toBe(overrides[key]);
            expect(consoleError).not.toHaveBeenCalled();
        });

        test('asks only for override files that exist, in every language', async () => {
            for (const language of LANGUAGES) {
                const { requested } = await startPage(language, { countryId });
                expect(requested.filter((file) => !fs.existsSync(path.join(LOCALES_DIR, file)))).toEqual([]);
                expect(requested).toContain(`en/common-${suffix}.json`);
                stopPage();
            }
        });
    });

    describe('a locale file the page expects but cannot load', () => {
        afterEach(stopPage);

        test('is reported, and the rest of the page is still translated', async () => {
            const { consoleError } = await startPage('en', { countryId: 'india', missing: ['en/validate.json'] });
            expect(consoleError).toHaveBeenCalledTimes(1);
            expect(String(consoleError.mock.calls[0][0])).toContain('status code: 404');
            const overrides = flatten(readLocale('en', 'common-india'));
            const key = plainKeys(overrides)[0];
            expect(window.i18next.t(`common:${key}`)).toBe(overrides[key]);
        });
    });

    describe('a page given no locale file list', () => {
        afterEach(stopPage);

        test('reports it, instead of quietly showing raw keys', async () => {
            const { requested, consoleError } = await startPage('en', { localeFiles: [] });
            expect(requested).toEqual([]);
            expect(String(consoleError.mock.calls[0][0])).toContain('no locale files listed');
        });
    });

    describe('a request that fails outright', () => {
        afterEach(stopPage);

        test('is reported, even when it arrives as an Error object and not as text', async () => {
            const { consoleError } = await startPage('en', {
                fetch: async () => { throw new Error('The operation was aborted.'); },
            });
            expect(consoleError).toHaveBeenCalledTimes(1);
            expect(String(consoleError.mock.calls[0][0])).toContain('The operation was aborted.');
        });
    });
});
