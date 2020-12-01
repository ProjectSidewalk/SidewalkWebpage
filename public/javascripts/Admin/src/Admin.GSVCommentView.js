function AdminGSVCommentView(admin) {
    var self = {};
    self.admin = admin;

    var _init = function() {
        self.panoProp = new PanoProperties();
        _resetModal();
    };

    function _resetModal() {
        var modalText =
            '<div class="modal fade" id="label-modal" tabindex="-1" role="dialog" aria-labelledby="myModalLabel">' +
                '<div class="modal-dialog" role="document" style="width: 840px">' +
                    '<div class="modal-content">' +
                        '<div class="modal-header">' +
                            '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>'+
                            '<h4 class="modal-title" id="myModalLabel"></h4>' +
                        '</div>' +
                        '<div class="modal-body">' +
                            '<div id="svholder" style="width: 810px; height:540px">' +
                        '</div>' +
                        '<div id="button-holder">' + 
                        '</div>' +
                '</div>' +
                '</div>' +
                '</div>';       
        
        self.modal = $(modalText);
        self.panorama = AdminPanorama(self.modal.find("#svholder")[0], self.modal.find("#button-holder"), admin);
    }

    function showCommentGSV(commentGSV, heading, pitch, zoom, labelId) {
        _resetModal();
        self.modal.modal({
            'show': true
        });
        self.panorama.setPano(commentGSV, heading, pitch, zoom);
        
        if(labelId != 0){
            var adminLabelUrl = admin ? "/adminapi/label/id/" + labelId : "/label/id/" + labelId;
            $.getJSON(adminLabelUrl, function (data) {
                setLabel(data);
            });
         }
    }

    function setLabel(labelMetadata) {
        var adminPanoramaLabel = AdminPanoramaLabel(labelMetadata['label_id'], labelMetadata['label_type_key'],
            labelMetadata['canvas_x'], labelMetadata['canvas_y'],
            labelMetadata['canvas_width'], labelMetadata['canvas_height'], labelMetadata['heading'],
            labelMetadata['pitch'], labelMetadata['zoom']);
        self.panorama.setLabel(adminPanoramaLabel);
    }
 
    _init();
    self.showCommentGSV = showCommentGSV;
    return self;
}
