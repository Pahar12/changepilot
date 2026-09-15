module.exports = [
  {
    ignores: ['node_modules/**', 'generated/**']
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        // Node built-ins not covered by sourceType:'commonjs'
        console:      'readonly',
        process:      'readonly',
        Buffer:       'readonly',
        __dirname:    'readonly',
        __filename:   'readonly',
        setTimeout:   'readonly',
        clearTimeout: 'readonly',
        fetch:        'readonly'
        // module / require / exports are provided by sourceType:'commonjs'
        // setInterval / clearInterval / URL are not used in this project
        // fetch: Node 18+ built-in, used by src/ai/providers/openaiProvider.js
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-undef': 'error'
    }
  }
];
