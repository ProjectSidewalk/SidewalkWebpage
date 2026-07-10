// Stylelint config (Stylelint 17).
// Run with `make stylelint` (defaults to all non-vendored CSS under public/); not a CI gate yet — that waits on the
// tree being lint-clean, like the ESLint rollout (#2487).
//
// Formatting/whitespace rules live in @stylistic/stylelint-plugin, not Stylelint core: core removed all of its
// stylistic rules in v16 (the same move ESLint made) and the plugin is their non-deprecated home — mirroring our
// @stylistic/eslint-plugin choice on the JS side rather than delegating formatting to Prettier.
export default {
    // Current-standard CSS conventions (correctness rules plus opinions like modern `rgb(0 0 0 / 50%)` color notation).
    // Listed first so the explicit rules below override it.
    extends: ['stylelint-config-standard'],
    plugins: ['@stylistic/stylelint-plugin', 'stylelint-plugin-use-baseline'],
    // Generated bundles and vendored libraries. Unlike JS (where vendored code all lives under lib/), some vendored
    // CSS sits directly in public/stylesheets/ next to our own files, so it's carved out file-by-file.
    ignoreFiles: [
        'public/javascripts/**/build/**',
        'public/javascripts/lib/**',
        'public/stylesheets/bootstrap/**',
        'public/stylesheets/animate.css',
        'public/stylesheets/dataTables.bootstrap.min.css',
        'public/stylesheets/magnific-popup.css',
        'public/stylesheets/pannellum-2.5.7.css',
    ],
    rules: {
        // Only allow CSS features that are Baseline "widely available" (shipped in every core browser for 30+
        // months) — the CSS analogue of the JS side's ES2022 target. Wrap intentional exceptions in @supports.
        'plugin/use-baseline': [true, { available: 'widely' }],

        'declaration-empty-line-before': null,
        'custom-property-empty-line-before': null,
        'color-hex-length': 'long',
        'no-descending-specificity': null,

        // No Autoprefixer in the build (Grunt concatenates only), so vendor prefixes are written by hand and are
        // legitimate. config-standard bans them assuming a build-time autoprefixer we don't run.
        'property-no-vendor-prefix': null,
        'value-no-vendor-prefix': null,
        'selector-no-vendor-prefix': null,
        'at-rule-no-vendor-prefix': null,
        'media-feature-name-no-vendor-prefix': null,

        // Kebab-case BEM (block__element--modifier). config-standard's pattern is plain kebab-case and rejects the
        // __/-- delimiters; this widens it to allow an optional __element and --modifier, each kebab-case internally.
        'selector-class-pattern': [
            '^[a-z][a-z0-9]*(-[a-z0-9]+)*(__[a-z0-9]+(-[a-z0-9]+)*)?(--[a-z0-9]+(-[a-z0-9]+)*)?$',
            { message: 'Expected class selector to be kebab-case BEM (block__element--modifier)' },
        ],

        // --- Stylistic/formatting rules (@stylistic plugin) ---
        '@stylistic/indentation': 4,
        '@stylistic/string-quotes': 'double',
        '@stylistic/max-empty-lines': 2,
        // Warning, not error, matching the JS max-len rule: CLAUDE.md sanctions long-line exceptions.
        '@stylistic/max-line-length': [120, { severity: 'warning' }],
    },
};
