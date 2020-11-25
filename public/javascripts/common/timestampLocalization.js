/** Converts to local date format and puts timestamp in local date format. */
function updateTimestamps(locale) {
    $(document).ready(function () {
        $(".timestamp").each(function() {
            if ($(this).hasClass('local')) {
                return;
            }
            $(this).addClass('local');

            // Skip if the timestamp is null.
            if (_.isEmpty(this.textContent)) {
                return;
            }
    
            let timestampText = this.textContent;

            // Adds a sorting attribute, if it's part of a table it will be sorted by this instead of the nicely
            // formatted timestamp.
            $(this).attr("data-order", timestampText);
    
            // Converts to local time and changes to local date format.
            moment.locale(locale);
            let localDate = moment(timestampText + ' UTC');
    
            // If the date cannot be parsed, ignore it and leave the text as-is. O/w, parse into local datetime format.
            if (localDate.isValid()) {
                this.textContent = localDate.format('LL');
            }
        });
    });
}
