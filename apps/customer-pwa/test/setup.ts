import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Every test gets a clean DOM: leaked markup between cases produces failures
// that look like race conditions and waste a lot of time.
afterEach(() => {
  cleanup();
});
