/**
 * Controls the map filter sidebar UI: Manages state and applies Mapbox filter expressions.
 */
class MapSidebarFilter {
    /** @type {mapboxgl.Map} */
    #map;
    /** @type {object} */
    #mapData;
    /** @type {boolean} */
    #highQualityFilter;
    /** @type {HTMLElement} */
    #sidebar;

    /**
     * Initializes the sidebar filter, binding all event handlers and enabling controls.
     * @param {mapboxgl.Map} map The Mapbox map instance.
     * @param {object} mapData The layer tracker from CreateMapLayerTracker.
     * @param {object} [options] Configuration options.
     * @param {boolean} [options.highQualityFilter=true] Whether to apply the high-quality user filter.
     */
    constructor(map, mapData, { highQualityFilter = true } = {}) {
        this.#map = map;
        this.#mapData = mapData;
        this.#highQualityFilter = highQualityFilter;
        this.#sidebar = document.getElementById('map-sidebar');

        this.#initSeverityToggles();
        this.#initLabelTypeCheckboxes();
        this.#initValidationCheckboxes();
        this.#initStreetCheckboxes();
        this.#initDeselectAllButtons();
        this.#initSidebarOpenClose();
        this.#enableAllControls();
    }

    /** Binds click handlers to the severity toggle buttons. */
    #initSeverityToggles() {
        this.#sidebar.querySelectorAll('.severity-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const severity = Number(btn.dataset.severity);
                const newState = !this.#mapData.severities[severity];
                this.#mapData.severities[severity] = newState;

                btn.setAttribute('aria-pressed', String(newState));

                // Swap the icon between filled and outline.
                const img = btn.querySelector('img');
                if (img) img.src = newState ? img.dataset.selectedSrc : img.dataset.unselectedSrc;

                filterLabelLayers(null, this.#map, this.#mapData, this.#highQualityFilter);
            });
        });
    }

    /** Binds click handlers to the label type checkboxes. */
    #initLabelTypeCheckboxes() {
        this.#sidebar.querySelectorAll('input[data-filter-type="label-type"]').forEach(cb => {
            cb.addEventListener('click', () => {
                const labelType = cb.id.replace('-checkbox', '');
                toggleLabelLayer(labelType, cb.checked, this.#map, this.#mapData);
            });
        });
    }

    /** Binds click handlers to the validation checkboxes. */
    #initValidationCheckboxes() {
        this.#sidebar.querySelectorAll('input[data-filter-type="label-validations"]').forEach(cb => {
            cb.addEventListener('click', () => {
                filterLabelLayers(cb, this.#map, this.#mapData, this.#highQualityFilter);
            });
        });
    }

    /** Binds click handlers to the street checkboxes. */
    #initStreetCheckboxes() {
        this.#sidebar.querySelectorAll('input[data-filter-type="streets"]').forEach(cb => {
            cb.addEventListener('click', () => {
                filterStreetLayer(this.#map);
            });
        });
    }

    /**
     * Initializes "Deselect all" / "Select all" toggle buttons for each section.
     */
    #initDeselectAllButtons() {
        this.#sidebar.querySelectorAll('.map-sidebar__deselect-all').forEach(btn => {
            btn.addEventListener('click', () => {
                const section = btn.dataset.section;
                const checkboxes = this.#sidebar.querySelectorAll(`input[data-filter-type="${section}"]`);
                const anyChecked = Array.from(checkboxes).some(cb => cb.checked);
                const newState = !anyChecked;

                if (section === 'label-type') {
                    // Batch visibility changes for all label type layers.
                    checkboxes.forEach(cb => {
                        cb.checked = newState;
                        const labelType = cb.id.replace('-checkbox', '');
                        toggleLabelLayer(labelType, newState, this.#map, this.#mapData);
                    });
                } else if (section === 'label-validations') {
                    // Batch mapData updates, then apply filter once.
                    checkboxes.forEach(cb => {
                        cb.checked = newState;
                        this.#mapData[cb.id] = newState;
                    });
                    filterLabelLayers(null, this.#map, this.#mapData, this.#highQualityFilter);
                } else if (section === 'streets') {
                    checkboxes.forEach(cb => { cb.checked = newState; });
                    filterStreetLayer(this.#map);
                }

                // Update button text.
                btn.textContent = newState ? i18next.t('labelmap:deselect-all') : i18next.t('labelmap:select-all');
            });
        });
    }

    /** Initializes the sidebar open/close behavior. Padding is set initially by CreatePSMap. */
    #initSidebarOpenClose() {
        const closeBtn = document.getElementById('map-sidebar-close');
        const openBtn = document.getElementById('map-sidebar-open');
        const sidebarWidth = this.#sidebar.offsetWidth;

        closeBtn.addEventListener('click', () => {
            this.#sidebar.classList.add('map-sidebar--hidden');
            openBtn.style.display = 'block';
            this.#map.easeTo({ padding: { left: 0, top: 0, right: 0, bottom: 0 } });
        });
        openBtn.addEventListener('click', () => {
            this.#sidebar.classList.remove('map-sidebar--hidden');
            openBtn.style.display = 'none';
            this.#map.easeTo({ padding: { left: sidebarWidth, top: 0, right: 0, bottom: 0 } });
        });
    }

    /** Enables all disabled controls and removes the loading appearance. */
    #enableAllControls() {
        this.#sidebar.classList.remove('map-sidebar--loading');
        this.#sidebar.querySelectorAll('input[disabled]').forEach(cb => { cb.disabled = false; });
    }
}
