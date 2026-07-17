/**
 * Wires the dashboard's "My Routes" section (#3343): copy a route's share link, rename it inline, and soft-delete it.
 *
 * The route rows are server-rendered in dashboard.scala.html; this class only attaches behavior. Mutations go to the
 * ownership-scoped JSON endpoints (PUT/DELETE /userapi/routes/:routeId), so a stale row (e.g. deleted in another tab)
 * comes back 404 and is surfaced via the shared error message.
 */
class MyRoutes {
  #list;
  #emptyEl;
  #statusEl;

  /**
   * @param {HTMLElement} listEl - The <ul> of route rows.
   */
  constructor(listEl) {
    this.#list = listEl;
    this.#emptyEl = document.getElementById('ud-routes-empty');
    this.#statusEl = document.getElementById('ud-routes-status');
  }

  /** Attaches all row behaviors. */
  init() {
    this.#list.querySelectorAll('.ud-route-copy').forEach((btn) => {
      btn.addEventListener('click', () => this.#copyLink(btn));
    });
    this.#list.querySelectorAll('.ud-route-rename').forEach((btn) => {
      btn.addEventListener('click', () => this.#startRename(btn));
    });
    this.#list.querySelectorAll('.ud-route-delete').forEach((btn) => {
      btn.addEventListener('click', () => this.#deleteRoute(btn));
    });
    this.#list.querySelectorAll('.ud-route-explore, .ud-route-labelmap').forEach((link) => {
      link.addEventListener('click', () => {
        const kind = link.classList.contains('ud-route-explore') ? 'Explore' : 'LabelMap';
        window.logWebpageActivity(`Click_module=RouteList_${kind}_RouteId=${link.dataset.routeId}`);
      });
    });
    this.#list.querySelectorAll('.ud-route-view').forEach((link) => {
      link.addEventListener('click', () => {
        window.logWebpageActivity(`Click_module=RouteList_View_RouteId=${link.dataset.routeId}`);
      });
    });
  }

  /** Announces a change to screen readers via the section's live region. */
  #announce(message) {
    if (this.#statusEl) this.#statusEl.textContent = message;
  }

  /**
   * Copies the route's shareable Explore link to the clipboard and confirms with a toast.
   * @param {HTMLElement} btn - The clicked copy button (carries data-route-id).
   */
  #copyLink(btn) {
    const url = `${window.location.origin}/explore?routeId=${btn.dataset.routeId}`;
    navigator.clipboard.writeText(url);
    Toast.show({ message: i18next.t('dashboard:routes-link-copied'), reference: btn });
    this.#announce(i18next.t('dashboard:routes-link-copied'));
    window.logWebpageActivity(`Click_module=RouteList_Copy_RouteId=${btn.dataset.routeId}`);
  }

  /**
   * Swaps a row's name for an inline text input with save/cancel; Enter saves, Escape cancels.
   * @param {HTMLElement} btn - The clicked rename button.
   */
  #startRename(btn) {
    const row = btn.closest('.ud-route-row');
    const nameEl = row.querySelector('.ud-route-name');
    if (row.querySelector('.ud-route-rename-form')) return; // Already editing.

    const maxLength = this.#list.dataset.maxNameLength; // Sourced from the backend's Route.MaxNameLength.
    const form = document.createElement('span');
    form.className = 'ud-route-rename-form';
    form.innerHTML = `
      <input type="text" class="ud-input ud-route-rename-input" maxlength="${maxLength}"
             aria-label="${i18next.t('dashboard:routes-rename-aria')}">
      <button type="button" class="ud-btn-primary ud-route-rename-save">${i18next.t('dashboard:routes-rename-save')}</button>
      <button type="button" class="ud-btn-secondary ud-route-rename-cancel">${i18next.t('dashboard:routes-rename-cancel')}</button>`;
    const input = form.querySelector('input');
    input.value = nameEl.textContent;
    nameEl.hidden = true;
    nameEl.after(form);
    input.focus();
    input.select();

    const closeForm = () => {
      form.remove();
      nameEl.hidden = false;
      btn.focus();
    };
    form.querySelector('.ud-route-rename-cancel').addEventListener('click', closeForm);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeForm();
      if (e.key === 'Enter') save();
    });

    const save = async () => {
      const newName = input.value.trim();
      if (!newName || newName === nameEl.textContent) {
        closeForm();
        return;
      }
      try {
        const res = await fetch(`/userapi/routes/${row.dataset.routeId}`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName }),
        });
        const data = await res.json();
        if (!res.ok) {
          // The server's message is already localized (e.g. a name rejected by the profanity guard).
          const message = typeof data.message === 'string' ? data.message : i18next.t('dashboard:routes-error');
          Toast.show({ message, reference: btn });
          return;
        }
        nameEl.textContent = data.name;
        closeForm();
        this.#announce(i18next.t('dashboard:routes-renamed'));
        window.logWebpageActivity(`Click_module=RouteList_Rename_RouteId=${row.dataset.routeId}`);
      } catch (e) {
        console.error('Route rename failed', e);
        Toast.show({ message: i18next.t('dashboard:routes-error'), reference: btn });
      }
    };
    form.querySelector('.ud-route-rename-save').addEventListener('click', save);
  }

  /**
   * Soft-deletes a route after a confirmation that warns shared links stop working, then removes its row.
   * @param {HTMLElement} btn - The clicked delete button.
   */
  async #deleteRoute(btn) {
    const row = btn.closest('.ud-route-row');
    const name = row.querySelector('.ud-route-name').textContent;
    // escapeValue off: this text goes to window.confirm (plain text), not into markup.
    const confirmMsg = i18next.t('dashboard:routes-delete-confirm', { name, interpolation: { escapeValue: false } });
    if (!window.confirm(confirmMsg)) return;

    try {
      const res = await fetch(`/userapi/routes/${row.dataset.routeId}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`delete failed: ${res.status}`);
      row.remove();
      // escapeValue off: the announcement is set via textContent, not markup.
      this.#announce(i18next.t('dashboard:routes-deleted', { name, interpolation: { escapeValue: false } }));
      if (this.#list.querySelectorAll('.ud-route-row').length === 0) {
        this.#list.hidden = true;
        if (this.#emptyEl) this.#emptyEl.hidden = false;
      }
      window.logWebpageActivity(`Click_module=RouteList_Delete_RouteId=${row.dataset.routeId}`);
    } catch (e) {
      console.error('Route delete failed', e);
      Toast.show({ message: i18next.t('dashboard:routes-error'), reference: btn });
    }
  }
}
