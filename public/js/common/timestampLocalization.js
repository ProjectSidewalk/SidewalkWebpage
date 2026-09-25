/** Converts every `.timestamp` element's text to the reader's local date format, once the page has been parsed. */
function updateTimestamps(locale) {
  util.onDomReady(() => {
    moment.locale(locale);
    for (const el of document.querySelectorAll('.timestamp:not(.local)')) {
      el.classList.add('local');
      if (!el.textContent) continue;

      const localDate = moment(el.textContent);
      // Text that isn't a date is left as-is.
      if (localDate.isValid()) el.textContent = localDate.format('LL');
    }
  });
}
