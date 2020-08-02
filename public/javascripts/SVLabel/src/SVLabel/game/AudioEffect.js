/**
 * Audio Effect module.
 * @returns {{className: string}}
 * @constructor
 */
function AudioEffect (gameEffectModel, uiSoundButton, fileDirectory, storage) {
    var self = { className: 'AudioEffect' };

    var _self = this;
    this._model = gameEffectModel;


    if (typeof Audio == "undefined") Audio = function HTMLAudioElement () {}; // I need this for testing as PhantomJS does not support HTML5 Audio.

    var audios = {
        drip: new Audio(fileDirectory + 'audio/drip.mp3'),
        glug1: new Audio(fileDirectory + 'audio/glug1.mp3'),
        success: new Audio(fileDirectory + 'audio/success.mp3')
    };
    var blinkInterval;

    uiSoundButton.sound.on('click', toggleSound);

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
    function toggleSound () {
        if (storage.get("muted"))
            unmute();
        else
            mute();
    }

    /**
     * Mute
     */
    function mute () {
        uiSoundButton.soundIcon.addClass('hidden');
        uiSoundButton.muteIcon.removeClass('hidden');
        storage.set("muted", true);
    }

    /**
     * Unmute
     */
    function unmute () {
        uiSoundButton.muteIcon.addClass('hidden');
        uiSoundButton.soundIcon.removeClass('hidden');
        storage.set("muted", false);
    }


    /**
     * Play a sound effect
     * @param name Name of the sound effect
     * @returns {play}
     */
    function play (name) {
        if (name in audios && !storage.get("muted") && typeof audios[name].play == "function") {
            audios[name].load();
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

    // To add the appropriate style to the sound button based on the storage when the document is loaded
    if(storage.get("muted"))
        mute();
    else
        unmute();

    self.blink = blink;
    self.play = play;
    self.stopBlinking = stopBlinking;
    return self;
}
