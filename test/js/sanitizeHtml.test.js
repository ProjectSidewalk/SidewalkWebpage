/** Tests for frontend/js/common/sanitizeHtml.js, which psTooltip and the About page's citation rely on. */

const { loadModules } = require('./loadGlobalScript');

const { sanitizeHtml, htmlToText } = loadModules('frontend/js/common/sanitizeHtml.js');

/** Cleans markup into a scratch element and returns that element's markup. */
function clean(html, options) {
    const host = document.createElement('div');
    host.append(sanitizeHtml(html, options));
    return host.innerHTML;
}

describe('htmlToText', () => {
    test('drops tags and decodes entities', () => {
        expect(htmlToText('<tag-underline>S</tag-underline>teep &amp; narrow')).toBe('Steep & narrow');
    });

    test('treats null as empty', () => {
        expect(htmlToText(null)).toBe('');
    });
});

describe('sanitizeHtml', () => {
    test('keeps ordinary rich-card markup', () => {
        const card = '<div class="ac-tip"><b>Day</b><br><img class="x" src="/assets/a.png" alt=""></div>';
        expect(clean(card)).toBe(card);
    });

    test('drops script-capable elements with their contents', () => {
        expect(clean('a<script>alert(1)</script><iframe src="x"></iframe><style>*{}</style>b')).toBe('ab');
    });

    test('strips event handlers', () => {
        expect(clean('<img src="x" onerror="alert(1)"><svg onload="alert(1)"></svg>'))
            .toBe('<img src="x"><svg></svg>');
    });

    test('strips code-running addresses, however they are disguised', () => {
        expect(clean('<a href="javascript:alert(1)">a</a>')).toBe('<a>a</a>');
        expect(clean('<a href=" jav&#x09;ascript:alert(1)">a</a>')).toBe('<a>a</a>');
        expect(clean('<a href="data:text/html,<script>alert(1)</script>">a</a>')).toBe('<a>a</a>');
    });

    test('keeps http, relative, and data-image addresses', () => {
        const ok = '<a href="https://example.com">a</a><a href="/x">b</a><img src="data:image/png;base64,AAAA">';
        expect(clean(ok)).toBe(ok);
    });

    test('drops SVG animation that could rewrite a link', () => {
        const svg = '<svg><a><animate attributeName="href" values="javascript:alert(1)"></animate><text>x</text></a></svg>';
        expect(clean(svg)).toBe('<svg><a><text>x</text></a></svg>');
    });

    test('with an allowlist, unwraps other tags and keeps only the listed attributes', () => {
        const options = { tags: new Set(['A', 'I']), attributes: new Set(['href']) };
        expect(clean('<p><i class="v">CHI</i> <a href="https://x.org" title="t">paper</a></p>', options))
            .toBe('<i>CHI</i> <a href="https://x.org">paper</a>');
    });
});
