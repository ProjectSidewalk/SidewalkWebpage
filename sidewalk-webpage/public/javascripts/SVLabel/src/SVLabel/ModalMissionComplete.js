/**
 * ModalMission module
 * @param $
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ModalMissionComplete ($, L) {
    var self = { className : 'ModalMissionComplete'},
        properties = {
            boxTop: 180,
            boxLeft: 45,
            boxWidth: 640
        };

    L.mapbox.accessToken = 'pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA';

    // Construct a bounding box for this map that the user cannot move out of
    // https://www.mapbox.com/mapbox.js/example/v1.0.0/maxbounds/
    var southWest = L.latLng(38.761, -77.262),
        northEast = L.latLng(39.060, -76.830),
        bounds = L.latLngBounds(southWest, northEast),
        map = L.mapbox.map('modal-mission-map', "kotarohara.8e0c6890", {
                maxBounds: bounds,
                maxZoom: 19,
                minZoom: 9
            })
            .fitBounds(bounds);

    function _init () {
        svl.ui.modalMission.background.on("click", handleBackgroundClick);
        svl.ui.modalMission.closeButton.on("click", handleCloseButtonClick);
    }

    function _updateNeighborhoodDistanceBarGraph(regionId, mission, unit) {
        if (!unit) unit = "kilometers";
        var completedTaskDistance = svl.taskContainer.getCompletedTaskDistance(regionId, unit),
            totalLineDistance = svl.taskContainer.totalLineDistanceInARegion(regionId, unit),
            missionDistance = mission.lineDistance(unit);

        if (completedTaskDistance && totalLineDistance && missionDistance) {
            console.debug("Update the visualization");
        }
    }

    /**
     * Get a property
     * @param key
     * @returns {null}
     */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Callback function for background click
     * @param e
     */
    function handleBackgroundClick(e) {
        hideMission();
    }

    /**
     * Callback function for button click
     * @param e
     */
    function handleCloseButtonClick(e) {
        hideMission();
    }

    /**
     * Hide a mission
     */
    function hideMission () {
        svl.ui.modalMission.holder.css('visibility', 'hidden');
        svl.ui.modalMission.foreground.css('visibility', "hidden");
        $(".leaflet-control-attribution").remove();
    }

    /** 
     * Show a mission
     */
    function show () {
        svl.ui.modalMission.holder.css('visibility', 'visible');
        svl.ui.modalMission.foreground.css('visibility', "visible");

        if ("neighborhoodContainer" in svl && svl.neighborhoodContainer) {
            var neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood();
            if (neighborhood) {
                // Focus on the current region on the map
                var center = neighborhood.center();
                neighborhood.addTo(map);
                if (center) {
                    map.setView([center.geometry.coordinates[1], center.geometry.coordinates[0]], 14);
                }

                // Update the horizontal bar chart to show how much distance the user has audited
                _updateNeighborhoodDistanceBarGraph(neighborhood.getProperty("regionId"), mission);
            }
        }
    }

    _init();

    self.show = show;
    return self;
}
