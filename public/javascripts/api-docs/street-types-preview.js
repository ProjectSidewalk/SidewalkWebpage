/**
 * Street Types Preview Generator.
 *
 * This script generates a preview table of OSM street types by fetching data directly from the Street Types API.
 *
 * @requires DOM element with id 'street-types-preview'
 */

(function() {
    // Configuration options - can be overridden by calling setup().
    let config = {
        apiBaseUrl: "/v3/api",
        containerId: "street-types-preview",
        maxWidth: 1000,
        endpoint: "/streetTypes"
    };

    // Public API
    window.StreetTypesPreview = {
        /**
         * Configure the street types preview.
         * @param {object} options - Configuration options
         * @param {string} [options.apiBaseUrl] - Base URL for the API
         * @param {string} [options.containerId] - ID of the container element
         * @param {number} [options.maxWidth] - Maximum width for the preview container
         * @param {string} [options.endpoint] - API endpoint for street types
         */
        setup: function(options) {
            config = Object.assign(config, options);
            return this;
        },

        /**
         * Initialize the street types preview.
         * @returns {Promise} A promise that resolves when the preview is rendered
         */
        init: function() {
            const container = document.getElementById(config.containerId);

            if (!container) {
                console.error(`Container element with id '${config.containerId}' not found.`);
                return Promise.reject(new Error("Container element not found"));
            }

            // Set max width if specified.
            if (config.maxWidth) {
                container.style.maxWidth = `${config.maxWidth}px`;
                container.style.width = "100%";
                container.style.margin = "20px 0"; // Left-align the container.
            }

            // Initialize with loading message.
            container.innerHTML = "Loading street types data...";

            // Fetch and render the street types.
            return this.fetchStreetTypes()
                .then(data => this.renderStreetTypes(data, container))
                .catch(error => {
                    container.innerHTML = `<div class="message message-error">Failed to load street types: ${error.message}</div>`;
                    return Promise.reject(error);
                });
        },

        /**
         * Fetch street types from the API.
         * @returns {Promise} A promise that resolves with the street types data
         */
        fetchStreetTypes: function() {
            return fetch(`${config.apiBaseUrl}${config.endpoint}`)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! Status: ${response.status}`);
                    }
                    return response.json();
                });
        },

        /**
         * Render the street types table.
         * @param {object} data - Street types data from the API
         * @param {HTMLElement} container - Container element
         * @returns {HTMLElement} The rendered table
         */
        renderStreetTypes: function(data, container) {
            // Sort street types by count in descending order.
            let streetTypes = data.streetTypes.slice().sort((a, b) => b.count - a.count);

            // Find the maximum count for the progress bars.
            const maxCount = streetTypes.length > 0 ? streetTypes[0].count : 0;

            // Create table structure.
            const table = document.createElement('table');
            table.className = 'street-types-table';

            // Create table header.
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');

            const headers = ['Street Type', 'Description', 'Street Segment Count'];
            headers.forEach(text => {
                const th = document.createElement('th');
                th.textContent = text;
                headerRow.appendChild(th);
            });

            thead.appendChild(headerRow);
            table.appendChild(thead);

            // Create table body.
            const tbody = document.createElement('tbody');

            streetTypes.forEach(type => {
                const row = document.createElement('tr');

                // Street type name cell.
                const nameCell = document.createElement('td');
                nameCell.textContent = type.name;
                nameCell.className = 'street-name';
                row.appendChild(nameCell);

                // Description cell.
                const descCell = document.createElement('td');
                descCell.textContent = type.description;
                descCell.className = 'street-description';
                row.appendChild(descCell);

                // Count cell.
                const countCell = document.createElement('td');
                countCell.className = 'street-count';

                // Create a container for the count and progress bar.
                const countContainer = document.createElement('div');
                countContainer.className = 'street-count-container';

                // Add the count number.
                const countNumber = document.createElement('div');
                countNumber.textContent = type.count.toLocaleString();
                countNumber.className = 'count-number';
                countContainer.appendChild(countNumber);

                // Add progress bar to visualize the relative count.
                const progressContainer = document.createElement('div');
                progressContainer.className = 'count-bar-container';

                const progressBar = document.createElement('div');
                progressBar.className = 'count-bar-fill';
                progressBar.style.width = `${(type.count / maxCount) * 100}%`;

                progressContainer.appendChild(progressBar);
                countContainer.appendChild(progressContainer);

                countCell.appendChild(countContainer);
                row.appendChild(countCell);

                tbody.appendChild(row);
            });

            table.appendChild(tbody);

            // Clear container and add table.
            container.innerHTML = '';
            container.appendChild(table);

            return table;
        }
    };
})();
