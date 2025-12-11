async function AdminLabelSearch(isAdmin, source) {
    async function _init() {
        self.adminGSVLabelView = await AdminGSVLabelView(isAdmin, source);
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
    $('#submit').on('click', async function(e) {
        var labelId = $('#form-control-input').val();
        await self.adminGSVLabelView.showLabel(labelId);
    });

    await _init();

    return self;
}
