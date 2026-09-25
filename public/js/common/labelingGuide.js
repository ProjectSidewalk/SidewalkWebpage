/** Labeling guide pages: fills the "On this page" box, adds the phone-width nav toggle, and the image lightbox. */
util.onDomReady(() => {
  const toc = document.querySelector('.page-toc');
  const questions = document.querySelectorAll('.page-content h2[id]');
  for (const question of questions) {
    const link = document.createElement('a');
    link.href = `#${question.id}`;
    link.textContent = question.firstChild.textContent.trim();
    const item = document.createElement('li');
    item.append(link);
    toc.querySelector('ul').append(item);
  }
  toc.hidden = questions.length === 0;

  initSidebarDisclosure();
  new ImageLightbox('.page-content figure img');
});
