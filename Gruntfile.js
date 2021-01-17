module.exports = function(grunt) {

    // 1. All configuration goes here
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),

        concat: {
            dist_audit: {
                src: [
                    'public/javascripts/SVLabel/src/SVLabel/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/alert/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/canvas/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/data/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/game/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/gsv/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/keyboard/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/label/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/menu/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/mission/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/modal/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/navigation/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/neighborhood/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/onboarding/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/panorama/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/ribbon/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/status/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/task/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/user/*.js',
                    'public/javascripts/SVLabel/src/SVLabel/zoom/*.js',
                    'public/javascripts/common/Panomarker.js',
                    'public/javascripts/common/Utilities.js',
                    'public/javascripts/common/UtilitiesColor.js',
                    'public/javascripts/common/UtilitiesMath.js',
                    'public/javascripts/common/UtilitiesPanomarker.js',
                    'public/javascripts/common/UtilitiesShape.js',
                    'public/javascripts/common/UtilitiesSidewalk.js'
                ],
                dest: 'public/javascripts/SVLabel/build/SVLabel.js'
            },
            dist_progress: {
                src: [
                    'public/javascripts/Progress/src/*.js'
                ],
                dest: 'public/javascripts/Progress/build/Progress.js'
            },
            dist_admin: {
                src: [
                    'public/javascripts/Admin/src/*.js'
                ],
                dest: 'public/javascripts/Admin/build/Admin.js'
            },
            dist_help: {
                src: [
                    'public/javascripts/Help/src/*.js'
                ],
                dest: 'public/javascripts/Help/build/help.js'
            },
            dist_validate: {
                src: [
                    'public/javascripts/SVValidate/src/*.js',
                    'public/javascripts/SVValidate/src/data/*.js',
                    'public/javascripts/SVValidate/src/keyboard/*.js',
                    'public/javascripts/SVValidate/src/label/*.js',
                    'public/javascripts/SVValidate/src/menu/*.js',
                    'public/javascripts/SVValidate/src/mission/*.js',
                    'public/javascripts/SVValidate/src/modal/*.js',
                    'public/javascripts/SVValidate/src/panorama/*.js',
                    'public/javascripts/SVValidate/src/status/*.js',
                    'public/javascripts/SVValidate/src/user/*.js',
                    'public/javascripts/SVValidate/src/util/*.js',
                    'public/javascripts/SVValidate/src/zoom/*.js',
                    'public/javascripts/common/Panomarker.js',
                    'public/javascripts/common/UtilitiesSidewalk.js'
                ],
                dest: 'public/javascripts/SVValidate/build/SVValidate.js'
            },
            dist_gallery: {
                src: [
                    'public/javascripts/SidewalkGallery/src/cards/*.js',
                    'public/javascripts/SidewalkGallery/src/data/*.js',
                    'public/javascripts/SidewalkGallery/src/filter/*.js',
                    'public/javascripts/SidewalkGallery/src/validation/*.js',
                    'public/javascripts/SidewalkGallery/src/*.js',
                    'public/javascripts/SidewalkGallery/util/*.js'
                ],
                dest: 'public/javascripts/SidewalkGallery/build/SidewalkGallery.js'
            }
        },
        concat_css: {
            dist_audit: {
                src: [
                    'public/javascripts/SVLabel/css/svl.css',
                    'public/javascripts/SVLabel/css/*.css'
                    ],
                dest: 'public/javascripts/SVLabel/build/SVLabel.css'
            },
            dist_validate: {
                src: [
                    'public/javascripts/SVValidate/css/*.css'
                ],
                dest: 'public/javascripts/SVValidate/build/SVValidate.css'
            },
            gallery_all: {
                src: [
                    'public/javascripts/SidewalkGallery/css/*.css'
                ],
                dest: 'public/javascripts/SidewalkGallery/build/SidewalkGallery.css'
            }
        },
        watch : {
            scripts: {
                files: [
                    'public/javascripts/SVLabel/src/**/*.js',
                    'public/javascripts/SVLabel/css/*.css',
                    'public/javascripts/Progress/src/**/*.js',
                    'public/javascripts/Admin/src/**/*.js',
                    'public/javascripts/Help/src/*.js',
                    'public/javascripts/SVValidate/src/*.js',
                    'public/javascripts/SVValidate/src/**/*.js',
                    'public/javascripts/SVValidate/css/*.css',
                    'public/javascripts/SidewalkGallery/src/*.js',
                    'public/javascripts/SidewalkGallery/src/**/*.js',
                    'public/javascripts/SidewalkGallery/css/*.css'
                ],
                tasks: [
                    'concat',
                    'concat_css'
                ],
                options: {
                    interrupt: true
                }
            }
        }
    });

    // 3. Where we tell Grunt we plan to use this plug-in.
    grunt.loadNpmTasks('grunt-contrib-concat');
    grunt.loadNpmTasks('grunt-concat-css');
    grunt.loadNpmTasks('grunt-contrib-watch');

    // 4. Where we tell Grunt what to do when we type "grunt" into the terminal.
    grunt.registerTask('default', ['concat', 'concat_css']);
    grunt.registerTask('dist', ['concat:dist_audit', 'concat:dist_progress', 'concat:dist_admin', 'concat:dist_validate', 'concat:dist_gallery']);
};
