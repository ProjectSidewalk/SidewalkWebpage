// on document load, finds each element with class 'timestamp', converts timestamp from UTC to user's local time.
$(document).ready(function () {
    $(".timestamp").each(function(){
        var timestampText = this.textContent + " UTC";
        var localDate = moment(new Date(timestampText));
        //if the date cannot be parsed, ignore it and leave the text as-is. Otherwise, parse into local datetime format. 
        if(localDate.format('MMMM Do YYYY, h:mm:ss') !== "Invalid date"){
            this.textContent = localDate.format('MMMM Do YYYY, h:mm:ss');
        }        
    });
});
