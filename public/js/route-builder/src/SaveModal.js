/**
 * The name-your-route save modal (#3343). Owns the name input, submission to POST /saveRoute, and the anonymous
 * "sign in to save" flow: the in-progress route is stashed in sessionStorage, the sign-in modal reloads the page,
 * and RouteBuilder restores the stash (via consumePendingRoute) so the user lands back in the save flow.
 */
class SaveModal {
  // Storage key for the pending route stashed across the sign-in page reload.
  static PENDING_ROUTE_KEY = 'rb-pending-route';

  #backdrop;
  #nameInput;
  #nameError;
  #isSignedIn;
  #getRegionId;
  #getRegionName;
  #getStreetsPayload;
  #onSaved;
  #onClose;

  /**
   * @param {Object} opts
   * @param {boolean} opts.isSignedIn - Whether the user is signed in (vs anonymous), from the server.
   * @param {Function} opts.getRegionId - Returns the current route's region id.
   * @param {Function} opts.getRegionName - Returns the current route's region display name (or null).
   * @param {Function} opts.getStreetsPayload - Returns the ordered street list in the /saveRoute wire format.
   * @param {Function} opts.onSaved - Called with (routeId, name) after a successful save.
   * @param {Function} opts.onClose - Called after the modal closes (e.g. to restore focus).
   */
  constructor(opts) {
    this.#isSignedIn = opts.isSignedIn === true;
    this.#getRegionId = opts.getRegionId;
    this.#getRegionName = opts.getRegionName;
    this.#getStreetsPayload = opts.getStreetsPayload;
    this.#onSaved = opts.onSaved;
    this.#onClose = opts.onClose;

    this.#backdrop = document.getElementById('save-route-modal-backdrop');
    this.#nameInput = document.getElementById('route-name-input');
    this.#nameError = document.getElementById('route-name-error');

    // The sign-in button only exists for anonymous users.
    document.getElementById('confirm-save-button').addEventListener('click', () => this.#submit());
    document.getElementById('back-save-button').addEventListener('click', () => this.close());
    document.getElementById('signin-save-button')?.addEventListener('click', () => this.#stashRouteAndSignIn());
    this.#nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.#submit();
    });
  }

  /**
   * Reads and clears the route stashed before a sign-in reload.
   * @returns {Object|null} {regionId, name, streets} or null if there is nothing (valid) to restore.
   */
  static consumePendingRoute() {
    try {
      const stash = sessionStorage.getItem(SaveModal.PENDING_ROUTE_KEY);
      if (stash) sessionStorage.removeItem(SaveModal.PENDING_ROUTE_KEY);
      const pending = stash ? JSON.parse(stash) : null;
      return pending && Array.isArray(pending.streets) && pending.streets.length > 0 ? pending : null;
    } catch {
      return null; // Storage unavailable or corrupted stash: nothing to restore.
    }
  }

  /**
   * Opens the save modal with a name suggestion the user can overwrite.
   *
   * @param {string} [prefillName] - Name to prefill (used when restoring a stashed route); defaults to a
   *                                 localized "Route in {region}" suggestion.
   */
  open(prefillName = null) {
    window.logWebpageActivity('RouteBuilder_Click=OpenSaveModal');
    const regionName = this.#getRegionName();
    this.#nameInput.value
      = prefillName ?? (regionName ? i18next.t('route-name-default', { region: regionName }) : '');
    this.#nameError.hidden = true;
    this.#backdrop.style.visibility = 'visible';
    this.#nameInput.focus();
    this.#nameInput.select();
  }

  close() {
    this.#backdrop.style.visibility = 'hidden';
    this.#onClose();
  }

  /** Hides the modal without the close callback (used by the full-UI reset). */
  hide() {
    this.#backdrop.style.visibility = 'hidden';
  }

  /**
   * Stashes the in-progress route in sessionStorage and opens the sign-in modal. Signing in reloads the page;
   * the stash is picked up via consumePendingRoute so the user lands back in the save flow with their route
   * (and typed name) intact — the route is then saved under their registered account.
   */
  #stashRouteAndSignIn() {
    window.logWebpageActivity('RouteBuilder_Click=SignInToSave');
    try {
      sessionStorage.setItem(SaveModal.PENDING_ROUTE_KEY, JSON.stringify({
        regionId: this.#getRegionId(),
        name: this.#nameInput.value.trim(),
        streets: this.#getStreetsPayload(),
      }));
    } catch {
      // Storage unavailable: sign-in still works, the route just can't be carried across the reload.
    }
    if (window.psAuthModal) {
      window.psAuthModal.open('signIn');
    } else {
      window.location.assign('/signIn?url=%2FrouteBuilder');
    }
  }

  /**
   * Saves the route to the database, then hands off to onSaved (which shows the Route Saved modal).
   */
  #submit() {
    if (!this.#isSignedIn) window.logWebpageActivity('RouteBuilder_Click=ContinueAsGuest');
    const name = this.#nameInput.value.trim();

    fetch('/saveRoute', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ region_id: this.#getRegionId(), streets: this.#getStreetsPayload(), name }),
    })
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          // The server's message is already localized (e.g. a name rejected by the profanity guard).
          this.#nameError.textContent
            = typeof data.message === 'string' ? data.message : i18next.t('save-error');
          this.#nameError.hidden = false;
          window.logWebpageActivity('RouteBuilder_Click=SaveError');
          return;
        }
        this.hide();
        this.#onSaved(data.route_id, data.name);
        window.logWebpageActivity(`RouteBuilder_Click=SaveSuccess_RouteId=${data.route_id}`);
      })
      .catch((error) => {
        console.error('Error:', error);
        this.#nameError.textContent = i18next.t('save-error');
        this.#nameError.hidden = false;
        window.logWebpageActivity('RouteBuilder_Click=SaveError');
      });
  }
}
