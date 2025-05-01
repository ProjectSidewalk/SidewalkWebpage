/**
 * Project Sidewalk API Documentation JavaScript
 * 
 * This script handles the interactive features of the API documentation page:
 * - Accordion navigation in the sidebar
 * - Scroll spy to highlight active sections
 * - Dynamic TOC generation for right sidebar
 * - Mobile responsiveness
 * - Permalink copying
 */

document.addEventListener('DOMContentLoaded', function() {
  console.log('API Docs script initialized');
  initializeAccordions();
  generateTableOfContents();
  setupScrollSpy();
  setupMobileNavigation();
  setupPermalinkCopying();
});

/**
 * Initializes accordion functionality for the sidebar navigation
 * @returns {void}
 */
function initializeAccordions() {
  const accordions = document.querySelectorAll('.api-nav-accordion');
  
  if (accordions.length === 0) {
    console.log('No accordion elements found');
    return;
  }

  accordions.forEach(accordion => {
    // Skip setup for the active accordion as it's already open
    if (!accordion.classList.contains('active')) {
      // Make sure the submenu is initially closed
      const submenu = accordion.nextElementSibling;
      if (submenu && submenu.classList.contains('api-nav-submenu')) {
        submenu.style.maxHeight = '0px';
        submenu.style.overflow = 'hidden';
      }
    }

    // Add click event listener
    accordion.addEventListener('click', function() {
      this.classList.toggle('active');
      const submenu = this.nextElementSibling;
      
      if (submenu && submenu.classList.contains('api-nav-submenu')) {
        if (submenu.style.maxHeight === '0px' || !submenu.style.maxHeight) {
          submenu.style.maxHeight = submenu.scrollHeight + 'px';
        } else {
          submenu.style.maxHeight = '0px';
        }
      }
    });
  });
  
  console.log('Accordions initialized');
}

/**
 * Generates the table of contents in the right sidebar based on headings in content
 * @returns {void}
 */
function generateTableOfContents() {
  const content = document.querySelector('.api-content');
  const tocContainer = document.querySelector('.api-toc ul');
  
  if (!content || !tocContainer) {
    console.error('Could not find content or TOC container elements');
    return;
  }
  
  // Clear existing TOC
  tocContainer.innerHTML = '';
  
  // Find all headings in the content
  const headings = content.querySelectorAll('h1, h2, h3, h4');
  
  if (headings.length === 0) {
    console.warn('No headings found in content');
    return;
  }
  
  // Create TOC items
  headings.forEach(heading => {
    // Skip headings without ID
    const id = heading.getAttribute('id');
    if (!id) {
      console.warn('Heading without ID found:', heading.textContent);
      return;
    }

    // Extract title (without the permalink)
    const title = heading.textContent.replace(/#$/, '').trim();
    
    // Get heading level (h1 = 1, h2 = 2, etc.)
    const level = parseInt(heading.tagName.substring(1), 10);
    
    // Create list item with link
    const li = document.createElement('li');
    li.classList.add(`toc-level-${level}`);
    li.style.paddingLeft = `${(level - 1) * 15}px`;
    
    const a = document.createElement('a');
    a.href = `#${id}`;
    a.textContent = title;
    li.appendChild(a);
    
    tocContainer.appendChild(li);
  });
  
  console.log('TOC generated with', headings.length, 'items');
}

/**
 * Sets up scroll spy to highlight active TOC and navigation items based on scroll position
 * @returns {void}
 */
function setupScrollSpy() {
  const sections = document.querySelectorAll('[id].api-section, [id].api-heading');
  const navItems = document.querySelectorAll('.api-nav-item');
  const tocItems = document.querySelectorAll('.api-toc a');
  
  if (sections.length === 0) {
    console.warn('No sections with IDs found for scroll spy');
    return;
  }

  function highlightNavItem() {
    // Get current scroll position
    const scrollPosition = window.scrollY + 100; // Add offset
    
    // Find the current section
    let currentSectionId = null;
    
    // Iterate backwards to find the last section that starts before the current scroll position
    for (let i = sections.length - 1; i >= 0; i--) {
      const section = sections[i];
      if (section.offsetTop <= scrollPosition) {
        currentSectionId = section.getAttribute('id');
        break;
      }
    }
    
    if (!currentSectionId) {
      // If no section is found, use the first one
      if (sections.length > 0) {
        currentSectionId = sections[0].getAttribute('id');
      }
    }
    
    // Update navigation items
    if (currentSectionId) {
      // Highlight main nav items
      navItems.forEach(item => {
        const href = item.getAttribute('href');
        if (!href) return;
        
        // Extract the hash part
        const hashPart = href.includes('#') ? href.substring(href.indexOf('#') + 1) : '';
        
        if (hashPart === currentSectionId) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });
      
      // Highlight TOC items
      tocItems.forEach(item => {
        const href = item.getAttribute('href');
        if (!href) return;
        
        const hashPart = href.substring(1); // Remove the leading #
        
        if (hashPart === currentSectionId) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });
    }
  }

  // Set up scroll event listener
  window.addEventListener('scroll', highlightNavItem);
  
  // Initial highlight on page load
  setTimeout(highlightNavItem, 100);
  
  console.log('Scroll spy initialized');
}

/**
 * Sets up mobile-specific navigation behavior
 * @returns {void}
 */
function setupMobileNavigation() {
  // Check if we're on mobile
  const isMobile = window.innerWidth <= 768;
  
  if (!isMobile) {
    return;
  }
  
  // Add a button to toggle sidebar on mobile
  const sidebarToggle = document.createElement('button');
  sidebarToggle.className = 'api-sidebar-toggle';
  sidebarToggle.innerHTML = '☰ Menu';
  sidebarToggle.style.position = 'fixed';
  sidebarToggle.style.top = '10px';
  sidebarToggle.style.left = '10px';
  sidebarToggle.style.zIndex = '1000';
  
  sidebarToggle.addEventListener('click', function() {
    const sidebar = document.querySelector('.api-sidebar');
    if (sidebar) {
      sidebar.classList.toggle('mobile-visible');
    }
  });

  document.body.appendChild(sidebarToggle);
  
  console.log('Mobile navigation initialized');
}

/**
 * Sets up click functionality for permalink icons to copy the URL
 * @returns {void}
 */
function setupPermalinkCopying() {
  const permalinks = document.querySelectorAll('.permalink');
  
  if (permalinks.length === 0) {
    console.log('No permalink elements found');
    return;
  }

  permalinks.forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      const url = window.location.origin + window.location.pathname + this.getAttribute('href');

      // Copy to clipboard
      navigator.clipboard.writeText(url).then(() => {
        // Show a temporary tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'permalink-tooltip';
        tooltip.textContent = 'URL copied to clipboard!';
        tooltip.style.position = 'absolute';
        tooltip.style.background = '#333';
        tooltip.style.color = '#fff';
        tooltip.style.padding = '5px 10px';
        tooltip.style.borderRadius = '3px';
        tooltip.style.zIndex = '1000';
        
        document.body.appendChild(tooltip);

        // Position near the permalink
        const rect = this.getBoundingClientRect();
        tooltip.style.top = (rect.top + window.scrollY - 30) + 'px';
        tooltip.style.left = (rect.left + window.scrollX) + 'px';

        // Remove after 2 seconds
        setTimeout(() => {
          tooltip.remove();
        }, 2000);
      }).catch(err => {
        console.error('Failed to copy URL:', err);
      });
    });
  });
  
  console.log('Permalink copying initialized');
}