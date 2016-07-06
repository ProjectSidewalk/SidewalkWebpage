describe("Specs for the LabelContainer module.", function () {
    // describe("The method getLabels", function () {
    //     var label1 = new FakeLabel({name: 'label1'});
    //     var label2 = new FakeLabel({name: 'label2'});
    //     var label3 = new FakeLabel({name: 'label3'});
    //
    //     it("should return an empty array when there are no labels", function () {
    //         // Check if a variable is an array
    //         // http://stackoverflow.com/questions/218798/in-javascript-how-can-we-identify-whether-an-object-is-a-hash-or-an-array
    //         expect(canvas.getLabels() instanceof Array).toBeTruthy();
    //         expect(canvas.getLabels().length).toBe(0);
    //     });
    //
    //     it("should return an array of labels", function () {
    //         canvas.pushLabel(label1).pushLabel(label2).pushLabel(label3);
    //         expect(canvas.getLabels().length).toBe(3);
    //         expect(canvas.getLabels()[0].name).toBe('label1');
    //         expect(canvas.getLabels()[1].name).toBe('label2');
    //         expect(canvas.getLabels()[2].name).toBe('label3');
    //     });
    // });
    //
    // describe("The method getNumLabels", function () {
    //     var label1 = new FakeLabel({name: 'label1'});
    //     var label2 = new FakeLabel({name: 'label2'});
    //     var label3 = new FakeLabel({name: 'label3'});
    //
    //     it("should return 0 when there are not labels", function () {
    //         expect(canvas.getNumLabels()).toBe(0);
    //     });
    //
    //     it("should return the number of elements in the labels array.", function () {
    //         canvas.pushLabel(label1).pushLabel(label2).pushLabel(label3);
    //         expect(canvas.getNumLabels()).toBe(3);
    //     })
    // });
    var jQuery = {};
    var container;


    function LabelMock () {
        var properties = {
            labelId: null,
            temporary_label_id: null
        };

        return {
            getProperty: function (key) {
                return properties[key];
            },
            setProperty: function (key, value) {
                properties[key] = value;
            }
        };
    }

    beforeEach(function () {
        container = LabelContainer(jQuery);
    });

    describe("`pushToNeighborhoodLabels`", function () {



        it ("should be able to add a label", function () {
            var labelMock = new LabelMock();
            container.pushToNeighborhoodLabels(1, labelMock);
            expect(container.countLabels(1)).toBe(1);
        });

        it ("should NOT add duplicate labels", function () {

            var mocks = prepareMocks(),
                i = 0,
                len = mocks.length;
            for (; i < len; i++) {
                container.pushToNeighborhoodLabels(1, mocks[i]);
            }
            expect(container.countLabels(1)).toBe(3);
        });

        function prepareMocks () {
            var mock1 = new LabelMock();
            var mock2 = new LabelMock();
            var mock3 = new LabelMock();
            var mock4 = new LabelMock();
            var mock5 = new LabelMock();

            mock1.setProperty("temporary_label_id", 1);
            mock1.setProperty("labelId", 10);
            mock2.setProperty("temporary_label_id", 1);
            mock3.setProperty("labelId", 10);

            mock4.setProperty("temporary_label_id", null);
            mock4.setProperty("labelId", 20);
            mock5.setProperty("temporary_label_id", null);
            mock5.setProperty("labelId", 30);


            return [mock1, mock2, mock3, mock4, mock5];
        }
    })
});
