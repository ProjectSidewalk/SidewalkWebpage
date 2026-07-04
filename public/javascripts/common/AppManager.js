/**
 * Centralized application initialization manager.
 * Handles multiple initialization tasks (i18next, CSRF setup, etc.) and provides callbacks for when the setup is done.
 */
class AppManager {
  constructor() {
    this.isReady = false;
    this.readyCallbacks = [];
    this.initPromise = null;
    this.initTasks = [];
  }

  /**
     * Add an initialization task to be executed during page setup.
     * @param {string} name - Name of the task for debugging purposes.
     * @param {Function} taskFunction - Function that returns a Promise or executes synchronously.
     */
  addInitTask(name, taskFunction) {
    if (this.initPromise) {
      console.warn(`Cannot add init task '${name}' - initialization already started`);
      return;
    }

    this.initTasks.push({ name, taskFunction });
  }

  /**
     * Initialize all registered tasks and built-in page setup.
     * @param {string} csrfToken The CSRF token to attach to outgoing AJAX/fetch requests.
     * @param {object} i18nextParams Parameters for i18next initialization (see _setupI18next).
     * @param {object} [globals] Map of variable names to values to attach to `window` for global access.
     * @returns {Promise} Promise that resolves when all initialization is complete.
     */
  init(csrfToken, i18nextParams, globals = {}) {
    // Prevent multiple initializations.
    if (this.initPromise) {
      return this.initPromise;
    }

    // Attach globals to `window` synchronously so they're available to subsequent init tasks and page scripts.
    this._setupGlobals(globals);

    // CSRF token setup for AJAX and fetch requests.
    this.addInitTask('csrf-setup', () => {
      return this._setupCSRF(csrfToken);
    });

    // i18next initialization.
    this.addInitTask('i18next', () => {
      return this._setupI18next(i18nextParams);
    });

    // Set up logWebpageActivity function.
    this.addInitTask('logging-setup', () => {
      return this._setupLogging();
    });

    // Execute all initialization tasks.
    this.initPromise = this._executeInitTasks()
      .then(() => {
        this.isReady = true;
        this._executeReadyCallbacks();
      })
      .catch((error) => {
        console.error('Application initialization failed:', error);
        throw error;
      });

    return this.initPromise;
  }

  /**
     * Register a callback to be executed when the page setup is fully finished.
     * If the setup is already done, the callback is executed immediately.
     * @param {Function} callback - Function to execute when ready.
     */
  ready(callback) {
    if (typeof callback !== 'function') {
      console.warn('AppManager.ready() expects a function as argument');
      return;
    }

    if (this.isReady) {
      callback(); // Page setup is already done, execute callback immediately.
    } else {
      this.readyCallbacks.push(callback); // Queue the callback for when the page becomes ready.
    }
  }

  /**
     * Attach the given key/value pairs to the `window` object so they're accessible from any script on the page.
     * @param {object} globals Map of global variable names to their values.
     * @private
     */
  _setupGlobals(globals) {
    for (const [key, value] of Object.entries(globals)) {
      window[key] = value;
    }
  }

  /**
     * Set up CSRF token for all AJAX and fetch requests.
     * @private
     */
  _setupCSRF(csrfToken) {
    // Set up CSRF token for all AJAX requests.
    $.ajaxSetup({
      headers: {
        'Csrf-Token': csrfToken,
      },
    });

    // Set up CSRF token for fetch requests by overwriting the fetch function. The token is only attached to
    // same-origin requests: Play's CSRF filter only checks requests to our own server, and a token signed by this
    // server is meaningless to anyone else. Attaching it to cross-origin requests (Mapbox, Mapillary, Infra3d,
    // Overpass, sibling city servers, ...) does nothing useful and forces an unnecessary CORS preflight that some
    // hosts reject, so we skip them rather than maintaining an allowlist of hosts to exclude (#4232).
    const originalFetch = window.fetch;
    window.fetch = function (url, options = {}) {
      const requestUrl = (typeof url === 'string') ? url : url.url;

      // Resolve against the page origin so relative URLs (our routes) are correctly treated as same-origin.
      let isSameOrigin;
      try {
        isSameOrigin = new URL(requestUrl, window.location.origin).origin === window.location.origin;
      } catch {
        // If the URL can't be parsed, leave the request untouched rather than guessing.
        isSameOrigin = false;
      }

      if (!isSameOrigin) {
        return originalFetch(url, options);
      }

      const newOptions = {
        ...options,
        headers: {
          ...options.headers,
          'Csrf-Token': csrfToken,
        },
      };
      return originalFetch(url, newOptions);
    };
  }

  /**
     * Initialize i18next with the given language and namespaces. Handles country-specific overrides.
     *
     * @param {object} params - Properties that determine which translations should be loaded.
     * @param {string} params.language - The language to use for translations, e.g., "en", "en-US", "es", etc.
     * @param {string} params.defaultNS The default namespace to use if no specific ns is provided, e.g., "common"
     * @param {Array<string>} params.namespaces An array of namespaces to load, e.g., ["common", "explore"]
     * @param {string} params.countryId The server's country ID to determine if we load country-specific overrides
     * @returns {Promise} Promise that resolves when i18next is ready.
     * @private
     */
  _setupI18next(params) {
    // Set up country-specific namespace overrides.
    let namespaces = params.namespaces;
    if (params.countryId === 'india') {
      namespaces = [...namespaces, ...namespaces.map((str) => `${str}-india`)];
    } else if (params.countryId === 'switzerland') {
      namespaces = [...namespaces, ...namespaces.map((str) => `${str}-zurich`)];
    }

    return i18next.use(i18nextHttpBackend).init({
      backend: {
        loadPath: '/assets/locales/{{lng}}/{{ns}}.json',
        allowMultiLoading: true,
      },
      fallbackLng: 'en',
      ns: namespaces,
      defaultNS: params.defaultNS,
      lng: params.language,
      partialBundledLanguages: true,
      debug: false,
    }, (err) => {
      // Ignore errors loading translations, but log any other errors.
      if (err && err.filter((e) => !e.includes('status code: 404')).length > 0) {
        return console.error(err.filter((e) => !e.includes('status code: 404')));
      }

      // After loading, merge the country-specific override namespaces into the base ones.
      // Going through list of languages so that we still get the en translations when using en-US.
      for (const l of i18next.languages) {
        for (const ns of namespaces) {
          if (params.countryId === 'india') {
            i18next.addResourceBundle(l, ns, i18next.getResourceBundle(l, `${ns}-india`) || {}, true, true);
          } else if (params.countryId === 'switzerland') {
            i18next.addResourceBundle(l, ns, i18next.getResourceBundle(l, `${ns}-zurich`) || {}, true, true);
          }
        }
      }

      // Localize any static [data-i18n] markup on the page now that translations are loaded.
      if (typeof window.localizeSubtree === 'function') {
        window.localizeSubtree(document.body);
      }
    });
  }

  /**
     * Set up logWebpageActivity function to be used anywhere on the site.
     * @private
     */
  _setupLogging() {
    // NOTE We are setting async as false by default since this is primarily used before a redirect.
    window.logWebpageActivity = function (activity, async = false) {
      $.ajax({
        async,
        contentType: 'application/json; charset=utf-8',
        url: '/userapi/logWebpageActivity',
        method: 'POST',
        data: JSON.stringify(activity),
        dataType: 'json',
        error(result) {
          console.error(result);
        },
      });
    };
  }

  /**
     * Execute all registered initialization tasks.
     * @returns {Promise} Promise that resolves when all tasks complete.
     * @private
     */
  async _executeInitTasks() {
    for (const task of this.initTasks) {
      try {
        const result = task.taskFunction();

        // Handle both synchronous and asynchronous tasks.
        if (result && typeof result.then === 'function') {
          await result;
        }
      } catch (error) {
        console.error(`Init task '${task.name}' failed:`, error);
        throw new Error(`Initialization failed at task: ${task.name}`);
      }
    }
  }

  /**
     * Execute all queued ready callbacks.
     * @private
     */
  _executeReadyCallbacks() {
    while (this.readyCallbacks.length > 0) {
      const callback = this.readyCallbacks.shift();
      try {
        callback();
      } catch (error) {
        console.error('Error executing app ready callback:', error);
      }
    }
  }
}

// Create and export a singleton instance.
window.appManager = new AppManager();
