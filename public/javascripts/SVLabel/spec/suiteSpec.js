describe("A suite", function () {
  it("contains spec with an expectation", function () {
    expect(true).toBe(true);
  });
});

describe("A suite is just a function", function () {
  var a;

  it("and so is a spec", function () {
    a = true;
    expect(a).toBe(true);
  });
});

describe("The 'toBe' matcher compares with ===", function () {
  it("and has a positive case", function () {
    expect(true).toBe(true);
  });

  it("and can have a negative case", function () {
    expect(false).not.toBe(true);
  });
});

describe("Included matchers:", function() {
    it("The 'toBe' matcher compares with ===", function () {
      var a = 12;
      var b = a;

      expect(a).toBe(b);
      expect(a).not.toBe(null);
    });

    describe("The 'toEqual' matcher", function () {
      it("works for simple literals and variables", function () {
        var a = 12;
        expect(a).toEqual(12);
      });

      it("should work for objects", function() {
        var foo = {
          a: 12,
          b: 34
        };
        var bar = {
          a: 12,
          b: 34
        };
        expect(foo).toEqual(bar);
      });
    });

    it("The 'toMatch' matcher is far regular expressions", function () {
      var message = "foo bar baz";
      expect(message).toMatch(/bar/);
      expect(message).toMatch("bar");
      expect(message).not.toMatch(/quux/);
    });

    it("The 'toBeDefined' matcher compares against 'undefined'", function () {
      var a = {
        foo: 'foo'
      };

      expect(a.foo).toBeDefined();
      expect(a.bar).not.toBeDefined();
    });

    
});
