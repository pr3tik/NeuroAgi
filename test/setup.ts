import "@testing-library/jest-dom";

// Dummy env so importing api/* modules (which construct a Supabase client at module
// load) doesn't throw "supabaseUrl is required" during pure-logic tests.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost";
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "test-service-key";

// jsdom doesn't implement matchMedia — components like BottomNav rely on it.
// Guard `window` so this setup also runs under the node environment (live tests).
if (typeof window !== "undefined" && !window.matchMedia) {
  // @ts-ignore — minimal mock (narrow viewport → mobile layout)
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom doesn't implement IntersectionObserver. Default mock reports the observed element
// as visible immediately, so view-gated effects (NotificationPanel's opened_at stamping)
// fire in component tests. A test can override globalThis.IntersectionObserver with a
// non-firing version to simulate an off-screen (never-seen) item.
if (typeof globalThis !== "undefined" && !(globalThis as any).IntersectionObserver) {
  class IntersectionObserverMock {
    constructor(private cb: (entries: any[], o: any) => void) {}
    observe(el: Element) { this.cb([{ isIntersecting: true, target: el, intersectionRatio: 1 }], this); }
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  (globalThis as any).IntersectionObserver = IntersectionObserverMock;
}
