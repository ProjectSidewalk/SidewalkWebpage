/**
 * Card Filter module. 
 * This is responsible for allowing users to apply filters to specify what types of cards to render in the gallery.
 *
 * @param uiCardFilter UI element representing filter components of sidebar.
 * @param labelTypeMenu UI element representing dropdown to select label type in sidebar.
 * @param cityMenu UI element representing dropdown to select city in sidebar.
 * @param initialFilters Object containing initial set of filters to pass along.
 * @returns {CardFilter}
 * @constructor
 */
function CardFilter(uiCardFilter, labelTypeMenu, cityMenu, initialFilters) {
    let self = this;

    let status = {
        currentCity: cityMenu.getCurrentCity(),
        currentLabelType: initialFilters.labelType
    };

    // Map label type to their collection of tags.
    let tagsByType = {
        Assorted: new TagBucket(),
        CurbRamp: new TagBucket(),
        NoCurbRamp: new TagBucket(),
        Obstacle: new TagBucket(),
        SurfaceProblem: new TagBucket(),
        Other: new TagBucket(),
        Occlusion: new TagBucket(),
        NoSidewalk: new TagBucket(),
        Crosswalk: new TagBucket(),
        Signal: new TagBucket()
    };

    // Tags of the current label type.
    let currentTags = tagsByType[status.currentLabelType];

    // Collection of severities.
    let severities = new SeverityBucket(initialFilters.severities);

    let validationOptions = new ValidationOptionBucket(initialFilters.validationOptions);
   
    /**
     * Initialize CardFilter.
     */
    function _init() {
        getTags(function () {
            render();
            updateURL();
        });
    }

    /**
     * Grab all tags from backend and sort them by label type into tagsByType.
     * 
     * @param {*} callback Function to be called when tags arrive.
     */
    function getTags(callback) {
        $.getJSON("/label/tags", function (data) {
            let tag;
            let i = 0;
            let len = data.length;
            for (; i < len; i++) {
                if (data[i].label_type === status.currentLabelType && initialFilters.tags.includes(data[i].tag))
                    tag = new Tag(data[i], true);
                else
                    tag = new Tag(data[i], false);
                tagsByType[tag.getLabelType()].push(tag);
            }

            if (callback) callback();
        });
    }

    /**
     * Update filter components and URL when a filter changes.
     */
    function update() {
        // If label type was changed: clear tags, update cards, and rerender sidebar. Otherwise, just update the cards.
        let currLabelType = labelTypeMenu.getCurrentLabelType();
        if (status.currentLabelType !== currLabelType) {
            clearCurrentTags();
            setStatus('currentLabelType', currLabelType);
            currentTags = tagsByType[currLabelType];
            render();
        }
        sg.cardContainer.updateCardsByFilter();
        updateURL();
    }

    /**
     * If the city was changed, redirect to that server. Otherwise, update the URL query params.
     */
    function updateURL() {
        let newUrl = _buildCurrentURL();
        let currentCity = cityMenu.getCurrentCity();
        if (status.currentCity !== currentCity) {
            window.location.href = currentCity + newUrl;
        } else {
            let fullUrl = `${window.location.protocol}//${window.location.host}${newUrl}`;
            if (fullUrl !== window.location.href) {
                window.history.pushState({ },'', fullUrl);
            }
        }
    }

    /**
     * Return a string representing /gallery URL with correct query params. Excluding params if they match the default.
     * @private
     */
    function _buildCurrentURL() {
        let newUrl = '/gallery';
        let firstQueryParam = true;
        let currSeverities = severities.getAppliedSeverities();
        let currAppliedTags = currentTags.getAppliedTags().map(t => t.getTag()).join();
        let currValOptions = validationOptions.getAppliedValidationOptions().sort().join();

        // For each type of filter, check if it matches the default. If it doesn't, add to URL in a query param.
        if (status.currentLabelType !== 'Assorted') {
            newUrl += `?labelType=${status.currentLabelType}`;
            // Can only have applied tags if there is a specific label type chosen.
            if (currAppliedTags.length > 0) {
                $('#clear-filters').show();
                newUrl += `&tags=${currAppliedTags}`;
            }
            firstQueryParam = false;
        }
        if (currSeverities.length > 0) {
            $('#clear-filters').show(); 
            newUrl += firstQueryParam ? `?severities=${currSeverities}` : `&severities=${currSeverities}`;
            firstQueryParam = false;
        }
        if (currValOptions !== 'correct,unvalidated') {
            $('#clear-filters').show(); 
            newUrl += firstQueryParam ? `?validationOptions=${currValOptions}` : `&validationOptions=${currValOptions}`;
        }
        return newUrl;
    }


    /**
     * Render tags and severities in sidebar.
     */
    function render() {
        if (['Signal', 'Occlusion'].includes(status.currentLabelType)) {
            $('#severity-header').hide();
            $('#severity-select').hide();
        } else {
            $('#severity-header').show();
            $('#severity-select').show();
        }
        if (currentTags.getTags().length > 0) {
            $("#tags-header").show();
            currentTags.render(uiCardFilter.tags);
        } else {
            $("#tags-header").hide();
        }

        severities.render(uiCardFilter.severity);
        validationOptions.render(uiCardFilter.validationOptions)
    }

    /**
     * Return list of tags that have been selected by user.
     */
    function getAppliedTagNames() {
        return currentTags.getAppliedTags().map(tag => tag.getTag());
    }

    /**
     * Return list of all tags for current label type.
     */
    function getTagNames() {
        return currentTags.getTags().map(tag => tag.getTag());
    }

    /**
     * Return object containing all tags.
     */
    function getTagsByType() {
        return tagsByType;
    }

    /**
     * Return status of CardFilter.
     */
    function getStatus() {
        return status;
    }

    /**
     * Set attribute of status.
     * 
     * @param {*} key Status name.
     * @param {*} value Status value.
     */
    function setStatus(key, value) {
        if (key in status) {
            status[key] = value;
        } else {
            throw self.className + ": Illegal status name.";
        }
    }

    /**
     * Return list of severities.
     */
    function getSeverities() {
        return severities.getSeverities();
    }

    /**
     * Return list of selected severities by user.
     */
    function getAppliedSeverities() {
        return severities.getAppliedSeverities();
    }

    /**
     * Return list of validationOptions.
     */
    function getValidationOptions() {
        return validationOptions.getValidationOptions();
    }

    /**
     * Return list of selected validationOptions by user.
     */
    function getAppliedValidationOptions() {
        return validationOptions.getAppliedValidationOptions();
    }

    /**
     * Unapply all tags of specified label type.
     * 
     * @param {*} labelType Label type of tags to unapply.
     */
    function unapplyTags(labelType) {
        if (labelType != null) {
            tagsByType[labelType].unapplyTags();
        }
    }

    /**
     * Clear tags currently being shown.
     */
    function clearCurrentTags() {
        uiCardFilter.tags.empty();
        unapplyTags(status.currentLabelType);
        currentTags = new TagBucket();
    }

    /**
     * Disable interaction with filters.
     */
    function disable() {
        severities.disable();
        $('.gallery-filter').prop("disabled", true);
    }

    /**
     * Enable interaction with filters.
     */
    function enable() {
        severities.enable();
        $('.gallery-filter').prop("disabled", false);
    }

    function clearFilters() {
        severities.unapplySeverities();
        validationOptions.unapplyValidationOptions();
        validationOptions.setToDefault();
        clearCurrentTags();
        labelTypeMenu.setToDefault();
    }

    $('#clear-filters').on('click', function() {
        clearFilters();
        $('#clear-filters').hide();
        update();
    });

    self.update = update;
    self.render = render;
    self.getAppliedTagNames = getAppliedTagNames;
    self.getTagNames = getTagNames;
    self.getTagsByType = getTagsByType;
    self.getStatus = getStatus;
    self.setStatus = setStatus;
    self.getSeverities = getSeverities;
    self.getAppliedSeverities = getAppliedSeverities;
    self.getValidationOptions = getValidationOptions;
    self.getAppliedValidationOptions = getAppliedValidationOptions;
    self.unapplyTags = unapplyTags;
    self.disable = disable;
    self.enable = enable;
    self.clearFilters = clearFilters;

    _init();
    return this;
}
