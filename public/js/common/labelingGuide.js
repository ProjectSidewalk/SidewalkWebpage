/** Labeling guide: lists the page's questions in the sidebar, and sets up the phone menu and image zoom. */
util.onDomReady(() => {
  const links = [...document.querySelectorAll('.page-content h2[id]')].map((question) => {
    const link = document.createElement('a');
    link.href = `#${question.id}`;
    link.className = 'page-nav-subitem';
    link.textContent = question.textContent.replace(/#$/, '').trim();
    return link;
  });
  document.querySelector('.page-nav-item.active').after(...links);

  initSidebarDisclosure();
  new ImageLightbox('.page-content figure img');
});
