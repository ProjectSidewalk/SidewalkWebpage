/**
 * Class that logs information from the Validation interface
 * @returns {Tracker}
 * @constructor
 */
function Tracker() {
    var self = this;
    var actions = [];
    var prevActions = [];

    /**
     * Pushes action type, time stamp, current pov, and current panoId into actions list.
     * @param action
     * @param notes
     * @param extraData
     * @private
     */
    function _createAction(action, notes, extraData) {

    }

    function compileSubmissionData() {

    }

    /**
     * Pushes information to action list (to be submitted to the database)
     * @param action    (required) Action
     * @param notes     (optional) Notes, logged in the notes field
     * @param extraData (optional) Extra data that should not be stored in the db notes field
     */
    function push(action, notes, extraData) {
        // var item = _createAction(action, notes, extraData);
        // actions.push(item);

        svv.form.submit(action, true);
    }

    /**
     * Submits data from the Tracker to the backend
     */
    function submitForm() {

    }

    self.push = push;
    self.submitForm = submitForm;

    return this;
}