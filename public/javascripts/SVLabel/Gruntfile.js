module.exports = function(grunt) {

    // 1. All configuration goes here
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),

        concat: {
            dist: {
                src: [
                    'lib/gsv/GSVPano.js',
                    'lib/gsv/GSVPanoPointCloud.js',
                    'src/SVLabel/*.js',
                    'src/SVLabel/task/*.js',
                    'src/SVLabel/mission/*.js',
                    'src/SVLabel/label/*.js',
                    'src/SVLabel/neighborhood/*.js',
                    'src/SVLabel/panorama/*.js',
                    'src/SVLabel/status/*.js',
                    'src/SVLabel/modal/*.js',
                    'src/SVLabel/Util/*.js',
                    'src/SVLabel/Onboarding/Onboarding.js'
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
        jasmine: {
            src: [
                'src/SVLabel/*.js',
                'src/SVLabel/canvas/*.js',
                'src/SVLabel/data/*.js',
                'src/SVLabel/game/*.js',
                'src/SVLabel/label/*.js',
                'src/SVLabel/menu/*.js',
                'src/SVLabel/mission/*.js',
                'src/SVLabel/modal/*.js',
                'src/SVLabel/navigation/*.js',
                'src/SVLabel/neighborhood/*.js',
                'src/SVLabel/onboarding/*.js',
                'src/SVLabel/panorama/*.js',
                'src/SVLabel/ribbon/*.js',
                'src/SVLabel/status/*.js',
                'src/SVLabel/task/*.js',
                'src/SVLabel/user/*.js',
                'src/SVLabel/util/*.js',
                'src/SVLabel/zoom/*.js'
            ],
            options: {
                specs: [
                    'spec/SVLabel/*.js',
                    'spec/SVLabel/onboarding/*.js'
                ],
                helpers: 'spec/SpecHelper.js',
                vendor: [
                    'lib/underscore-min.js',
                    'lib/sinon-1.17.5.js',
                    'lib/backbone-min.js',
                    'lib/jquery-2.1.4.min.js',
                    'lib/d3.v3.js',
                    'lib/turf.min.js',
                    'lib/mapbox.js',
                    'lib/mapbox.js',
                    'lib/gsv/*.js',
                    'lib/kinetic-v4.3.3.min.js'
                ]
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
    grunt.loadNpmTasks('grunt-contrib-jasmine');


    // 4. Where we tell Grunt what to do when we type "grunt" into the terminal.
    grunt.registerTask('default', ['concat', 'concat_css']);

};
