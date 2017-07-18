$(document).ready(function () {
	function initializePanoramas(coordinates){
		var fenway = {lat: 42.345573, lng: -71.098326};
		var panorama1 = new google.maps.StreetViewPanorama(
		    document.getElementById('panorama-1'), {
			    position: fenway,
		    	pov: {
		        	heading: 34,
		        	pitch: 10
		        },
		        disableDefaultUI: true
		    });
		var panorama2 = new google.maps.StreetViewPanorama(
		    document.getElementById('panorama-2'), {
			    position: fenway,
		    	pov: {
		        	heading: 34,
		        	pitch: 10
		        },
		        disableDefaultUI: true
		    });
	}

	initializePanoramas();
});