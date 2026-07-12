/**
 * Landing-page grid of recently-found labels with inline Agree/Disagree/Unsure buttons (#1638), so visitors can
 * contribute useful validations straight from the home page.
 *
 * Borrows the Gallery card pattern: a static image (locally-saved crop preferred, GSV Static API as fallback — the
 * crop is free to serve while the API costs money per image) with the label-type icon overlaid at the label's canvas
 * position. Votes POST to /labelmap/validate, which works for anonymous visitors and creates its own mission
 * server-side. Validated cards are swapped for a fresh label from a prefetched pool, giving the "live" feel.
 *
 * Label data comes from POST /label/labels with sort: 'recent', i.e. a shuffled pool of the newest labels needing
 * validation. Nothing is fetched until the section is scrolled near (IntersectionObserver).
 */
class LandingValidationGrid {
  static #GRID_SIZE = 6;
  // The server splits n across the 7 primary label types, so fetch sizes are multiples of 7: 2 per type up front
  // (6 rendered + the rest pooled for replacements), 1 per type on refills.
  static #INITIAL_FETCH = 14;
  static #REFILL_FETCH = 7;
  // Refill the pool in the background once it runs this low, so replacements stay instant.
  static #REFILL_THRESHOLD = 2;
  static #THANKS_MS = 1200;

  #section;
  #grid;
  #loadedLabelIds = new Set();
  #pool = [];
  #fetching = false;
  #firstLoadLogged = false;

  /**
   * @param {HTMLElement} sectionEl - The #landing-validation-container section (rendered with `hidden`).
   */
  constructor(sectionEl) {
    this.#section = sectionEl;
    this.#grid = sectionEl.querySelector('#landing-validation-grid');

    // Unhide and show skeleton cards immediately so the section holds its space — the real cards then swap in
    // without a layout shift. The section re-hides if the city turns out to have nothing to validate.
    this.#section.hidden = false;
    for (let i = 0; i < LandingValidationGrid.#GRID_SIZE; i++) {
      const skeleton = document.createElement('div');
      skeleton.className = 'lvg-card lvg-card-skeleton';
      this.#grid.appendChild(skeleton);
    }

    // Don't hit the server (label queries + imagery checks) until the visitor actually scrolls near the section.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        this.#start();
      }
    }, { rootMargin: '300px' });
    observer.observe(sectionEl);
  }

  /** Fetches the initial batch and swaps the skeletons for real cards (or hides the section if there are none). */
  async #start() {
    await this.#loadBatch(LandingValidationGrid.#INITIAL_FETCH);
    this.#grid.querySelectorAll('.lvg-card-skeleton').forEach((skeleton) => {
      const entry = this.#pool.shift();
      if (entry) skeleton.replaceWith(this.#buildCard(entry));
      else skeleton.remove();
    });

    const count = this.#grid.querySelectorAll('.lvg-card').length;
    if (count === 0) this.#section.hidden = true;
    if (!this.#firstLoadLogged) {
      this.#firstLoadLogged = true;
      window.logWebpageActivity(`View_module=LandingValidationGrid_labelCount=${count}`);
    }
  }

  /**
   * Fetches n recent labels needing validation and appends the usable ones to the pool.
   * @param {number} n - How many labels to request (the server spreads this across label types).
   */
  async #loadBatch(n) {
    if (this.#fetching) return;
    this.#fetching = true;
    try {
      const response = await fetch('/label/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label_type_id: null,
          n,
          loaded_labels: [...this.#loadedLabelIds],
          validation_options: ['unvalidated', 'unsure'],
          sort: 'recent',
        }),
      });
      if (!response.ok) throw new Error(`label fetch failed: ${response.status}`);
      const data = await response.json();

      const usable = (data.labelsOfType || []).filter((entry) =>
        !entry.label.from_current_user
        && entry.label.user_validation === null
        && (entry.cropUrl || entry.gsvImageUrl));
      usable.forEach((entry) => this.#loadedLabelIds.add(entry.label.label_id));

      // Crop-backed labels first: crops are served from our own disk while the GSV Static API is paid per image,
      // so API-backed entries are only used when there aren't enough crops to fill the grid.
      this.#pool.push(...usable.filter((entry) => entry.cropUrl), ...usable.filter((entry) => !entry.cropUrl));
    } catch (e) {
      console.error('Failed to load labels for the validation grid', e);
    } finally {
      this.#fetching = false;
    }
  }

  /**
   * Builds one card: the label image with the label-type icon marked at its canvas position, the localized
   * "Is this a …?" question, and the three validation buttons.
   * @param {Object} entry - One {label, cropUrl, gsvImageUrl} entry from /label/labels.
   * @returns {HTMLElement}
   */
  #buildCard(entry) {
    const label = entry.label;
    const typeKebab = util.camelToKebab(label.label_type);
    const card = document.createElement('figure');
    card.className = 'lvg-card';
    // Which source actually loaded, reported as viewer_type with the validation ('crop' → StaticCrop).
    card.dataset.imageSource = entry.cropUrl ? 'crop' : 'api';

    const imgWrap = document.createElement('div');
    imgWrap.className = 'lvg-card-img';
    const img = document.createElement('img');
    img.className = 'lvg-card-photo';
    img.alt = i18next.t(`common:${typeKebab}`);
    img.addEventListener('error', () => {
      // The saved crop can 404 (signed URLs expire after a while); fall back to the GSV Static API image. A card
      // whose every source fails is dead weight — swap it for a fresh label.
      if (card.dataset.imageSource === 'crop' && entry.gsvImageUrl) {
        card.dataset.imageSource = 'api';
        img.src = entry.gsvImageUrl;
      } else {
        this.#replaceCard(card);
      }
    });
    img.src = entry.cropUrl || entry.gsvImageUrl;
    imgWrap.appendChild(img);

    const iconPath = util.misc.getIconImagePaths(label.label_type)?.iconImagePath;
    if (iconPath) {
      const marker = document.createElement('img');
      marker.className = 'lvg-card-marker';
      marker.src = iconPath;
      marker.alt = '';
      marker.style.left = `${(100 * label.canvas_x) / util.EXPLORE_CANVAS_WIDTH}%`;
      marker.style.top = `${(100 * label.canvas_y) / util.EXPLORE_CANVAS_HEIGHT}%`;
      imgWrap.appendChild(marker);
    }
    card.appendChild(imgWrap);

    const body = document.createElement('figcaption');
    body.className = 'lvg-card-body';
    const questionRow = document.createElement('div');
    questionRow.className = 'lvg-card-question-row';
    const question = document.createElement('span');
    question.className = 'lvg-card-question';
    // The translations deliberately contain <b> emphasis around the label-type name; they're our own locale files.
    question.innerHTML = i18next.t(`validate:top-ui.title.${typeKebab}`);
    questionRow.appendChild(question);
    questionRow.appendChild(this.#buildInfoTip(label, typeKebab));
    body.appendChild(questionRow);

    const actions = document.createElement('div');
    actions.className = 'lvg-card-actions';
    [['Agree', 'lvg-btn-agree'], ['Disagree', 'lvg-btn-disagree'], ['Unsure', 'lvg-btn-unsure']]
      .forEach(([result, cls]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `lvg-btn ${cls}`;
        button.textContent = i18next.t(`common:${result.toLowerCase()}`);
        button.addEventListener('click', () => this.#validate(card, entry, result));
        actions.appendChild(button);
      });
    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  /**
   * Builds the "what is this label type?" info affordance: a small ? button that reveals the label type's
   * one-line explanation (the Explore tutorial's intro copy, already translated in every locale).
   *
   * Follows the accessible tooltip pattern: shown on hover and on keyboard focus, click-to-pin for touch users,
   * dismissable with Escape (WCAG 1.4.13). The tooltip sits flush above the button so a pointer can travel onto
   * it without it closing.
   *
   * @param {Object} label - The card's label from /label/labels.
   * @param {string} typeKebab - The label type in kebab-case (e.g. 'curb-ramp'), as used in locale keys.
   * @returns {HTMLElement}
   */
  #buildInfoTip(label, typeKebab) {
    const wrap = document.createElement('span');
    wrap.className = 'lvg-info';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lvg-info-btn';
    button.textContent = '?';
    button.setAttribute('aria-label', i18next.t('common:label-type-info'));
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-describedby', `lvg-info-tip-${label.label_id}`);

    const tip = document.createElement('span');
    tip.className = 'lvg-info-tip';
    tip.id = `lvg-info-tip-${label.label_id}`;
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    // Our own locale strings; they contain <b>/<br> markup by design.
    tip.innerHTML = i18next.t(`common:mission-start-tutorial.${typeKebab}.slide-1.description`);

    let pinned = false;
    let logged = false;
    const show = () => {
      tip.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      if (!logged) {
        logged = true;
        window.logWebpageActivity(`Click_module=LandingValidationGridInfo_labelType=${label.label_type}`);
      }
    };
    const hide = () => {
      pinned = false;
      tip.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    };
    button.addEventListener('mouseenter', show);
    button.addEventListener('focus', show);
    button.addEventListener('blur', () => {
      if (!pinned) hide();
    });
    button.addEventListener('click', () => {
      if (pinned) {
        hide();
      } else {
        pinned = true;
        show();
      }
    });
    wrap.addEventListener('mouseleave', () => {
      if (!pinned && document.activeElement !== button) hide();
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !tip.hidden) hide();
    });

    wrap.appendChild(button);
    wrap.appendChild(tip);
    return wrap;
  }

  /**
   * Submits the visitor's validation, shows a brief thanks state, then swaps in a fresh label.
   * @param {HTMLElement} card - The card being validated.
   * @param {Object} entry - The card's {label, cropUrl, gsvImageUrl} entry.
   * @param {string} result - 'Agree', 'Disagree', or 'Unsure'.
   */
  async #validate(card, entry, result) {
    const label = entry.label;
    const buttons = card.querySelectorAll('.lvg-btn');
    buttons.forEach((button) => {
      button.disabled = true;
    });
    window.logWebpageActivity(`Click_module=LandingValidationGrid_result=${result}_labelId=${label.label_id}`);

    // Mirror the Gallery's static-image validation payload: canvas_* describe where the label sits within the
    // rendered image, scaled from the 720x480 Explore canvas coordinates the label was placed on.
    const img = card.querySelector('.lvg-card-photo');
    const timestamp = new Date();
    const payload = {
      label_id: label.label_id,
      label_type: label.label_type,
      validation_result: result,
      old_severity: label.severity,
      new_severity: label.severity,
      old_tags: label.tags,
      new_tags: label.tags,
      canvas_width: Math.round(img.clientWidth),
      canvas_height: Math.round(img.clientHeight),
      canvas_x: Math.round((label.canvas_x * img.clientWidth) / util.EXPLORE_CANVAS_WIDTH),
      canvas_y: Math.round((label.canvas_y * img.clientHeight) / util.EXPLORE_CANVAS_HEIGHT),
      heading: label.heading,
      pitch: label.pitch,
      zoom: label.zoom,
      start_timestamp: timestamp,
      end_timestamp: timestamp,
      source: 'LandingPage',
      undone: false,
      redone: false,
      viewer_type: card.dataset.imageSource === 'crop' ? 'StaticCrop' : 'StaticApi',
    };

    try {
      const response = await fetch('/labelmap/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`validation failed: ${response.status}`);

      // Thanks state (announced by the grid's aria-live region), then swap in the next label.
      const chosen = card.querySelector(`.lvg-btn-${result.toLowerCase()}`);
      chosen?.classList.add('lvg-btn-chosen');
      const thanks = document.createElement('span');
      thanks.className = 'lvg-card-thanks';
      thanks.textContent = i18next.t('common:map.thanks');
      card.querySelector('.lvg-card-question-row').replaceWith(thanks);
      setTimeout(() => this.#replaceCard(card), LandingValidationGrid.#THANKS_MS);
    } catch (e) {
      console.error('Failed to submit validation', e);
      buttons.forEach((button) => {
        button.disabled = false;
      });
    }
  }

  /**
   * Swaps a finished (or broken) card for the next pooled label, refilling the pool in the background as it runs
   * low. With the pool empty the card is simply removed, and an emptied-out grid hides the whole section.
   * @param {HTMLElement} card - The card to replace.
   */
  async #replaceCard(card) {
    if (this.#pool.length <= LandingValidationGrid.#REFILL_THRESHOLD) {
      const refill = this.#loadBatch(LandingValidationGrid.#REFILL_FETCH);
      if (this.#pool.length === 0) await refill;
    }
    const hadFocus = card.contains(document.activeElement);
    const entry = this.#pool.shift();
    if (entry) {
      const fresh = this.#buildCard(entry);
      card.replaceWith(fresh);
      if (hadFocus) fresh.querySelector('.lvg-btn')?.focus();
    } else {
      card.remove();
      if (this.#grid.querySelectorAll('.lvg-card').length === 0) this.#section.hidden = true;
    }
  }
}
