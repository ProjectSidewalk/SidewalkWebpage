/**
 * Creates the popup when clicking on the Admin Info button from template HTML. Used on /expertValidate.
 */
class AdminInfo {
    /**
     * Saves the pointers to the admin info and template. Adds event listeners to close the popover.
     *
     * @param {object} adminUi An object containing jQuery pointers to different elements of the Admin Info UI
     * @param {jQuery} adminUi.holder A jQuery pointer to the Admin Info button
     * @param {jQuery} adminUi.button A jQuery pointer to the Admin Info button
     * @param {jQuery} adminUi.template A jQuery pointer to the template HTML for the admin info popover
     */
    constructor(adminUi) {
        this.$templateAdminContent =  adminUi.template;
        this.$adminInfoButton = adminUi.button;

        // Show the admin info button.
        adminUi.holder.css('display', 'block');

        // Hide when clicking outside the popover or hitting the esc key.
        $(document).on('click', (e) => {
            if (!$(e.target).closest(`.popover, #${this.$adminInfoButton[0].id}`).length) {
                this.$adminInfoButton.popover('hide');
            }
        });
        $(document).on('keydown', (e) => {
            if (e.key === 'Escape') {
                this.$adminInfoButton.popover('hide');
            }
        });
    }

    /**
     * Updates the HTML in the popover for the Admin Info button on /expertValidate.
     *
     * @param {Label} currentLabel The current label shown; we show admin info related to this label
     */
    updateAdminInfo(currentLabel) {
        const newAdminContent = $(this.$templateAdminContent.html());

        // Update the popover HTML with the current label's username and label_id.
        const user = currentLabel.getAdminProperty('username');
        newAdminContent.find('#curr-label-username').html(`<a href="/admin/user/${user}" target="_blank">${user}</a>`);
        newAdminContent.find('#curr-label-id').html(currentLabel.getAuditProperty('labelId'));

        // Append the set of prior validations to the popover HTML.
        const prevVals = currentLabel.getAdminProperty('previousValidations');
        if (prevVals.length === 0) {
            newAdminContent.append(`<p class="prev-val">None</p>`);
        } else {
            for (const prevVal of currentLabel.getAdminProperty('previousValidations')) {
                const prevValText = i18next.t(`common:${util.camelToKebab(prevVal.validation)}`);
                newAdminContent.append(
                    `<p class="prev-val"><a href="/admin/user/${prevVal.username}" target="_blank">${prevVal.username}</a>: ${prevValText}</p>`
                );
            }
        }

        // Destroy the old popover and create a new one with the info for the new label.
        this.$adminInfoButton.popover('destroy').popover({
            content: newAdminContent.prop('outerHTML'),
            placement: 'bottom',
            html: true,
            container: 'body',
            trigger: 'click'
        });
    }
}
