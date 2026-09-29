/**
 * Tests util.misc.labelTypeName (public/js/common/utilitiesSidewalk.js), the one place label-type names are read from
 * the translations. German names carry a `&shy;` entity, which prints as literal text unless it's handled here.
 */

const { assetPathStub, installUtilitiesMisc } = require('./loadGlobalScript');

describe('labelTypeName', () => {
    beforeEach(() => {
        window.i18next = {
            t: (key) => (key === 'common:surface-problem' ? 'Oberflächen&shy;problem&shy;stelle' : key),
        };
        window.util = {
            assetPath: assetPathStub,
            camelToKebab: (s) => s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
        };
        installUtilitiesMisc();
    });

    it('drops every soft-hyphen entity by default', () => {
        expect(window.util.misc.labelTypeName('SurfaceProblem')).toBe('Oberflächenproblemstelle');
    });

    it('turns each entity into a real soft hyphen when asked', () => {
        expect(window.util.misc.labelTypeName('SurfaceProblem', { softHyphens: true }))
            .toBe('Oberflächen­problem­stelle');
    });

    it('reads the kebab-case key in the common namespace', () => {
        expect(window.util.misc.labelTypeName('NoCurbRamp')).toBe('common:no-curb-ramp');
    });
});
