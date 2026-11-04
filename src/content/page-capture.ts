import type { CaptureCommandResponse } from "../shared/messages";
import type { ConversationCapture } from "../shared/types";
import { captureFingerprint } from "./capture-builder";

/** Shared scheduling for native-page readers. No model, network polling or DOM ownership. */
export class PageCapture {
  private timer?: ReturnType<typeof setTimeout>;
  private flight?: Promise<CaptureCommandResponse>;
  private rerun = false;
  private active = true;
  private fingerprint = "";
  private revision = 0;
  constructor(private read: () => Promise<ConversationCapture | null>, private save: (capture: ConversationCapture) => Promise<CaptureCommandResponse>) {}
  schedule(delay = 650) {
    if (!this.active) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.capture().catch(() => undefined); }, delay);
  }
  async capture(force = false): Promise<CaptureCommandResponse> {
    if (!this.active) return { ok: false, error: "Capture paused" };
    if (this.flight) {
      this.rerun = true;
      if(!force)return this.flight;
      // An automatic no-op has no persistence receipt. Explicit sync must read
      // the current conversation and receive its own acknowledgement.
      try{await this.flight;}catch{/* Explicit sync retries a failed automatic read. */}
      return this.capture(true);
    }
    const revision = this.revision;
    this.flight = (async () => {
      const capture = await this.read();
      if (!this.active || revision !== this.revision) return { ok: false, error: "Capture paused" };
      if (!capture?.messages.length) return { ok: false, error: "No completed conversation messages are available" };
      const fingerprint = captureFingerprint(capture);
      if (!force && fingerprint === this.fingerprint) return { ok: true };
      const response = await this.save(capture);
      if (response.ok && this.active && revision === this.revision) this.fingerprint = fingerprint;
      return response;
    })();
    try { return await this.flight; }
    finally { this.flight = undefined; if (this.rerun) { this.rerun = false; this.schedule(120); } }
  }
  pause() { this.active = false; this.revision++; this.rerun = false; clearTimeout(this.timer); }
  resume() { if (!this.active) { this.active = true; this.revision++; this.fingerprint = ""; } }
}
