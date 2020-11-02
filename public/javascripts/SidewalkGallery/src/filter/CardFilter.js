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
        currentLabelType: 'Assorted' //change to 'Assorted' when the query is implemented
    };

    let tagsByType = {
        Assorted: [],
        CurbRamp: [],
        NoCurbRamp: [],
        Obstacle: [],
        SurfaceProblem: [],
        Other: [],
        Occlusion: [],
        NoSidewalk: [],
        Problem: []
    };

    let currentTags = [];

    let severities = [];
   
    function _init() {
        getTags(function () {
            console.log("tags received");
        });

        for(let i = 1; i <= 5; i++ ){
            severities.push(new Severity(i));
        }
    
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
            setStatus('currentLabelType', currentLabelType);
            currentTags = tagsByType[currentLabelType];
            sg.cardContainer.updateCardsByType();
        }

        render();
    }

    function render() {
        for (let i = 0; i < currentTags.length; i++) {
            currentTags[i].render(uiCardFilter.tags);
        }
        for (let i = 0; i < severities.length; i++){
            severities[i].render(uiCardFilter.severity);
        }
        

    }

    function getAppliedTags() {
        let appliedTags = [];
        for (let i = 0; i < currentTags.length; i++) {
            if (currentTags[i].getStatus().applied) {
                appliedTags.push(currentTags[i].getTag());
            }
        }

        return appliedTags;
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
        return severities;
    }

    function unapplyTags(labelType) {
        if (labelType != null) {
            console.log("tags unapplied");
            console.log(tagsByType[labelType]); 
            let tagsToUnapply = tagsByType[labelType];
            for (let i = 0; i < tagsToUnapply.length; i++) {
                tagsToUnapply[i].unapply();
            } 
        }
    }

    function clearCurrentTags() {
        uiCardFilter.tags.empty();
        currentTags = [];
    }

    self.update = update;
    self.render = render;
    self.getAppliedTags = getAppliedTags;
    self.getTagsByType = getTagsByType;
    self.getStatus = getStatus;
    self.setStatus = setStatus;
    self.getSeverities = getSeverities;
    self.unapplyTags = unapplyTags;

    _init();
    return this;
}