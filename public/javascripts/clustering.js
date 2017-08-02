$(document).ready(function () {
    document.getElementById("clustering-button").addEventListener("click", function() {
        var route = document.getElementById('route-text').value;
        $.getJSON("/clusterRoute/" + route, function (data) {
            $("#clustering-result").html(data["what did we run?"]);
        })
    })
});