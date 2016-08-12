describe("ModalMissionCompleteProgressBar tests", function () {
	var bar;

	beforeEach( function () {
		$uiModalMissionCompleteFixture = $('<div id="modal-mission-complete-complete-bar"></div>');
		$('body').append($uiModalMissionCompleteFixture);

		bar = new ModalMissionCompleteProgressBar();

	});
	afterEach( function () {
		$uiModalMissionCompleteFixture.remove();
	});

	describe("creating new object", function () {
		it("should initialize svg elements", function () {
			expect(bar).not.toBe(null);
			expect($('svg')).not.toBe(null);
			expect($('svg').attr('width')).toBe('275');
			expect($('svg').attr('height')).toBe('20');
			expect($('.g-background')).not.toBe(null);
			expect($('.g-bar-chart').length).toBe(2);
		});
		it("should initialize green bar styles", function () {
			var blueBar = $('#blueBar');
			expect(blueBar).not.toBe(null);
			expect(blueBar.attr('x')).toBe('0');
			expect(blueBar.attr('y')).toBe('0');
			expect(blueBar.attr('fill')).toBe('rgba(49,130,189,1)');
			expect(blueBar.attr('width')).toBe('0');
			expect(blueBar.attr('height')).toBe('20');
		});
		it("should initialize green bar styles", function() {
			var greenBar = $('#greenBar');
			expect(greenBar).not.toBe(null);
			expect(greenBar.attr('x')).toBe('0');
			expect(greenBar.attr('y')).toBe('0');
			expect(greenBar.attr('fill')).toBe('rgba(100,240,110,1)');
			expect(greenBar.attr('width')).toBe('0');
			expect(greenBar.attr('height')).toBe('20');
		});
		it("should initialize text", function () {
			var barText = $('#barText');
			expect(barText).not.toBe(null);
			expect(barText.attr('style')).toBe('visibility: hidden;');
			expect(barText.attr('x')).toBe('3');
			expect(barText.attr('y')).toBe('15');
			expect(barText.attr('fill')).toBe('white');
			expect(barText.attr('font-size')).toBe('10pt');
		});
	});

	describe("update method 20%", function() {
		beforeEach(function (done){
			bar.update(0.1, 0.1);
			// let d3 transitions execute
			setTimeout(function () {done();}, 2000);
		});
		it("should change bar width and text", function () {
			var greenBar = $('#greenBar');
			expect(greenBar.attr('width')).toBe('27.5');

			var blueBar = $('#blueBar');
			expect(blueBar.attr('width')).toBe('27.5');
	
			var barText = $('#barText');
			expect(barText.html()).toBe('20%');
		});
	});

	describe("update method 10%", function() {
		beforeEach(function (done){
			bar.update(0.1, 0);
			// let d3 transitions execute
			setTimeout(function () {done();}, 2000);
		});
		it("should change bar width and text", function () {
			var greenBar = $('#greenBar');
			expect(greenBar.attr('width')).toBe('27.5');

			var blueBar = $('#blueBar');
			expect(blueBar.attr('width')).toBe('0');
	
			var barText = $('#barText');
			expect(barText.html()).toBe('10%');
		});
	});

	describe("update method 100%", function() {
		beforeEach(function (done){
			bar.update(0.7, 0.3);
			// let d3 transitions execute
			setTimeout(function () {done();}, 2000);
		});
		it("should change bar width and text", function () {
			var greenBar = $('#greenBar');
			expect(greenBar.attr('width')).toBe('192.5');
			expect(greenBar.attr('x')).toBe('82.5');

			var blueBar = $('#blueBar');
			expect(blueBar.attr('width')).toBe('82.5');
	
			var barText = $('#barText');
			expect(barText.html()).toBe('100%');
		});
	});
});