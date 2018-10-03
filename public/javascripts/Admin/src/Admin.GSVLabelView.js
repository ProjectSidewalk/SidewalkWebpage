function AdminGSVLabel() {
    var self = {};

    var _init = function() {
        _resetModal();
    };

    function _resetModal() {
        self.modal =
            $('<div class="modal fade" id="labelModal" tabindex="-1" role="dialog" aria-labelledby="myModalLabel">'+
                '<div class="modal-dialog" role="document" style="width: 570px">'+
                    '<div class="modal-content">'+
                        '<div class="modal-header">'+
                            '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>'+
                            '<h4 class="modal-title" id="myModalLabel">Label</h4>'+
                        '</div>'+
                        '<div class="modal-body">'+
                            '<div id="svholder" style="width: 540px; height:360px">'+
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
                                '<th>Tags</th>'+
                                '<td colspan="3" id="tags"></td>'+
                            '</tr>'+
                            '<tr>'+
                                '<th>Description</th>'+
                                '<td colspan="3" id="label-description"></td>'+
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
        self.modalTags = self.modal.find("#tags");
        self.modalDescription = self.modal.find("#label-description");
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
        self.panorama.setPano(labelMetadata['gsv_panorama_id'], labelMetadata['heading'],
            labelMetadata['pitch'], labelMetadata['zoom']);

        var adminPanoramaLabel = AdminPanoramaLabel(labelMetadata['label_type_key'],
            labelMetadata['canvas_x'], labelMetadata['canvas_y'],
            labelMetadata['canvas_width'], labelMetadata['canvas_height'], labelMetadata['heading'],
            labelMetadata['pitch'], labelMetadata['zoom']);
        self.panorama.setLabel(adminPanoramaLabel);

        var labelDate = moment(new Date(labelMetadata['timestamp']));
        self.modalTimestamp.html(labelDate.format('MMMM Do YYYY, h:mm:ss') + " (" + labelDate.fromNow() + ")");
        self.modalLabelTypeValue.html(labelMetadata['label_type_value']);
        self.modalSeverity.html(labelMetadata['severity'] != null ? labelMetadata['severity'] : "No severity");
        self.modalTemporary.html(labelMetadata['temporary'] ? "True": "False");
        //join is here to make the formatting nice, otherwise we don't have commas or spaces.
        self.modalTags.html(labelMetadata['tags'].join(', '));
        self.modalDescription.html(labelMetadata['description'] != null ? labelMetadata['description'] : "No description");
        self.modalTask.html("<a href='/admin/task/"+labelMetadata['audit_task_id']+"'>"+
            labelMetadata['audit_task_id']+"</a> by <a href='/admin/user/" + labelMetadata['username'] + "'>" +
            labelMetadata['username'] + "</a>");
    }

    _init();

    self.showLabel = showLabel;

    return self;
}