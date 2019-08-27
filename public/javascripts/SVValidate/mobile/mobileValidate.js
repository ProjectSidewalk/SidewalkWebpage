$(document).ready(function() {

    // Raleway doesn't load after being redirected from another page; redeclaring the font-face fixes that.
    let font = "<style> @@font-face{ font-family: 'raleway'; src: url('/assets/fonts/Raleway/Raleway-Regular.ttf');} </style>";
    $("head").append(font);

    // Adjusts html padding depending if the orientation of the phone is vertical or horizontal.
    function orientationCheck(){
        if(window.innerHeight > window.innerWidth){
            $('html').css('padding-top','10px');
        } else {
            $('html').css('padding-top','0px');
        }
    }

    window.addEventListener("resize", function() {
        orientationCheck();
    }, false);

    orientationCheck();

    resizeMobileValidation()
});

/**
 * Resizes html elements based on phone size.
 */
function resizeMobileValidation() {
    let h = window.innerHeight;
    let w = window.innerWidth;

    // Change validation button position.
    document.getElementById("validation-button-holder").style.top = h - 200 + "px";
    document.getElementById("validation-button-holder").style.width = w + "px";
    document.getElementById("validation-agree-button-0").style.width = w / 3 - 30 + "px";
    document.getElementById("validation-disagree-button-0").style.width = w / 3 - 30 + "px";
    document.getElementById("validation-not-sure-button-0").style.width = w / 3 - 30 + "px";
    // Scale progress bar.
    document.getElementById("status-current-mission-completion-bar").style.width = w + "px";
    document.getElementById("status-current-mission-completion-bar").style.width = w + "px";
    document.getElementById("status-current-mission-completion-rate").style.width = w + "px";
    // Resize button elements.
    document.getElementById("title-bar-holder").style.width = w + "px";
    document.getElementById("left-column-jump-button").style.left = w - 75 + "px";
    document.getElementById("info-button").style.left = w - 150 + "px";
    // Resize mission start popup.
    let modalForegrounds = document.getElementsByClassName("modal-foreground");
    for (let i = 0; i < modalForegrounds.length; i++) {
        modalForegrounds[i].style.width = w + "px";
        modalForegrounds[i].style.height = h + "px";
    }
    document.getElementById("ps-logo-mission").style.width = w - 70 + 'px';
    document.getElementById("ps-logo-mission-complete").style.width = w - 70 + 'px';
    // Resize modal info panel.
    let exampleImages = document.getElementsByClassName("example-image");
    for (let i = 0; i < exampleImages.length; i++) {
        exampleImages[i].style.width = w / 2 - 50 + "px";
        exampleImages[i].style.height = (w / 2 - 50) * (83 / 95) + "px";
    }
    let statusBoxes = document.getElementsByClassName("status-box");
    for (let i = 0; i < statusBoxes.length; i++) {
        statusBoxes[i].style.height = w * (83 / 95) / 2 + 20 + "px";
    }
    document.getElementById("modal-info-close-button").style.left = w - 75 + "px";

    // If you need to do functional testing without a phone, enable this code to test using Chrome's inspection tool.
    // document.getElementById("validation-button-holder").style.top = h - 1500 + "px";
    // document.getElementById("validation-button-holder").style.width = w + "px";
    // document.getElementById("validation-agree-button-0").style.width = w/5-30 + "px";
    // document.getElementById("validation-disagree-button-0").style.width = w/5-30 + "px";
    // document.getElementById("validation-not-sure-button-0").style.width = w/5-30 + "px";
    // document.getElementById("left-column-jump-button").style.left = w - 600 + "px";
    // document.getElementById("info-button").style.left = w - 700 + "px";
}
