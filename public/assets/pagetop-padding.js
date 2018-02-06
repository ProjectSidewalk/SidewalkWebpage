function checkIfPaddingNeeded(){
    if(window.location.pathname === "/faq" || window.location.pathname === "/admin" ||
        window.location.pathname === "/labelingGuide" || window.location.pathname === "/curbRamps" ||
        window.location.pathname === "/surfaceProblems" || window.location.pathname === "/obstacles" ||
        window.location.pathname === "/noSidewalk" || window.location.pathname === "/occlusion" ||
        window.location.pathname === "/graveyard"){

        document.body.style.paddingTop = "60px";
    }
}