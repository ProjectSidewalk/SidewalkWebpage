/**
 * Created with JetBrains PhpStorm.
 * User: kotarohara
 * Date: 3/13/13
 * Time: 4:30 PM
 * To change this template use File | Settings | File Templates.
 */
function Onboarding_GrabAndDragAnimation (param) {
    var oPublic = {
        className : 'GrabAndDragAnimation'
        };
    var properties = {
        direction: 'leftToRight',
        OnboardingCanvasId : '#Holder_OnboardingCanvas',
        KineticStageId : 'Holder_HandGesture',
        OpenHandImageSrc : 'public/img/onboarding/Hand_Open.png',
        ClosedHandImageSrc : 'public/img/onboarding/Hand_Closed.png'
    };
    var $AnimationStage;
    var layer;
    var stage;
    var OpenHand;
    var ClosedHand;
    var OpenHandReady = false;
    var ClosedHandReady = false;
    var ImageObjOpenHand;
    var ImageObjClosedHand;

    ////////////////////////////////////////
    // Private methods
    ////////////////////////////////////////
    function _init(param) {
        param = param || {};

        if ('direction' in param) {
            properties.direction = param.direction;
        } else {
            properties.direction = 'leftToRight';
        }

        $(properties.OnboardingCanvasId).append('<div id="' + properties.KineticStageId + '"></div>')
        $AnimationStage = $('#' + properties.KineticStageId);
        $AnimationStage.css({
            position : 'absolute',
            left : '0px',
            top : '0px'
        });

        stage = new Kinetic.Stage({
            container: 'Holder_HandGesture',
            width: 578,
            height: 200
        });
        layer = new Kinetic.Layer();

        //
        // It seems like I have to add the layer to the stage.
        //
        stage.add(layer);

        //
        // Initialize images used in the animation.
        // http://www.html5canvastutorials.com/kineticjs/html5-canvas-kineticjs-image-tutorial/
        //
        ImageObjOpenHand = new Image();
        ImageObjOpenHand.onload = function () {
            OpenHand = new Kinetic.Image({
                x: 0,
                y: stage.getHeight() / 2 - 59,
                image: ImageObjOpenHand,
                width: 128,
                height: 128
            });
            OpenHand.hide();
            layer.add(OpenHand);
            OpenHandReady = true;

            fireAnimation();
        };
        ImageObjOpenHand.src = properties.OpenHandImageSrc;

        ImageObjClosedHand = new Image();
        ImageObjClosedHand.onload = function () {
            ClosedHand = new Kinetic.Image({
                x: 300,
                y: stage.getHeight() / 2 - 59,
                image: ImageObjClosedHand,
                width: 96,
                height: 96
            });
            ClosedHand.hide();
            layer.add(ClosedHand);
            ClosedHandReady = true;

            fireAnimation();
        };
        ImageObjClosedHand.src = properties.ClosedHandImageSrc;
    }

    function animate() {
        // Kineticjs callback
        // http://www.html5canvastutorials.com/kineticjs/html5-canvas-transition-callback-with-kineticjs/
        //
        // Setposition()
        // http://www.html5canvastutorials.com/labs/html5-canvas-animals-on-the-beach-game-with-kineticjs/

        if (properties.direction === 'leftToRight') {
            ClosedHand.hide();
            OpenHand.setPosition(0,100);
            OpenHand.show();
            OpenHand.transitionTo({
                x: 0,
                y: 0,
                duration : 0.5,
                callback : function () {
                    setTimeout(function () {
                        OpenHand.hide();
                        ClosedHand.setPosition(50, 30);
                        ClosedHand.show();
                        ClosedHand.transitionTo({
                            x: 200,
                            y: 30,
                            duration: 1
                        });
                    }, 300);
                }
            });
        } else {
            ClosedHand.hide();
            OpenHand.setPosition(200,100);
            OpenHand.show();
            OpenHand.transitionTo({
                x: 200,
                y: 0,
                duration : 0.5,
                callback : function () {
                    setTimeout(function () {
                        OpenHand.hide();
                        ClosedHand.setPosition(200, 30);
                        ClosedHand.show();
                        ClosedHand.transitionTo({
                            x: 000,
                            y: 30,
                            duration: 1
                        });
                    }, 300);
                }
            });
        }

    }


    function fireAnimation () {
        // This function checks if both open and closed hand images are loaded,
        // then fires the animation
        if (ClosedHandReady && OpenHandReady) {
            animate();
            setInterval(animate, 2000);
        }
    }

    ////////////////////////////////////////
    // Public methods
    ////////////////////////////////////////
    oPublic.remove = function () {
        // Removing a dom element
        // http://stackoverflow.com/questions/3387427/javascript-remove-element-by-id
        return (elem=document.getElementById('Holder_HandGesture')).parentNode.removeChild(elem);
    };


    oPublic.setPosition = function (x, y) {
        $AnimationStage.css({
            left : x + 'px',
            top : y + 'px'
        });
    };

    _init(param);

    return oPublic;
}