util.onDomReady(() => {
  const subtopicsList = document.getElementById('subtopics-list');
  for (const question of document.querySelectorAll('h3.question')) {
    question.classList.add('subtopic');
    subtopicsList.insertAdjacentHTML('beforeend', `<li><a href="#${question.id}">${question.textContent}</a></li>`);
  }

  new ImageLightbox('.help img.img-responsive');

  /**
   * If the panel is a sidebar (when window width >= 978px), make the panel scrollable when the user presses the plus,
   * and not scrollable when the user presses the minus.
   */
  const plusMinusButtons = document.querySelectorAll('.plusminus');
  for (const button of plusMinusButtons) {
    button.addEventListener('click', () => {
      button.classList.toggle('active');

      const w = document.documentElement.clientWidth;
      const smallWindowWidth = 978;
      const scrollbarWidth = 15;
      const panel = document.getElementById('subtopics');
      const helpPanel = document.getElementById('help-panel');
      if (panel.style.maxHeight) {
        panel.style.maxHeight = null;
        for (const b of plusMinusButtons) b.textContent = '+';
        helpPanel.classList.add('not-scrollable');
        helpPanel.classList.remove('scrollable');
        if (w >= smallWindowWidth) {
          helpPanel.style.width = `${helpPanel.offsetWidth - scrollbarWidth}px`;
        }
      } else {
        panel.style.maxHeight = `${panel.scrollHeight + 100}px`;
        for (const b of plusMinusButtons) b.textContent = '-';
        if (w >= smallWindowWidth) {
          helpPanel.classList.add('scrollable');
          helpPanel.classList.remove('not-scrollable');
          updateSidebarForScrollState();
          helpPanel.style.width = `${helpPanel.offsetWidth + scrollbarWidth}px`;
        } else {
          helpPanel.classList.add('not-scrollable');
          helpPanel.classList.remove('scrollable');
        }
      }
    });
  }
});
