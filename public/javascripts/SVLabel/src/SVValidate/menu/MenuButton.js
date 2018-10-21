/**
 * Responsible for Yes/No/Unclear buttons
 * @constructor
 */
function MenuButton(menuUI) {

    menuUI.agreeButton.click(function() {
        console.log("Agree button clicked");
    });

    menuUI.disagreeButton.click(function() {
        console.log("Disagree button clicked");
    });

    menuUI.unclearButton.click(function() {
        console.log("Unclear button clicked");
    });
}