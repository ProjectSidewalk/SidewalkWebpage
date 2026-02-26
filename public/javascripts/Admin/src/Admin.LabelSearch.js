/**
 * Creates the label search UI on both /admin/label and /admin's Label Search tab.
 * @param {boolean} isAdmin
 * @param {AdminGSVLabelView} adminGsvLabelView
 * @param {string} source The UI that holds the label search, one of 'LabelSearchPage' or 'AdminLabelSearchTab'
 * @returns {Window | (WorkerGlobalScope & Window)}
 * @constructor
 */
function AdminLabelSearch(isAdmin, adminGsvLabelView, source) {
    self.adminGSVLabelView = adminGsvLabelView;
    self.source = source;

    // Prevents the page from refreshing when the enter key is pressed.
    $('#form-control-input').keypress(function(e) {
        if (e.keyCode === 13) {
            const labelId = $('#form-control-input').val();
            self.adminGSVLabelView.showLabel(labelId, self.source);
            return false;
        }
    });

    /**
     * Pull information from the Label information box when the submit button is clicked.
     */
    $('#submit').on('click', async function(e) {
        const labelId = $('#form-control-input').val();
        await self.adminGSVLabelView.showLabel(labelId, self.source);
    });

    return self;
}
