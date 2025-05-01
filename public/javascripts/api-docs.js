/**
 * Project Sidewalk API Documentation JavaScript
 * 
 * This script handles the interactive features of the API documentation page:
 * - Accordion navigation in the sidebar
 * - Scroll spy to highlight active sections
 * - Dynamic TOC generation for right sidebar
 * - Mobile responsiveness
 */

document.addEventListener('DOMContentLoaded', function () {
  initializeAccordions();
  setupScrollSpy();
  generateTableOfContents();
  setupMobileNavigation();
  setupPermalinkCopying();
});

/**
* Initializes accordion functionality for the sidebar navigation
* The template already sets up the initial open/closed state based on the active page
*/
function initializeAccordions() {
  const accordions = document.querySelectorAll('.api-nav-accordion');

  accordions.forEach(accordion => {
    // Skip setup for the active accordion as it's already open
    if (!accordion.classList.contains('active')) {
      // Make sure the submenu is initially closed
      const submenu = accordion.nextElementSibling;
      submenu.style.maxHeight = null;
    }

    // Add click event listener
    accordion.addEventListener('click', function (e) {
      this.classList.toggle('active');
      const submenu = this.nextElementSibling;

      if (submenu.style.maxHeight) {
        submenu.style.maxHeight = null;
      } else {
        submenu.style.maxHeight = submenu.scrollHeight + "px";
      }
    });
  });
}

/**
* Sets up scroll spy to highlight active navigation items based on scroll position
*/
function setupScrollSpy() {
  const sections = document.querySelectorAll('.api-section');
  const navItems = document.querySelectorAll('.api-nav-item');

  function highlightNavItem() {
    let scrollPosition = window.scrollY;
    let currentSection = null;

    // Find the current section based on scroll position
    sections.forEach(section => {
      const sectionTop = section.offsetTop - 100;
      const sectionBottom = sectionTop + section.offsetHeight;

      if (scrollPosition >= sectionTop && scrollPosition < sectionBottom) {
        currentSection = section.getAttribute('id');
      }
    });

    // Highlight the corresponding nav item
    if (currentSection) {
      // First, handle items in the main navigation
      navItems.forEach(item => {
        const href = item.getAttribute('href');

        // Skip items that link to other pages
        if (!href || !href.includes('#')) return;

        // Extract the hash part for navigation items that may link to other pages with hash
        const hashPart = href.includes('#') ? href.substring(href.indexOf('#') + 1) : '';

        // Remove active class from all items first
        if (hashPart !== currentSection) {
          item.classList.remove('active');
        }

        // Add active class to matching item
        if (hashPart === currentSection) {
          item.classList.add('active');

          // If this is a submenu item, make sure its parent accordion is open
          if (item.classList.contains('api-nav-subitem')) {
            const parentSubmenu = item.parentElement;
            const parentAccordion = parentSubmenu.previousElementSibling;

            if (parentAccordion && parentAccordion.classList.contains('api-nav-accordion')) {
              parentAccordion.classList.add('active');
              parentSubmenu.style.maxHeight = parentSubmenu.scrollHeight + "px";
            }
          }
        }
      });

      // Also highlight TOC items
      const tocItems = document.querySelectorAll('.api-toc a');
      tocItems.forEach(item => {
        const href = item.getAttribute('href');
        if (href && href.substring(1) === currentSection) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });
    }
  }

  window.addEventListener('scroll', highlightNavItem);

  // Initial highlight on page load
  setTimeout(highlightNavItem, 100);
}

/**
* Generates the table of contents in the right sidebar based on headings in content
*/
function generateTableOfContents() {
  const content = document.querySelector('.api-content');
  const toc = document.querySelector('.api-toc ul');

  if (!content || !toc) return;

  // Clear existing TOC
  toc.innerHTML = '';

  // Find all headings in the content
  const headings = content.querySelectorAll('h1, h2, h3, h4');

  // Create TOC structure
  let prevLevel = 1;
  let listStack = [toc];

  headings.forEach(heading => {
    // Skip headings without ID
    const id = heading.getAttribute('id');
    if (!id) return;

    // Extract title (without the permalink)
    const title = heading.textContent.replace(/#$/, '').trim();

    // Get heading level (h1 = 1, h2 = 2, etc.)
    const level = parseInt(heading.tagName.substr(1));

    // Create list item with link
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#' + id;
    a.textContent = title;
    li.appendChild(a);

    // Handle indentation based on heading level
    if (level > prevLevel) {
      // Create a new sublist
      const ul = document.createElement('ul');
      listStack[listStack.length - 1].lastChild.appendChild(ul);
      listStack.push(ul);
      ul.appendChild(li);
    } else if (level < prevLevel) {
      // Go back up the hierarchy
      for (let i = 0; i < prevLevel - level; i++) {
        listStack.pop();
      }
      listStack[listStack.length - 1].appendChild(li);
    } else {
      // Same level as previous
      listStack[listStack.length - 1].appendChild(li);
    }

    prevLevel = level;
  });
}

/**
* Sets up mobile-specific navigation behavior
*/
function setupMobileNavigation() {
  const navbarToggle = document.querySelector('.navbar-toggle');

  if (navbarToggle) {
    navbarToggle.addEventListener('click', function () {
      const sidebar = document.querySelector('.api-sidebar');
      if (sidebar) {
        sidebar.classList.toggle('mobile-visible');
      }
    });
  }

  // Add a button to toggle sidebar on mobile
  if (window.innerWidth <= 768) {
    const sidebarToggle = document.createElement('button');
    sidebarToggle.className = 'api-sidebar-toggle';
    sidebarToggle.innerHTML = '☰ Menu';
    sidebarToggle.addEventListener('click', function () {
      const sidebar = document.querySelector('.api-sidebar');
      sidebar.classList.toggle('mobile-visible');
    });

    const apiContainer = document.querySelector('.api-container');
    if (apiContainer) {
      apiContainer.insertBefore(sidebarToggle, apiContainer.firstChild);
    }
  }
}

/**
* Sets up click functionality for permalink icons to copy the URL
*/
function setupPermalinkCopying() {
  const permalinks = document.querySelectorAll('.permalink');

  permalinks.forEach(link => {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      const url = window.location.origin + window.location.pathname + this.getAttribute('href');

      // Copy to clipboard
      navigator.clipboard.writeText(url).then(() => {
        // Show a temporary tooltip or notification
        const tooltip = document.createElement('div');
        tooltip.className = 'permalink-tooltip';
        tooltip.textContent = 'URL copied to clipboard!';
        document.body.appendChild(tooltip);

        // Position near the permalink
        const rect = this.getBoundingClientRect();
        tooltip.style.top = (rect.top + window.scrollY - 30) + 'px';
        tooltip.style.left = (rect.left + window.scrollX) + 'px';

        // Remove after 2 seconds
        setTimeout(() => {
          tooltip.remove();
        }, 2000);
      });
    });
  });
}