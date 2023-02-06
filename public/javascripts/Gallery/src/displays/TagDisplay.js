/**
 * An object that can display the tags of a label.
 * 
 * @param {HTMLElement} container The DOM element to contain the label information
 * @param {String[]} tags The tags to display
 * @param {Boolean} isModal a boolean switch used if the tags are displayed in a Modal or in a Card
 * @returns {TagDisplay} The created object
 */
function TagDisplay(container, tags, isModal=false) {
    let self = this;
    const popoverTemplate = '<div class="popover additional-tag-popover" role="tooltip">' +
                                '<div class="arrow"></div>' +
                                '<h3 class="popover-title"></h3>' +
                                '<div class="popover-content additional-tag-popover-content"></div>' +
                            '</div>';

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

            // The width (amount of horizontal space) we have for our tags is the length of the container subtracted by
            // the space taken up by the header. 1.25 to deal with the padding from the space between the "Tag" header
            // and the actual list of tags. For the modal, it's simply the width of the tags section.
            let remainingWidth;
            if (isModal) remainingWidth = parseFloat($('.gallery-modal-info-tags').css('width'));
            else         remainingWidth = $(container).width() - ($(tagHeader).width() * 1.25);

            const MARGIN_BW_TAGS =
                parseFloat($('.gallery-tag').css('marginLeft')) + parseFloat($('.gallery-tag').css('marginRight'));
            const WIDTH_FOR_PLUS_N = 30;
            const MIN_TAG_WIDTH = 75;

            let orderedTags = orderTags(tags);
            let tagsText = orderedTags.map(t => i18next.t('tag.' + t));
            let hiddenTags = [];
            for (let i = 0; i < tagsText.length; i++) {
                let tagEl = document.createElement('div');
                // We may want to rename the thumbnail-tag class if we every choose to make tags editable in modal mode.
                tagEl.className = 'gallery-tag thumbnail-tag';
                tagEl.innerText = tagsText[i];
                $(tagContainer).append(tagEl);

                // If there is enough space to fit the full tag, add it. If there isn't enough to show the full tag but
                // there is still a decent amount of space (75 px if this is the last tag or 105 px if we also need to
                // add the '+n' text), add the tag with a max-width so that it gets cut off with an ellipsis. If we
                // can't fit the tag at all, will need to add to the hidden tags in the '+n' popover.
                let isLastTag = i === tagsText.length - 1;
                let tagWidth = parseFloat($(tagEl).css('width'));

                // If this is the last tag and there are hidden tags, then we need to account for the PLUS_N indicator
                // in addition to the margin between tags in the extra space needed. Otherwise, we just need to account
                // for the margin between tags.
                let extraSpaceNeeded = (isLastTag && hiddenTags.length === 0) ? MARGIN_BW_TAGS : MARGIN_BW_TAGS + WIDTH_FOR_PLUS_N;
                let spaceForShortenedTag = (isLastTag && hiddenTags.length === 0) ? MIN_TAG_WIDTH : MIN_TAG_WIDTH + WIDTH_FOR_PLUS_N;

                if (isModal || (remainingWidth > tagWidth + extraSpaceNeeded)) {
                    // Show the entire tag if there is enough space. Always show in modal bc we have a scrollbar.
                    remainingWidth -= (tagWidth + MARGIN_BW_TAGS);
                } else if (remainingWidth > spaceForShortenedTag) {
                    // Show a tag abbreviated with an ellipsis if there's some space, just not enough for the full tag.
                    $(tagEl).css('maxWidth', remainingWidth - extraSpaceNeeded);
                    tagWidth = parseFloat($(tagEl).css('width'));
                    remainingWidth -= (tagWidth + MARGIN_BW_TAGS);
                    // Since we cut off with an ellipsis, add a tooltip with the full text.
                    tagEl.title = tagsText[i];
                } else {
                    // If the tag does not fit at all, add it to the list of hidden tags to show in the popover.
                    tagEl.remove();
                    tagEl.classList.add("not-added");
                    hiddenTags.push(tagEl);
                }
            }

            // If there was not enough space to display all the tags, show the rest in a popover on the '+n' text.
            if (hiddenTags.length > 0) {
                let additional = document.createElement('div');
                additional.className = "gallery-tag additional-count";
                additional.innerText = " + " + hiddenTags.length;
                $(additional).popover("destroy").popover({
                    placement: 'top',
                    html: true,
                    delay: { "show": 300, "hide": 10 },
                    content: hiddenTags.map(tag => tag.outerHTML).join(""),
                    trigger: 'hover',
                    template: popoverTemplate
                }).popover("show").popover("hide");
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
        let appliedTags = sg.cardFilter.getAppliedTagNames();
        for (let tag of tags) {
            if (orderedTags.length === 0) {
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

    _init();
    return self;
}
