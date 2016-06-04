function NeighborhoodStatus () {
    var self = {className: "NeighborhoodStatus"};

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

    self.setHref = setHref;
    self.setNeighborhoodName = setNeighborhoodName;
    return self;
}