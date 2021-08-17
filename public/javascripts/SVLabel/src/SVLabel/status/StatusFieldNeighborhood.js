function StatusFieldNeighborhood (neighborhoodModel, statusModel, userModel, uiStatus) {
    var self = this;
    this._neighborhoodModel = neighborhoodModel;
    this._statusModel = statusModel;
    this._userModel = userModel;

    this._statusModel.on("StatusFieldNeighborhood:setHref", function (href) {
        self.setHref(href);
    });

    this._neighborhoodModel.on("NeighborhoodContainer:neighborhoodChanged", function (parameters) {
        var newNeighborhood = parameters.newNeighborhood;
        self.setNeighborhoodName(newNeighborhood.getProperty("name"));

        var user = self._userModel.getUser();
        if (user && user.getProperty("role") != "Anonymous") {
            var href = "/dashboard/" + "?regionId=" + newNeighborhood.getProperty("regionId");
            self.setHref(href);
        }
    });

    this.setAuditedDistance = function (distance) {
        uiStatus.auditedDistance.html(distance);
        ResizeStatusText(uiStatus);
    };

    this.setLabelCount = function (count) {
        uiStatus.neighborhoodLabelCount.html(count);
        ResizeStatusText(uiStatus);
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

// prevent status-row from having line breaks by decreasing text size
function ResizeStatusText(uiStatus){
    var totalLength = uiStatus.auditedDistance.html().length + uiStatus.neighborhoodLabelCount.html().length;
    if (totalLength >= 9) {
        uiStatus.statusRow.css('font-size','10px');
    }
    else if (totalLength >= 7) {
        uiStatus.statusRow.css('font-size','12px');
    }
    else {
        uiStatus.statusRow.css('font-size','14px');        
    }
}