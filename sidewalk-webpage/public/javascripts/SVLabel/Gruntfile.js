module.exports = function(grunt) {

    // 1. All configuration goes here
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),

        concat: {
            dist: {
                src: [
                    'src/Fog.js',
                    'lib/gsv/GSVPano.js',
                    'lib/gsv/GSVPanoPointCloud.js',
                    'src/SVLabel/*.js',
                    'src/SVLabel/Util/*.js'
                ],
                dest: 'build/SVLabel.js'
            }
        },
        uglify: {
            build: {
                src: 'build/SVLabel.js',
                dest: 'build/SVLabel.min.js'
            }
        },
        concat_css: {
            all: {
                src: [
                    'css/svl.css',
                    'css/*.css'
                    ],
                dest: 'build/SVLabel.css'
            }
        },
        jsdoc : {
            dist : {
                src: 'src/SVLabel/*.js'
            }
        },
        watch : {
            scripts: {
                files: ['src/**/*.js', 'css/*.css'],
                tasks: ['concat', 'concat_css'],
                options: {
                    interrupt: true
                }
            }
        }
    });

    // 3. Where we tell Grunt we plan to use this plug-in.
    grunt.loadNpmTasks('grunt-contrib-concat');
    grunt.loadNpmTasks('grunt-concat-css');
    grunt.loadNpmTasks('grunt-contrib-uglify');
    grunt.loadNpmTasks('grunt-jsdoc');
    grunt.loadNpmTasks('grunt-contrib-watch');


    // 4. Where we tell Grunt what to do when we type "grunt" into the terminal.
    grunt.registerTask('default', ['concat', 'concat_css']);

};
