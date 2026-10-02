/**
 * The Imagery page's "Imagery sources" panel (#5407): the Mapillary creators this deployment favours, and whether it
 * prefers their 360° imagery or uses nothing else.
 *
 * Mapillary mixes imagery from every contributor. The list and the mode are the backend's
 * (`/adminapi/mapillarySources`), and Explore's viewer and the nightly imagery-age poll both read them from there, so
 * this panel only ever edits and re-reads them.
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
  #modeInputs;
  #mode;

  /**
   * @param {object} params
   * @param {string} params.sourcesUrl - The sources endpoint; creators are added and removed under `/creators`, and the
   *   mode is set at `/mode`.
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
    this.#modeInputs = [...document.querySelectorAll('input[name="imagery-sources-mode"]')];

    this.#form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.#add();
    });
    this.#list.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action="remove"]');
      if (button) this.#remove(button);
    });
    this.#modeInputs.forEach((input) => input.addEventListener('change', () => this.#setMode(input.value)));
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
      const { sources, mode } = await response.json();
      this.#mode = mode;
      this.#checkMode(mode);
      this.#render(sources || []);
    } catch (e) {
      console.error('Imagery sources: load failed.', e);
      this.#list.innerHTML = '';
      this.#status.textContent = `Could not load the imagery sources: ${e.message}`;
    }
  }

  /**
   * Renders the creators table, and says in words which state the deployment is in: a reader should not have to
   * infer "unfiltered" from an empty table, or what the listed creators do from the radio buttons.
   *
   * @param {Array<Record<string, any>>} sources - The endpoint's `sources` rows.
   */
  #render(sources) {
    const creators = sources.filter((source) => source.source_type === 'creator');
    if (creators.length === 0) {
      this.#status.textContent = 'Unfiltered: imagery from every Mapillary contributor is ranked alike.';
      this.#list.innerHTML = '';
      return;
    }
    const count = `${AdminShell.num(creators.length)} ${creators.length === 1 ? 'creator' : 'creators'}`;
    this.#status.textContent = this.#mode === 'restrict'
      ? `Restricted to imagery from ${count}.`
      : `Preferring imagery from ${count}; everyone's imagery is used where theirs isn't nearby.`;
    const rows = creators.map((source) => {
      const username = AdminShell.esc(source.source_value);
      const profileUrl = `https://www.mapillary.com/app/user/${encodeURIComponent(source.source_value)}`;
      return `
        <tr data-username="${username}">
          <td><a href="${profileUrl}" target="_blank" rel="noopener noreferrer">${username}</a></td>
          <td>${AdminShell.esc(source.added_by ?? 'not recorded')}</td>
          <td><time datetime="${AdminShell.esc(source.added_at)}">${AdminShell.dateTime(source.added_at)}</time></td>
          <td><button type="button" class="reopen-queue-btn" data-action="remove"
            aria-label="Remove ${username} from the listed creators">Remove</button></td>
        </tr>`;
    }).join('');
    this.#list.innerHTML = AdminShell.tableHtml(['Mapillary creator', 'Added by', 'Added', 'Action'], rows);
  }

  /**
   * Adds the typed username. The server verifies it against Mapillary first, so a typo is refused with a reason
   * instead of silently restricting the deployment to nothing. Re-adding a listed creator changes nothing, and says
   * so: a silent no-op reads as a successful add, leaving the admin unsure whether they typed the name they meant.
   *
   * @returns {Promise<void>}
   */
  async #add() {
    const username = this.#input.value.trim();
    if (!username) return;
    this.#setError('');
    // Caught here to spare a Mapillary round trip; the server's `added: 0` below still covers a list gone stale.
    const listed = this.#listedSpelling(username);
    if (listed) {
      this.#warnAlreadyListed(listed);
      return;
    }
    const submit = this.#form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const response = await fetch(`${this.#sourcesUrl}/creators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ username }),
      });
      if (!response.ok) throw new Error(await MapillarySourcesPanel.#errorMessage(response));
      // The server answers with Mapillary's spelling, which is what the list holds when the case typed differs.
      const { added, username: canonical } = await response.json();
      if (added === 0) this.#warnAlreadyListed(canonical);
      else this.#input.value = '';
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
        ? `Remove ${username}? They are the only listed creator, so this deployment goes back to ranking imagery from `
        + 'every Mapillary contributor alike.'
        : `Remove ${username}? Explore will stop favouring their imagery.`,
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
   * Switches the mode. Restrict is confirmed first, because it hides other creators' imagery in Explore at once while
   * the streets only they covered stay open until the scan is re-run. A failed switch puts the radios back, so they
   * never show a mode the server didn't take.
   *
   * @param {string} mode - 'prefer' or 'restrict', the radio's value.
   * @returns {Promise<void>}
   */
  async #setMode(mode) {
    if (mode === this.#mode) return;
    if (mode === 'restrict') {
      const ok = await ConfirmDialog.confirm({
        message: 'Restrict to the listed creators? Explore will stop using anyone else\'s imagery. Streets only others '
          + 'covered stay open until the street imagery scan is re-run with --mapillary-creator.',
        confirmText: 'Restrict',
        cancelText: 'Cancel',
      });
      if (!ok) {
        this.#checkMode(this.#mode);
        return;
      }
    }
    this.#setError('');
    try {
      const response = await fetch(`${this.#sourcesUrl}/mode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (!response.ok) throw new Error(await MapillarySourcesPanel.#errorMessage(response));
      await this.#load();
    } catch (e) {
      console.error('Imagery sources: mode change failed.', e);
      this.#setError(`Could not change how listed creators are used: ${e.message}`);
      this.#checkMode(this.#mode);
    }
  }

  /**
   * @param {string} mode - The mode whose radio should be checked.
   */
  #checkMode(mode) {
    this.#modeInputs.forEach((input) => {
      input.checked = input.value === mode;
    });
  }

  /**
   * @param {string} username - A trimmed username.
   * @returns {string|undefined} The listed spelling if the rendered list already holds it, ignoring case as
   *   Mapillary's username lookup does: the server stores Mapillary's spelling, so "ProfJFray" would only come back as
   *   the listed "profjfray".
   */
  #listedSpelling(username) {
    const lower = username.toLowerCase();
    return [...this.#list.querySelectorAll('tr[data-username]')]
      .map((row) => row.dataset.username)
      .find((listed) => listed.toLowerCase() === lower);
  }

  /**
   * Says a creator is already listed. The input keeps what was typed, so a near-miss of the intended name can be
   * corrected.
   *
   * @param {string} username - The listed username.
   */
  #warnAlreadyListed(username) {
    this.#setError(`"${username}" is already a listed creator, so nothing changed.`);
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
