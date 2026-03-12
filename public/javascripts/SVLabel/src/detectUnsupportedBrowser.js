function hideBrowserVersionAlert(){
    document.getElementById('unsupported-browser-alert').style.visibility = 'hidden';
}

document.addEventListener('DOMContentLoaded', function() {
    if (!bowser.chrome && !bowser.firefox && !bowser.safari) {
        document.getElementById('unsupported-browser-alert').style.visibility = 'visible';
        document.getElementById('page-alert-close').addEventListener('click', hideBrowserVersionAlert);
    }
}, false);
