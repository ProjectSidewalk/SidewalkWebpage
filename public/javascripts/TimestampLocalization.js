function updateTimestamp(locale) {
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
    
            // Load correct locale.
            moment.locale(locale);
    
            let localDate = moment(new Date(timestampText + " UTC"));
    
            // If the date cannot be parsed, ignore it and leave the text as-is. O/w, parse into local datetime format.
            if (localDate.isValid()) {
                this.textContent = localDate.format('LL');
            }
        });
    });
}
