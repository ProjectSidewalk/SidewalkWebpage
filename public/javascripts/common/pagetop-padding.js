function checkIfPaddingNeeded(){
    if(window.location.pathname === "/faq" ||
        window.location.pathname === "/admin" ||
        window.location.pathname === "/results" ||
        window.location.pathname === "/labelingGuide" ||
        window.location.pathname === "/labelingGuide/curbRamps" ||
        window.location.pathname === "/labelingGuide/surfaceProblems" ||
        window.location.pathname === "/labelingGuide/obstacles" ||
        window.location.pathname === "/labelingGuide/noSidewalk" ||
        window.location.pathname === "/labelingGuide/occlusion"){

        document.body.style.paddingTop = "60px";
    } else if (window.location.pathname === "/signInMobile" || window.location.pathname === "/signUpMobile") {
        document.body.style.paddingTop = "0px";
    }
}
