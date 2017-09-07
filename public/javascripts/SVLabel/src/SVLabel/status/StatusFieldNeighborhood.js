function StatusFieldNeighborhood (neighborhoodModel, statusModel, userModel, uiStatus) {
    var self = this;
    this._routeModel = neighborhoodModel;
    this._statusModel = statusModel;
    this._userModel = userModel;

    this._statusModel.on("StatusFieldNeighborhood:setHref", function (href) {
        self.setHref(href);
    });

    this._routeModel.on("NeighborhoodContainer:neighborhoodChanged", function (parameters) {
        var newNeighborhood = parameters.newNeighborhood;
        self.setNeighborhoodName(newNeighborhood.getProperty("name"));

        var user = self._userModel.getUser();
        if (user && user.getProperty("username") != "anonymous") {
            var href = "/contribution/" + user.getProperty("username") + "?regionId=" + newNeighborhood.getProperty("regionId");
            self.setHref(href);
        }
    });

    this.setAuditedDistance = function (distance) {
        uiStatus.auditedDistance.html(distance);
    };

    this.setLabelCount = function (count) {
        uiStatus.neighborhoodLabelCount.html(count);
    };

    this.setMissionCount = function (numMissions, totalMissionCount) {
        uiStatus.missionCounter.html(numMissions+" out of "+totalMissionCount+" missions completed");
    };


    /**
     * Set the href attribute of the link
     * @param hrefString
     */
    this.setHref = function (hrefString) {
        if (uiStatus.neighborhoodLink) {
            uiStatus.neighborhoodLink.attr("href", hrefString)
        }
    };

    this.setNeighborhoodName = function (name) {
        uiStatus.neighborhoodName.html(name + ", ");
    };
}