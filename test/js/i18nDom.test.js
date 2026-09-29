/**
 * Tests localizeElement (public/js/common/i18nDom.js) on translations that carry a `&shy;` entity, as the German
 * label-type names do. The setters write plain text, so the entity would otherwise print literally.
 */

const { loadGlobalScript } = require('./loadGlobalScript');

describe('localizeElement', () => {
    beforeAll(() => {
        window.i18next = { isInitialized: true, t: () => 'Oberflächen&shy;problem' };
        loadGlobalScript('public/js/common/i18nDom.js');
    });

    it('keeps the break point in element text as a real soft hyphen', () => {
        const el = document.createElement('span');
        el.setAttribute('data-i18n', 'common:surface-problem');
        window.localizeElement(el);
        expect(el.textContent).toBe('Oberflächen­problem');
    });

    it('drops the break point from attributes', () => {
        const img = document.createElement('img');
        img.setAttribute('data-i18n-alt', 'common:surface-problem');
        img.setAttribute('data-i18n-aria-label', 'common:surface-problem');
        window.localizeElement(img);
        expect(img.alt).toBe('Oberflächenproblem');
        expect(img.getAttribute('aria-label')).toBe('Oberflächenproblem');
    });
});
