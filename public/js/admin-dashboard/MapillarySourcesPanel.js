/**
 * The Imagery page's "Imagery sources" panel (#5407): the Mapillary creators this deployment is restricted to.
 *
 * Mapillary mixes imagery from every contributor. Listing creators here restricts the deployment to their 360°
 * imagery -- the list is the backend's (`/adminapi/mapillarySources`), and Explore's viewer and the nightly
 * imagery-age poll both read it from there, so this panel only ever edits and re-reads it.
 *
 * The page renders the panel's markup only on a Mapillary deployment, so `init()` is a no-op anywhere else.
 *
 * @example
 * new MapillarySourcesPanel({ sourcesUrl: '/adminapi/mapillarySources' }).init();
 */
class MapillarySourcesPanel {
  #sourcesUrl;
  #list;
  #form;
  #input;
  #status;
  #error;

  /**
   * @param {object} params
   * @param {string} params.sourcesUrl - The sources endpoint; creators are added and removed under `/creators`.
   */
  constructor(params) {
    this.#sourcesUrl = params.sourcesUrl;
  }

  /**
   * Wires the form and loads the list.
   *
   * @returns {Promise<void>} Resolves once the first load has rendered (or failed into the status line).
   */
  async init() {
    this.#list = document.getElementById('imagery-sources-list');
    this.#form = document.getElementById('imagery-sources-form');
    if (!this.#list || !this.#form) return;
    this.#input = document.getElementById('imagery-sources-username');
    this.#status = document.getElementById('imagery-sources-status');
    this.#error = document.getElementById('imagery-sources-error');

    this.#form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.#add();
    });
    this.#list.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action="remove"]');
      if (button) this.#remove(button);
    });
    await this.#load();
  }

  /**
   * Fetches the list and renders it, reporting a failure in the status line rather than leaving a stale list that
   * reads as current.
   *
   * @returns {Promise<void>}
   */
  async #load() {
    try {
      const response = await fetch(this.#sourcesUrl, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(await MapillarySourcesPanel.#errorMessage(response));
      this.#render((await response.json()).sources || []);
    } catch (e) {
      console.error('Imagery sources: load failed.', e);
      this.#list.innerHTML = '';
      this.#status.textContent = `Could not load the imagery sources: ${e.message}`;
    }
  }

  /**
   * Renders the creators table, and says in words which of the two states the deployment is in: a reader should not
   * have to infer "unrestricted" from an empty table.
   *
   * @param {Array<Record<string, any>>} sources - The endpoint's `sources` rows.
   */
  #render(sources) {
    const creators = sources.filter((source) => source.source_type === 'creator');
    if (creators.length === 0) {
      this.#status.textContent = 'Unrestricted: imagery from every Mapillary contributor is used.';
      this.#list.innerHTML = '';
      return;
    }
    const noun = creators.length === 1 ? 'creator' : 'creators';
    this.#status.textContent = `Restricted to imagery from ${AdminShell.num(creators.length)} ${noun}.`;
    const rows = creators.map((source) => {
      const username = AdminShell.esc(source.source_value);
      const profileUrl = `https://www.mapillary.com/app/user/${encodeURIComponent(source.source_value)}`;
      return `
        <tr data-username="${username}">
          <td><a href="${profileUrl}" target="_blank" rel="noopener noreferrer">${username}</a></td>
          <td>${AdminShell.esc(source.added_by ?? 'onboarding tooling')}</td>
          <td>${AdminShell.ts(source.added_at)}</td>
          <td><button type="button" class="reopen-queue-btn" data-action="remove"
            aria-label="Remove ${username} from the allowed creators">Remove</button></td>
        </tr>`;
    }).join('');
    this.#list.innerHTML = AdminShell.tableHtml(['Mapillary creator', 'Added by', 'Added', 'Action'], rows);
  }

  /**
   * Adds the typed username. The server verifies it against Mapillary first, so a typo is refused with a reason
   * instead of silently restricting the deployment to nothing.
   *
   * @returns {Promise<void>}
   */
  async #add() {
    const username = this.#input.value.trim();
    if (!username) return;
    this.#setError('');
    const submit = this.#form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const response = await fetch(`${this.#sourcesUrl}/creators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ username }),
      });
      if (!response.ok) throw new Error(await MapillarySourcesPanel.#errorMessage(response));
      this.#input.value = '';
      await this.#load();
    } catch (e) {
      console.error('Imagery sources: add failed.', e);
      this.#setError(`Could not add "${username}": ${e.message}`);
    } finally {
      submit.disabled = false;
      this.#input.focus();
    }
  }

  /**
   * Removes one creator, after a confirmation that says what removing the last one does.
   *
   * @param {HTMLButtonElement} button - The clicked Remove button, inside a `data-username` row.
   * @returns {Promise<void>}
   */
  async #remove(button) {
    const username = button.closest('tr')?.dataset.username;
    if (!username) return;
    const isLast = this.#list.querySelectorAll('tr[data-username]').length === 1;
    const ok = await ConfirmDialog.confirm({
      message: isLast
        ? `Remove ${username}? They are the only allowed creator, so this deployment goes back to using imagery from `
        + 'every Mapillary contributor.'
        : `Remove ${username}? Explore will stop using their imagery.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
    });
    if (!ok) return;
    this.#setError('');
    button.disabled = true;
    try {
      const response = await fetch(`${this.#sourcesUrl}/creators/${encodeURIComponent(username)}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(await MapillarySourcesPanel.#errorMessage(response));
      await this.#load();
      this.#input.focus(); // The clicked button is gone with its row; don't drop focus to <body>.
    } catch (e) {
      console.error('Imagery sources: remove failed.', e);
      this.#setError(`Could not remove "${username}": ${e.message}`);
      button.disabled = false;
    }
  }

  /**
   * Shows or clears the form's error line (a `role="alert"` region, so setting it announces it).
   *
   * @param {string} message - The message, or '' to clear.
   */
  #setError(message) {
    this.#error.textContent = message;
    this.#error.hidden = !message;
  }

  /**
   * The server's own explanation of a refusal ("Mapillary has no 360° imagery under the username 'x'."), which says
   * far more than the status code.
   *
   * @param {Response} response - The failed response.
   * @returns {Promise<string>} Its `message` field, or the status line when the body isn't the JSON we expect.
   */
  static async #errorMessage(response) {
    try {
      const body = await response.json();
      if (body && typeof body.message === 'string') return body.message;
    } catch {
      // Not JSON (an HTML error page, an empty body): fall through to the status line.
    }
    return `${response.status} ${response.statusText}`.trim();
  }
}
