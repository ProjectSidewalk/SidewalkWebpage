/**
 * @jest-environment node
 */

/**
 * Unit tests for the `i18n-escape-in-markup` ESLint rule (tools/eslint-rules/i18n-escape-in-markup.js, #5389).
 *
 * The rule is the standing guard on the site-wide `interpolation.escapeValue: false` default: a translated string
 * that interpolates values and lands in an HTML sink has to state its escaping at the call site. These cases pin
 * both halves of that contract — the sink shapes it recognizes, and the flows it deliberately lets through, since a
 * silent widening there would turn the whole tree red on the next lint run.
 *
 * Node environment, not the suite's usual jsdom: ESLint's RuleTester calls `structuredClone`, which jsdom's global
 * does not provide. Jest only reads that docblock when it is the file's first one, hence the split header.
 */

const { RuleTester } = require('eslint');
const rule = require('../../tools/eslint-rules/i18n-escape-in-markup');

const ruleTester = new RuleTester({
    languageOptions: { ecmaVersion: 2022, sourceType: 'script' },
});

const errors = [{ messageId: 'missing' }];

describe('i18n-escape-in-markup', () => {
    ruleTester.run('i18n-escape-in-markup', rule, {
        valid: [
            // No interpolation: escaping has nothing to act on.
            { code: 'el.innerHTML = i18next.t("ns:key");' },
            { code: 'el.innerHTML = i18next.t("ns:key", { ns: "common" });' },

            // Text sinks, which is what the flipped default is for.
            { code: 'el.textContent = i18next.t("ns:key", { name });' },
            { code: 'el.setAttribute("aria-label", i18next.t("ns:key", { name }));' },
            { code: 'const msg = i18next.t("ns:key", { name }); el.textContent = msg;' },
            { code: '$(el).text(i18next.t("ns:key", { count }));' },
            { code: 'alert(i18next.t("ns:key", { name }));' },

            // The decision is written down, either way.
            { code: 'el.innerHTML = i18next.t("ns:key", { name, interpolation: { escapeValue: true } });' },
            { code: 'el.innerHTML = i18next.t("ns:key", { name, interpolation: { escapeValue: false } });' },
            { code: 'el.innerHTML = `<b>${i18next.t("k", { name, interpolation: { escapeValue: true } })}</b>`;' },

            // Documented blind spots: a value that leaves the function before it reaches markup.
            { code: 'function title(s) { return i18next.t("ns:key", { name: s.name }); }' },
            { code: 'const opts = { message: i18next.t("ns:key", { name }) };' },
            { code: 'show(i18next.t("ns:key", { name }));' },

            // A same-named variable in another function is a different variable.
            {
                code: 'function a() { const t = i18next.t("ns:key", { name }); el.textContent = t; }'
                    + 'function b() { const t = "x"; el.innerHTML = t; }',
            },
        ],

        invalid: [
            // Direct sinks.
            { code: 'el.innerHTML = i18next.t("ns:key", { name });', errors },
            { code: 'el.outerHTML = i18next.t("ns:key", { count });', errors },
            { code: 'el.insertAdjacentHTML("beforeend", i18next.t("ns:key", { name }));', errors },
            { code: '$("#x").html(i18next.t("ns:key", { name }));', errors },
            { code: '$(`<p>${i18next.t("ns:key", { name })}</p>`);', errors },
            { code: 'popup.setHTML(i18next.t("ns:key", { name }));', errors },

            // `data-ps-tooltip` is read back into the tooltip card's innerHTML, so it is a markup sink.
            { code: 'el.setAttribute("data-ps-tooltip", i18next.t("ns:key", { count }));', errors },
            { code: '$el.attr("data-ps-tooltip", i18next.t("ns:key", { count }));', errors },

            // Carried there by a template literal, a concatenation, a ternary, or an array that is joined.
            { code: 'el.innerHTML = `<b>${i18next.t("ns:key", { name })}</b>`;', errors },
            { code: 'el.innerHTML = "<b>" + i18next.t("ns:key", { name }) + "</b>";', errors },
            { code: 'el.innerHTML = flag ? i18next.t("ns:key", { name }) : "";', errors },
            { code: 'el.innerHTML = [i18next.t("ns:key", { name })].join("");', errors },

            // Parked in a local variable first, including through an array the function pushes onto.
            { code: 'function f() { const s = i18next.t("ns:key", { name }); el.innerHTML = s; }', errors },
            { code: 'function f() { let s; s = i18next.t("ns:key", { name }); el.innerHTML = s; }', errors },
            {
                code: 'function f() { const lines = []; lines.push(i18next.t("ns:key", { name }));'
                    + ' el.innerHTML = lines.join(""); }',
                errors,
            },

            // `count` interpolates as `{{count}}`, so a plural-only call is still an interpolating call.
            { code: 'el.innerHTML = i18next.t("ns:key", { count: n });', errors },

            // A spread's contents are unknowable here, so it is treated as interpolating.
            { code: 'el.innerHTML = i18next.t("ns:key", { ...vars });', errors },

            // An `interpolation` object that sets something other than escapeValue has not made the decision.
            { code: 'el.innerHTML = i18next.t("ns:key", { name, interpolation: { prefix: "[" } });', errors },
        ],
    });
});
