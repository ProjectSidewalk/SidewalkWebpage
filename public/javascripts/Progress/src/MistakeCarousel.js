function MistakeCarousel() {
    fetch('/userapi/mistakes?n=2')
        .then(response => {
            if (response.status === 404) throw new Error('URL not found');
            else if (!response.ok) throw new Error('Other network error');
            return response.json();
        }).then(data => {
        let mistakesHolder = document.getElementById('mistake-carousels-holder');
        let labelTypes = ['CurbRamp', 'NoCurbRamp', 'Obstacle', 'SurfaceProblem', 'Crosswalk', 'Signal'];

        for (const [typeIndex, labelType] of labelTypes.entries()) {
            // Add the header for this label type.
            let labelTypeHeader = document.createElement('h4');
            labelTypeHeader.textContent = labelType;
            labelTypeHeader.style.gridColumn = 1 + (typeIndex % 2);
            labelTypeHeader.style.gridRow = (1 + Math.floor(typeIndex / 2)) * 2 - 1;
            mistakesHolder.appendChild(labelTypeHeader);

            // Create the div for the carousel of images for this label type.
            let carousel = document.createElement('div');
            let carouselId = `carousel-example-${labelType}`
            carousel.id = carouselId;
            carousel.classList.add('carousel', 'slide');
            carousel.style.gridColumn = 1 + (typeIndex % 2);
            carousel.style.gridRow = (1 + Math.floor(typeIndex / 2)) * 2;
            carousel.setAttribute('data-interval', 'false');

            // Add the circles at the bottom of carousel that indicates which image in the carousel you're looking at.
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

                // Add the actual GSV image using the URL provided by the backend.
                let gsvImage = document.createElement('img');
                gsvImage.src = label.image_url;
                slide.appendChild(gsvImage);

                // Add the label icon onto the GSV image.
                let labelIcon = document.createElement('img');
                labelIcon.src = `/assets/images/icons/AdminTool_${labelType}.png`;
                Object.assign(labelIcon.style, {
                    position: 'absolute',
                    left: `${100 * label.canvas_x / label.canvas_width}%`,
                    top: `${100 * label.canvas_y / label.canvas_height}%`
                });
                slide.appendChild(labelIcon);

                // Add any comment from the validator if there is one.
                let validatorComment = document.createElement('div');
                validatorComment.textContent = label.validator_comment;
                validatorComment.classList.add('validation-comment', 'carousel-caption', 'mb-4');
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
            leftControlScreenReading.textContent = 'Previous';
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
            rightControlScreenReading.textContent = 'Next';
            rightControlScreenReading.classList.add('sr-only');
            rightControl.appendChild(rightControlScreenReading);
            carousel.appendChild(rightControl);

            mistakesHolder.appendChild(carousel);
        }
    });
}
