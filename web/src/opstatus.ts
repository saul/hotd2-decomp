/**
 * What this client does with each opcode.
 *
 * This describes the **client**, not the game, which is why it lives in
 * TypeScript rather than travelling in the bundle: `hod2lib` knows what an
 * opcode *means*, and only the code here knows whether that meaning has been
 * acted on. `docs/PLAYER_PROGRESS.md` carries the same table for humans.
 *
 * The script tree and the event feed strike through anything that is only
 * `shown` or `none`, so it is obvious at a glance which instructions the
 * player is actually honouring and which are passing by as text.
 */

export type OpStatus =
  /** Acted on — you can see or hear the result. */
  | "done"
  /** Acted on, but by a rule the client can evaluate rather than the game's. */
  | "approx"
  /** State is kept and shown in the HUD or inspector; nothing is drawn. */
  | "tracked"
  /** Decoded into the feed with its operands; no state, no effect. */
  | "shown"
  /** A proved no-op, a dead opcode, or a dispatch slot nothing encodes. */
  | "none";

const S: Record<number, OpStatus> = {};
const put = (status: OpStatus, ...ops: number[]) => {
  for (const o of ops) S[o] = status;
};

// Spawns: 0x09/0x0B/0x0C/0x0D resolve to markers; the mode-gated variants and
// the approach-pacing table do not.
put("done", 0x09, 0x0b, 0x0c, 0x0d);
put("shown", 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0a);
put("shown", 0x0e, 0x0f, 0x12);
put("shown", 0x10, 0x11);                       // collision sets

// Lighting and fog.
put("done", 0x14, 0x15);                        // scene lighting, gun lights
put("done", 0x18, 0x20, 0x21, 0x23);            // light dir, block-0 channels
put("approx", 0x17);                            // slerp taken immediately
put("tracked", 0x13, 0x16, 0x19);
put("tracked", 0x24, 0x25, 0x27);               // block 1 never reaches the device
put("shown", 0x22, 0x26);

// Scenery and HUD.
put("done", 0x1b, 0x1c, 0x1f, 0x2d);            // dome, dome mode, shutter, message
put("shown", 0x1d);                             // rain
put("none", 0x1e);

// Camera.
put("done", 0x30, 0x35);
put("tracked", 0x1a, 0x36, 0x37);

// Regions and streaming.
put("done", 0x29, 0x50, 0x51);
put("shown", 0x28, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a);

// Audio.
put("done", 0x38, 0x39, 0x3a, 0x3b, 0x5f);
put("none", 0x2e, 0x5d, 0x5e);

// Waits.
put("done", 0x41, 0x42);
put("approx", 0x40, 0x43, 0x44, 0x45);
put("shown", 0x46, 0x47);

// Flow.
put("done", 0x4e, 0x4f);
put("tracked", 0x48, 0x4d);
put("shown", 0x2b, 0x2c, 0x2f, 0x31, 0x32, 0x33, 0x49, 0x4a, 0x4b);

// Proved no-ops and the empty dispatch stubs.
put("none", 0x3d, 0x3e, 0x3f, 0x5b, 0x5c);
put("none", 0x00, 0x2a, 0x34, 0x3c, 0x4c);

export const OP_STATUS: Readonly<Record<number, OpStatus>> = S;

export function opStatus(op: number): OpStatus {
  return S[op] ?? "shown";
}

/** True when the client does nothing at all with this instruction. */
export function isInert(op: number): boolean {
  const s = opStatus(op);
  return s === "shown" || s === "none";
}

export const STATUS_TITLE: Record<OpStatus, string> = {
  done: "acted on",
  approx: "acted on, by an approximation — see the feed note",
  tracked: "state kept and shown, but nothing is drawn from it",
  shown: "not implemented — decoded and listed, but it has no effect here",
  none: "a proved no-op, a dead opcode, or an unused dispatch slot",
};
