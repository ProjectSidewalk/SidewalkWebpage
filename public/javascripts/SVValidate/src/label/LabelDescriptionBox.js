/**
 * Validation description box. Manages the information
 * displayed on the description box.
 *
 * @returns {LabelDescriptionBox}
 * @constructor
 */
function LabelDescriptionBox () {
    let self = this;
    let descriptionBox = $("#label-description-box");

    let smileyScale = {
        1: '/assets/javascripts/SVLabel/img/misc/SmileyScale_1_White_Small.png',
        2: '/assets/javascripts/SVLabel/img/misc/SmileyScale_2_White_Small.png',
        3: '/assets/javascripts/SVLabel/img/misc/SmileyScale_3_White_Small.png',
        4: '/assets/javascripts/SVLabel/img/misc/SmileyScale_4_White_Small.png',
        5: '/assets/javascripts/SVLabel/img/misc/SmileyScale_5_White_Small.png'
    };

    /**
     * Sets the box's descriptions for the given label.
     *
     * @param label The label whose information is to be shown
     * on the box.
     */
    function setDescription(label) {
        let desBox = descriptionBox[0];
        desBox.style.width = 'auto';
        $(desBox).empty();

        let severity = label.getAuditProperty('severity');
        let temporary = label.getAuditProperty('temporary');
        let description = label.getAuditProperty('description');
        let tags = label.getAuditProperty('tags');

        desBox.style['background-color'] = util.misc.getLabelColors(label.getAuditProperty('labelType'));

        if (severity && severity != 0) {
            let span = document.createElement('span');
            let htmlString = document.createTextNode(i18next.t('common:severity') + ": " +  severity + ' ');
            desBox.appendChild(htmlString);
            let img = document.createElement('img');
            img.setAttribute('src', smileyScale[severity]);
            if (isMobile()) {
                img.setAttribute('width', '20px');
                img.setAttribute('height', '20px');
            } else {
                img.setAttribute('width', '12px');
                img.setAttribute('height', '12px');
            }

            img.style.verticalAlign = 'middle';
            span.appendChild(img);
            desBox.appendChild(span);
            desBox.appendChild(document.createElement("br"));
        }

        if (temporary) {
            let htmlString = document.createTextNode(i18next.t('temporary'));
            desBox.appendChild(htmlString);
            desBox.appendChild(document.createElement("br"));
        }

        if (tags && tags.length > 0) {
            // Translate to correct language and separate tags with a comma.
            let tag = tags.map(t => i18next.t('common:tag.' + t)).join(', ');
            let htmlString = document.createTextNode(i18next.t('common:tags') + ": " + tag);
            desBox.appendChild(htmlString);
            desBox.appendChild(document.createElement("br"));
        }

        if (description && description.trim().length > 0) {
            let htmlString = document.createTextNode(i18next.t('user-description') + description);
            desBox.appendChild(htmlString);
        }

        if (!severity && !temporary && (!description || description.trim().length == 0) &&
           (!tags || tags.length == 0)) {
            let htmlString = document.createTextNode(i18next.t('center-ui.no-info'));
            desBox.appendChild(htmlString);
        }

        // Set the width of the des box.
        let bound = desBox.getBoundingClientRect();
        let width = ((bound.right - bound.left) * (isMobile() ? window.devicePixelRatio : 1)) + 'px';
        desBox.style.width = width;

        if (isMobile()) {
            desBox.style.fontSize = '30px';
        }
    }

    self.setDescription = setDescription;
    return this;
}

