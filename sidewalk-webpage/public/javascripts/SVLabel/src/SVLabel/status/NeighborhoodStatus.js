function NeighborhoodStatus () {
    var self = {className: "NeighborhoodStatus"};

    function setHref(hrefString) {
        if (svl.ui.status.neighborhoodLink) {
            svl.ui.status.neighborhoodLink.attr("href", hrefString)
        }

    }

    self.setHref = setHref;

    return self;
}