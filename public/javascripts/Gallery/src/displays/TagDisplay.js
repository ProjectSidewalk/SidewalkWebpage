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
            // Print the header of the Tags div.
            $(container).empty();
            let tagHeader = document.createElement('div');
            tagHeader.className = 'label-tags-header';
            if (isModal) {
                // Add bold weight. Find better way to do this. 
                tagHeader.classList.add('modal-tag-header');
            }

            tagHeader.innerText = `${i18next.t("tags")}`;
            $(container).append(tagHeader);

            let tagContainer = document.createElement('div');
            tagContainer.className = 'label-tags-holder';
            $(container).append(tagContainer);

            // The width (amount of horizontal space) we have for our tags is
            // the length of the container subtracted by the space taken up by
            // the header. 1.25 to deal with the padding from the space between the "Tag"
            // header and the actual list of tags.
            let remainingWidth = $(container).width() - ($(tagHeader).width() * 1.25);

            let hiddenCount = 0;

            // Order tags so that the tags that match the selected tags come first.
            let orderedTags = orderTags(tags);
            let tagsText = orderedTags.map(t => i18next.t('tag.' + t));

            // Try to append as many tags as possible into the parent container.
            for (let i = 0; i < tagsText.length; i++) {
                let tagTest = document.createElement('div');
                // We may want to rename the thumbnail-tag class if we every choose to make tags editable in modal mode.
                tagTest.className = 'gallery-tag thumbnail-tag gallery-tag-sidebar';
                tagTest.innerText = tagsText[i];
                $(tagContainer).append(tagTest);
                // 14 is from the 7px of padding/margin on all tags (both left and right) and the 5 is from the spacing beween tags (5px).
                // Careful though, as .width() doesn't necessarily seem to return px width. Need to find better solution.
                remainingWidth -= ($(tagTest).width() + 14 + 5); //TODO: Define these constants. Better way to do so?
                if (remainingWidth < 0 && !isModal) {
                    // No room for this tag, this will be one of the hidden tags, so we increment counter.
                    tagTest.remove();
                    hiddenCount += 1;
                }
            }

            if (hiddenCount > 0) {
                // We have hidden tags.
                let additional = document.createElement('div');
                additional.className = "gallery-tag additional-count";
                additional.innerText = " + " + hiddenCount;
                $(tagContainer).append(additional);
            }
        }
    }

    /**
     * Orders tags by placing tags that match applied tags first.
     * @param {*} tags Tags to order.
     * @returns Ordered tag list.
     */
    function orderTags(tags) {
        let orderedTags = [];
        let appliedTags = sg.tagContainer.getAppliedTagNames();
        for (let tag of tags) {
            if (orderedTags.length == 0) {
                orderedTags.push(tag);
            } else {
                if (appliedTags.includes(tag)) {
                    // Prepend tag if it is a selected tag.
                    orderedTags = [tag, ...orderedTags];
                } else {
                    orderedTags.push(tag);
                }
            }
        }

        return orderedTags;
    }

    _init()
    return self;
}
