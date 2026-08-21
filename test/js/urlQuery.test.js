/**
 * Tests for util.url (public/js/common/urlQuery.js, issues #4782 / #4783).
 *
 * The deep-link query rules the page's several URL writers share. They matter twice over: the writers run side by
 * side on one page and have to serialize identically or they rewrite each other's params, and the tag params carry
 * free-form label text whose commas and colons must survive a round trip.
 */

const fs = require('fs');
const path = require('path');

const URL_QUERY_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/urlQuery.js'), 'utf8'
);

describe('util.url', () => {
    beforeAll(() => {
        window.eval(URL_QUERY_SRC);
    });

    describe('serialize', () => {
        it('leaves commas and colons literal', () => {
            const params = new URLSearchParams();
            params.set('severities', '1,2,3');
            params.set('tags', 'CurbRamp:narrow');

            expect(window.util.url.serialize(params)).toBe('severities=1,2,3&tags=CurbRamp:narrow');
        });

        it('still escapes what actually needs escaping', () => {
            const params = new URLSearchParams();
            params.set('tags', 'a&b=c#d');

            const query = window.util.url.serialize(params);
            expect(query).toBe('tags=a%26b%3Dc%23d');
            // The escaping has to survive a parse, or a tag could smuggle in another param.
            expect(new URLSearchParams(query).get('tags')).toBe('a&b=c#d');
        });

        it('returns an empty string when there is nothing to serialize', () => {
            expect(window.util.url.serialize(new URLSearchParams())).toBe('');
        });
    });

    describe('setRepeated', () => {
        it('writes one occurrence per value', () => {
            const params = new URLSearchParams();
            window.util.url.setRepeated(params, 'tags', ['CurbRamp:narrow', 'Signal:yellow box, and more']);

            expect(params.getAll('tags')).toEqual(['CurbRamp:narrow', 'Signal:yellow box, and more']);
        });

        it('replaces any occurrences already there, and deletes the param for an empty list', () => {
            const params = new URLSearchParams('tags=old&tags=older&labelTypes=CurbRamp');
            window.util.url.setRepeated(params, 'tags', ['new']);
            expect(params.getAll('tags')).toEqual(['new']);

            window.util.url.setRepeated(params, 'tags', []);
            expect(params.has('tags')).toBe(false);
            expect(params.get('labelTypes')).toBe('CurbRamp'); // Other params untouched.
        });
    });

    describe('getRepeated', () => {
        const KNOWN = ['narrow', 'yellow box, accessibility features not visible', 'cycle lane: faded paint'];
        const isValid = (value) => KNOWN.includes(value);

        it('distinguishes an absent param from one that selects nothing', () => {
            expect(window.util.url.getRepeated(new URLSearchParams(''), 'tags', isValid)).toBeNull();
            expect(window.util.url.getRepeated(new URLSearchParams('tags='), 'tags', isValid)).toEqual([]);
        });

        it('reads the repeated form', () => {
            const params = new URLSearchParams();
            params.append('tags', 'narrow');
            params.append('tags', KNOWN[1]);

            expect(window.util.url.getRepeated(params, 'tags', isValid)).toEqual(['narrow', KNOWN[1]]);
        });

        it('falls back to splitting an older comma-joined value', () => {
            const params = new URLSearchParams(`tags=narrow,${KNOWN[2]}`);

            expect(window.util.url.getRepeated(params, 'tags', isValid)).toEqual(['narrow', KNOWN[2]]);
        });

        it('takes a whole valid occurrence before splitting, so a comma inside a value survives', () => {
            const params = new URLSearchParams();
            params.append('tags', KNOWN[1]);

            expect(window.util.url.getRepeated(params, 'tags', isValid)).toEqual([KNOWN[1]]);
        });

        it('drops values the page does not recognize', () => {
            const params = new URLSearchParams('tags=narrow,bogus&tags=alsoBogus');

            expect(window.util.url.getRepeated(params, 'tags', isValid)).toEqual(['narrow']);
        });

        it('trims surrounding whitespace, in both forms', () => {
            const params = new URLSearchParams('tags= narrow , cycle lane: faded paint ');

            expect(window.util.url.getRepeated(params, 'tags', isValid)).toEqual(['narrow', KNOWN[2]]);
        });
    });

    describe('replaceQuery', () => {
        it('rewrites the query in place, keeping the path and hash, without a history entry', () => {
            window.history.replaceState({}, '', '/labelMap?tags=CurbRamp:narrow#anchor');
            const before = window.history.length;

            const url = new URL(window.location);
            url.searchParams.set('labelId', '42');
            window.util.url.replaceQuery(url);

            expect(window.location.pathname).toBe('/labelMap');
            expect(window.location.search).toBe('?tags=CurbRamp:narrow&labelId=42');
            expect(window.location.hash).toBe('#anchor');
            expect(window.history.length).toBe(before);
        });

        it('drops the "?" entirely once the last param is gone', () => {
            window.history.replaceState({}, '', '/labelMap?labelId=42');

            const url = new URL(window.location);
            url.searchParams.delete('labelId');
            window.util.url.replaceQuery(url);

            expect(window.location.search).toBe('');
            expect(window.location.pathname).toBe('/labelMap');
        });
    });
});
