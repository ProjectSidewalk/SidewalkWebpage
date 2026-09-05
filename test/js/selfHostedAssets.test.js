/**
 * Pins two properties of our own stylesheets under public/css/.
 *
 * **Everything they load, we serve.** A stylesheet that reaches out to a third-party host puts that host in the
 * render path of a page we serve: the URLs a font CDN hands out rotate underneath a stable-looking version number,
 * so a face that resolves today can 404 tomorrow and fail an unrelated build — and every visitor's IP goes to that
 * host as the price. Self-hosting is the standing rule for both, and this is what keeps the next exception out.
 *
 * **A font token can't name a face we don't ship.** A `--font-*` token whose preferred family has no `@font-face`
 * anywhere silently resolves to whatever the platform supplies, and it does so page by page — the kind of gap that
 * shows up as one page's monospace looking nothing like another's, with nothing in the CSS to explain it.
 *
 * Third-party libraries under public/vendor/ are out of scope by convention — we neither edit nor lint them.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CSS_ROOT = path.join(REPO_ROOT, 'public', 'css');

/** @returns {string[]} Every .css file under public/css/, recursively, as repo-relative paths. */
function ourStylesheets(dir = CSS_ROOT) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return ourStylesheets(full);
        return entry.name.endsWith('.css') ? [path.relative(REPO_ROOT, full)] : [];
    });
}

const STYLESHEETS = ourStylesheets();
const read = (relPath) => fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');

/** Every url(...) target in a stylesheet, unquoted. @returns {string[]} */
function urlTargets(css) {
    return Array.from(css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)).map((m) => m[2].trim());
}

describe('our stylesheets are self-contained', () => {
    test('there is at least one stylesheet to check, so a broken walk cannot pass vacuously', () => {
        expect(STYLESHEETS.length).toBeGreaterThan(10);
        expect(STYLESHEETS).toContain('public/css/fonts.css');
        expect(STYLESHEETS).toContain('public/css/pages/api-docs/api-docs.css');
    });

    test('none of them @imports anything', () => {
        // Remote or local: an @import is a render-blocking round trip discovered only after the CSS parses, and the
        // remote kind is the one that broke. Stylesheets are linked from the Twirl views instead.
        const offenders = STYLESHEETS.filter((f) => /@import/.test(read(f)));
        expect(offenders).toEqual([]);
    });

    test('every asset they reference is same-origin', () => {
        const offenders = [];
        for (const file of STYLESHEETS) {
            for (const target of urlTargets(read(file))) {
                if (/^(https?:)?\/\//.test(target)) offenders.push(`${file} -> ${target}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    test('every file they reference exists on disk', () => {
        const missing = [];
        for (const file of STYLESHEETS) {
            for (const target of urlTargets(read(file))) {
                if (target.startsWith('data:') || /^(https?:)?\/\//.test(target)) continue;
                // Stylesheets address our assets either absolutely (/assets/... — how Play serves public/) or
                // relative to the stylesheet's own directory.
                const resolved = target.startsWith('/assets/')
                    ? path.join(REPO_ROOT, 'public', target.slice('/assets/'.length))
                    : path.resolve(path.dirname(path.join(REPO_ROOT, file)), target);
                if (!fs.existsSync(resolved.split('?')[0].split('#')[0])) missing.push(`${file} -> ${target}`);
            }
        }
        expect(missing).toEqual([]);
    });
});

describe('the design system ships the faces its font tokens name', () => {
    /** Every font-family an @font-face in our CSS declares, lowercased — CSS matches family names case-insensitively. */
    const declaredFamilies = new Set(
        STYLESHEETS.flatMap((file) => Array.from(
            read(file).matchAll(/@font-face\s*\{[^}]*?font-family:\s*(['"]?)([^;'"]+)\1\s*;/g),
        ).map((m) => m[2].trim().toLowerCase())),
    );

    /**
     * The first (i.e. preferred) family in each --font-* token that holds a family stack — the one a webfont has to
     * supply. `--font-size-*` and friends name a measurement rather than a face, so they are not in this set.
     */
    const tokenFamilies = STYLESHEETS.flatMap((file) => Array.from(
        read(file).matchAll(/^\s*(--font-(?!size|weight|style|variant|feature|display)[\w-]+):\s*([^;]+);/gm),
    ).map((m) => ({
        file,
        token: m[1],
        family: m[2].split(',')[0].trim().replace(/^['"]|['"]$/g, '').toLowerCase(),
    })));

    test('the tokens and the faces were both found, so these assertions mean something', () => {
        expect(declaredFamilies).toContain('mulish');
        expect(tokenFamilies.map((t) => t.token)).toEqual(
            expect.arrayContaining(['--font-primary', '--font-accent', '--font-mono']),
        );
    });

    test('every --font-* token names a family some @font-face declares', () => {
        // Generic keywords are the platform's to supply, not ours.
        const GENERIC = new Set(['system-ui', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy']);
        const unshipped = tokenFamilies
            .filter((t) => !GENERIC.has(t.family) && !declaredFamilies.has(t.family))
            .map((t) => `${t.file}: ${t.token} -> "${t.family}"`);
        expect(unshipped).toEqual([]);
    });

    test('the two families the API docs are set in are among them', () => {
        expect(declaredFamilies).toContain('mulish');
        expect(declaredFamilies).toContain('jetbrains mono');
    });

    /**
     * Every weight each family declares a face for. A face with a range (`font-weight: 200 1000`, a variable font)
     * covers all of it; a bare weight covers only itself; an omitted descriptor means normal, i.e. 400.
     * @returns {Map<string, Array<[number, number]>>} Family (lowercased) to the weight ranges it declares.
     */
    function declaredWeights() {
        const KEYWORDS = { normal: 400, bold: 700 };
        const byFamily = new Map();
        for (const file of STYLESHEETS) {
            for (const [, body] of read(file).matchAll(/@font-face\s*\{([^}]*)\}/g)) {
                const family = /font-family:\s*(['"]?)([^;'"]+)\1\s*;/.exec(body)?.[2].trim().toLowerCase();
                if (!family) continue;
                const spec = (/font-weight:\s*([^;]+);/.exec(body)?.[1] ?? 'normal').trim();
                const parts = spec.split(/\s+/).map((p) => KEYWORDS[p] ?? Number(p));
                const range = [parts[0], parts[1] ?? parts[0]];
                if (!byFamily.has(family)) byFamily.set(family, []);
                byFamily.get(family).push(range);
            }
        }
        return byFamily;
    }

    test('no type token asks for a weight its family would have to fake', () => {
        // A weight with no face behind it is drawn by smearing the nearest one. It is the failure that looks like
        // nothing at all — the heading is still bold, just not the bold the type designer drew, and a little wider
        // or narrower than the real thing.
        const weights = declaredWeights();
        const tokenFamily = new Map(tokenFamilies.map((t) => [t.token, t.family]));
        const faked = [];

        const textTokens = STYLESHEETS.flatMap((file) => Array.from(
            read(file).matchAll(/^\s*(--text-[\w-]+):\s*(\d{2,3})\s+.*?var\((--font-[\w-]+)\)/gm),
        ).map((m) => ({ token: m[1], weight: Number(m[2]), fontToken: m[3] })));

        expect(textTokens.length).toBeGreaterThan(10); // The tokens were found, so this isn't passing vacuously.

        for (const { token, weight, fontToken } of textTokens) {
            const family = tokenFamily.get(fontToken);
            const ranges = weights.get(family) ?? [];
            if (!ranges.some(([lo, hi]) => weight >= lo && weight <= hi)) {
                faked.push(`${token}: weight ${weight} of "${family}" (declared: ${JSON.stringify(ranges)})`);
            }
        }
        expect(faked).toEqual([]);
    });

    test('every self-hosted family ships the license it is redistributed under', () => {
        // Serving a font file over HTTP is distribution, and both licenses in play require their text to travel
        // with the files: Apache 2.0 §4(a), SIL OFL 1.1 condition 2. Each family's own binaries name which one
        // applies (its `name` table, IDs 0/13/14) — read it from there rather than from whatever upstream says
        // today, since a family can be relicensed after the copy we ship was taken.
        const FONTS_ROOT = path.join(REPO_ROOT, 'public', 'fonts');
        const families = fs.readdirSync(FONTS_ROOT, { withFileTypes: true })
            .filter((e) => e.isDirectory()).map((e) => e.name);

        expect(families.length).toBeGreaterThanOrEqual(3); // Not passing vacuously on an empty read.

        const undocumented = [];
        for (const family of families) {
            const license = ['OFL.txt', 'LICENSE.txt']
                .map((name) => path.join(FONTS_ROOT, family, name))
                .find((candidate) => fs.existsSync(candidate));
            if (!license) {
                undocumented.push(`${family}: no OFL.txt or LICENSE.txt`);
                continue;
            }
            const text = fs.readFileSync(license, 'utf8');
            const named = text.includes('SIL OPEN FONT LICENSE Version 1.1')
                || text.includes('Apache License');
            if (!named) undocumented.push(`${family}: license file names no license`);
            // The notice is half of what both licenses ask for, and it is per-family.
            if (!/copyright/i.test(text)) undocumented.push(`${family}: license file carries no copyright notice`);
        }
        expect(undocumented).toEqual([]);
    });
});

/**
 * The same rule the stylesheets are held to, applied to the views and to the policy that describes them.
 *
 * A `<script src>` or `<link rel=stylesheet>` pointing at another host makes that host part of our render path:
 * its availability becomes our availability, its outage our outage, and every visitor's IP goes to it. Subresource
 * integrity does not change that — it protects the bytes, not the delivery, and a legitimate upstream repack turns
 * into a hard failure rather than a soft one. Libraries are vendored under public/vendor/ instead.
 *
 * A handful of third parties genuinely cannot be vendored, because what they serve is a live service rather than a
 * library. Those are named below, and the CSP has to know about them — which is the second half of this: an origin
 * the policy allows that nothing actually loads is a hole left open in a policy we intend to enforce (#4793).
 */
describe('nothing in the render path comes from a third party we have not chosen', () => {
    const VIEWS_ROOT = path.join(REPO_ROOT, 'app', 'views');

    // Remote by nature: gtag.js is versionless and rewritten server-side, and the Maps JS API is a keyed service.
    const MUST_BE_REMOTE = ['www.googletagmanager.com', 'maps.googleapis.com'];

    /** @returns {string[]} Every .scala.html under app/views, as repo-relative paths. */
    function views(dir = VIEWS_ROOT) {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) return views(full);
            return entry.name.endsWith('.scala.html') ? [path.relative(REPO_ROOT, full)] : [];
        });
    }

    const VIEWS = views();

    test('the views were found, so these assertions are not passing vacuously', () => {
        expect(VIEWS.length).toBeGreaterThan(50);
        expect(VIEWS).toContain('app/views/apiDocs/rawLabels.scala.html');
    });

    test('no view loads a script or stylesheet from an unlisted origin', () => {
        const LOADS = [
            /<script\b[^>]*\bsrc\s*=\s*"((?:https?:)?\/\/[^"]+)"/g,
            /<link\b[^>]*\bhref\s*=\s*"((?:https?:)?\/\/[^"]+)"/g,
        ];
        const offenders = [];
        for (const file of VIEWS) {
            const html = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
            for (const pattern of LOADS) {
                for (const [, url] of html.matchAll(pattern)) {
                    const host = url.replace(/^(https?:)?\/\//, '').split('/')[0];
                    if (!MUST_BE_REMOTE.includes(host)) offenders.push(`${file} -> ${url}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    test('every origin the CSP allows for scripts, styles, or fonts is one something actually loads', () => {
        // The direction that rots silently: a library gets vendored or deleted and its allowlist entry outlives it.
        const conf = fs.readFileSync(path.join(REPO_ROOT, 'conf', 'application.conf'), 'utf8');
        const origins = new Set();
        for (const directive of ['script-src', 'style-src', 'font-src']) {
            const value = new RegExp(`^\\s*${directive}\\s*=\\s*"([^"]*)"`, 'm').exec(conf)?.[1] ?? '';
            for (const token of value.split(/\s+/)) {
                if (token.startsWith('https://')) origins.add(token.replace('https://', ''));
            }
        }
        expect(origins.size).toBeGreaterThan(0);

        // Anywhere we ship: views, our own JS/CSS, and vendored libraries (which declare their own remote assets).
        // Only the file types that can name an origin — public/vendor/ also carries fonts, images and source maps,
        // and reading those in as text is megabytes of work per run for something that could never match.
        const TEXT = /\.(js|mjs|cjs|css|html|scala\.html|json|svg)$/;
        const haystack = ['app/views', 'public/js', 'public/css', 'public/vendor']
            .flatMap(function walk(rel) {
                const full = path.join(REPO_ROOT, rel);
                return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
                    if (entry.isDirectory()) return walk(path.join(rel, entry.name));
                    if (!TEXT.test(entry.name)) return [];
                    return [fs.readFileSync(path.join(full, entry.name), 'utf8')];
                });
            })
            .join('\n');

        // Google's Maps bootstrap assembles its own host at runtime (`https://maps.${c}apis.com/…`, with c="google"),
        // so the literal origin appears nowhere to be found. Pin the loader that builds it rather than exempting the
        // origin outright, so the exemption dies the day the loader does.
        const ASSEMBLED_AT_RUNTIME = {
            'maps.googleapis.com': { file: 'app/views/common/main.scala.html', fragment: 'maps.${c}apis.com' },
        };
        for (const [origin, { file, fragment }] of Object.entries(ASSEMBLED_AT_RUNTIME)) {
            expect(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8')).toContain(fragment);
            origins.delete(origin);
        }

        const unused = [...origins].filter((origin) => !haystack.includes(origin.replace(/^\*\./, '')));
        expect(unused).toEqual([]);
    });
});
