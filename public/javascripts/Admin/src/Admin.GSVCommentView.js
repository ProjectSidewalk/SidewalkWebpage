function AdminGSVCommentView(admin) {
    var self = {};
    self.admin = admin;

    var _init = function() {
        self.panoProp = new PanoProperties();

        _resetModal();
    };

    function _resetModal() {
        var modalText =
            '<div class="modal fade" id="labelModal" tabindex="-1" role="dialog" aria-labelledby="myModalLabel">'+
                '<div class="modal-dialog" role="document" style="width: 570px">'+
                    '<div class="modal-content">'+
                        '<div class="modal-header">'+
                            '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>'+
                            '<h4 class="modal-title" id="myModalLabel"></h4>'+
                        '</div>'+
                        '<div class="modal-body">'+
                            '<div id="svholder" style="width: 540px; height:360px">'+
                        '</div>'
                        +
                        '<div id="button-holder">' + '</div>' +
                '</div>'+
                '</div>'+
                '</div>';       
        
        self.modal = $(modalText);

        self.panorama = AdminPanorama(self.modal.find("#svholder")[0], self.modal.find("#button-holder"), admin);
    }

    //PASS GSV ID INTO HANDLEDATA, USE default heading, pitch, zoom
    function showCommentGSV(commentGSV) {
        _resetModal();

        self.modal.modal({
            'show': true
        });
        
        //Parameters: (gsv_id, heading, pitch, zoom)
        //Heading, Pitch, Zoom, set to default values(0)
        self.panorama.setPano(commentGSV, 0, 0, 0);

    }
 
    _init();

    self.showCommentGSV = showCommentGSV;

    return self;
}
