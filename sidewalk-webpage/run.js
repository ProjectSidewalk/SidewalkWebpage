// If you haven't, install Node.js on your computer. Then type `npm install` to install node dependencies.
// Once the npm downloads all the dependencies, type `node run.js` to run this script.

// Child process. http://stackoverflow.com/questions/20643470/execute-a-command-line-binary-with-node-js
// Spawn. http://stackoverflow.com/questions/10232192/exec-display-stdout-live
// Print without new linehttp://stackoverflow.com/questions/6157497/node-js-printing-to-console-without-a-trailing-newline
var spawn = require('child_process').spawn;

// Start running the server in a debug mode
cmd = spawn('activator', ['-jvm-debug', '9998', 'run']);
cmd.stdout.on('data', function (data) {
   process.stdout.write('  ' + data);
});

cmd = spawn('grunt', ['watch']);
cmd.stdout.on('data', function (data) {
   process.stdout.write('  ' + data);
});