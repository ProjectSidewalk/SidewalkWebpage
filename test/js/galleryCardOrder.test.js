/**
 * Tests for the Gallery's client-side sort comparator (frontend/js/gallery/cards/cardOrder.js, issue #2705).
 *
 * The comparator has to be the server's `GallerySort.ordering` exactly — same keys, same direction, unrated and
 * unvalidated labels last, `label_id` descending as the tiebreak — because a sorted page is assembled by sorting the
 * cards the client holds, which only reproduces the server's order if the two orderings agree. A drift between them
 * shows as a label skipped or repeated at a page boundary, which nobody notices until a review pass is audited.
 */

const { loadModules } = require('./loadGlobalScript');

/** A stand-in for a Card: just enough to be compared. */
function card(props) {
    return { getProperties: () => props };
}

/** @returns {number[]} The label ids of `cards` sorted by `sort`. */
function idsSorted(cardOrder, sort, cards) {
    return [...cards].sort(cardOrder.compareCards(sort)).map((c) => c.getProperties().label_id);
}

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
        expect(cardOrder.compareCards('random')).toBeNull();
        expect(cardOrder.compareCards('not-a-sort')).toBeNull();
    });

    it('orders by label time in both directions, newest ids first on a tie', () => {
        const cards = [
            card({ label_id: 1, label_timestamp: '2026-01-01T00:00:00Z' }),
            card({ label_id: 2, label_timestamp: '2026-03-01T00:00:00Z' }),
            card({ label_id: 3, label_timestamp: '2026-03-01T00:00:00Z' }),
            card({ label_id: 4, label_timestamp: '2026-02-01T00:00:00Z' }),
        ];
        expect(idsSorted(cardOrder, 'newest', cards)).toEqual([3, 2, 4, 1]);
        expect(idsSorted(cardOrder, 'oldest', cards)).toEqual([1, 4, 3, 2]);
    });

    it('orders by severity with unrated labels last either way', () => {
        const cards = [
            card({ label_id: 1, severity: 2 }),
            card({ label_id: 2, severity: null }),
            card({ label_id: 3, severity: 3 }),
            card({ label_id: 4, severity: 1 }),
            card({ label_id: 5, severity: 3 }),
            card({ label_id: 6 }),
        ];
        expect(idsSorted(cardOrder, 'most_severe', cards)).toEqual([5, 3, 1, 4, 6, 2]);
        expect(idsSorted(cardOrder, 'least_severe', cards)).toEqual([4, 1, 5, 3, 6, 2]);
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

    it('ranks most disputed by the share of disagreeing votes, unvalidated last', () => {
        const cards = [
            card({ label_id: 1, val_counts: { Agree: 3, Disagree: 1, Unsure: 0 } }), // 0.25
            card({ label_id: 2, val_counts: { Agree: 0, Disagree: 0, Unsure: 0 } }), // no votes
            card({ label_id: 3, val_counts: { Agree: 1, Disagree: 1, Unsure: 0 } }), // 0.5
            card({ label_id: 4, val_counts: { Agree: 0, Disagree: 2, Unsure: 2 } }), // 0.5
            card({ label_id: 5, val_counts: { Agree: 5, Disagree: 0, Unsure: 0 } }), // 0
        ];
        expect(idsSorted(cardOrder, 'most_disputed', cards)).toEqual([4, 3, 1, 5, 2]);
    });
});
