/**
 * Responsible for Yes/No/Unclear buttons
 * @constructor
 */
function MenuButton(menuUI, form) {

    menuUI.agreeButton.click(function() {
        console.log("Agree button clicked");
        // bogus values
        var data = {
            "label_id" : 1,
            "validation_task_id" : 39,
            "label_validation_id" : 1
        };
        form.submit(data, true);
    });

    menuUI.disagreeButton.click(function() {
        console.log("Disagree button clicked");
        // bogus values
        var data = {
            "label_id" : 2,
            "validation_task_id" : 42,
            "label_validation_id" : 2,
        };
        form.submit(data, true);
    });

    menuUI.unclearButton.click(function() {
        console.log("Unclear button clicked");
        // bogus values
        var data = {
            "label_id" : 3,
            "validation_task_id": 53,
            "label_validation_id": 3
        };
        form.submit(data, true);
    });
}