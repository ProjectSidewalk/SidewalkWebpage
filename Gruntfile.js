module.exports = function(grunt) {

    // 1. All configuration goes here
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),

        concat: {
            dist: {
                src: [
                    'public/javascripts/SVLabel/lib/gsv/GSVPano.js',
                    'public/javascripts/SVLabel/lib/gsv/GSVPanoPointCloud.js',
                    'public/javascripts/SVLabel/src/SVLabel/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/task/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/mission/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/label/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/neighborhood/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/panorama/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/status/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/modal/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/Util/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/Onboarding/Onboarding.js'
                ],
                dest: 'public/javascripts/SVLabel/build/SVLabel.js'
            }
        },
        uglify: {
            build: {
                src: 'public/javascripts/SVLabel/build/SVLabel.js',
                dest: 'public/javascripts/SVLabel/build/SVLabel.min.js'
            }
        },
        concat_css: {
            all: {
                src: [
                    'public/javascripts/SVLabel/css/svl.css',
                    'public/javascripts/SVLabel/css/*.css'
                    ],
                dest: 'public/javascripts/SVLabel/build/SVLabel.css'
            }
        },
        jasmine: {
            src: [
                'public/javascripts/SVLabel/src/SVLabel/*.js',
                'public/javascripts/SVLabel/src/SVLabel/task/*.js',
                'public/javascripts/SVLabel/src/SVLabel/mission/*.js',
                'public/javascripts/SVLabel/src/SVLabel/label/*.js',
                'public/javascripts/SVLabel/src/SVLabel/neighborhood/*.js',
                'public/javascripts/SVLabel/src/SVLabel/panorama/*.js',
                'public/javascripts/SVLabel/src/SVLabel/status/*.js',
                'public/javascripts/SVLabel/src/SVLabel/util/*.js',
                'public/javascripts/SVLabel/src/SVLabel/modal/*.js',
                'public/javascripts/SVLabel/src/SVLabel/onboarding/onboarding.js'
            ],
            options: {
                specs: [
                    'public/javascripts/SVLabel/spec/SVLabel/*.js',
                    'public/javascripts/SVLabel/spec/SVLabel/onboarding/*.js'
                ],
                helpers: 'public/javascripts/SVLabel/spec/SpecHelper.js',
                vendor: [
                    'public/javascripts/SVLabel/lib/jquery-2.1.4.min.js',
                    'public/javascripts/SVLabel/lib/d3.v3.js',
                    'public/javascripts/SVLabel/lib/turf.min.js',
                    'public/javascripts/SVLabel/lib/gsv/*.js',
                    'public/javascripts/SVLabel/lib/kinetic-v4.3.3.min.js'
                ]
            }
        },
        jsdoc : {
            dist : {
                src: 'public/javascripts/SVLabel/src/SVLabel/*.js'
            }
        },
        watch : {
            scripts: {
                files: ['public/javascripts/SVLabel/src/**/*.js', 'public/javascripts/SVLabel/css/*.css'],
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
