/**
 * @jest-environment node
 */

/**
 * Unit tests for the `escape-in-markup` ESLint rule (tools/lint/eslint-rules/escape-in-markup.js, #5615).
 *
 * The rule blocks a value interpolated into HTML that isn't escaped and can't be shown safe. These cases pin what it
 * treats as safe, since a widening there lets an XSS through silently, and where it reports, since a report in the
 * wrong spot (a helper's argument rather than the template it lands in) pushes a contributor toward escaping text
 * that some other caller reads as plain text.
 *
 * Node environment, not the suite's usual jsdom: ESLint's RuleTester calls `structuredClone`, which jsdom's global
 * does not provide. Jest only reads that docblock when it is the file's first one, hence the split header.
 */

const { RuleTester } = require('eslint');
const rule = require('../../tools/lint/eslint-rules/escape-in-markup');

const ruleTester = new RuleTester({
    languageOptions: { ecmaVersion: 2022, sourceType: 'script' },
});

/**
 * The expected errors, one per offending source text.
 * @param {...string} texts - The source text of each reported node, in order.
 * @returns {object[]} RuleTester error descriptors.
 */
const at = (...texts) => texts.map(() => ({ messageId: 'unescaped' }));

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
            { code: 'el.innerHTML = `<img src="${util.assetPath("x.svg")}">${i18next.t("ns:key")}`;' },
            { code: 'el.innerHTML = `<img src="${util.misc.getIconImagePaths(type).iconImagePath}">`;' },
            // `a && b` only yields `a` when it is falsy.
            { code: 'el.innerHTML = `${x && "<b>y</b>"}`;' },

            // Literal tables and arrays, read by key or iterated.
            { code: 'const LABELS = { a: "A", b: "B" }; function f(k) { el.innerHTML = `${LABELS[k]}`; }' },
            { code: 'el.innerHTML = ["a", "b"].map((o) => `<i class="${o}"></i>`).join("");' },
            { code: 'function f() { for (const o of ["a", "b"]) el.insertAdjacentHTML("beforeend", `<i>${o}</i>`); }' },

            // Helpers of this file, followed to their returns and their callers.
            { code: 'function f(x) { const cell = (v) => `<td>${util.escapeHTML(v)}</td>`; '
                + 'el.innerHTML = `<tr>${cell(x)}</tr>`; }' },
            { code: 'function f() { const row = (n) => `<td>${n}</td>`; el.innerHTML = `${row(1)}${row(2)}`; }' },
            { code: 'class A { #n = 0; set(k) { this.#n = k * 2; } render() { el.innerHTML = `${this.#n}`; } }' },
            { code: 'class A { render(x) { el.innerHTML = `<b>${this.#name(x)}</b>`; } '
                + '#name(x) { return util.escapeHTML(x); } }' },
            // A `let` built up in branches, every value of it safe.
            { code: 'function f(x) { const parts = []; parts.push(`<i>${util.escapeHTML(x)}</i>`); '
                + 'el.innerHTML = parts.join(""); }' },
            { code: 'function f(x) { let chip = ""; if (x) chip = `<i>${util.escapeHTML(x)}</i>`; '
                + 'el.innerHTML = `<b>${chip}</b>`; }' },

            // Not HTML: a text sink, a plain attribute, a string that goes nowhere this rule can see.
            { code: 'el.textContent = `${x}`;' },
            { code: 'el.setAttribute("aria-label", `${x}`);' },
            { code: 'function f(x) { return `${x}`; }' },
            { code: 'console.log(`${x}`);' },
        ],
        invalid: [
            { code: 'el.innerHTML = `<b>${x}</b>`;', errors: at('x') },
            { code: 'el.insertAdjacentHTML("beforeend", `<b>${data.name}</b>`);', errors: at('data.name') },
            { code: 'el.setAttribute("data-ps-tooltip", `${x}`);', errors: at('x') },
            // Through a variable, and through a joined map.
            { code: 'function f(x) { const html = `<b>${x}</b>`; el.innerHTML = html; }', errors: at('x') },
            { code: 'el.innerHTML = xs.map((x) => `<li>${x.name}</li>`).join("");', errors: at('x.name') },
            // A string method only passes its receiver through.
            { code: 'el.innerHTML = `<b>${x.trim().toUpperCase()}</b>`;', errors: at('x') },

            // One unsafe caller makes the parameter unsafe, reported where it enters the HTML.
            {
                code: 'function f(d) { const row = (n) => `<td>${n}</td>`; el.innerHTML = `${row(1)}${row(d.name)}`; }',
                errors: at('n'),
            },
            // A top-level function can be called from any file in the bundle, so its parameters are unknown.
            { code: 'function cell(v) { return `<td>${v}</td>`; } el.innerHTML = `<tr>${cell(1)}</tr>`;', errors: at('v') },
            // A helper returning raw data: reported at the call, which is where the escape goes.
            { code: 'function f(d) { const name = () => d.name; el.innerHTML = `<b>${name()}</b>`; }', errors: at('name()') },
            // What is pushed onto an array counts as much as what it started with.
            { code: 'function f(d) { const xs = []; xs.push(d.name); el.innerHTML = `${xs.join(", ")}`; }', errors: at('xs') },
            { code: 'function f(d) { const xs = []; xs.push(d.name); el.innerHTML = `${xs[0]}`; }', errors: at('xs[0]') },
            // A call into another file is unknown.
            { code: 'el.innerHTML = `<b>${Other.format(x)}</b>`;', errors: at('Other.format(x)') },
        ],
    });
});
