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
        currentLabelType: null
    };

    let tagsByType = {
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

    function _init() {
        getTags(function () {
            console.log("tags received");
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

    function clearCurrentTags() {
        uiCardFilter.tags.empty();
        currentTags = [];
    }

    self.update = update;
    self.render = render;
    self.getTagsByType = getTagsByType;
    self.getStatus = getStatus;
    self.setStatus = setStatus;

    _init();
    return this;
}