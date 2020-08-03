function checkWindowSize(){
    var w = document.documentElement.clientWidth;
    var panel = document.getElementById("help-panel");
    if (w < 978) {
        panel.style.position = "static";
        panel.style.width = "auto";
        panel.style.height = "auto";
        panel.style.overflowY = "hidden";
    } else {
        var changedToFixed = panel.style.position === "static";
        panel.style.position = "fixed";
        panel.style.width = w < 1184 ? "250px" : "275px";
        unfix();
        if (changedToFixed) {
            if (panel.offsetHeight >= 500) {
                panel.style.overflowY = "scroll";
                panel.style.height = "500px";
                panel.style.width = helpPanel.offsetWidth + 15 + "px";
            } else {
                panel.style.overflowY = "hidden";
                panel.style.height = "auto";
            }
        }
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
