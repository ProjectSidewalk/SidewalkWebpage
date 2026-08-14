function checkIfPaddingNeeded() {
  if (window.location.pathname === '/'
    || window.location.pathname === '/home') {
    document.body.style.paddingTop = '0px';
  }
}
