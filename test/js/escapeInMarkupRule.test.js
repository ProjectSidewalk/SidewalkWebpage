/**
 * @jest-environment node
 */

/**
 * Tests for the `escape-in-markup` ESLint rule (#5615): what it treats as safe, and where each report lands.
 *
 * Runs under node, not jsdom, because RuleTester needs `structuredClone`. Jest only reads the first docblock, hence
 * the split header.
 */

const { RuleTester } = require('eslint');
const rule = require('../../tools/lint/eslint-rules/escape-in-markup');

const ruleTester = new RuleTester({
    languageOptions: { ecmaVersion: 2022, sourceType: 'script' },
});

/**
 * An invalid case reporting on the given texts (found right after a `${`, or else their last occurrence).
 *
 * @param {string} code - The code under test.
 * @param {...string} texts - The source text of each reported node, in report order.
 * @returns {object} A RuleTester invalid case.
 */
function reports(code, ...texts) {
    return { code, errors: texts.map((text) => error(code, text, 'unescaped')) };
}

/**
 * Like `reports`, for tooltip-attribute reports.
 *
 * @param {string} code - The code under test.
 * @param {...string} texts - The source text of each reported node.
 * @returns {object} A RuleTester invalid case.
 */
function tooltipReports(code, ...texts) {
    return { code, errors: texts.map((text) => error(code, text, 'tooltip')) };
}

/**
 * The RuleTester error for a report on `text`.
 *
 * @param {string} code - The code under test.
 * @param {string} text - The reported node's source text.
 * @param {string} messageId - The expected message.
 * @returns {object} The error descriptor, with its column.
 */
function error(code, text, messageId) {
    const interpolated = code.indexOf(`\${${text}`);
    const at = interpolated >= 0 ? interpolated + 2 : code.lastIndexOf(text);
    if (at < 0) throw new Error(`no ${text} in: ${code}`);
    return { messageId, line: 1, column: at + 1, endColumn: at + 1 + text.length };
}

describe('escape-in-markup', () => {
    ruleTester.run('escape-in-markup', rule, {
        valid: [
            // Escaped, by the helper or an alias of it.
            { code: 'el.innerHTML = `<b>${util.escapeHTML(x)}</b>`;' },
            { code: 'function f(x) { const esc = util.escapeHTML; el.innerHTML = `<b>${esc(x)}</b>`; }' },
            { code: 'function f(x) { const name = util.escapeHTML(x); el.innerHTML = `<b>${name}</b>`; }' },

            // Values that can't hold markup.
            { code: 'el.innerHTML = `<b>${n * 2}</b><i>${xs.length}</i><u>${v.toFixed(1)}</u>`;' },
            { code: 'el.innerHTML = `<b>${-n}</b><i>${a < b}</i>`;' },
            { code: 'el.innerHTML = `<b>${new Date(t).toLocaleDateString()}</b>`;' },
            { code: 'el.innerHTML = `<b>${String(n * 2)}</b>`;' },
            { code: 'el.innerHTML = `<img src="${util.assetPath("x.svg")}">${i18next.t("ns:key")}`;' },
            { code: 'el.innerHTML = `<img src="${util.misc.getIconImagePaths(type).iconImagePath}">`;' },
            { code: 'el.innerHTML = `${i18next.t("ns:key", { defaultValue: "Fallback" })}`;' },
            // `a && b` only yields `a` when it is falsy.
            { code: 'el.innerHTML = `${x && "<b>y</b>"}`;' },

            // Literal tables and arrays, read by key, iterated, or destructured.
            { code: 'const LABELS = { a: "A", b: "B" }; function f(k) { el.innerHTML = `${LABELS[k]}`; }' },
            { code: 'el.innerHTML = ["a", "b"].map((o) => `<i class="${o}"></i>`).join("");' },
            { code: 'el.innerHTML = [{ k: "a" }, { k: "b" }].map(({ k }) => `<i class="${k}"></i>`).join("");' },
            { code: 'el.innerHTML = xs.map((x, i) => `<i data-i="${i}"></i>`).join("");' },
            { code: 'const T = { a: 1 }; el.innerHTML = Object.keys(T).map((k) => `<i class="${k}"></i>`).join("");' },
            { code: 'function f() { for (const o of ["a", "b"]) el.insertAdjacentHTML("beforeend", `<i>${o}</i>`); }' },

            // Helpers of this file, followed to their returns and their callers.
            { code: 'function f(x) { const cell = (v) => `<td>${util.escapeHTML(v)}</td>`; '
                + 'el.innerHTML = `<tr>${cell(x)}</tr>`; }' },
            { code: 'function f() { const row = (n) => `<td>${n}</td>`; el.innerHTML = `${row(1)}${row(2)}`; }' },
            { code: 'class A { #n = 0; set(k) { this.#n = k * 2; } render() { el.innerHTML = `${this.#n}`; } }' },
            { code: 'class A { render(x) { el.innerHTML = `<b>${this.#name(x)}</b>`; } '
                + '#name(x) { return util.escapeHTML(x); } }' },
            { code: 'class A { #rows = []; add(x) { this.#rows.push(util.escapeHTML(x)); } '
                + 'render() { el.innerHTML = `${this.#rows.join("")}`; } }' },
            // A `let` built up in branches, and an array built up by push, every value of them safe.
            { code: 'function f(x) { let chip = ""; if (x) chip = `<i>${util.escapeHTML(x)}</i>`; '
                + 'el.innerHTML = `<b>${chip}</b>`; }' },
            { code: 'function f(x) { const parts = []; parts.push(`<i>${util.escapeHTML(x)}</i>`); '
                + 'el.innerHTML = parts.join(""); }' },
            // Two helpers calling each other: safe however the analysis enters the cycle.
            { code: 'function f() { const a = (n) => (n ? b(n - 1) : "x"); const b = (n) => a(n); '
                + 'el.innerHTML = `${a(2)}${b(2)}`; }' },

            // A tooltip attribute: escaped twice, or escaped once around markup that escaped its own values.
            { code: 'el.innerHTML = `<i data-ps-tooltip="${AdminShell.tooltipAttr(x)}"></i>`;' },
            { code: 'el.innerHTML = `<i data-ps-tooltip="${util.escapeHTML(`<b>${util.escapeHTML(x)}</b>`)}"></i>`;' },
            { code: 'el.innerHTML = `<i data-ps-tooltip="${n * 2} of ${i18next.t("k")}"></i>`;' },
            // setAttribute is unescaped once, by psTooltip's innerHTML.
            { code: 'el.setAttribute("data-ps-tooltip", util.escapeHTML(x));' },

            // Not HTML: a text sink, a plain attribute, a string that goes nowhere this rule can see.
            { code: 'el.textContent = `${x}`;' },
            { code: 'el.setAttribute("aria-label", `${x}`);' },
            { code: 'function f(x) { return `${x}`; }' },
            { code: 'console.log(`${x}`);' },
        ],
        invalid: [
            reports('el.innerHTML = `<b>${x}</b>`;', 'x'),
            reports('el.insertAdjacentHTML("beforeend", `<b>${data.name}</b>`);', 'data.name'),
            reports('el.setAttribute("data-ps-tooltip", `${x}`);', 'x'),
            // Through a variable, a joined map, and a project helper that renders HTML.
            reports('function f(x) { const html = `<b>${x}</b>`; el.innerHTML = html; }', 'x'),
            reports('el.innerHTML = xs.map((x) => `<li>${x.name}</li>`).join("");', 'x.name'),
            reports('ApiDocsMap.popup(map, at, `<h4>${p.name}</h4>`);', 'p.name'),
            reports('AdminShell.setHtml("id", `<b>${x}</b>`);', 'x'),
            reports('function f(d) { const show = (m) => { el.innerHTML = m; }; show(`<b>${d.msg}</b>`); }', 'd.msg'),
            // A string method passes its receiver through; join passes its separator through too.
            reports('el.innerHTML = `<b>${x.trim().toUpperCase()}</b>`;', 'x'),
            reports('el.innerHTML = `<b>${["a"].join(sep)}</b>`;', 'sep'),
            // A method chained off a trusted call isn't trusted.
            reports('el.innerHTML = `<b>${util.misc.labelTypeName(t).replace("X", d.name)}</b>`;', 'd.name'),
            // A translation prints its defaultValue when the key is missing.
            reports('el.innerHTML = `<b>${i18next.t("k", { defaultValue: d.name })}</b>`;',
                'i18next.t("k", { defaultValue: d.name })'),

            // One unsafe caller makes the parameter unsafe, reported where it enters the HTML.
            reports('function f(d) { const row = (n) => `<td>${n}</td>`; el.innerHTML = `${row(1)}${row(d.name)}`; }', 'n'),
            // A top-level function can be called from any file in the bundle, so its parameters are unknown.
            reports('function cell(v) { return `<td>${v}</td>`; } el.innerHTML = `<tr>${cell(1)}</tr>`;', 'v'),
            // A helper returning raw data, or a plain-text template, is reported at the call: that's where the
            // escape goes, since other callers may use the text as text.
            reports('function f(d) { const name = () => d.name; el.innerHTML = `<b>${name()}</b>`; }', 'name()'),
            reports('function f(d) { const label = (u) => `${u} ${d.unit}`; el.innerHTML = `<b>${label(1)}</b>`; }',
                'label(1)'),

            // Collections: what is pushed counts; a nested change, or handing it to other code, makes it unknown.
            reports('function f(d) { const xs = []; xs.push(d.name); el.innerHTML = `${xs.join(", ")}`; }', 'xs'),
            reports('function f(d) { const xs = []; xs.push(d.name); el.innerHTML = `${xs[0]}`; }', 'xs[0]'),
            reports('function f(d) { const M = { a: { l: "A" } }; M.a.l = d.x; el.innerHTML = `${M.a.l}`; }', 'M.a.l'),
            reports('function f(d) { const xs = ["a"]; fill(xs); el.innerHTML = `${xs.join("")}`; }', 'xs'),
            reports('function f(d) { const xs = ["a"]; const ys = xs; ys.push(d.x); el.innerHTML = `${xs[0]}`; }',
                'xs[0]'),
            reports('class A { #rows = []; add(d) { this.#rows.push(d.name); } '
                + 'render() { el.innerHTML = `${this.#rows.join("")}`; } }', 'this.#rows'),
            reports('class A { #o = {}; set(d) { Object.assign(this.#o, d); } '
                + 'render() { el.innerHTML = `${this.#o.name}`; } }', 'this.#o.name'),
            // A for…in key is whatever the object holds.
            reports('function f(o) { for (const k in o) el.insertAdjacentHTML("beforeend", `<i>${k}</i>`); }', 'k'),

            // A tooltip attribute in markup: text escaped once still renders as markup in the tooltip.
            tooltipReports('el.innerHTML = `<i data-ps-tooltip="${util.escapeHTML(x)}"></i>`;', 'util.escapeHTML(x)'),
            tooltipReports('function f(x) { const tip = `${util.escapeHTML(x)}!`; '
                + 'el.innerHTML = `<i data-ps-tooltip="${tip}"></i>`; }', 'util.escapeHTML(x)'),
            // A call into another file is unknown.
            reports('el.innerHTML = `<b>${Other.format(x)}</b>`;', 'Other.format(x)'),
        ],
    });
});
