/** Converts every `.timestamp` element's text to the reader's local date format, once the page has been parsed. */
function updateTimestamps(locale) {
  util.onDomReady(() => {
    for (const el of document.querySelectorAll('.timestamp:not(.local)')) {
      el.classList.add('local');
      if (!el.textContent) continue;

      moment.locale(locale);
      const localDate = moment(el.textContent);
      // Text that isn't a date is left as-is.
      if (localDate.isValid()) el.textContent = localDate.format('LL');
    }
  });
}
