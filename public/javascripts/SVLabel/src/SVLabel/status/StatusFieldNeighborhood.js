function StatusFieldNeighborhood (uiStatus) {
    this.setAuditedDistance = function (distance) {
        uiStatus.auditedDistance.html(distance);
    };

    this.setLabelCount = function (count) {
        uiStatus.neighborhoodLabelCount.html(count);
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