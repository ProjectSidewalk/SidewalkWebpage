function hideBrowserVersionAlert() {
  document.getElementById('unsupported-browser-alert').classList.add('ps-invisible');
}

document.addEventListener('DOMContentLoaded', () => {
  if (!util.isChrome() && !util.isFirefox() && !util.isSafari()) {
    document.getElementById('unsupported-browser-alert').classList.remove('ps-invisible');
    document.getElementById('browser-warning-close').addEventListener('click', hideBrowserVersionAlert);
  }
}, false);
