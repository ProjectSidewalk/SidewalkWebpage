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
        this.#initTagToggles();
        this.#initTagPills();
        this.#initSidebarOpenClose();
        this.#initResizeHandle();
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
                this.#updateDeselectAllButton('severity');
            });
        });
    }

    /** Binds click handlers to the label type checkboxes. */
    #initLabelTypeCheckboxes() {
        this.#sidebar.querySelectorAll('input[data-filter-type="label-type"]').forEach(cb => {
            cb.addEventListener('click', () => {
                const labelType = cb.id.replace('-checkbox', '');
                // Unchecking a label type clears its tag filters.
                if (!cb.checked) this.#clearTagsForLabelType(labelType);
                cb.classList.remove('checkbox--partial');
                toggleLabelLayer(labelType, cb.checked, this.#map, this.#mapData);
                // Reapply filters so stale tag constraints are cleared from the Mapbox layer.
                filterLabelLayers(null, this.#map, this.#mapData, this.#highQualityFilter);
                this.#updateDeselectAllButton('label-type');
            });
        });
    }

    /** Binds click handlers to the validation checkboxes. */
    #initValidationCheckboxes() {
        this.#sidebar.querySelectorAll('input[data-filter-type="label-validations"]').forEach(cb => {
            cb.addEventListener('click', () => {
                filterLabelLayers(cb, this.#map, this.#mapData, this.#highQualityFilter);
                this.#updateDeselectAllButton('label-validations');
            });
        });
    }

    /** Binds click handlers to the street checkboxes. */
    #initStreetCheckboxes() {
        this.#sidebar.querySelectorAll('input[data-filter-type="streets"]').forEach(cb => {
            cb.addEventListener('click', () => {
                filterStreetLayer(this.#map);
                this.#updateDeselectAllButton('streets');
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
                const newState = !this.#isAnyActive(section);

                if (section === 'severity') {
                    // Match the look and state of all severity toggles to newState.
                    this.#sidebar.querySelectorAll('.severity-toggle').forEach(toggle => {
                        const severity = Number(toggle.dataset.severity);
                        this.#mapData.severities[severity] = newState;
                        toggle.setAttribute('aria-pressed', String(newState));
                        const img = toggle.querySelector('img');
                        if (img) img.src = newState ? img.dataset.selectedSrc : img.dataset.unselectedSrc;
                    });
                    filterLabelLayers(null, this.#map, this.#mapData, this.#highQualityFilter);
                } else if (section === 'label-type') {
                    const checkboxes = this.#sidebar.querySelectorAll(`input[data-filter-type="${section}"]`);
                    // Batch visibility changes for all label type layers.
                    checkboxes.forEach(cb => {
                        cb.checked = newState;
                        cb.classList.remove('checkbox--partial');
                        const labelType = cb.id.replace('-checkbox', '');
                        toggleLabelLayer(labelType, newState, this.#map, this.#mapData);
                    });
                    // Also clear all tag selections when deselecting all label types.
                    if (!newState) this.#clearAllTagSelections();
                } else if (section === 'label-validations') {
                    const checkboxes = this.#sidebar.querySelectorAll(`input[data-filter-type="${section}"]`);
                    // Batch mapData updates, then apply filter once.
                    checkboxes.forEach(cb => {
                        cb.checked = newState;
                        this.#mapData[cb.id] = newState;
                    });
                    filterLabelLayers(null, this.#map, this.#mapData, this.#highQualityFilter);
                } else if (section === 'streets') {
                    const checkboxes = this.#sidebar.querySelectorAll(`input[data-filter-type="${section}"]`);
                    checkboxes.forEach(cb => { cb.checked = newState; });
                    filterStreetLayer(this.#map);
                }

                this.#updateDeselectAllButton(section);
            });
        });
    }

    /**
     * Returns true when at least one control in the section is on (checkbox checked, or toggle pressed for severity).
     * @param {string} section The data-section value identifying the section.
     */
    #isAnyActive(section) {
        if (section === 'severity') {
            const toggles = this.#sidebar.querySelectorAll('.severity-toggle');
            return Array.from(toggles).some(t => t.getAttribute('aria-pressed') === 'true');
        }
        const checkboxes = this.#sidebar.querySelectorAll(`input[data-filter-type="${section}"]`);
        return Array.from(checkboxes).some(cb => cb.checked);
    }

    /**
     * Syncs a section's toggle button text: "Deselect all" if any control is active, "Select all" otherwise.
     * @param {string} section The data-section value identifying the button and its controls.
     */
    #updateDeselectAllButton(section) {
        const btn = this.#sidebar.querySelector(`.map-sidebar__deselect-all[data-section="${section}"]`);
        btn.textContent = this.#isAnyActive(section) ? i18next.t('labelmap:deselect-all') : i18next.t('labelmap:select-all');
    }

    /** Binds click handlers to the tag expand/collapse chevron buttons. */
    #initTagToggles() {
        this.#sidebar.querySelectorAll('.map-sidebar__tag-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const expanded = btn.getAttribute('aria-expanded') === 'true';
                const pillsContainer = btn.closest('.map-sidebar__item').querySelector('.map-sidebar__tag-pills');
                if (!pillsContainer) return;

                const nowExpanded = !expanded;
                btn.setAttribute('aria-expanded', String(nowExpanded));
                const img = btn.querySelector('img');
                if (img) img.src = nowExpanded ? img.dataset.upSrc : img.dataset.downSrc;
                pillsContainer.hidden = !nowExpanded;
            });
        });
    }

    /** Binds click handlers to tag pills to toggle them and update map filters. */
    #initTagPills() {
        this.#sidebar.querySelectorAll('.tag-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                const tag = pill.dataset.tag;
                const labelType = pill.dataset.labelType;
                const isActive = pill.classList.toggle('tag-pill--active');

                if (isActive) {
                    this.#mapData.selectedTags[labelType].add(tag);
                } else {
                    this.#mapData.selectedTags[labelType].delete(tag);
                }

                // If a tag is selected on an unchecked label type, check and show it.
                const cb = this.#sidebar.querySelector(`#${labelType}-checkbox`);
                if (isActive && !cb.checked) {
                    cb.checked = true;
                    toggleLabelLayer(labelType, true, this.#map, this.#mapData);
                    this.#updateDeselectAllButton('label-type');
                }

                // Update the checkbox appearance: gray when partially filtered by tags.
                this.#updateCheckboxPartialState(labelType);

                filterLabelLayers(null, this.#map, this.#mapData, this.#highQualityFilter);
            });
        });
    }

    /**
     * Updates the checkbox to show a partial (gray) state when some tags are selected, or full (black) otherwise.
     * @param {string} labelType The label type key.
     */
    #updateCheckboxPartialState(labelType) {
        const cb = this.#sidebar.querySelector(`#${labelType}-checkbox`);
        const hasActiveTags = this.#mapData.selectedTags[labelType]?.size > 0;
        cb.classList.toggle('checkbox--partial', hasActiveTags);
    }

    /**
     * Clears tag selections for a specific label type.
     * @param {string} labelType The label type key.
     */
    #clearTagsForLabelType(labelType) {
        this.#mapData.selectedTags[labelType]?.clear();
        this.#sidebar.querySelectorAll(`.tag-pill[data-label-type="${labelType}"]`).forEach(pill => {
            pill.classList.remove('tag-pill--active');
        });
        this.#updateCheckboxPartialState(labelType);
    }

    /** Clears all tag selections and removes the active class from all pills. */
    #clearAllTagSelections() {
        for (const labelType of Object.keys(this.#mapData.selectedTags)) {
            this.#mapData.selectedTags[labelType].clear();
        }
        this.#sidebar.querySelectorAll('.tag-pill--active').forEach(pill => {
            pill.classList.remove('tag-pill--active');
        });
        this.#sidebar.querySelectorAll('.checkbox--partial').forEach(cb => {
            cb.classList.remove('checkbox--partial');
        });
    }

    /** Initializes the sidebar open/close behavior. Padding is set initially by CreatePSMap. */
    #initSidebarOpenClose() {
        const closeBtn = document.getElementById('map-sidebar-close');
        const openBtn = document.getElementById('map-sidebar-open');
        const handle = document.getElementById('map-sidebar-resize-handle');

        closeBtn.addEventListener('click', () => {
            this.#sidebar.classList.add('map-sidebar--hidden');
            handle.style.display = 'none';
            openBtn.style.display = 'block';
            this.#map.easeTo({ padding: { left: 0, top: 0, right: 0, bottom: 0 } });
        });
        openBtn.addEventListener('click', () => {
            const width = this.#sidebar.offsetWidth;
            this.#sidebar.classList.remove('map-sidebar--hidden');
            handle.style.display = '';
            openBtn.style.display = 'none';
            this.#map.easeTo({ padding: { left: width, top: 0, right: 0, bottom: 0 } });
        });
    }

    /** Wires up the drag-to-resize handle on the sidebar's right edge, keeping map centered as you drag. */
    #initResizeHandle() {
        const handle = document.getElementById('map-sidebar-resize-handle');
        if (!handle) return;

        const MIN_WIDTH = 280;
        const MAX_WIDTH = 600;

        // Sync the handle's starting position with the sidebar's rendered width.
        handle.style.left = `${this.#sidebar.offsetWidth}px`;

        const onPointerMove = (e) => {
            const rect = this.#sidebar.getBoundingClientRect();
            const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, e.clientX - rect.left));
            this.#sidebar.style.width = `${newWidth}px`;
            handle.style.left = `${newWidth}px`;
            this.#map.setPadding({ left: newWidth, top: 0, right: 0, bottom: 0 });
        };

        const onPointerUp = (e) => {
            handle.releasePointerCapture?.(e.pointerId);
            handle.classList.remove('map-sidebar__resize-handle--dragging');
            document.body.classList.remove('map-sidebar-resizing');
            handle.removeEventListener('pointermove', onPointerMove);
            handle.removeEventListener('pointerup', onPointerUp);
            handle.removeEventListener('pointercancel', onPointerUp);
        };

        handle.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            handle.setPointerCapture(e.pointerId);
            handle.classList.add('map-sidebar__resize-handle--dragging');
            document.body.classList.add('map-sidebar-resizing');
            handle.addEventListener('pointermove', onPointerMove);
            handle.addEventListener('pointerup', onPointerUp);
            handle.addEventListener('pointercancel', onPointerUp);
        });
    }

    /** Enables all disabled controls and removes the loading appearance. */
    #enableAllControls() {
        this.#sidebar.classList.remove('map-sidebar--loading');
        this.#sidebar.querySelectorAll('input[disabled]').forEach(cb => { cb.disabled = false; });
    }
}
