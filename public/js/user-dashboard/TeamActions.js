/**
 * Drives the team controls shared by the dashboard, Settings, and the leaderboard: create, join, and leave.
 *
 * Everything is wired by class, so a page gets whichever controls it renders and nothing more. Any
 * `.ud-create-team-btn` opens the create dialog; submitting POSTs to /userapi/createTeam. The server validates the
 * name (length + profanity/abuse guard) and auto-joins the creator. Server-side validation messages are shown
 * inline. CSRF is handled by the global fetch wrapper (AppManager).
 *
 * A finished team change reloads so every team-dependent part of the page re-renders — except on Settings, where a
 * reload would throw away whatever the user has typed into the rest of the form but not saved yet. There the team
 * controls are patched in place instead (#5147).
 */
class TeamActions {
  /** Wires the open buttons and the form. Safe to call when the dialog isn't present (no-op). */
  static init() {
    const dialog = document.getElementById('ud-create-team-dialog');
    const form = document.getElementById('ud-create-team-form');
    if (!dialog || !form) return;

    document.querySelectorAll('.ud-create-team-btn').forEach((btn) =>
      btn.addEventListener('click', () => {
        TeamActions.#reset();
        dialog.showModal();
      }));

    const cancel = document.getElementById('ud-team-cancel');
    if (cancel) cancel.addEventListener('click', () => dialog.close());

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      TeamActions.#submit();
    });
  }

  /**
   * Wires the "Join team" dropdown button (dashboard only). Safe to call when absent.
   *
   * The dropdown opens on the team the user is already on, so Join is inert until they pick a different one.
   */
  static initJoin() {
    const select = document.getElementById('ud-team-select');
    document.querySelectorAll('.ud-join-team-btn').forEach((btn) => {
      btn.addEventListener('click', () => TeamActions.#join(btn));
      if (!select) return;
      select.addEventListener('change', () => {
        btn.disabled = select.value === '' || select.value === select.dataset.currentTeam;
      });
    });
  }

  /**
   * Wires the "Leave team" button, rendered only for someone on a team. Delegated, so a button added after a team is
   * created in place is live without rewiring.
   */
  static initLeave() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.ud-leave-team-btn');
      if (btn) TeamActions.#leave(btn);
    });
  }

  /** Switches the user to the selected open team, then reloads. */
  static async #join(btn) {
    const select = document.getElementById('ud-team-select');
    const teamId = parseInt(select && select.value, 10);
    // The placeholder, or the team they're already on: either way there's nothing to write.
    if (!teamId || teamId <= 0 || select.value === select.dataset.currentTeam) return;
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

  /**
   * Confirms, then drops the user's team membership.
   *
   * Confirmed first because leaving isn't always undoable, and the prompt says which case this is: an open team can
   * be rejoined from the same dropdown, a closed one needs an admin to put the user back.
   *
   * @param {HTMLButtonElement} btn - The clicked button, carrying the team's name and whether it's still open.
   * @returns {Promise<void>}
   */
  static async #leave(btn) {
    const wasOpen = btn.dataset.teamOpen === 'true';
    const confirmed = await ConfirmDialog.confirm({
      // escapeValue off: the name renders as textContent inside ConfirmDialog, not markup, so it needn't be escaped.
      message: i18next.t(wasOpen ? 'dashboard:team-leave-confirm-open' : 'dashboard:team-leave-confirm-closed',
        { name: btn.dataset.teamName, interpolation: { escapeValue: false } }),
      confirmText: i18next.t('dashboard:team-leave'),
      cancelText: i18next.t('common:cancel'),
      danger: true,
    });
    if (!confirmed) return;

    btn.setAttribute('disabled', 'disabled');
    try {
      const userId = btn.closest('.ud-team-actions').dataset.userId;
      const res = await fetch(`/userapi/leaveTeam?userId=${encodeURIComponent(userId)}`,
        { method: 'PUT', headers: { Accept: 'application/json' } });
      if (res.ok) {
        if (!TeamActions.#syncSettingsForm(null)) window.location.reload();
        return;
      }
      console.error('Leave team failed', res.status);
    } catch (e) {
      console.error('Leave team failed', e);
    } finally {
      btn.removeAttribute('disabled');
    }
  }

  /**
   * Moves the Settings team controls onto a team the user just joined or left, without a reload.
   *
   * Only Settings has a form worth protecting, so this is also what tells the two callers apart: a page without the
   * team select gets `false` and reloads as before.
   *
   * @param {?{id: number, name: string, open: boolean}} team - The team now joined, or null after leaving.
   * @returns {boolean} true if the page was updated in place; false if the caller should reload instead.
   */
  static #syncSettingsForm(team) {
    const select = document.getElementById('set-team');
    if (!select) return false;
    const actions = document.querySelector('.ud-team-actions');
    const leaveBtn = actions.querySelector('.ud-leave-team-btn');

    // Whatever was selected is either the placeholder or the team being left. A team the user could switch back to
    // stays in the list as one more option; one that has closed its doors would be a dead choice, so it goes.
    const previous = select.selectedOptions[0];
    if (previous) {
      if (previous.value !== '' && leaveBtn?.dataset.teamOpen === 'true') previous.selected = false;
      else previous.remove();
    }
    leaveBtn?.remove();

    // Built element by element rather than as markup: a team name is user-supplied text, and textContent/dataset
    // keep it text.
    const option = document.createElement('option');
    option.value = team ? String(team.id) : '';
    option.textContent = team ? team.name : select.dataset.placeholder;
    option.selected = true;
    select.prepend(option);
    // The save compares against this to skip re-writing a team the user is already on, so it moves too.
    select.dataset.currentTeam = option.value;

    if (team) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ud-btn-secondary ud-leave-team-btn';
      btn.textContent = i18next.t('dashboard:team-leave');
      btn.dataset.teamName = team.name;
      btn.dataset.teamOpen = String(team.open);
      actions.append(btn);
    }
    return true;
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
      TeamActions.#showError(i18next.t('dashboard:team-dialog.name-too-short'));
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
        document.getElementById('ud-create-team-dialog').close();
        // A team is open to new members the moment it's created; only an admin ever closes one.
        const team = { id: data.team_id, name, open: true };
        if (!TeamActions.#syncSettingsForm(team)) window.location.reload();
        return;
      }
      // Server errors arrive already localized (Play messages keyed off the request language).
      TeamActions.#showError(data.error || i18next.t('dashboard:team-dialog.create-failed'));
    } catch (e) {
      console.error('Create team failed', e);
      TeamActions.#showError(i18next.t('dashboard:team-dialog.network-error'));
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
  TeamActions.init();
  TeamActions.initJoin();
  TeamActions.initLeave();
});
