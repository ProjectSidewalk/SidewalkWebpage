$(document).ready(function(){
    /*
    Any h2 tag with a "question" class will be added to questions list
     */
    $("h2.question").each(function(){
        listItem = "<li><a href='#"+$(this).attr('id')+"'>"+$(this).text()+"</a></li>";
        $("#subtopics").append(listItem);
    });

    $('.img-responsive').magnificPopup({
        type:'image',
    });
});