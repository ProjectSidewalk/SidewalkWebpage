/**
 * Manages the pano zoom level and the zoom-in/zoom-out button UI.
 *
 * Todo. Separate the UI component and the logic component.
 *
 * @memberof svl
 */
class ZoomControl {
    // Scroll wheel / trackpad zoom tuning.
    static #ZOOM_WHEEL_SENSITIVITY = 0.0015;

    #canvas;
    #tracker;
    #uiZoomControl;
    #properties = {
        maxZoomLevel: 3,
        minZoomLevel: 1,
    };

    #status = {
        disableZoomIn: false,
        disableZoomOut: true,
    };

    #lock = {
        disableZoomIn: false,
        disableZoomOut: false,
    };

    #zoomBlink = {
        isBlinking: false,
    };

    #blinkInterval;
    #wheelTrackTimeout;

    /**
     * @param {Object} canvas - The Explore canvas (cleared/rendered on zoom changes).
     * @param {Object} [tracker] - Optional interaction tracker for logging zoom events.
     */
    constructor(canvas, tracker) {
        this.#canvas = canvas;
        this.#tracker = tracker;
        this.#uiZoomControl = {
            zoomIn: $('#zoom-in-button'),
            zoomOut: $('#zoom-out-button'),
        };

        this.#uiZoomControl.zoomIn.on('click', () => this.#handleZoomInButtonClick());
        this.#uiZoomControl.zoomOut.on('click', () => this.#handleZoomOutButtonClick());
        svl.ui.streetview.viewControlLayer.on('wheel', (e) => this.#handleZoomWheel(e));
    }

    /**
     * Get the zoom in UI control.
     */
    getZoomInUI() {
        return this.#uiZoomControl.zoomIn;
    }

    /**
     * Get the zoom out UI control.
     */
    getZoomOutUI() {
        return this.#uiZoomControl.zoomOut;
    }

    /**
     * Blink the zoom in button.
     */
    blinkZoomIn() {
        this.stopBlinking();
        this.#zoomBlink.isBlinking = true;
        this.#blinkInterval = window.setInterval(() => {
            this.#uiZoomControl.zoomIn.toggleClass('highlight-50');
        }, 500);
    }

    /**
     * Blink the zoom out button.
     */
    blinkZoomOut() {
        this.stopBlinking();
        this.#zoomBlink.isBlinking = true;
        this.#blinkInterval = window.setInterval(() => {
            this.#uiZoomControl.zoomOut.toggleClass('highlight-50');
        }, 500);
    }

    /**
     * Disables zooming in.
     * @returns {ZoomControl} this.
     */
    disableZoomIn() {
        if (!this.#lock.disableZoomIn) {
            this.#status.disableZoomIn = true;
            if (this.#uiZoomControl) {
                this.#uiZoomControl.zoomIn.addClass('disabled');
            }
        }
        return this;
    }

    /**
     * Disables zoom out.
     * @returns {ZoomControl} this.
     */
    disableZoomOut() {
        if (!this.#lock.disableZoomOut) {
            this.#status.disableZoomOut = true;
            if (this.#uiZoomControl) {
                this.#uiZoomControl.zoomOut.addClass('disabled');
            }
        }
        return this;
    }

    /**
     * Enable zoom in.
     * @returns {ZoomControl} this.
     */
    enableZoomIn() {
        if (!this.#lock.disableZoomIn) {
            this.#status.disableZoomIn = false;
            if (this.#uiZoomControl) {
                this.#uiZoomControl.zoomIn.removeClass('disabled');
            }
        }
        return this;
    }

    /**
     * Enable zoom out.
     * @returns {ZoomControl} this.
     */
    enableZoomOut() {
        if (!this.#lock.disableZoomOut) {
            this.#status.disableZoomOut = false;
            if (this.#uiZoomControl) {
                this.#uiZoomControl.zoomOut.removeClass('disabled');
            }
        }
        return this;
    }

    /**
     * Get status.
     * @param {string} name
     * @returns {*}
     */
    getStatus(name) {
        if (name in this.#status) {
            return this.#status[name];
        } else {
            throw `You cannot access a property "${name}".`;
        }
    }

    /**
     * Get a property.
     * @param {string} name
     * @returns {*}
     */
    getProperty(name) {
        if (name in this.#properties) {
            return this.#properties[name];
        } else {
            throw `You cannot access a property "${name}".`;
        }
    }

    /** Lock zoom in. @returns {ZoomControl} this. */
    lockDisableZoomIn() {
        this.#lock.disableZoomIn = true;
        return this;
    }

    /** Lock zoom out. @returns {ZoomControl} this. */
    lockDisableZoomOut() {
        this.#lock.disableZoomOut = true;
        return this;
    }

    /**
     * Callback for the zoom-in button. Increments the pano zoom level.
     */
    #handleZoomInButtonClick() {
        if (this.#tracker) this.#tracker.push('Click_ZoomIn');

        const pov = svl.panoViewer.getPov();

        if (pov.zoom < this.#properties.maxZoomLevel && this.#zoomBlink.isBlinking === false) {
            svl.zoomShortcutAlert.zoomClicked();
        }

        if (!this.#status.disableZoomIn) {
            this.#setZoom(pov.zoom + 1);
            this.#canvas.clear().render();
            $(document).trigger('ZoomIn');
        }
    }

    /**
     * Callback for the zoom-out button. Decrements the pano zoom level.
     */
    #handleZoomOutButtonClick() {
        if (this.#tracker) this.#tracker.push('Click_ZoomOut');

        const pov = svl.panoViewer.getPov();
        if (pov.zoom > this.#properties.minZoomLevel && this.#zoomBlink.isBlinking === false) {
            svl.zoomShortcutAlert.zoomClicked();
        }

        if (!this.#status.disableZoomOut) {
            this.#setZoom(pov.zoom - 1);
            this.#canvas.clear().render();
            $(document).trigger('ZoomOut');
        }
    }

    /**
     * Callback for the scroll wheel / trackpad over the pano.
     * @param {Object} e - jQuery wheel event.
     */
    #handleZoomWheel(e) {
        // Prevent the page from scrolling while zooming the pano.
        e.preventDefault();

        // Scrolling up (negative deltaY) zooms in; scrolling down zooms out.
        const zoomDelta = -e.originalEvent.deltaY * ZoomControl.#ZOOM_WHEEL_SENSITIVITY;

        // Honor the disable locks (e.g. onboarding) and skip no-op zooms at the min/max.
        if (zoomDelta > 0 && this.#status.disableZoomIn) return;
        if (zoomDelta < 0 && this.#status.disableZoomOut) return;

        this.#setZoom(svl.panoViewer.getPov().zoom + zoomDelta);

        // Log scroll zooming, but debounce so a single gesture doesn't flood the tracker.
        if (this.#tracker) {
            window.clearTimeout(this.#wheelTrackTimeout);
            this.#wheelTrackTimeout = window.setTimeout(() => {
                this.#tracker.push(zoomDelta > 0 ? 'Scroll_ZoomIn' : 'Scroll_ZoomOut');
            }, 250);
        }
    }

    /**
     * Zoom in. Called when the keyboard shortcut for zoom in is used.
     * @returns {ZoomControl|boolean} this if zoomed in, false if zoom in is disabled.
     */
    zoomIn() {
        if (!this.#status.disableZoomIn) {
            const pov = svl.panoViewer.getPov();
            this.#setZoom(pov.zoom + 1);
            this.#canvas.clear().render();
            $(document).trigger('ZoomIn');
            return this;
        } else {
            return false;
        }
    }

    /**
     * Zoom out. Called from outside this class (and by the keyboard shortcut) to zoom out from a pano.
     * @returns {ZoomControl|boolean} this if zoomed out, false if zoom out is disabled.
     */
    zoomOut() {
        if (!this.#status.disableZoomOut) {
            const pov = svl.panoViewer.getPov();
            this.#setZoom(pov.zoom - 1);
            this.#canvas.clear().render();
            $(document).trigger('ZoomOut');
            return this;
        } else {
            return false;
        }
    }

    /**
     * Sets the zoom level of the Street View.
     * @param {number} zoomLevelIn
     * @returns {number|boolean} The clamped zoom level, or false if a non-number was passed.
     */
    #setZoom(zoomLevelIn) {
        if (typeof zoomLevelIn !== 'number') {
            return false;
        }

        // Set the zoom level and change the panorama properties.
        let zoomLevel = undefined;
        if (zoomLevelIn <= this.#properties.minZoomLevel) {
            zoomLevel = this.#properties.minZoomLevel;
            this.enableZoomIn();
            this.disableZoomOut();
        } else if (zoomLevelIn >= this.#properties.maxZoomLevel) {
            zoomLevel = this.#properties.maxZoomLevel;
            this.disableZoomIn();
            this.enableZoomOut();
        } else {
            zoomLevel = zoomLevelIn;
            this.enableZoomIn();
            this.enableZoomOut();
        }
        svl.panoManager.setZoom(zoomLevel);
        const labels = svl.labelContainer.getCanvasLabels();
        for (let i = 0; i < labels.length; i += 1) {
            labels[i].setHoverInfoVisibility('hidden');
        }
        svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');
        svl.canvas.clear().render();
        return zoomLevel;
    }

    /**
     * Stop blinking the zoom-in and zoom-out buttons.
     */
    stopBlinking() {
        window.clearInterval(this.#blinkInterval);
        this.#zoomBlink.isBlinking = false;
        if (this.#uiZoomControl) {
            this.#uiZoomControl.zoomIn.removeClass('highlight-50');
            this.#uiZoomControl.zoomOut.removeClass('highlight-50');
        }
    }

    /**
     * Sets the maximum zoom level.
     * @param {number} zoomLevel
     * @returns {ZoomControl} this.
     */
    setMaxZoomLevel(zoomLevel) {
        this.#properties.maxZoomLevel = zoomLevel;
        return this;
    }

    /**
     * Sets the minimum zoom level.
     * @param {number} zoomLevel
     * @returns {ZoomControl} this.
     */
    setMinZoomLevel(zoomLevel) {
        this.#properties.minZoomLevel = zoomLevel;
        return this;
    }

    /** Unlock zoom in. @returns {ZoomControl} this. */
    unlockDisableZoomIn() {
        this.#lock.disableZoomIn = false;
        return this;
    }

    /** Unlock zoom out. @returns {ZoomControl} this. */
    unlockDisableZoomOut() {
        this.#lock.disableZoomOut = false;
        return this;
    }

    /**
     * Change the opacity of zoom buttons.
     * @returns {ZoomControl} this.
     */
    updateOpacity() {
        const pov = svl.panoViewer.getPov();

        if (pov && this.#uiZoomControl) {
            const zoom = pov.zoom;
            // Disable the zoom-in button at max zoom and the zoom-out button at min zoom.
            this.#uiZoomControl.zoomIn.toggleClass('disabled', zoom >= this.#properties.maxZoomLevel || this.#status.disableZoomIn);
            this.#uiZoomControl.zoomOut.toggleClass('disabled', zoom <= this.#properties.minZoomLevel || this.#status.disableZoomOut);
        }
        return this;
    }
}
