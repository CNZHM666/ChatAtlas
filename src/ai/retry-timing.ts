/** Multiplies every retry pause. Always 1 in the product; tests set 0 so they do not wait in real time. Its own module so
 * the shared test setup loads only this, not the AI facade. */
export const aiRetryTiming = { scale: 1 };
