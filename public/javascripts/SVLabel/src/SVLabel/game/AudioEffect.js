/**
 * Audio Effect module.
 * @returns {{className: string}}
 * @constructor
 */
function AudioEffect (gameEffectModel, uiSoundButton, fileDirectory) {
    var self = { className: 'AudioEffect' };

    var _self = this;
    this._model = gameEffectModel;


    if (typeof Audio == "undefined") Audio = function HTMLAudioElement () {}; // I need this for testing as PhantomJS does not support HTML5 Audio.

    var audios = {
            applause: new Audio(fileDirectory + 'audio/applause.mp3'),
            drip: new Audio(fileDirectory + 'audio/drip.wav'),
            glug1: new Audio(fileDirectory + 'audio/glug1.wav'),
            yay: new Audio(fileDirectory + 'audio/yay.mp3')
        },
        status = {
            mute: false
        },
        blinkInterval;

    uiSoundButton.sound.on('click', handleClickSound);

    this._model.on("play", function (parameter) {
        play(parameter.audioType);
    });

    this._model.on("playAudio", function (parameter) {
        play(parameter.audioType);
    });

    /**
     * Blink
     */
    function blink () {
        stopBlinking();
        blinkInterval = window.setInterval(function () {
            uiSoundButton.sound.toggleClass("highlight-50");
        }, 500);
    }

    /**
     * Callback for button click
     */
    function handleClickSound () {
        if (status.mute) {
            // Unmute
            uiSoundButton.muteIcon.addClass('hidden');
            uiSoundButton.soundIcon.removeClass('hidden');
            unmute();
        } else {
            // Mute
            uiSoundButton.soundIcon.addClass('hidden');
            uiSoundButton.muteIcon.removeClass('hidden');
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
        uiSoundButton.sound.removeClass("highlight-50");
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
