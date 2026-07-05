/**
 * Compiles and submits Gallery interaction log data to the back end.
 */
class Form {
  #dataStoreUrl;

  /**
   * @param {string} url - URL to send interaction data to.
   */
  constructor(url) {
    this.#dataStoreUrl = url;

    // Flush any remaining logs when the page is being dismissed. `pagehide` is the reliable, bfcache-compatible
    // unload signal; `keepalive` lets the POST outlive the page while still routing through AppManager's fetch
    // wrapper, which attaches the `Csrf-Token` header Play's CSRF filter requires (#3935).
    window.addEventListener('pagehide', () => {
      sg.tracker.push('Unload');
      const data = [this.compileSubmissionData()];
      fetch(this.#dataStoreUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(data),
        keepalive: true,
      });
    });
  }

  /**
   * Compiles the buffered interaction data into a format that can be parsed by our back end.
   * @returns {Object} The log data to submit.
   */
  compileSubmissionData() {
    const data = {};

    data.environment = {
      browser: util.getBrowser(),
      browser_version: util.getBrowserVersion(),
      browser_width: $(window).width(),
      browser_height: $(window).height(),
      screen_width: screen.width,
      screen_height: screen.height,
      avail_width: screen.availWidth,
      avail_height: screen.availHeight,
      operating_system: util.getOperatingSystem(),
      language: i18next.language,
    };

    data.interactions = sg.tracker.getActions();
    sg.tracker.refresh();
    return data;
  }

  /**
   * Submits front-end log data to the back end.
   *
   * @param {Object|Object[]} data - A single submission object, or an array of them.
   * @returns {Promise<void>}
   */
  submit(data) {
    if (data.constructor !== Array) {
      data = [data];
    }

    return fetch(this.#dataStoreUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(data),
    })
      .then((response) => {
        if (response.ok) {
          console.log('Data logged successfully');
        } else {
          console.error(`Failed to log data: ${response.status}`);
        }
      })
      .catch((error) => {
        console.error(error);
      });
  }
}
