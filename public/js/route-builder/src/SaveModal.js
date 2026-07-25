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
  #confirmButton;
  #submitting = false; // A save is in flight; blocks a second submission creating a duplicate route.

  /**
   * @param {Object} opts
   * @param {boolean} opts.isSignedIn - Whether the user is signed in (vs anonymous), from the server.
   * @param {Function} opts.getRegionId - Returns the current route's region id.
   * @param {Function} opts.getStreetsPayload - Returns the ordered street list in the /saveRoute wire format.
   * @param {Function} opts.getSuggestedName - Returns a suggested route name (e.g. from the endpoint streets).
   * @param {Function} opts.getCamera - Returns the current map camera pose, for restoring the view post-sign-in.
   * @param {Function} opts.onSaved - Called with the saved-route payload after a successful save.
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

    this.#confirmButton = document.getElementById('confirm-save-button');
    // The sign-in button only exists for anonymous users.
    this.#confirmButton.addEventListener('click', () => this.#submit());
    document.getElementById('cancel-save-button').addEventListener('click', () => this.#cancel());
    document.getElementById('close-save-modal-button').addEventListener('click', () => this.#cancel());
    document.getElementById('signin-save-button')?.addEventListener('click', () => this.#stashRouteAndSignIn());
    this.#nameInput.addEventListener('keydown', (e) => {
      // e.repeat: a held Enter key autorepeats, which would submit over and over.
      if (e.key === 'Enter' && !e.repeat) this.#submit();
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
    this.#submitting = false;
    this.#confirmButton.disabled = false;
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
   *
   * Guarded against a second submission while the first is in flight: the modal only closes once the response
   * arrives, and the server has no idea two requests are the same route — slug collisions resolve to "name-2",
   * so a double-click would quietly create duplicate routes rather than failing.
   */
  #submit() {
    if (this.#submitting) return;
    this.#submitting = true;
    this.#confirmButton.disabled = true;
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
          this.#submitting = false;
          this.#confirmButton.disabled = false;
          // The server's message is already localized (e.g. a name rejected by the profanity guard).
          this.#nameError.textContent
            = typeof data.message === 'string' ? data.message : i18next.t('save-error');
          this.#nameError.hidden = false;
          window.logWebpageActivity('RouteBuilder_Click=SaveError');
          return;
        }
        this.hide();
        this.#onSaved(data);
        window.logWebpageActivity(`RouteBuilder_Click=SaveSuccess_RouteId=${data.route_id}`);
      })
      .catch((error) => {
        console.error('Error:', error);
        this.#submitting = false;
        this.#confirmButton.disabled = false;
        this.#nameError.textContent = i18next.t('save-error');
        this.#nameError.hidden = false;
        window.logWebpageActivity('RouteBuilder_Click=SaveError');
      });
  }
}
