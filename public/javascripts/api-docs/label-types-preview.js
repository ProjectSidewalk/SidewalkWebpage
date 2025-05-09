/**
 * Label Types Preview Generator
 * 
 * This script generates a preview table of Project Sidewalk label types
 * by fetching data directly from the Label Types API.
 * 
 * @requires DOM element with id 'label-types-preview'
 */

(function() {
  // Configuration options - can be overridden by calling setup()
  let config = {
    // TODO: update the BASE_URL to the production API URL
    apiBaseUrl: "http://localhost:9000/v3/api",
    // apiBaseUrl: "https://api.projectsidewalk.org/v3/api",
    containerId: "label-types-preview",
    showPrimaryOnly: true,
    maxWidth: 1000,
    endpoint: "/labelTypes"
  };

  // Public API
  window.LabelTypesPreview = {
    /**
     * Configure the label types preview
     * @param {Object} options - Configuration options
     * @param {string} [options.apiBaseUrl] - Base URL for the API
     * @param {string} [options.containerId] - ID of the container element
     * @param {boolean} [options.showPrimaryOnly] - Whether to show only primary label types
     * @param {number} [options.maxWidth] - Maximum width for the preview container
     * @param {string} [options.endpoint] - API endpoint for label types
     */
    setup: function(options) {
      config = Object.assign(config, options);
      return this;
    },

    /**
     * Initialize the label types preview
     * @returns {Promise} A promise that resolves when the preview is rendered
     */
    init: function() {
      const container = document.getElementById(config.containerId);
      
      if (!container) {
        console.error(`Container element with id '${config.containerId}' not found.`);
        return Promise.reject(new Error("Container element not found"));
      }

      // Set max width if specified
      if (config.maxWidth) {
        container.style.maxWidth = `${config.maxWidth}px`;
        container.style.width = "100%";
        container.style.margin = "20px 0"; // Left-align the container
      }

      // Initialize with loading message
      container.innerHTML = "Loading label types data...";
      
      // Fetch and render the label types
      return this.fetchLabelTypes()
        .then(data => this.renderLabelTypes(data, container))
        .catch(error => {
          container.innerHTML = `<div class="message message-error">Failed to load label types: ${error.message}</div>`;
          return Promise.reject(error);
        });
    },

    /**
     * Fetch label types from the API
     * @returns {Promise} A promise that resolves with the label types data
     */
    fetchLabelTypes: function() {
      return fetch(`${config.apiBaseUrl}${config.endpoint}`)
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          return response.json();
        });
    },

    /**
     * Render the label types table
     * @param {Object} data - Label types data from the API
     * @param {HTMLElement} container - Container element
     * @returns {HTMLElement} The rendered table
     */
    renderLabelTypes: function(data, container) {
      // Filter label types if showPrimaryOnly is true
      let labelTypes = data.labelTypes;
      if (config.showPrimaryOnly) {
        labelTypes = labelTypes.filter(type => type.isPrimary);
      }
      
      // Create table structure
      const table = document.createElement('table');
      table.className = 'label-types-table';
      
      // Create table header
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      
      const headers = ['Name', 'Description', 'Standard Icon', 'Small Icon', 'Tiny Icon', 'Color Preview', 'Color Code'];
      headers.forEach(text => {
        const th = document.createElement('th');
        th.textContent = text;
        headerRow.appendChild(th);
      });
      
      thead.appendChild(headerRow);
      table.appendChild(thead);
      
      // Create table body
      const tbody = document.createElement('tbody');
      
      labelTypes.forEach(type => {
        const row = document.createElement('tr');
        
        // Name cell
        const nameCell = document.createElement('td');
        nameCell.textContent = type.name;
        nameCell.className = 'label-name';
        row.appendChild(nameCell);
        
        // Description cell
        const descCell = document.createElement('td');
        descCell.textContent = type.description;
        descCell.className = 'label-description';
        row.appendChild(descCell);
        
        // Standard icon cell
        const iconCell = document.createElement('td');
        const icon = document.createElement('img');
        icon.src = type.iconUrl;
        icon.alt = `${type.name} icon`;
        icon.height = 32;
        iconCell.appendChild(icon);
        row.appendChild(iconCell);
        
        // Small icon cell
        const smallIconCell = document.createElement('td');
        const smallIcon = document.createElement('img');
        smallIcon.src = type.smallIconUrl;
        smallIcon.alt = `${type.name} small icon`;
        smallIcon.height = 24;
        smallIconCell.appendChild(smallIcon);
        row.appendChild(smallIconCell);
        
        // Tiny icon cell
        const tinyIconCell = document.createElement('td');
        const tinyIcon = document.createElement('img');
        tinyIcon.src = type.tinyIconUrl;
        tinyIcon.alt = `${type.name} tiny icon`;
        tinyIcon.height = 16;
        tinyIconCell.appendChild(tinyIcon);
        row.appendChild(tinyIconCell);
        
        // Color preview cell
        const colorPreviewCell = document.createElement('td');
        colorPreviewCell.className = 'color-cell';
        colorPreviewCell.style.backgroundColor = type.color;
        
        // Determine if color is light or dark for text contrast
        const isLight = this.isLightColor(type.color);
        if (isLight) {
          colorPreviewCell.classList.add('light-color');
        }
        
        colorPreviewCell.textContent = type.name;
        row.appendChild(colorPreviewCell);
        
        // Color code cell
        const colorCodeCell = document.createElement('td');
        const colorCode = document.createElement('code');
        colorCode.textContent = type.color;
        colorCodeCell.appendChild(colorCode);
        row.appendChild(colorCodeCell);
        
        tbody.appendChild(row);
      });
      
      table.appendChild(tbody);
      
      // Clear container and add table
      container.innerHTML = '';
      container.appendChild(table);
      
      return table;
    },

    /**
     * Determine if a color is light or dark
     * @param {string} hexColor - Hex color code
     * @returns {boolean} True if the color is light, false otherwise
     */
    isLightColor: function(hexColor) {
      // Remove the # if present
      hexColor = hexColor.replace('#', '');
      
      // Parse the color
      const r = parseInt(hexColor.substring(0, 2), 16);
      const g = parseInt(hexColor.substring(2, 4), 16);
      const b = parseInt(hexColor.substring(4, 6), 16);
      
      // Calculate perceived brightness (formula from W3C)
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;
      
      // Return true if the color is light (brightness > 125)
      return brightness > 125;
    }
  };
})();