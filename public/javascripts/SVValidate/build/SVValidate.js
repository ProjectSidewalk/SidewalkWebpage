/** @namespace */
var svv = svv || {};

/**
 * Main module for SVValidate (Validation interface)
 * @param param    Object passed from validation.scala.html containing initial values pulled from
 *                  the database on page load. (Currently, mission and labels)
 * @constructor
 */
function Main (param) {
    svv.canvasHeight = param.canvasHeight;
    svv.canvasWidth = param.canvasWidth;
    svv.missionsCompleted = param.missionSetProgress;

    function _initUI() {
        // Maps label types to label names.
        svv.labelNames = {
            CurbRamp: i18next.t('curb-ramp-caps'),
            NoCurbRamp: i18next.t('missing-curb-ramp-caps'),
            Obstacle: i18next.t('obstacle-caps'),
            SurfaceProblem: i18next.t('surface-problem-caps'),
            NoSidewalk: i18next.t('no-sidewalk-caps'),
            Crosswalk: i18next.t('crosswalk-caps'),
            Signal: i18next.t('signal-caps')
        };

        svv.labelTypeNames = {
            1: i18next.t('curb-ramp-caps'),
            2: i18next.t('missing-curb-ramp-caps'),
            3: i18next.t('obstacle-caps'),
            4: i18next.t('surface-problem-caps'),
            7: i18next.t('no-sidewalk-caps'),
            9: i18next.t('crosswalk-caps'),
            10: i18next.t('signal-caps')
        };

        svv.labelTypes = {
            1: 'CurbRamp',
            2: 'NoCurbRamp',
            3: 'Obstacle',
            4: 'SurfaceProblem',
            7: 'NoSidewalk',
            9: 'Crosswalk',
            10: 'Signal'
        };
        svv.ui = {};

        svv.ui.validation = {};
        svv.ui.validation.agreeButton = $("#validation-agree-button");
        svv.ui.validation.buttons = $('button.validation-button');
        svv.ui.validation.disagreeButton = $("#validation-disagree-button");
        svv.ui.validation.notSureButton = $("#validation-not-sure-button");

        svv.ui.modal = {};
        svv.ui.modal.background = $("#modal-comment-background");

        svv.ui.modalSkip = {};
        svv.ui.modalSkip.skipButton = $("#left-column-jump-button");

        svv.ui.modalComment = {};
        svv.ui.modalComment.box = $("#modal-comment-box");
        svv.ui.modalComment.feedbackButton = $("#left-column-feedback-button");
        svv.ui.modalComment.holder = $("#modal-comment-holder");
        svv.ui.modalComment.ok = $("#modal-comment-ok-button");
        svv.ui.modalComment.cancel = $("#modal-comment-cancel-button");
        svv.ui.modalComment.textarea = $("#modal-comment-textarea");

        svv.ui.modalInfo = {};
        svv.ui.modalInfo.holder = $("#modal-info-holder");
        svv.ui.modalInfo.foreground = $("#modal-info-foreground");
        svv.ui.modalInfo.background = $("#modal-info-background");
        svv.ui.modalInfo.infoHeader = $("#modal-info-header");
        svv.ui.modalInfo.description = $("#modal-info-description");
        svv.ui.modalInfo.closeButton = $("#modal-info-close-button");
        svv.ui.modalInfo.infoButton = $("#info-button");

        svv.ui.modalLandscape = {};
        svv.ui.modalLandscape.holder = $("#modal-landscape-holder");
        svv.ui.modalLandscape.foreground = $("#modal-landscape-foreground");
        svv.ui.modalLandscape.background = $("#modal-landscape-background");

        svv.ui.modalMission = {};
        svv.ui.modalMission.holder = $("#modal-mission-holder");
        svv.ui.modalMission.foreground = $("#modal-mission-foreground");
        svv.ui.modalMission.background = $("#modal-mission-background");
        svv.ui.modalMission.missionTitle = $("#modal-mission-header");
        svv.ui.modalMission.rewardText = $("#modal-mission-reward-text");
        svv.ui.modalMission.instruction = $("#modal-mission-instruction");
        svv.ui.modalMission.closeButton = $("#modal-mission-close-button");

        svv.ui.modalMissionComplete = {};
        svv.ui.modalMissionComplete.agreeCount = $("#modal-mission-complete-agree-count");
        svv.ui.modalMissionComplete.background = $("#modal-mission-complete-background");
        svv.ui.modalMissionComplete.closeButtonPrimary = $("#modal-mission-complete-close-button-primary");
        svv.ui.modalMissionComplete.closeButtonSecondary = $("#modal-mission-complete-close-button-secondary");
        svv.ui.modalMissionComplete.disagreeCount = $("#modal-mission-complete-disagree-count");
        svv.ui.modalMissionComplete.foreground = $("#modal-mission-complete-foreground");
        svv.ui.modalMissionComplete.holder = $("#modal-mission-complete-holder");
        svv.ui.modalMissionComplete.message = $("#modal-mission-complete-message");
        svv.ui.modalMissionComplete.missionTitle = $("#modal-mission-complete-title");
        svv.ui.modalMissionComplete.notSureCount = $("#modal-mission-complete-not-sure-count");
        svv.ui.modalMissionComplete.yourOverallTotalCount = $("#modal-mission-complete-your-overall-total-count");

        svv.ui.status = {};
        svv.ui.status.labelCount = $("#status-neighborhood-label-count");
        svv.ui.status.missionDescription = $("#current-mission-description");
        svv.ui.status.currentMissionReward = $("#current-mission-reward");
        svv.ui.status.totalMissionReward = $("#total-mission-reward");
        svv.ui.status.progressBar = $("#status-current-mission-completion-bar");
        svv.ui.status.progressFiller = $("#status-current-mission-completion-bar-filler");
        svv.ui.status.progressText = $("#status-current-mission-completion-rate");
        svv.ui.status.upperMenuTitle = $("#upper-menu-title-bar");
        svv.ui.status.zoomInButton = $("#zoom-in-button");
        svv.ui.status.zoomOutButton = $("#zoom-out-button");
        svv.ui.status.labelVisibilityControlButton = $("#label-visibility-control-button");

        svv.ui.status.examples = {};
        svv.ui.status.examples.example1 = $("#example-image-1");
        svv.ui.status.examples.example2 = $("#example-image-2");
        svv.ui.status.examples.example3 = $("#example-image-3");
        svv.ui.status.examples.example4 = $("#example-image-4");
        svv.ui.status.examples.counterExample1 = $("#counterexample-image-1");
        svv.ui.status.examples.counterExample2 = $("#counterexample-image-2");
        svv.ui.status.examples.counterExample3 = $("#counterexample-image-3");
        svv.ui.status.examples.counterExample4 = $("#counterexample-image-4");
        svv.ui.status.examples.popup = $("#example-image-popup-holder");

        svv.ui.status.examples.popupDescription = $("#example-image-popup-description");
        svv.ui.status.examples.popupImage = $("#example-image-popup");
        svv.ui.status.examples.popupPointer = $("#example-image-popup-pointer");
        svv.ui.status.examples.popupTitle = $("#example-image-popup-title");

        svv.ui.dateHolder = $("#svv-panorama-date-holder");
    }

    function _init() {
        svv.util = {};
        svv.util.properties = {};
        svv.util.properties.panorama = new PanoProperties();

        svv.form = new Form(param.dataStoreUrl, param.beaconDataStoreUrl);

        let statusFieldParam = {
            completedValidations: param.completedValidations
        };
        svv.statusField = new StatusField(statusFieldParam);
        svv.statusExample = new StatusExample(svv.ui.status.examples);
        svv.tracker = new Tracker();
        svv.labelDescriptionBox = new LabelDescriptionBox();
        svv.labelContainer = new LabelContainer();
        svv.panoramaContainer = new PanoramaContainer(param.labelList);

        // There are certain features that will only make sense on desktop.
        if (!isMobile()) {
            svv.gsvOverlay = new GSVOverlay();
            svv.keyboard = new Keyboard(svv.ui.validation);
            svv.labelVisibilityControl = new LabelVisibilityControl();
            svv.zoomControl = new ZoomControl();
        }

        // Logs when user zoom in/out on mobile.
        if (isMobile()) {
            svv.pinchZoom = new PinchZoomDetector();
        }

        svv.menuButtons = new MenuButton(svv.ui.validation);
        svv.modalComment = new ModalComment(svv.ui.modalComment);
        svv.modalMission = new ModalMission(svv.ui.modalMission, svv.user);
        svv.modalMissionComplete = new ModalMissionComplete(svv.ui.modalMissionComplete, svv.user);
        svv.modalSkip = new ModalSkip(svv.ui.modalSkip);
        svv.modalInfo = new ModalInfo(svv.ui.modalInfo, param.modalText);
        svv.modalLandscape = new ModalLandscape(svv.ui.modalLandscape);
        svv.modalNoNewMission = new ModalNoNewMission(svv.ui.modalMission);
        svv.infoPopover = new GSVInfoPopover(svv.ui.dateHolder, svv.panorama.getPanorama(), svv.panorama.getPosition,
            svv.panorama.getPanoId,
            function() { return svv.panoramaContainer.getCurrentLabel().getAuditProperty('streetEdgeId'); },
            function() { return svv.panoramaContainer.getCurrentLabel().getAuditProperty('regionId'); },
            svv.panorama.getPov, true, function() { svv.tracker.push('GSVInfoButton_Click'); },
            function() { svv.tracker.push('GSVInfoCopyToClipboard_Click'); },
            function() { svv.tracker.push('GSVInfoViewInGSV_Click'); },
            function() { return svv.panoramaContainer.getCurrentLabel().getAuditProperty('labelId'); }
        );

        svv.missionContainer = new MissionContainer();
        svv.missionContainer.createAMission(param.mission, param.progress);

        // Logs when the page's focus changes.
        function logPageFocus() {
            if (document.hasFocus()) {
                svv.tracker.push("PageGainedFocus");
            } else {
                svv.tracker.push("PageLostFocus");
            }
        }
        window.addEventListener("focus", function(event) {
            logPageFocus();
        });
        window.addEventListener("blur", function(event) {
            logPageFocus();
        });
        logPageFocus();

        svv.statusField.refreshLabelCountsDisplay();
        $('#sign-in-modal-container').on('hide.bs.modal', function () {
            svv.keyboard.enableKeyboard();
            $(".tool-ui").css('opacity', 1);
        });
        $('#sign-in-modal-container').on('show.bs.modal', function () {
            svv.keyboard.disableKeyboard();
            $(".tool-ui").css('opacity', 0.5);
        });

        const labelType = param.labelList[0].getAuditProperty('labelType');

        const missionStartTutorial = new MissionStartTutorial('validate', labelType, svv.tracker);
    }

    // Gets all the text on the validation page for the correct language.
    i18next.use(i18nextXHRBackend);
    i18next.init({
        backend: { loadPath: '/assets/locales/{{lng}}/{{ns}}.json' },
        fallbackLng: 'en',
        ns: ['validate', 'common'],
        defaultNS: 'validate',
        lng: param.language,
        debug: false
    }, function(err, t) {
        if(param.init !== "noInit") {
            _initUI();

            if (param.hasNextMission) {
                _init();
            } else {
                svv.keyboard = new Keyboard(svv.ui.validation);
                svv.form = new Form(param.dataStoreUrl);
                svv.tracker = new Tracker();
                svv.modalNoNewMission = new ModalNoNewMission(svv.ui.modalMission);
                svv.modalNoNewMission.show();
            }
        }
    });
}

/**
 * Logs information from the Validation interface
 * @returns {Tracker}
 * @constructor
 */
function Tracker() {
    let self = this;
    let panorama = undefined;
    let actions = [];
    let prevActions = [];

    function _init() {
        _trackWindowEvents();
    }

    function _trackWindowEvents() {
        let prefix = "LowLevelEvent_";

        // track all mouse related events
        $(document).on('mousedown mouseup mouseover mouseout mousemove click contextmenu dblclick', function(e) {
            self.push(prefix + e.type, {
                cursorX: 'pageX' in e ? e.pageX : null,
                cursorY: 'pageY' in e ? e.pageY : null
            });
        });

        // keyboard related events
        $(document).on('keydown keyup', function(e) {
            self.push(prefix + e.type, {
                keyCode: 'keyCode' in e ? e.keyCode : null
            });
        });
    }

    /**
     *
     * @param action
     * @param notes
     * @param extraData
     * @private
     */
    function _createAction(action, notes, extraData) {
        if (!notes) {
            notes = {};
        }

        if (!extraData) {
            extraData = {};
        }

        let note = _notesToString(notes);
        let timestamp = new Date().getTime();

        panorama = svv.panorama ? svv.panorama : null;
        let panoId = panorama ? panorama.getPanoId() : null;
        let position = panorama ? panorama.getPosition() : null;  // sometimes buggy, so position will be null.
        let pov = panorama ? panorama.getPov() : null;

        let missionContainer = svv.missionContainer ? svv.missionContainer : null;
        let currentMission = missionContainer ? missionContainer.getCurrentMission() : null;

        let data = {
            action: action,
            gsv_panorama_id: panoId,
            lat: position ? position.lat : null,
            lng: position ? position.lng : null,
            heading: pov ? pov.heading : null,
            mission_id: currentMission ? currentMission.getProperty("missionId") : null,
            note: note,
            pitch: pov ? pov.pitch : null,
            timestamp: timestamp,
            zoom: pov ? pov.zoom : null,
            is_mobile: isMobile()
        };

        return data;
    }

    function getActions() {
        return actions;
    }

    function _notesToString(notes) {
        if (!notes)
            return "";

        let noteString = "";
        for (let key in notes) {
            if (noteString.length > 0)
                noteString += ",";
            noteString += key + ':' + notes[key];
        }

        return noteString;
    }

    /**
     * Pushes information to action list (to be submitted to the database)
     * @param action    (required) Action
     * @param notes     (optional) Notes to be logged into the notes field database
     * @param extraData (optional) Extra data that should not be stored in the db notes field
     */
    function push(action, notes, extraData) {
        let item = _createAction(action, notes, extraData);
        actions.push(item);
        if (actions.length > 200) {
            let data = svv.form.compileSubmissionData();
            svv.form.submit(data, true);
        }
        return this;
    }

    /**
     * Empties actions stored in the Tracker.
     */
    function refresh() {
        prevActions = prevActions.concat(actions);
        actions = [];
        self.push("RefreshTracker");
    }

    _init();

    self.getActions = getActions;
    self.push = push;
    self.refresh = refresh;

    return this;
}

function Form(url, beaconUrl) {
    let properties = {
        dataStoreUrl : url,
        beaconDataStoreUrl : beaconUrl
    };

    /**
     * Compiles data into a format that can be parsed by our backend.
     * @returns {{}}
     */
    function compileSubmissionData() {
        let data = {};
        let missionContainer = svv.missionContainer;
        let mission = missionContainer ? missionContainer.getCurrentMission() : null;

        let labelContainer = svv.labelContainer;
        let labelList = labelContainer ? labelContainer.getCurrentLabels() : null;

        // Only submit mission progress if there is a mission when we're compiling submission data.
        if (mission) {
            // Add the current mission
            data.missionProgress = {
                mission_id: mission.getProperty("missionId"),
                mission_type: mission.getProperty("missionType"),
                labels_progress: mission.getProperty("labelsProgress"),
                label_type_id: mission.getProperty("labelTypeId"),
                completed: mission.getProperty("completed"),
                skipped: mission.getProperty("skipped")
            };
        }

        // Only label list if there is a label list when we're compiling submission data.
        if (labelList) {
            data.labels = svv.labelContainer.getCurrentLabels();
            svv.labelContainer.refresh();
        } else {
            data.labels = [];
        }

        data.environment = {
            mission_id: mission ? mission.getProperty("missionId") : null,
            browser: util.getBrowser(),
            browser_version: util.getBrowserVersion(),
            browser_width: $(window).width(),
            browser_height: $(window).height(),
            screen_width: screen.width,
            screen_height: screen.height,
            avail_width: screen.availWidth,              // total width - interface (taskbar)
            avail_height: screen.availHeight,            // total height - interface };
            operating_system: util.getOperatingSystem(),
            language: i18next.language
        };

        data.interactions = svv.tracker.getActions();
        svv.tracker.refresh();
        return data;
    }

    /**
     * Submits all front-end data to the backend.
     * @param data  Data object (containing Interactions, Missions, etc...)
     * @param async
     * @returns {*}
     */
    function submit(data, async) {
        if (typeof async === "undefined") {
            async = false;
        }

        if (data.constructor !== Array) {
            data = [data];
        }

        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: properties.dataStoreUrl,
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                if (result) {

                    // If the back-end says it is time to switch to auditing, then do it immediately (mostly to
                    // prevent turkers from modifying JS variables to prevent switching to auditing).
                    if (result.switch_to_auditing) window.location.replace('/audit');

                    // If a mission was returned after posting data, create a new mission.
                    if (result.hasMissionAvailable) {
                        if (result.mission) {
                            svv.missionContainer.createAMission(result.mission, result.progress);
                            svv.panoramaContainer.setLabelList(result.labels);
                            svv.panoramaContainer.reset();
                            svv.modalMissionComplete.setProperty('clickable', true);
                        }
                    } else {
                        // Otherwise, display popup that says there are no more labels left.
                        svv.modalMissionComplete.hide();
                        svv.modalNoNewMission.show();
                    }
                }
            },
            error: function (xhr, status, result) {
                console.error(xhr.responseText);
                console.error(result);
            }
        });
    }

    $(window).on('beforeunload', function () {
        svv.tracker.push("Unload");

        // April 17, 2019
        // What we want here is type: 'application/json'. Can't do that quite yet because the
        // feature has been disabled, but we should switch back when we can.
        //
        // // For now, we send plaintext and the server converts it to actual JSON
        //
        // Source for fix and ongoing discussion is here:
        // https://bugs.chromium.org/p/chromium/issues/detail?id=490015
        let data = [compileSubmissionData()];
        let jsonData = JSON.stringify(data);
        navigator.sendBeacon(properties.beaconDataStoreUrl, jsonData);
    });

    self.compileSubmissionData = compileSubmissionData;
    self.submit = submit;

    return self;
}

function Keyboard(menuUI) {
    let self = this;
    let lastShiftKeyDownTimestamp = undefined;
    let status = {
        disableKeyboard: false,
        keyPressed: false,
        shiftDown: false,
        addingComment: false
    };

    function disableKeyboard () {
        status.disableKeyboard = true;
    }

    function enableKeyboard () {
        status.disableKeyboard = false;
    }

    // Returns true if the user is currently typing in the validation comment text field, false otherwise.
    function textAreaSelected() {
        let selected = document.getElementById("validation-label-comment");
        document.activeElement === selected ?  status.addingComment = true : status.addingComment = false;
    }

    /**
     * Validate a single label using keyboard shortcuts.
     * @param button    jQuery element for the button clicked.
     * @param action    {String} Validation action. Must be either agree, disagree, or not sure.
     */
    function validateLabel (button, action, comment) {
        // Want at least 800ms in-between to allow GSV Panorama to load. (Value determined
        // experimentally).

        // It does not look like GSV StreetView supports any listeners that will check when the
        // panorama is fully loaded yet.
        let timestamp = new Date().getTime();
        if (timestamp - svv.panorama.getProperty('validationTimestamp') > 800) {
            button.toggleClass("validate");
            svv.tracker.push("ValidationKeyboardShortcut_" + action);
            svv.panorama.getCurrentLabel().validate(action, comment);
            svv.panorama.setProperty('validationTimestamp', timestamp);
            status.keyPressed = true;
        }
    }

    /**
     * Removes the visual effect of the buttons being pressed down.
     */
    function removeAllKeyPressVisualEffect () {
        menuUI.agreeButton.removeClass("validate");
        menuUI.disagreeButton.removeClass("validate");
        menuUI.notSureButton.removeClass("validate");
        status.keyPressed = false;
    }

    this._documentKeyDown = function (e) {
        // When the user is typing in the validation comment text field, temporarily disable keyboard
        // shortcuts that can be used to validate a label.
        textAreaSelected();
        let comment = document.getElementById('validation-label-comment').value;
        if (!status.disableKeyboard && !status.keyPressed && !status.addingComment) {
            status.shiftDown = e.shiftKey;
            svv.labelVisibilityControl.hideTagsAndDeleteButton();
            switch (e.keyCode) {
                // shift key
                case 16:
                    // Store the timestamp here so that we can check if the z-up event is
                    // within the buffer range
                    lastShiftKeyDownTimestamp = e.timeStamp;
                    break;
                // "a" key
                case 65:
                    validateLabel(menuUI.agreeButton, "Agree", comment);
                    menuUI.disagreeButton.removeClass("validate");
                    menuUI.notSureButton.removeClass("validate");
                    break;
                // "d" key
                case 68:
                    validateLabel(menuUI.disagreeButton, "Disagree", comment);
                    menuUI.agreeButton.removeClass("validate");
                    menuUI.notSureButton.removeClass("validate");
                    break;
                // "h" key
                case 72:
                    if (svv.labelVisibilityControl.isVisible()) {
                        svv.labelVisibilityControl.hideLabel();
                        svv.tracker.push("KeyboardShortcut_HideLabel", {
                            keyCode: e.keyCode
                        });
                    } else {
                        svv.labelVisibilityControl.unhideLabel();
                        svv.tracker.push("KeyboardShortcut_UnhideLabel", {
                            keyCode: e.keyCode
                        });
                    }
                    break;
                // "n" key
                case 78:
                    validateLabel(menuUI.notSureButton, "NotSure", comment);
                    menuUI.agreeButton.removeClass("validate");
                    menuUI.disagreeButton.removeClass("validate");
                    break;
                // "z" key
                case 90:
                    // Zoom out when shift + z keys are pressed.
                    if (status.shiftDown || (e.timeStamp - lastShiftKeyDownTimestamp) < 100) {
                        // Zoom out
                        svv.zoomControl.zoomOut();
                        svv.tracker.push("KeyboardShortcut_ZoomOut", {
                            keyCode: e.keyCode
                        });
                    // Zoom in when just the z key is pressed.
                    } else {
                        svv.zoomControl.zoomIn();
                        svv.tracker.push("KeyboardShortcut_ZoomIn", {
                            keyCode: e.keyCode
                        });
                    }
                    break;
            }
        }
    };

    this._documentKeyUp = function (e) {
        if (!status.disableKeyboard && !status.addingComment) {
            switch (e.keyCode) {
                // "a" key
                case 65:
                    menuUI.agreeButton.removeClass("validate");
                    status.keyPressed = false;
                    break;
                // "d" key
                case 68:
                    menuUI.disagreeButton.removeClass("validate");
                    status.keyPressed = false;
                    break;
                // "n" key
                case 78:
                    menuUI.notSureButton.removeClass("validate");
                    status.keyPressed = false;
                    break;
            }
        }
    };

    $(document).bind('keyup', this._documentKeyUp);
    $(document).bind('keydown', this._documentKeyDown);

    self.disableKeyboard = disableKeyboard;
    self.enableKeyboard = enableKeyboard;
    self.removeAllKeyPressVisualEffect = removeAllKeyPressVisualEffect;

    return this;
}

/**
 * Represents a validation label.
 * @returns {Label}
 * @constructor
 */
function Label(params) {
    // Original properties of the label collected through the audit interface. These properties are initialized from
    // metadata from the backend. These properties are used to help place the label on the validation interface and
    // should not be changed.
    let auditProperties = {
        canvasHeight: undefined,
        canvasWidth: undefined,
        canvasX: undefined,
        canvasY: undefined,
        gsvPanoramaId: undefined,
        imageDate: undefined,
        labelTimestamp: undefined,
        heading: undefined,
        labelId: undefined,
        labelType: undefined,
        pitch: undefined,
        zoom: undefined,
        severity: undefined,
        temporary: undefined,
        description: undefined,
        streetEdgeId: undefined,
        regionId: undefined,
        tags: undefined,
        isMobile: undefined
    };

    // These properties are set through validating labels. In this object, canvas properties and
    // heading/pitch/zoom are from the perspective of the user that is validating the labels.
    let properties = {
        canvasX: undefined,
        canvasY: undefined,
        endTimestamp: undefined,
        heading: undefined,
        pitch: undefined,
        startTimestamp: undefined,
        validationResult: undefined,
        zoom: undefined,
        isMobile: undefined
    };

    let icons = {
        CurbRamp : '/assets/images/icons/AdminTool_CurbRamp.png',
        NoCurbRamp : '/assets/images/icons/AdminTool_NoCurbRamp.png',
        Obstacle : '/assets/images/icons/AdminTool_Obstacle.png',
        SurfaceProblem : '/assets/images/icons/AdminTool_SurfaceProblem.png',
        Other : '/assets/images/icons/AdminTool_Other.png',
        Occlusion : '/assets/images/icons/AdminTool_Other.png',
        NoSidewalk : '/assets/images/icons/AdminTool_NoSidewalk.png',
        Crosswalk : '/assets/images/icons/AdminTool_Crosswalk.png',
        Signal : '/assets/images/icons/AdminTool_Signal.png'
    };

    if (isMobile()) {
        icons = {
            CurbRamp : '/assets/images/icons/AdminTool_CurbRamp_Mobile.png',
            NoCurbRamp : '/assets/images/icons/AdminTool_NoCurbRamp_Mobile.png',
            Obstacle : '/assets/images/icons/AdminTool_Obstacle_Mobile.png',
            SurfaceProblem : '/assets/images/icons/AdminTool_SurfaceProblem_Mobile.png',
            Other : '/assets/images/icons/AdminTool_Other_Mobile.png',
            Occlusion : '/assets/images/icons/AdminTool_Other_Mobile.png',
            NoSidewalk : '/assets/images/icons/AdminTool_NoSidewalk_Mobile.png',
            Crosswalk : '/assets/images/icons/AdminTool_Crosswalk_Mobile.png',
            Signal : '/assets/images/icons/AdminTool_Signal_Mobile.png'
        };
    }

    // Labels are circles with a 10px radius, mobile is 25px.
    let radius = 10;

    if (isMobile()) {
        radius = 25;
    }

    let self = this;

    /**
     * Initializes a label from metadata (if parameters are passed in)
     * @private
     */
    function _init() {
        if (params) {
            if ("canvas_height" in params) setAuditProperty("canvasHeight", params.canvas_height);
            if ("canvas_width" in params) setAuditProperty("canvasWidth", params.canvas_width);
            if ("canvas_x" in params) setAuditProperty("canvasX", params.canvas_x);
            if ("canvas_y" in params) setAuditProperty("canvasY", params.canvas_y);
            if ("gsv_panorama_id" in params) setAuditProperty("gsvPanoramaId", params.gsv_panorama_id);
            if ("image_date" in params) setAuditProperty("imageDate", params.image_date);
            if ("label_timestamp" in params) setAuditProperty("labelTimestamp", params.label_timestamp);
            if ("heading" in params) setAuditProperty("heading", params.heading);
            if ("label_id" in params) setAuditProperty("labelId", params.label_id);
            if ("label_type" in params) setAuditProperty("labelType", params.label_type);
            if ("pitch" in params) setAuditProperty("pitch", params.pitch);
            if ("zoom" in params) setAuditProperty("zoom", params.zoom);
            if ("severity" in params) setAuditProperty("severity", params.severity);
            if ("temporary" in params) setAuditProperty("temporary", params.temporary);
            if ("description" in params) setAuditProperty("description", params.description);
            if ("street_edge_id" in params) setAuditProperty("streetEdgeId", params.street_edge_id);
            if ("region_id" in params) setAuditProperty("regionId", params.region_id);
            if ("tags" in params) setAuditProperty("tags", params.tags);
            setAuditProperty("isMobile", isMobile());
        }
    }

    /**
     * Gets the file path associated with the labels' icon type.
     * @returns {*} String - Path of image in the directory.
     */
    function getIconUrl() {
        return icons[auditProperties.labelType];
    }

    /**
     * Returns a specific originalProperty of this label.
     * @param key   Name of property.
     * @returns     Value associated with this key.
     */
    function getAuditProperty (key) {
        return key in auditProperties ? auditProperties[key] : null;
    }

    /**
     * Gets the position of this label from the POV from which it was originally placed.
     * @returns {heading: number, pitch: number}
     */
    function getPosition () {
        // This calculates the heading and position for placing this Label onto the panorama from
        // the same POV as when the user placed the label.
        let pos = svv.util.properties.panorama.getPosition(getAuditProperty('canvasX'),
            getAuditProperty('canvasY'), getAuditProperty('canvasWidth'),
            getAuditProperty('canvasHeight'), getAuditProperty('zoom'),
            getAuditProperty('heading'), getAuditProperty('pitch'));
        return pos;
    }

    /**
     * Gets the radius of this label.
     * @returns {number}
     */
    function getRadius () {
        return radius;
    }

    /**
     * Returns the entire properties object for this label.
     * @returns Object for properties.
     */
    function getProperties () {
        return properties;
    }

    /**
     * Gets a specific validation property of this label.
     * @param key   Name of property.
     * @returns     Value associated with this key.
     */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Sets the value of a single property in properties.
     * @param key   Name of property
     * @param value Value to set property to.
     */
    function setProperty(key, value) {
        properties[key] = value;
        return this;
    }

    function setAuditProperty(key, value) {
        auditProperties[key] = value;
        return this;
    }
    
    function prepareLabelCommentData(comment, position, pov, zoom) {
        let data = {
            comment: comment,
            label_id: svv.panorama.getCurrentLabel().getAuditProperty("labelId"),
            gsv_panorama_id: svv.panorama.getPanoId(),
            heading: pov.heading,
            lat: position.lat,
            lng: position.lng,
            pitch: pov.pitch,
            mission_id: svv.missionContainer.getCurrentMission().getProperty('missionId'),
            zoom: zoom
        };
        return data;
    }

    /**
     * Submit the comment.
     */
    function submitComment (data) {
        let url = "/validate/comment";
        let async = true;
        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: url,
            type: 'POST',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {},
            error: function(xhr, textStatus, error){
                console.error(xhr.statusText);
                console.error(textStatus);
                console.error(error);
            }
        });
    }

    /**
     * Updates validation status for Label, StatusField and logs interactions into Tracker. Occurs
     * when a validation button is clicked.
     *
     * NOTE: canvas_x and canvas_y are null when the label is not visible when validation occurs.
     *
     * @param validationResult  Must be one of the following: {Agree, Disagree, Notsure}.
     * @param comment An optional comment submitted with the validation.
     */
    function validate(validationResult, comment) {
        // This is the POV of the PanoMarker, where the PanoMarker would be loaded at the center
        // of the viewport.
        let pos = getPosition();
        let panomarkerPov = {
            heading: pos.heading,
            pitch: pos.pitch
        };

        // This is the POV of the viewport center - this is where the user is looking.
        let userPov = svv.panorama.getPov();
        let zoom = svv.panorama.getZoom();

        // Calculates the center xy coordinates of the Label on the current viewport.
        let pixelCoordinates = svv.util.properties.panorama.povToPixel3d(panomarkerPov, userPov,
            zoom, svv.canvasWidth, svv.canvasHeight);

        // If the user has panned away from the label and it is no longer visible on the canvas, set canvasX/Y to null.
        // We add/subtract the radius of the label so that we still record these values when only a fraction of the
        // label is still visible.
        let labelCanvasX = null;
        let labelCanvasY = null;
        if (pixelCoordinates
            && pixelCoordinates.left + getRadius() > 0
            && pixelCoordinates.left - getRadius() < svv.canvasWidth
            && pixelCoordinates.top + getRadius() > 0
            && pixelCoordinates.top - getRadius() < svv.canvasHeight) {

            labelCanvasX = pixelCoordinates.left - getRadius();
            labelCanvasY = pixelCoordinates.top - getRadius();
        }

        setProperty("endTimestamp", new Date().getTime());
        setProperty("canvasX", labelCanvasX);
        setProperty("canvasY", labelCanvasY);
        setProperty("heading", userPov.heading);
        setProperty("pitch", userPov.pitch);
        setProperty("zoom", userPov.zoom);
        setProperty("isMobile", isMobile());

        if (comment) {
            document.getElementById('validation-label-comment').value = '';
            svv.tracker.push("ValidationTextField_DataEntered");
            let data = prepareLabelCommentData(comment, svv.panorama.getPosition(), userPov, zoom);
            submitComment(data);
        }

        switch (validationResult) {
            // Agree option selected.
            case "Agree":
                setProperty("validationResult", 1);
                svv.missionContainer.getCurrentMission().updateValidationResult(1);
                svv.labelContainer.push(getAuditProperty('labelId'), getProperties());
                svv.missionContainer.updateAMission();
                break;
            // Disagree option selected.
            case "Disagree":
                setProperty("validationResult", 2);
                svv.missionContainer.getCurrentMission().updateValidationResult(2);
                svv.labelContainer.push(getAuditProperty('labelId'), getProperties());
                svv.missionContainer.updateAMission();
                break;
            // Not sure option selected.
            case "NotSure":
                setProperty("validationResult", 3);
                svv.missionContainer.getCurrentMission().updateValidationResult(3);
                svv.labelContainer.push(getAuditProperty('labelId'), getProperties());
                svv.missionContainer.updateAMission();
                break;
        }

        // If there are more labels left to validate, add a new label to the panorama. Otherwise, we will load a new
        // label onto the panorama from Form.js - where we still need to retrieve 10 more labels for the next mission.
        if (!svv.missionContainer.getCurrentMission().isComplete()) {
            svv.panoramaContainer.loadNewLabelOntoPanorama();
        }
    }

    _init();

    self.getAuditProperty = getAuditProperty;
    self.getIconUrl = getIconUrl;
    self.getProperty = getProperty;
    self.getProperties = getProperties;
    self.setProperty = setProperty;
    self.getPosition = getPosition;
    self.getRadius = getRadius;
    self.validate = validate;

    return this;
}

/**
 * Keeps track of labels that have appeared on the panorama
 * @returns {LabelContainer}
 * @constructor
 */
function LabelContainer() {
    let self = this;
    let currentLabels = [];
    let previousLabels = [];

    /**
     * Gets a list of current labels that have not been sent to the backend yet.
     * @returns {Array}
     */
    function getCurrentLabels() {
        return currentLabels;
    }

    /**
     * Pushes a label to the list of current labels.
     * @param labelId           Integer label ID
     * @param labelMetadata     Label metadata (validationProperties object)
     */
    function push(labelId, labelMetadata) {
        let data = {
            canvas_height: svv.canvasHeight,
            canvas_width: svv.canvasWidth,
            canvas_x: labelMetadata.canvasX,
            canvas_y: labelMetadata.canvasY,
            end_timestamp: labelMetadata.endTimestamp,
            heading: labelMetadata.heading,
            label_id: labelId,
            mission_id: svv.missionContainer.getCurrentMission().getProperty("missionId"),
            pitch: labelMetadata.pitch,
            start_timestamp: labelMetadata.startTimestamp,
            validation_result: labelMetadata.validationResult,
            zoom: labelMetadata.zoom,
            is_mobile: labelMetadata.isMobile
        };
        currentLabels.push(data);
    }

    /**
     * Moves the currentLabels to previousLabels and clears the currentLabels array.
     */
    function refresh() {
        previousLabels.concat(currentLabels);
        currentLabels = [];
    }

    self.getCurrentLabels = getCurrentLabels;
    self.push = push;
    self.refresh = refresh;

    return this;
}

/**
 * Validation description box. Manages the information
 * displayed on the description box.
 *
 * @returns {LabelDescriptionBox}
 * @constructor
 */
function LabelDescriptionBox () {
    let self = this;
    let descriptionBox = $("#label-description-box");

    let smileyScale = {
        1: '/assets/javascripts/SVLabel/img/misc/SmileyScale_1_White_Small.png',
        2: '/assets/javascripts/SVLabel/img/misc/SmileyScale_2_White_Small.png',
        3: '/assets/javascripts/SVLabel/img/misc/SmileyScale_3_White_Small.png',
        4: '/assets/javascripts/SVLabel/img/misc/SmileyScale_4_White_Small.png',
        5: '/assets/javascripts/SVLabel/img/misc/SmileyScale_5_White_Small.png'
    };

    /**
     * Sets the box's descriptions for the given label.
     *
     * @param label The label whose information is to be shown
     * on the box.
     */
    function setDescription(label) {
        let desBox = descriptionBox[0];
        desBox.style.width = 'auto';
        $(desBox).empty();

        let severity = label.getAuditProperty('severity');
        let temporary = label.getAuditProperty('temporary');
        let description = label.getAuditProperty('description');
        let tags = label.getAuditProperty('tags');

        desBox.style['background-color'] = util.misc.getLabelColors(label.getAuditProperty('labelType'));

        if (severity && severity != 0) {
            let span = document.createElement('span');
            let htmlString = document.createTextNode(i18next.t('common:severity') + ": " +  severity + ' ');
            desBox.appendChild(htmlString);
            let img = document.createElement('img');
            img.setAttribute('src', smileyScale[severity]);
            if (isMobile()) {
                img.setAttribute('width', '20px');
                img.setAttribute('height', '20px');
            } else {
                img.setAttribute('width', '12px');
                img.setAttribute('height', '12px');
            }

            img.style.verticalAlign = 'middle';
            span.appendChild(img);
            desBox.appendChild(span);
            desBox.appendChild(document.createElement("br"));
        }

        if (temporary) {
            let htmlString = document.createTextNode(i18next.t('temporary'));
            desBox.appendChild(htmlString);
            desBox.appendChild(document.createElement("br"));
        }

        if (tags && tags.length > 0) {
            // Translate to correct language and separate tags with a comma.
            let tag = tags.map(t => i18next.t('common:tag.' + t)).join(', ');
            let htmlString = document.createTextNode(i18next.t('common:tags') + ": " + tag);
            desBox.appendChild(htmlString);
            desBox.appendChild(document.createElement("br"));
        }

        if (description && description.trim().length > 0) {
            let htmlString = document.createTextNode(i18next.t('user-description') + description);
            desBox.appendChild(htmlString);
        }

        if (!severity && !temporary && (!description || description.trim().length == 0) &&
           (!tags || tags.length == 0)) {
            let htmlString = document.createTextNode(i18next.t('center-ui.no-info'));
            desBox.appendChild(htmlString);
        }

        // Set the width of the des box.
        let bound = desBox.getBoundingClientRect();
        let width = ((bound.right - bound.left) * (isMobile() ? window.devicePixelRatio : 1)) + 'px';
        desBox.style.width = width;

        if (isMobile()) {
            desBox.style.fontSize = '30px';
        }
    }

    self.setDescription = setDescription;
    return this;
}


/**
 * Handles the hiding and showing of labels in the Google StreetView panorama.
 * This is also called by the Keyboard class to deal with hiding the label
 * via keyboard shortcuts.
 * @returns {LabelVisibilityControl}
 * @constructor
 */
function LabelVisibilityControl () {
    let self = this;
    let visible = true;
    let labelVisibilityControlButton = $("#label-visibility-control-button");
    let labelVisibilityButtonOnPano = $("#label-visibility-button-on-pano");
    let labelDescriptionBox = $("#label-description-box");
    let buttonUiVisibilityControlHide = i18next.t('top-ui.visibility-control-hide');
    let buttonUiVisibilityControlShow = i18next.t('top-ui.visibility-control-show');

    /**
     * Logs interaction when the hide label button is clicked.
     */
    function clickAdjustLabel () {
        if (visible) {
            svv.tracker.push("Click_HideLabel");
            hideLabel();
        } else {
            svv.tracker.push("Click_UnhideLabel");
            unhideLabel(false);
        }
    }

    /**
     * Unhides label in Google StreetView Panorama
     * depending on current state.
     * @param {boolean} newLabel Indicates whether we unhide due to showing a new label vs. clicking the unhide button.
     */
    function unhideLabel (newLabel) {
        let panomarker = svv.panorama.getPanomarker();
        let label = svv.panorama.getCurrentLabel();
        panomarker.setIcon(label.getIconUrl());
        panomarker.draw();
        visible = true;
        let htmlString = `${buttonUiVisibilityControlHide}</button>`;
        labelVisibilityButtonOnPano.html(htmlString);
        htmlString = `<img src="assets/javascripts/SVValidate/img/HideLabel.svg" class="label-visibility-control-button-icon" alt="Hide Label">
        <br />${buttonUiVisibilityControlHide}</button>`;
        labelVisibilityControlButton.html(htmlString);
        // If we are unhiding because the user is moving on to their next label, then Panomarker.js adds the outline.
        if (!newLabel) {
            panomarker.marker_.classList.add('icon-outline');
        }
    }

    /**
     * Hides label in Google StreetView Panorama.
     */
    function hideLabel () {
        let panomarker = svv.panorama.getPanomarker();
        panomarker.setIcon("assets/javascripts/SVLabel/img/icons/Label_Outline.svg");
        panomarker.draw();
        visible = false;
        let htmlString = `${buttonUiVisibilityControlShow}</button>`;
        labelVisibilityButtonOnPano.html(htmlString);
        htmlString = `<img src="assets/javascripts/SVValidate/img/ShowLabel.svg" class="label-visibility-control-button-icon" alt="Hide Label">
        <br />${buttonUiVisibilityControlShow}</button>`;
        labelVisibilityControlButton.html(htmlString);
        panomarker.marker_.classList.remove('icon-outline');
    }

    /**
     * Refreshes label visual state
     */
    function refreshLabel () {
        let htmlString = `<img src="assets/javascripts/SVValidate/img/HideLabel.svg" class="label-visibility-control-button-icon" alt="Hide Label">
        <br /><u>H</u>ide Label</button>`;
        labelVisibilityControlButton.html(htmlString);
        labelVisibilityControlButton.css({
            "background": ""
        });
    }

    /**
     * Returns true if label is currently not hidden, false otherwise.
     */
    function isVisible () {
        return visible;
    }

    /**
     * Shows the 'Show/Hide Label' button and the description box on panorama.
     */
    function showTagsAndDeleteButton () {
        svv.tracker.push("MouseOver_Label");

        let button = document.getElementById("label-visibility-button-on-pano");
        let marker = document.getElementById("validate-pano-marker");

        // Position the button to the top right corner of the label, 10px right and
        // 15px up from center of the label.
        button.style.left = (parseFloat(marker.style.left) + 10) + 'px';
        button.style.top = (parseFloat(marker.style.top) - 15) + 'px';
        button.style.visibility = 'visible';
        
        // Position the box to the lower left corner of the label, 10px left and
        // 10px down from center of the label.
        let desBox = labelDescriptionBox[0];
        desBox.style.right = (svv.canvasWidth - parseFloat(marker.style.left) - 10) + 'px';
        desBox.style.top = (parseFloat(marker.style.top) + 10) + 'px';
        desBox.style.visibility = 'visible';
    }

    /**
     * Hides the 'Show/Hide Label' button and the description box on GSV pano.
     */
    function hideTagsAndDeleteButton () {
        labelVisibilityButtonOnPano[0].style.visibility = 'hidden';
        labelDescriptionBox[0].style.visibility = 'hidden';
    }

    labelVisibilityControlButton.on('click', clickAdjustLabel);
    labelVisibilityButtonOnPano.on('click', clickAdjustLabel);
    labelVisibilityButtonOnPano.on('mouseover', function (e) {
        showTagsAndDeleteButton();
        e.stopPropagation();
    });
    labelVisibilityButtonOnPano.on('mouseout', hideTagsAndDeleteButton);

    self.hideLabel = hideLabel;
    self.unhideLabel = unhideLabel;
    self.refreshLabel = refreshLabel;
    self.isVisible = isVisible;
    self.showTagsAndDeleteButton = showTagsAndDeleteButton;
    self.hideTagsAndDeleteButton = hideTagsAndDeleteButton;

    // Call unhideLabel() to start the page with showing the 'hide label' button.
    self.unhideLabel(true);
    return this;
}


/**
 * Initializes a grouping of menu buttons (agree, disagree, and not sure).
 * @constructor
 */
function MenuButton(menuUI) {
    let self = this;

    menuUI.agreeButton.click(function() {
        validateLabel("Agree");
    });

    menuUI.disagreeButton.click(function() {
        validateLabel("Disagree");
    });

    menuUI.notSureButton.click(function() {
        validateLabel("NotSure");
    });

    // Sends data to database based on when user clicks the validation text area. A check must be performed in order to
    // verify that the text area exists since it currently is not available on mobile.
    if (document.getElementById('validation-label-comment')) {
        document.getElementById('validation-label-comment').onclick = () => {
                svv.tracker.push("ValidationTextField_MouseClick");
        }
    }

    /**
     * Validates a single label from a button click.
     * @param action    {String} Validation action - must be agree, disagree, or not sure.
     */
    function validateLabel (action) {
        let timestamp = new Date().getTime();
        svv.tracker.push("ValidationButtonClick_" + action);

        // Resets CSS elements for all buttons to their default states.
        menuUI.agreeButton.removeClass("validate");
        menuUI.disagreeButton.removeClass("validate");
        menuUI.notSureButton.removeClass("validate");
        
        let comment = '';
        let validationTextArea = document.getElementById('validation-label-comment');
        if (validationTextArea && validationTextArea.value !== '') comment = validationTextArea.value;

        // If enough time has passed between validations, log validations.
        if (timestamp - svv.panorama.getProperty('validationTimestamp') > 800) {
            svv.panoramaContainer.validateLabel(action, timestamp, comment);
        }
    }

    return self;
}

/**
 * Represents a single validation mission
 * @param params  Mission metadata passed in from MissionContainer.js
 * @returns {Mission} object.
 * @constructor
 */
function Mission(params) {
    let self = this;
    let properties = {
        agreeCount: 0,
        disagreeCount: 0,
        missionId: undefined,
        missionType: undefined,
        completed: undefined,
        labelsProgress: undefined,
        labelTypeId: undefined,
        labelsValidated: undefined,
        notSureCount: 0,
        pay: undefined,
        paid: undefined,
        skipped: undefined
    };

    /**
     * Initializes a front-end mission object from metadata.
     */
    function _init() {
        if ("agreeCount" in params) setProperty("agreeCount", params.agreeCount);
        if ("disagreeCount" in params) setProperty("disagreeCount", params.disagreeCount);
        if ("missionId" in params) setProperty("missionId", params.missionId);
        if ("missionType" in params) setProperty("missionType", params.missionType);
        if ("regionId" in params) setProperty("regionId", params.regionId);
        if ("completed" in params) setProperty("completed", params.completed);
        if ("pay" in params) setProperty("pay", params.pay);
        if ("paid" in params) setProperty("paid", params.paid);
        if ("labelsProgress" in params) setProperty("labelsProgress", params.labelsProgress);
        if ("labelsValidated" in params) setProperty("labelsValidated", params.labelsValidated);
        if ("labelTypeId" in params) setProperty("labelTypeId", params.labelTypeId);
        if ("notSureCount" in params) setProperty("notSureCount", params.notSureCount);
        if ("skipped" in params) setProperty("skipped", params.skipped);
    }

    /**
     * Gets a single property for this mission object.
     * @param key   String representation of property.
     * @returns     Property if it exists, null otherwise.
     */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Returns all properties associated with this mission.
     * @returns Object for properties.
     */
    function getProperties() {
        return properties;
    }

    /**
     * Function that checks if the current mission is complete.
     * @returns {property} True if this mission is complete, false if in progress.
     */
    function isComplete() {
        return getProperty("completed");
    }

    /**
     * Sets a property of this mission.
     * @param key       Name of property.
     * @param value     Value.
     * @returns {setProperty}
     */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Updates status bar (UI) and current mission properties.
     * @param skip (bool) - If true, the user clicked the skip button and the progress will not
     *                      increase. If false the user clicked agree, disagree, or not sure and
     *                      progress will increase.
     */
    function updateMissionProgress(skip) {
        let labelsProgress = getProperty("labelsProgress");
        if (labelsProgress < getProperty("labelsValidated")) {
            if (!skip) {
                labelsProgress += 1;
            }
            svv.statusField.incrementLabelCounts();
            setProperty("labelsProgress", labelsProgress);

            // Submit mission if mission is complete
            if (labelsProgress >= getProperty("labelsValidated")) {
                setProperty("completed", true);
                svv.missionContainer.completeAMission();
            }
        }

        let completionRate = labelsProgress / getProperty("labelsValidated");
        svv.statusField.setProgressBar(completionRate);
        svv.statusField.setProgressText(completionRate);
    }

    /**
     * Updates the validation result for this mission by incrementing agree, disagree and not sure
     * counts collected in this mission. (Only persists for current session)
     * @param result Validation result - Can either be agree, disagree, or not sure.
     */
    function updateValidationResult(result) {
        switch (result) {
            case 1:
                setProperty("agreeCount", getProperty("agreeCount") + 1);
                break;
            case 2:
                setProperty("disagreeCount", getProperty("disagreeCount") + 1);
                break;
            case 3:
                setProperty("notSureCount", getProperty("notSureCount") + 1);
                break;
        }
    }

    self.isComplete = isComplete;
    self.getProperties = getProperties;
    self.getProperty = getProperty;
    self.setProperty = setProperty;
    self.updateMissionProgress = updateMissionProgress;
    self.updateValidationResult = updateValidationResult;

    _init();
    return self;
}

/**
 *
 * @returns {MissionContainer}
 * @constructor
 */
function MissionContainer () {
    let self = this;
    let currentMission = undefined;
    let _completedMissions = [];

    /**
     * Adds a mission to in progress or list of completed missions
     * @param mission
     * @private
     */
    function addAMission(mission) {
        if (mission.getProperty("completed")) {
            _addToCompletedMissions(mission);
        } else {
            currentMission = mission;
            svv.statusField.reset(mission);
        }
        return this;
    }

    /**
     * This function adds the current mission to a list of completed missions.
     * @param mission  Mission object of the current mission.
     * @private
     */
    function _addToCompletedMissions(mission) {
        let existingMissionIds = _completedMissions.map(function (m) {
            return m.getProperty("missionId")
        });
        let currentMissionId = mission.getProperty("missionId");
        if (existingMissionIds.indexOf(currentMissionId) < 0) {
            _completedMissions.push(mission);
        }
    }

    /**
     * Submits this mission to the backend.
     */
    function completeAMission () {
        svv.missionsCompleted += 1;
        svv.modalMissionComplete.show(currentMission);
        let data = svv.form.compileSubmissionData();
        svv.form.submit(data, true);
        _addToCompletedMissions(currentMission);
    }

    /**
     * Creates a mission by parsing a JSON file
     * @param missionMetadata   JSON metadata for mission (from backend)
     * @param progressMetadata  JSON metadata about mission progress
     *                          (counts of agree/disagree/notsure labels for this mission)
     * @private
     */
    function createAMission(missionMetadata, progressMetadata) {
        let metadata = {
            agreeCount: progressMetadata.agree_count,
            completed : missionMetadata.completed,
            disagreeCount: progressMetadata.disagree_count,
            labelsProgress : missionMetadata.labels_progress,
            labelsValidated : missionMetadata.labels_validated,
            labelTypeId : missionMetadata.label_type_id,
            missionId : missionMetadata.mission_id,
            missionType : missionMetadata.mission_type,
            notSureCount: progressMetadata.not_sure_count,
            skipped : missionMetadata.skipped,
            pay: missionMetadata.pay
        };
        let mission = new Mission(metadata);
        addAMission(mission);
        svv.modalMission.setMissionMessage(mission);
        svv.modalInfo.setMissionInfo(mission);
        svv.statusField.refreshLabelCountsDisplay();
    }

    /**
     * Returns the current mission in progress.
     * @returns Mission object for the current mission.
     */
    function getCurrentMission() {
        return currentMission;
    }

    /**
     * Updates the status of the current mission.
     */
    function updateAMission() {
        currentMission.updateMissionProgress(false);
    }

    /**
     * Updates the status of the current mission if client clicked the skip button.
     */
    function updateAMissionSkip() {
        currentMission.updateMissionProgress(true);
    }

    self.addAMission = addAMission;
    self.completeAMission = completeAMission;
    self.createAMission = createAMission;
    self.getCurrentMission = getCurrentMission;
    self.updateAMission = updateAMission;
    self.updateAMissionSkip = updateAMissionSkip;

    return this;
}

/**
 * Handles feedback button functionality. Allows users to submit feedback, which is logged to the
 * validation_task_interaction table.
 * @param modalUI   UI elements related to feedback (button, dialog box buttons)
 * @returns {ModalComment}
 * @constructor
 */
function ModalComment (modalUI) {
    let self = this;
    let status = {
        disableClickOk: true
    };

    // Initializing feedback popover 
    modalUI.feedbackButton.popover();

    /**
     * Disables the ok button (makes button unclickable).
     */
    function disableClickOk () {
        modalUI.ok.attr("disabled", true);
        modalUI.ok.addClass("disabled");
        status.disableClickOk = true;
    }

    /**
     * Enables the ok button (makes button clickable).
     */
    function enableClickOk () {
        modalUI.ok.attr("disabled", false);
        modalUI.ok.removeClass("disabled");
        status.disableClickOk = false;
    }

    /**
     * Hides the comments dialog box.
     */
    function handleClickCancel () {
        svv.tracker.push("ModalComment_ClickCancel");
        hideCommentMenu();
    }

    /**
     * Shows the comments dialog box.
     */
    function handleClickFeedbackButton() {
        svv.tracker.push("ModalComment_ClickFeedback");
        showCommentMenu();
    }

    /**
     * Submits text in the comment box to the backend.
     */
    function handleClickOk () {
        svv.tracker.push("ModalComment_ClickOK");
        let data = prepareCommentData();
        submitComment(data);
        hideCommentMenu();
    }

    /**
     * Triggered when text is changed in the comments box. Will enable the "ok"
     * button if there is text.
     */
    function handleTextAreaChange () {
        let comment = modalUI.textarea.val();
        if (comment.length > 0) {
            enableClickOk();
        } else {
            disableClickOk();
        }
    }

    /**
     * Hides comment box, enables validation keyboard shortcuts
     */
    function hideCommentMenu () {
        modalUI.holder.addClass('hidden');
        hideBackground();
        svv.keyboard.enableKeyboard();
        svv.modalSkip.enableSkip();
    }

    function hideBackground () {
        svv.ui.modal.background.css({
            width: 0,
            height: 0
        });

        $('#svv-panorama').css('z-Index', '1');
    }

    /**
     * Displays the comment menu. Disables validation keyboard controls (may interfere with the
     * comment menu).
     */
    function showCommentMenu () {
        modalUI.textarea.val("");
        modalUI.holder.removeClass('hidden');
        disableClickOk();
        svv.keyboard.disableKeyboard();
        svv.modalSkip.disableSkip();
        showBackground();    // doesn't work as expected... overlay isn't applied to GSV pano
    }

    /**
     * Renders a transparent white overlay over the validation interface and side menus.
     */
    function showBackground () {
        svv.ui.modal.background.css('background-color', 'white');
        svv.ui.modal.background.css({
            width: '100%',
            height: '100%',
            opacity: '0.5',
            visibility: 'visible'
        });

        // SVV Panorama is not covered by overlay at regular z-index
        $('#svv-panorama').css('z-Index', '0');
    }

    /**
     * Submit the comment.
     */
    function submitComment (data) {
        let url = "/validate/comment";
        let async = true;
        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: url,
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                modalUI.feedbackButton.popover('toggle');
                setTimeout(function(){ modalUI.feedbackButton.popover('toggle'); }, 1500);
            },
            error: function(xhr, textStatus, error){
                console.error(xhr.statusText);
                console.error(textStatus);
                console.error(error);
            }
        });
    }

    /**
     * Converts comment and some validation interface data into an object to be sent to the backend.
     * @returns Comment data object {{comment, label_id, gsv_panorama_id: *, heading, lat, lng,
     * pitch, mission_id, zoom}}
     */
    function prepareCommentData () {
        let comment = modalUI.textarea.val();
        let position = svv.panorama.getPosition();
        let pov = svv.panorama.getPov();

        let data = {
            comment: comment,
            label_id: svv.panorama.getCurrentLabel().getAuditProperty("labelId"),
            gsv_panorama_id: svv.panorama.getPanoId(),
            heading: pov.heading,
            lat: position.lat,
            lng: position.lng,
            pitch: pov.pitch,
            mission_id: svv.missionContainer.getCurrentMission().getProperty('missionId'),
            zoom: pov.zoom
        };
        return data;
    }

    modalUI.cancel.on('click', handleClickCancel);
    modalUI.feedbackButton.on('click', handleClickFeedbackButton);
    modalUI.ok.on('click', handleClickOk);
    modalUI.textarea.on('input', handleTextAreaChange);

    return this;
}

/**
 * Handles info button functionality. Used for mobile. Pops up information about the current label.
 * @param uiModal
 * @param modalText
 * @returns {Modal Info}
 * @constructor
 */

function ModalInfo (uiModal, modalText) {
    let self = this;

    let infoHeaderHTML = '<p>What is a __LABELTYPE_PLACEHOLDER__?</p>';
    let descriptionHTML = '<p>__DESCRIPTION_PLACEHOLDER__</p>';

    function _handleButtonClick() {
        svv.tracker.push("ModalInfo_ClickOK");
        hide();
    }


    function hide () {
        uiModal.background.css('visibility', 'hidden');
        uiModal.holder.css('visibility', 'hidden');
        uiModal.foreground.css('visibility', 'hidden');
    }

    function setMissionInfo(mission) {
        let labelTypeId = mission.getProperty("labelTypeId");
        infoHeaderHTML = i18next.t(`mobile.info-title-${util.camelToKebab(svv.labelTypes[labelTypeId])}`);
        descriptionHTML = modalText[labelTypeId];
    }

    function show () {
        uiModal.background.css('visibility', 'visible');
        uiModal.holder.css('visibility', 'visible');
        uiModal.foreground.css('visibility', 'visible');
        uiModal.infoHeader.html(infoHeaderHTML);
        uiModal.description.html(descriptionHTML);
        uiModal.closeButton.html('x');
        uiModal.closeButton.on('click', _handleButtonClick);
    }

    uiModal.infoButton.on("click", show);

    self.hide = hide;
    self.setMissionInfo = setMissionInfo;
    self.show = show;

    return this;
}

/**
 * Displays modal popup if user is on mobile and in landscape mode.
 * @param uiModal
 * @returns {Modal Info}
 * @constructor
 */

function ModalLandscape (uiModal) {
    let self = this;

    function hide () {
        uiModal.background.css('visibility', 'hidden');
        uiModal.holder.css('visibility', 'hidden');
        uiModal.foreground.css('visibility', 'hidden');
    }

    function show () {
        uiModal.background.css('visibility', 'visible');
        uiModal.holder.css('visibility', 'visible');
        uiModal.foreground.css('visibility', 'visible');
    }

    self.hide = hide;
    self.show = show;

    return this;
}

function ModalMission (uiModalMission, user) {
    let self = this;

    let validationStartMissionHTML = ' <figure> \
        <img src="/assets/images/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>' + i18next.t('mission-start.body') + '</p>\
        <div class="spacer10"></div>';

    let validationResumeMissionHTML = ' <figure> \
        <img src="/assets/images/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>Continue validating  __LABELCOUNT_PLACEHOLDER__ __LABELTYPE_PLACEHOLDER__</span> labels placed by other users!</p>\
        <div class="spacer10"></div>';

    function _handleButtonClick() {
        let mission = svv.missionContainer.getCurrentMission();

        // Check added so that if a user begins a mission, leaves partway through, and then resumes the mission later,
        // another MissionStart will not be triggered
        if(mission.getProperty("labelsProgress") < 1) {
            svv.tracker.push(
                "MissionStart",
                {
                    missionId: mission.getProperty("missionId"),
                    missionType: mission.getProperty("missionType"),
                    labelTypeId: mission.getProperty("labelTypeId"),
                    labelsValidated: mission.getProperty("labelsValidated")
                }
            );
        }
        // Update zoom availability on desktop.
        if (svv.zoomControl) {
            svv.zoomControl.updateZoomAvailability();
        }
        hide();
    }

    /**
     * Hides the new/continuing mission screen.
     */
    function hide () {
        if (svv.keyboard) {
            // We still want to disable keyboard shortcuts if the comment box is shown.
            if ($('#modal-comment-box').is(":hidden")) {
                svv.keyboard.enableKeyboard();
            } else {
                svv.keyboard.disableKeyboard();
            }
        }
        uiModalMission.background.css('visibility', 'hidden');
        uiModalMission.holder.css('visibility', 'hidden');
        uiModalMission.foreground.css('visibility', 'hidden');
    }

    /**
     * Generates HTML for the new mission screen with information about the current mission
     * (label type, length of validation mission)
     * @param mission   Mission object for the new mission
     */
    function setMissionMessage(mission) {
        if (mission.getProperty("labelsProgress") === 0) {
            let validationMissionStartTitle = i18next.t('mission-start.title',
                {
                    n: mission.getProperty("labelsValidated"),
                    label_type: svv.labelTypeNames[mission.getProperty("labelTypeId")]
                });
            let validationStartMissionHTMLCopy = validationStartMissionHTML.replace("__LABELCOUNT_PLACEHOLDER__", mission.getProperty("labelsValidated"));
            validationStartMissionHTMLCopy = validationStartMissionHTMLCopy.replace("__LABELTYPE_PLACEHOLDER__", svv.labelTypeNames[mission.getProperty("labelTypeId")]);
            show(validationMissionStartTitle, validationStartMissionHTMLCopy);
        } else {
            validationMissionStartTitle = "Return to your mission";
            let validationResumeMissionHTMLCopy = validationResumeMissionHTML.replace("__LABELCOUNT_PLACEHOLDER__", mission.getProperty("labelsValidated"));
            validationResumeMissionHTMLCopy = validationResumeMissionHTMLCopy.replace("__LABELTYPE_PLACEHOLDER__", svv.labelTypeNames[mission.getProperty("labelTypeId")]);
            show(validationMissionStartTitle, validationResumeMissionHTMLCopy);
        }

        // Update the reward HTML if the user is a turker.
        if (!isMobile()) {
            if (user.getProperty("role") === "Turker") {
                let missionReward = mission.getProperty("pay");
                let missionRewardText = i18next.t('common:mission-start-turk-reward') + '<span class="bold" style="color: forestgreen;">$__REWARD_PLACEHOLDER__</span>';
                missionRewardText = missionRewardText.replace("__REWARD_PLACEHOLDER__", missionReward.toFixed(2));
                svv.ui.status.currentMissionReward.html(i18next.t('common:right-ui-turk-current-reward') + "<span style='color:forestgreen'>$" + missionReward.toFixed(2)) + "</span>";
                uiModalMission.rewardText.html(missionRewardText);

                $.ajax({
                    async: true,
                    url: '/rewardEarned',
                    type: 'get',
                    success: function (rewardData) {
                        svv.ui.status.totalMissionReward.html(i18next.t('common:right-ui-turk-total-reward') + "<span style='color:forestgreen'>$" + rewardData.reward_earned.toFixed(2)) + "</span>";
                    },
                    error: function (xhr, ajaxOptions, thrownError) {
                        console.log(thrownError);
                    }
                })
            }
        }
    }

    function show (title, instruction) {
        // Disable keyboard on mobile.
        if (svv.keyboard) {
            svv.keyboard.disableKeyboard();
        }
        if (instruction) {
            uiModalMission.instruction.html(instruction);
        }

        uiModalMission.background.css('visibility', 'visible');
        uiModalMission.missionTitle.html(title);
        uiModalMission.holder.css('visibility', 'visible');
        uiModalMission.foreground.css('visibility', 'visible');
        uiModalMission.closeButton.html('Ok');
        uiModalMission.closeButton.off('click').on('click', _handleButtonClick);
    }

    self.hide = hide;
    self.setMissionMessage = setMissionMessage;
    self.show = show;

    return this;
}

function ModalMissionComplete (uiModalMissionComplete, user) {
    let self = this;
    let properties = {
        clickable: false
    };
    let watch;

    function _handleButtonClick(event) {
        // If they've done three missions and clicked the audit button, load the audit page.
        if (event.data.button === 'primary' && svv.missionsCompleted % 3 === 0 && !isMobile()) {
            window.location.replace('/audit');
        } else {
            self.hide();
        }
    }

    function getProperty(key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Hides the mission complete menu. Waits until the next mission has been initialized and the
     * first label has been loaded onto the screen.
     */
    function hide () {
        // Have to remove the effect since keyup event did not go through (but no keyboard use on mobile).
        if (svv.keyboard) {
            svv.keyboard.removeAllKeyPressVisualEffect();
            svv.keyboard.enableKeyboard();
        }

        uiModalMissionComplete.closeButtonPrimary.off('click');
        uiModalMissionComplete.closeButtonSecondary.off('click');
        uiModalMissionComplete.background.css('visibility', 'hidden');
        uiModalMissionComplete.holder.css('visibility', 'hidden');
        uiModalMissionComplete.foreground.css('visibility', 'hidden');
        uiModalMissionComplete.closeButtonPrimary.css('visibility', 'hidden');
        uiModalMissionComplete.closeButtonSecondary.css('visibility', 'hidden');
    }

    function setProperty(key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Displays the mission complete screen.
     * @param mission   Object for the mission that was just completed.
     */
    function show (mission) {
        // Disable keyboard on mobile.
        if (svv.keyboard) {
            svv.keyboard.disableKeyboard();
        }
        let totalLabels = mission.getProperty("agreeCount") + mission.getProperty("disagreeCount")
            + mission.getProperty("notSureCount");
        let message = i18next.t('mission-complete.body-' + mission.getProperty('labelTypeId'), { n: totalLabels });

        // Disable user from clicking the "Validate next mission" button and set background to gray.
        uiModalMissionComplete.closeButtonPrimary.removeClass('btn-primary');
        uiModalMissionComplete.closeButtonPrimary.addClass('btn-loading');
        uiModalMissionComplete.closeButtonSecondary.removeClass('btn-secondary');
        uiModalMissionComplete.closeButtonSecondary.addClass('btn-loading');

        // Wait until next mission has been loaded before allowing the user to click the button.
        clearInterval(watch);
        watch = window.setInterval(function () {
            if (getProperty('clickable')) {
                // Enable button clicks, reset the CSS for primary/secondary close buttons.
                uiModalMissionComplete.closeButtonPrimary.removeClass('btn-loading');
                uiModalMissionComplete.closeButtonPrimary.addClass('btn-primary');
                uiModalMissionComplete.closeButtonPrimary.on('click', { button: 'primary' }, _handleButtonClick);
                uiModalMissionComplete.closeButtonSecondary.removeClass('btn-loading');
                uiModalMissionComplete.closeButtonSecondary.addClass('btn-secondary');
                uiModalMissionComplete.closeButtonSecondary.on('click', { button: 'secondary' }, _handleButtonClick);
                if (isMobile()) uiModalMissionComplete.closeButtonPrimary.css('font-size', '30pt');
                setProperty('clickable', false);
                clearInterval(watch);
            }
        }, 100);

        uiModalMissionComplete.background.css('visibility', 'visible');
        uiModalMissionComplete.missionTitle.html(i18next.t('mission-complete.title'));
        uiModalMissionComplete.message.html(message);
        uiModalMissionComplete.agreeCount.html(mission.getProperty("agreeCount"));
        uiModalMissionComplete.disagreeCount.html(mission.getProperty("disagreeCount"));
        uiModalMissionComplete.notSureCount.html(mission.getProperty("notSureCount"));
        uiModalMissionComplete.yourOverallTotalCount.html(svv.statusField.getCompletedValidations());

        uiModalMissionComplete.holder.css('visibility', 'visible');
        uiModalMissionComplete.foreground.css('visibility', 'visible');

        // Set button text to auditing if they've completed 3 validation missions (and are on a laptop/desktop). If they
        // are a turker, only give them the option to audit. O/w let them choose b/w auditing and validating.
        if (svv.missionsCompleted % 3 === 0 && !isMobile()) {
            uiModalMissionComplete.closeButtonPrimary.html(i18next.t('mission-complete.explore'));
            uiModalMissionComplete.closeButtonPrimary.css('visibility', 'visible');

            if (user.getProperty('role') === 'Turker') {
                uiModalMissionComplete.closeButtonPrimary.css('width', '100%');
                uiModalMissionComplete.closeButtonSecondary.css('visibility', 'hidden');
            } else {
                uiModalMissionComplete.closeButtonPrimary.css('width', '60%');
                uiModalMissionComplete.closeButtonSecondary.html(i18next.t('mission-complete.continue'));
                uiModalMissionComplete.closeButtonSecondary.css('visibility', 'visible');
                uiModalMissionComplete.closeButtonSecondary.css('width', '39%');
            }
        } else {
            uiModalMissionComplete.closeButtonPrimary.html(i18next.t('mission-complete.validate-more'));
            uiModalMissionComplete.closeButtonPrimary.css('visibility', 'visible');
            uiModalMissionComplete.closeButtonPrimary.css('width', '100%');

            uiModalMissionComplete.closeButtonSecondary.css('visibility', 'hidden');
        }
        if (isMobile()) uiModalMissionComplete.closeButtonPrimary.css('font-size', '30pt');

        svv.tracker.push(
            "MissionComplete",
            {
                missionId: mission.getProperty("missionId"),
                missionType: mission.getProperty("missionType"),
                labelTypeId: mission.getProperty("labelTypeId"),
                labelsValidated: mission.getProperty("labelsValidated")
            }
        );
    }

    self.getProperty = getProperty;
    self.hide = hide;
    self.setProperty = setProperty;
    self.show = show;
}

/**
 * Handles edge case if there are no more labels for this user to validate.
 * Creates an overlay that notifies user that there are no more labels left for them to validate
 * at the moment. Disables controls, shortcuts.
 * @returns {ModalNoNewMission}
 * @constructor
 */
function ModalNoNewMission (uiModalMission) {
    let self = this;

    let noMissionsRemaining = '<figure> \
        <img src="/assets/images/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>' + i18next.t('mission-complete.no-new-mission-body') + '</p>\
        <div class="spacer10"></div>';

    function _handleButtonClick() {
        svv.tracker.push("Click_NoMoreMissionModal_Audit");
        window.location.replace("/audit");
    }

    function show () {
        svv.keyboard.disableKeyboard();
        uiModalMission.background.css('visibility', 'visible');
        uiModalMission.instruction.html(noMissionsRemaining);
        uiModalMission.missionTitle.html(i18next.t('mission-complete.no-new-mission-title'));
        uiModalMission.holder.css('visibility', 'visible');
        uiModalMission.foreground.css('visibility', 'visible');
        uiModalMission.closeButton.html(i18next.t('mission-complete.no-new-mission-button'));
        uiModalMission.closeButton.on('click', _handleButtonClick);
    }

    self.show = show;

    return self;
}

/**
 * Handles skip button functionality. Allows users to validate different labels without affecting
 * their current validation mission progress.
 * @param uiModal   Skip button UI elements.
 * @returns {ModalSkip}
 * @constructor
 */
function ModalSkip (uiModal) {
    let status = {
        disableSkip: false
    };
    let self = this;

    /**
     * Enables the skip button (makes button clickable).
     */
    function enableSkip () {
        status.disableSkip = true;
        uiModal.skipButton.attr("disabled", false);
        uiModal.skipButton.removeClass("disabled");
    }

    /**
     * Disables the skip button (makes button unclickable).
     */
    function disableSkip () {
        status.disableSkip = false;
        uiModal.skipButton.attr("disabled", true);
        uiModal.skipButton.addClass("disabled");
    }

    /**
     * Skips this current label (does not change the user's current validation progress).
     */
    function skip () {
        svv.tracker.push("ModalSkip_ClickOK");
        svv.panorama.skipLabel();
    }

    uiModal.skipButton.on("click", skip);

    self.enableSkip = enableSkip;
    self.disableSkip = disableSkip;

    return this;
}

/*
 * An additional layer on top of the Google StreetView object on validation interface. This layer handles panning.
 */
function GSVOverlay () {
    let self = this;
    let panningDisabled = false;
    let viewControlLayer = $("#view-control-layer");

    // Mouse status and mouse event callback functions.
    let mouseStatus = {
        currX: 0,
        currY: 0,
        prevX: 0,
        prevY: 0,
        leftDownX: 0,
        leftDownY: 0,
        leftUpX: 0,
        leftUpY: 0,
        isLeftDown: false
    };

    /**
     * Disables panning on the GSV window.
     */
    function disablePanning() {
        panningDisabled = true;
    }

    /**
     * Enables panning on the GSV window.
     */
    function enablePanning() {
        panningDisabled = false;
    }

    /**
     * This is a callback function that is fired with the mouse down event on the view
     * control layer (where you control street view angle.)
     * @param e
     */
    function handlerViewControlLayerMouseDown (e) {
        mouseStatus.isLeftDown = true;
        mouseStatus.leftDownX = mouseposition(e, this).x;
        mouseStatus.leftDownY = mouseposition(e, this).y;
        viewControlLayer.css("cursor", "url(/assets/javascripts/SVLabel/img/cursors/closedhand.cur) 4 4, move");

        // This is necessary for supporting touch devices, because there is no mouse hover.
        mouseStatus.prevX = mouseposition(e, this).x;
        mouseStatus.prevY = mouseposition(e, this).y;
    }

    /**
     * This is a callback function that is called with mouse up event on
     * the view control layer (where you change the Google Street view angle.
     * @param e
     */
    function handlerViewControlLayerMouseUp (e) {
        viewControlLayer.css("cursor", "url(/assets/javascripts/SVLabel/img/cursors/openhand.cur) 4 4, move");
        mouseStatus.isLeftDown = false;
        mouseStatus.leftUpX = mouseposition(e, this).x;
        mouseStatus.leftUpY = mouseposition(e, this).y;
    }

    /**
     * Handles mouse leaving control view.
     * @param e
     */
    function handlerViewControlLayerMouseLeave (e) {
        viewControlLayer.css("cursor", "url(/assets/javascripts/SVLabel/img/cursors/openhand.cur) 4 4, move");
        mouseStatus.isLeftDown = false;
    }

    /**
     * This is a callback function that is fired when a user moves a mouse on the
     * view control layer where you change the pov.
     */
    function handlerViewControlLayerMouseMove (e) {
        mouseStatus.currX = mouseposition(e, this).x;
        mouseStatus.currY = mouseposition(e, this).y;

        let timestamp = new Date().getTime();  // Waits till the pano is fully loaded.
        if ((timestamp - svv.panorama.getProperty("prevSetPanoTimestamp") > 500)
            && mouseStatus.isLeftDown && panningDisabled === false) {
            // If a mouse is being dragged on the control layer, move the sv image.
            let dx = mouseStatus.currX - mouseStatus.prevX;
            let dy = mouseStatus.currY - mouseStatus.prevY;
            let pov = svv.panorama.getPov();
            let zoomLevel = pov.zoom;
            dx = dx / (2 * zoomLevel);
            dy = dy / (2 * zoomLevel);
            dx *= 1.5;
            dy *= 1.5;
            updatePov(dx, dy);
        }
        mouseStatus.prevX = mouseposition(e, this).x;
        mouseStatus.prevY = mouseposition(e, this).y;
    }

    /**
     * Update POV of Street View as a user drags their mouse cursor.
     * @param dx
     * @param dy
     */
    function updatePov (dx, dy) {
        let pano = svv.panorama.getPanorama();
        if (pano) {
            let pov = pano.getPov();
            let alpha = 0.25;
            pov.heading -= alpha * dx;
            pov.pitch += alpha * dy;
            pano.setPov(pov);
        } else {
            throw self.className + ' updatePov(): panorama not defined!';
        }
    }

    // A cross-browser function to capture mouse positions.
    function mouseposition (e, dom) {
        let mx;
        let my;
        //if(e.offsetX) {
            // Chrome
        //    mx = e.offsetX;
        //    my = e.offsetY;
        //} else {
        // Firefox, Safari
            mx = e.pageX - $(dom).offset().left;
            my = e.pageY - $(dom).offset().top;
        //}
        return {'x': parseInt(mx, 10) , 'y': parseInt(my, 10) };
    }

    viewControlLayer.bind('mousemove', handlerViewControlLayerMouseMove);
    viewControlLayer.bind('mousedown', handlerViewControlLayerMouseDown);
    viewControlLayer.bind('mouseup', handlerViewControlLayerMouseUp);
    viewControlLayer.bind('mouseleave', handlerViewControlLayerMouseLeave);

    self.disablePanning = disablePanning;
    self.enablePanning = enablePanning;

    return self;
}


/**
 * Creates and controls the Google StreetView panorama that is used in the validation
 * interface. Uses Panomarkers to place labels onto the Panorama.
 * @param label Initial label to load onto the panorama.
 * @constructor
 */
function Panorama (label) {
    let currentLabel = label;
    let panorama = undefined;
    let properties = {
        canvasId: 'svv-panorama',
        panoId: undefined,
        prevPanoId: undefined,
        prevSetPanoTimestamp: new Date().getTime(),
        validationTimestamp: new Date().getTime()
    };

    let panoCanvas = document.getElementById(properties.canvasId);
    let self = this;
    let streetViewService = new google.maps.StreetViewService();
    let bottomLinksClickable = false;

    // Determined manually by matching appearance of labels on the audit page and appearance of
    // labels on the validation page. Zoom is determined by FOV, not by how "close" the user is.
    let zoomLevel = {
        1: 1.1,
        2: 2.1,
        3: 3.1
    };

    /**
     * Initializes a Google StreetView Panorama and renders a label onto the screen.
     * @private
     */
    function _init () {
        _createNewPanorama();
        if (isMobile()) {
            sizePano();
        }
        _addListeners();

        // Issue: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2468
        // This line of code is here to fix the bug when zooming with ctr +/-, the screen turns black.
        // We are updating the pano POV slightly to simulate an update the gets rid of the black pano.
        $(window).on('resize', function() {
            let pov = panorama.getPov();
            pov.heading -= .01;
            pov.pitch -= .01;
            panorama.setPov(pov);
        });
        setLabel(currentLabel);
    }

    /**
     * Initializes a Google StreetView Panorama and disables most UI/Control settings.
     * @private
     */
    function _createNewPanorama () {
        if (typeof google != "undefined") {
            // Set control options
            panorama = new google.maps.StreetViewPanorama(panoCanvas);
            panorama.set('addressControl', false);
            panorama.set('clickToGo', false);
            panorama.set('disableDefaultUI', true);
            panorama.set('keyboardShortcuts', false);
            panorama.set('linksControl', false);
            panorama.set('motionTracking', false);
            panorama.set('motionTrackingControl', false);
            panorama.set('navigationControl', false);
            panorama.set('panControl', false); 
            panorama.set('showRoadLabels', false);
            panorama.set('zoomControl', false);
            if (!isMobile()) {
                panorama.set('scrollwheel', false);
            }
        } else {
            console.error("No typeof google");
        }
    }

    /**
     * Adds listeners to the panorama to log user interactions.
     * @private
     */
    function _addListeners () {
        panorama.addListener('pov_changed', _handlerPovChange);
        panorama.addListener('pano_changed', _handlerPanoChange);
        return this;
    }

    /**
     * Returns the label object for the label that is loaded on this panorama
     * @returns {Label}
     */
    function getCurrentLabel () {
        return currentLabel;
    }

    /**
     * Returns the actual StreetView object.
     */
    function getPanorama () {
        return panorama;
    }

    /**
     * Returns the list of labels to validate / to be validated in this mission.
     * @returns {*}
     */
    function getCurrentMissionLabels () {
        return labels;
    }

    /**
     * Returns the underlying panomarker object.
     * @returns {PanoMarker}
     */
    function getPanomarker () {
    return self.labelMarker;
    }

    /**
     * Returns the panorama ID for the current panorama.
     * @returns {google.maps.StreetViewPanorama} Google StreetView Panorama Id
     */
    function getPanoId () {
        return panorama.getPano();
    }

    /**
     * Returns the lat lng of this panorama. Note that sometimes position is null/undefined
     * (probably a bug in GSV), so sometimes this function returns null.
     * @returns {{lat, lng}}
     */
    function getPosition () {
        let position = panorama.getPosition();
        return (position) ? {'lat': position.lat(), 'lng': position.lng()} : null;
    }

    /**
     * Returns the pov of the viewer.
     * @returns {{heading: float, pitch: float, zoom: float}}
     */
    function getPov () {
        let pov = panorama.getPov();

        // Pov can be less than 0. So adjust it.
        while (pov.heading < 0) {
            pov.heading += 360;
        }

        // Pov can be more than 360. Adjust it.
        while (pov.heading > 360) {
            pov.heading -= 360;
        }
        return pov;
    }

    /**
     * Returns the zoom level of this panorama.
     * @returns Zoom level from {1.1, 2.1, 3.1}
     */
    function getZoom () {
        return panorama.getZoom();
    }

    /**
     * Gets a specific property from this Panorama.
     * @param key   Property name.
     * @returns     Value associated with this property or null.
     */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Logs interactions from panorama changes.
     * Occurs when the user loads a new label onto the screen, or if they use arrow keys to move
     * around. (This is behavior that is automatically enabled by the GSV Panorama).
     * Updates the date text field to match the current panorama's date.
     * @private
     */
    function _handlerPanoChange () {
        if (svv.panorama) {
            let panoId = getPanoId();

            /**
             * PanoId is sometimes changed twice. This avoids logging duplicate panos.
             */
            if (svv.tracker && panoId !== getProperty('prevPanoId')) {
                setProperty('prevPanoId', panoId);
                svv.tracker.push('PanoId_Changed');
            }
        }
        if (!isMobile()) {
            streetViewService.getPanorama({pano: panorama.getPano()},
                function (data, status) {
                    if (status === google.maps.StreetViewStatus.OK) {
                        document.getElementById("svv-panorama-date").innerText = moment(data.imageDate).format('MMM YYYY');
                        // Remove Keyboard shortcuts link and make Terms of Use & Report a problem links  clickable.
                        // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2546
                        if (!bottomLinksClickable) {
                            $('.gm-style-cc')[0].remove();
                            $("#view-control-layer").append($($('.gm-style-cc')[0]).parent().parent());
                            bottomLinksClickable = true;
                        } 
                    } else {
                        console.error("Error retrieving Panoramas: " + status);
                        svv.tracker.push("PanoId_NotFound", {'TargetPanoId': panoramaId});
                    }
                });
        }
    }

    /**
     * Logs panning interactions.
     * @private
     */
    function _handlerPovChange () {
        if (svv.tracker && svv.panorama) {
            svv.tracker.push('POV_Changed');
        }
    }

    /**
     * Renders a label onto the screen using a Panomarker.
     * @returns {renderLabel}
     */
    function renderLabel() {
        let url = currentLabel.getIconUrl();
        let pos = currentLabel.getPosition();

        if (!self.labelMarker) {
            let controlLayer = isMobile() ? document.getElementById("view-control-layer-mobile") : document.getElementById("view-control-layer");
            self.labelMarker = new PanoMarker({
                id: "validate-pano-marker",
                markerContainer: controlLayer,
                container: panoCanvas,
                pano: panorama,
                position: {heading: pos.heading, pitch: pos.pitch},
                icon: url,
                size: new google.maps.Size(currentLabel.getRadius() * 2 + 2, currentLabel.getRadius() * 2 + 2),
                anchor: new google.maps.Point(currentLabel.getRadius(), currentLabel.getRadius()),
                zIndex: 2
            });
        } else {
            self.labelMarker.setPano(panorama, panoCanvas);
            self.labelMarker.setPosition({
                heading: pos.heading,
                pitch: pos.pitch
            });
            self.labelMarker.setIcon(url);
        }
        return this;
    }

    /**
     * Sets the panorama ID, and heading/pitch/zoom
     * @param panoId    String representation of the Panorama ID
     * @param heading   Photographer heading
     * @param pitch     Photographer pitch
     * @param zoom      Photographer zoom
     */
    function setPanorama (panoId, heading, pitch, zoom) {
        setProperty("panoId", panoId);
        setProperty("prevPanoId", panoId);
        panorama.setPano(panoId);
        setProperty("prevSetPanoTimestamp", new Date().getTime());
        panorama.set('pov', {heading: heading, pitch: pitch});
        panorama.set('zoom', zoomLevel[zoom]);
        renderLabel();
        return this;
    }

    /**
     * Sets the label on the panorama to be some label.
     * @param label {Label} Label to be displayed on the panorama.
     */
    function setLabel (label) {
        currentLabel = label;
        currentLabel.setProperty('startTimestamp', new Date().getTime());
        svv.statusField.updateLabelText(currentLabel.getAuditProperty('labelType'));
        svv.statusExample.updateLabelImage(currentLabel.getAuditProperty('labelType'));
        setPanorama(label.getAuditProperty('gsvPanoramaId'), label.getAuditProperty('heading'),
            label.getAuditProperty('pitch'), label.getAuditProperty('zoom'));
        svv.labelDescriptionBox.setDescription(label);
        renderLabel();
    }

    /**
     * Sets a property for this panorama.
     * @param key   Name of property
     * @param value Value of property.
     * @returns {setProperty}
     */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Sets the zoom level for this panorama.
     * @param zoom  Desired zoom level for this panorama. In general, values in {1.1, 2.1, 3.1}
     */
    function setZoom (zoom) {
        panorama.set('zoom', zoom);
    }

    /**
     * Skips the current label on this panorama and fetches a new label for validation.
     */
    function skipLabel () {
        svv.panoramaContainer.fetchNewLabel(currentLabel.getAuditProperty('labelId'));
    }

    /**
     * Sets the size of the panorama and panorama holder depending on the size of the mobile phone.
     */
    function sizePano() {
        let h = window.innerHeight - 10;
        let w = window.innerWidth - 10;
        let outline_h = h + 10;
        let outline_w = w + 10;
        let left = 0;
        document.getElementById("svv-panorama").style.height = h + "px";
        document.getElementById("svv-panorama-holder").style.height = h + "px";
        document.getElementById("svv-panorama-outline").style.height = outline_h + "px";
        document.getElementById("svv-panorama").style.width = w + "px";
        document.getElementById("svv-panorama-holder").style.width = w + "px";
        document.getElementById("svv-panorama-outline").style.width = outline_w + "px";
        document.getElementById("svv-panorama").style.left = left + "px";
        document.getElementById("svv-panorama-holder").style.left = left + "px";
        document.getElementById("svv-panorama-outline").style.left = left + "px";
    }

    /**
     * Hides the current label on this panorama.
     */
    function hideLabel () {
        self.labelMarker.setVisible(false);
    }

    /**
     * Shows the current label on this panorama.
     */
    function showLabel () {
        self.labelMarker.setVisible(true);
    }

    _init();

    self.getCurrentLabel = getCurrentLabel;
    self.getCurrentMissionLabels = getCurrentMissionLabels;
    self.getPanoId = getPanoId;
    self.getPosition = getPosition;
    self.getProperty = getProperty;
    self.getPov = getPov;
    self.getZoom = getZoom;
    self.getPanomarker = getPanomarker;
    self.renderLabel = renderLabel;
    self.setLabel = setLabel;
    self.setPanorama = setPanorama;
    self.setProperty = setProperty;
    self.setZoom = setZoom;
    self.skipLabel = skipLabel;
    self.hideLabel = hideLabel;
    self.showLabel = showLabel;
    self.getPanorama = getPanorama;

    return this;
}

/**
 * Holds the list of labels to be validated, and distributes them to the panoramas that are on the
 * page. Fetches labels from the backend and converts them into Labels that can be placed onto the
 * GSV Panorama.
 * @param labelList     Initial list of labels to be validated (generated when the page is loaded).
 * @returns {PanoramaContainer}
 * @constructor
 */
function PanoramaContainer (labelList) {
    let labels = labelList;    // labels that all panoramas from the screen are going to be validating from
    let properties = {
        progress: 0             // used to keep track of which index to retrieve from labels
    };
    let self = this;

    /**
     * Initializes panorama(s) on the validate page.
     * @private
     */
    function _init () {
        svv.panorama = new Panorama(labelList[getProperty("progress")]);
        setProperty("progress", getProperty("progress") + 1);

        // Set the HTML
        svv.statusField.updateLabelText(labelList[0].getAuditProperty('labelType'));
        svv.statusExample.updateLabelImage(labelList[0].getAuditProperty('labelType'));
    }

    /**
     * Fetches a single label from the database.  When the user clicks skip, need to get more
     * because missions fetch exactly the number of labels that are needed to complete the mission.
     * @param skippedLabelId the ID of the label that we are skipping
     */
    function fetchNewLabel (skippedLabelId) {
        let labelTypeId = svv.missionContainer.getCurrentMission().getProperty('labelTypeId');
        let labelUrl = '/label/geo/random/' + labelTypeId + '/' + skippedLabelId;

        let data = {};
        data.labels = svv.labelContainer.getCurrentLabels();

        if (data.constructor !== Array) {
            data = [data];
        }

        $.ajax({
            async: false,
            contentType: 'application/json; charset=utf-8',
            url: labelUrl,
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (labelMetadata) {
                labels.push(new Label(labelMetadata));
                svv.missionContainer.updateAMissionSkip();
                loadNewLabelOntoPanorama(svv.panorama);
            }
        });
    }

    /**
     * Gets a specific property from the PanoramaContainer.
     * @param key   Property name.
     * @returns     Value associated with this property or null.
     */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Loads a new label onto a panorama after the user validates a label.
     */
    function loadNewLabelOntoPanorama () {
        svv.panorama.setLabel(labels[getProperty('progress')]);
        setProperty('progress', getProperty('progress') + 1);
        if (svv.labelVisibilityControl && !svv.labelVisibilityControl.isVisible()) {
            svv.labelVisibilityControl.unhideLabel(true);
        }

        // Update zoom availability on desktop.
        if (svv.zoomControl) {
            svv.zoomControl.updateZoomAvailability();
        }
    }

    function getCurrentLabel() {
        return labels[getProperty('progress') - 1];
    }

    /**
     * Resets the validation interface for a new mission. Loads a new set of label onto the panoramas.
     */
    function reset () {
        setProperty('progress', 0);
        loadNewLabelOntoPanorama();
    }

    /**
     * Creates a list of label objects to be validated from label metadata.
     * Called when a new mission is loaded onto the screen.
     * @param labelList Object containing key-value pairings of {index: labelMetadata}
     */
    function setLabelList (labelList) {
        Object.keys(labelList).map(function(key, index) {
            labelList[key] = new Label(labelList[key]);
        });

        labels = labelList;
    }

    /**
     * Sets a property for the PanoramaContainer.
     * @param key   Name of property
     * @param value Value of property.
     * @returns {setProperty}
     */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Validates the label.
     */
    function validateLabel (action, timestamp, comment) {
        svv.panorama.getCurrentLabel().validate(action, comment);
        svv.panorama.setProperty('validationTimestamp', timestamp);
    }

    self.fetchNewLabel = fetchNewLabel;
    self.getProperty = getProperty;
    self.loadNewLabelOntoPanorama = loadNewLabelOntoPanorama;
    self.getCurrentLabel = getCurrentLabel;
    self.setProperty = setProperty;
    self.reset = reset;
    self.setLabelList = setLabelList;
    self.validateLabel = validateLabel;

    _init();

    return this;
}

/**
 * Updates the examples and counterexamples on the right side of the validation interface according
 * to the label that is currently displayed on the screen.
 * @returns {StatusExample}
 * @constructor
 */
function StatusExample (statusUI) {
    let self = this;
    let labelType = undefined;
    let labelName = undefined;
    let examplePath = '/assets/javascripts/SVValidate/img/ValidationExamples/';
    let counterExamplePath = '/assets/javascripts/SVValidate/img/ValidationCounterexamples/';

    // This object holds the translations for all the correct/incorrect example descriptions.
    let descriptionTranslations = i18next.t('right-ui', { returnObjects: true });

    let exampleImage = $(".example-image");
    exampleImage.on('mouseover', _showExamplePopup);
    exampleImage.on('mouseout', _hideExamplePopup);


    /**
     * Updates the images on the side of the validation interface.
     * @param label Type of label being displayed on the interface.
     */
    function updateLabelImage (label) {
        labelType = label;
        labelName = svv.labelNames[labelType];

        _updateCounterExamples();
        _updateExamples();
    }

    function _hideExamplePopup () {
        statusUI.popup.css('visibility', 'hidden');
    }

    /**
     * Set the description for the popup at the given HTML id by building the key for the correct translation.
     *
     * HTML IDs look like '{example,counterexample}-image-{1,2,3,4}', and we use this ID to build the key to translate
     * that looks like 'right-ui.{correct,incorrect}.example-{list of dash-separated numbers}'. So if we have the same
     * text for 'example-image-{1,3, and 4}', then the translation key will be 'right-ui.correct.example-1-3-4'.
     * @param id
     * @private
     */
    function _setPopupDescription (id) {
        let correctness = id.startsWith('example') ? 'correct' : 'incorrect';
        let exampleNum = id.charAt(id.length - 1);
        let translations = descriptionTranslations[correctness][util.camelToKebab(labelType)];
        let key = Object.keys(translations).filter(k => k.startsWith('example') && k.includes(exampleNum));
        statusUI.popupDescription.html(translations[key]);
    }

    /**
     * Sets the horizontal and vertical position of the popup and popup pointer based on the picture's position.
     * @param id    ID name for the label example HTML element that the user hovered over.
     * @private
     */
    function _setPopupLocation (id) {
        // 1 = upper left, 2 = upper right, 3 = bottom left, 4 = bottom right

        // Positioning within the group of 4 examples (correct or incorrect).
        if (id.includes("1")) {
            statusUI.popup.css('left', '490px');
            statusUI.popupPointer.css('top', '50px');
        } else if (id.includes("2")) {
            statusUI.popup.css('left', '590px');
            statusUI.popupPointer.css('top', '50px');
        } else if (id.includes("3")) {
            statusUI.popup.css('left', '490px');
            statusUI.popupPointer.css('top', '135px');
        } else if(id.includes("4")) {
            statusUI.popup.css('left', '590px');
            statusUI.popupPointer.css('top', '135px');
        }

        // Position based on the correct v incorrect group.
        if (id.includes("counterexample")) {
            statusUI.popup.css('top', '196px');
        } else {
            statusUI.popup.css('top', '-10px');
        }
    }

    /**
     * Sets the title of the popup based on which picture was hovered over.
     * @param id    ID name for the label example HTML element that the user hovered over.
     * @private
     */
    function _setPopupTitle (id) {
        if (id.includes("counterexample")) {
            statusUI.popupTitle.html(i18next.t(`right-ui.incorrect.${util.camelToKebab(labelType)}.title`));
        } else {
            statusUI.popupTitle.html(i18next.t(`right-ui.correct.${util.camelToKebab(labelType)}.title`));
        }
    }

    /**
     * Handles mouseover events on examples/counterexamples. Displays an popup that shows an image
     * of the label that was either correctly/incorrectly placed and a brief accompanying
     * description.
     * @private
     */
    function _showExamplePopup() {
        let imageSource = $(this).attr("src");
        let id = $(this).attr("id");
        statusUI.popupImage.attr('src', imageSource);

        _setPopupDescription(id);
        _setPopupLocation(id);
        _setPopupTitle(id);

        statusUI.popup.css('visibility', 'visible');
    }

    /**
     * Updates images that shows label counter-examples. Paths for label examples are found at:
     * src/assets/javascripts/SVValidate/img/ValidationCounterexamples/LabelTypeExampleX.png
     * @private
     */
    function _updateCounterExamples () {
        statusUI.example1.attr('src', examplePath + labelType + 'Example1.png');
        statusUI.example2.attr('src', examplePath + labelType + 'Example2.png');
        statusUI.example3.attr('src', examplePath + labelType + 'Example3.png');
        statusUI.example4.attr('src', examplePath + labelType + 'Example4.png');
    }

    /**
     * Updates images that show label examples. Paths for label examples are found at:
     * src/assets/javascripts/SVValidate/img/ValidationCounterexamples/LabelTypeCounterExampleX.png
     * @private
     */
    function _updateExamples () {
        statusUI.counterExample1.attr('src', counterExamplePath + labelType + 'CounterExample1.png');
        statusUI.counterExample2.attr('src', counterExamplePath + labelType + 'CounterExample2.png');
        statusUI.counterExample3.attr('src', counterExamplePath + labelType + 'CounterExample3.png');
        statusUI.counterExample4.attr('src', counterExamplePath + labelType + 'CounterExample4.png');
    }

    self.updateLabelImage = updateLabelImage;

    return this;
}

/**
 * Updates items that appear on the right side of the validation interface (i.e., label counts)
 * @param param must have:
 *                  - completedValidations: the number of validations the user has completed in all time. 
 * @returns {StatusField}
 * @constructor
 */
function StatusField(param) {
    let containerWidth = 730;
    let self = this;
    let completedValidations = param.completedValidations;
    /**
     * Resets the status field whenever a new mission is introduced.
     * @param currentMission    Mission object for the current mission.
     */
    function reset(currentMission) {
        let progress = currentMission.getProperty('labelsProgress');
        let total = currentMission.getProperty('labelsValidated');
        let completionRate = progress / total;
        refreshLabelCountsDisplay();
        updateMissionDescription(total);
        setProgressText(completionRate);
        setProgressBar(completionRate);
    }

    /**
     * Increments the number of labels the user has validated.
     */
    function incrementLabelCounts(){
        completedValidations++;
        refreshLabelCountsDisplay();
    }

    /**
     * Refreshes the number count displayed.
     */
    function refreshLabelCountsDisplay(){
        svv.ui.status.labelCount.html(completedValidations);
    }

    /**
     * Updates the label name that is displayed in the status field and title bar.
     * @param labelType {String} Name of label without spaces.
     */
    function updateLabelText(labelType) {
        // Centers and updates title top of the validation interface.
        svv.ui.status.upperMenuTitle.html(i18next.t(`top-ui.title.${util.camelToKebab(labelType)}`));
        let offset = svv.ui.status.zoomInButton.outerWidth()
            + svv.ui.status.zoomOutButton.outerWidth()
            + svv.ui.status.labelVisibilityControlButton.outerWidth();
        let width = ((svv.canvasWidth - offset) / 2) - (svv.ui.status.upperMenuTitle.outerWidth() / 2);
        svv.ui.status.upperMenuTitle.css("left", width + "px");
    }

    /**
     * Updates the text for the mission description.
     * @param count {Number} Number of labels to validate this mission.
     */
    function updateMissionDescription(count) {
        svv.ui.status.missionDescription.html(i18next.t('right-ui.current-mission.validate-labels', { n: count }));
    }

    /**
     * Updates the mission progress completion bar
     * @param completionRate    Proportion of this region completed (0 <= completionRate <= 1)
     */
    function setProgressBar(completionRate) {
        let color = completionRate < 1 ? 'rgba(0, 161, 203, 1)' : 'rgba(0, 222, 38, 1)';

        completionRate *=  100;
        if (completionRate > 100) completionRate = 100;

        completionRate = completionRate.toFixed(0);
        completionRate = completionRate + "%";

        // Update blue portion of progress bar
        svv.ui.status.progressFiller.css({
            background: color,
            width: completionRate
        });
    }

    /**
     * Updates the percentage on the progress bar to show what percentage of the validation mission
     * the user has completed.
     * @param completionRate    {Number} Proportion of completed validations.
     */
    function setProgressText(completionRate) {
        completionRate *= 100;
        if (completionRate > 100) completionRate = 100;
        completionRate = completionRate.toFixed(0, 10);
        completionRate = completionRate + "% " + i18next.t('common:complete');
        svv.ui.status.progressText.html(completionRate);
    }

    /**
     * Returns the user's total validation count.
     */
    function getCompletedValidations(){
      return completedValidations;
    }

    self.setProgressBar = setProgressBar;
    self.setProgressText = setProgressText;
    self.updateLabelText = updateLabelText;
    self.updateMissionDescription = updateMissionDescription;
    self.refreshLabelCountsDisplay = refreshLabelCountsDisplay;
    self.incrementLabelCounts = incrementLabelCounts;
    self.reset = reset;
    self.getCompletedValidations = getCompletedValidations;

    return this;
}

/**
 * User module
 * @param param
 * @returns {{className: string}}
 * @constructor
 */
function User (param) {
    let properties = {
        username: param.username,
        role: param.role
    };

    /**
     * Get a property
     * @param key
     * @returns {*}
     */
    this.getProperty = function (key) {
        return properties[key];
    };

    /**
     * Set a property
     * @param key
     * @param value
     */
    this.setProperty = function (key, value) {
        properties[key] = value;
    };
}

/**
 * Holds Panomarker/Panorama calculations. These functions are borrowed from the
 * PanoMarker script.
 * @returns {PanoProperties}
 * @constructor
 */
function PanoProperties () {
    let self = this;

    /**
     * Calculates heading and pitch for a Google Maps marker using (x, y) coordinates
     * From PanoMarker spec
     * @param canvas_x          X coordinate (pixel) of the label
     * @param canvas_y          Y coordinate (pixel) of the label
     * @param canvas_width      Original canvas width
     * @param canvas_height     Original canvas height
     * @param zoom              Original zoom level of the label
     * @param heading           Original heading of the label
     * @param pitch             Original pitch of the label
     * @returns {{heading: float, pitch: float}}
     */
    function getPosition(canvas_x, canvas_y, canvas_width, canvas_height, zoom, heading, pitch) {
        function sgn(x) {
            return x >= 0 ? 1 : -1;
        }

        let PI = Math.PI;
        let cos = Math.cos;
        let sin = Math.sin;
        let tan = Math.tan;
        let sqrt = Math.sqrt;
        let atan2 = Math.atan2;
        let asin = Math.asin;
        let fov = _get3dFov(zoom) * PI / 180.0;
        let width = canvas_width;
        let height = canvas_height;
        let h0 = heading * PI / 180.0;
        let p0 = pitch * PI / 180.0;
        let f = 0.5 * width / tan(0.5 * fov);
        let x0 = f * cos(p0) * sin(h0);
        let y0 = f * cos(p0) * cos(h0);
        let z0 = f * sin(p0);
        let du = (canvas_x) - width / 2;
        let dv = height / 2 - (canvas_y - 5);
        let ux = sgn(cos(p0)) * cos(h0);
        let uy = -sgn(cos(p0)) * sin(h0);
        let uz = 0;
        let vx = -sin(p0) * sin(h0);
        let vy = -sin(p0) * cos(h0);
        let vz = cos(p0);
        let x = x0 + du * ux + dv * vx;
        let y = y0 + du * uy + dv * vy;
        let z = z0 + du * uz + dv * vz;
        let R = sqrt(x * x + y * y + z * z);
        let h = atan2(x, y);
        let p = asin(z / R);
        return {
            heading: h * 180.0 / PI,
            pitch: p * 180.0 / PI
        };
    }

    /**
     * From PanoMarker spec
     * @param zoom
     * @returns {number}
     */
    function _get3dFov (zoom) {
        return zoom <= 2 ?
            126.5 - zoom * 36.75 :  // linear descent
            195.93 / Math.pow(1.92, zoom); // parameters determined experimentally
    }

    /**
     * Given the current POV, this method calculates the Pixel coordinates on the
     * given viewport for the desired POV. All credit for the math this method goes
     * to user3146587 on StackOverflow: http://goo.gl/0GGKi6
     *
     * My own approach to explain what is being done here (including figures!) can
     * be found at http://martinmatysiak.de/blog/view/panomarker
     *
     * @param {StreetViewPov} targetPov The point-of-view whose coordinates are
     *     requested.
     * @param {StreetViewPov} currentPov POV of the viewport center.
     * @param {number} zoom The current zoom level.
     * @param {number} Width of the panorama canvas.
     * @param {number} Height of the panorama canvas.
     * @return {Object} Top and Left offsets for the given viewport that point to
     *     the desired point-of-view.
     */
    function povToPixel3d (targetPov, currentPov, zoom, canvasWidth, canvasHeight) {

        // Gather required variables and convert to radians where necessary
        let width = canvasWidth;
        let height = canvasHeight;

        // Corrects width and height for mobile phones
        if (isMobile()) {
            width = window.innerWidth;
            height = window.innerHeight;
        }

        let target = {
            left: width / 2,
            top: height / 2
        };

        let DEG_TO_RAD = Math.PI / 180.0;
        let fov = _get3dFov(zoom) * DEG_TO_RAD;
        let h0 = currentPov.heading * DEG_TO_RAD;
        let p0 = currentPov.pitch * DEG_TO_RAD;
        let h = targetPov.heading * DEG_TO_RAD;
        let p = targetPov.pitch * DEG_TO_RAD;

        // f = focal length = distance of current POV to image plane
        let f = (width / 2) / Math.tan(fov / 2);

        // our coordinate system: camera at (0,0,0), heading = pitch = 0 at (0,f,0)
        // calculate 3d coordinates of viewport center and target
        let cos_p = Math.cos(p);
        let sin_p = Math.sin(p);

        let cos_h = Math.cos(h);
        let sin_h = Math.sin(h);

        let x = f * cos_p * sin_h;
        let y = f * cos_p * cos_h;
        let z = f * sin_p;

        let cos_p0 = Math.cos(p0);
        let sin_p0 = Math.sin(p0);

        let cos_h0 = Math.cos(h0);
        let sin_h0 = Math.sin(h0);

        let x0 = f * cos_p0 * sin_h0;
        let y0 = f * cos_p0 * cos_h0;
        let z0 = f * sin_p0;

        let nDotD = x0 * x + y0 * y + z0 * z;
        let nDotC = x0 * x0 + y0 * y0 + z0 * z0;

        // nDotD == |targetVec| * |currentVec| * cos(theta)
        // nDotC == |currentVec| * |currentVec| * 1
        // Note: |currentVec| == |targetVec| == f

        // Sanity check: the vectors shouldn't be perpendicular because the line
        // from camera through target would never intersect with the image plane
        if (Math.abs(nDotD) < 1e-6) {
            return null;
        }

        // t is the scale to use for the target vector such that its end
        // touches the image plane. It's equal to 1/cos(theta) ==
        //     (distance from camera to image plane through target) /
        //     (distance from camera to target == f)
        let t = nDotC / nDotD;

        // Sanity check: it doesn't make sense to scale the vector in a negative
        // direction. In fact, it should even be t >= 1.0 since the image plane
        // is always outside the pano sphere (except at the viewport center)
        if (t < 0.0) {
            return null;
        }

        // (tx, ty, tz) are the coordinates of the intersection point between a
        // line through camera and target with the image plane
        let tx = t * x;
        let ty = t * y;
        let tz = t * z;

        // u and v are the basis vectors for the image plane
        let vx = -sin_p0 * sin_h0;
        let vy = -sin_p0 * cos_h0;
        let vz = cos_p0;

        let ux = cos_h0;
        let uy = -sin_h0;
        let uz = 0;

        // normalize horiz. basis vector to obtain orthonormal basis
        let ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
        ux /= ul;
        uy /= ul;
        uz /= ul;

        // project the intersection point t onto the basis to obtain offsets in
        // terms of actual pixels in the viewport
        let du = tx * ux + ty * uy + tz * uz;
        let dv = tx * vx + ty * vy + tz * vz;

        // use the calculated pixel offsets
        target.left += du;
        target.top -= dv;

        return target;
    }

    self.getPosition = getPosition;
    self.povToPixel3d = povToPixel3d;

    return this;
}

/**
 * Detect pinch zoom on mobile devices and push appropriate logs.
 * This is only used for mobile devices as they use GSV pinch zoom mechanism.
 * return {PinchZoomDetector}
 * @constructor
 */
function PinchZoomDetector () {
    let self = this;

    let ZOOM_UNKNOWN_CODE = 0;
    let ZOOM_IN_CODE = 1;
    let ZOOM_OUT_CODE = 2;

    let pinchZoomCode = 0;
    let prevZoomLevel = -1;
    let pinchZooming = false;

    /**
     * Adds listeners to the screen to log user interactions.
     * @private
     */
    function _init () {
        let panorama = svv.panorama.getPanorama();
        let screen = document.getElementById("svv-panorama");
        panorama.addListener('zoom_changed', processZoomChange);
        screen.addEventListener('touchstart', processTouchstart);
        screen.addEventListener('touchend', processTouchend);
        return this;
    }

    /**
     * User starts pinch zooming. Don't know yet whether they are zooming in or out.
     * @private
     */
    function processTouchstart (e) {
        if (e.touches.length >= 2) {
            prevZoomLevel = svv.panorama.getZoom();
            pinchZooming = true;
            pinchZoomCode = ZOOM_UNKNOWN_CODE;
        }
    }

    /**
     * Determine whether a user is zooming in or out and logs their actions accordingly.
     * @private
     */
    function processZoomChange () {
        let currentZoom = svv.panorama.getZoom();
        // Logs interaction only if a user is pinch zooming and current zoom is less than max zoom.
        if (pinchZooming && currentZoom <= 4) {
            let zoomChange = currentZoom - prevZoomLevel;
            if (zoomChange > 0) {
                if (pinchZoomCode !== ZOOM_IN_CODE) {
                    if (pinchZoomCode === ZOOM_OUT_CODE) {
                        svv.tracker.push('Pinch_ZoomOut_End');
                    }
                    svv.tracker.push('Pinch_ZoomIn_Start');
                    pinchZoomCode = ZOOM_IN_CODE;
                }
            }
            if (zoomChange < 0) {
                if (pinchZoomCode !== ZOOM_OUT_CODE) {
                    if (pinchZoomCode === ZOOM_IN_CODE) {
                        svv.tracker.push('Pinch_ZoomIn_End');
                    }
                    svv.tracker.push('Pinch_ZoomOut_Start');
                    pinchZoomCode = ZOOM_OUT_CODE;
                }
           }
           prevZoomLevel = currentZoom;
        }
    }

    /**
     * Logs zoom end interactions on mobile devices as users lift their hand off the screen.
     * @private
     */
    function processTouchend (e) {
        if (svv.tracker && svv.panorama && pinchZooming && e.touches.length <= 1) {
            if (pinchZoomCode === ZOOM_IN_CODE) {
                svv.tracker.push('Pinch_ZoomIn_End');
            }
            if (pinchZoomCode === ZOOM_OUT_CODE) {
                svv.tracker.push('Pinch_ZoomOut_End');
            }
            pinchZooming = false;
        }
    }

    _init();

    return self;
}


/**
 * Handles zooming for the Google StreetView panorama. This is also called by the
 * Keyboard class to deal with zooming via keyboard shortcuts.
 * @returns {ZoomControl}
 * @constructor
 */
function ZoomControl () {
    let self = this;
    let zoomInButton = $("#zoom-in-button");
    let zoomOutButton = $("#zoom-out-button");

    /**
     * Logs interaction when the zoom in button is clicked.
     */
    function clickZoomIn () {
        svv.tracker.push("Click_ZoomIn");
        zoomIn();
    }

    /**
     * Logs interaction when the zoom out button is clicked.
     */
    function clickZoomOut () {
        svv.tracker.push("Click_ZoomOut");
        zoomOut();
    }

    /**
     * Increases zoom for the Google StreetView Panorama and checks if 'Zoom In' button needs
     * to be disabled.
     * Zoom levels: {1.1, 2.1, 3.1}
     */
    function zoomIn () {
        let zoomLevel = svv.panorama.getZoom();
        if (zoomLevel <= 2.1) {
            zoomLevel += 1;
            svv.panorama.setZoom(zoomLevel);
        }
        updateZoomAvailability();
    }

    /**
     * Decreases zoom for the Google StreetView Panorama and checks if 'Zoom Out' button needs
     * to be disabled.
     * Zoom levels: {1.1, 2.1, 3.1}
     */
    function zoomOut () {
        let zoomLevel = svv.panorama.getZoom();
        if (zoomLevel >= 2.1) {
            zoomLevel -= 1;
            svv.panorama.setZoom(zoomLevel);
        }
        updateZoomAvailability();
    }

    /**
     * Changes the opacity and enables/disables the zoom buttons depending on the 'zoom level'. It
     * disables and 'greys-out' the zoom in button in the most zoomed in state and the zoom out
     * button in the most zoomed out state.
     * Zoom levels: {1.1(Zoom-out Disabled), 2.1(Both buttons enabled), 3.1(Zoom-In Disabled)}
     */
    function updateZoomAvailability() {
        if (svv.panorama.getZoom() >= 3.1) {
            zoomInButton.css('opacity', 0.5);
            zoomInButton.addClass('disabled');
            zoomOutButton.css('opacity', 1);
            zoomOutButton.removeClass('disabled');
        } else if (svv.panorama.getZoom() <= 1.1) {
            zoomOutButton.css('opacity', 0.5);
            zoomOutButton.addClass('disabled');
            zoomInButton.css('opacity', 1);
            zoomInButton.removeClass('disabled');
        } else {
            zoomOutButton.css('opacity', 1);
            zoomOutButton.removeClass('disabled');
            zoomInButton.css('opacity', 1);
            zoomInButton.removeClass('disabled');
        }
    }

    zoomInButton.on('click', clickZoomIn);
    zoomOutButton.on('click', clickZoomOut);

    self.zoomIn = zoomIn;
    self.zoomOut = zoomOut;
    self.updateZoomAvailability = updateZoomAvailability;

    return this;
}

/**
 * Source:
 * https://github.com/marmat/google-maps-api-addons/blob/master/panomarker/src/panomarker.js
 *
 * PanoMarker
 * Version 1.0
 *
 * @author kaktus621@gmail.com (Martin Matysiak)
 * @fileoverview A marker that can be placed inside custom StreetView panoramas.
 * Regular markers inside StreetViewPanoramas can only be shown vertically
 * centered and aligned to LatLng coordinates.
 *
 * Custom StreetView panoramas usually do not have any geographical information
 * (e.g. inside views), thus a different method of positioning the marker has to
 * be used. This class takes simple heading and pitch values from the panorama's
 * center in order to move the marker correctly with the user's viewport
 * changes.
 *
 * Since something like that is not supported natively by the Maps API, the
 * marker actually sits on top of the panorama, DOM-wise outside of the
 * actual map but still inside the map container.
 */

/**
 * @license Copyright 2014 — 2015 Martin Matysiak.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * PanoMarkerOptions
 *
 * {google.maps.Point} anchor The point (in pixels) to which objects will snap.
 * {string} className The class name which will be assigned to the
 *    created div node.
 * {HTMLDivElement} container The container holding the panorama.
 * {string} icon URL to an image file that shall be used.
 * {string} id A unique identifier that will be assigned to the
 *    created div-node.
 * {google.maps.StreetViewPanorama} pano Panorama in which to display marker.
 * {google.maps.StreetViewPov} position Marker position.
 * {google.maps.Size} size The size of the marker in pixels.
 * {string} title Rollover text.
 * {boolean} visible If true, the marker is visible.
 * {number} zIndex The marker's z-index.
 */


(function(global, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory();
    } else if (typeof define === 'function' && typeof define.amd === 'object') {
        define(['goog!maps,3,other_params:[sensor=false&libraries=visualization]'],
            factory);
    } else {
        if (typeof google !== 'object' || typeof google.maps !== 'object') {
            throw new Error('PanoMarker requires google maps library');
        }
        global.PanoMarker = factory();
    }
}(typeof window !== 'undefined' ? window : this, function() {

    /**
     * Creates a PanoMarker with the options specified. If a panorama is specified,
     * the marker is added to the map upon construction. Note that the position must
     * be set for the marker to display.
     *
     * Important: do not use the inherited method <code>setMap()</code> to change
     * the panorama, but use <code>setPano()</code> instead, otherwise a proper
     * functionality is not guaranteed.
     *
     * @constructor
     * @param {PanoMarkerOptions} opts A set of parameters to customize the marker.
     * @extends google.maps.OverlayView
     */
    var PanoMarker = function(opts) {

        // In case no options have been given at all, fallback to {} so that the
        // following won't throw errors.
        opts = opts || {};

        // panorama.getContainer has been deprecated in the Google Maps API. The user
        // now explicity needs to pass in the container for the panorama.
        if (!opts.container) {
            throw 'A panorama container needs to be defined.';
        }

        /** @private @type {HTMLDivElement} */
        this.container_ = opts.container;

        /**
         * Currently only Chrome is rendering panoramas in a 3D sphere. The other
         * browsers are just showing the raw panorama tiles and pan them around.
         *
         * @private
         * @type {function(StreetViewPov, StreetViewPov, number, Element): Object}
         */

        // Original code:
        // this.povToPixel_ = (!!window.chrome || isMobile()) ? PanoMarker.povToPixel3d :
        //     PanoMarker.povToPixel2d;

        // New code (April 17, 2019) -- modified by Aileen
        // Source: https://github.com/marmat/google-maps-api-addons/issues/36#issuecomment-342774699
        this.povToPixel_ = PanoMarker.povToPixel2d;
        var pixelCanvas = document.createElement("canvas");

        if (pixelCanvas && (pixelCanvas.getContext("experimental-webgl") || pixelCanvas.getContext("webgl"))) {
            this.povToPixel_ = PanoMarker.povToPixel3d;
        }

        /** @private @type {google.maps.Point} */
        this.anchor_ = opts.anchor || new google.maps.Point(16, 16);

        /** @private @type {?string} */
        this.className_ = opts.className || null;

        /** @private @type {boolean} */
        this.clickable_ = opts.clickable || true;

        /** @private @type {?string} */
        this.icon_ = opts.icon || null;

        /** @private @type {?string} */
        this.id_ = opts.id || null;

        /** @private @ŧype {?HTMLDivElement} */
        this.marker_ = null;

        /** @private @type {?google.maps.StreetViewPanorama} */
        this.pano_ = null;

        /** @private @type {number} */
        this.pollId_ = -1;

        /** @private @type {google.maps.StreetViewPov} */
        this.position_ = opts.position || {heading: 0, pitch: 0};

        /** @private @type {Object} */
        this.povListener_ = null;

        /** @private @type {Object} */
        this.zoomListener_ = null;

        /** @private @type {google.maps.Size} */
        this.size_ = opts.size || new google.maps.Size(32, 32);

        /** @private @type {string} */
        this.title_ = opts.title || '';

        /** @private @type {boolean} */
        this.visible_ = (typeof opts.visible === 'boolean') ? opts.visible : true;

        /** @private @type {number} */
        this.zIndex_ = opts.zIndex || 1;

        /** @private @type {Object} */
        this.markerContainer_ = opts.markerContainer || null;

        /** @private @type {boolean} */
        this.toggleDescription_ = false;

        // At last, call some methods which use the initialized parameters
        this.setPano(opts.pano || null, opts.container);
    };

    PanoMarker.prototype = new google.maps.OverlayView();


//// Static helper methods for the position calculation ////


    /**
     * According to the documentation (goo.gl/WT4B57), the field-of-view angle
     * should precisely follow the curve of the form 180/2^zoom. Unfortunately, this
     * is not the case in practice in the 3D environment. From experiments, the
     * following FOVs seem to be more correct:
     *
     *        Zoom | best FOV | documented FOV
     *       ------+----------+----------------
     *          0  | 126.5    | 180
     *          1  | 90       | 90
     *          2  | 53       | 45
     *          3  | 28       | 22.5
     *          4  | 14.25    | 11.25
     *          5  | 7.25     | not specified
     *
     * Because of this, we are doing a linear interpolation for zoom values <= 2 and
     * then switch over to an inverse exponential. In practice, the produced
     * values are good enough to result in stable marker positioning, even for
     * intermediate zoom values.
     *
     * @return {number} The (horizontal) field of view angle for the given zoom.
     */
    PanoMarker.get3dFov = function(zoom) {
        return zoom <= 2 ?
            126.5 - zoom * 36.75 :  // linear descent
            195.93 / Math.pow(1.92, zoom); // parameters determined experimentally
    };


    /**
     * Given the current POV, this method calculates the Pixel coordinates on the
     * given viewport for the desired POV. All credit for the math this method goes
     * to user3146587 on StackOverflow: http://goo.gl/0GGKi6
     *
     * My own approach to explain what is being done here (including figures!) can
     * be found at http://martinmatysiak.de/blog/view/panomarker
     *
     * @param {StreetViewPov} targetPov The point-of-view whose coordinates are
     *     requested.
     * @param {StreetViewPov} currentPov POV of the viewport center.
     * @param {number} zoom The current zoom level.
     * @param {Element} viewport The current viewport containing the panorama.
     * @return {Object} Top and Left offsets for the given viewport that point to
     *     the desired point-of-view.
     */
    PanoMarker.povToPixel3d = function(targetPov, currentPov, zoom, viewport) {

        // Gather required variables and convert to radians where necessary
        var width = viewport.offsetWidth;
        var height = viewport.offsetHeight;

        // Adjusts the width and height for when placing PanoMarkers on mobile phones.
        if (isMobile()) {
            width = window.innerWidth;
            height = window.innerHeight;
        }

        var target = {
            left: width / 2,
            top: height / 2
        };

        var DEG_TO_RAD = Math.PI / 180.0;
        var fov = PanoMarker.get3dFov(zoom) * DEG_TO_RAD;
        var h0 = currentPov.heading * DEG_TO_RAD;
        var p0 = currentPov.pitch * DEG_TO_RAD;
        var h = targetPov.heading * DEG_TO_RAD;
        var p = targetPov.pitch * DEG_TO_RAD;

        // f = focal length = distance of current POV to image plane
        var f = (width / 2) / Math.tan(fov / 2);

        // our coordinate system: camera at (0,0,0), heading = pitch = 0 at (0,f,0)
        // calculate 3d coordinates of viewport center and target
        var cos_p = Math.cos(p);
        var sin_p = Math.sin(p);

        var cos_h = Math.cos(h);
        var sin_h = Math.sin(h);

        var x = f * cos_p * sin_h;
        var y = f * cos_p * cos_h;
        var z = f * sin_p;

        var cos_p0 = Math.cos(p0);
        var sin_p0 = Math.sin(p0);

        var cos_h0 = Math.cos(h0);
        var sin_h0 = Math.sin(h0);

        var x0 = f * cos_p0 * sin_h0;
        var y0 = f * cos_p0 * cos_h0;
        var z0 = f * sin_p0;

        var nDotD = x0 * x + y0 * y + z0 * z;
        var nDotC = x0 * x0 + y0 * y0 + z0 * z0;

        // nDotD == |targetVec| * |currentVec| * cos(theta)
        // nDotC == |currentVec| * |currentVec| * 1
        // Note: |currentVec| == |targetVec| == f

        // Sanity check: the vectors shouldn't be perpendicular because the line
        // from camera through target would never intersect with the image plane
        if (Math.abs(nDotD) < 1e-6) {
            return null;
        }

        // t is the scale to use for the target vector such that its end
        // touches the image plane. It's equal to 1/cos(theta) ==
        //     (distance from camera to image plane through target) /
        //     (distance from camera to target == f)
        var t = nDotC / nDotD;

        // Sanity check: it doesn't make sense to scale the vector in a negative
        // direction. In fact, it should even be t >= 1.0 since the image plane
        // is always outside the pano sphere (except at the viewport center)
        if (t < 0.0) {
            return null;
        }

        // (tx, ty, tz) are the coordinates of the intersection point between a
        // line through camera and target with the image plane
        var tx = t * x;
        var ty = t * y;
        var tz = t * z;

        // u and v are the basis vectors for the image plane
        var vx = -sin_p0 * sin_h0;
        var vy = -sin_p0 * cos_h0;
        var vz = cos_p0;

        var ux = cos_h0;
        var uy = -sin_h0;
        var uz = 0;

        // normalize horiz. basis vector to obtain orthonormal basis
        var ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
        ux /= ul;
        uy /= ul;
        uz /= ul;

        // project the intersection point t onto the basis to obtain offsets in
        // terms of actual pixels in the viewport
        var du = tx * ux + ty * uy + tz * uz;
        var dv = tx * vx + ty * vy + tz * vz;

        // use the calculated pixel offsets
        target.left += du;
        target.top -= dv;
        return target;
    };


    /**
     * Helper function that converts the heading to be in the range [-180,180).
     *
     * @param {number} heading The heading to convert.
     */
    PanoMarker.wrapHeading = function(heading) {
        // We shift to the range [0,360) because of the way JS behaves for modulos of
        // negative numbers.
        heading = (heading + 180) % 360;

        // Determine if we have to wrap around
        if (heading < 0) {
            heading += 360;
        }

        return heading - 180;
    };


    /**
     * A simpler version of povToPixel2d which does not have to do the spherical
     * projection because the raw StreetView tiles are just panned around when the
     * user changes the viewport position.
     *
     * @param {StreetViewPov} targetPov The point-of-view whose coordinates are
     *     requested.
     * @param {StreetViewPov} currentPov POV of the viewport center.
     * @param {number} zoom The current zoom level.
     * @param {Element} viewport The current viewport containing the panorama.
     * @return {Object} Top and Left offsets for the given viewport that point to
     *     the desired point-of-view.
     */
    PanoMarker.povToPixel2d = function(targetPov, currentPov, zoom, viewport) {
        // Gather required variables
        var width = viewport.offsetWidth;
        var height = viewport.offsetHeight;

        var target = {
            left: width / 2,
            top: height / 2
        };

        // In the 2D environment, the FOV follows the documented curve.
        var hfov = 180 / Math.pow(2, zoom);
        var vfov = hfov * (height / width);
        var dh = PanoMarker.wrapHeading(targetPov.heading - currentPov.heading);
        var dv = targetPov.pitch - currentPov.pitch;

        target.left += dh / hfov * width;
        target.top -= dv / vfov * height;
        return target;
    };


//// Implementations for abstract methods inherited from g.m.OverlayView ////


    /** @override */
    PanoMarker.prototype.onAdd = function() {
        if (!!this.marker_) {
            // Sometimes the maps API does trigger onAdd correctly. We have to prevent
            // duplicate execution of the following code by checking if the marker node
            // has already been created.
            return;
        }

        var marker = document.createElement('div');
        marker.classList.add('icon-outline');

        // Basic style attributes for every marker
        marker.style.position = 'absolute';
        marker.style.cursor = 'inherit';    // To keep the mouseover icon open hand. See: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/1393
        marker.style.width = this.size_.width + 'px';
        marker.style.height = this.size_.height + 'px';
        marker.style.display = this.visible_ ? 'block' : 'none';
        marker.style.zIndex = this.zIndex_;

        // Set other css attributes based on the given parameters
        if (this.id_) { marker.id = this.id_; }
        if (this.className_) { marker.className = this.className_; }
        if (this.title_) { marker.title = this.title_; }
        if (this.icon_) { marker.style.backgroundImage = 'url(' + this.icon_ + ')'; }

        // If neither icon, class nor id is specified, assign the basic google maps
        // marker image to the marker (otherwise it will be invisible)
        if (!(this.id_ || this.className_ || this.icon_)) {
            marker.style.backgroundImage = 'url(https://www.google.com/intl/en_us/' +
                'mapfiles/ms/micons/red-dot.png)';
        }

        this.marker_ = marker;

        // Add marker to viewControlLayer if on validate page.
        if (this.markerContainer_ == null) {
            this.markerContainer_ = this.getPanes().overlayMouseTarget;
        }

        this.markerContainer_.appendChild(marker);

        // Attach to some global events
        window.addEventListener('resize', this.draw.bind(this));
        this.povListener_ = google.maps.event.addListener(this.getMap(),
            'pov_changed', this.draw.bind(this));
        this.zoomListener_ = google.maps.event.addListener(this.getMap(),
            'zoom_changed', this.draw.bind(this));

        var eventName = 'click';

        // Make clicks possible
        if (window.PointerEvent) {
            eventName = 'pointerdown';
        } else if (window.MSPointerEvent) {
            eventName = 'MSPointerDown';
        }

        marker.addEventListener(eventName, this.onClick.bind(this), false);

        // If this is a validation label, we want to add mouse-hovering event
        // for popped up hide/show label.
        if (this.id_ === "validate-pano-marker") {
            if (isMobile()) {
                marker.addEventListener('touchstart', function () {
                    let labelDescriptionBox = $("#label-description-box");
                    let desBox = labelDescriptionBox[0];
                    if (!this.toggleDescription_) {
                        desBox.style.right = (svv.canvasWidth - parseFloat(marker.style.left) - (parseFloat(marker.style.width) / 2)) + 'px';
                        desBox.style.top = (parseFloat(marker.style.top) + (parseFloat(marker.style.height) / 2)) + 'px';
                        desBox.style.zIndex = 2;
                        desBox.style.visibility = 'visible';
                        this.toggleDescription_ = true;
                    } else {
                        desBox.style.visibility = 'hidden';
                        this.toggleDescription_ = false;
                    }
                }.bind(this), false);
            } else {
                marker.addEventListener("mouseover", function () {
                    svv.labelVisibilityControl.showTagsAndDeleteButton();
                });

                marker.addEventListener("mouseout", function () {
                    svv.labelVisibilityControl.hideTagsAndDeleteButton();
                });
            }
        }

        this.draw();

        // Fire 'add' event once the marker has been created.
        google.maps.event.trigger(this, 'add', this.marker_);
    };


    /** @override */
    PanoMarker.prototype.draw = function() {
        if (!this.pano_) {
            return;
        }

        if (this.toggleDescription_) {
            let labelDescriptionBox = $("#label-description-box");
            let desBox = labelDescriptionBox[0];
            desBox.style.visibility = 'hidden';
            this.toggleDescription_ = false;
        }

        // Calculate the position according to the viewport. Even though the marker
        // doesn't sit directly underneath the panorama container, we pass it on as
        // the viewport because it has the actual viewport dimensions.
        var offset = this.povToPixel_(this.position_,
            this.pano_.getPov(),
            typeof this.pano_.getZoom() !== 'undefined' ? this.pano_.getZoom() : 1,
            this.container_);
        if (this.marker_) {
            if (offset !== null) {
                this.marker_.style.left = (offset.left - this.anchor_.x) + 'px';
                this.marker_.style.top = (offset.top - this.anchor_.y) + 'px';
            } else {
                // If offset is null, the marker is "behind" the camera,
                // therefore we position the marker outside of the viewport
                this.marker_.style.left = -(9999 + this.size_.width) + 'px';
                this.marker_.style.top = '0';
            }
        }
    };


    /** @param {Object} event The event object. */
    PanoMarker.prototype.onClick = function(event) {
        if (this.clickable_) {
            google.maps.event.trigger(this, 'click');
        }

        // don't let the event bubble up
        event.cancelBubble = true;
        if (event.stopPropagation) { event.stopPropagation(); }
    };


    /** @override */
    PanoMarker.prototype.onRemove = function() {
        if (!this.marker_) {
            // Similar to onAdd, we have to prevent duplicate onRemoves as well.
            return;
        }

        google.maps.event.removeListener(this.povListener_);
        google.maps.event.removeListener(this.zoomListener_);
        this.marker_.parentNode.removeChild(this.marker_);
        this.marker_ = null;

        // Fire 'remove' event once the marker has been destroyed.
        google.maps.event.trigger(this, 'remove');
    }

//// Getter to be roughly equivalent to the regular google.maps.Marker ////


    /** @return {google.maps.Point} The marker's anchor. */
    PanoMarker.prototype.getAnchor = function() { return this.anchor_; };


    /** @return {string} The className or null if not set upon marker creation. */
    PanoMarker.prototype.getClassName = function() { return this.className_; };


    /** @return {boolean} Whether the marker is clickable. */
    PanoMarker.prototype.getClickable = function() { return this.clickable_; };


    /** @return {string} The current icon, if any. */
    PanoMarker.prototype.getIcon = function() { return this.icon_; };


    /** @return {string} The identifier or null if not set upon marker creation. */
    PanoMarker.prototype.getId = function() { return this.id_; };

    /** @return {google.maps.StreetViewPanorama} The current panorama. */
    PanoMarker.prototype.getPano = function() { return this.pano_; };


    /** @return {google.maps.StreetViewPov} The marker's current position. */
    PanoMarker.prototype.getPosition = function() { return this.position_; };


    /** @return {google.maps.Size} The marker's size. */
    PanoMarker.prototype.getSize = function() { return this.size_; };


    /** @return {string} The marker's rollover text. */
    PanoMarker.prototype.getTitle = function() { return this.title_; };


    /** @return {boolean} Whether the marker is currently visible. */
    PanoMarker.prototype.getVisible = function() { return this.visible_; };


    /** @return {number} The marker's z-index. */
    PanoMarker.prototype.getZIndex = function() { return this.zIndex_; };

//// Setter for the properties mentioned above ////


    /** @param {google.maps.Point} anchor The marker's new anchor. */
    PanoMarker.prototype.setAnchor = function(anchor) {
        this.anchor_ = anchor;
        this.draw();
    };


    /** @param {string} className The new className. */
    PanoMarker.prototype.setClassName = function(className) {
        this.className_ = className;
        if (!!this.marker_) {
            this.marker_.className = className;
        }
    };


    /** @param {boolean} clickable Whether the marker shall be clickable. */
    PanoMarker.prototype.setClickable = function(clickable) {
        this.clickable_ = clickable;
    };


    /** @param {?string} icon URL to a new icon, or null in order to remove it. */
    PanoMarker.prototype.setIcon = function(icon) {
        this.icon_ = icon;
        if (!!this.marker_) {
            this.marker_.style.backgroundImage = !!icon ? 'url(' + icon + ')' : '';
        }
    };


    /** @param {string} id The new id. */
    PanoMarker.prototype.setId = function(id) {
        this.id_ = id;
        if (!!this.marker_) {
            this.marker_.id = id;
        }
    };


    /**
     * It turns out OverlayViews can be used with StreetViewPanoramas as well.
     * However, we have to fire onAdd and onRemove calls manually as they are not
     * triggered automatically for some reason if the object given to setMap is a
     * StreetViewPanorama.
     *
     * @param {google.maps.StreetViewPanorama} pano The panorama in which to show
     *    the marker.
     * @param {HTMLDivElement} container The container holding the panorama.
     */
    PanoMarker.prototype.setPano = function(pano, container) {
        // In contrast to regular OverlayViews, we are disallowing the usage on
        // regular maps
        if (!!pano && !(pano instanceof google.maps.StreetViewPanorama)) {
            throw 'PanoMarker only works inside a StreetViewPanorama.';
        }

        // Remove the marker if it previously was on a panorama
        if (!!this.pano_) {
            this.onRemove();
        }

        // Call method from superclass
        this.setMap(pano);
        this.pano_ = pano;
        this.container_ = container;

        // Fire the onAdd Event manually as soon as the pano is ready
        if (!!pano) {
            var promiseFn = function(resolve) {
                // Poll for panes to become available
                var pollCallback = function() {
                    if (!!this.getPanes()) {
                        window.clearInterval(this.pollId_);
                        this.onAdd();
                        if (resolve) { resolve(this); }
                    }
                };

                this.pollId_ = window.setInterval(pollCallback.bind(this), 10);
            };

            // Best case, the promiseFn can be wrapped in a Promise so the consumer knows when the pano is set
            // Otherwise just call the function immediately
            if (typeof Promise !== 'undefined') {
                return new Promise(promiseFn.bind(this));
            } else {
                promiseFn.call(this);
            }
        }
    };


    /** @param {google.maps.StreetViewPov} position The desired position. */
    PanoMarker.prototype.setPosition = function(position) {
        this.position_ = position;
        this.draw();
    };


    /** @param {google.maps.Size} size The new size. */
    PanoMarker.prototype.setSize = function(size) {
        this.size_ = size;
        if (!!this.marker_) {
            this.marker_.style.width = size.width + 'px';
            this.marker_.style.height = size.height + 'px';
            this.draw();
        }
    };


    /** @param {string} title The new rollover text. */
    PanoMarker.prototype.setTitle = function(title) {
        this.title_ = title;
        if (!!this.marker_) {
            this.marker_.title = title;
        }
    };


    /** @param {boolean} show Whether the marker shall be visible. */
    PanoMarker.prototype.setVisible = function(show) {
        this.visible_ = show;
        if (!!this.marker_) {
            this.marker_.style.display = show ? 'block' : 'none';
        }
    };


    /** @param {number} zIndex The new z-index. */
    PanoMarker.prototype.setZIndex = function(zIndex) {
        this.zIndex_ = zIndex;
        if (!!this.marker_) {
            this.marker_.style.zIndex = zIndex;
        }
    };

    return PanoMarker;
}));


var util = util || {};
util.misc = util.misc || {};

function UtilitiesMisc (JSON) {
    var self = { className: "UtilitiesMisc" };

    // Returns image paths corresponding to each label type.
    function getIconImagePaths(category) {
        var imagePaths = {
            Walk : {
                id : 'Walk',
                iconImagePath : null,
                minimapIconImagePath: null
            },
            CurbRamp: {
                id: 'CurbRamp',
                iconImagePath : svl.rootDirectory + 'img/icons/CurbRamp_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/CurbRamp_tiny.png'
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                iconImagePath : svl.rootDirectory + 'img/icons/NoCurbRamp_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/NoCurbRamp_tiny.png'
            },
            Obstacle: {
                id: 'Obstacle',
                iconImagePath: svl.rootDirectory + 'img/icons/Obstacle_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/Obstacle_tiny.png'
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                iconImagePath: svl.rootDirectory + 'img/icons/SurfaceProblem_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/SurfaceProblem_tiny.png'
            },
            Other: {
                id: 'Other',
                iconImagePath: svl.rootDirectory + 'img/icons/Other_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/Other_tiny.png'
            },
            Occlusion: {
                id: 'Occlusion',
                iconImagePath: svl.rootDirectory + 'img/icons/Occlusion_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/Occlusion_tiny.png'
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                iconImagePath: svl.rootDirectory + 'img/icons/NoSidewalk_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/NoSidewalk_tiny.png'
            },
            Crosswalk: {
                id: 'Crosswalk',
                iconImagePath: svl.rootDirectory + 'img/icons/Crosswalk_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/Crosswalk_tiny.png'
            },
            Signal: {
                id: 'Signal',
                iconImagePath: svl.rootDirectory + 'img/icons/Signal_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/Signal_tiny.png'
            }
        };

        return category ? imagePaths[category] : imagePaths;
    }

    function getLabelDescriptions(category) {
        var descriptions = {
            'Walk': {
                'id': 'Walk',
                'text': 'Walk',
                keyChar: 'E'
            },
            CurbRamp: {
                id: 'CurbRamp',
                text: 'Curb Ramp',
                keyChar: 'C',
                tagInfo: {
                    'narrow': {
                        keyChar: 'A',
                        text: i18next.t('center-ui.context-menu.tag.narrow')
                    },
                    'points into traffic': {
                        keyChar: 'I',
                        text: i18next.t('center-ui.context-menu.tag.points-into-traffic')
                    },
                    'missing tactile warning': {
                        keyChar: 'E',
                        text: i18next.t('center-ui.context-menu.tag.missing-tactile-warning')
                    },
                    'tactile warning': {
                        keyChar: 'H',
                        text: i18next.t('center-ui.context-menu.tag.tactile-warning')
                    },
                    'steep': {
                        keyChar: 'T',
                        text: i18next.t('center-ui.context-menu.tag.steep')
                    },
                    'not enough landing space': {
                        keyChar: 'L',
                        text: i18next.t('center-ui.context-menu.tag.not-enough-landing-space')
                    },
                    'not level with street': {
                        keyChar: 'V',
                        text: i18next.t('center-ui.context-menu.tag.not-level-with-street')
                    },
                    'surface problem': {
                        keyChar: 'R',
                        text: i18next.t('center-ui.context-menu.tag.surface-problem')
                    },
                    'pooled water': {
                        keyChar: 'D',
                        text: i18next.t('center-ui.context-menu.tag.pooled-water')
                    }
                }
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                text: 'Missing Curb Ramp',
                keyChar: 'M',
                tagInfo: {
                    'alternate route present': {
                        keyChar: 'A',
                        text: i18next.t('center-ui.context-menu.tag.alternate-route-present')
                    },
                    'no alternate route': {
                        keyChar: 'L',
                        text: i18next.t('center-ui.context-menu.tag.no-alternate-route')
                    },
                    'unclear if needed': {
                        keyChar: 'U',
                        text: i18next.t('center-ui.context-menu.tag.unclear-if-needed')
                    }
                }
            },
            Obstacle: {
                id: 'Obstacle',
                text: 'Obstacle in Path',
                keyChar: 'O',
                tagInfo: {
                    'trash/recycling can': {
                        keyChar: 'H',
                        text: i18next.t('center-ui.context-menu.tag.trash-recycling-can')
                    },
                    'fire hydrant': {
                        keyChar: 'F',
                        text: i18next.t('center-ui.context-menu.tag.fire-hydrant')
                    },
                    'pole': {
                        keyChar: 'L',
                        text: i18next.t('center-ui.context-menu.tag.pole')
                    },
                    'tree': {
                        keyChar: 'E',
                        text: i18next.t('center-ui.context-menu.tag.tree')
                    },
                    'vegetation': {
                        keyChar: 'V',
                        text: i18next.t('center-ui.context-menu.tag.vegetation')
                    },
                    'parked car': {
                        keyChar: 'U',
                        text: i18next.t('center-ui.context-menu.tag.parked-car')
                    },
                    'parked bike': {
                        keyChar: 'K',
                        text: i18next.t('center-ui.context-menu.tag.parked-bike')
                    },
                    'construction': {
                        keyChar: 'T',
                        text: i18next.t('center-ui.context-menu.tag.construction')
                    },
                    'sign': {
                        keyChar: 'I',
                        text: i18next.t('center-ui.context-menu.tag.sign')
                    },
                    'garage entrance': {
                        keyChar: 'G',
                        text: i18next.t('center-ui.context-menu.tag.garage-entrance')
                    },
                    'stairs': {
                        keyChar: 'R',
                        text: i18next.t('center-ui.context-menu.tag.stairs')
                    },
                    'street vendor': {
                        keyChar: 'J',
                        text: i18next.t('center-ui.context-menu.tag.street-vendor')
                    },
                    'height difference': {
                        keyChar: 'D',
                        text: i18next.t('center-ui.context-menu.tag.height-difference')
                    },
                    'narrow': {
                        keyChar: 'A',
                        text: i18next.t('center-ui.context-menu.tag.narrow')
                    },
                    'litter/garbage': {
                        keyChar: 'X',
                        text: i18next.t('center-ui.context-menu.tag.litter-garbage')
                    },
                    'parked scooter/motorcycle': {
                        keyChar: 'Y',
                        text: i18next.t('center-ui.context-menu.tag.parked-scooter-motorcycle')
                    }
                }
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                text: 'Surface Problem',
                keyChar: 'S',
                tagInfo: {
                    'bumpy': {
                        keyChar: 'Y',
                        text: i18next.t('center-ui.context-menu.tag.bumpy')
                    },
                    'uneven/slanted': {
                        keyChar: 'U',
                        text: i18next.t('center-ui.context-menu.tag.uneven-slanted')
                    },
                    'cracks': {
                        keyChar: 'K',
                        text: i18next.t('center-ui.context-menu.tag.cracks')
                    },
                    'grass': {
                        keyChar: 'G',
                        text: i18next.t('center-ui.context-menu.tag.grass')
                    },
                    'narrow sidewalk': {
                        keyChar: 'A',
                        text: i18next.t('center-ui.context-menu.tag.narrow')
                    },
                    'brick/cobblestone': {
                        keyChar: 'I',
                        text: i18next.t('center-ui.context-menu.tag.brick-cobblestone')
                    },
                    'construction': {
                        keyChar: 'T',
                        text: i18next.t('center-ui.context-menu.tag.construction')
                    },
                    'very broken': {
                        keyChar: 'R',
                        text: i18next.t('center-ui.context-menu.tag.very-broken')
                    },
                    'height difference': {
                        keyChar: 'D',
                        text: i18next.t('center-ui.context-menu.tag.height-difference')
                    },
                    'rail/tram track': {
                        keyChar: 'L',
                        text: i18next.t('center-ui.context-menu.tag.rail-tram-track')
                    },
                    'sand/gravel': {
                        keyChar: 'V',
                        text: i18next.t('center-ui.context-menu.tag.sand-gravel')
                    },
                    'uncovered manhole': {
                        keyChar: 'E',
                        text: i18next.t('center-ui.context-menu.tag.uncovered-manhole')
                    }
                }
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                text: 'No Sidewalk',
                keyChar: 'N',
                tagInfo: {
                    'ends abruptly': {
                        keyChar: 'A',
                        text: i18next.t('center-ui.context-menu.tag.ends-abruptly')
                    },
                    'street has a sidewalk': {
                        keyChar: 'R',
                        text: i18next.t('center-ui.context-menu.tag.street-has-a-sidewalk')
                    },
                    'street has no sidewalks': {
                        keyChar: 'T',
                        text: i18next.t('center-ui.context-menu.tag.street-has-no-sidewalks')
                    },
                    'gravel/dirt road': {
                        keyChar: 'D',
                        text: i18next.t('center-ui.context-menu.tag.gravel-dirt-road')
                    },
                    'shared pedestrian/car space': {
                        keyChar: 'E',
                        text: i18next.t('center-ui.context-menu.tag.shared-pedestrian-car-space')
                    }
                }
            },
            Crosswalk: {
                id: 'Crosswalk',
                text: 'Crosswalk',
                keyChar: 'W',
                tagInfo: {
                    'paint fading': {
                        keyChar: 'F',
                        text: i18next.t('center-ui.context-menu.tag.paint-fading')
                    },
                    'broken surface': {
                        keyChar: 'R',
                        text: i18next.t('center-ui.context-menu.tag.broken-surface')
                    },
                    'uneven surface': {
                        keyChar: 'E',
                        text: i18next.t('center-ui.context-menu.tag.uneven-surface')
                    },
                    'brick/cobblestone': {
                        keyChar: 'I',
                        text: i18next.t('center-ui.context-menu.tag.brick-cobblestone')
                    },
                    'bumpy': {
                        keyChar: 'Y',
                        text: i18next.t('center-ui.context-menu.tag.bumpy')
                    },
                    'rail/tram track': {
                        keyChar: 'L',
                        text: i18next.t('center-ui.context-menu.tag.rail-tram-track')
                    },
                    'no pedestrian priority': {
                        keyChar: 'V',
                        text: i18next.t('center-ui.context-menu.tag.no-pedestrian-priority')
                    },
                    'very long crossing': {
                        keyChar: 'U',
                        text: i18next.t('center-ui.context-menu.tag.very-long-crossing')
                    },
                    'level with sidewalk': {
                        keyChar: 'D',
                        text: i18next.t('center-ui.context-menu.tag.level-with-sidewalk')
                    }
                }
            },
            Signal: {
                id: 'Signal',
                text: 'Pedestrian Signal',
                keyChar: 'P',
                tagInfo: {
                    'has button': {
                        keyChar: 'U',
                        text: i18next.t('center-ui.context-menu.tag.has-button')
                    },
                    'button waist height': {
                        keyChar: 'H',
                        text: i18next.t('center-ui.context-menu.tag.button-waist-height')
                    },
                    'APS': {
                        keyChar: 'A',
                        text: i18next.t('center-ui.context-menu.tag.APS')
                    }
                }
            },
            Other: {
                id: 'Other',
                text: 'Other',
                tagInfo: {
                    'missing crosswalk': {
                        keyChar: 'I',
                        text: i18next.t('center-ui.context-menu.tag.missing-crosswalk')
                    },
                    'no bus stop access': {
                        keyChar: 'A',
                        text: i18next.t('center-ui.context-menu.tag.no-bus-stop-access')
                    }
                }
            },
            Occlusion: {
                id: 'Occlusion',
                text: "Can't see the sidewalk",
                keyChar: 'B'
            }
        };
        return category ? descriptions[category] : descriptions;
    }

    /**
     * Gets the severity message and severity image location that is displayed on a label tag.
     * @returns {{1: {message: string, severityImage: string}, 2: {message: string, severityImage: string},
     *              3: {message: string, severityImage: string}, 4: {message: string, severityImage: string},
     *              5: {message: string, severityImage: string}}}
     */
    function getSeverityDescription() {
        return {
            1: {
                message: i18next.t('center-ui.context-menu.tooltip.passable'),
                severityImage: svl.rootDirectory + 'img/misc/SmileyScale_1_White_Small.png'
            },

            2: {
                message: i18next.t('center-ui.context-menu.tooltip.somewhat-passable'),
                severityImage: svl.rootDirectory + 'img/misc/SmileyScale_2_White_Small.png'
            },

            3: {
                message: i18next.t('center-ui.context-menu.tooltip.difficult-to-pass'),
                severityImage: svl.rootDirectory + 'img/misc/SmileyScale_3_White_Small.png'
            },

            4: {
                message: i18next.t('center-ui.context-menu.tooltip.very-difficult-to-pass'),
                severityImage: svl.rootDirectory + 'img/misc/SmileyScale_4_White_Small.png'
            },

            5: {
                message: i18next.t('center-ui.context-menu.tooltip.not-passable'),
                severityImage: svl.rootDirectory + 'img/misc/SmileyScale_5_White_Small.png'
            }
        };
    }

    /**
     * References: Ajax without jQuery.
     * http://stackoverflow.com/questions/8567114/how-to-make-an-ajax-call-without-jquery
     * http://stackoverflow.com/questions/6418220/javascript-send-json-object-with-ajax
     * @param streetEdgeId
     */
    function reportNoStreetView(streetEdgeId) {
        var x = new XMLHttpRequest(), async = true, url = "/audit/nostreetview";
        x.open('POST', url, async);
        x.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
        x.send(JSON.stringify({issue: "NoStreetView", street_edge_id: streetEdgeId}));
    }

    const colors = {
        Walk : {
            id : 'Walk',
            fillStyle : 'rgba(0, 0, 0, 1)',
            strokeStyle: '#FFFFFF'
        },
        CurbRamp: {
            id: 'CurbRamp',
            fillStyle: '#90C31F',
            strokeStyle: '#FFFFFF'
        },
        NoCurbRamp: {
            id: 'NoCurbRamp',
            fillStyle: '#E679B6',
            strokeStyle: '#FFFFFF'
        },
        Obstacle: {
            id: 'Obstacle',
            fillStyle: '#78B0EA',
            strokeStyle: '#FFFFFF'
        },
        Other: {
            id: 'Other',
            fillStyle: '#B3B3B3',
            strokeStyle: '#0000FF'
        },
        Occlusion: {
            id: 'Occlusion',
            fillStyle: '#B3B3B3',
            strokeStyle: '#009902'
        },
        NoSidewalk: {
            id: 'NoSidewalk',
            fillStyle: '#BE87D8',
            strokeStyle: '#FFFFFF'
        },
        SurfaceProblem: {
            id: 'SurfaceProblem',
            fillStyle: '#F68D3E',
            strokeStyle: '#FFFFFF'
        },
        Crosswalk: {
            id: 'Crosswalk',
            fillStyle: '#FABF1C',
            strokeStyle: '#FFFFFF'
        },
        Signal: {
            id: 'Signal',
            fillStyle: '#63C0AB',
            strokeStyle: '#FFFFFF'
        }
    };
    function getLabelColors(category) {
        return category ? colors[category].fillStyle : colors;
    }

    self.getIconImagePaths = getIconImagePaths;
    self.getLabelDescriptions = getLabelDescriptions;
    self.getSeverityDescription = getSeverityDescription;
    self.getLabelColors = getLabelColors;
    self.reportNoStreetView = reportNoStreetView;

    return self;
}

util.misc = UtilitiesMisc(JSON);

/**
 * Displays info about the current GSV pane.
 *
 * @param {HTMLElement} container Element where the info button will be displayed
 * @param {StreetViewPanorama} panorama Panorama object
 * @param {function} coords Function that returns current longitude and latitude coordinates
 * @param {function} panoId Function that returns current panorama ID
 * @param {function} streetEdgeId Function that returns current Street Edge ID
 * @param {function} regionId Function that returns current Region ID
 * @param {function} pov Function that returns current POV
 * @param {Boolean} whiteIcon Set to true if using white icon, false if using blue icon.
 * @param {function} infoLogging Function that adds the info button click to the appropriate logs.
 * @param {function} clipboardLogging Function that adds the copy to clipboard click to the appropriate logs.
 * @param {function} viewGSVLogging Function that adds the View in GSV click to the appropriate logs.
 * @param {function} [labelId] Optional function that returns the Label ID.
 * @returns {GSVInfoPopover} Popover object, which holds the popover title html, content html, info button html, and
 * update values method
 */
function GSVInfoPopover (container, panorama, coords, panoId, streetEdgeId, regionId, pov, whiteIcon, infoLogging, clipboardLogging, viewGSVLogging, labelId) {
    let self = this;

    function _init() {
        // Create popover title bar.
        self.titleBox = document.createElement('div');

        let title = document.createElement('span');
        title.classList.add('popover-element');
        title.textContent = i18next.t('common:gsv-info.details-title');
        self.titleBox.appendChild(title);

        let clipboard = document.createElement('img');
        clipboard.classList.add('popover-element');
        clipboard.src = '/assets/images/icons/clipboard_copy.png';
        clipboard.id = 'clipboard';
        clipboard.setAttribute('data-toggle', 'popover');

        self.titleBox.appendChild(clipboard);

        // Create popover content.
        self.popoverContent = document.createElement('div');

        // Add in container for each info type to the popover.
        let dataList = document.createElement('ul');
        dataList.classList.add('list-group', 'list-group-flush', 'gsv-info-list-group');

        addListElement('latitude', dataList);
        addListElement('longitude', dataList);
        addListElement('panorama-id', dataList);
        addListElement('street-id', dataList);
        addListElement('region-id', dataList);
        if (labelId) addListElement('label-id', dataList);

        self.popoverContent.appendChild(dataList);

        // Create element for a link to GSV in a separate tab.
        let linkGSV = document.createElement('a');
        linkGSV.classList.add('popover-element');
        linkGSV.id = 'gsv-link'
        linkGSV.textContent = i18next.t('common:gsv-info.view-in-gsv');
        self.popoverContent.appendChild(linkGSV);

        // Create info button and add popover attributes.
        self.infoButton = document.createElement('img');
        self.infoButton.classList.add('popover-element');
        self.infoButton.id = 'gsv-info-button';
        if (whiteIcon) self.infoButton.src = '/assets/images/icons/gsv_info_btn_white.svg';
        else self.infoButton.src = '/assets/images/icons/gsv_info_btn.png';
        self.infoButton.setAttribute('data-toggle', 'popover');

        container.append(self.infoButton);

        // Enable popovers/tooltips and set options.
        $('#gsv-info-button').popover({
            html: true,
            placement: 'top',
            container: 'body',
            title: self.titleBox.innerHTML,
            content: self.popoverContent.innerHTML
        }).on('click', updateVals).on('shown.bs.popover', () => {
            // Add popover-element classes to more elements, making it easier to dismiss popover on when outside it.
            $('.popover-title').addClass('popover-element');
            $('.popover-content').addClass('popover-element');

            // Initialize the popover for the clipboard.
            $('#clipboard').popover({
                placement: 'top',
                trigger: 'manual',
                html: true,
                content: `<span class="clipboard-tooltip">${i18next.t('common:gsv-info.copied-to-clipboard')}</span>`
            });
        });

        // Dismiss popover when clicking outside it. Anything without the 'popover-element' class is considered outside.
        $(document).on('mousedown', (e) => {
            let tar = $(e.target);
            if (!tar[0].classList.contains('popover-element')) {
                $('#gsv-info-button').popover('hide');
            }
        });
        // Dismiss popover whenever panorama changes.
        panorama.addListener('pano_changed', () => {
            $('#gsv-info-button').popover('hide');
        })
    }

    /**
     * Update the values within the popover.
     */
    function updateVals() {
        // Log the click on the info button.
        infoLogging();

        // Get info values.
        const currCoords = coords ? coords() : {lat: null, lng: null};
        const currPanoId = panoId ? panoId() : null;
        const currStreetEdgeId = streetEdgeId ? streetEdgeId() : null;
        const currRegionId = regionId ? regionId() : null;
        const currPov = pov ? pov() : {heading: 0, pitch: 0};
        const currLabelId = labelId ? labelId() : null;

        function changeVals(key, val) {
            if (!val) {
                val = 'No Info';
            } else if (key === "latitude" || key === 'longitude') {
                val = val.toFixed(8) + '°';
            }
            let valSpan = document.getElementById(`${key}-value`);
            valSpan.textContent = val;
        }
        changeVals('latitude', currCoords.lat);
        changeVals('longitude', currCoords.lng);
        changeVals('panorama-id', currPanoId);
        changeVals('street-id', currStreetEdgeId);
        changeVals('region-id', currRegionId);
        if (currLabelId) changeVals('label-id', currLabelId);

        // Create GSV link and log the click.
        let gsvLink = $('#gsv-link');
        gsvLink.attr('href', `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${currCoords.lat}%2C${currCoords.lng}&heading=${currPov.heading}&pitch=${currPov.pitch}`);
        gsvLink.attr('target', '_blank');
        gsvLink.on('click', viewGSVLogging);

        // Position popover.
        let infoPopover = $('.popover');
        let infoRect = self.infoButton.getBoundingClientRect();
        let xpos = infoRect.x + (infoRect.width / 2) - (infoPopover.width() / 2);
        infoPopover.css('left', `${xpos}px`);

        // Copy to clipboard.
        $('#clipboard').on('click', function(e) {
            // Log the click on the copy to keyboard button.
            clipboardLogging();

            let clipboardText = `${i18next.t(`common:gsv-info.latitude`)}: ${currCoords.lat}°\n` +
                `${i18next.t(`common:gsv-info.longitude`)}: ${currCoords.lng}°\n` +
                `${i18next.t(`common:gsv-info.panorama-id`)}: ${currPanoId}\n` +
                `${i18next.t(`common:gsv-info.street-id`)}: ${currStreetEdgeId}\n` +
                `${i18next.t(`common:gsv-info.region-id`)}: ${currRegionId}\n`;
            if (currLabelId) clipboardText += `${i18next.t(`common:gsv-info.label-id`)}: ${currLabelId}`;
            navigator.clipboard.writeText(clipboardText);

            // The clipboard popover will only show one time until you close and reopen the info button popover. I have
            // no idea why that's happening, but for some reason it works if you put it in a setTimeout. So I have a one
            // ms delay before showing the popover. Then it disappears after 1.5 seconds.
            setTimeout(function() {
                $(e.target).popover('show');
                setTimeout(function() {
                    $(e.target).popover('hide');
                }, 1500);
            }, 1);
        });
    }

    /**
     * Creates a key-value pair display within the popover.
     * @param {String} key Key name of the key-value pair
     * @param {HTMLElement} dataList List element container to add list item to
     */
    function addListElement(key, dataList) {
        let listElement = document.createElement('li');
        listElement.classList.add('list-group-item', 'info-list-item', 'popover-element', 'audit-selectable');

        let keySpan = document.createElement('span');
        keySpan.classList.add('info-key', 'popover-element');
        keySpan.textContent = i18next.t(`common:gsv-info.${key}`);
        listElement.appendChild(keySpan);

        let valSpan = document.createElement('span');
        valSpan.classList.add('info-val', 'popover-element');
        valSpan.textContent = '-';
        valSpan.id = `${key}-value`

        listElement.appendChild(valSpan);
        dataList.appendChild(listElement);
    }

    _init();

    self.updateVals = updateVals;

    return self;
}

/**
 * Initializes a full screen carousel for the mission start tutorial.
 * @param missionType mission type. Currently only VALIDATE mission is supported.
 * @param labelType one of the seven label types for which the tutorial needs to be initialized.
 * @param tracker the tracker object to log interactions.
 */
function MissionStartTutorial(missionType, labelType, tracker) {
    let self = this;

    const EXAMPLE_TYPES = {
        CORRECT: 'correct',
        INCORRECT: 'incorrect'
    };

    const MISSION_TYPES = {
        VALIDATE: 'validate'
    };

    // Map of exampleType to ID of the smiley icon to be used.
    const SMILEYS = {};
    SMILEYS[EXAMPLE_TYPES.CORRECT] = '#smile-positive';
    SMILEYS[EXAMPLE_TYPES.INCORRECT] = '#smile-negative';

    /**
     * Provides structure for a slide based tutorial framework.
     *
     * This object contains the following:
     *     - missionInstruction1: Text to be shown at the very top, above the slides area.
     *     - missionInstruction2: Text to be shown below missionInstruction1, above the slides area.
     *     - slides: An array of 'slides'.
     *
     *     Each 'slide' contains the following:
     *         - isExampleCorrect: boolean, indicating whether the example type is correct or incorrect.
     *         - slideTitle: string, title for the slide.
     *         - slideSubtitle: string, subtitle for the slide.
     *         - slideDescription: string, long form text description for the slide.
     *         - imageURL: string, URL to the image to be shown.
     *         - labelOnImage: object, containing the following:
     *             - position: object, containing 'top' and 'left' attributes for the on-image label.
     *                         The 'top' and 'left' must be defined with respect to the top and left
     *                         of the 'image element.'
     */
    const validateMSTDescriptor = {
        'CurbRamp': {
            'missionInstruction1': i18next.t('mission-start-tutorial.mst-instruction-1'),
            'missionInstruction2': i18next.t('mission-start-tutorial.mst-instruction-2',
                {'nLabels':'10', 'labelType': i18next.t('curb-ramp-caps')}),
            'slides': [
                {
                    'isExampleCorrect': true,
                    'slideTitle': i18next.t('mission-start-tutorial.curb-ramp.slide-1.title',
                        {'labelType': i18next.t('curb-ramp-caps')}),
                    'slideSubtitle': '',
                    'slideDescription': i18next.t('mission-start-tutorial.curb-ramp.slide-1.description'),
                    'imageURL': 'assets/images/tutorials/curbramp-correct-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '237px',
                            'top': '222px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.curb-ramp.slide-2.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.curb-ramp.slide-2.description'),
                    'imageURL': 'assets/images/tutorials/curbramp-incorrect-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '329px',
                            'top': '334px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.curb-ramp.slide-3.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.curb-ramp.slide-3.description'),
                    'imageURL': 'assets/images/tutorials/curbramp-incorrect-2.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '295px',
                            'top': '333px'
                        }
                    }
                }
            ]
        },
        'NoCurbRamp': {
            'missionInstruction1': i18next.t('mission-start-tutorial.mst-instruction-1'),
            'missionInstruction2': i18next.t('mission-start-tutorial.mst-instruction-2',
                {'nLabels':'10', 'labelType': i18next.t('missing-curb-ramp-caps')}),
            'slides': [
                {
                    'isExampleCorrect': true,
                    'slideTitle': i18next.t('mission-start-tutorial.no-curb-ramp.slide-1.title',
                        {'labelType': i18next.t('missing-curb-ramp-caps')}),
                    'slideSubtitle': '',
                    'slideDescription': i18next.t('mission-start-tutorial.no-curb-ramp.slide-1.description'),
                    'imageURL': 'assets/images/tutorials/no-curbramp-correct-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '392px',
                            'top': '157px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.no-curb-ramp.slide-2.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.no-curb-ramp.slide-2.description'),
                    'imageURL': 'assets/images/tutorials/no-curbramp-incorrect-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '324px',
                            'top': '250px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.no-curb-ramp.slide-3.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.no-curb-ramp.slide-3.description'),
                    'imageURL': 'assets/images/tutorials/no-curbramp-incorrect-2.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '396px',
                            'top': '320px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.no-curb-ramp.slide-4.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.no-curb-ramp.slide-4.description'),
                    'imageURL': 'assets/images/tutorials/no-curbramp-incorrect-3.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '325px',
                            'top': '302px'
                        }
                    }
                }
            ]
        },
        'Obstacle': {
            'missionInstruction1': i18next.t('mission-start-tutorial.mst-instruction-1'),
            'missionInstruction2': i18next.t('mission-start-tutorial.mst-instruction-2',
                {'nLabels':'10', 'labelType': i18next.t('obstacle-caps')}),
            'slides': [
                {
                    'isExampleCorrect': true,
                    'slideTitle': i18next.t('mission-start-tutorial.obstacle.slide-1.title',
                        {'labelType': i18next.t('obstacle-caps')}),
                    'slideSubtitle': '',
                    'slideDescription': i18next.t('mission-start-tutorial.obstacle.slide-1.description'),
                    'imageURL': 'assets/images/tutorials/obstacle-correct-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '268px',
                            'top': '301px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.obstacle.slide-2.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.obstacle.slide-2.description'),
                    'imageURL': 'assets/images/tutorials/obstacle-incorrect-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '396px',
                            'top': '286px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.obstacle.slide-3.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.obstacle.slide-3.description'),
                    'imageURL': 'assets/images/tutorials/obstacle-incorrect-2.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '76px',
                            'top': '112px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.obstacle.slide-4.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.obstacle.slide-4.description'),
                    'imageURL': 'assets/images/tutorials/obstacle-incorrect-3.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '414px',
                            'top': '187px'
                        }
                    }
                }
            ]
        },
        'SurfaceProblem': {
            'missionInstruction1': i18next.t('mission-start-tutorial.mst-instruction-1'),
            'missionInstruction2': i18next.t('mission-start-tutorial.mst-instruction-2',
                {'nLabels':'10', 'labelType': i18next.t('surface-problem-caps')}),
            'slides': [
                {
                    'isExampleCorrect': true,
                    'slideTitle': i18next.t('mission-start-tutorial.surface-problem.slide-1.title',
                        {'labelType': i18next.t('surface-problem-caps')}),
                    'slideSubtitle': '',
                    'slideDescription': i18next.t('mission-start-tutorial.surface-problem.slide-1.description'),
                    'imageURL': 'assets/images/tutorials/surface-problem-correct-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '291px',
                            'top': '45px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.surface-problem.slide-2.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.surface-problem.slide-2.description'),
                    'imageURL': 'assets/images/tutorials/surface-problem-incorrect-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '397px',
                            'top': '190px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.surface-problem.slide-3.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.surface-problem.slide-3.description'),
                    'imageURL': 'assets/images/tutorials/surface-problem-incorrect-2.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '333px',
                            'top': '219px'
                        }
                    }
                }
            ]
        },
        'NoSideWalk': {
            'missionInstruction1': i18next.t('mission-start-tutorial.mst-instruction-1'),
            'missionInstruction2': i18next.t('mission-start-tutorial.mst-instruction-2',
                {'nLabels':'10', 'labelType': i18next.t('no-sidewalk-caps')}),
            'slides': [
                {
                    'isExampleCorrect': true,
                    'slideTitle': i18next.t('mission-start-tutorial.no-sidewalk.slide-1.title',
                        {'labelType': i18next.t('no-sidewalk-caps')}),
                    'slideSubtitle': '',
                    'slideDescription': i18next.t('mission-start-tutorial.no-sidewalk.slide-1.description'),
                    'imageURL': 'assets/images/tutorials/no-sidewalk-correct-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '290px',
                            'top': '132px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.no-sidewalk.slide-2.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.no-sidewalk.slide-2.description'),
                    'imageURL': 'assets/images/tutorials/no-sidewalk-incorrect-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '352px',
                            'top': '312px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.no-sidewalk.slide-3.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.no-sidewalk.slide-3.description'),
                    'imageURL': 'assets/images/tutorials/no-sidewalk-incorrect-2.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '183px',
                            'top': '298px'
                        }
                    }
                }
            ]
        },
        'Crosswalk': {
            'missionInstruction1': i18next.t('mission-start-tutorial.mst-instruction-1'),
            'missionInstruction2': i18next.t('mission-start-tutorial.mst-instruction-2',
                {'nLabels':'10', 'labelType': i18next.t('crosswalk-caps')}),
            'slides': [
                {
                    'isExampleCorrect': true,
                    'slideTitle': i18next.t('mission-start-tutorial.crosswalk.slide-1.title',
                        {'labelType': i18next.t('crosswalk-caps')}),
                    'slideSubtitle': '',
                    'slideDescription': i18next.t('mission-start-tutorial.crosswalk.slide-1.description'),
                    'imageURL': 'assets/images/tutorials/crosswalk-correct-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '175px',
                            'top': '159px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.crosswalk.slide-2.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.crosswalk.slide-2.description'),
                    'imageURL': 'assets/images/tutorials/crosswalk-incorrect-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '353px',
                            'top': '241px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.crosswalk.slide-3.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.crosswalk.slide-3.description'),
                    'imageURL': 'assets/images/tutorials/crosswalk-incorrect-2.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '247px',
                            'top': '301px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.crosswalk.slide-4.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.crosswalk.slide-4.description'),
                    'imageURL': 'assets/images/tutorials/crosswalk-incorrect-3.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '267px',
                            'top': '102px'
                        }
                    }
                }
            ]
        },
        'Signal': {
            'missionInstruction1': i18next.t('mission-start-tutorial.mst-instruction-1'),
            'missionInstruction2': i18next.t('mission-start-tutorial.mst-instruction-2',
                {'nLabels':'10', 'labelType': i18next.t('signal-caps')}),
            'slides': [
                {
                    'isExampleCorrect': true,
                    'slideTitle': i18next.t('mission-start-tutorial.signal.slide-1.title',
                        {'labelType': i18next.t('signal-caps')}),
                    'slideSubtitle': '',
                    'slideDescription': i18next.t('mission-start-tutorial.signal.slide-1.description'),
                    'imageURL': 'assets/images/tutorials/signal-correct-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '170px',
                            'top': '325px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.signal.slide-2.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.signal.slide-2.description'),
                    'imageURL': 'assets/images/tutorials/signal-incorrect-1.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '376px',
                            'top': '86px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.signal.slide-3.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.signal.slide-3.description'),
                    'imageURL': 'assets/images/tutorials/signal-incorrect-2.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '389px',
                            'top': '203px'
                        }
                    }
                },
                {
                    'isExampleCorrect': false,
                    'slideTitle': i18next.t('mission-start-tutorial.signal.slide-4.title'),
                    'slideSubtitle': i18next.t('mission-start-tutorial.label-type-subtitle'),
                    'slideDescription': i18next.t('mission-start-tutorial.signal.slide-4.description'),
                    'imageURL': 'assets/images/tutorials/signal-incorrect-3.png',
                    'labelOnImage': {
                        'position' : {
                            'left': '358px',
                            'top': '332px'
                        }
                    }
                }
            ]
        }
    };

    // Initialize variables.
    let currentSlideIdx = 0;
    let nSlides = 0;
    let labelTypeModule = {};

    // Initializes the variables needed for this module.
    function initModule(missionType) {
        if (missionType === MISSION_TYPES.VALIDATE) {
            labelTypeModule = validateMSTDescriptor[labelType];
            nSlides = labelTypeModule.slides.length;
        }
    }


    /**
     * Initializes the UI for the mission screens.
     * Renders the top level messages and slide location indicators.
     * Also renders the first slide.
     */
    function initUI() {

        function renderLocationIndicators() {
            const $missionCarouselIndicatorArea = $('.mst-carousel-location-indicator-area');
            for (let i = 0; i < nSlides; i++) {
                const $indicator = $('.mst-carousel-location-indicator.template').clone().removeClass('template');
                $indicator.attr('data-idx', i);
                $missionCarouselIndicatorArea.append($indicator);
            }
        }

        $('.mst-instruction-1').text(labelTypeModule.missionInstruction1);
        $('.mst-instruction-2').text(labelTypeModule.missionInstruction2);

        $('.mission-start-tutorial-done-btn').text(i18next.t('mission-start-tutorial.start-mission'));

        renderLocationIndicators();
        renderSlide(currentSlideIdx);
    }

    /**
     * Renders the slide for the given idx which includes setting the title, subtitle, description,
     * image, and on-image label.
     * - Updates the current slide indicator.
     * - Disables/enables the next/previous buttons based on the idx of the slide rendered.
     * @param idx Index of the slide to be rendered.
     */
    function renderSlide(idx) {

        /**
         * Renders the 'on-image label' and positions it.
         * @param position info about the position of the on-image label as top and left attributes in px.
         * @param iconID ID of the SVG icon to be shown on the label.
         * @param labelOnImageTitle title to be shown on the label
         * @param labelOnImageDescription description to be shown on the label
         */
        function renderlabelOnImage(position, iconID, labelOnImageTitle, labelOnImageDescription) {

            $labelOnImage.css({'top': position.top, 'left': position.left});
            $('.label-on-image-type-title', $labelOnImage).html(labelOnImageTitle);
            $('.label-on-image-description', $labelOnImage).html(labelOnImageDescription);

            $('.label-on-image-type-icon').find('use').attr('xlink:href', iconID);

            $labelOnImage.show();
        }

        const $mstSlide = $('.mst-slide');
        const $labelTypeSubtitle = $('.label-type-subtitle');
        const $mstSlideImage = $('.msts-image');
        const $labelOnImage = $('.label-on-image');
        const $mstDoneButton = $('.mission-start-tutorial-done-btn');

        // Reset the UI first.
        $('.mst-carousel-location-indicator').removeClass('current-location');
        $mstSlide.removeClass(EXAMPLE_TYPES.CORRECT).removeClass(EXAMPLE_TYPES.INCORRECT);
        $mstSlideImage.attr('src', '');
        $labelTypeSubtitle.text('');
        $('.previous-slide-button, .next-slide-button').removeClass('disabled');
        $labelOnImage.hide();
        $mstDoneButton.removeClass('focus');

        const slide = labelTypeModule.slides[idx];

        if (slide.isExampleCorrect) {
            $mstSlide.addClass('correct');
        } else {
            $mstSlide.addClass('incorrect');
        }

        // The icon is the same on the left panel and the labelOnImage.
        let iconID = '';
        let exampleTypeLabel = '';
        let labelOnImageTitle = '';
        let labelOnImageDescription = '';
        if (slide.isExampleCorrect) {
            iconID = SMILEYS.CORRECT;
            exampleTypeLabel = i18next.t('mission-start-tutorial.example-type-label-correct');

            labelOnImageTitle = i18next.t('mission-start-tutorial.label-on-image-title-correct');
            labelOnImageDescription = i18next.t('mission-start-tutorial.label-on-image-description-correct');
        } else {
            iconID = SMILEYS.INCORRECT;
            exampleTypeLabel = i18next.t('mission-start-tutorial.example-type-label-incorrect');

            labelOnImageTitle = i18next.t('mission-start-tutorial.label-on-image-title-incorrect');
            labelOnImageDescription = i18next.t('mission-start-tutorial.label-on-image-description-incorrect');
        }


        // Now that the variables have been initiated, let's set them for the UI.
        $('.example-type-label').text(exampleTypeLabel);
        $('.example-type-icon').find('use').attr('xlink:href', iconID);

        // Note: we should set this as HTML as some strings may contain HTML tags.
        $('.label-type-title').html(slide.slideTitle);
        $('.label-type-description').html(slide.slideDescription);


        if (slide.slideSubtitle) {  // Not all slides may contain a subtitle.
            $labelTypeSubtitle.html(slide.slideSubtitle);
        }

        $mstSlideImage.attr('src', slide.imageURL);

        $(`.mst-carousel-location-indicator[data-idx=${idx}]`).addClass('current-location');


        if (slide.labelOnImage) { // Just a defensive check.
            renderlabelOnImage(slide.labelOnImage.position, iconID, labelOnImageTitle, labelOnImageDescription);
        }

        // Disable the previous/next buttons based on the current slide idx
        if (idx === 0) {
            $('.previous-slide-button').addClass('disabled');
        } else if (idx === nSlides - 1) {
            $mstDoneButton.addClass('focus');
            $('.next-slide-button').addClass('disabled');
        }
    }

    /**
     * Attaches the event handlers required for the mission screen labelTypeModule.
     */
    function attachEventHandlers() {

        $('.previous-slide-button').click(function() {
            currentSlideIdx = Math.max(currentSlideIdx - 1, 0);
            renderSlide(currentSlideIdx);
            tracker.push('PreviousSlideButton_Click', {'currentSlideIdx': currentSlideIdx}, null);
        });

        $('.next-slide-button').click(function() {
            currentSlideIdx = Math.min(currentSlideIdx + 1, nSlides - 1);
            renderSlide(currentSlideIdx);
            tracker.push('NextSlideButton_Click', {'currentSlideIdx': currentSlideIdx}, null);
        });

        $('.mission-start-tutorial-done-btn').click(function() {
            $('.mission-start-tutorial-overlay').fadeOut(100);
            tracker.push('MSTDoneButton_Click', {'currentSlideIdx': currentSlideIdx}, null);
        });
    }

    initModule(missionType);
    initUI();
    attachEventHandlers();

    return this;
}
