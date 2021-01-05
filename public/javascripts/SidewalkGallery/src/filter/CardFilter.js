/**
 * Card Filter module. This is responsible for allowing users to apply
 * filters to specify what types of cards to render in the gallery
 *
 * @returns {CardFilter}
 * @constructor
 */
function CardFilter(uiCardFilter, ribbonMenu) {
    let self = this;

    let status = {
        currentLabelType: 'Assorted'
    };

    let tagsByType = {
        Assorted: new TagBucket(),
        CurbRamp: new TagBucket(),
        NoCurbRamp: new TagBucket(),
        Obstacle: new TagBucket(),
        SurfaceProblem: new TagBucket(),
        Other: new TagBucket(),
        Occlusion: new TagBucket(),
        NoSidewalk: new TagBucket(),
        Problem: new TagBucket()
    };

    let currentTags = new TagBucket();

    let severities = new SeverityBucket();
   
    function _init() {
        getTags(function () {
            console.log("tags received");
            render();
        });
    }

    function getTags(callback) {
        $.getJSON("/label/tags", function (data) {
            let tag,
                i = 0,
                len = data.length;
            for (; i < len; i++) {
                tag = new Tag(data[i]);
                tagsByType[tag.getLabelType()].push(tag);
            }

            if (callback) callback();
        });
    }

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

    function render() {
        if (currentTags.getTags().length > 0) {
            // TODO: think about to better show tags header in an organized manner
            $("#tags-header").show();
            currentTags.render(uiCardFilter.tags);
        } else {
            $("#tags-header").hide();
        }

        severities.render(uiCardFilter.severity);
    }

    function getAppliedTagNames() {
        return currentTags.getAppliedTags().map(tag => tag.getTag());
    }

    function getTagNames() {
        return currentTags.getTags().map(tag => tag.getTag());
    }

    function getTagsByType() {
        return tagsByType;
    }

    function getStatus() {
        return status;
    }

    function setStatus(key, value) {
        if (key in status) {
            status[key] = value;
        } else {
            throw self.className + ": Illegal status name.";
        }
    }

    function getSeverities() {
        //return severities;
        return severities.getSeverities();
    }

    function isSeverityApplied() {
        // for (let i = 0; i < severities.length; i++){
        //     if (severities[i].getActive()) {
        //         return true;
        //     }
        // }
        // return false;
        return severities.isSeverityApplied();
    }

    function getAppliedSeverities() {
        return severities.getAppliedSeverities();
    }

    function unapplyTags(labelType) {
        if (labelType != null) {
            console.log("tags unapplied");
            console.log(labelType);
            tagsByType[labelType].unapplyTags();
        }
    }

    function clearCurrentTags() {
        uiCardFilter.tags.empty();
        unapplyTags(status.currentLabelType);
        currentTags = new TagBucket();
    }

    self.update = update;
    self.render = render;
    self.getAppliedTagNames = getAppliedTagNames;
    self.getTagNames = getTagNames;
    self.getTagsByType = getTagsByType;
    self.getStatus = getStatus;
    self.setStatus = setStatus;
    self.getSeverities = getSeverities;
    self.isSeverityApplied = isSeverityApplied;
    self.getAppliedSeverities = getAppliedSeverities;
    self.unapplyTags = unapplyTags;

    _init();
    return this;
}