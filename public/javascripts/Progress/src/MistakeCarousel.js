/**
 * Query for labels most recently validated as incorrect by other users. Build a set of image carousels using that info.
 */
function MistakeCarousel() {
    fetch('/userapi/mistakes?n=7').then(response => {
        if (response.status === 404) throw new Error('URL not found');
        else if (!response.ok) throw new Error('Other network error');
        return response.json();
    }).then(data => {
        // Separate label types into a list of types with validation data and those without.
        const labelTypes = ['CurbRamp', 'NoCurbRamp', 'Obstacle', 'SurfaceProblem', 'Crosswalk', 'Signal'];
        let labelTypesWithData = [];
        let labelTypesWithoutData = [];
        labelTypes.forEach((l) => (data[l].length > 0 ? labelTypesWithData : labelTypesWithoutData).push(l));

        // This is the list of label types without validations.
        const translatedTypes = labelTypesWithoutData.map((l) => i18next.t(`common:${util.camelToKebab(l)}`));
        let mistakesSubheader = document.getElementById('mistakes-subheader-display');

        // User has no mistakes with their labels.
        if (labelTypesWithoutData.length === labelTypes.length) {
            mistakesSubheader.innerHTML = i18next.t('no-mistakes-subheader')
        // User has not made one mistake with at least one of their labels.
        } else if (labelTypesWithData.length !== labelTypes.length) {
            mistakesSubheader.textContent += i18next.t('mistakes-subheader') + " " + i18next.t('mistakes-info', { labelTypes: translatedTypes });
        // User has made a mistake for all types of labels.
        } else {
            mistakesSubheader.textContent = i18next.t('mistakes-subheader')
        }

        let mistakesHolder = document.getElementById('mistake-carousels-holder');

        for (const [typeIndex, labelType] of labelTypesWithData.entries()) {
            // Add the header for this label type.
            let labelTypeHeader = document.createElement('h3');
            labelTypeHeader.textContent = i18next.t(`common:${util.camelToKebab(labelType)}`);
            labelTypeHeader.style.gridColumn = 1 + (typeIndex % 2);
            labelTypeHeader.style.gridRow = (1 + Math.floor(typeIndex / 2)) * 2 - 1;
            mistakesHolder.appendChild(labelTypeHeader);

            // Create the div for the carousel of images for this label type.
            let carousel = document.createElement('div');
            let carouselId = `carousel-example-${labelType}`;
            carousel.id = carouselId;
            carousel.classList.add('carousel', 'slide');
            carousel.style.gridColumn = 1 + (typeIndex % 2);
            carousel.style.gridRow = (1 + Math.floor(typeIndex / 2)) * 2;
            carousel.setAttribute('data-interval', 'false');

            // Add the circles at bottom of carousel that indicates which image in the carousel you're seeing.
            let carouselNavigation = document.createElement('ol');
            carouselNavigation.classList.add('carousel-indicators');
            for (const [labelIndex, label] of data[labelType].entries()) {
                let indicator = document.createElement('li');
                indicator.setAttribute('data-target', `#${carouselId}`);
                indicator.setAttribute('data-slide-to', labelIndex);
                if (labelIndex === 0) indicator.classList.add('active');
                carouselNavigation.appendChild(indicator);
            }
            carousel.appendChild(carouselNavigation);

            // Create a wrapper that will hold each image in the carousel.
            let slideWrapper = document.createElement('div');
            slideWrapper.classList.add('carousel-inner');
            slideWrapper.setAttribute('role', 'listbox');

            for (const [labelIndex, label] of data[labelType].entries()) {
                // Add div to hold everything for the current image.
                let slide = document.createElement('div');
                if (labelIndex === 0) {
                    slide.classList.add('item', 'active');
                } else {
                    slide.classList.add('item');
                }

                // Add a wrapper div to help position label on image using proportions that exclude comments.
                let imageWrapper = document.createElement('div');
                imageWrapper.style.position = 'relative';

                // Add the actual GSV image using the URL provided by the backend.
                let gsvImage = document.createElement('img');
                gsvImage.src = label.image_url;
                gsvImage.classList.add('mistake-img');
                gsvImage.id = `label_id_${label.label_id}`;
                imageWrapper.appendChild(gsvImage);

                // Add the label icon onto the GSV image.
                let labelIcon = document.createElement('img');
                labelIcon.src = `/assets/images/icons/AdminTool_${labelType}.png`;
                labelIcon.classList.add('label-icon');
                Object.assign(labelIcon.style, {
                    left: `${100 * label.canvas_x / label.canvas_width}%`,
                    top: `${100 * label.canvas_y / label.canvas_height}%`
                });
                imageWrapper.appendChild(labelIcon);
                slide.appendChild(imageWrapper);

                // Add any comment from the validator if there is one.
                let validatorComment = document.createElement('div');
                validatorComment.classList.add('validation-comment', 'carousel-caption');
                if (label.validator_comment) {
                    validatorComment.textContent = i18next.t('validator-comment', {c: label.validator_comment});
                } else {
                    validatorComment.textContent = i18next.t('validator-no-comment');
                    validatorComment.style.fontStyle = 'italic';
                }
                slide.appendChild(validatorComment);

                slideWrapper.append(slide);
            }
            carousel.appendChild(slideWrapper);

            // Add the arrows to navigate images in the carousel (provided by Bootstrap).
            let leftControl = document.createElement('a');
            leftControl.classList.add('left', 'carousel-control');
            leftControl.href = `#${carouselId}`;
            leftControl.setAttribute('role', 'button');
            leftControl.setAttribute('data-slide', 'prev');

            let leftControlIcon = document.createElement('span');
            leftControlIcon.classList.add('glyphicon', 'glyphicon-chevron-left');
            leftControlIcon.setAttribute('aria-hidden', 'true');
            leftControl.appendChild(leftControlIcon);

            let leftControlScreenReading = document.createElement('span');
            leftControlScreenReading.textContent = i18next.t('previous');
            leftControlScreenReading.classList.add('sr-only');
            leftControl.appendChild(leftControlScreenReading);
            carousel.appendChild(leftControl);

            let rightControl = document.createElement('a');
            rightControl.classList.add('right', 'carousel-control');
            rightControl.href = `#${carouselId}`;
            rightControl.setAttribute('role', 'button');
            rightControl.setAttribute('data-slide', 'next');

            let rightControlIcon = document.createElement('span');
            rightControlIcon.classList.add('glyphicon', 'glyphicon-chevron-right');
            rightControlIcon.setAttribute('aria-hidden', 'true');
            rightControl.appendChild(rightControlIcon);

            let rightControlScreenReading = document.createElement('span');
            rightControlScreenReading.textContent = i18next.t('next');
            rightControlScreenReading.classList.add('sr-only');
            rightControl.appendChild(rightControlScreenReading);
            carousel.appendChild(rightControl);

            mistakesHolder.appendChild(carousel);
        }
    });
}
