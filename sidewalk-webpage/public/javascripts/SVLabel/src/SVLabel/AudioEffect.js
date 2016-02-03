function AudioEffect () {
    var audios = {
        applause: new Audio(svl.rootDirectory + 'audio/applause.mp3'),
        drip: new Audio(svl.rootDirectory + 'audio/drip.wav'),
        glug1: new Audio(svl.rootDirectory + 'audio/glug1.wav'),
        yay: new Audio(svl.rootDirectory + 'audio/yay.mp3')
    };

    function play (name) {
        if (name in audios) {
            audios[name].play();
        }
        return this;
    }

    return {
        play: play
    };
}