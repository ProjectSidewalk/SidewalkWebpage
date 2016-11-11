/**
 * Alert Module
 * @constructor
 */
function Alert() {
    var self = {};

    function init() {
        self.ui = {
            holder: $("#alert-holder"),
            message: $("#alert-message"),
            close: $("#alert-close"),
            dontShow: $("#alert-dont-show")
        };

        self.ui.close.on('click', function() {
            self.hideAlert();
        });

        self.ui.dontShow.on('click', function() {
            self.dontShowClicked();
        });

        self.dontShowList = svl.storage.get("alertDontShowList") || [];
    }

    /**
     *
     * @param msg: the message in the alert
     * @param type: is a string, used to identifying message types
     * @param dontShow: boolean, whether the don't show link is enabled or not
     * @param callback callback to run after showing alert
     */
    function showAlert(msg, type, dontShow, callback) {
        if (!dontShow) dontShow = false;

        if(type == null || !(self.dontShowList.indexOf(type) >= 0)) {
            if(dontShow)
                self.ui.dontShow.show();
            else
                self.ui.dontShow.hide();

            self.hideAlert(function() {
                self.ui.message.html(msg);
                self.lastMessageType = type;
                self.ui.holder.fadeIn(300, callback);
            });

            self.hideTimeout = setTimeout(function() {
                self.hideAlert();
            }, 10000);
        }
    }

    function hideAlert(callback) {
        self.ui.holder.fadeOut(300, callback);
        clearTimeout(self.hideTimeout);
    }

    function dontShowClicked() {
        if(self.lastMessageType != null) {
            self.dontShowList.push(self.lastMessageType);
            svl.storage.set("alertDontShowList", self.dontShowList);
            self.hideAlert();
        }
    }

    init();

    self.showAlert = showAlert;
    self.hideAlert = hideAlert;
    self.dontShowClicked = dontShowClicked;

    return self;
}
