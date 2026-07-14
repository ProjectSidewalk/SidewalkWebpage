/**
 * Drives the "Create a team" dialog (shared by the dashboard and leaderboard).
 *
 * Any `.ud-create-team-btn` opens the dialog; submitting POSTs to /userapi/createTeam. The server validates the name
 * (length + profanity/abuse guard) and auto-joins the creator, so on success we just reload. Server-side validation
 * messages are shown inline. CSRF is handled by the global fetch wrapper (AppManager).
 */
class TeamCreate {
  /** Wires the open buttons and the form. Safe to call when the dialog isn't present (no-op). */
  static init() {
    const dialog = document.getElementById('ud-create-team-dialog');
    const form = document.getElementById('ud-create-team-form');
    if (!dialog || !form) return;

    document.querySelectorAll('.ud-create-team-btn').forEach((btn) =>
      btn.addEventListener('click', () => {
        TeamCreate.#reset();
        dialog.showModal();
      }));

    const cancel = document.getElementById('ud-team-cancel');
    if (cancel) cancel.addEventListener('click', () => dialog.close());

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      TeamCreate.#submit();
    });
  }

  /** Wires the "Join team" dropdown button (dashboard only). Safe to call when absent. */
  static initJoin() {
    document.querySelectorAll('.ud-join-team-btn').forEach((btn) =>
      btn.addEventListener('click', () => TeamCreate.#join(btn)));
  }

  /** Switches the user to the selected open team, then reloads. */
  static async #join(btn) {
    const select = document.getElementById('ud-team-select');
    const teamId = parseInt(select && select.value, 10);
    if (!teamId || teamId <= 0) return; // "Choose a team…" placeholder — nothing to do.
    btn.setAttribute('disabled', 'disabled');
    try {
      const res = await fetch(
        `/userapi/setUserTeam?userId=${encodeURIComponent(btn.dataset.userId)}&teamId=${teamId}`,
        { method: 'PUT', headers: { Accept: 'application/json' } });
      if (res.ok) {
        window.location.reload();
        return;
      }
      console.error('Join team failed', res.status);
    } catch (e) {
      console.error('Join team failed', e);
    } finally {
      btn.removeAttribute('disabled');
    }
  }

  /** Clears the form + any prior error. */
  static #reset() {
    const err = document.getElementById('ud-team-error');
    err.hidden = true;
    err.textContent = '';
    document.getElementById('ud-create-team-form').reset();
  }

  /** Posts the new team and reloads on success, or shows the server's error inline. */
  static async #submit() {
    const name = document.getElementById('ud-team-name').value.trim();
    const description = document.getElementById('ud-team-desc').value.trim();
    const submitBtn = document.getElementById('ud-team-submit');

    if (name.length < 2) {
      TeamCreate.#showError(i18next.t('dashboard:team-dialog.name-too-short'));
      return;
    }

    submitBtn.setAttribute('disabled', 'disabled');
    try {
      const res = await fetch('/userapi/createTeam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        window.location.reload();
        return;
      }
      // Server errors arrive already localized (Play messages keyed off the request language).
      TeamCreate.#showError(data.error || i18next.t('dashboard:team-dialog.create-failed'));
    } catch (e) {
      console.error('Create team failed', e);
      TeamCreate.#showError(i18next.t('dashboard:team-dialog.network-error'));
    } finally {
      submitBtn.removeAttribute('disabled');
    }
  }

  /**
     * @param {string} msg - Error text to show in the dialog.
     */
  static #showError(msg) {
    const err = document.getElementById('ud-team-error');
    err.textContent = msg;
    err.hidden = false;
  }
}

// appManager.ready (not DOMContentLoaded) so i18next is initialized before any error string can be shown.
window.appManager.ready(() => {
  TeamCreate.init();
  TeamCreate.initJoin();
});
