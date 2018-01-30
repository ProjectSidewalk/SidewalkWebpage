function checkIfPaddingNeeded(){
    if(window.location.pathname === "/faq" || window.location.pathname === "/admin" ||
        window.location.pathname === "/labelingGuide" || window.location.pathname === "/curbRamps" ||
        window.location.pathname === "/surfaceProblems" || window.location.pathname === "/obstacles"){

        document.body.style.paddingTop = "60px";
    }
}