import '@testing-library/jest-dom/vitest';

// jsdom has no ResizeObserver; Bits UI measures some controls (slider) with it.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom has no scrollIntoView; Bits Command scrolls the highlighted entry into view.
// A test may run in node (`@vitest-environment node`): there is no DOM to complete then.
if (typeof Element !== 'undefined') Element.prototype.scrollIntoView ??= function scrollIntoView() {};
