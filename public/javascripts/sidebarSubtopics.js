$(document).ready(function(){
    /*
    Any h2 tag with a "question" class will be added to questions list
     */

    $("h2.question").each(function(){
        listItem = "<li><a href='#"+$(this).attr('id')+"'>"+$(this).text()+"</a></li>";
        this.classList.add("subtopic");
        $("#subtopics").append(listItem);
    });

    $('.img-responsive').magnificPopup({
        type:'image'
    });

    /*$(".topic").click(function(){
        if ($('.subtopic').is(':visible')) {
            $(".subtopic").slideUp(300);
            $(".plusminus").text('+');
        }
        if ($(this).next(".subtopic").is(':visible')){
            $(this).next(".subtopic").slideUp(300);
            $(this).children(".plusminus").text('+');
        } else {
            $(this).next(".subtopic").slideDown(300);
            $(this).children(".plusminus").text('-');
        }
    });*/

    $(".plusminus").click(function() {
        this.classList.toggle("active");

        var panel = document.getElementById("subtopics");
        if (panel.style.maxHeight){
            panel.style.maxHeight = null;
            $(".plusminus").text('+');
        } else {
            panel.style.maxHeight = panel.scrollHeight + "px";
            $(".plusminus").text('-');
        }
    });

});