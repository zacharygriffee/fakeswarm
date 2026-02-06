module.exports = {
  env: {
    es2022: true,
    node: true
  },
  parserOptions: {
    sourceType: 'module'
  },
  ignorePatterns: ['node_modules/', 'dist/', '.git/', 'coverage/'],
  plugins: [],
  extends: ['eslint:recommended'],
  rules: {
    'no-unused-vars': ['warn', { args: 'after-used', argsIgnorePattern: '^_' }],
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-console': 'off'
  },
  overrides: [
    {
      files: ['test/**/*.js'],
      env: { mocha: false },
      globals: {
        Buffer: 'readonly'
      },
      rules: {
        'no-unused-expressions': 'off'
      }
    }
  ]
};
