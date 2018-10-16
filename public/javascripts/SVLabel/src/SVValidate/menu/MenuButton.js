/**
 * Responsible for Yes/No/Unclear buttons
 * @constructor
 */
function MenuButton(validationButton) {
    var agreeButton = validationButton.find('#validation-agree-button');

    validationButton.click(function() {
        console.log("Button clicked");
    });

    agreeButton.click(function() {
        console.log("Agree button clicked");
    });
}