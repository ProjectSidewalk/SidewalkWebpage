describe("ModalComment.", function () {
    var modalComment;
    var svl;
    var form;
    var tracker;
    var ribbon;
    var uiLeftColumn;
    var uiModalComment;
    var taskContainer;
    var modalModel;

    var $modalCommentFixture;

    beforeEach(function () {
        svl = {
            map: {
                getPanoId: function () {
                    return "FakePanoramaId";
                },
                getPosition: function () {
                    return { lat: 0, lng: 0 };
                },
                getPov: function () {
                    return { heading: 0, pitch: 0, zoom: 1 };
                }
            }
        };

        form = {
            postJSON: function (url, data) {

            }
        };

        ribbon = {

        };

        tracker = {
            push: function (item) {}
        };

        taskContainer = {
        };

        uiLeftColumn = {
            feedback: $('<div id="feedback-button"></div>')
        };


        $modalCommentFixture = $('<div id="modal-comment-holder" class="hidden">\
                                        <div id="modal-comment-background"></div> \
                                        <div id="modal-comment-box"> \
                                            <form id="comment-form"> \
                                                <div id="modal-comment-title" class="bold"> \
                                                    <p>Any thoughts? Found something confusing? Spotted a bug? <br />\
                                                        Send us comments! \
                                                    </p> \
                                                </div> \
                                                <div id="modal-comment-content"> \
                                                    <textarea id="modal-comment-textarea" placeholder=""></textarea> \
                                                </div> \
                                                <div> \
                                                    <button class="button" id="modal-comment-ok-button">OK</button> \
                                                    <button class="button" id="modal-comment-cancel-button">Cancel</button> \
                                                </div> \
                                            </form> \
                                        </div> \
                                        </div>');

        uiModalComment = {};
        uiModalComment.holder = $modalCommentFixture;
        uiModalComment.ok = $modalCommentFixture.find('#modal-comment-ok-button');
        uiModalComment.cancel = $modalCommentFixture.find('#modal-comment-cancel-button');
        uiModalComment.textarea = $modalCommentFixture.find('#modal-comment-textarea');

        modalModel = {};

        modalComment = new ModalComment(svl, form, tracker, ribbon, taskContainer, uiLeftColumn, uiModalComment, modalModel)
    });

    describe("`_prepareCommentData` method", function () {
       it("should prepare and return data", function () {
           uiModalComment.textarea.val("Test text");
           task = {
                       getStreetEdgeId: function () { return 0; }
                   };
           var data = modalComment._prepareCommentData("test", 10, 10, {heading: 0, pitch: 0, zoom: 1}, task);

           var expectedData = {
               comment: "Test text",
               gsv_panorama_id: "test",
               heading: 0,
               lat: 10,
               lng: 10,
               pitch: 0,
               street_edge_id: 0,
               zoom: 1
           };

           expect(data.comment).toBe(expectedData.comment);
           expect(data.gsv_panorama_id).toBe(expectedData.gsv_panorama_id);
           expect(data.heading).toBe(expectedData.heading);
           expect(data.lat).toBe(expectedData.lat);
           expect(data.lng).toBe(expectedData.lng);
           expect(data.pitch).toBe(expectedData.pitch);
           expect(data.street_edge_id).toBe(expectedData.street_edge_id);
           expect(data.zoom).toBe(expectedData.zoom);
           // expect(data).toBe(expectedData);
       })
    });

    describe("`_submitComment` method", function () {
        var testData;
        beforeEach(function () {
            testData = {
                comment: "Test text",
                gsv_panorama_id: "test",
                heading: 0,
                lat: 10,
                lng: 10,
                pitch: 0,
                street_edge_id: 0,
                zoom: 1
            };
        });

        // it("should submit data", function () {
        //     spyOn(form, 'postJSON');
        //     modalComment._submitComment(testData);
        //     expect(form.postJSON).toHaveBeenCalled();
        // });
    });

});
