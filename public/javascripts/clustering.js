$(document).ready(function () {
    document.getElementById("clustering-button").addEventListener("click", function() {
        $.getJSON("/clusterRoute/5", function (data) {
            $("#clustering-result").html(data["what did we run?"]);
            console.log(data);
        })
    })
});