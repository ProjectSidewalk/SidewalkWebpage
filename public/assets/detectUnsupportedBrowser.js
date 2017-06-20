function hideBrowserVersionAlert(){
    document.getElementById("unsupported-browser-alert").style.visibility="hidden";
}

document.addEventListener('DOMContentLoaded', function() {

    if(!bowser.chrome){
        document.getElementById("unsupported-browser-alert").style.visibility="visible";
    }
}, false);
