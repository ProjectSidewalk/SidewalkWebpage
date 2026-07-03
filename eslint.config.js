// ESLint flat config (ESLint 9+). Replaces the legacy .eslintrc.json.
// Frontend lint is owned by #2487 and run manually (`make eslint`), not wired into CI yet.
//
// Formatting/whitespace rules live in @stylistic/eslint-plugin, not ESLint core: ESLint froze and deprecated all of
// its layout rules in v8.53 and these are their non-deprecated home (https://eslint.style/). Code-quality rules stay
// in core. The two groups are kept separate below so it's obvious which package owns each rule.
const js = require('@eslint/js');
const globals = require('globals');
const stylistic = require('@stylistic/eslint-plugin');

module.exports = [
    // ESLint core "recommended" -- ~45 correctness rules. Listed first so the explicit block below overrides it.
    js.configs.recommended,
    // Global ignores. Flat config lints nothing unless a `files` glob below opts it in, so this only has to carve out
    // generated bundles and vendored libraries *within* the linted tree -- no more whole-repo `*` + `!negation`
    // gymnastics that the old ignorePatterns needed to claw scope back down to public/javascripts.
    {
        ignores: [
            'public/javascripts/**/build/**',
            'public/javascripts/lib/**',
        ],
    },
    {
        files: ['public/javascripts/**/*.js'],
        plugins: {
            '@stylistic': stylistic,
        },
        languageOptions: {
            ecmaVersion: 2022, // ES2022 -- needed for class fields, including `#private` members.
            sourceType: 'script', // Files are concatenated into a global bundle by Grunt, not ES modules.
            globals: {
                ...globals.browser, // was `env: { browser: true }`.
                ...globals.es2021,  // was `env: { es6: true }`; supplies Promise/Map/Set/Symbol/globalThis etc.
            },
        },
        rules: {
            // --- Code-quality / ES6 rules (ESLint core) ---
            'curly': ['error', 'multi-line', 'consistent'],
            'eqeqeq': ['error', 'always'],
            // vars:'local' skips global-scope (top-level) declarations -- in this concat-globals bundle those are
            // entry points consumed by another file or a Twirl view's inline <script>, not dead code (#2487). Dead
            // locals inside functions and unused params are still flagged.
            'no-unused-vars': ['warn', { vars: 'local' }],
            'no-undef': 'off',
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

            // --- Bug-catchers beyond eslint:recommended ---
            'no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
            'no-shadow': 'warn', // Easy to shadow shared globals (svl/svv/util) in an inner scope.
            'no-throw-literal': 'error',
            'radix': 'warn',
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',

            // --- Modern-idiom cleanup (all auto-fixable) ---
            'prefer-object-spread': 'error',
            'dot-notation': 'error',
            'no-else-return': 'off',
            'no-lonely-if': 'error',
            'no-useless-return': 'error',
            'no-useless-concat': 'error',
            'require-await': 'warn', // An async function with no await is usually a mistake.

            // --- Formatting: @stylistic preset baseline ---
            // stylistic.configs.customize({...}) supplies ~50 whitespace/formatting rules as one maintained set; the
            // options below encode our house style. The block after it holds the rules the preset doesn't cover and
            // our deliberate divergences. See https://eslint.style/guide/config-presets#configuration-factory
            ...stylistic.configs.customize({
                indent: 4,
                quotes: 'single',
                semi: true,
                jsx: false,
                arrowParens: true,
                braceStyle: '1tbs',
                blockSpacing: true,
                commaDangle: 'always-multiline',
            }).rules,

            // Rules the preset doesn't set -- keep our own:
            '@stylistic/function-call-spacing': ['error', 'never'],
            // Permit (not enforce) hand-aligned object tables: 'minimum' allows extra spaces after the colon, and the
            // ObjectExpression exception allows padding between same-line properties (the rule attributes the gap after
            // a comma to the containing object, not the next Property). ignoreEOLComments likewise permits
            // column-aligned trailing comments on field declarations.
            '@stylistic/key-spacing': ['error', { beforeColon: false, afterColon: true, mode: 'minimum' }],
            '@stylistic/no-multi-spaces': [
                'error',
                { exceptions: { Property: true, ObjectExpression: true }, ignoreEOLComments: true },
            ],
            // Override the preset's brace-style to forbid single-line blocks. Without this, curly's autofix on a
            // next-line braceless `if` collapses to `if (cond) { stmt; }`, which then trips the non-fixable
            // max-statements-per-line rule and leaves --fix stuck. Forbidding single-line blocks lets --fix expand
            // straight to the canonical multi-line block instead.
            '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: false }],
            '@stylistic/max-len': ['warn', { code: 120 }],
            '@stylistic/generator-star-spacing': ['error', 'after'],
            '@stylistic/no-confusing-arrow': ['error', { allowParens: true }],
            '@stylistic/padding-line-between-statements': [
                'error',
                { blankLine: 'always', prev: 'function', next: '*' },
                { blankLine: 'always', prev: '*', next: 'function' },
            ],
        },
    },
];
