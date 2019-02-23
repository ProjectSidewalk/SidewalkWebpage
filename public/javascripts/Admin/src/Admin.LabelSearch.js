function AdminLabelSearch() {
    var adminGSVLabelView;


    function _init() {
        adminGSVLabelView = AdminGSVLabelView();
    }

    /**
     * Pull information from the Label information box when the submit button is clicked.
     */
    $('#submit').on('click', function (e) {
        console.log('Submit button clicked');
        var labelId = $('#form-control-input').val();
        adminGSVLabelView.showLabel(labelId);
    });

    _init();
    
    return self;
}
