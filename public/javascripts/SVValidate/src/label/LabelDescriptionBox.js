/**
 * Validation description box. Manages the information displayed on the description box.
 *
 * @returns {LabelDescriptionBox}
 * @constructor
 */
function LabelDescriptionBox () {
    const self = this;
    let descriptionBox = $("#label-description-box");

    /**
     * Sets the box's descriptions for the given label.
     *
     * @param label The label whose information is to be shown on the box.
     */
    function setDescription(label) {
        let desBox = descriptionBox[0];
        desBox.style.width = 'auto';
        $(desBox).empty();

        let severity = label.getAuditProperty('severity');
        let description = label.getAuditProperty('description');
        let tags = label.getAuditProperty('tags');

        desBox.style['background-color'] = util.misc.getLabelColors(label.getAuditProperty('labelType'));

        if (severity && severity != 0) {
            const labelType = label.getAuditProperty('labelType');
            const headerKey = util.misc.isPositiveLabelType(labelType) ? 'common:quality' : 'common:severity';
            const levelKey = util.misc.getRatingLevelKeys(labelType)[severity];
            let $line1 = $('<div class="label-description-box-line-1"></div>');
            $line1.append(`<div>${i18next.t(headerKey)}: ${i18next.t(`common:${levelKey}`)}</div>`);

            const $severityImage = $('<img class="severity-image" alt="">')
                .attr('src', util.misc.getSmileyIconPath(severity, labelType, true));
            $line1.append($severityImage);
            $(desBox).append($line1);
        }

        if (tags && tags.length > 0) {
            // Translate to correct language and separate tags with a comma.
            let tag = tags.map(t => i18next.t('common:tag.' + t.replace(/:/g, '-'))).join(', ');
            let htmlString = document.createTextNode(i18next.t('common:tags') + ": " + tag);
            desBox.appendChild(htmlString);
            desBox.appendChild(document.createElement("br"));
        }

        if (description && description.trim().length > 0) {
            let htmlString = document.createTextNode(i18next.t('user-description') + description);
            desBox.appendChild(htmlString);
        }

        if (!severity && (!description || description.trim().length === 0) &&
           (!tags || tags.length === 0)) {
            let htmlString = document.createTextNode(i18next.t('center-ui.no-info'));
            desBox.appendChild(htmlString);
        }

        // On mobile, freeze an explicit width that accounts for the device pixel ratio. On desktop the box is
        // anchored via `right` and shrink-wraps between the scaled min/max-widths in CSS, so width stays 'auto'
        // and keeps tracking the UI scale.
        if (isMobile()) {
            let bound = desBox.getBoundingClientRect();
            desBox.style.width = (bound.right - bound.left) * window.devicePixelRatio + 'px';
            desBox.style.fontSize = '30px';
        }
    }

    self.setDescription = setDescription;
    return this;
}

