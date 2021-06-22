/**
 * Card Filter module. 
 * This is responsible for allowing users to apply filters to specify what types of cards to render in the gallery.
 *
 * @param uiCardFilter UI element representing filter components of sidebar.
 * @param ribbonMenu UI element representing dropdown to select label type in sidebar.
 * @returns {CardFilter}
 * @constructor
 */
function CardFilter(uiCardFilter, ribbonMenu) {
    let self = this;

    let status = {
        currentLabelType: 'Assorted'
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
        NoSidewalk: new TagBucket()
    };

    // Tags of the current label type.
    let currentTags = new TagBucket();

    // Collection of severities.
    let severities = new SeverityBucket();
   
    /**
     * Initialize CardFilter.
     */
    function _init() {
        getTags(function () {
            console.log("tags received");
            render();
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
                tag = new Tag(data[i]);
                tagsByType[tag.getLabelType()].push(tag);
            }

            if (callback) callback();
        });
    }

    /**
     * Update filter componenets when label type changes.
     */
    function update() {
        let currentLabelType = ribbonMenu.getCurrentLabelType();
        if (status.currentLabelType !== currentLabelType) {
            clearCurrentTags();
            severities.unapplySeverities();
            setStatus('currentLabelType', currentLabelType);
            currentTags = tagsByType[currentLabelType];
            sg.cardContainer.updateCardsByType();
        }

        render();
    }

    /**
     * Render tags and severities in sidebar.
     */
    function render() {
        if (currentTags.getTags().length > 0) {
            // TODO: think about to better show tags header in an organized manner.
            $("#tags-header").show();
            currentTags.render(uiCardFilter.tags);
        } else {
            $("#tags-header").hide();
        }
        if (status.currentLabelType == "Occlusion") {
            $("#filters").hide();
            $("#horizontal-line").hide();
        } else {
            $("#filters").show();
            $("#horizontal-line").show();
        }

        severities.render(uiCardFilter.severity);
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
     * Unapply all tags of specified label type.
     * 
     * @param {*} labelType Label type of tags to unapply.
     */
    function unapplyTags(labelType) {
        if (labelType != null) {
            console.log("tags unapplied");
            console.log(labelType);
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
        $('.gallery-tag').prop("disabled", true);
    }

    /**
     * Enable interaction with filters.
     */
    function enable() {
        severities.enable();
        $('.gallery-tag').prop("disabled", false);
    }

    self.update = update;
    self.render = render;
    self.getAppliedTagNames = getAppliedTagNames;
    self.getTagNames = getTagNames;
    self.getTagsByType = getTagsByType;
    self.getStatus = getStatus;
    self.setStatus = setStatus;
    self.getSeverities = getSeverities;
    self.getAppliedSeverities = getAppliedSeverities;
    self.unapplyTags = unapplyTags;
    self.disable = disable;
    self.enable = enable;

    _init();
    return this;
}
