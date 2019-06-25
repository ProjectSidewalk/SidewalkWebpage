// requires moment.js

// on window load, run the changeTimestamps function.
$(window).load(function () {
    changeTimestamps();
    //if any html changes, call the changeTimestamps function.
    var observer = new MutationObserver(changeTimestamps);

    observer.observe(document, {
        attributes: true,
        childList: true,
        subtree: true,
        characterData: true
    });
});

//changes anything with the class timestamp from UTC to local time.
function changeTimestamps(){
    $(".timestamp").each(function(){
        if($(this).hasClass('local')){
            return;
        }
        $(this).addClass('local');

        var timestampText = this.textContent + " UTC";
        var localDate = moment(new Date(timestampText));

        var format = 'MMMM Do YYYY, h:mm:ss'
        if($(this).hasClass('date')){
            format = 'MMMM Do YYYY';            
        }
        
        //if the date cannot be parsed, ignore it and leave the text as-is. Otherwise, parse into local datetime format. 
        if(localDate.format(format) !== "Invalid date"){
            this.textContent = localDate.format(format);
        }
    });
}