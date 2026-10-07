const { execFileSync } = require('child_process');

module.exports = function (grunt) {

  // 1. All configuration goes here
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),

    concat_css: {
      // The bundles land in public/build/css/, so each file's relative url()s are rewritten to /assets/ paths that still
      // reach the same file from there. An absolute /assets/ url() would get the prefix twice, so use relative.
      options: {
        assetBaseUrl: '/assets',
        baseDir: 'public'
      },
      // The two label-card files come first so each tool's own stylesheet can override the shared base after it.
      // public/css/components/ has no glob — every file used from it is named by hand, in each bundle that wants it.
      dist_audit: {
        src: [
          'public/css/components/label-anchored-panel.css',
          'public/css/components/label-hover-card.css',
          'public/css/pages/explore/*.css',
          'public/css/components/mission-start-tutorial.css'
        ],
        dest: 'public/build/css/explore.css'
      },
      dist_validate: {
        src: [
          'public/css/components/label-anchored-panel.css',
          'public/css/components/label-hover-card.css',
          'public/css/components/pano-attribution.css',
          'public/css/pages/validate/*.css',
          'public/css/components/mission-start-tutorial.css'
        ],
        dest: 'public/build/css/validate.css'
      },
      gallery_all: {
        src: [
          'public/css/pages/gallery/*.css'
        ],
        dest: 'public/build/css/gallery.css'
      }
    },
    watch: {
      gruntfile: {
        files: ['Gruntfile.js', 'rolldown.config.mjs'],
        tasks: ['concat_css', 'rolldown'],
        options: {
          reload: true
        }
      },
      // No `interrupt`: a save during a build waits for it, so two builds never write public/build/ at once.
      js: {
        files: ['frontend/js/**/*.js'],
        tasks: ['rolldown']
      },
      css: {
        files: [
          'public/css/pages/explore/*.css',
          'public/css/pages/validate/*.css',
          'public/css/pages/gallery/*.css',
          'public/css/components/label-anchored-panel.css',
          'public/css/components/label-hover-card.css',
          'public/css/components/pano-attribution.css',
          'public/css/components/mission-start-tutorial.css'
        ],
        tasks: ['concat_css']
      }
    }
  });

  // 3. Where we tell Grunt we plan to use this plug-in.
  grunt.loadNpmTasks('grunt-concat-css');
  grunt.loadNpmTasks('grunt-contrib-watch');

  // 4. Where we tell Grunt what to do when we type "grunt" into the terminal.
  // Run from here rather than `rolldown --watch`: Rolldown only watches files it already knows, so it would miss a
  // new page entry. `grunt watch` globs, so it doesn't.
  grunt.registerTask('rolldown', 'Bundle the ES-module pages (rolldown.config.mjs).', function () {
    execFileSync('node_modules/.bin/rolldown', ['-c'], { stdio: 'inherit' });
  });

  grunt.registerTask('default', ['concat_css', 'rolldown']);
};
