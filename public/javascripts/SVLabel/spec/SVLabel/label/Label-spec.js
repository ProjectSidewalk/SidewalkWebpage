describe("Label module", function () {
    var svl;

    var pov = {
        heading: 0,
        pitch: 0,
        zoom: 1
    };

    var param;
    var p1, p2, p3;
    var points;
    var path;
    var label;
    var labelColors;
    var latlng;
    var boundingBoxA, boundingBoxB;
    var extractedPath;

    beforeEach(function () {
        svl = {};
        svl.rootDirectory = '/';
        svl.onboarding = null;
        svl.isOnboarding = function () {return false; };
        svl.canvasWidth = 720;
        svl.canvasHeight = 480;
        svl.svImageHeight = 6656;
        svl.svImageWidth = 13312;
        svl.alpha_x = 4.6;
        svl.alpha_y = -4.65;
        svl._labelCounter = 0;
        svl.getLabelCounter = function () { return svl._labelCounter++; };
        svl.zoomFactor = {
            1: 1,
            2: 2.1,
            3: 4,
            4: 8,
            5: 16
        };
        svl.gsvImageCoordinate2CanvasCoordinate = function (xIn, yIn, pov) {
            // This function takes the current pov of the Street View as a parameter
            // and returns a canvas coordinate of a point (xIn, yIn).
            var x, y, zoom = pov.zoom;
            var svImageWidth = svl.svImageWidth * svl.zoomFactor[zoom];
            var svImageHeight = svl.svImageHeight * svl.zoomFactor[zoom];

            xIn = xIn * svl.zoomFactor[zoom];
            yIn = yIn * svl.zoomFactor[zoom];

            x = xIn - (svImageWidth * pov.heading) / 360;
            x = x / svl.alpha_x + svl.canvasWidth / 2;

            //
            // When POV is near 0 or near 360, points near the two vertical edges of
            // the SV image does not appear. Adjust accordingly.
            var edgeOfSvImageThresh = 360 * svl.alpha_x * (svl.canvasWidth / 2) / (svImageWidth) + 10;

            if (pov.heading < edgeOfSvImageThresh) {
                // Update the canvas coordinate of the point if
                // its svImageCoordinate.x is larger than svImageWidth - alpha_x * (svl.canvasWidth / 2).
                if (svImageWidth - svl.alpha_x * (svl.canvasWidth / 2) < xIn) {
                    x = (xIn - svImageWidth) - (svImageWidth * pov.heading) / 360;
                    x = x / svl.alpha_x + svl.canvasWidth / 2;
                }
            } else if (pov.heading > 360 - edgeOfSvImageThresh) {
                if (svl.alpha_x * (svl.canvasWidth / 2) > xIn) {
                    x = (xIn + svImageWidth) - (svImageWidth * pov.heading) / 360;
                    x = x / svl.alpha_x + svl.canvasWidth / 2;
                }
            }

            y = yIn - (svImageHeight / 2) * (pov.pitch / 90);
            y = y / svl.alpha_y + svl.canvasHeight / 2;

            return {x : x, y : y};
        };
        util.misc = UtilitiesMisc(JSON);
        svl.labelFactory = new LabelFactory(svl, 1);


        param = {};
        p1 = new Point(svl, 0, 0, pov, param);
        p2 = new Point(svl, 9, 0, pov, param);
        p3 = new Point(svl, 5, 5, pov, param);
        points = [p1,p2,p3];
        path = new Path(svl, [p1, p2, p3], {});
        labelColors = util.misc.getLabelColors();
        latlng = {lat: 38.894799, lng: -77.021906};
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
        label = svl.labelFactory.create(path, param);

    });

    describe("`getBoundingBox` method", function () {
        beforeEach(function () {
            boundingBoxA = label.getBoundingBox(pov); // This function returns bounding box in image coordinates.
            boundingBoxB = { x: 0, y: 0, width: 9, height: 5 };
        });

        it("should return a bounding box.", function () {
            expect(boundingBoxA).not.toBeUndefined();
        });

        it("boundingBoxA should match boundingBox B", function () {
            expect(boundingBoxA.x).toBeCloseTo(boundingBoxB.x);
            expect(boundingBoxA.y).toBeCloseTo(boundingBoxB.y);
            expect(boundingBoxA.width).toBeCloseTo(boundingBoxB.width);
            expect(boundingBoxA.height).toBeCloseTo(boundingBoxB.height);
        });
    });

    describe("`getLabelId` method", function () {
        it("Label ID should be 1", function(){
            expect(label.getLabelId()).toBe(1);
        })
    });

    describe("`getLabelType` method", function () {
        it("Label ID should not be 0 or undefined", function(){
            expect(label.getLabelId()).not.toBe(0);
            expect(label.getLabelId()).not.toBeUndefined();
        });
    });

    describe("`getPath` method", function () {

        beforeEach(function () {
            extractedPath = label.getPath(true);
        });

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
