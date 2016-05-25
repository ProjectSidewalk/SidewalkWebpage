// Introduction to Jasmine
// http://jasmine.github.io/2.0/introduction.html

describe("Tests for the Path module.", function () {
  var svl = svl || { util: {} };
  svl.util.color = UtilitiesColor();
  var pov = {
    heading: 0,
    pitch: 0,
    zoom: 1
  };
  var param = {};

  // Test X-coordinate
  var p1 = new Point(0, 0, pov, param);
  var p2 = new Point(9, 0, pov, param);
  var p3 = new Point(5, 5, pov, param);
  var points = [p1, p2, p3];

  var path = new Path([p1, p2, p3], {});
  describe("getPoints method", function(){

    it("should return the point objects in this path", function() {
      expect(path.getPoints(true)).toEqual(points);
    });
  });

  describe("getImageCoordinates", function () {
    it("should return image coordinates of the points", function () {
      var imagecoordinates = [p1.getGSVImageCoordinate(), p2.getGSVImageCoordinate(), p3.getGSVImageCoordinate()];
      expect(path.getImageCoordinates()).toEqual(imagecoordinates);
    })
  });

  describe("getFill", function () {
    it("should return the fill style of the path", function () {
      expect(path.getFill()).toEqual('rgba(255,255,255,0.5)' );
    });
  });

  describe("getLineWidth", function () {
    it("should return the lineWidth of the path", function () {
      path.setLineWidth(3);
      expect(path.getLineWidth()).toEqual("3");
    });
  });


  /*
  describe("The method getBoundingBox", function () {
    // Todo
  });


  describe("The method getSvImageBoundingBox", function () {
    // Todo
  });

  describe("The method getImageCoordinates", function () {
    // Todo
  });

  describe("The method getPoints", function () {
    // Todo
  });

  describe("The method isOn", function () {
    // Todo
  });

  describe("The method overlap", function () {
    // Todo
  })

  describe("The method removePoints", function () {
    // Todo
  });
  */

    describe("The method setFill", function () {
        it("this Path should have three points", function () {
            expect(path.getPoints().length).toBe(3);
        });

        it("should have the default color 'rgba(255,255,255,0.5)''", function () {
            expect(path.getFill()).toBe('rgba(255,255,255,0.5)');
        });

        it("should set fill color", function () {
            path.setFill('rgba(10,10,10,0.5)');
            expect(path.getFill()).toBe('rgba(10,10,10,0.5)');

            // convert 'rgb' to 'rgba'. Set default alpha to be 0.5
            path.setFill('rgb(20,20,20)');
            expect(path.getFill()).toBe('rgba(20,20,20,0.5)');
        });
    });

    describe("The method setLineWidth", function () {

        it("should have default lineWidth '3'", function () {
            expect(path.getLineWidth()).toBe('3');
        });

        it("should allow one to set line width", function () {
            path.setLineWidth('5');
            expect(path.getLineWidth()).toBe('5');

            path.setLineWidth(15);
            expect(path.getLineWidth()).toBe('15');

            path.setLineWidth('foo'); // Should not allow illegal input
            expect(path.getLineWidth()).toBe('15');
        });
    });

    describe("The method setStrokeStyle", function () {
        it("should be able to set the stroke style", function () {
            var style = path.getProperty("strokeStyle");
            expect(style).toBe("rgba(255,255,255,1)");
            path.setStrokeStyle("rgba(0, 0, 0, 1.0)");
            style = path.getProperty("strokeStyle");
            expect(style).toBe("rgba(0, 0, 0, 1.0)");
        });
    });

    describe("The method resetStrokeStyle", function () {
        it("should be able to reset the stroke style", function () {
            path.setStrokeStyle("rgba(0, 0, 0, 1.0)");
            var style = path.getProperty("strokeStyle");
            expect(style).toBe("rgba(0, 0, 0, 1.0)");

            path.resetStrokeStyle();
            var style = path.getProperty("strokeStyle");
            expect(style).toBe("rgba(255,255,255,1)");
        });
    });

    describe("setVisibility", function () {
        it("should be able to set visibility to hidden.", function () {
            path.setVisibility("hidden");
            expect(path.getStatus("visibility")).toBe("hidden");
        });

        it("should be able to set visibility to hidden.", function () {
            path.setVisibility("hidden");
            path.setVisibility("visible");
            expect(path.getStatus("visibility")).toBe("visible");
        });
    });


});
