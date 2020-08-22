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
        $("#help-panel").addClass("not-sidebar").removeClass("sidebar").removeClass("stuck-sidebar");
        $("#help-panel").addClass("not-scrollable").removeClass("scrollable");
        panel.style.width = "auto";
    } else {
        var changedToFixed = $("#help-panel").hasClass("not-sidebar");
        $("#help-panel").addClass("sidebar").removeClass("not-sidebar").removeClass("stuck-sidebar");
        panel.style.width = w < mediumWindowWidth ? smallPanelWidth + "px" : mediumPanelWidth + "px";
        updateSidebarForScrollState();
        if (changedToFixed) {
            if (panel.offsetHeight >= expandedPanelHeight) {
                $("#help-panel").addClass("scrollable").removeClass("not-scrollable");
                panel.style.width = panel.offsetWidth + scrollbarWidth + "px";
            } else {
                $("#help-panel").addClass("not-scrollable").removeClass("scrollable");
            }
        }
    }
}

/*
 * Call this function whenever the user scrolls. If the user scrolls so that the panel, remaining fixed (sidebar),
 * would go into the filler below, change the panel's position to absolute (stuck-sidebar).
 */
function updateSidebarForScrollState() {
    if (document.readyState === "complete") {
        var panelDistanceFromTop = 95;
        var footerHeight = document.getElementById("footer-container").offsetHeight;
        var infoFooterHeight = document.getElementById("info-footer").offsetHeight;
        var fillerHeight = document.getElementsByClassName("filler")[0].offsetHeight;
        var panel = document.getElementById("help-panel");
        if (!$("#help-panel").hasClass("not-sidebar")) {
            var panelRect = panel.getBoundingClientRect();
            var yOffset = document.body.clientHeight - footerHeight - infoFooterHeight - fillerHeight
                    - panelRect.height - panelDistanceFromTop;
            if (window.pageYOffset > yOffset) {
                panel.style.top = "" + yOffset + "px";
                $("#help-panel").addClass("stuck-sidebar").removeClass("sidebar").removeClass("not-sidebar");
            } else if (window.pageYOffset < yOffset) {
                panel.style.top = panelDistanceFromTop + "px";
                $("#help-panel").addClass("sidebar").removeClass("stuck-sidebar").removeClass("not-sidebar");
            }
        }
    }
}

window.addEventListener("resize", updateSidebarForWindowSize);
window.addEventListener("scroll", updateSidebarForScrollState);

$(document).ready(function() {
    updateSidebarForWindowSize();
});
