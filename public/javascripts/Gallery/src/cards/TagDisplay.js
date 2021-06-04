function TagDisplay(container, tags) {
    let self = this
    function _init() {
        if (tags.length > 0) {
            let tagsText = tags.map(t => i18next.t('tag.' + t))
            // console.log(tagsText)

            $(container).empty()
            let tagHeader = document.createElement('div')
            tagHeader.className = 'label-tags-header'
            tagHeader.innerText = 'Tags:'
            $(container).append(tagHeader)

            let tagContainer = document.createElement('div')
            tagContainer.className = 'label-tags-holder'
            $(container).append(tagContainer)
            let remainingWidth = $(container).width()
            for (let i = 0; i < tags.length; i++) {
                let tagTest = document.createElement('div')
                tagTest.className = 'gallery-tag'
                tagTest.innerText = tagsText[i]
                $(tagContainer).append(tagTest)
                remainingWidth -= $(tagTest).width()
                if (remainingWidth < 0) {
                    tagTest.remove()
                }
                console.log(remainingWidth)
            }
            // console.log($(tagTest).width())
            // console.log($(tagTest).width())
        }
    }
    _init()
    return self;
}