/**
 * Tests for the Gallery's interaction log (frontend/js/gallery/data/Tracker.js and Form.js, #5648).
 *
 * The Tracker owns the buffer and decides when a batch goes out; the Form only packages and sends it. What is worth
 * pinning is the contract between them: a batch is sent once the buffer passes its limit and holds exactly the
 * actions logged so far, the fresh buffer starts with the RefreshTracker marker, and leaving the page sends what
 * is left with `keepalive`, so the POST can outlive the page.
 */

const { loadModules } = require('./loadGlobalScript');


describe('the Gallery interaction log', () => {
    let tracker;
    /** @type {Array<{body: object[], keepalive: boolean}>} Every batch POSTed, in order. */
    let sent = [];

    // One tracker for the file: its constructor adds a window listener that is never removed, so a second one would
    // answer the page-dismissal test twice.
    beforeAll(() => {
        window.i18next = { language: 'en' };
        window.util = { getBrowser: () => 'b', getBrowserVersion: () => '1', getOperatingSystem: () => 'os' };
        window.fetch = jest.fn((url, { body, keepalive }) => {
            sent.push({ url, body: JSON.parse(body), keepalive: !!keepalive });
            return Promise.resolve({ ok: true });
        });
        const { Form, Tracker } = loadModules('frontend/js/gallery/data/Form.js', 'frontend/js/gallery/data/Tracker.js');
        tracker = new Tracker(new Form('/galleryTask'));
    });

    beforeEach(() => {
        sent = [];
    });

    /** @returns {string[]} The action names in one sent batch. */
    const actionsIn = (batch) => batch.body.flatMap((entry) => entry.interactions.map((i) => i.action));

    it('sends a batch once the buffer passes its limit, and starts the next one with the refresh marker', () => {
        for (let i = 1; i <= 10; i += 1) tracker.push(`Action${i}`);
        expect(sent).toHaveLength(0);

        tracker.push('Action11');

        expect(sent).toHaveLength(1);
        expect(sent[0].url).toBe('/galleryTask');
        expect(sent[0].keepalive).toBe(false);
        expect(actionsIn(sent[0])).toEqual([...Array(11).keys()].map((i) => `Action${i + 1}`));
        expect(sent[0].body[0].environment.language).toBe('en');
        expect(tracker.getActions().map((i) => i.action)).toEqual(['RefreshTracker']);
    });

    it('sends what is left with keepalive when the page is dismissed', () => {
        tracker.push('CardLocationClick', null, { Label_Id: 1 });

        window.dispatchEvent(new Event('pagehide'));

        expect(sent).toHaveLength(1);
        expect(sent[0].keepalive).toBe(true);
        // The buffer the last batch left behind starts with the refresh marker.
        expect(actionsIn(sent[0])).toEqual(['RefreshTracker', 'CardLocationClick', 'Unload']);
        expect(sent[0].body[0].interactions[1].note).toBe('Label_Id:1');
    });
});
