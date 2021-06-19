/**
 * An object that can display the tags of a label in accordance to the Sidewalk gallery V1.1 Mock.
 * 
 * @param {HTMLElement} container The DOM element to contain the label information
 * @param {String[]} tags The tags to display
 * @param {Boolean} isModal a boolean switch used if the tags are displayed in a Modal or in a Card
 * @returns {TagDisplay} The created object
 */
function TagDisplay(container, tags, isModal=false) {
    let self = this;
    function _init() {
        // Test to see if there are any tags left.
        if (tags.length > 0 || isModal) {
            let tagsText = tags.map(t => i18next.t('tag.' + t));

            // Print the header of the Tags div.
            $(container).empty();
            let tagHeader = document.createElement('div');
            tagHeader.className = 'label-tags-header';
            tagHeader.innerHTML = `<b>${i18next.t("tags")}:</b>`;
            $(container).append(tagHeader);

            let tagContainer = document.createElement('div');
            tagContainer.className = 'label-tags-holder';
            $(container).append(tagContainer);
            let remainingWidth = $(container).width();

            let hiddenCount = 0;

            // Try to append as many tags as possible into the parent container.
            for (let i = 0; i < tags.length; i++) {
                let tagTest = document.createElement('div');
                tagTest.className = 'gallery-tag thumbnail-tag';
                tagTest.innerText = tagsText[i];
                $(tagContainer).append(tagTest);
                remainingWidth -= ($(tagTest).width() + 24); //TODO: figure out meaning of this constant.
                if (remainingWidth < 0) {
                    // No room for this tag, this will be one of the hidden tags, so we increment counter.
                    tagTest.remove();
                    hiddenCount += 1;
                }
            }

            console.log("Hidden count: " + hiddenCount);
            if (hiddenCount > 0) {
                // We have hidden tags.
                let additional = document.createElement('div');
                additional.className = "gallery-tag additional-count";
                additional.innerText = " + " + hiddenCount;
                $(tagContainer).append(additional);
            }
        }
    }
    _init()
    return self;
}
