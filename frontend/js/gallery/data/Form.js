/** Packages and submits Gallery interaction logs; the Tracker owns the buffer and decides when to send. */

import { util } from '../../common/utilities.js';

export class Form {
  #dataStoreUrl;

  /**
   * @param {string} url - URL to send interaction data to.
   */
  constructor(url) {
    this.#dataStoreUrl = url;
  }

  /**
   * Wraps a batch of interactions with the environment they were logged in, in the shape our back end parses.
   * @param {object[]} interactions - The actions to submit.
   * @returns {object} The log data to submit.
   */
  compileSubmissionData(interactions) {
    const data = {};

    data.environment = {
      browser: util.getBrowser(),
      browser_version: util.getBrowserVersion(),
      browser_width: document.documentElement.clientWidth,
      browser_height: document.documentElement.clientHeight,
      screen_width: screen.width,
      screen_height: screen.height,
      avail_width: screen.availWidth,
      avail_height: screen.availHeight,
      operating_system: util.getOperatingSystem(),
      language: i18next.language,
    };

    data.interactions = interactions;
    return data;
  }

  /**
   * Submits front-end log data to the back end.
   *
   * @param {object|object[]} data - A single submission object, or an array of them.
   * @param {{keepalive?: boolean}} [options] - `keepalive` lets the POST outlive the page while still routing
   *     through AppManager's fetch wrapper, which attaches the `Csrf-Token` header Play's CSRF filter requires (#3935).
   * @returns {Promise<void>}
   */
  submit(data, { keepalive = false } = {}) {
    if (data.constructor !== Array) {
      data = [data];
    }

    return fetch(this.#dataStoreUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(data),
      keepalive,
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
