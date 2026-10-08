/**
 * `Class32DrawBonePart`'s (`FUN_0047F780`) switch, as data.
 *
 * The node hook `Class32Init` installs switches on the slot the node's draw
 * record holds and draws **two** models for thirteen of them -- a
 * forty-cel run beside the bone's own part, or two runs in place of it --
 * picking the cel by `g_frame_counter % 40`. The arms are immediates in
 * `.text` (`CMP EAX, 0x5B8`, `LEA ... 0x5B9`), not a table, and they are
 * kept here as one because two readers need the same literals: the hook
 * itself (`draw.ts`), and the exporter (`hod2lib/charbuild.ts`'s
 * `goreEntry`), which has to carry every model the arms can name or the
 * renderer has nothing to clone. One copy, so the two cannot drift.
 *
 * Every slot is a `boss5.bin` or `boss5b.bin` entry (`0x44A`..`0x72A`),
 * which stage 5 loads before it spawns the class. `[proved]` from the
 * listing at `0x0047F780`..`0x0047FC4F`.
 */

/** One arm of the switch. */
export interface Class32BonePartArm {
  /**
   * The first draw is `slot + n` rather than the slot itself: the bone's own
   * model is replaced by a cel of its run. The four arms that do this are
   * the bones `Class32ChargeShotBone` (`FUN_0047CE10`) takes damage on --
   * 4, 6, 11 and 13.
   */
  firstCycles: boolean;
  /** The second draw is `second + n`. */
  second: number;
  /** `0x53F`'s arm counts `obj+0x1334` down (floored at 0) before it draws. */
  flashStep: boolean;
}

/** `g_frame_counter % 0x28` -- `MOV ECX, 0x28; CDQ; IDIV ECX` at each arm. */
export const CLASS32_BONE_PART_CELS = 0x28;

/** The switch's arms, by the node's slot. Any other slot draws itself once. */
export const CLASS32_BONE_PART_ARMS: Readonly<Record<number, Class32BonePartArm>> = {
  0x44a: { firstCycles: false, second: 0x44b, flashStep: false },
  0x49b: { firstCycles: false, second: 0x49c, flashStep: false },
  0x4c6: { firstCycles: false, second: 0x4c7, flashStep: false },
  0x4ef: { firstCycles: true, second: 0x517, flashStep: false },
  0x53f: { firstCycles: false, second: 0x540, flashStep: true },
  0x568: { firstCycles: true, second: 0x590, flashStep: false },
  0x5b8: { firstCycles: false, second: 0x5b9, flashStep: false },
  0x5e6: { firstCycles: true, second: 0x60e, flashStep: false },
  0x636: { firstCycles: false, second: 0x637, flashStep: false },
  0x65f: { firstCycles: false, second: 0x660, flashStep: false },
  0x689: { firstCycles: false, second: 0x68a, flashStep: false },
  0x6b2: { firstCycles: false, second: 0x6b3, flashStep: false },
  0x6db: { firstCycles: true, second: 0x703, flashStep: false },
};

/**
 * `[port-only]` Every slot the switch can draw for a node whose record holds
 * one of `slots`, for the exporter: the run each arm steps through and the
 * slot itself.
 */
export function Class32BonePartSlots(slots: Iterable<number>): number[] {
  const out = new Set<number>();
  for (const s of slots) {
    const arm = CLASS32_BONE_PART_ARMS[s];
    if (!arm) continue;
    out.add(s);
    for (let n = 0; n < CLASS32_BONE_PART_CELS; n++) {
      if (arm.firstCycles) out.add(s + n);
      out.add(arm.second + n);
    }
  }
  return [...out].sort((a, b) => a - b);
}
