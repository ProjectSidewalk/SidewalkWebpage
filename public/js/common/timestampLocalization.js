/** Converts to local date format and puts timestamp in local date format. */
function updateTimestamps(locale) {
  $(document).ready(() => {
    processTimestamps();

    function processTimestamps() {
      $('.timestamp').each(function () {
        if ($(this).hasClass('local')) {
          return;
        }
        $(this).addClass('local');

        // Skip if the timestamp is null.
        if (!this.textContent) {
          return;
        }

        const timestampText = this.textContent;

        // Converts to local time and changes to local date format.
        moment.locale(locale);
        const localDate = moment(timestampText);

        // If the date cannot be parsed, ignore it and leave the text as-is. O/w, parse into local datetime format.
        if (localDate.isValid()) {
          this.textContent = localDate.format('LL');
        }
      });
    }
  });
}
