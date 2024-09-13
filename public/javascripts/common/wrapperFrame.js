const iframe = document.getElementById('wrapperFrame');

function scaleIframeContent() {
    const iframeDocument = iframe.contentDocument || iframe.contentWindow.document;
    const contentElement = iframeDocument.querySelector('.tool-ui');

    if (contentElement) {
        const iframeWidth = window.innerWidth;
        const iframeHeight = window.innerHeight - 70;
        const contentWidth = contentElement.clientWidth;
        const contentHeight = iframeDocument.body.clientHeight + 90;

        const scale = Math.min(1, iframeWidth / contentWidth, iframeHeight / contentHeight);
        
        iframe.style.transform = `scale(${scale})`;
        iframe.style.width = `${(1 / scale) * 100}vw`;
        iframe.style.height = `calc(${(1 / scale) * 100}vh - ${(1 / scale) * 70}px)`;
    }
}

iframe.addEventListener('load', scaleIframeContent);
window.addEventListener('resize', scaleIframeContent);

iframe.src = window.location.href;