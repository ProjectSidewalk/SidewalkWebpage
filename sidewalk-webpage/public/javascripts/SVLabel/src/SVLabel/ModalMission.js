var svl = svl || {};

function ModalMission ($) {
    var self = { className : 'ModalMission'},
        properties = {
            boxTop: 180,
            boxLeft: 45,
            boxWidth: 640
        };

    function _init () {
    }

    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Hide a mission
     */
    function hideMission () {
        svl.ui.modalMission.holder.addClass('hidden');
        svl.ui.modalMission.box.css({
            top: getProperty("boxTop"),
            left: getProperty("boxLeft"),
            width: getProperty("boxWidth")
        })
    }

    /** Show a mission */
    function showMission () {
        svl.ui.modalMission.holder.removeClass('hidden');
    }

    /**
     *
     * @param mission String The type of the mission. It could be one of "initial-mission" and "area-coverage".
     */
    function setMission (mission, parameters) {
        svl.ui.modalMission.box.html($("template.missions[val='" + mission + "']").html());

        if (parameters) {
            if ("modal-mission-area-coverage-left-column-image-src" in parameters) {
                var image = "<img src='" + parameters["modal-mission-area-coverage-left-column-image-src"] + "' class='center-block modal-mission-left-column-images' alt='Area coverage mission icon' />";
                $("#modal-mission-area-coverage-left-column").html(image);
            }

            if ("modal-mission-area-coverage-rate" in parameters) {
                $("#modal-mission-area-coverage-rate").text(parameters["modal-mission-area-coverage-rate"]);
            }

            if ("mission_completion_message" in parameters) {
                console.debug(parameters.mission_completion_message);
            }
        }

        if (parameters && "callback" in parameters) {
            $("#modal-mission-holder .ok-button").on("click", parameters.callback);
        } else {
            $("#modal-mission-holder .ok-button").on("click", hideMission);
        }

        showMission();
    }

    _init();

    //self.showMission = showMission;
    //self.hideMission = hideMission;
    self.setMission = setMission;
    return self;
}
