describe("Tests for the Label module.", function () {
    var svl = svl || {};
    svl.labelFactory = LabelFactory();
    svl.misc = UtilitiesMisc(JSON);
    var pov = {
        heading: 0,
        pitch: 0,
        zoom: 1
    };
    var param = {};
    var p1 = new Point(0, 0, pov, param);
    var p2 = new Point(9, 0, pov, param);
    var p3 = new Point(5, 5, pov, param);
    var points = [p1,p2,p3];
    var path = new Path([p1, p2, p3], {});
    var labelColors = svl.misc.getLabelColors();
    var latlng = {lat: 38.894799, lng: -77.021906};
    param = {
        canvasWidth: svl.canvasWidth,
        canvasHeight: svl.canvasHeight,
        canvasDistortionAlphaX: svl.alpha_x,
        canvasDistortionAlphaY: svl.alpha_y,
        labelId: 1,
        labelType: 1,
        labelDescription: "CurbRamp",
        labelFillStyle: labelColors.CurbRamp.fillStyle,
        panoId: "_AUz5cV_ofocoDbesxY3Kw",
        panoramaLat: latlng.lat,
        panoramaLng: latlng.lng,
        panoramaHeading: pov.heading,
        panoramaPitch: pov.pitch,
        panoramaZoom: pov.zoom,
        svImageWidth: svl.svImageWidth,
        svImageHeight: svl.svImageHeight,
        svMode: 'html4'
    };

    var label = svl.labelFactory.create(path, param);
    describe("The method getBoundingBox", function () {
        // Todo. Kotaro should fix image coordinates.
        var boundingBoxA = label.getBoundingBox(pov); // This function returns bounding box in image coordinates.
        var boundingBoxB = {
            x: 0,
            y: 0,
            width: 9,
            height: 5
        };

        it("boundingBox should exist", function () {
            expect(boundingBoxA).not.toBeUndefined();
        });

        it("boundingBoxA should match boundingBox B", function () {
            // Todo. Kotaro will write this. boundingBoxB needs to be fixed.
            expect(1).toBe(1);
        });
    });

    // Todo. Alex. Please write tests for this.
    describe("Test getLabelId", function () {
        it("Label ID should be 1", function(){
            expect(label.getLabelId()).toBe(1);
        })
    });

    // Todo. Alex. Please write tests for this.
    describe("Test getLabelType", function () {
        it("Label ID should not be 0 or undefined", function(){
            expect(label.getLabelId()).not.toBe(0);
            expect(label.getLabelId()).not.toBeUndefined();
        });
    });

    // Todo: Alex. Please fix these tests.
    describe("Test getPath method", function () {
        var extractedPath = label.getPath(true);
        it("path should exist", function () {
            expect(extractedPath).not.toBeUndefined();
        });

        it("should get a reference", function () {
            var referenceCopy = label.getPath(true);
            referenceCopy.labelId = 2;
            expect(referenceCopy).toBe(path);
        });

        it("should get a deep copy", function () {
            var deepCopy = label.getPath(false);
            deepCopy.labelId = 2;
            expect(deepCopy).not.toBe(path);
        });

        it("should get a path that has same points", function () {
            var extractedPoints = extractedPath.getPoints(true);
            var len = extractedPoints.length;
            var i;
            for (i = 0; i < len; i++) {
                expect(extractedPoints[i]).toBe(points[i]);
            }
        });
    });
});
