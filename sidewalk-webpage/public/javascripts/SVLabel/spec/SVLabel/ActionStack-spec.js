describe("The ActionStack module.", function () {
  var stackParam = {
    domIds: {
      redoButton: "",
      undoButton: ""    
    }
  };
  var stack = new ActionStack(stackParam);
  var pov = {
    heading: 0,
    pitch: 0,
    zoom: 1
  };
  var labelColors = svl.misc.getLabelColors();
  var latlng = {lat: 38.894799, lng: -77.021906};
  var latlng2 = {lat: 37.894799, lng: -76.021906};
  var param = {
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
  var p1 = new Point(0, 0, pov, param);
  var p2 = new Point(9, 0, pov, param);
  var p3 = new Point(5, 5, pov, param);
  var path = new Path([p1, p2, p3], {});
  var label1 = new Label(path, param);
  param.panoramaLat = latlng2.lat;
  param.panoramaLng = latlng2.lng;
  var label2 = new Label(path, param);

  describe("Test size", function() {
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

  describe("Test push", function () {
    it("Stack size should be 2", function() {
      stack.push('addLabel', label1);
      stack.push('addLabel', label2);
      expect(stack.size()).toBe(2);
    });
    it("Stack should be able to accept invalid labels", function() {
      stack.push('addLabel', undefined);
      expect(stack.size()).toBe(3);
      stack.pop();
    });
    it("Stack should work with deleteLabel", function() {
      stack.push('deleteLabel', undefined);
      expect(stack.size()).toBe(3);
      stack.pop();
    })
  });  

  describe("Test pop", function () {
    it("Calling pop on empty stack should still be 0", function() {
      stack.pop();
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

  describe("Test lockDisableRedo", function () {
    it("Calling lockDisableRedo should set lock.disableRedo to true", function() {
      stack.lockDisableRedo();
      expect(stack.getLock('disableRedo')).toBe(true);
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

  describe("Test unlockDisableRedo", function () {
    it("Calling unlockDisableRedo should set lock.disableRedo to false", function() {
      stack.unlockDisableRedo();
      expect(stack.getLock('disableRedo')).toBe(false);
    });
  });

  describe("Test disableRedo", function() {
    it("Calling disableRedo should set status.disableRedo to false", function() {
      stack.disableRedo();
      expect(stack.getStatus('disableRedo')).toBe(true);
    });
    it("Calling disableRedo while lock.disableRedo is true should not change it", function() {
      stack.lockDisableRedo();
      expect(stack.getStatus('disableRedo')).toBe(true);
      expect(stack.getLock('disableRedo')).toBe(true);
      stack.enableRedo();
      expect(stack.getStatus('disableRedo')).not.toBe(false);
      stack.unlockDisableRedo();
    });
  });

  describe("Test enableRedo", function() {
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

  describe("Test disableUndo", function() {
    it("Calling disableUndo should set status.disableUndo to false", function() {
      stack.disableUndo();
      expect(stack.getStatus('disableUndo')).toBe(true);
    });
    it("Calling disableUndo while lock.disableUndo is true should not change it", function() {
      stack.lockDisableUndo();
      expect(stack.getStatus('disableUndo')).toBe(true);
      expect(stack.getLock('disableUndo')).toBe(true);
      stack.disableUndo();
      expect(stack.getStatus('disableUndo')).not.toBe(false);
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
