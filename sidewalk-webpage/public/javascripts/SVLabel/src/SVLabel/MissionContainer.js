function MissionContainer (params) {
    var self = { className: "MissionContainer"},
        properties = {},
        missions = {};

    function _init (params) {
        // Define and initialize all the missions.
        params.missions;
        // For those missions with neighborhood ids, tie them corresponding neiborhood objects.
    }

    function getMission (id) {
        return id in missions ? missions[id] : null;
    }

    /** Return a list of neighborhood ids */
    function getMissionIds () {
        return Object.keys(missions).map(function (x) { return parseInt(x, 10); });
    }

    _init();
    return self;
}