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
     * @returns {Promise} Promise that resolves when all initialization is complete.
     */
    init(csrfToken, i18nextParams) {
        // Prevent multiple initializations.
        if (this.initPromise) {
            return this.initPromise;
        }

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
     * Set up CSRF token for all AJAX and fetch requests.
     * @private
     */
    _setupCSRF(csrfToken) {
        // Set up CSRF token for all AJAX requests.
        $.ajaxSetup({
            headers: {
                'Csrf-Token': csrfToken
            }
        });

        // Set up CSRF token for fetch requests by overwriting the fetch function.
        const originalFetch = window.fetch;
        window.fetch = function(url, options = {}) {
            // Create new options object with default headers.
            const newOptions = {
                ...options,
                headers: {
                    ...options.headers,
                    'Csrf-Token': csrfToken
                }
            };
            return originalFetch(url, newOptions);
        };
    }

    /**
     * Initialize i18next with the given language and namespaces. Handles India-specific overrides.
     *
     * @param {Object} params - Properties that determine which translations should be loaded.
     * @param {string} params.language - The language to use for translations, e.g., "en", "en-US", "es", etc.
     * @param {string} params.defaultNS The default namespace to use if no specific ns is provided, e.g., "common"
     * @param {array[string]} params.namespaces An array of namespaces to load, e.g., ["common", "explore"]
     * @param {string} params.countryId The server's country ID to determine if we need to load India-specific overrides
     * @returns {Promise} Promise that resolves when i18next is ready.
     * @private
     */
    _setupI18next(params) {
        const namespaces = params.namespaces;

        // Add "-india" suffix to each namespace to be used if this is an India server.
        const namespacesWithIndiaOverrides = [...namespaces, ...namespaces.map(str => `${str}-india`)];
        return i18next.use(i18nextHttpBackend).init({
            backend: {
                loadPath: '/assets/locales/{{lng}}/{{ns}}.json',
                allowMultiLoading: true
            },
            fallbackLng: 'en',
            // Also include india-specific namespaces if appropriate.
            ns: params.countryId === "india" ? namespacesWithIndiaOverrides : namespaces,
            defaultNS: params.defaultNS,
            lng: params.language,
            partialBundledLanguages: true,
            debug: false
        }, function(err, t) {
            // Ignore errors loading translations, but log any other errors.
            if (err && err.filter(e => !e.includes('status code: 404')).length > 0) {
                return console.error(err.filter(e => !e.includes('status code: 404')));
            }

            // After loading, merge the india-specific override namespaces into the base ones.
            if (params.countryId === "india") {
                // Going through list of languages so that we still get the en translations when using en-US.
                for (const l of i18next.languages) {
                    for (const ns of namespaces) {
                        i18next.addResourceBundle(l, ns, i18next.getResourceBundle(l, `${ns}-india`) || {}, true, true);
                    }
                }
            }
        });
    }

    /**
     * Set up logWebpageActivity function to be used anywhere on the site.
     * @private
     */
    _setupLogging() {
        // NOTE We are setting async as false by default since this is primarily used before a redirect.
        window.logWebpageActivity = function(activity, async = false) {
            $.ajax({
                async: async,
                contentType: 'application/json; charset=utf-8',
                url: '/userapi/logWebpageActivity',
                method: 'POST',
                data: JSON.stringify(activity),
                dataType: 'json',
                success: function(result) { },
                error: function (result) {
                    console.error(result);
                }
            });
        }
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
