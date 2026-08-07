/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'root',
        'api',
        'web',
        'config',
        'domain-kit',
        'contracts',
        'infra',
        'docs',
        'deps',
        'ci',
      ],
    ],
    'subject-case': [2, 'never', ['pascal-case', 'upper-case']],
    'header-max-length': [2, 'always', 100],
  },
};
