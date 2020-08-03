$(document).ready(function(){
    /*
    Any h2 tag with a "question" class will be added to questions list
     */

    $("h3.question").each(function(){
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
        var helpPanel = document.getElementById("help-panel");
        if (panel.style.maxHeight) {
            panel.style.maxHeight = null;
            $(".plusminus").text('+');
            helpPanel.style.height = "auto";
            helpPanel.style.overflowY = "hidden";
            if (window.innerWidth > 978) {
                helpPanel.style.width = helpPanel.offsetWidth - 15 + "px";
            }
        } else {
            panel.style.maxHeight = panel.scrollHeight + "px";
            $(".plusminus").text('-');
            if (window.innerWidth > 978) {
                helpPanel.style.overflowY = "scroll";
                helpPanel.style.height = "500px";
                helpPanel.style.width = helpPanel.offsetWidth + 15 + "px";
            } else {
                helpPanel.style.height = "auto";
                helpPanel.style.overflowY = "hidden";
            }
        }
    });
});
