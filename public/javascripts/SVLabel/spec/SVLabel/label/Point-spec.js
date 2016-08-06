// Introduction to Jasmine
// http://jasmine.github.io/2.0/introduction.html

describe("The tests for the Point module.", function () {
  var pov = {
    heading: 0,
    pitch: 0,
    zoom: 1
  };

  var param = {};
  var p1 = new Point(0, 0, pov, param);
  var p2 = new Point(1, 0, pov, param);
  var p3 = new Point(1, 1, pov, param);
  var p4 = Point(0, 0, pov, {fillStyle: 'rgba(255,255,255,0.5)'});
  var p5 = Point(0, 0, pov, {fillStyle: 'rgba(0,0,0,0.5)'});

  describe("The Point module's constructor", function () {
    // Test X-coordinate

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
