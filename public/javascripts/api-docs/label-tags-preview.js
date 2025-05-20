/**
 * Label Tags Preview Generator
 * 
 * This script generates a preview of Project Sidewalk label tags grouped by label type
 * by fetching data directly from the Label Tags API.
 * 
 * @requires DOM element with id 'label-tags-preview'
 */

(function() {
  // Configuration options - can be overridden by calling setup()
  let config = {
    apiBaseUrl: "/v3/api",
    containerId: "label-tags-preview",
    maxWidth: 1000,
    apiVersion: "v3",
    apiPath: "/v3/api",
    apiDocsPath: "/v3/api-docs",
    endpoint: "/labelTags",
    imageBasePath: "/assets/images/examples/tags",
    displayMode: "detailed" // "detailed" or "summary"
  };

  // Public API
  window.LabelTagsPreview = {
    /**
     * Configure the label tags preview
     * @param {Object} options - Configuration options
     * @param {string} [options.apiBaseUrl] - Base URL for the API
     * @param {string} [options.containerId] - ID of the container element
     * @param {number} [options.maxWidth] - Maximum width for the preview container
     * @param {string} [options.endpoint] - API endpoint for label tags
     * @param {string} [options.imageBasePath] - Base path for tag images
     * @param {string} [options.displayMode] - Display mode: "detailed" (default) or "summary"
     */
    setup: function(options) {
      config = Object.assign(config, options);
      return this;
    },

    /**
     * Initialize the label tags preview
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
        container.style.margin = "20px 0";
      }

      // Initialize with loading spinner
      container.innerHTML = `
        <div class="loading-container">
          <div class="loading-spinner"></div>
        </div>
      `;
      
      // Fetch and render the label tags
      return this.fetchLabelTags()
        .then(data => {
          if (config.displayMode === "summary") {
            this.renderLabelTagsSummary(data, container);
          } else {
            this.renderLabelTags(data, container);
          }
        })
        .catch(error => {
          container.innerHTML = `<div class="message message-error">Failed to load label tags: ${error.message}</div>`;
          return Promise.reject(error);
        });
    },

    /**
     * Fetch label tags from the API
     * @returns {Promise} A promise that resolves with the label tags data
     */
    fetchLabelTags: function() {
      return fetch(`${config.apiBaseUrl}${config.endpoint}`)
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          return response.json();
        });
    },

    /**
     * Group label tags by label type
     * @param {Array} labelTags - Array of label tag objects
     * @returns {Object} Object with label types as keys and arrays of tags as values
     */
    groupTagsByLabelType: function(labelTags) {
      return labelTags.reduce((groups, tag) => {
        const labelType = tag.labelType;
        if (!groups[labelType]) {
          groups[labelType] = [];
        }
        groups[labelType].push(tag);
        return groups;
      }, {});
    },

    /**
     * Generate a description for a tag
     * @param {Object} tag - Tag object
     * @returns {string} Generated description
     */
    generateTagDescription: function(tag) {
      // This is a placeholder. In a real implementation, you might
      // fetch descriptions from the API or have a mapping of descriptions.
      // For now, we'll create a generic description based on the tag name.
      return `TODO`;
    },

    /**
     * Capitalize the first letter of a string
     * @param {string} string - The string to capitalize
     * @returns {string} The string with the first letter capitalized
     */
    capitalizeFirstLetter: function(string) {
      if (!string) return '';
      return string.charAt(0).toUpperCase() + string.slice(1);
    },

    /**
     * Render the label tags preview
     * @param {Object} data - Label tags data from the API
     * @param {HTMLElement} container - Container element
     */
    renderLabelTags: function(data, container) {
      // Group tags by label type
      const groupedTags = this.groupTagsByLabelType(data.labelTags);
      
      // Clear container
      container.innerHTML = '';
      
      // Sort label types alphabetically
      const sortedLabelTypes = Object.keys(groupedTags).sort();
      
      // Render each label type section
      sortedLabelTypes.forEach(labelType => {
        const tagsForType = groupedTags[labelType];
        
        // Create section for this label type
        const section = document.createElement('div');
        section.className = 'label-tags-section';
        
        // Add heading for the label type
        const heading = document.createElement('h3');
        heading.className = 'section-subheading';
        heading.textContent = labelType;
        const headingId = 'label-type-' + labelType.toLowerCase()
                                                 .replace(/\s+/g, '-')     // Replace spaces with hyphens
                                                 .replace(/[^a-z0-9-]/g, ''); // Remove non-alphanumeric characters except hyphens
        heading.id = headingId;
        section.appendChild(heading);
        
        // Create table for tags
        const table = document.createElement('table');
        table.className = 'tags-table';
        
        // Create table header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        
        const headers = ['Tag Name', 'Example Image', 'Description', 'Mutually Exclusive With'];
        headers.forEach(text => {
          const th = document.createElement('th');
          th.textContent = text;
          headerRow.appendChild(th);
        });
        
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // Create table body
        const tbody = document.createElement('tbody');
        
        // Sort tags by name
        tagsForType.sort((a, b) => a.tag.localeCompare(b.tag)).forEach(tag => {
          const row = document.createElement('tr');
          
          // Tag name cell
          const nameCell = document.createElement('td');
          nameCell.className = 'tag-name';
          nameCell.textContent = this.capitalizeFirstLetter(tag.tag);
          row.appendChild(nameCell);
          
          // Tag image cell
          const imageCell = document.createElement('td');
          imageCell.className = 'tag-image';
          
          // Create image element
          const img = document.createElement('img');
          img.src = `${config.imageBasePath}/${tag.id}.png`;
          img.alt = `${tag.tag} tag image`;
          img.width = 150;
          // img.height = 50;
          img.onerror = function() {
            // Replace with placeholder if image fails to load
            this.src = '/assets/images/examples/tags/placeholder.png';
            this.alt = 'Image not available';
          };
          
          imageCell.appendChild(img);
          row.appendChild(imageCell);
          
          // Description cell
          const descCell = document.createElement('td');
          descCell.className = 'tag-description';
          descCell.textContent = this.generateTagDescription(tag);
          row.appendChild(descCell);
          
          // Mutually exclusive tags cell
          const exclusionsCell = document.createElement('td');
          exclusionsCell.className = 'tag-exclusions';
          
          if (tag.mutuallyExclusiveWith && tag.mutuallyExclusiveWith.length > 0) {
            tag.mutuallyExclusiveWith.forEach(exclusiveTag => {
              const span = document.createElement('span');
              span.textContent = exclusiveTag;
              exclusionsCell.appendChild(span);
            });
          }
          
          row.appendChild(exclusionsCell);
          
          tbody.appendChild(row);
        });
        
        table.appendChild(tbody);
        section.appendChild(table);
        
        container.appendChild(section);
      });
    },

    /**
     * Render a summary table of label tags by label type
     * @param {Object} data - Label tags data from the API
     * @param {HTMLElement} container - Container element
     */
    renderLabelTagsSummary: function(data, container) {
      // Group tags by label type
      const groupedTags = this.groupTagsByLabelType(data.labelTags);
      
      // Clear container
      container.innerHTML = '';
      
      // Create table
      const table = document.createElement('table');
      table.className = 'tags-summary-table';
      
      // Create table header
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      
      const headers = ['Label Type', 'Available Tags'];
      headers.forEach(text => {
        const th = document.createElement('th');
        th.textContent = text;
        headerRow.appendChild(th);
      });
      
      thead.appendChild(headerRow);
      table.appendChild(thead);
      
      // Create table body
      const tbody = document.createElement('tbody');
      
      // Sort label types alphabetically
      const sortedLabelTypes = Object.keys(groupedTags).sort();
      
      // Add a row for each label type
      sortedLabelTypes.forEach(labelType => {
        const tagsForType = groupedTags[labelType];
        
        const row = document.createElement('tr');
        
        // Label type cell
        const typeCell = document.createElement('td');
        typeCell.className = 'label-type';
        
        // Create a link to the detailed view on the label tags page
        const typeLink = document.createElement('a');
        typeLink.href = config.apiDocsPath + `labelTags#label-type-${labelType.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`;
        typeLink.textContent = labelType;
        typeCell.appendChild(typeLink);
        
        row.appendChild(typeCell);
        
        // Tags cell
        const tagsCell = document.createElement('td');
        tagsCell.className = 'label-tags-list';
        
        // Sort tags alphabetically
        const tagNames = tagsForType
          .map(tag => tag.tag)
          .sort((a, b) => a.localeCompare(b))
          .map(tag => this.capitalizeFirstLetter(tag));
        
        // Join tags with commas
        tagsCell.textContent = tagNames.join(', ');
        
        row.appendChild(tagsCell);
        
        tbody.appendChild(row);
      });
      
      table.appendChild(tbody);
      container.appendChild(table);
    }
  };
})();