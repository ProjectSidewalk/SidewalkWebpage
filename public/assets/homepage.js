
var autoAdvanceLaptop = true;



function playVideo(){
    document.getElementById("vidembed").innerHTML = '<div class="video-container"><iframe id="youtubeframe" width="853" height="480" src="https://www.youtube.com/embed/wAdGXqRunQs?autoplay=1" frameborder="0" allowfullscreen</iframe</div>';
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

$( document ).ready(function() {

    switchToVideo(1)
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



});