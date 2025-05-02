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
  setupSmoothScrolling();
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

  tocContainer.innerHTML = '';
  const headings = content.querySelectorAll('h1, h2, h3, h4, h5, h6'); // Assuming you want H5/H6 included now

  if (headings.length === 0) {
    console.warn('No headings found in content');
    // Optionally hide the TOC container if empty
    // const tocWrapper = document.querySelector('.api-toc');
    // if (tocWrapper) tocWrapper.style.display = 'none';
    return;
  }

  let headingsAdded = 0; // Counter for added items
  headings.forEach(heading => {
    const id = heading.getAttribute('id');
    if (!id) {
      // console.warn('Heading without ID found:', heading.textContent); // Keep this if you want warnings
      return; // Skip if no ID
    }

    const title = heading.textContent.replace(/#$/, '').trim();
    const level = parseInt(heading.tagName.substring(1), 10);

    const li = document.createElement('li');
    // Add the class based on the heading level
    li.classList.add(`toc-level-${level}`);

    const a = document.createElement('a');
    a.href = `#${id}`;
    a.textContent = title;
    li.appendChild(a);
    tocContainer.appendChild(li);
    headingsAdded++; // Increment counter
  });

  // Updated log message
  console.log(`TOC generated: ${headingsAdded} items added from ${headings.length} headings found.`);

  // Optionally hide TOC if no items were added after filtering
  // if (headingsAdded === 0) {
  //   const tocWrapper = document.querySelector('.api-toc');
  //   if (tocWrapper) tocWrapper.style.display = 'none';
  // }
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
 * Sets up smooth scrolling for TOC links
 * @returns {void}
 */
function setupSmoothScrolling() {
  const tocContainer = document.querySelector('.api-toc');
  if (!tocContainer) return;

  tocContainer.addEventListener('click', function(event) {
    // Check if the clicked element is an anchor link inside the TOC
    const link = event.target.closest('a');
    if (!link || !link.getAttribute('href').startsWith('#')) {
      return; // Exit if it's not an internal anchor link
    }

    event.preventDefault(); // Prevent the default jump behavior

    const targetId = link.getAttribute('href').substring(1); // Get ID from href (remove #)
    const targetElement = document.getElementById(targetId);

    if (targetElement) {
      // Calculate offset if you have a fixed header
      const headerHeight = 50; // Adjust this to your actual fixed header height (from :root --header-height)
      const elementPosition = targetElement.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.scrollY - headerHeight - 10; // Add extra 10px padding

      // Use window.scrollTo for better control with fixed header offset
      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });

      // Alternatively, simpler method (might not perfectly account for fixed header):
      // targetElement.scrollIntoView({
      //   behavior: 'smooth',
      //   block: 'start' // Align to top
      // });

      // Optional: Update URL hash without jumping (improves back button behavior)
      // if (history.pushState) {
      //    history.pushState(null, null, `#${targetId}`);
      // } else {
      //    location.hash = `#${targetId}`; // Fallback
      // }

    } else {
      console.warn(`Smooth scroll target element not found for id: ${targetId}`);
    }
  });
  console.log('Smooth scrolling for TOC initialized');
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