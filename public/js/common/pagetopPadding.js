function checkIfPaddingNeeded() {
  if (window.location.pathname === '/'
    || window.location.pathname === '/home'
    || window.location.pathname === '/signInMobile'
    || window.location.pathname === '/signUpMobile') {
    document.body.style.paddingTop = '0px';
  }
}
