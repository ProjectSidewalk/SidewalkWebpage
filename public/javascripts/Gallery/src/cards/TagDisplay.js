function TagDisplay(container, tags) {
    let self = this
    function _init() {
        if (tags.length > 0) {
            let tagsText = tags.map(t => i18next.t('tag.' + t))
            // console.log(tagsText)
            tagTest = document.createElement('div')
            tagTest.className = 'gallery-tag'
            tagTest.innerText = tagsText[0]
            container.appendChild(tagTest)
            console.log($(tagTest).width())
            // console.log($(tagTest).width())
        }
    }
    _init()
    return self;
}