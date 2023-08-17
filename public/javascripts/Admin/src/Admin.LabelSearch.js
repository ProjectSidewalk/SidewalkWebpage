function AdminLabelSearch() {
    var adminGSVLabelView;


    function _init() {
        adminGSVLabelView = AdminGSVLabelView(true, "AdminLabelSearch");
    }

    // Prevents the page from refreshing when the enter key is pressed.
    $('#form-control-input').keypress(function(e) {
        if (e.keyCode === 13) {
            var labelId = $('#form-control-input').val();
            adminGSVLabelView.showLabel(labelId);
            return false;
        }
    });

    /**
     * Pull information from the Label information box when the submit button is clicked.
     */
    $('#submit').on('click', function(e) {
        var labelId = $('#form-control-input').val();
        adminGSVLabelView.showLabel(labelId);
    });

    _init();
    
    return self;
}
