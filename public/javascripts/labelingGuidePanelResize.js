function checkWindowSize(){
    var w = document.documentElement.clientWidth;
    var panel = document.getElementById("help-panel");
    if (w < 978) {
        panel.style.position = "static";
        panel.style.width = "auto";
    } else if (w >= 978 && w < 1184) {
        panel.style.position = "fixed";
        panel.style.width = "250px";
        unfix();
    } else {
        panel.style.position = "fixed";
        panel.style.width = "275px";
        unfix();
    }
}

function unfix() {
    if (document.readyState === "complete") {
        var panel = document.getElementById("help-panel");
        if (panel.style.position !== "static") {
            var panelRect = panel.getBoundingClientRect();
            var yOffset = document.body.clientHeight - 600 - panelRect.height - 95;
            if (window.pageYOffset > yOffset) {
                panel.style.top = "" + yOffset + "px";
                panel.style.position = "absolute";
            } else if (window.pageYOffset < yOffset) {
                panel.style.top = "95px";
                panel.style.position = "fixed";
            }
        }
    }
}

window.addEventListener("resize", checkWindowSize);
window.addEventListener("scroll", unfix);

$(document).ready(function() {
    checkWindowSize();
});