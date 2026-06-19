/**
 * Plays short sound effects (e.g. the mission-complete chime) and manages the mute toggle button.
 */
class AudioEffect {
    #audios;
    #storage;
    #soundButton;
    #soundIcon;
    #muteIcon;

    /**
     * @param {string} fileDirectory Root directory the audio files are served from.
     * @param storage TemporaryStorage used to persist the muted state.
     */
    constructor(fileDirectory, storage) {
        this.#storage = storage;
        this.#soundButton = document.getElementById('left-column-sound-button');
        this.#soundIcon = document.getElementById('left-column-sound-icon');
        this.#muteIcon = document.getElementById('left-column-mute-icon');

        // PhantomJS (used in testing) does not support HTML5 Audio.
        if (typeof Audio == "undefined") Audio = function HTMLAudioElement () {};

        this.#audios = {
            drip: new Audio(fileDirectory + 'audio/drip.mp3'),
            success: new Audio(fileDirectory + 'audio/success.mp3')
        };
        this.#audios.drip.volume = 0.25;
        this.#audios.success.volume = 0.05;

        this.#soundButton.addEventListener('click', () => this.#toggleSound());

        // Reflect the persisted muted state on the button when the document loads.
        if (storage.get("muted")) this.#mute();
        else this.#unmute();
    }

    // Toggles between muted and unmuted in response to the sound button being clicked.
    #toggleSound() {
        if (this.#storage.get("muted")) this.#unmute();
        else this.#mute();
    }

    #mute() {
        this.#soundIcon.classList.add('hidden');
        this.#muteIcon.classList.remove('hidden');
        this.#storage.set("muted", true);
    }

    #unmute() {
        this.#muteIcon.classList.add('hidden');
        this.#soundIcon.classList.remove('hidden');
        this.#storage.set("muted", false);
    }

    /**
     * Loads a sound effect so it is ready to play with minimal latency.
     * @param {string} name Name of the sound effect.
     */
    load(name) {
        if (name in this.#audios && typeof this.#audios[name].load == "function") {
            this.#audios[name].load();
        }
    }

    /**
     * Plays a sound effect, unless the user has muted sound.
     * @param {string} name Name of the sound effect.
     */
    play(name) {
        if (name in this.#audios && !this.#storage.get("muted") && typeof this.#audios[name].play == "function") {
            this.#audios[name].play();
        }
    }
}
