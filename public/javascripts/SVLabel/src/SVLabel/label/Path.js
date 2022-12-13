function Path (svl, points) {
    var self = { className : 'Path', points : undefined };
    var parent;

    function _init(points) {
        var lenPoints;
        var i;
        self.points = points;
        lenPoints = points.length;

        // Set belongs to of the points
        for (i = 0; i < lenPoints; i += 1) {
            points[i].setBelongsTo(self);
        }
    }

    function belongsTo () { return parent ? parent : null; }

    function getPoints() { return $.extend(true, [], points); }

    function setBelongsTo(obj) {
        parent = obj;
        return this;
    }

    self.belongsTo = belongsTo;
    self.getPoints = getPoints;
    self.setBelongsTo = setBelongsTo;

    _init(points);

    return self;
}
