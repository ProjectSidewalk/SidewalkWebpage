function Onboarding ($, params) {
    var self = { className : 'Onboarding' },
        properties = {},
        status = {
            state: 0
        },
        states = [
            {
                "action":"Ribbon_ClickCurbRamp",
                "message": {
                    "message": 'In this Street View image, we can see a curb ramp. Let’s <span class="bold">click the "Curb Ramp" button</span> to label it!',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "labelType": null,
                "imageX": null,
                "imageY": null
            },
            {
                "action":"LabelingCanvas_FinishLabeling",
                "message": {
                    "message": 'Now, <span class="bold">click the curb ramp in the image to label it.',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "labelType":"CurbRamp",
                "imageX":10232.066666666668,
                "imageY":-521.1111111111111
            },
            {
                "action":"LabelingCanvas_FinishLabeling",
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "labelType":"CurbRamp",
                "imageX":8618.6,
                "imageY":-526.0111111111112
            },
            {
                "action":"LabelingCanvas_FinishLabeling",
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "labelType":"NoCurbRamp",
                "imageX":8184.933333333333,
                "imageY":-600.661111111111
            },
            {
                "action":"LabelingCanvas_FinishLabeling",
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "labelType":"CurbRamp",
                "imageX":3148.6666666666665,
                "imageY":-1155.5777777777778
            },
            {
                "action":"LabelingCanvas_FinishLabeling",
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "labelType":"CurbRamp",
                "imageX":2137.133333333333,
                "imageY":-866.6611111111112
            },
            {
                "action":"LabelingCanvas_FinishLabeling",
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "labelType":"NoSidewalk",
                "imageX":1891.6666666666667,
                "imageY":-452.6111111111111
            },
            {
                "action":"LabelingCanvas_FinishLabeling",
                "panoId":"bdmGHJkiSgmO7_80SnbzXw",
                "labelType":"CurbRamp",
                "imageX":1301.4,
                "imageY":-756.1444444444445
            }
        ];

    function _init (params) {
        // svl.compass.hideMessage();
        svl.ui.onboarding.holder.css("visibility", "visible");
        visit(1);
    }

    function visit(state) {
        var message, st = getState(state);
        if ("message" in st && st.message) {
            message = st.message.message;
            showMessage(message, "top-right", st.message.parameters);
        }
    }

    function getState(state) {
        return states[state];
    }

    function showMessage (message, position, parameters) {
        if (!position) {
            position = "top-right";
        }

        svl.ui.onboarding.messageHolder.css("visibility", "visible");

        if (position == "top-left") {
            svl.ui.onboarding.messageHolder.css({
                top: 0,
                left: 0,
                width: 300
            });
        } else {
            svl.ui.onboarding.messageHolder.css({
                top: 0,
                right: 0,
                width: 300
            });
        }
        svl.ui.onboarding.background.css("visibility", "hidden");

        if (parameters) {
            if ("width" in parameters) {
                svl.ui.onboarding.messageHolder.css("width", parameters.width);
            }
            if ("background" in parameter && parameter.background) {
                svl.ui.onboarding.background.css("visibility", "visible");
            }
        }

        svl.ui.onboarding.messageHolder.html(message);
    }

    function hideMessage () {

    }

    _init(params);

    return self;
}