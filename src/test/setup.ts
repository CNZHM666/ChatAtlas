import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { aiRetryTiming } from "../ai/retry-timing";

// Retry and resend pauses (2 s, 8 s, 20 s) are real waits. A mock answering one request wrongly made a test wait 2 s per
// resend and time out on CI, with no failure to show for it. Tests that measure a pause set the scale themselves.
beforeEach(() => { aiRetryTiming.scale = 0; });
afterEach(() => { aiRetryTiming.scale = 1; });
