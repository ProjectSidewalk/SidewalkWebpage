function MTurk () {
    var self = this;

    this._properties = {
        assignmentId: null,
        groupId: null,
        hidId: null,
        isAMTTask: null,
        isPreviewMode: null,
        workerId: null
    };

    this._properties.assignmentId = util.getURLParameter('assignmentId');
    this._properties.groupId = util.getURLParameter('groupId');
    this._properties.hitId = util.getURLParameter('hitId');
    this._properties.workerId = util.getURLParameter('workerId');


    if (this._properties.assignmentId && this._properties.assignmentId === 'ASSIGNMENT_ID_NOT_AVAILABLE') {
        this._properties.isPreviewMode = true;
        this._properties.isAMTTask = true;
    } else if (this.hasWorkerId() && !this._properties.assignmentId) {
        this._properties.isPreviewMode = false;
        this._properties.isAMTTask = false;
    } else if (!this._properties.assignmentId && !this.hasHitId() && !this.hasWorkerId()) {
        this._properties.isPreviewMode = false;
        this._properties.isAMTTask = false;
    } else {
        this._properties.isPreviewMode = false;
        this._properties.isAMTTask = true;
    }

    this._properties.isAMTTask = true;

    $('input[name="assignmentId"]').attr('value', this._properties.assignmentId);
    $('input[name="workerId"]').attr('value', this._properties.workerId);
    $('input[name="hitId"]').attr('value', this._properties.hitId);
}

MTurk.prototype.hasAssignmentId = function () {
    return this._properties.assignmentId && this._properties.assignmentId !== "";
};

MTurk.prototype.hasGroupId = function () {
    return this._properties.groupId && this._properties.groupId !== "";
};

MTurk.prototype.hasHitId = function () {
    return this._properties.hitId && this._properties.hitId !== "";
};

MTurk.prototype.hasWorkerId = function () {
    return this._properties.workerId && this._properties.workerId !== "";
};

MTurk.prototype.isAMTTask = function () {
    return this._properties.isAMTTask;
};

MTurk.prototype.isPreviewMode = function () {
    return this._properties.isPreviewMode;
};

MTurk.prototype.isSandboxTask = function () {
    if (this.isAMTTask() && document.referrer.indexOf("workersandbox.mturk.com") !== -1) {
        return true;
    } else {
        return false;
    }
};

MTurk.prototype.showPreviewModeWarning = function () {
    if (this.isAMTTask() && this.isPreviewMode()) {
        var dom = '<div class="amt-preview-warning-holder">' +
            '<div class="amt-preview-warning">' +
            'Warning: you are on a Preview Mode!' +
            '</div>' +
            '</div>';
        $("body").append(dom);
    }
};
