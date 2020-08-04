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

    /**
     * If the panel is a sidebar (when window width >= 978px), make the panel scrollable when the user
     * presses the plus, and not scrollable when the user presses the minus.
     */
    $(".plusminus").click(function() {
        this.classList.toggle("active");

        var w = document.documentElement.clientWidth;
        var smallWindowWidth = 978;
        var expandedPanelHeight = 500;
        var scrollbarWidth = 15;
        var panel = document.getElementById("subtopics");
        var helpPanel = document.getElementById("help-panel");
        if (panel.style.maxHeight) {
            panel.style.maxHeight = null;
            $(".plusminus").text('+');
            helpPanel.style.height = "auto";
            helpPanel.style.overflowY = "hidden";
            if (w >= smallWindowWidth) {
                helpPanel.style.width = helpPanel.offsetWidth - scrollbarWidth + "px";
            }
        } else {
            panel.style.maxHeight = panel.scrollHeight + "px";
            $(".plusminus").text('-');
            if (w >= smallWindowWidth) {
                helpPanel.style.overflowY = "scroll";
                helpPanel.style.height = expandedPanelHeight + "px";
                helpPanel.style.width = helpPanel.offsetWidth + scrollbarWidth + "px";
            } else {
                helpPanel.style.height = "auto";
                helpPanel.style.overflowY = "hidden";
            }
        }
    });
});
