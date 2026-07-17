module.exports = function (grunt) {

  // 1. All configuration goes here
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),

    concat: {
      dist_audit: {
        src: [
          'public/js/explore/src/*.js',
          'public/js/explore/src/*/*.js',
          'public/js/common/ProgressBar.js',
          'public/js/common/PanoMarker.js',
          'public/js/common/utilitiesSidewalk.js',
          'public/js/common/SpeedLimit.js',
          'public/js/common/MissionStartTutorial.js',
          // Toast must be concatenated before BadgeAchievements, which builds badge-unlock toasts.
          'public/js/common/Toast.js',
          'public/js/common/BadgeAchievements.js'
        ],
        dest: 'public/js/explore/build/explore.js'
      },
      dist_progress: {
        src: [
          'public/js/common/aiLabelIndicator.js',
          'public/js/admin/src/*.js',
          // PopupPanoManager and LabelDetail must be concatenated before LabelPopup.
          'public/js/common/label-detail/PopupPanoManager.js',
          'public/js/common/ConfirmDialog.js',
          'public/js/common/label-detail/StoryComposer.js',
          'public/js/common/label-detail/StorySection.js',
          'public/js/common/label-detail/LabelDetail.js',
          'public/js/common/share/ShareWidget.js',
          'public/js/common/label-detail/LabelPopup.js',
          'public/js/validate/src/util/*.js',
          'public/js/common/PanoMarker.js',
          // Toast must be concatenated before BadgeAchievements, which builds badge-unlock toasts.
          'public/js/common/Toast.js',
          'public/js/common/BadgeAchievements.js',
          'public/js/user-dashboard/src/*.js',
          'public/js/common/utilitiesSidewalk.js',
        ],
        dest: 'public/js/user-dashboard/build/user-dashboard.js'
      },
      dist_admin: {
        src: [
          'public/js/common/aiLabelIndicator.js',
          // Toast must be concatenated before BadgeAchievements, which LabelDetail uses for validation badges.
          'public/js/common/Toast.js',
          'public/js/common/BadgeAchievements.js',
          'public/js/admin/src/*.js',
          // PopupPanoManager and LabelDetail must be concatenated before LabelPopup.
          'public/js/common/label-detail/PopupPanoManager.js',
          'public/js/common/ConfirmDialog.js',
          'public/js/common/label-detail/StoryComposer.js',
          'public/js/common/label-detail/StorySection.js',
          'public/js/common/label-detail/LabelDetail.js',
          'public/js/common/share/ShareWidget.js',
          'public/js/common/label-detail/LabelPopup.js',
          'public/js/common/utilitiesSidewalk.js',
          'public/js/common/PanoMarker.js',
        ],
        dest: 'public/js/admin/build/admin.js'
      },
      dist_help: {
        src: [
          'public/js/help/src/*.js'
        ],
        dest: 'public/js/help/build/help.js'
      },
      dist_validate: {
        src: [
          'public/js/common/aiLabelIndicator.js',
          'public/js/validate/src/*.js',
          'public/js/validate/src/data/*.js',
          'public/js/validate/src/keyboard/*.js',
          'public/js/validate/src/label/*.js',
          'public/js/validate/src/menu/*.js',
          'public/js/validate/src/mission/*.js',
          'public/js/validate/src/modal/*.js',
          'public/js/validate/src/panorama/*.js',
          'public/js/validate/src/status/*.js',
          'public/js/validate/src/user/*.js',
          'public/js/validate/src/util/*.js',
          'public/js/validate/src/zoom/*.js',
          'public/js/common/ProgressBar.js',
          'public/js/common/PanoMarker.js',
          'public/js/common/utilitiesSidewalk.js',
          'public/js/common/SpeedLimit.js',
          'public/js/common/MissionStartTutorial.js',
          // Toast must be concatenated before BadgeAchievements, which builds badge-unlock toasts.
          'public/js/common/Toast.js',
          'public/js/common/BadgeAchievements.js'
        ],
        dest: 'public/js/validate/build/validate.js'
      },
      dist_gallery: {
        src: [
          'public/js/common/aiLabelIndicator.js',
          // Toast must be concatenated before BadgeAchievements, which builds badge-unlock toasts.
          'public/js/common/Toast.js',
          'public/js/common/BadgeAchievements.js',
          // PopupPanoManager and LabelDetail must be concatenated before ExpandedView.
          'public/js/common/label-detail/PopupPanoManager.js',
          'public/js/common/ConfirmDialog.js',
          'public/js/common/label-detail/StoryComposer.js',
          'public/js/common/label-detail/StorySection.js',
          'public/js/common/label-detail/LabelDetail.js',
          'public/js/common/share/ShareWidget.js',
          'public/js/gallery/src/cards/*.js',
          'public/js/gallery/src/data/*.js',
          'public/js/gallery/src/filter/*.js',
          'public/js/gallery/src/keyboard/*.js',
          'public/js/gallery/src/validation/*.js',
          'public/js/gallery/src/displays/*.js',
          'public/js/gallery/src/expandedview/*.js',
          'public/js/gallery/src/*.js',
          'public/js/common/PanoMarker.js',
          'public/js/common/utilitiesSidewalk.js'
        ],
        dest: 'public/js/gallery/build/gallery.js'
      },
      dist_map: {
        src: [
          'public/js/ps-map/*.js',
        ],
        dest: 'public/js/ps-map/build/ps-map.js'
      },
      dist_shared_label: {
        src: [
          // The shared LabelDetail component + its deps (same set the Gallery bundle pulls in), plus the
          // SharedLabel app. The pano-viewer classes and ps-map load from their own bundles (script tags).
          'public/js/common/aiLabelIndicator.js',
          // Toast must precede BadgeAchievements, which builds badge-unlock toasts.
          'public/js/common/Toast.js',
          'public/js/common/BadgeAchievements.js',
          'public/js/common/PanoMarker.js',
          // PopupPanoManager + LabelDetail must precede anything that uses them.
          'public/js/common/label-detail/PopupPanoManager.js',
          'public/js/common/ConfirmDialog.js',
          'public/js/common/label-detail/StoryComposer.js',
          'public/js/common/label-detail/StorySection.js',
          'public/js/common/label-detail/LabelDetail.js',
          'public/js/common/share/ShareWidget.js',
          'public/js/shared-label/*.js'
        ],
        dest: 'public/js/shared-label/build/shared-label.js'
      },
      dist_pano_viewer: {
        src: [
          'public/js/common/pano-viewer/src/PanoData.js',
          'public/js/common/pano-viewer/src/PanoStore.js',
          'public/js/common/pano-viewer/src/panoUtilities.js',
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
          'public/css/explore/*.css',
          'public/css/common/mission-start-tutorial.css'
        ],
        dest: 'public/js/explore/build/explore.css'
      },
      dist_validate: {
        src: [
          'public/css/validate/*.css',
          'public/css/common/mission-start-tutorial.css'
        ],
        dest: 'public/js/validate/build/validate.css'
      },
      gallery_all: {
        src: [
          'public/css/gallery/*.css'
        ],
        dest: 'public/js/gallery/build/gallery.css'
      }
    },
    watch: {
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
          'public/js/explore/src/*.js',
          'public/js/explore/src/**/*.js',
          'public/css/explore/*.css',
          'public/js/user-dashboard/src/**/*.js',
          'public/js/admin/src/**/*.js',
          'public/js/help/src/*.js',
          'public/js/validate/src/*.js',
          'public/js/validate/src/**/*.js',
          'public/css/validate/*.css',
          'public/js/gallery/src/*.js',
          'public/js/gallery/src/**/*.js',
          'public/css/gallery/*.css',
          'public/js/ps-map/*.js',
          'public/js/shared-label/*.js',
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
