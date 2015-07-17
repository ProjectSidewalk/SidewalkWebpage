var Color = Color || {};

Color.Pallet = (function Pallet () {
  var self = {};


  var sequentialPallet = {
    // Red to orange: http://colorbrewer2.org/?type=sequential&scheme=OrRd&n=5
    "redToOrange": ['rgba(254,240,217,1.0)','rgba(253,204,138,1.0)','rgba(252,141,89,1.0)','rgba(227,74,51,1.0)','rgba(179,0,0,1.0)']
  };

  self.sequential = function (level, palletName) {
    if (!palletName) {
      palletName = "redToOrange";  // Default
    }

    // Value should be either {0, 1, 2, 3, 4}
    level = Math.min(level, 4);
    level = Math.max(level, 0);

    return sequentialPallet[palletName][level];
  };

  return self;
})();
