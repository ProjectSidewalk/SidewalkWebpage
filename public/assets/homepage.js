
var autoAdvanceLaptop = true;



function playVideo(){
    document.getElementById("vidembed").innerHTML = '<div class="video-container"><iframe id="youtubeframe" width="853" height="480" src="https://www.youtube.com/embed/wAdGXqRunQs?autoplay=1&rel=0" frameborder="0" allowfullscreen</iframe</div>';
    var vidheight = $('#youtubeframe').height();
    $('#vidembed').height(vidheight);
}
$( window ).resize(function() {
    var vidheight = $('#youtubeframe').height();
    $('#vidembed').height(vidheight);
});

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
        if(percentageAnim && labelsAnim) {
            percentageAnim.start();
            labelsAnim.start();
            milesAnim.start();
        }
    }
}

function switchToVideo(vidnum){


    if(vidnum === 1) {

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
    else if(vidnum === 2) {

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
    else if(vidnum === 3) {

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

}

function logWebpageActivity(activity){
    var url = "/userapi/logWebpageActivity";
    var async = true;
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



$( document ).ready(function() {

    switchToVideo(1);
    function autoAdvanceLaptopVideos(){
        if (autoAdvanceLaptop) switchToVideo(1);
        setTimeout(function () {
            if (autoAdvanceLaptop) switchToVideo(2);
            setTimeout(function () {
                if (autoAdvanceLaptop) switchToVideo(3);
                setTimeout(function () {
                    autoAdvanceLaptopVideos()

                }, 9000);

            }, 11000);
        }, 9660);
    }
    autoAdvanceLaptopVideos();

    // Triggered when "Watch Now" or the arrow next to it is clicked
    // Logs "Click_module=WatchNow" in WebpageActivityTable
    $("#playlink").on('click', function(e){
        if(e.target.innerText === "Watch Now"){
            logWebpageActivity("Click_module=WatchNow");
        }
    });

    // Triggered upon clicking tabs in "How you can help" section
    // Logs "Click_module=HowYouCanHelp_tab=<tabNumber>" in WebpageActivityTable
    $("#numbersrow").on('click','.col-sm-4', function(e){
        // Gets tab number as a string (i.e. "1", "2", or "3")
        var id = e.target.innerText.charAt(1);
        logWebpageActivity("Click_module=HowYouCanHelp_tab="+id);
    });

    // Triggered when links in Press section are clicked
    // Logs "Click_module=Press_type=<"img" or "text">_source=<"technically," "curbed," or "diamondback">"
    $("#press-container2").on('click', '.newslink', function(e){
        var type = e.currentTarget.id.split('-')[1];
        var source = e.currentTarget.id.split('-')[0];
        logWebpageActivity("Click_module=Press_type="+type+"_source="+source);
    });

    // Triggered when twitter links are clicked
    // Logs "Click_module=Quotes_author=<"microsoftdesign" or "kpkindc">"
    $("#quotebox-container").on('click', 'a', function(e){
        var author = e.currentTarget.id.split('-')[0];
        logWebpageActivity("Click_module=Quotes_author="+author);
    });

    // Triggered when 'Start Mapping' in video container is clicked
    // Logs "Click_module=StartMapping_location=Index"
    $(".bodyStartBtn").on("click", function(){
        logWebpageActivity("Click_module=StartMapping_location=Index");
    });
});
