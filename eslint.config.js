// ESLint flat config (ESLint 9+). Replaces the legacy .eslintrc.json.
// Frontend lint is owned by #2487 and run manually (`make eslint`), not wired into CI yet.
//
// Formatting/whitespace rules live in @stylistic/eslint-plugin, not ESLint core: ESLint froze and deprecated all of
// its layout rules in v8.53 and these are their non-deprecated home (https://eslint.style/). Code-quality rules stay
// in core. The two groups are kept separate below so it's obvious which package owns each rule.
const globals = require('globals');
const stylistic = require('@stylistic/eslint-plugin');

module.exports = [
    // Global ignores. Flat config lints nothing unless a `files` glob below opts it in, so this only has to carve out
    // generated bundles and vendored libraries *within* the linted tree -- no more whole-repo `*` + `!negation`
    // gymnastics that the old ignorePatterns needed to claw scope back down to public/javascripts.
    {
        ignores: [
            'public/javascripts/**/build/**',
            'public/javascripts/lib/**',
            'public/javascripts/common/detectMobileBrowser.js',
            'public/javascripts/common/isMobile.js',
            'public/javascripts/common/Panomarker.js',
        ],
    },
    {
        files: ['public/javascripts/**/*.js'],
        plugins: {
            '@stylistic': stylistic,
        },
        languageOptions: {
            ecmaVersion: 2022, // ES2022 -- needed for class fields, including `#private` members (replaces ecmaVersion 7).
            sourceType: 'module',
            globals: {
                ...globals.browser, // was `env: { browser: true }`.
                ...globals.es2021,  // was `env: { es6: true }`; supplies Promise/Map/Set/Symbol/globalThis etc.
            },
        },
        rules: {
            // --- Code-quality / ES6 rules (ESLint core) ---
            'capitalized-comments': ['warn', 'always', { ignoreConsecutiveComments: true }],
            'curly': ['error', 'multi-line', 'consistent'],
            'eqeqeq': ['error', 'always'],
            'no-unused-vars': 'warn',
            'one-var': ['error', 'never'],
            'no-var': 'error',
            // Got most of the below rules from Airbnb style guide:
            // https://github.com/airbnb/javascript/blob/master/packages/eslint-config-airbnb-base/rules/es6.js
            'constructor-super': 'error',
            'no-class-assign': 'error',
            'no-const-assign': 'error',
            'no-dupe-class-members': 'error',
            'no-duplicate-imports': 'error',
            'no-new-native-nonconstructor': 'error', // successor to the deprecated no-new-symbol.
            'no-this-before-super': 'error',
            'no-useless-computed-key': 'error',
            'no-useless-constructor': 'error',
            'no-useless-rename': ['error', { ignoreDestructuring: false, ignoreImport: false, ignoreExport: false }],
            'object-shorthand': ['error', 'always', { ignoreConstructors: false, avoidQuotes: true }],
            'prefer-arrow-callback': ['error', { allowNamedFunctions: false, allowUnboundThis: true }],
            'prefer-const': ['error', { destructuring: 'any', ignoreReadBeforeAssign: true }],
            'prefer-numeric-literals': 'error',
            'prefer-rest-params': 'error',
            'prefer-spread': 'error',
            'prefer-template': 'error',
            'require-yield': 'error',
            'symbol-description': 'error',
            'sort-imports': ['off', {
                ignoreCase: false,
                ignoreDeclarationSort: false,
                ignoreMemberSort: false,
                memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single'],
            }],

            // --- Formatting rules (@stylistic/eslint-plugin; these moved out of ESLint core) ---
            '@stylistic/comma-style': 'error',
            '@stylistic/eol-last': ['error', 'always'],
            '@stylistic/function-call-spacing': ['error', 'never'], // was no-spaced-func.
            '@stylistic/indent': ['error', 4, { SwitchCase: 1 }],
            '@stylistic/keyword-spacing': 'error',
            '@stylistic/max-len': ['warn', { code: 120 }],
            '@stylistic/no-tabs': 'error',
            '@stylistic/no-trailing-spaces': ['error'],
            '@stylistic/padding-line-between-statements': [
                'error',
                { blankLine: 'always', prev: 'function', next: '*' },
                { blankLine: 'always', prev: '*', next: 'function' },
            ],
            '@stylistic/quotes': ['error', 'single'],
            '@stylistic/semi': 'error',
            '@stylistic/spaced-comment': 'error',
            '@stylistic/space-before-blocks': ['error', 'always'],
            '@stylistic/space-in-parens': ['error', 'never'],
            '@stylistic/arrow-parens': ['error', 'always'],
            '@stylistic/arrow-spacing': ['error', { before: true, after: true }],
            '@stylistic/generator-star-spacing': ['error', 'after'],
            '@stylistic/no-confusing-arrow': ['error', { allowParens: true }],
            '@stylistic/rest-spread-spacing': ['error', 'never'],
            '@stylistic/template-curly-spacing': 'error',
            '@stylistic/yield-star-spacing': ['error', 'after'],
        },
    },
];
