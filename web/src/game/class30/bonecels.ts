/**
 * The cel runs a class-0x30 bone draws instead of, or as well as, its own
 * model — and the answer to `char_adv02`'s missing midriff.
 *
 * ## What was being looked for, and why it was not there
 *
 * `char_adv02`'s damaged torso covers the chest only: bone 1 escalates to slot
 * `0x1B70` on the first torso hit, that model spans `y 1.35..5.53` where the
 * undamaged `0x1B3D` spans `y -2.02..5.53`, and the pelvis tops out at
 * `-0.45`. So from the first torso hit until the third there is a band of
 * about 1.75 units with nothing in it. Three things had been ruled out
 * correctly — `AssetDrawSlot` (`FUN_00418560`) draws one model per slot,
 * `SkeletonNodeDrawSuppressed` (`FUN_004122E0`) only ever *removes* a draw,
 * and `g_pCharacterExtraParts` (`0x0052ED08`) has a **null descriptor** for
 * character type 0, so the soft waist part 68 other types carry gives this one
 * nothing — and the search then went looking for a table that selects one of
 * "five lower-torso models of exactly that extent that no table in the EXE
 * references".
 *
 * **There is no such table, and there are thirty of them, not five.** `[proved]`
 * `ZombieDrawBonePart` (`FUN_004534A0`) is class 0x30's per-bone draw
 * callback — installed at `obj+0x12EC` (= `model+0x1158`) by `EnemyZombieInit`
 * (`FUN_00452DA0`) at `0x00452E40`, and called by `SkeletonEmitNode`
 * (`FUN_004114C0`) **instead of** `SkeletonDrawNodeSlot` (`FUN_00411050`).
 * It switches on the slot the bone is currently drawing and computes its cel
 * indices with arithmetic on a free-running counter, so the run
 * `0x1B52..0x1B6F` is named by no table and appears in the image only inside
 * `char_adv02.bin`'s and `harold.bin`'s own slot lists. An exhaustive scan for
 * it was right; what it proves is that the selection is not data.
 *
 * The arm, at `0x00453538`–`0x00453576`:
 *
 * ```
 * case 0x1B3D:  slot = seed % 0x14 + 0x1B3E;   // and fall through
 * case 0x1B70:
 * case 0x1B71:  ZombieSubmitSlotByLighting(slot);
 *               ZombieSubmitSlotByLighting(seed % 0x1E + 0x1B52);
 * ```
 *
 * So the **undamaged** torso never draws itself either: it draws a 20-cel
 * chest and a 30-cel lower torso, and the two damaged stages that are
 * chest-only draw themselves plus the same 30-cel lower torso. Stages
 * `0x1B72`, `0x1B73` and `0x1B74` fall to the default and draw alone — and
 * those three are exactly the ones whose own geometry already reaches
 * `y -2.02`. **That is the check on the whole reading**, and it is the reason
 * the five-model coincidence was a coincidence: 20 chest cels and 30 lower
 * cels, and the last five of the lower run happen to number as many as bone 1
 * has damage stages.
 *
 * Measured, so the cels are cels: all twenty of `0x1B3E..0x1B51` carry 3
 * meshes and 138 vertices with textures `[8, 9, 1]`, and 98 of those 138
 * vertices differ between consecutive entries; all thirty of
 * `0x1B52..0x1B6F` carry 2 meshes and 39 vertices with textures `[8, 9]`, and
 * 19 of the 39 differ. Same topology, same materials, moving vertices — a
 * flipbook, not a set of variants.
 *
 * ## The phase
 *
 * `seed = g_blink_frame_counter + obj+0x3C * 10` — `MOV ECX,[0x009a5c50]`,
 * `MOV EAX,[ESI+0x3c]`, `LEA EAX,[EAX+EAX*4]`, `LEA EBX,[ECX+EAX*2]` at
 * `0x004534AE`–`0x004534D1`. The counter is stepped once a game tick by
 * `FUN_0040E730` and `obj+0x3C` is the actor's hit-slot index, so a crowd of
 * zombies runs the same animation ten frames apart rather than pulsing
 * together. `ActorClaimHitSlot` (`FUN_00409270`) is what assigns it, and it is
 * ported for this — see `game/hit_slots.ts`.
 *
 * ## The other arms
 *
 * Every trigger slot below belongs to exactly one character type, and every
 * cel run resolves to that type's own `pol/` file. That one-to-one is the
 * second check on the reading:
 *
 * | type | file | triggers |
 * |---|---|---|
 * | 0x00 | `char_adv02.bin` | `0x1B3D`, `0x1B70`, `0x1B71` |
 * | 0x02 | `znchain.bin` | `0x1BCC`, `0x1BD2` |
 * | 0x03 | `zndina.bin` | `0x1BEB`, `0x1BED` |
 * | 0x07 | `char_adv00.bin` | `0x1F09` |
 * | 0x09 | `znjikken1.bin` | `0x1C71`–`0x1C80` |
 * | 0x0A | `znjoe.bin` | `0x1C96`, `0x1C97`, `0x1CA9` |
 * | 0x0C | `znkager.bin` | `0x1D99` |
 * | 0x0D | `znkagex.bin` | `0x1DCD`, `0x1E00` |
 * | 0x12 | `znele.bin` | `0x1C6C` |
 *
 * That table read `0x08 char_adv01.bin | 0x1C97, 0x1CA9` for one revision, and
 * it was **L6**: the scan that built it walked `HIT_EFFECT` rows for bones
 * 1..39 on characters that have sixteen, so it read `znjoe`'s rows off the end
 * of `char_adv01`'s table and attributed them. `tools/verify_bone_cels.py` is
 * what found it — the bundle it was demanding eighteen `znjoe` cels from was
 * `char_adv01`'s — and the bound is the character's own bone count now.
 * `char_adv01` reaches no arm at all, and `znjikken1` reaches only the
 * prepass ones: every one of its sixteen `HIT_EFFECT` rows is the control code
 * `2`, "nothing at all", so the runtime twin takes no damage and has no gore.
 *
 * {@link g_class30_bone_cels} carries the arms that are **nothing but a
 * phase**, which is nine of the sixteen. The other seven need something this
 * table cannot say and are listed in {@link ZOMBIE_BONE_CEL_UNPORTED} with
 * what each of them wants.
 */

/** One arm of `ZombieDrawBonePart`'s switch, as a pair of cel runs. */
export interface BoneCelRun {
  /** The first slot of the run. */
  base: number;
  /** How many cels; the index is `seed % count`. */
  count: number;
}

/** What a trigger slot draws. */
export interface BoneCelArm {
  /**
   * Whether the bone also draws the slot its draw record names.
   *
   * False for `0x1B3D` alone: that arm computes a chest cel *into* the slot
   * variable before falling through, so the undamaged model is replaced.
   */
  readonly self: boolean;
  /** The runs drawn, in the order the engine submits them. */
  readonly runs: readonly BoneCelRun[];
}

/**
 * `ZombieDrawBonePart`'s (`FUN_004534A0`) phase-only arms, by the slot the
 * bone is drawing.
 *
 * Immediates in the routine's own code rather than a table in `.rdata`, so
 * they travel with the code that reads them — the same arrangement
 * `g_class25_path_offsets` and `class30/ring.ts` have. The `0x00453...`
 * addresses are the `ADD EDX, imm32` that forms each base.
 */
export const g_class30_bone_cels: Readonly<Record<number, BoneCelArm>> = {
  /** `0x00453542` and `0x0045355B`. Chest and lower torso; itself not drawn. */
  0x1b3d: { self: false, runs: [{ base: 0x1b3e, count: 20 },
                                { base: 0x1b52, count: 30 }] },
  /** Torso damage stage 1, chest-only: itself and the lower torso. */
  0x1b70: { self: true, runs: [{ base: 0x1b52, count: 30 }] },
  /** Torso damage stage 2, chest-only: itself and the lower torso. */
  0x1b71: { self: true, runs: [{ base: 0x1b52, count: 30 }] },
  /** `0x00453583`, count at `0x0045357B`. */
  0x1bcc: { self: false, runs: [{ base: 0x1bcd, count: 5 }] },
  /** `0x00453598`, count at `0x00453590`. */
  0x1bd2: { self: false, runs: [{ base: 0x1bd3, count: 5 }] },
  /** `0x00453798`, count `0x78` at `0x00453790`. */
  0x1c96: { self: true, runs: [{ base: 0x1cb9, count: 120 }] },
  /** `0x004537C0`, count `0x12` at `0x004537B8`. Cel 0 is the trigger itself. */
  0x1c97: { self: false, runs: [{ base: 0x1c97, count: 18 }] },
  /** `0x00453927`, count `0x32` at `0x0045391F`. */
  0x1dcd: { self: false, runs: [{ base: 0x1dce, count: 50 }] },
  /** `0x00453915`, count `0x32` at `0x0045390D`. */
  0x1e00: { self: false, runs: [{ base: 0x1e01, count: 50 }] },
};

/**
 * The seven arms that are not a phase, and what each of them needs.
 *
 * Listed rather than silently dropped: a table that covers nine of sixteen
 * arms and says nothing about the rest is the shape of reading that produced
 * the "five lower-torso models" dead end. None of them is the reported bug,
 * and each is a separate piece of work.
 *
 * * `0x1BEB` / `0x1BED` (`zndina`) — the slot **and** a 25-cel run
 *   `0x161B + seed % 25` (the count `0x19` is at `0x004535F5`) under
 *   `MatrixTranslate(0, -4.1, 0)` and
 *   `MatrixScale(0.5, 0.5, 1.0)`. Wants a transform per run.
 * * `0x1D99` (`znkager`) — the slot and a **fixed** second model `0xB66` at
 *   `MatrixTranslate(0.343, 0.4530, 1.0333)`. Wants the same.
 * * `0x1CA9` (`char_adv01`, `znjikken1`, `znjoe`) — `0x1CA9 + n` where `n` is
 *   a **latch** in `obj+0x1328` (`0x004537E3`) that counts up to 14 and
 *   stops, so it plays
 *   once and holds. Wants a field on the actor.
 * * `0x1F09` (`char_adv00`) — a 60-cel ping-pong off the same word, with
 *   `obj+0x136C` bit `0x80000` restarting it and `-1` meaning "draw the slot".
 * * `0x1C7C` (`znjikken1`) — the slot, and a per-frame decay of `obj+0x134C`
 *   and `obj+0x138C`, which is state and not a draw.
 * * `0x1C6C` (`znele`) — the slot, and a transition that raises `obj+0x136C`
 *   bits `0x60000000` and plays `PlaySoundId(0x2225A9)`.
 * * `0x1C71`–`0x1C7B` (not `0x1C73`) and `0x1C7D`–`0x1C80` (`znjikken1`) —
 *   `FUN_00418660(slot)` and then the slot. What that call does is `[open]`.
 */
export const ZOMBIE_BONE_CEL_UNPORTED: readonly number[] = [
  0x1beb, 0x1bed, 0x1d99, 0x1ca9, 0x1f09, 0x1c7c, 0x1c6c,
];

/**
 * Per-actor phase: `obj+0x3C * 10` in `ZombieDrawBonePart`'s seed.
 *
 * The seed itself is `g_blink_frame_counter + obj+0x3C * 10` —
 * `MOV ECX,[0x009a5c50]` / `MOV EAX,[ESI+0x3c]` / `LEA EAX,[EAX+EAX*4]` /
 * `LEA EBX,[ECX+EAX*2]` at `0x004534AE`–`0x004534D1` — and the cel index is
 * `IDIV`'s remainder against the run's count, which **truncates toward zero**,
 * so a `-1` hit slot gives a negative index and the engine lands below the
 * run. Both are one expression and neither is a function here on purpose:
 * `tools/verify_layers.py`'s `render-drives-the-port` rule allows a render
 * layer a constant and not a call, and the only reader is the renderer. The
 * arithmetic is written out at the site, in `render/characters/cels.ts`.
 */
export const BONE_CEL_PHASE_PER_SLOT = 10;

/** Every slot any arm in {@link g_class30_bone_cels} can draw. */
export function ZombieBoneCelSlots(): number[] {
  const out: number[] = [];
  for (const arm of Object.values(g_class30_bone_cels)) {
    for (const r of arm.runs) {
      for (let i = 0; i < r.count; i++) out.push(r.base + i);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}
