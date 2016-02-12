function AudioEffect () {
    var self = { className: 'AudioEffect' },
        audios = {
            applause: new Audio(svl.rootDirectory + 'audio/applause.mp3'),
            drip: new Audio(svl.rootDirectory + 'audio/drip.wav'),
            glug1: new Audio(svl.rootDirectory + 'audio/glug1.wav'),
            yay: new Audio(svl.rootDirectory + 'audio/yay.mp3')
        },
        status = {
            mute: false
        };

    if (svl && 'ui' in svl) {
        svl.ui.leftColumn.sound.on('click', handleClickSound);
    }

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

    function mute () { status.mute = true; }

    function play (name) {
        if (name in audios && !status.mute) {
            audios[name].play();
        }
        return this;
    }

    function unmute () { status.mute = false; }

    self.play = play;
    return self;
}