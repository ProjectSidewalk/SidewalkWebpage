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

        // --- Stylistic/formatting rules (@stylistic plugin) ---
        '@stylistic/indentation': 2,
        '@stylistic/max-empty-lines': 2,
        // Warning, not error, matching the JS max-len rule: CLAUDE.md sanctions long-line exceptions.
        '@stylistic/max-line-length': [120, { severity: 'warning' }],
    },
};
