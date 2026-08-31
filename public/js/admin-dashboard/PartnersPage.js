/**
 * PartnersPage — the /admin/partners manager for the landing page's community-partner logos (#4516).
 *
 * Renders two independently ordered lists from /adminapi/partners — this city's partners and the global list shown
 * on every deployment — with per-row reorder/edit/delete and one add form per editable scope. City rows are editable
 * by any admin; global rows only by Owners (the server enforces this on the /adminapi/globalPartners routes, so the
 * flag here only decides what UI to draw). Admin-only page, English-only by convention.
 */
class PartnersPage {
  #isOwner;
  #statusEl;
  /** @type {{city: Array<Object>, global: Array<Object>}} The current metadata rows, in display order. */
  #partners = { city: [], global: [] };
  /** @type {?{scope: string, partner: Object}} The row a form is currently editing, or null when adding. */
  #editing = null;
  /** @type {{city: boolean, global: boolean}} Whether a reorder PUT is in flight, per scope. */
  #reorderBusy = { city: false, global: false };

  /**
   * @param {Object} opts
   * @param {boolean} opts.isOwner - Whether the signed-in admin holds the Owner role (may edit the global scope).
   */
  constructor(opts) {
    this.#isOwner = opts.isOwner;
    this.#statusEl = document.getElementById('partners-status');
  }

  init() {
    for (const form of document.querySelectorAll('.partners-add-form')) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.#submitForm(form);
      });
      form.querySelector('.partners-cancel-edit').addEventListener('click', () => this.#cancelEdit(form));
    }
    this.#load();
  }

  async #load() {
    try {
      const res = await fetch('/adminapi/partners');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.#partners = { city: data.city_partners, global: data.global_partners };
      this.#render('city');
      this.#render('global');
      this.#setStatus(`${this.#partners.global.length} global · ${this.#partners.city.length} city`);
    } catch (err) {
      console.error('Partners page: list failed to load.', err);
      this.#setStatus('Failed to load partners — try reloading the page.');
    }
  }

  /** @param {string} scope - 'city' or 'global'. */
  #render(scope) {
    const listEl = document.getElementById(`partners-${scope}-list`);
    const rows = this.#partners[scope];
    listEl.replaceChildren();
    if (rows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'partners-empty';
      empty.textContent = scope === 'city' ? 'No city partners yet.' : 'No global partners yet.';
      listEl.appendChild(empty);
      return;
    }
    rows.forEach((partner, index) => listEl.appendChild(this.#buildRow(scope, partner, index)));
  }

  /**
   * @param {string} scope - 'city' or 'global'.
   * @param {Object} partner - A partner metadata payload.
   * @param {number} index - The row's position within its scope.
   * @returns {HTMLElement}
   */
  #buildRow(scope, partner, index) {
    const row = document.createElement('div');
    row.className = 'partners-row';

    const thumb = document.createElement('img');
    thumb.className = 'partners-row-thumb';
    thumb.src = partner.logo_url;
    thumb.alt = partner.alt_text || `${partner.name} logo`;
    thumb.width = partner.logo_width;
    thumb.height = partner.logo_height;

    const info = document.createElement('div');
    info.className = 'partners-row-info';
    const name = document.createElement('div');
    name.className = 'partners-row-name';
    name.textContent = partner.name; // textContent escapes — the name is admin-entered free text.
    info.appendChild(name);
    if (partner.url) {
      const link = document.createElement('a');
      link.className = 'partners-row-url';
      link.href = partner.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = partner.url;
      info.appendChild(link);
    }

    row.append(thumb, info);

    if (this.#canEdit(scope)) {
      const actions = document.createElement('div');
      actions.className = 'partners-row-actions';
      const reordering = this.#reorderBusy[scope];
      actions.append(
        this.#actionButton('Move up', '↑', reordering || index === 0, () => this.#move(scope, index, -1)),
        this.#actionButton('Move down', '↓', reordering || index === this.#partners[scope].length - 1,
          () => this.#move(scope, index, 1)),
        this.#actionButton('Edit', 'Edit', false, () => this.#startEdit(scope, partner)),
        this.#actionButton('Delete', 'Delete', false, () => this.#deletePartner(partner), true),
      );
      row.appendChild(actions);
    }
    return row;
  }

  /**
   * @param {string} label - The accessible name (aria-label) for the button.
   * @param {string} text - The visible button text.
   * @param {boolean} disabled - Whether the action is currently unavailable (e.g. moving the first row up).
   * @param {function(): void} onClick - The click handler.
   * @param {boolean} [danger=false] - Whether to style the button as destructive.
   * @returns {HTMLButtonElement}
   */
  #actionButton(label, text, disabled, onClick, danger = false) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = danger
      ? 'button-ps button--secondary button--small partners-row-btn--danger'
      : 'button-ps button--secondary button--small';
    btn.textContent = text;
    btn.setAttribute('aria-label', label);
    btn.disabled = disabled;
    btn.addEventListener('click', onClick);
    return btn;
  }

  /** @param {string} scope @returns {boolean} */
  #canEdit(scope) {
    return scope === 'city' || this.#isOwner;
  }

  /**
   * Swaps a row with its neighbor and persists the whole scope's new order. One reorder per scope runs at a time:
   * the arrows render disabled while the PUT is in flight, so two rapid clicks can't race their full-order payloads
   * (concurrent PUTs are last-writer-wins, which can silently commit the older order). A rejected write re-syncs
   * from the server, since the only cause is a concurrent edit elsewhere.
   */
  async #move(scope, index, delta) {
    if (this.#reorderBusy[scope]) return;
    const rows = this.#partners[scope];
    const target = index + delta;
    [rows[index], rows[target]] = [rows[target], rows[index]];
    this.#reorderBusy[scope] = true;
    this.#render(scope);
    try {
      const res = await fetch(scope === 'global' ? '/adminapi/globalPartners/order' : '/adminapi/partners/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ partner_ids: rows.map((p) => p.partner_id) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.#reorderBusy[scope] = false;
      this.#render(scope);
    } catch (err) {
      console.error('Partners page: reorder failed.', err);
      this.#reorderBusy[scope] = false;
      this.#load();
    }
  }

  /** Puts the scope's form into edit mode, pre-filled from the row (a new logo file stays optional). */
  #startEdit(scope, partner) {
    if (this.#editing) this.#cancelEdit(this.#formFor(this.#editing.scope)); // Only one edit at a time.
    const form = this.#formFor(scope);
    this.#editing = { scope, partner };
    form.elements.name.value = partner.name;
    form.elements.url.value = partner.url || '';
    form.elements.alt_text.value = partner.alt_text || '';
    form.elements.logo.value = '';
    form.querySelector('.partners-form-heading').textContent = `Editing "${partner.name}"`;
    form.querySelector('[type="submit"]').textContent = 'Save changes';
    form.querySelector('.partners-cancel-edit').hidden = false;
    this.#showError(form, null);
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    form.elements.name.focus();
  }

  /**
   * Resets a form back to add mode. The shared edit state clears only when it belongs to THIS form's scope — the
   * other scope's form may be mid-edit, and nulling its state would turn that form's next save into a duplicate
   * create instead of an update.
   *
   * @param {HTMLFormElement} form
   */
  #cancelEdit(form) {
    if (this.#editing && this.#editing.scope === form.dataset.scope) this.#editing = null;
    form.reset();
    form.querySelector('.partners-form-heading').textContent = 'Add a partner';
    form.querySelector('[type="submit"]').textContent = 'Add partner';
    form.querySelector('.partners-cancel-edit').hidden = true;
    this.#showError(form, null);
  }

  /** Creates or (in edit mode) updates a partner from the form's fields, then re-syncs the lists. */
  async #submitForm(form) {
    const scope = form.dataset.scope;
    const editing = this.#editing && this.#editing.scope === scope ? this.#editing : null;
    if (!editing && form.elements.logo.files.length === 0) {
      this.#showError(form, this.#errorMessage(form, 'logo_required'));
      return;
    }
    const body = new FormData();
    body.append('name', form.elements.name.value);
    body.append('url', form.elements.url.value);
    body.append('alt_text', form.elements.alt_text.value);
    if (form.elements.logo.files.length > 0) body.append('logo', form.elements.logo.files[0]);

    const submitBtn = form.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    try {
      const url = editing
        ? `/adminapi/partners/${editing.partner.partner_id}`
        : (scope === 'global' ? '/adminapi/globalPartners' : '/adminapi/partners');
      const res = await fetch(url, { method: editing ? 'PUT' : 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.#showError(form, this.#errorMessage(form, data.error));
        return;
      }
      this.#cancelEdit(form);
      await this.#load();
    } catch (err) {
      console.error('Partners page: save failed.', err);
      this.#showError(form, 'Something went wrong — please try again.');
    } finally {
      submitBtn.disabled = false;
    }
  }

  async #deletePartner(partner) {
    const ok = await ConfirmDialog.confirm({
      message: `Delete the "${partner.name}" logo? It disappears from the landing page immediately, `
        + 'and this cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/adminapi/partners/${partner.partner_id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await this.#load();
    } catch (err) {
      console.error('Partners page: delete failed.', err);
    }
  }

  /** @param {string} scope @returns {HTMLFormElement} */
  #formFor(scope) {
    return document.querySelector(`.partners-add-form[data-scope="${scope}"]`);
  }

  /**
   * What a rejection code from the partner endpoints should say to the admin. The size and length limits in the
   * copy are read off the form itself — the maxlength and data-max-*-bytes attributes the Twirl view stamps from
   * the backend's own constants — so they can't drift from what the server actually enforces.
   *
   * @param {HTMLFormElement} form - The form whose backend-stamped limits parameterize the copy.
   * @param {string} code - The rejection code from the server (or the client-side 'logo_required').
   * @returns {string}
   */
  #errorMessage(form, code) {
    const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`;
    const messages = {
      logo_required: 'Choose a logo image (PNG or JPEG) to upload.',
      logo_too_large: `That image is too large — please upload a file under ${mb(form.dataset.maxUploadBytes)}.`,
      logo_encoded_too_large: `Even re-encoded, that image exceeds the ${mb(form.dataset.maxStoredBytes)} storage `
        + 'cap — try a smaller or simpler image.',
      logo_invalid: 'That file could not be read as a PNG or JPEG image.',
      name_invalid: `Enter a partner name (at most ${form.elements.name.maxLength} characters).`,
      url_invalid: 'The website URL must be a full http(s) address, e.g. https://example.org.',
      alt_text_invalid: `Alt text can be at most ${form.elements.alt_text.maxLength} characters.`,
      bad_order: 'The list changed underneath you — reloading.',
      not_found: 'That partner no longer exists — reloading.',
    };
    return messages[code] || 'Something went wrong — please try again.';
  }

  /** Shows (or with null, clears) a form's inline error line. */
  #showError(form, message) {
    const errorEl = form.querySelector('.partners-form-error');
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
  }

  /** @param {string} message */
  #setStatus(message) {
    this.#statusEl.textContent = message;
  }
}
