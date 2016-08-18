describe("ModalMissionCompleteProgressBar tests", function () {
	var bar;
	var $uiModalMissionCompleteFixture;
	var $uiModalMissionCompleteBar;
	var uiModalMissionComplete;

	beforeEach( function () {
		$uiModalMissionCompleteFixture = $('<div id="modal-mission-complete-holder"> \
<div id="modal-mission-complete-background" class="modal-background"></div> \
<div id="modal-mission-complete-foreground" class="modal-foreground"> \
<h1>Mission Complete! <span class="normal" id="modal-mission-complete-title"></span></h1> \
<div class="row"> \
    <div class="mapbox col-sm-7"> \
        <div id="modal-mission-complete-map"></div> \
        <div id="map-legend"> \
            <span><svg class="legend-label" width="15" height="10"><rect width="15" height="10" id="green-square"></svg> This Mission</span><br> \
            <span><svg class="legend-label" width="15" height="10"><rect width="15" height="10" id="blue-square"></svg> Previous Missions</span> \
        </div> \
    </div> \
    <div class="col-sm-5"> \
        <p><span id="modal-mission-complete-message"></span></p> \
        <h3>Mission Labels</h3> \
        <table class="table"> \
            <tr> \
                <th class="width-50-percent">Curb Ramp</th> \
                <td id="modal-mission-complete-curb-ramp-count" class="col-right"></td> \
            </tr> \
            <tr> \
                <th>Missing Curb Ramp</th> \
                <td id="modal-mission-complete-no-curb-ramp-count" class="col-right"></td> \
            </tr> \
            <tr> \
                <th>Obstacle in Path</th> \
                <td id="modal-mission-complete-obstacle-count" class="col-right"></td> \
            </tr> \
            <tr> \
                <th>Surface Problem</th> \
                <td id="modal-mission-complete-surface-problem-count" class="col-right"></td> \
            </tr> \
            <tr> \
                <th>Other</th> \
                <td id="modal-mission-complete-other-count" class="col-right"></td> \
            </tr> \
        </table> \
        <h3>Neighborhood Progress</h3> \
        <div id="modal-mission-complete-complete-bar"></div> \
        <table class="table"> \
        <tr> \
            <th>Audited in this mission</th> \
            <td id="modal-mission-complete-mission-distance" class="col-right"></td> \
        </tr> \
        <tr> \
            <th>Audited in this neighborhood</th> \
            <td id="modal-mission-complete-total-audited-distance" class="col-right"></td> \
        </tr> \
        <tr> \
            <th>Remaining in this neighborhood</th> \
            <td id="modal-mission-complete-remaining-distance" class="col-right"></td> \
        </tr> \
    </table> \
    <button class="btn blue-btn" id="modal-mission-complete-close-button">Continue</button> \
    </div> \
</div> \
</div> \
</div>');

		uiModalMissionComplete = {};
		uiModalMissionComplete.holder = $uiModalMissionCompleteFixture;
		bar = new ModalMissionCompleteProgressBar(uiModalMissionComplete);
		$uiModalMissionCompleteBar = $uiModalMissionCompleteFixture.find('#modal-mission-complete-complete-bar');
		// $uiModalMissionCompleteFixture = $('<div id="modal-mission-complete-complete-bar"></div>');
		// uiModalMissionComplete = {};
		// uiModalMissionComplete.completeBar = $uiModalMissionCompleteFixture
	});
	

	describe("creating new object", function () {
		it("should initialize svg elements", function () {
			expect(bar).not.toBe(null);
			expect($uiModalMissionCompleteBar.find('svg')).not.toBe(null);
			expect($uiModalMissionCompleteBar.find('svg').attr('width')).toBe('275');
			expect($uiModalMissionCompleteBar.find('svg').attr('height')).toBe('20');
			expect($uiModalMissionCompleteBar.find('.g-background')).not.toBe(null);
			expect($uiModalMissionCompleteBar.find('.g-bar-chart').length).toBe(2);
		});
		it("should initialize green bar styles", function () {
			var blueBar = $uiModalMissionCompleteBar.find('#blue-bar');
			expect(blueBar).not.toBe(null);
			expect(blueBar.attr('x')).toBe('0');
			expect(blueBar.attr('y')).toBe('0');
			expect(blueBar.attr('fill')).toBe('rgba(49,130,189,1)');
			expect(blueBar.attr('width')).toBe('0');
			expect(blueBar.attr('height')).toBe('20');
		});
		it("should initialize green bar styles", function() {
			var greenBar = $uiModalMissionCompleteBar.find('#green-bar');
			expect(greenBar).not.toBe(null);
			expect(greenBar.attr('x')).toBe('0');
			expect(greenBar.attr('y')).toBe('0');
			expect(greenBar.attr('fill')).toBe('rgba(100,240,110,1)');
			expect(greenBar.attr('width')).toBe('0');
			expect(greenBar.attr('height')).toBe('20');
		});
		it("should initialize text", function () {
			var barText = $uiModalMissionCompleteBar.find('#bar-text');
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
			var greenBar = $uiModalMissionCompleteBar.find('#green-bar');
			expect(greenBar.attr('width')).toBe('27.5');

			var blueBar = $uiModalMissionCompleteBar.find('#blue-bar');
			expect(blueBar.attr('width')).toBe('27.5');
	
			var barText = $uiModalMissionCompleteBar.find('#bar-text');
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
			var greenBar = $uiModalMissionCompleteBar.find('#green-bar');
			expect(greenBar.attr('width')).toBe('27.5');

			var blueBar = $uiModalMissionCompleteBar.find('#blue-bar');
			expect(blueBar.attr('width')).toBe('0');
	
			var barText = $uiModalMissionCompleteBar.find('#bar-text');
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
			var greenBar = $uiModalMissionCompleteBar.find('#green-bar');
			expect(greenBar.attr('width')).toBe('192.5');
			expect(greenBar.attr('x')).toBe('82.5');

			var blueBar = $uiModalMissionCompleteBar.find('#blue-bar');
			expect(blueBar.attr('width')).toBe('82.5');
	
			var barText = $uiModalMissionCompleteBar.find('#bar-text');
			expect(barText.html()).toBe('100%');
		});
	});
});