function hideBrowserVersionAlert() {
    document.getElementById('unsupported-browser-alert').style.visibility = 'hidden';
}

document.addEventListener('DOMContentLoaded', () => {
    if (!util.isChrome() && !util.isFirefox() && !util.isSafari()) {
        document.getElementById('unsupported-browser-alert').style.visibility = 'visible';
        document.getElementById('browser-warning-close').addEventListener('click', hideBrowserVersionAlert);
    }
}, false);
