$(document).ready(function () {
    document.getElementById("clustering-button").addEventListener("click", function() {
        var route = document.getElementById('route-text').value;
        var hit = document.getElementById('hit-text').value;
        $.getJSON("/clusterRoute/" + route + "/" + hit, function (data) {
            $("#clustering-result").html(data["what did we run?"]);
        })
    })
});