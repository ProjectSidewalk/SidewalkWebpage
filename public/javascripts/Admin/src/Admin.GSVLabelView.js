function AdminGSVLabel() {
    var self = {};

    var _init = function() {
        _resetModal();
    };

    function _resetModal() {
        self.modal =
            $('<div class="modal fade" id="labelModal" tabindex="-1" role="dialog" aria-labelledby="myModalLabel">'+
                '<div class="modal-dialog" role="document" style="width: 390px">'+
                    '<div class="modal-content">'+
                        '<div class="modal-header">'+
                            '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>'+
                            '<h4 class="modal-title" id="myModalLabel">Label</h4>'+
                        '</div>'+
                        '<div class="modal-body">'+
                            '<div id="svholder" style="width: 360px; height:240px">'+
                        '</div>'+
                        '<div class="modal-footer">'+
                            '<table class="table table-striped" style="font-size:small; margin-bottom: 0">'+
                            '<tr>'+
                                '<th>Label Type</th>'+
                                '<td id="label-type-value"></td>'+
                            '</tr>'+
                            '<tr>' +
                                '<th>Severity</th>'+
                                '<td id="severity"></td>'+
                            '</tr>'+
                            '<tr>'+
                                '<th>Task ID</th>' +
                                '<td id="task"></td>' +
                            '</tr>'+
                            '<tr>' +
                                '<th>Temporary</th>'+
                                '<td id="temporary"></td>'+
                            '</tr>'+
                            '<tr>'+
                                '<th>Description</th>'+
                                '<td colspan="3" id="description"></td>'+
                            '</tr>'+
                            '<tr>'+
                            '<th>Time Submitted</th>'+
                            '<td id="timestamp" colspan="3"></td>'+
                            '</tr>'+
                            '</table>'+
                        '</div>'+
                    '</div>'+
                '</div>'+
            '</div>');

        self.panorama = AdminPanorama(self.modal.find("#svholder")[0]);

        self.modalTimestamp = self.modal.find("#timestamp");
        self.modalLabelTypeValue = self.modal.find("#label-type-value");
        self.modalSeverity = self.modal.find("#severity");
        self.modalTemporary = self.modal.find("#temporary");
        self.modalDescription = self.modal.find("#description");
        self.modalTask = self.modal.find("#task");
    }

    function showLabel(labelId) {
        _resetModal();

        self.modal.modal({
            'show': true
        });
        var adminLabelUrl = "/adminapi/label/" + labelId;
        $.getJSON(adminLabelUrl, function (data) {
            _handleData(data);
        });
    }

    function _handleData(labelMetadata) {
        self.panorama.changePanoId(labelMetadata['gsv_panorama_id']);

        self.panorama.setPov({
            heading: labelMetadata['heading'],
            pitch: labelMetadata['pitch'],
            zoom: labelMetadata['zoom']
        });

        var adminPanoramaLabel = AdminPanoramaLabel(labelMetadata['label_type_key'],
            labelMetadata['canvas_x'], labelMetadata['canvas_y'],
            labelMetadata['canvas_width'], labelMetadata['canvas_height']);
        self.panorama.renderLabel(adminPanoramaLabel);

        var labelDate = moment(new Date(labelMetadata['timestamp']));
        self.modalTimestamp.html(labelDate.format('MMMM Do YYYY, h:mm:ss') + " (" + labelDate.fromNow() + ")");
        self.modalLabelTypeValue.html(labelMetadata['label_type_value']);
        self.modalSeverity.html(labelMetadata['severity'] != null ? labelMetadata['severity'] : "No severity");
        self.modalTemporary.html(labelMetadata['temporary'] ? "True": "False");
        self.modalDescription.html(labelMetadata['description'] != null ? labelMetadata['description'] : "No description");
        self.modalTask.html("<a href='/admin/task/"+labelMetadata['audit_task_id']+"'>"+
            labelMetadata['audit_task_id']+"</a> by <a href='/admin/user/" + labelMetadata['username'] + "'>" +
            labelMetadata['username'] + "</a>");

        self.panorama.refreshGSV();
    }

    _init();

    self.showLabel = showLabel;

    return self;
}