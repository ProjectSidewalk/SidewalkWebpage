/**
 * An object that can display the tags of a label in accordance to the Sidewalk gallery V1.1 Mock
 * 
 * @param {HTMLElement} container The DOM element to contain the label information
 * @param {String[]} tags The tags to display
 * @param {Boolean} isModal a boolean switch used if the tags are displayed in a Modal or in a Card
 * @returns {TagDisplay} The created object
 */
function TagDisplay(container, tags, isModal=false) {
    let self = this
    function _init() {
        // Test to see if there are any tags left
        if (tags.length > 0 || isModal) {
            let tagsText = tags.map(t => i18next.t('tag.' + t))

            // Print the header of the Tags div
            $(container).empty()
            let tagHeader = document.createElement('div')
            tagHeader.className = 'label-tags-header'
            tagHeader.innerHTML = '<b>Tags:</b>'
            $(container).append(tagHeader)

            let tagContainer = document.createElement('div')
            tagContainer.className = 'label-tags-holder'
            $(container).append(tagContainer)
            let remainingWidth = $(container).width()
            // Tries to append as many tags as possible into the parent container
            for (let i = 0; i < tags.length; i++) {
                let tagTest = document.createElement('div')
                tagTest.className = 'gallery-tag'
                tagTest.innerText = tagsText[i]
                $(tagContainer).append(tagTest)
                remainingWidth -= ($(tagTest).width() + 8)
                if (remainingWidth < 0) {
                    tagTest.remove()
                }
            }
        }
    }
    _init()
    return self;
}
