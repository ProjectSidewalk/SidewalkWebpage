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
        expect(STYLESHEETS).toContain('public/css/api-docs/api-docs.css');
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
            expect.arrayContaining(['--font-primary', '--font-accent', '--font-mono', '--font-sans']),
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
        expect(declaredFamilies).toContain('inter');
        expect(declaredFamilies).toContain('jetbrains mono');
    });

    test('each self-hosted family ships the license it is redistributed under', () => {
        // Inter and JetBrains Mono are SIL OFL 1.1, which requires the license to travel with the font files.
        for (const family of ['Inter', 'JetBrainsMono']) {
            const license = path.join(REPO_ROOT, 'public', 'fonts', family, 'OFL.txt');
            expect(fs.existsSync(license)).toBe(true);
            expect(fs.readFileSync(license, 'utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1');
        }
    });
});
