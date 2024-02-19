function AdminLabelSearch(isAdmin, source) {
    function _init() {
        self.adminGSVLabelView = AdminGSVLabelView(isAdmin, source);
    }

    // Prevents the page from refreshing when the enter key is pressed.
    $('#form-control-input').keypress(function(e) {
        if (e.keyCode === 13) {
            var labelId = $('#form-control-input').val();
            self.adminGSVLabelView.showLabel(labelId);
            return false;
        }
    });

    /**
     * Pull information from the Label information box when the submit button is clicked.
     */
    $('#submit').on('click', function(e) {
        var labelId = $('#form-control-input').val();
        self.adminGSVLabelView.showLabel(labelId);
    });

    _init();
    
    return self;
}
