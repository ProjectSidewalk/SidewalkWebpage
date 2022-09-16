
var autoAdvanceLaptop = true;

function isScrolledIntoView(elem) {
    var docViewTop = $(window).scrollTop();
    var docViewBottom = docViewTop + $(window).height();

    var elemTop = $(elem).offset().top;
    var elemBottom = elemTop + $(elem).height();

    return ((elemBottom <= docViewBottom) && (elemTop >= docViewTop));
}

$(window).scroll(numbersInView);

function numbersInView(){
    if (isScrolledIntoView($("#percentage"))){
        if (percentageAnim && labelsAnim) {
            percentageAnim.start();
            labelsAnim.start();
            distanceAnim.start();
            validationsAnim.start();
        }
    }
}

function switchToVideo(vidnum){


    if (vidnum === 1) {

        document.getElementById("vid1").style.display = "block";
        document.getElementById("vid2").style.display = "none";
        document.getElementById("vid3").style.display = "none";


        $( "#word1" ).addClass( "tab-word activetab" );
        $( "#word2" ).addClass( "tab-word" ).removeClass("activetab");
        $( "#word3" ).addClass( "tab-word" ).removeClass("activetab");

        $( "#firstnumbox" ).addClass( "tab-word activetab" );
        $( "#secondnumbox" ).addClass( "tab-word" ).removeClass("activetab");
        $( "#thirdnumbox" ).addClass( "tab-word" ).removeClass("activetab");

        $( "#number1" ).addClass( "tab-word activetab" );
        $( "#number2" ).addClass( "tab-word" ).removeClass("activetab");
        $( "#number3" ).addClass( "tab-word" ).removeClass("activetab");

        document.getElementById("vid1").currentTime = 0;
        document.getElementById("vid1").play();

        document.getElementById("vid2").pause();
        document.getElementById("vid3").pause();


    }
    else if (vidnum === 2) {

        document.getElementById("vid1").style.display = "none";
        document.getElementById("vid2").style.display = "block";
        document.getElementById("vid3").style.display = "none";


        $( "#word1" ).addClass( "tab-word" ).removeClass("activetab");
        $( "#word2" ).addClass( "tab-word activetab" );
        $( "#word3" ).addClass( "tab-word" ).removeClass("activetab");

        $( "#firstnumbox" ).addClass( "tab-word" ).removeClass("activetab");
        $( "#secondnumbox" ).addClass( "tab-word activetab" );
        $( "#thirdnumbox" ).addClass( "tab-word" ).removeClass("activetab");

        $( "#number1" ).addClass( "tab-word" ).removeClass("activetab");
        $( "#number2" ).addClass( "tab-word activetab" );
        $( "#number3" ).addClass( "tab-word" ).removeClass("activetab");

        document.getElementById("vid2").currentTime = 0;
        document.getElementById("vid2").play();

        document.getElementById("vid1").pause();
        document.getElementById("vid3").pause();
    }
    else if (vidnum === 3) {

        document.getElementById("vid1").style.display = "none";
        document.getElementById("vid2").style.display = "none";
        document.getElementById("vid3").style.display = "block";


        $( "#word1" ).addClass( "tab-word" ).removeClass("activetab");
        $( "#word2" ).addClass( "tab-word" ).removeClass("activetab");
        $( "#word3" ).addClass( "tab-word activetab" );

        $( "#firstnumbox" ).addClass( "tab-word" ).removeClass("activetab");
        $( "#secondnumbox" ).addClass( "tab-word" ).removeClass("activetab");
        $( "#thirdnumbox" ).addClass( "tab-word activetab" );

        $( "#number1" ).addClass( "tab-word" ).removeClass("activetab");
        $( "#number2" ).addClass( "tab-word" ).removeClass("activetab");
        $( "#number3" ).addClass( "tab-word activetab" );

        document.getElementById("vid3").currentTime = 0;
        document.getElementById("vid3").play();

        document.getElementById("vid2").pause();
        document.getElementById("vid1").pause();
    }

    // Reset auto-advance counter.
    numTicks = 0;
}

function logWebpageActivity(activity){
    var url = "/userapi/logWebpageActivity";
    var async = false;
    $.ajax({
        async: async,
        contentType: 'application/json; charset=utf-8',
        url: url,
        type: 'post',
        data: JSON.stringify(activity),
        dataType: 'json',
        success: function(result){},
        error: function (result) {
            console.error(result);
        }
    });
}

var vidBanner;
var bannerVid;
var instructVideoContainer;
var instructVideos;

var DEFAULT_VIDEO = 1;
var TICK_SIZE = 500;
var requiredTicks = [18, 22, 17];
var curVideo = 1;
var numTicks = 0;

// Advances to next instruction video if the videos are in the user's viewport and enough "ticks" have gone by.
function autoAdvanceLaptopVideos() {
    numTicks++;

    if (numTicks >= requiredTicks[curVideo - 1] && isElementVerticallyVisible(instructVideoContainer)) {
        numTicks = 0;
        curVideo++;

        if (curVideo > requiredTicks.length) {
            curVideo = DEFAULT_VIDEO;
        }

        switchToVideo(curVideo);
    }
}

$( document ).ready(function() {

    // Triggered upon clicking tabs in "How you can help" section.
    // Logs "Click_module=HowYouCanHelp_tab=<tabNumber>" in WebpageActivityTable
    $("#firstnumbox").on('click', function(e){
        switchToVideo(1);
        autoAdvanceLaptop = false;
        logWebpageActivity("Click_module=HowYouCanHelp_tab=1");
    });
    $("#secondnumbox").on('click', function(e){
        switchToVideo(2);
        autoAdvanceLaptop = false;
        logWebpageActivity("Click_module=HowYouCanHelp_tab=2");
    });
    $("#thirdnumbox").on('click', function(e){
        switchToVideo(3);
        autoAdvanceLaptop = false;
        logWebpageActivity("Click_module=HowYouCanHelp_tab=3");
    });

    // Triggered when images in Collaborators section are clicked.
    // Logs "Click_module=Collaborator_type=<"img">_source=<"makeability" or "ligapeatonal">
    $("#collaborators-container").on('click', 'a', function(e){
        var type = e.currentTarget.id.split('-')[1];
        var source = e.currentTarget.id.split('-')[0];
        logWebpageActivity("Click_module=Collaborator_type=" + type + "_source=" + source);
    });

    // Triggered when 'Start Exploring' in video container is clicked.
    // Logs "Click_module=StartExploring_location=Index"
    $(".body-start-btn").on("click", function(){
        logWebpageActivity("Click_module=StartExploring_location=Index");
    });

    // Triggered when 'Results Map' in index page is clicked.
    // Logs "Click_module=ResultsMap_location=Index"
    $(".ps-skyline-overlay-btn").on("click", function() {
        logWebpageActivity("Click_module=Results_location=Index")
    });

    // Triggered when the city or mapathon links are clicked.
    // If a city link is clicked logs "Click_module=OtherCityLink_City=cityName".
    // If a mapathon link is clicked logs "Click_module=mapathonLink".
    $(".other-city-link").on("click", function(e){
        var cityName = e.currentTarget.id;
        if (cityName === "mapathonLink"){
            logWebpageActivity("Click_module=mapathonLink");
        }else{
            logWebpageActivity("Click_module=OtherCityLink_City=" + cityName);
        }
    });

    // Setup video lazyPlay.
    $(window).on("scroll", onScroll);

    vidBanner = $('#vidbanner')[0];
    bannerVid = $('#bgvid')[0];

    instructVideoContainer = $('#instructionvideo')[0];
    instructVideos = [
        $('#vid1')[0],
        $('#vid2')[0],
        $('#vid3')[0]
    ];

    // Auto advance instruction videos.
    switchToVideo(DEFAULT_VIDEO);
    setInterval(autoAdvanceLaptopVideos, TICK_SIZE);
});

var pausedVideos = {};

// Wrappers around lazyPlayVideos().
var lazyPlayVideosThrottled = _.throttle(lazyPlayVideos, 300);
var lazyPlayVideosDebounced = _.debounce(lazyPlayVideos, 600);

// Triggered when the user scrolls.
function onScroll() {
    lazyPlayVideosThrottled(); // While scrolling, run the check every 300ms.
    lazyPlayVideosDebounced(); // After scrolling, make sure we run the check.
}

// lazyPlays our main videos.
function lazyPlayVideos() {
    lazyPlay(vidBanner, bannerVid);

    for (var i = 0; i < instructVideos.length; i++) {
        lazyPlay(instructVideoContainer, instructVideos[i]);
    }
}

// Pauses a video if a certain element is outside of the viewport, plays the video otherwise.
function lazyPlay(el, video) {
    if (isElementVerticallyVisible(el)) {
        if (!isVideoPlaying(video)) {
            pausedVideos[video.id] = false;
            video.play();
        }
    } else {
        if (isVideoPlaying(video)) {
            pausedVideos[video.id] = true;
            video.pause();
        }
    }
}

// Returns true if the given video is playing.
function isVideoPlaying(video) {
    return !pausedVideos[video.id];
}

// Returns true if the given element is in the vertical viewport.
function isElementVerticallyVisible(el) {
    var rect = el.getBoundingClientRect();
    var windowHeight = (window.innerHeight || document.documentElement.clientHeight);

    return (rect.top <= windowHeight) && ((rect.top + rect.height) >= 0);
}
