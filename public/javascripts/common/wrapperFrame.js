const iframe = document.getElementById('wrapper-frame');
const testUserBanner = document.querySelector('.test-server-banner');

function iframeURLChange(callback) {
    var unloadHandler = function () {
        iframe.style.display = "none";
        setTimeout(() => {
            callback(iframe.contentWindow.location.href);
        }, 0)
    };

    function attachUnload() {
        iframe.contentWindow.removeEventListener("unload", unloadHandler);
        iframe.contentWindow.addEventListener("unload", unloadHandler);
    }

    iframe.addEventListener("load", attachUnload);
    attachUnload();
}

function scaleIframeContent() {
    iframe.contentWindow.devicePixelRatio = 1;
    const iframeDocument = iframe.contentDocument || iframe.contentWindow.document;
    const contentElement = iframeDocument.querySelector('.tool-ui');

    if (contentElement) {
        const iframeWidth = window.innerWidth;
        const iframeHeight = window.innerHeight - 70 - (testUserBanner ? testUserBanner.clientHeight : 0);
        const contentWidth = contentElement.clientWidth;
        const contentHeight = contentElement.clientHeight + 100; // Add 100px for padding purposes.

        const scale = Math.min(iframeWidth / contentWidth, iframeHeight / contentHeight);
        
        iframe.style.transform = `scale(${scale})`;
        iframe.style.width = `${(1 / scale) * 100}vw`;
        iframe.style.height = `calc(${(1 / scale) * 100}vh - ${(1 / scale) * 70}px)`;
    }
}

iframe.addEventListener('load', scaleIframeContent);
window.addEventListener('resize', scaleIframeContent);

iframe.src = window.location.href;
const firstLoadEventListener = iframe.addEventListener("load", function() {
    iframeURLChange(function (newURL) {
        window.location.href = newURL;
    });
    iframe.removeEventListener("load", firstLoadEventListener)
});

setInterval(() => {
    window.scrollTo(0, 0);
    window.svl = iframe.contentWindow.svl;
    window.InitialMissionInstruction = iframe.contentWindow.InitialMissionInstruction;
}, 100)