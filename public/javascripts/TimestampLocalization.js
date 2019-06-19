// on document load, finds each element with class 'timestamp', converts timestamp from UTC to user's local time. Requires moment.js.
$(document).ready(function () {
    $(".timestamp").each(function(){
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
});
