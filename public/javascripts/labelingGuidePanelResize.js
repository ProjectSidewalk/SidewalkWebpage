/**
 * Call this function when the user re-sizes the window. Then, the first time the window width becomes too small
 * to hold the main content (<1185px), re-size the help panel to 250px instead of 275px. The second time the
 * width becomes too small (<978px), change the panel to just be static, full-width, and get rid of the
 * scrolling for the panel if it's there. When the window again becomes >=978px, change the panel back.
 */
function updateSidebarForWindowSize() {
    var w = document.documentElement.clientWidth;
    var smallWindowWidth = 978;
    var mediumWindowWidth = 1186;
    var expandedPanelHeight = 500;
    var smallPanelWidth = 250;
    var mediumPanelWidth = 275;
    var scrollbarWidth = 15;
    var panel = document.getElementById("help-panel");
    if (w < smallWindowWidth) {
        panel.style.position = "static";
        panel.style.width = "auto";
        panel.style.height = "auto";
        panel.style.overflowY = "hidden";
    } else {
        var changedToFixed = panel.style.position === "static";
        panel.style.position = "fixed";
        panel.style.width = w < mediumWindowWidth ? smallPanelWidth + "px" : mediumPanelWidth + "px";
        updateSidebarForScrollState();
        if (changedToFixed) {
            if (panel.offsetHeight >= expandedPanelHeight) {
                panel.style.overflowY = "scroll";
                panel.style.height = expandedPanelHeight + "px";
                panel.style.width = panel.offsetWidth + scrollbarWidth + "px";
            } else {
                panel.style.overflowY = "hidden";
                panel.style.height = "auto";
            }
        }
    }
}

/*
 * Call this function whenever the user scrolls. If the user scrolls so that the panel, remaining fixed,
 * would go into the filler below, change the panel's position to absolute.
 */
function updateSidebarForScrollState() {
    if (document.readyState === "complete") {
        var panelDistanceFromTop = 95;
        var footerHeight = document.getElementById("footer-container").offsetHeight;
        var infoFooterHeight = document.getElementById("info-footer").offsetHeight;
        var fillerHeight = document.getElementsByClassName("filler")[0].offsetHeight;
        var panel = document.getElementById("help-panel");
        if (panel.style.position !== "static") {
            var panelRect = panel.getBoundingClientRect();
            var yOffset = document.body.clientHeight - footerHeight - infoFooterHeight - fillerHeight
                    - panelRect.height - panelDistanceFromTop;
            if (window.pageYOffset > yOffset) {
                panel.style.top = "" + yOffset + "px";
                panel.style.position = "absolute";
            } else if (window.pageYOffset < yOffset) {
                panel.style.top = panelDistanceFromTop + "px";
                panel.style.position = "fixed";
            }
        }
    }
}

window.addEventListener("resize", updateSidebarForWindowSize);
window.addEventListener("scroll", updateSidebarForScrollState);

$(document).ready(function() {
    updateSidebarForWindowSize();
});
