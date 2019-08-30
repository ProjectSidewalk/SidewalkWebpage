/**
 * Validation description box. Manages the information
 * displayed on the description box.
 *
 * @returns {LabelDescriptionBox}
 * @constructor
 */
function LabelDescriptionBox () {
    let self = this;
    let descriptionBox = document.getElementById('label-description-box');

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
        descriptionBox.style.width = 'auto';
        $(descriptionBox).empty();

        let severity = label.getAuditProperty('severity');
        let temporary = label.getAuditProperty('temporary');
        let description = label.getAuditProperty('description');
        let tags = label.getAuditProperty('tags');

        descriptionBox.style['background-color'] = util.misc.getLabelColors(label.getAuditProperty('labelType'));

        if (severity && severity != 0) {
            let htmlString = document.createTextNode('Severity: ' + severity + ' ');
            descriptionBox.appendChild(htmlString);
            let img = document.createElement('img');
            img.setAttribute('src', smileyScale[severity]);
            img.setAttribute('width', '12px');
            img.setAttribute('height', '12px');
            img.style.verticalAlign = 'middle';
            descriptionBox.appendChild(img);
            descriptionBox.appendChild(document.createElement("br"));
        }

        if (temporary) {
            let htmlString = document.createTextNode('Temporary');
            descriptionBox.appendChild(htmlString);
            descriptionBox.appendChild(document.createElement("br"));
        }

        if (tags && tags.length > 0) {
            let tag = tags.join(', ');
            let htmlString = document.createTextNode('tags: ' + tag);
            descriptionBox.appendChild(htmlString);
            descriptionBox.appendChild(document.createElement("br"));
        }

        if (description && description.trim().length > 0) {
            let htmlString = document.createTextNode(description);
            descriptionBox.appendChild(htmlString);
        }

        if (!severity && !temporary && (!description || description.trim().length == 0) &&
           (!tags || tags.length == 0)) {
            let htmlString = document.createTextNode('No available information');
            descriptionBox.appendChild(htmlString);
        }

        // Set the width of the des box.
        let bound = descriptionBox.getBoundingClientRect();
        let width = (bound.right - bound.left) + 'px';
        descriptionBox.style.width = width;
    }

    self.setDescription = setDescription;
    return this;
}

