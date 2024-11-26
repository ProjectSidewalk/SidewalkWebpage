const PERCENT_VERTICAL_PADDING = 5

// These offsets are in terms of iframe context pixels, not the current page pixels.
const PADDING_OFFSETS_PX = {
    "/explore": 13,
    "/validate": 28,
    "/newValidateBeta": 35
}

const iframe = document.getElementById('wrapper-frame');

// Get the element for the dev environment warning.
const testServerBanner = document.querySelector('.test-server-banner');

// Define a function 'iframeURLChange' that takes a callback to execute when the iframe's URL changes.
function iframeURLChange(callback) {
    
    // Define a function 'unloadHandler' that will be called when the iframe's content is unloaded.
    var unloadHandler = function () {
        
        // Hide the iframe by setting its display to "none".
        iframe.style.display = "none";
        
        // Call the callback with the new iframe URL after a brief delay (0ms, to ensure execution timing).
        setTimeout(() => {
            callback(iframe.contentWindow.location.href);
        }, 0);
    };

    // Define a function 'attachUnload' to add or replace the 'unload' event listener on the iframe's content window.
    function attachUnload() {
        // First, remove any existing 'unload' event listener to prevent duplication.
        iframe.contentWindow.removeEventListener("unload", unloadHandler);
        
        // Add 'unload' event listener to the iframe's content window to call 'unloadHandler' when the content unloads.
        iframe.contentWindow.addEventListener("unload", unloadHandler);
    }

    // Attach the unload event when the iframe finishes loading.
    iframe.addEventListener("load", attachUnload);
    
    // Immediately call 'attachUnload' in case the content has already loaded.
    attachUnload();
}

// Define a function 'scaleIframeContent' to adjust the iframe content's scale to fit within the window.
function scaleIframeContent() {
    // Set the device pixel ratio to 1 to avoid pixelation issues with Google Street View.
    iframe.contentWindow.devicePixelRatio = 1;
    
    // Access the document inside the iframe.
    const iframeDocument = iframe.contentDocument || iframe.contentWindow.document;
    
    // Find the element inside the iframe with the class 'tool-ui', which is the content to be scaled.
    const contentElement = iframeDocument.querySelector('.tool-ui');

    // Check if the content element exists before proceeding.
    if (contentElement) {
        
        // Get the width & height of the window (excluding 70px for fixed elements like navbar or the dev env warning).
        const iframeWidth = window.innerWidth;
        const iframeHeight = window.innerHeight - 70 - (testServerBanner ? testServerBanner.clientHeight : 0);
        
        // Get the width & height of the content inside the iframe.
        const contentWidth = contentElement.clientWidth;
        const contentHeight = contentElement.clientHeight + iframeHeight * (PERCENT_VERTICAL_PADDING / 100) * 2
             - PADDING_OFFSETS_PX[window.location.pathname];
        iframe.style.paddingTop = iframeHeight * (PERCENT_VERTICAL_PADDING / 100) - PADDING_OFFSETS_PX[window.location.pathname] + "px"

        // Calculate the scale factor based on the smallest ratio between available window size and content size.
        const scale = Math.min(iframeWidth / contentWidth, iframeHeight / contentHeight);
        
        // Apply the scaling transformation to the iframe based on the calculated scale factor.
        iframe.style.transform = `scale(${scale})`;
        
        // Adjust the iframe's width and height to scale the content correctly.
        iframe.style.width = `${(1 / scale) * 100}vw`;
        iframe.style.height = `calc(${(1 / scale) * 100}vh - ${(1 / scale) * 70}px)`;
    }
}

// Attach the 'scaleIframeContent' function to the 'load' event on the iframe.
iframe.addEventListener('load', scaleIframeContent);

// Attach the 'scaleIframeContent' function to the 'resize' event on the window to resize the iframe when the window size changes.
window.addEventListener('resize', scaleIframeContent);

// Set the source of the iframe to the current window's URL.
iframe.src = window.location.href;

// Add an event listener for the iframe's 'load' event, to detect when the iframe's content finishes loading.
const firstLoadEventListener = iframe.addEventListener("load", function() {
    
    // Call the 'iframeURLChange' function to handle URL changes, and update the window location with the new URL.
    iframeURLChange(function (newURL) {
        window.location.href = newURL;
    });
    
    // Remove this event listener after the first load event to prevent redundant calls.
    iframe.removeEventListener("load", firstLoadEventListener);
});

setInterval(() => {    
    // This line is needed to lock the scroll to the top in rare cases where it can get messed up.
    window.scrollTo(0, 0);
    
    // Passthrough the 'svl'/'svv' variables from the iframe's window object into the main window object.
    if (iframe.contentWindow.svl) window.svl = iframe.contentWindow.svl;
    if (iframe.contentWindow.svv) window.svv = iframe.contentWindow.svv;
    
    // Passthrough the 'InitialMissionInstruction' variable from the iframe's window object into the main window object.
    window.InitialMissionInstruction = iframe.contentWindow.InitialMissionInstruction;
}, 100);
