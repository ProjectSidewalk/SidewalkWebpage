// Changes timestamps from UTC to local time. Updates any data order variables for tables.
$(document).ready(function () {
    $(".timestamp").each(function() {
        if ($(this).hasClass('local')) {
            return;
        }
        $(this).addClass('local');

        let timestampText = this.textContent;

        // Adds a sorting attribute, if it's part of a table it will be sorted by this instead of the nicely
        // formatted timestamp.
        $(this).attr("data-order", timestampText);

        let localDate = moment(new Date(timestampText + " UTC"));

        let format = 'MMMM Do YYYY, h:mm:ss';
        if ($(this).hasClass('date')) {
            format = 'MMMM Do YYYY';
        }

        // If the date cannot be parsed, ignore it and leave the text as-is. O/w, parse into local datetime format.
        if (localDate.format(format) !== "Invalid date") {
            this.textContent = localDate.format(format);
        }
    });
});
