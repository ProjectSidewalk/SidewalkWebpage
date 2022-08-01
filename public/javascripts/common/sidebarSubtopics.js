$(document).ready(function(){
    /* Any h2 tag with a "question" class will be added to questions list. */
    $("h3.question").each(function(){
        listItem = "<li><a href='#"+$(this).attr('id')+"'>"+$(this).text()+"</a></li>";
        this.classList.add("subtopic");
        $("#subtopics").append(listItem);
    });

    $('.img-responsive').magnificPopup({
        type:'image'
    });

    /**
     * If the panel is a sidebar (when window width >= 978px), make the panel scrollable when the user
     * presses the plus, and not scrollable when the user presses the minus.
     */
    $(".plusminus").click(function() {
        this.classList.toggle("active");

        var w = document.documentElement.clientWidth;
        var smallWindowWidth = 978;
        var scrollbarWidth = 15;
        var panel = document.getElementById("subtopics");
        var helpPanel = document.getElementById("help-panel");
        if (panel.style.maxHeight) {
            panel.style.maxHeight = null;
            $(".plusminus").text('+');
            $("#help-panel").addClass("not-scrollable").removeClass("scrollable");
            if (w >= smallWindowWidth) {
                helpPanel.style.width = helpPanel.offsetWidth - scrollbarWidth + "px";
            }
        } else {
            panel.style.maxHeight = panel.scrollHeight + 100 + "px";
            $(".plusminus").text('-');
            if (w >= smallWindowWidth) {
                $("#help-panel").addClass("scrollable").removeClass("not-scrollable");
                updateSidebarForScrollState()
                helpPanel.style.width = helpPanel.offsetWidth + scrollbarWidth + "px";
            } else {
                $("#help-panel").addClass("not-scrollable").removeClass("scrollable");
            }
        }
    });
});
