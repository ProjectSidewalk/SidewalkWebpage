function NeighborhoodStatus () {
    var self = {className: "NeighborhoodStatus"};

    function setAuditedDistance(distance) {
        svl.ui.progress.auditedDistance.html(distance);
    }

    function setLabelCount(count) {
        svl.ui.status.neighborhoodLabelCount.html(count);
    }

    function setNeighborhoodName(name) {
        svl.ui.status.neighborhoodName.html(name + ", ");
    }

    /**
     * Set the href attribute of the link
     * @param hrefString
     */
    function setHref(hrefString) {
        if (svl.ui.status.neighborhoodLink) {
            svl.ui.status.neighborhoodLink.attr("href", hrefString)
        }
    }

    self.setAuditedDistance = setAuditedDistance;
    self.setLabelCount = setLabelCount;
    self.setHref = setHref;
    self.setNeighborhoodName = setNeighborhoodName;
    return self;
}