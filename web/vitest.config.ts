import { defineConfig } from 'vitest/config';

// Loaded by `ng test` (angular.json "runnerConfig"). The Angular builder supplies the rest of the
// Vitest setup; this only adds limits that hold up when the whole suite runs on a busy machine.
export default defineConfig({
  test: {
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
