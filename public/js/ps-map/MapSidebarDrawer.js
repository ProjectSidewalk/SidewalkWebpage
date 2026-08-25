/**
 * Open/closed state for the map's filter drawer: the collapse chrome, the drag-to-resize handle, and the map
 * padding that keeps the camera centered on the map the user can actually see.
 *
 * Split from MapSidebarFilter because the two answer different questions at different times. That class applies
 * the sidebar's filter state to the map's layers, so it cannot exist until the label feed has loaded — tens of MB
 * on a large city. Whether the drawer is open is page chrome, and has to be live from map-ready: below
 * NARROW_QUERY the drawer starts collapsed, and its reopen button is then the only route back to the filters and
 * to the search box nested inside them. Owning that state here means it is wired the moment the map exists,
 * rather than after a load a phone may wait minutes for and may never finish.
 */
class MapSidebarDrawer {
  /**
   * Below this a 350px panel leaves no usable map beside it (its 280px drag minimum can't coexist with one
   * either), so the open drawer covers the map and the camera keeps its own center rather than being pushed
   * off-canvas by padding nearly as wide as the viewport. filter-sidebar.css keys its full-width rule to the
   * same width; this constant is the JS side's only copy.
   */
  static NARROW_QUERY = '(width <= 600px)';

  static #MIN_WIDTH = 280;
  static #MAX_WIDTH = 600;

  /** @type {mapboxgl.Map} */
  #map;
  /** @type {HTMLElement} */
  #sidebar;
  /** @type {?HTMLElement} */
  #openBtn;
  /** @type {?HTMLElement} */
  #closeBtn;
  /** @type {?HTMLElement} */
  #handle;
  /** @type {MediaQueryList} */
  #narrowMq;
  #open = true;

  /**
   * @param {mapboxgl.Map} map The Mapbox map the drawer shares the viewport with.
   * @param {HTMLElement} sidebar The `.filter-sidebar` element.
   * @param {object} [options]
   * @param {boolean} [options.startCollapsed=false] Open the page with the drawer closed even on a wide viewport.
   */
  constructor(map, sidebar, { startCollapsed = false } = {}) {
    this.#map = map;
    this.#sidebar = sidebar;
    this.#openBtn = document.getElementById('filter-sidebar-open');
    this.#closeBtn = document.getElementById('filter-sidebar-close');
    this.#handle = document.getElementById('filter-sidebar-resize-handle');
    this.#narrowMq = window.matchMedia(MapSidebarDrawer.NARROW_QUERY);

    this.#openBtn?.setAttribute('aria-controls', sidebar.id);
    this.#openBtn?.addEventListener('click', () => this.open());
    this.#closeBtn?.addEventListener('click', () => this.close());

    // While the drawer covers the map its own close button can scroll out of reach inside the panel's scroller,
    // and there is no backdrop to tap, so Escape is the only dismissal that always works.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.#open && this.#narrowMq.matches) this.close();
    });

    this.#narrowMq.addEventListener('change', () => this.#onBreakpointCross());
    this.#initResizeHandle();

    this.#setOpen(!startCollapsed && !this.#narrowMq.matches, { animate: false, moveFocus: false, log: false });
  }

  /** @returns {boolean} Whether the drawer is currently open. */
  get isOpen() {
    return this.#open;
  }

  /**
   * @param {object} [options]
   * @param {boolean} [options.log=true] Whether to record the interaction; false for programmatic state changes.
   */
  open({ log = true } = {}) {
    this.#setOpen(true, { log });
  }

  /**
   * @param {object} [options]
   * @param {boolean} [options.log=true] Whether to record the interaction; false for programmatic state changes.
   */
  close({ log = true } = {}) {
    this.#setOpen(false, { log });
  }

  /**
   * Applies an open/closed state to the drawer, its chrome, and the map's padding.
   *
   * @param {boolean} open The state to apply.
   * @param {object} [options]
   * @param {boolean} [options.animate=true] Ease the camera rather than jumping it.
   * @param {boolean} [options.moveFocus=true] Send focus to whichever control is now the way back out. Suppressed
   *     for state the page applies on load, which would otherwise steal focus from the document.
   * @param {boolean} [options.log=true] Whether to record the interaction.
   */
  #setOpen(open, { animate = true, moveFocus = true, log = true } = {}) {
    this.#open = open;
    this.#sidebar.classList.toggle('filter-sidebar--hidden', !open);

    // The drawer is only translated off-canvas, so without inert its ~30 controls stay focusable and stay in the
    // accessibility tree — a keyboard user tabs through an invisible panel, and a screen reader lands in a
    // landmark full of controls that aren't on screen (WCAG 2.4.3 / 2.4.7).
    this.#sidebar.inert = !open;
    this.#sidebar.setAttribute('aria-hidden', String(!open));

    if (this.#openBtn) {
      this.#openBtn.style.display = open ? 'none' : 'block';
      this.#openBtn.setAttribute('aria-expanded', String(open));
    }
    // Resizing is a wide-viewport affordance; at narrow widths the drawer is full-bleed and the handle is hidden
    // by the media query anyway, so leaving it displayed would only put an invisible col-resize strip on the map.
    if (this.#handle) this.#handle.style.display = open && !this.#narrowMq.matches ? '' : 'none';

    this.#applyPadding({ animate });

    if (moveFocus) (open ? this.#closeBtn : this.#openBtn)?.focus();
    if (log) window.logWebpageActivity?.(`Click_module=MapSidebar_${open ? 'Open' : 'Close'}`);
  }

  /**
   * Pushes the map's center clear of the drawer, or restores it.
   *
   * @param {object} [options]
   * @param {boolean} [options.animate=true] Ease rather than jump.
   */
  #applyPadding({ animate = true } = {}) {
    // A covering drawer gets no padding: nearly-viewport-wide padding projects the center off the canvas.
    const left = this.#open && !this.#narrowMq.matches ? this.#sidebar.offsetWidth : 0;
    const padding = { left, top: 0, right: 0, bottom: 0 };
    if (animate) this.#map.easeTo({ padding });
    else this.#map.setPadding(padding);
  }

  /** Re-derives the drawer and the camera from the new breakpoint. */
  #onBreakpointCross() {
    if (this.#narrowMq.matches) {
      // An inline width from a drag session would beat the media query's full-width rule.
      this.#sidebar.style.width = '';
      // Left open, the drawer would now cover the whole map with no cue that a map is behind it.
      if (this.#open) this.#setOpen(false, { animate: false, moveFocus: false, log: false });
      else this.#applyPadding({ animate: false });
    } else {
      if (this.#handle) this.#handle.style.left = `${this.#sidebar.offsetWidth}px`;
      this.#setOpen(this.#open, { animate: false, moveFocus: false, log: false });
    }
  }

  /** Wires the drag-to-resize handle on the sidebar's right edge, keeping the map centered as you drag. */
  #initResizeHandle() {
    const handle = this.#handle;
    if (!handle) return;

    // Only meaningful where the sidebar has a width of its own. At narrow widths it is full-bleed, so stamping
    // its width here would strand the handle at the viewport edge on the way back to landscape.
    if (!this.#narrowMq.matches) handle.style.left = `${this.#sidebar.offsetWidth}px`;

    const onPointerMove = (e) => {
      const rect = this.#sidebar.getBoundingClientRect();
      const newWidth = Math.max(
        MapSidebarDrawer.#MIN_WIDTH, Math.min(MapSidebarDrawer.#MAX_WIDTH, e.clientX - rect.left),
      );
      this.#sidebar.style.width = `${newWidth}px`;
      handle.style.left = `${newWidth}px`;
      this.#map.setPadding({ left: newWidth, top: 0, right: 0, bottom: 0 });
    };

    const onPointerUp = (e) => {
      handle.releasePointerCapture?.(e.pointerId);
      handle.classList.remove('filter-sidebar__resize-handle--dragging');
      document.body.classList.remove('filter-sidebar-resizing');
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerUp);
    };

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('filter-sidebar__resize-handle--dragging');
      document.body.classList.add('filter-sidebar-resizing');
      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', onPointerUp);
      handle.addEventListener('pointercancel', onPointerUp);
    });
  }
}
