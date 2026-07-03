/**
 * Card Filter module.
 * This is responsible for allowing users to apply filters to specify what types of cards to render in the gallery.
 */
class CardFilter {
    #uiCardFilter;
    #labelTypeMenu;
    #cityMenu;
    #initialFilters;
    #status;
    #tagsByType;
    #currentTags;
    #severities;
    #validationOptions;

    /**
     * @param {object} uiCardFilter UI element representing filter components of sidebar.
     * @param {LabelTypeMenu} labelTypeMenu UI element representing dropdown to select label type in sidebar.
     * @param {CityMenu} cityMenu UI element representing dropdown to select city in sidebar.
     * @param {object} initialFilters Object containing initial set of filters to pass along.
     */
    constructor(uiCardFilter, labelTypeMenu, cityMenu, initialFilters) {
        this.#uiCardFilter = uiCardFilter;
        this.#labelTypeMenu = labelTypeMenu;
        this.#cityMenu = cityMenu;
        this.#initialFilters = initialFilters;

        this.#status = {
            currentCity: cityMenu.getCurrentCity(),
            currentLabelType: initialFilters.labelType,
        };

        // Map label type to their collection of tags.
        this.#tagsByType = {
            Assorted: new TagBucket(),
            CurbRamp: new TagBucket(),
            NoCurbRamp: new TagBucket(),
            Obstacle: new TagBucket(),
            SurfaceProblem: new TagBucket(),
            Other: new TagBucket(),
            Occlusion: new TagBucket(),
            NoSidewalk: new TagBucket(),
            Crosswalk: new TagBucket(),
            Signal: new TagBucket(),
        };

        // Tags of the current label type.
        this.#currentTags = this.#tagsByType[this.#status.currentLabelType];

        // Collection of severities.
        this.#severities = new SeverityBucket(initialFilters.severities, this.#status.currentLabelType);

        this.#validationOptions = new ValidationOptionBucket(initialFilters.validationOptions);

        this.#uiCardFilter.clearFilters.on('click', () => {
            this.clearFilters();
            this.#uiCardFilter.clearFilters.hide();
            this.update();
        });

        this.#getTags(() => {
            this.render();
            this.#updateURL();
        });
    }

    /**
     * Grab all tags from backend and sort them by label type into tagsByType.
     *
     * @param {*} callback Function to be called when tags arrive.
     */
    #getTags(callback) {
        $.getJSON('/label/tags', (data) => {
            let tag;
            let i = 0;
            const len = data.length;
            for (; i < len; i++) {
                if (data[i].label_type === this.#status.currentLabelType && this.#initialFilters.tags.includes(data[i].tag)) {
                    tag = new Tag(data[i], true);
                } else {
                    tag = new Tag(data[i], false);
                }
                this.#tagsByType[tag.getLabelType()].push(tag);
            }

            if (callback) callback();
        });
    }

    /**
     * Update filter components and URL when a filter changes.
     */
    update() {
        // If label type was changed: clear tags, update cards, and rerender sidebar. Otherwise, just update the cards.
        const currLabelType = this.#labelTypeMenu.getCurrentLabelType();
        if (this.#status.currentLabelType !== currLabelType) {
            this.#clearCurrentTags();
            this.setStatus('currentLabelType', currLabelType);
            this.#currentTags = this.#tagsByType[currLabelType];
            this.#severities.setLabelType(currLabelType);
            this.render();
        }
        sg.cardContainer.updateCardsByFilter();
        this.#updateURL();
    }

    /**
     * If the city was changed, redirect to that server. Otherwise, update the URL query params.
     */
    #updateURL() {
        const newUrl = this.#buildCurrentURL();
        const currentCity = this.#cityMenu.getCurrentCity();
        if (this.#status.currentCity !== currentCity) {
            window.location.href = currentCity + newUrl;
        } else {
            const fullUrl = `${window.location.protocol}//${window.location.host}${newUrl}`;
            if (fullUrl !== window.location.href) {
                window.history.pushState({ }, '', fullUrl);
            }
        }
    }

    /**
     * Return a string representing /gallery URL with correct query params. Excluding params if they match the default.
     */
    #buildCurrentURL() {
        let newUrl = '/gallery';
        let firstQueryParam = true;
        const currSeverities = this.#severities.getAppliedSeverities();
        const currAppliedTags = this.#currentTags.getAppliedTags().map((t) => t.getTag()).join();
        const currValOptions = this.#validationOptions.getAppliedValidationOptions().sort().join();

        // TODO use new URL() and .searchParams.append() instead of tracking firstQueryParam ourselves.

        // For each type of filter, check if it matches the default. If it doesn't, add to URL in a query param.
        if (this.#status.currentLabelType !== 'Assorted') {
            this.#uiCardFilter.clearFilters.show();
            newUrl += `?labelType=${this.#status.currentLabelType}`;
            // Can only have applied tags if there is a specific label type chosen.
            if (currAppliedTags.length > 0) {
                newUrl += `&tags=${currAppliedTags}`;
            }
            firstQueryParam = false;
        }
        // TODO once we add a UI for neighborhood filtering, have that process mirror what we have for other filters.
        if (sg.neighborhoodIds.length > 0) {
            newUrl += firstQueryParam ? `?neighborhoods=${sg.neighborhoodIds.join()}` : `&neighborhoods=${sg.neighborhoodIds.join()}`;
            firstQueryParam = false;
        }
        // All four severities (null, 1, 2, 3) selected is the default state, so we omit the param in that case.
        if (currSeverities.length !== 4) {
            this.#uiCardFilter.clearFilters.show();
            newUrl += firstQueryParam ? `?severities=${currSeverities}` : `&severities=${currSeverities}`;
            firstQueryParam = false;
        }
        if (currValOptions !== 'correct,unvalidated') {
            this.#uiCardFilter.clearFilters.show();
            newUrl += firstQueryParam ? `?validationOptions=${currValOptions}` : `&validationOptions=${currValOptions}`;
            firstQueryParam = false;
        }
        // TODO once we add a UI for filtering on AI validation, have that process mirrors other filters.
        if (sg.aiValidationOptions.length > 0) {
            newUrl += firstQueryParam ? `?aiValidationOptions=${sg.aiValidationOptions}` : `&aiValidationOptions=${sg.aiValidationOptions}`;
            firstQueryParam = false;
        }
        return newUrl;
    }

    /**
     * Render tags and severities in sidebar.
     */
    render() {
        if (util.misc.labelTypeHasSeverity(this.#status.currentLabelType)) {
            // Swap the filter header between "Severity" and "Quality" based on the current label type.
            const headerKey = util.misc.isPositiveLabelType(this.#status.currentLabelType) ? 'quality' : 'severity';
            $('#severity-header').text(i18next.t(headerKey)).show();
            $('#severity-select').show();
        } else {
            $('#severity-header').hide();
            $('#severity-select').hide();
        }
        if (this.#currentTags.getTags().length > 0) {
            $('#tags-header').show();
            this.#currentTags.render(this.#uiCardFilter.tags);
        } else {
            $('#tags-header').hide();
        }

        this.#severities.render(this.#uiCardFilter.severity);
        this.#validationOptions.render(this.#uiCardFilter.validationOptions);
    }

    /**
     * Return list of tags that have been selected by user.
     */
    getAppliedTagNames() {
        return this.#currentTags.getAppliedTags().map((tag) => tag.getTag());
    }

    /**
     * Return list of all tags for current label type.
     */
    getTagNames() {
        return this.#currentTags.getTags().map((tag) => tag.getTag());
    }

    /**
     * Return object containing all tags.
     */
    getTagsByType() {
        return this.#tagsByType;
    }

    /**
     * Return status of CardFilter.
     */
    getStatus() {
        return this.#status;
    }

    /**
     * Set attribute of status.
     *
     * @param {string} key Status name.
     * @param {*} value Status value.
     */
    setStatus(key, value) {
        if (key in this.#status) {
            this.#status[key] = value;
        } else {
            throw `${this.constructor.name}: Illegal status name.`;
        }
    }

    /**
     * Return list of severities.
     */
    getSeverities() {
        return this.#severities.getSeverities();
    }

    /**
     * Return list of selected severities by user.
     */
    getAppliedSeverities() {
        return this.#severities.getAppliedSeverities();
    }

    /**
     * Return list of validationOptions.
     */
    getValidationOptions() {
        return this.#validationOptions.getValidationOptions();
    }

    /**
     * Return list of selected validationOptions by user.
     */
    getAppliedValidationOptions() {
        return this.#validationOptions.getAppliedValidationOptions();
    }

    /**
     * Unapply all tags of specified label type.
     *
     * @param {*} labelType Label type of tags to unapply.
     */
    unapplyTags(labelType) {
        if (labelType != null) {
            this.#tagsByType[labelType].unapplyTags();
        }
    }

    /**
     * Clear tags currently being shown.
     */
    #clearCurrentTags() {
        this.#uiCardFilter.tags.empty();
        this.unapplyTags(this.#status.currentLabelType);
        this.#currentTags = new TagBucket();
    }

    /**
     * Disable interaction with filters.
     */
    disable() {
        this.#severities.disable();
        $('.gallery-filter').prop('disabled', true);
    }

    /**
     * Enable interaction with filters.
     */
    enable() {
        this.#severities.enable();
        $('.gallery-filter').prop('disabled', false);
    }

    /**
     * Clear all filters, setting them to their default state.
     */
    clearFilters() {
        this.#severities.selectAllSeverities();
        this.#validationOptions.setToDefault();
        this.#clearCurrentTags();
        this.#labelTypeMenu.setToDefault();
    }
}
