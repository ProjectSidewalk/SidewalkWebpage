/**
 * Tests for ScoreRamp (public/js/common/scoreRamp.js, #5217): the AccessScore color ramp every consumer reads from
 * the main.css tokens, so the api-docs maps, the AccessScore tool's layers, and its charts paint one score one color.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'public/js/common/scoreRamp.js'), 'utf8');

// jsdom resolves custom properties set on the root element, which is exactly how the tokens reach the browser.
const RAMP = ['#a74d32', '#eb724e', '#c2c2c2', '#62c0ac', '#5f9e7b'];

describe('ScoreRamp', () => {
    beforeAll(() => {
        RAMP.forEach((hex, i) => document.documentElement.style.setProperty(`--color-score-ramp-${i + 1}`, hex));
        window.eval(SRC);
    });

    it('reads the five ramp tokens in order, low score first', () => {
        expect(window.ScoreRamp.colors()).toEqual(RAMP);
    });

    it('lands exactly on the token colors at the stops and on the neutral grey at 0.5', () => {
        expect(window.ScoreRamp.at(0)).toBe(RAMP[0]);
        expect(window.ScoreRamp.at(0.5)).toBe(RAMP[2]);
        expect(window.ScoreRamp.at(1)).toBe(RAMP[4]);
    });

    it('interpolates linearly in sRGB between neighboring stops, the way Mapbox does', () => {
        // Halfway between #a74d32 and #eb724e, component by component.
        expect(window.ScoreRamp.at(0.125)).toBe('#c96040');
    });

    it('clamps scores outside the domain and honors a custom domain', () => {
        expect(window.ScoreRamp.at(-3)).toBe(RAMP[0]);
        expect(window.ScoreRamp.at(7)).toBe(RAMP[4]);
        expect(window.ScoreRamp.at(50, { min: 0, max: 100 })).toBe(RAMP[2]);
    });

    it('spreads Mapbox stops evenly over the domain', () => {
        expect(window.ScoreRamp.stops()).toEqual([0, RAMP[0], 0.25, RAMP[1], 0.5, RAMP[2], 0.75, RAMP[3], 1, RAMP[4]]);
        expect(window.ScoreRamp.stops({ min: 0, max: 100 })[2]).toBe(25);
    });

    it('builds a case/interpolate expression that sends the sentinel to the none color', () => {
        const value = ['feature-state', 'score'];
        const expr = window.ScoreRamp.expression(value, { noneColor: '#888888' });
        expect(expr[0]).toBe('case');
        expect(expr[1]).toEqual(['<=', value, -1]);
        expect(expr[2]).toBe('#888888');
        expect(expr[3].slice(0, 3)).toEqual(['interpolate', ['linear'], value]);
        expect(expr[3].slice(3)).toEqual(window.ScoreRamp.stops());
    });

    it('renders the legend gradient from the same colors', () => {
        expect(window.ScoreRamp.cssGradient()).toBe(`linear-gradient(to right, ${RAMP.join(', ')})`);
    });
});
