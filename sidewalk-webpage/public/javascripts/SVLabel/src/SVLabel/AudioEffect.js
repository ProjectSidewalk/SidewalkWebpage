/**
 * Audio Effect module.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function AudioEffect () {
    var self = { className: 'AudioEffect' };

    if (typeof Audio == "undefined") Audio = function HTMLAudioElement () {}; // I need this for testing as PhantomJS does not support HTML5 Audio.

    var audios = {
            applause: new Audio(svl.rootDirectory + 'audio/applause.mp3'),
            drip: new Audio(svl.rootDirectory + 'audio/drip.wav'),
            glug1: new Audio(svl.rootDirectory + 'audio/glug1.wav'),
            yay: new Audio(svl.rootDirectory + 'audio/yay.mp3')
        },
        status = {
            mute: false
        },
        blinkInterval;

    if (svl && 'ui' in svl) {
        svl.ui.leftColumn.sound.on('click', handleClickSound);
    }

    /**
     * Blink
     */
    function blink () {
        stopBlinking();
        blinkInterval = window.setInterval(function () {
            svl.ui.leftColumn.sound.toggleClass("highlight-50");
        }, 500);
    }

    /**
     * Callback for button click
     */
    function handleClickSound () {
        if (status.mute) {
            // Unmute
            if (svl && 'ui' in svl) {
                svl.ui.leftColumn.muteIcon.addClass('hidden');
                svl.ui.leftColumn.soundIcon.removeClass('hidden');
            }
            unmute();
        } else {
            // Mute
            if (svl && 'ui' in svl) {
                svl.ui.leftColumn.soundIcon.addClass('hidden');
                svl.ui.leftColumn.muteIcon.removeClass('hidden');
            }
            mute();
        }
    }

    /**
     * Mute
     */
    function mute () {
        status.mute = true;
    }


    /**
     * Play a sound effect
     * @param name Name of the sound effect
     * @returns {play}
     */
    function play (name) {
        if (name in audios && !status.mute && typeof audios[name].play == "function") {
            audios[name].play();
        }
        return this;
    }

    /**
     * Stop blinking the button
     */
    function stopBlinking () {
        window.clearInterval(blinkInterval);
        svl.ui.leftColumn.sound.removeClass("highlight-50");
    }

    /**
     * Unmute
     */
    function unmute () {
        status.mute = false;
    }

    self.blink = blink;
    self.play = play;
    self.stopBlinking = stopBlinking;
    return self;
}