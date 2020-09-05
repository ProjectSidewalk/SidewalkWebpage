function ToggleController(map, self, adminView) {
    function toggleLayers(label, checkboxId, sliderId) {
        if (document.getElementById(checkboxId).checked) {
            if(checkboxId == "occlusion"){
                for (var i = 0; i < self.allLayers[label].length; i++) {
                    if (!map.hasLayer(self.allLayers[label][i])) {
                        map.addLayer(self.allLayers[label][i]);
                    }
                }
            }
            else {
                for (var i = 0; i < self.allLayers[label].length; i++) {
                    if (!map.hasLayer(self.allLayers[label][i])
                        && ($(sliderId).slider("option", "values")[0] <= i &&
                            $(sliderId).slider("option", "values")[1] >= i )) {
                        map.addLayer(self.allLayers[label][i]);
                    } else if ($(sliderId).slider("option", "values")[0] > i
                        || $(sliderId).slider("option", "values")[1] < i) {
                        map.removeLayer(self.allLayers[label][i]);
                    }
                }
            }
        } else {
            for (var i = 0; i < self.allLayers[label].length; i++) {
                if (map.hasLayer(self.allLayers[label][i])) {
                    map.removeLayer(self.allLayers[label][i]);
                }
            }
        }
    }

    function toggleAuditedStreetLayer() {
        if (document.getElementById('auditedstreet').checked) {
            map.addLayer(self.auditedStreetLayer);
        } else {
            map.removeLayer(self.auditedStreetLayer);
        }
    }

    // Functionality for the legend's minimize button.
    $('#map-legend-minimize-button').click(function() {
        $("#legend-table").slideToggle(0);
        $(this).text(function(_, value) { return value === '-' ? '+' : '-'});
    });
    self.adminGSVLabelView = AdminGSVLabelView(adminView);
    self.toggleLayers = toggleLayers;
    self.toggleAuditedStreetLayer = toggleAuditedStreetLayer;
}