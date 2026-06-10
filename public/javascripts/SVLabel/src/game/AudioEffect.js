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
        success: new Audio(fileDirectory + 'audio/success.mp3')
    };
    audios.drip.volume = 0.25;
    audios.success.volume = 0.05;

    uiSoundButton.sound.on('click', toggleSound);

    this._model.on("loadAudio", function (parameter) {
        load(parameter.audioType);
    });

    this._model.on("play", function (parameter) {
        play(parameter.audioType);
    });

    this._model.on("playAudio", function (parameter) {
        play(parameter.audioType);
    });

    /**
     * Callback for button click
     */
    function toggleSound() {
        if (storage.get("muted"))
            unmute();
        else
            mute();
    }

    function mute() {
        uiSoundButton.soundIcon.addClass('hidden');
        uiSoundButton.muteIcon.removeClass('hidden');
        storage.set("muted", true);
    }

    function unmute() {
        uiSoundButton.muteIcon.addClass('hidden');
        uiSoundButton.soundIcon.removeClass('hidden');
        storage.set("muted", false);
    }

    /**
     * Load a sound effect.
     * @param name Name of the sound effect
     * @returns {load}
     */
    function load(name) {
        if (name in audios && typeof audios[name].load == "function") {
            audios[name].load();
        }
        return this;
    }

    /**
     * Play a sound effect
     * @param name Name of the sound effect
     * @returns {play}
     */
    function play (name) {
        if (name in audios && !storage.get("muted") && typeof audios[name].play == "function") {
            audios[name].play();
        }
        return this;
    }

    // To add the appropriate style to the sound button based on the storage when the document is loaded
    if(storage.get("muted"))
        mute();
    else
        unmute();

    self.load = load;
    self.play = play;
    return self;
}
