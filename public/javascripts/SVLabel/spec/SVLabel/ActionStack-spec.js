describe("The ActionStack module.", function () {
    var stack;
    var svl;
    var pov;
    var labelColors;
    var latlng, latlng2;
    var param;
    var p1, p2, p3;
    var path;
    var label1, label2;
    var $uiActionStackFixture;

    beforeEach(function () {
        $uiActionStackFixture = {};
        $uiActionStackFixture.holder = $('<div id="action-stack-control-holder"></div>');
        $uiActionStackFixture.holder.append('<button id="undo-button" class="button action-stack-button" ' +
            'value="Undo"><img src="" class="action-stack-icons" alt="Undo" /><br />' +
            '<small>Undo</small></button>');
        $uiActionStackFixture.holder.append('<button id="redo-button" class="button action-stack-button" ' +
            'value="Redo"><img src="" class="action-stack-icons" alt="Redo" /><br />' +
            '<small>Redo</small></button>');
        $uiActionStackFixture.redo = $uiActionStackFixture.holder.find("#redo-button");
        $uiActionStackFixture.undo = $uiActionStackFixture.holder.find("#undo-button");
        var stackParam = {
            domIds: {
                redoButton: "",
                undoButton: ""
            }
        };
        var trackerMock = { push: function (item) {} };
        stack = new ActionStack(trackerMock, $uiActionStackFixture);


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

        pov = {
            heading: 0,
            pitch: 0,
            zoom: 1
        };
        labelColors = util.misc.getLabelColors();
        latlng = {lat: 38.894799, lng: -77.021906};
        latlng2 = {lat: 37.894799, lng: -76.021906};
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
        p1 = new Point(svl, 0, 0, pov, param);
        p2 = new Point(svl, 9, 0, pov, param);
        p3 = new Point(svl, 5, 5, pov, param);
        path = new Path(svl, [p1, p2, p3], {});
        label1 = new Label(svl, path, param);
        param.panoramaLat = latlng2.lat;
        param.panoramaLng = latlng2.lng;
        label2 = new Label(svl, path, param);

    });

    describe("`size` method", function() {
        it("Stack size should be 0", function() {
            expect(0).toBe(stack.size());
        });
        it("Stack size should be 1", function() {
            stack.push('addLabel', null);
            expect(1).toBe(stack.size());
        });
        it("Stack size should be 0", function() {
            stack.pop();
            expect(0).toBe(stack.size());
            stack.pop();
            expect(0).toBe(stack.size());
        })
    });

    describe("`push` method", function () {
        it("should be able to push labels", function() {
            stack.push('addLabel', label1);
            stack.push('addLabel', label2);
            expect(stack.size()).toBe(2);
        });
        it("should not push invalid labels", function() {
            stack.push('addLabel', {});
            expect(stack.size()).toBe(1);
            stack.pop();
        });

        it("Stack should work with deleteLabel", function() {
            stack.push('deleteLabel', {});
            expect(stack.size()).toBe(1);
            stack.pop();
        })
    });

    describe("`pop` method", function () {
        beforeEach(function () {
            stack.push('addLabel', label1);
        });

        it("should pop an item from stack", function () {
            var item = stack.pop();
            expect(stack.size()).toBe(0);
        });

        it("Calling pop on empty stack should still be 0", function() {
            expect(stack.size()).toBe(1);
            stack.pop();
            expect(stack.size()).toBe(0);
            stack.pop();
            expect(stack.size()).toBe(0);
        })
    });

    describe("Test redo", function () {
        it("Calling redo before undo should not change the actionStackCursor", function() {
            stack.push('addLabel', label1);
            expect(stack.getStatus('actionStackCursor')).toBe(1);
            stack.redo();
            expect(stack.getStatus('actionStackCursor')).toBe(1);
            stack.pop();
        });
        it("Calling redo should redo addLabel actions", function() {
            stack.push('addLabel', label1);
            stack.push('addLabel', label2);
            expect(stack.getStatus('actionStackCursor')).toBe(2);
            stack.undo();
            expect(stack.getStatus('actionStackCursor')).toBe(1);
            stack.redo();
            expect(stack.getStatus('actionStackCursor')).toBe(2);
        });
    });

    describe("Test undo", function () {
        it("Calling undo should undo addLabel actions", function() {
            stack.push('addLabel', label1);
            stack.undo();
            expect(label1.getstatus('deleted')).toBe(true);
            stack.redo();
            expect(label1.getstatus('deleted')).toBe(false);
            stack.pop();
        });
        it("Calling undo while actionStackCursor is 0 should work", function() {
            stack.pop();
            stack.pop();
            expect(stack.getStatus('actionStackCursor')).toBe(0);
            stack.undo();
            expect(stack.getStatus('actionStackCursor')).toBe(0);
        });
    });

    describe("`lockDisableRedo` method", function () {
        it("Calling lockDisableRedo should set lock.disableRedo to true", function() {
            stack.lockDisableRedo();
            var lock = stack.getLock('disableRedo');
            expect(lock).toBe(true);
        });
    });

    describe("Test lockDisableUndo", function () {
        it("Calling lockDisableUndo should set lock.disableUndo to true", function() {
            stack.lockDisableUndo();
            expect(stack.getLock('disableUndo')).toBe(true);
        });
    });

    describe("Test unlockDisableUndo", function () {
        it("Calling unlockDisableUndo should set lock.disableUndo to false", function() {
            stack.unlockDisableUndo();
            expect(stack.getLock('disableUndo')).toBe(false);
        });
    });

    describe("`unlockDisableRedo` method", function () {
        it("Calling unlockDisableRedo should set lock.disableRedo to false", function() {
            stack.unlockDisableRedo();
            expect(stack.getLock('disableRedo')).toBe(false);
        });
    });

    describe("`disableRedo` method", function() {
        it("Calling disableRedo should set status.disableRedo to false", function() {
            stack.disableRedo();
            var flag = stack.getStatus('disableRedo');
            expect(flag).toBe(true);
        });

        it("Calling disableRedo while lock.disableRedo is true should not change it", function() {
            stack.disableRedo();
            expect(stack.getStatus('disableRedo')).toBe(true);

            stack.lockDisableRedo();
            expect(stack.getLock('disableRedo')).toBe(true);

            stack.enableRedo();
            expect(stack.getStatus('disableRedo')).toBe(true);
        });
    });

    describe("`enableRedo` method", function() {
        it("Calling enableRedo should set status.enableRedo to false", function() {
            stack.enableRedo();
            expect(stack.getStatus('disableRedo')).toBe(false);
        });

        it("Calling enableRedo while lock.enableRedo is true should not change it", function() {
            stack.lockDisableRedo();
            expect(stack.getStatus('disableRedo')).toBe(false);
            expect(stack.getLock('disableRedo')).toBe(true);
            stack.disableRedo();
            expect(stack.getStatus('disableRedo')).not.toBe(true);
            stack.unlockDisableRedo();
        });
    });

    describe("`disableUndo` method", function() {
        it("Calling disableUndo should set status.disableUndo to false", function() {
            stack.disableUndo();
            expect(stack.getStatus('disableUndo')).toBe(true);
        });

        it("Calling disableUndo while lock.disableUndo is true should not change it", function() {
            stack.disableUndo();
            stack.lockDisableUndo();
            expect(stack.getStatus('disableUndo')).toBe(true);
            expect(stack.getLock('disableUndo')).toBe(true);
            stack.enableUndo();
            expect(stack.getStatus('disableUndo')).toBe(true);
            stack.unlockDisableUndo();
        });
    });

    describe("Test enableUndo", function() {
        it("Calling enableUndo should set status.enableUndo to false", function() {
            stack.enableUndo();
            expect(stack.getStatus('disableUndo')).toBe(false);
        });
        it("Calling enableUndo while lock.disableRedo is true should not change it", function() {
            stack.lockDisableUndo();
            expect(stack.getStatus('disableUndo')).toBe(false);
            expect(stack.getLock('disableUndo')).toBe(true);
            stack.enableUndo();
            expect(stack.getStatus('disableUndo')).not.toBe(true);
            stack.unlockDisableUndo();
        });
    });

});
