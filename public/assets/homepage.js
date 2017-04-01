/**
 * Created by anthony on 4/1/17.
 */
function playVideo(){
    document.getElementById("vidembed").innerHTML = '<div class="video-container"><iframe id="youtubeframe" width="853" height="480" src="https://www.youtube.com/embed/_GBLqZDXB_0?autoplay=1" frameborder="0" allowfullscreen</iframe</div>';
    var vidheight = $('#youtubeframe').height();
    $('#vidembed').height(vidheight);
}
$( window ).resize(function() {
    var vidheight = $('#youtubeframe').height();
    $('#vidembed').height(vidheight);
});