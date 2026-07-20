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
  #descriptionInput;
  #nameError;
  #isSignedIn;
  #getRegionId;
  #getStreetsPayload;
  #getSuggestedName;
  #getCamera;
  #onSaved;
  #onClose;

  /**
   * @param {Object} opts
   * @param {boolean} opts.isSignedIn - Whether the user is signed in (vs anonymous), from the server.
   * @param {Function} opts.getRegionId - Returns the current route's region id.
   * @param {Function} opts.getStreetsPayload - Returns the ordered street list in the /saveRoute wire format.
   * @param {Function} opts.getSuggestedName - Returns a suggested route name (e.g. from the endpoint streets).
   * @param {Function} opts.getCamera - Returns the current map camera pose, for restoring the view post-sign-in.
   * @param {Function} opts.onSaved - Called with (routeId, name, slug) after a successful save.
   * @param {Function} opts.onClose - Called after the modal closes (e.g. to restore focus).
   */
  constructor(opts) {
    this.#isSignedIn = opts.isSignedIn === true;
    this.#getRegionId = opts.getRegionId;
    this.#getStreetsPayload = opts.getStreetsPayload;
    this.#getSuggestedName = opts.getSuggestedName;
    this.#getCamera = opts.getCamera;
    this.#onSaved = opts.onSaved;
    this.#onClose = opts.onClose;

    this.#backdrop = document.getElementById('save-route-modal-backdrop');
    this.#nameInput = document.getElementById('route-name-input');
    this.#descriptionInput = document.getElementById('route-description-input');
    this.#nameError = document.getElementById('route-name-error');

    // The sign-in button only exists for anonymous users.
    document.getElementById('confirm-save-button').addEventListener('click', () => this.#submit());
    document.getElementById('cancel-save-button').addEventListener('click', () => this.#cancel());
    document.getElementById('close-save-modal-button').addEventListener('click', () => this.#cancel());
    document.getElementById('signin-save-button')?.addEventListener('click', () => this.#stashRouteAndSignIn());
    this.#nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.#submit();
    });
    // Focus is always inside the dialog while it's open, so Escape bubbles here.
    this.#backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.#cancel();
    });
  }

  /**
   * Reads and clears the route stashed before a sign-in reload.
   * @returns {Object|null} {regionId, name, description, streets, camera} or null if there is nothing (valid)
   *                        to restore.
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
   *                                 suggestion built from the route's endpoint streets (or the region).
   * @param {string} [prefillDescription] - Description to prefill (used when restoring a stashed route).
   */
  open(prefillName = null, prefillDescription = null) {
    window.logWebpageActivity('RouteBuilder_Click=OpenSaveModal');
    // maxlength doesn't apply to values set from JS, so the suggestion is clipped by hand.
    const suggestion = (prefillName ?? this.#getSuggestedName()).slice(0, this.#nameInput.maxLength);
    this.#nameInput.value = suggestion;
    if (this.#descriptionInput) this.#descriptionInput.value = prefillDescription ?? '';
    this.#nameError.hidden = true;
    this.#backdrop.style.visibility = 'visible';
    this.#nameInput.focus();
    this.#nameInput.select();
  }

  close() {
    this.#backdrop.style.visibility = 'hidden';
    this.#onClose();
  }

  /** Dismisses the modal without saving (Cancel button, the X, or Escape). */
  #cancel() {
    window.logWebpageActivity('RouteBuilder_Click=CloseSaveModal');
    this.close();
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
        description: this.#descriptionInput?.value.trim() ?? '',
        streets: this.#getStreetsPayload(),
        camera: this.#getCamera(), // So the post-sign-in reload comes back to the exact view the user left.
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
    const description = this.#descriptionInput?.value.trim() ?? '';

    fetch('/saveRoute', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        region_id: this.#getRegionId(),
        streets: this.#getStreetsPayload(),
        name,
        description,
      }),
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
        this.#onSaved(data.route_id, data.name, data.slug);
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
