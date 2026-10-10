/**
 * Tests for the client's side of the Gallery's admin sort (frontend/js/gallery/cards/cardOrder.js, issue #2705).
 *
 * The order itself is the server's and the page keeps cards in arrival order, so what is pinned here is the
 * page's reading of a sort: which names are an order at all, and when the filters leave a sort nothing to rank, so
 * the page can say so instead of claiming an order it isn't applying.
 */

const { loadModules } = require('./loadGlobalScript');

describe('cardOrder', () => {
    let cardOrder;

    beforeAll(() => {
        cardOrder = loadModules('frontend/js/gallery/cards/cardOrder.js');
    });

    it('treats only the random default as unsorted', () => {
        expect(cardOrder.isSorted('random')).toBe(false);
        expect(cardOrder.isSorted(undefined)).toBe(false);
        expect(cardOrder.isSorted('')).toBe(false);
        expect(cardOrder.isSorted('newest')).toBe(true);
    });

    // Filters narrow and the sort orders what is left, so some pairs leave the sort nothing to rank; the page says
    // so rather than claim an order it isn't applying.
    describe('sortMootReason', () => {
        const rated = { validations: ['correct', 'unvalidated'], severities: ['null', '1', '2', '3'], anyRatedType: true };

        it('calls most disputed moot only when every label shown is unvalidated', () => {
            expect(cardOrder.sortMootReason('most_disputed', { ...rated, validations: ['unvalidated'] }))
                .toBe('no-validated');
            expect(cardOrder.sortMootReason('most_disputed', { ...rated, validations: ['unsure'] })).toBeNull();
            expect(cardOrder.sortMootReason('most_disputed', { ...rated, validations: ['unvalidated', 'unsure'] }))
                .toBeNull();
        });

        it('calls a severity sort moot with no rated type or one severity level', () => {
            for (const sort of ['most_severe', 'least_severe']) {
                expect(cardOrder.sortMootReason(sort, { ...rated, severities: undefined, anyRatedType: false }))
                    .toBe('no-rated-type');
                expect(cardOrder.sortMootReason(sort, { ...rated, severities: ['3'] })).toBe('one-severity');
                expect(cardOrder.sortMootReason(sort, { ...rated, severities: ['null'] })).toBe('one-severity');
                expect(cardOrder.sortMootReason(sort, { ...rated, severities: ['null', '3'] })).toBeNull();
                expect(cardOrder.sortMootReason(sort, rated)).toBeNull();
            }
        });

        it('never calls a time sort, or the random default, moot', () => {
            const narrowest = { validations: ['unvalidated'], severities: ['3'], anyRatedType: true };
            expect(cardOrder.sortMootReason('newest', narrowest)).toBeNull();
            expect(cardOrder.sortMootReason('oldest', narrowest)).toBeNull();
            expect(cardOrder.sortMootReason('random', narrowest)).toBeNull();
        });
    });
});
