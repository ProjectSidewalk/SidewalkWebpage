/** Rewrites every `.timestamp` element's text in the reader's local date format. */
function updateTimestamps(locale) {
  util.onDomReady(() => {
    moment.locale(locale);
    for (const el of document.querySelectorAll('.timestamp:not(.local)')) {
      el.classList.add('local');
      if (!el.textContent) continue;

      const localDate = moment(el.textContent);
      if (localDate.isValid()) el.textContent = localDate.format('LL');
    }
  });
}
