module.exports = function(grunt) {

    // 1. All configuration goes here
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),

        concat: {
            dist_audit: {
                src: [
                    'public/js/SVLabel/src/*.js',
                    'public/js/SVLabel/src/*/*.js',
                    'public/js/common/ProgressBar.js',
                    'public/js/common/PanoMarker.js',
                    'public/js/common/UtilitiesSidewalk.js',
                    'public/js/common/SpeedLimit.js',
                    'public/js/common/MissionStartTutorial.js',
                    // Toast must be concatenated before BadgeAchievements, which builds badge-unlock toasts.
                    'public/js/common/Toast.js',
                    'public/js/common/BadgeAchievements.js'
                ],
                dest: 'public/js/SVLabel/build/SVLabel.js'
            },
            dist_progress: {
                src: [
                    'public/js/common/AiLabelIndicator.js',
                    'public/js/Admin/src/*.js',
                    // PopupPanoManager and LabelDetail must be concatenated before LabelPopup.
                    'public/js/common/label-detail/PopupPanoManager.js',
                    'public/js/common/label-detail/LabelDetail.js',
                    'public/js/common/label-detail/LabelPopup.js',
                    'public/js/SVValidate/src/util/*.js',
                    'public/js/common/PanoMarker.js',
                    // Toast must be concatenated before BadgeAchievements, which builds badge-unlock toasts.
                    'public/js/common/Toast.js',
                    'public/js/common/BadgeAchievements.js',
                    'public/js/Progress/src/*.js',
                    'public/js/common/UtilitiesSidewalk.js',
                ],
                dest: 'public/js/Progress/build/Progress.js'
            },
            dist_admin: {
                src: [
                    'public/js/common/AiLabelIndicator.js',
                    // Toast must be concatenated before BadgeAchievements, which LabelDetail uses for validation badges.
                    'public/js/common/Toast.js',
                    'public/js/common/BadgeAchievements.js',
                    'public/js/Admin/src/*.js',
                    // PopupPanoManager and LabelDetail must be concatenated before LabelPopup.
                    'public/js/common/label-detail/PopupPanoManager.js',
                    'public/js/common/label-detail/LabelDetail.js',
                    'public/js/common/label-detail/LabelPopup.js',
                    'public/js/common/UtilitiesSidewalk.js',
                    'public/js/common/PanoMarker.js',
                ],
                dest: 'public/js/Admin/build/Admin.js'
            },
            dist_help: {
                src: [
                    'public/js/Help/src/*.js'
                ],
                dest: 'public/js/Help/build/help.js'
            },
            dist_validate: {
                src: [
                    'public/js/common/AiLabelIndicator.js',
                    'public/js/SVValidate/src/*.js',
                    'public/js/SVValidate/src/data/*.js',
                    'public/js/SVValidate/src/keyboard/*.js',
                    'public/js/SVValidate/src/label/*.js',
                    'public/js/SVValidate/src/menu/*.js',
                    'public/js/SVValidate/src/mission/*.js',
                    'public/js/SVValidate/src/modal/*.js',
                    'public/js/SVValidate/src/panorama/*.js',
                    'public/js/SVValidate/src/status/*.js',
                    'public/js/SVValidate/src/user/*.js',
                    'public/js/SVValidate/src/util/*.js',
                    'public/js/SVValidate/src/zoom/*.js',
                    'public/js/common/ProgressBar.js',
                    'public/js/common/PanoMarker.js',
                    'public/js/common/UtilitiesSidewalk.js',
                    'public/js/common/SpeedLimit.js',
                    'public/js/common/MissionStartTutorial.js',
                    // Toast must be concatenated before BadgeAchievements, which builds badge-unlock toasts.
                    'public/js/common/Toast.js',
                    'public/js/common/BadgeAchievements.js'
                ],
                dest: 'public/js/SVValidate/build/SVValidate.js'
            },
            dist_gallery: {
                src: [
                    'public/js/common/AiLabelIndicator.js',
                    // Toast must be concatenated before BadgeAchievements, which builds badge-unlock toasts.
                    'public/js/common/Toast.js',
                    'public/js/common/BadgeAchievements.js',
                    // PopupPanoManager and LabelDetail must be concatenated before ExpandedView.
                    'public/js/common/label-detail/PopupPanoManager.js',
                    'public/js/common/label-detail/LabelDetail.js',
                    'public/js/Gallery/src/cards/*.js',
                    'public/js/Gallery/src/data/*.js',
                    'public/js/Gallery/src/filter/*.js',
                    'public/js/Gallery/src/keyboard/*.js',
                    'public/js/Gallery/src/validation/*.js',
                    'public/js/Gallery/src/displays/*.js',
                    'public/js/Gallery/src/expandedview/*.js',
                    'public/js/Gallery/src/*.js',
                    'public/js/common/PanoMarker.js',
                    'public/js/common/UtilitiesSidewalk.js'
                ],
                dest: 'public/js/Gallery/build/Gallery.js'
            },
            dist_map: {
                src: [
                    'public/js/PSMap/*.js',
                ],
                dest: 'public/js/PSMap/build/PSMap.js'
            },
            dist_pano_viewer: {
                src: [
                    'public/js/common/pano-viewer/src/PanoData.js',
                    'public/js/common/pano-viewer/src/PanoStore.js',
                    'public/js/common/pano-viewer/src/PanoUtilities.js',
                    'public/js/common/pano-viewer/src/PanoViewer.js',
                    'public/js/common/pano-viewer/src/GsvViewer.js',
                    'public/js/common/pano-viewer/src/MapillaryChunkedDataProvider.js',
                    'public/js/common/pano-viewer/src/MapillaryViewer.js',
                    'public/js/common/pano-viewer/src/Infra3dViewer.js',
                    'public/js/common/pano-viewer/src/PannellumViewer.js',
                    'public/js/common/pano-viewer/src/PanoViewerLogo.js',
                    'public/js/common/pano-viewer/src/PanoInfoPopover.js'
                ],
                dest: 'public/js/common/pano-viewer/build/pano-viewer.js'
            }
        },
        concat_css: {
            dist_audit: {
                src: [
                    'public/js/SVLabel/css/*.css',
                    'public/css/common/missionStartTutorial.css'
                ],
                dest: 'public/js/SVLabel/build/SVLabel.css'
            },
            dist_validate: {
                src: [
                    'public/js/SVValidate/css/*.css',
                    'public/css/common/missionStartTutorial.css'
                ],
                dest: 'public/js/SVValidate/build/SVValidate.css'
            },
            gallery_all: {
                src: [
                    'public/js/Gallery/css/*.css'
                ],
                dest: 'public/js/Gallery/build/Gallery.css'
            }
        },
        watch : {
            gruntfile: {
                files: ['Gruntfile.js'],
                tasks: ['concat', 'concat_css'],
                options: {
                    reload: true
                }
            },
            scripts: {
                files: [
                    'public/js/common/*.js',
                    'public/js/common/*/*.js',
                    'public/js/common/*/src/*.js',
                    'public/js/SVLabel/src/*.js',
                    'public/js/SVLabel/src/**/*.js',
                    'public/js/SVLabel/css/*.css',
                    'public/js/Progress/src/**/*.js',
                    'public/js/Admin/src/**/*.js',
                    'public/js/Help/src/*.js',
                    'public/js/SVValidate/src/*.js',
                    'public/js/SVValidate/src/**/*.js',
                    'public/js/SVValidate/css/*.css',
                    'public/js/Gallery/src/*.js',
                    'public/js/Gallery/src/**/*.js',
                    'public/js/Gallery/css/*.css',
                    'public/js/PSMap/*.js',
                    'public/css/common/*.css'
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
