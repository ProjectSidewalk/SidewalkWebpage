// Introduction to Jasmine
// http://jasmine.github.io/2.0/introduction.html

describe("Point module", function () {
  var svl;
  var pov = {
    heading: 0,
    pitch: 0,
    zoom: 1
  };
  var p1, p2, p3, p4, p5;

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


    var param = {};
    p1 = new Point(svl, 0, 0, pov, param);
    p2 = new Point(svl, 1, 0, pov, param);
    p3 = new Point(svl, 1, 1, pov, param);
    p4 = new Point(svl, 0, 0, pov, {fillStyle: 'rgba(255,255,255,0.5)'});
    p5 = new Point(svl, 0, 0, pov, {fillStyle: 'rgba(0,0,0,0.5)'});
  });


  describe("The Point module's constructor", function () {
    it("should initialize canvas x-coordinate with the given parameter", function () {
      expect(p1.getCanvasX()).toBe(0);
      expect(p2.getCanvasX()).not.toBe(0);
      expect(p2.getCanvasX()).toBe(1);
    });

    it("should initialize canvas y-coordinate with the given parameter", function () {
      expect(p1.getCanvasY()).toBe(0);
      expect(p3.getCanvasY()).not.toBe(0);
      expect(p3.getCanvasY()).toBe(1);
    });

    it("should initialize fillStyle with 'rgba(255,255,255,0.5)'", function () {
        expect(p1.getFill()).toBe("rgba(255,255,255,0.5)");
    });

    it("should not initialize fillStyle with 'abcdef'", function () {
      expect(p1.getFill()).not.toBe('abcdef');
    });


    it("should initialize fillStyle with 'rgba(255,255,255,0.5)'", function () {
      expect(p4.getFill()).toBe("rgba(255,255,255,0.5)");
    });

    it("should not initialize fillStyle with 'rgba(255,255,255,0.5)'", function () {
      expect(p5.getFill()).not.toBe("rgba(255,255,255,0.5)");
    });

    it("should initialize fillStyle with 'rgba(0,0,0,0.5)'", function () {
      expect(p5.getFill()).toBe('rgba(0,0,0,0.5)');
    });
    
    it("should get the correct pov", function() {
      expect(p1.getPOV()).toBe(pov);
      expect(p1.getPOV()).toBe(p2.getPOV());
    });
  });


});
