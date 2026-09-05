import next from 'eslint-config-next';

const eslintConfig = [
  {

    ignores: [ '.next/**', 'node_modules/**', 'runs/**', 'data/**'],
  },
  ...next,
];

export default eslintConfig;
