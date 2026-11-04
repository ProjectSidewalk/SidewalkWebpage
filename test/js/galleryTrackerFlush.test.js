/**
 * Tests for Gallery's interaction log (frontend/js/gallery/data/Tracker.js and Form.js, #5648).
 *
 * The Tracker owns the buffer and decides when a batch goes out; the Form only packages and sends it. What is worth
 * pinning is the contract between them: a batch is sent once the buffer passes its limit and holds exactly the
 * actions logged so far, the fresh buffer starts with the RefreshTracker marker, and leaving the page sends what
 * is left with `keepalive`, so the POST can outlive the page.
 */

import { loadModules, mockModule } from './loader.js';

mockModule('i18next', () => ({ default: { language: 'en' } }));

describe('the Gallery interaction log', () => {
  let tracker;
  /** @type {typeof import('../../frontend/js/gallery/data/Form.js').Form} */
  let Form;
  /** @type {Array<{body: object[], keepalive: boolean}>} Every batch POSTed, in order. */
  let sent = [];

  // One tracker for the file: its constructor adds a window listener that is never removed, so a second one would
  // answer the page-dismissal test twice.
  beforeAll(async () => {
    window.fetch = vi.fn((url, { body, keepalive }) => {
      sent.push({ url, body: JSON.parse(body), keepalive: !!keepalive });
      return Promise.resolve({ ok: true });
    });
    let Tracker;
    ({ Form, Tracker } = await loadModules(
      'frontend/js/gallery/data/Form.js', 'frontend/js/gallery/data/Tracker.js',
    ));
    tracker = new Tracker(new Form('/galleryTask'));
  });

  beforeEach(() => {
    sent = [];
    // A successful send says so on the console; silenced here and asserted where it matters.
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Lets a send's response handling run, since flush() doesn't hand back the request's promise. */
  const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

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

  it('sends a buffer the exit marker tips over the limit in that same keepalive batch', () => {
    // The last batch left the refresh marker behind; nine more fill the buffer to its limit.
    for (let i = 1; i <= 9; i += 1) tracker.push(`Action${i}`);
    expect(sent).toHaveLength(0);

    window.dispatchEvent(new Event('pagehide'));

    expect(sent).toHaveLength(1);
    expect(sent[0].keepalive).toBe(true);
    expect(actionsIn(sent[0])).toEqual([
      'RefreshTracker', ...[...Array(9).keys()].map((i) => `Action${i + 1}`), 'Unload',
    ]);
  });

  it('records the pano and every note an action carries', () => {
    tracker.push('Click_Agree', { panoId: 'pano-1' }, { labelId: 5, viaKeyboard: false });
    tracker.push('NextPageClick', null, null);

    const [agree, next] = tracker.getActions().slice(-2);
    expect(agree).toMatchObject({ action: 'Click_Agree', pano_id: 'pano-1', note: 'labelId:5,viaKeyboard:false' });
    expect(next).toMatchObject({ action: 'NextPageClick', pano_id: null, note: '' });
  });

  it('says on the console that a batch reached the server', async () => {
    tracker.flush();
    await settle();

    expect(console.log).toHaveBeenCalledWith('Data logged successfully');
  });

  describe('sending a batch', () => {
    let fetchBefore;

    beforeEach(() => {
      fetchBefore = window.fetch;
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      window.fetch = fetchBefore;
    });

    it('sends a list of submissions as it is, rather than wrapping it again', async () => {
      const form = new Form('/galleryTask');
      const submission = form.compileSubmissionData([{ action: 'Test' }]);

      await form.submit([submission, submission]);

      expect(sent.at(-1).body).toHaveLength(2);
      expect(sent.at(-1).keepalive).toBe(false);
    });

    it('reports a batch the server refused', async () => {
      window.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }));

      await new Form('/galleryTask').submit({ interactions: [] });

      expect(console.error).toHaveBeenCalledWith('Failed to log data: 500');
    });

    it('reports a batch that never reached the server, without throwing', async () => {
      const offline = new TypeError('Failed to fetch');
      window.fetch = vi.fn(() => Promise.reject(offline));

      await expect(new Form('/galleryTask').submit({ interactions: [] })).resolves.toBeUndefined();

      expect(console.error).toHaveBeenCalledWith(offline);
    });
  });
});
