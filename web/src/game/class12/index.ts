/**
 * Class 0x12 — **a slot strip a script flag starts.**
 *
 * One asset slot drawn under a matrix, like class 0x13, until the script flag
 * its descriptor names rises; then, a set number of frames later, the cursor
 * jumps to the first slot of a run and moves through it a fraction or a whole
 * slot a frame, and the object despawns the frame it passes the last one.
 * Three spawns in the game, one descriptor shape:
 *
 * | stage | evt | slots | flag |
 * |---|---|---|---|
 * | 1 | `0x3D88`, block 6 step 1 | `door_1.bin[41]`, then `[42..95]` a slot a frame | 34 |
 * | 2 | `0x15644`, block 37 step 1 | `sanbasi.bin[12..90]`, half a slot a frame | 95 |
 * | 5 | `0x2398`, block 3 step 1 | the same strip | 11 |
 *
 * **Stage 1's is the wood the bin captor bursts out of.** `door_1.bin[41]` is
 * a 14 x 23 unit panel modelled in world space across the doorway at
 * `x -675..-661, z -551..-545`, between the captor (`0x3D24`, standing in the
 * dark at `(-660, -15.5, -565)` in `ZombieStateAwaitCivilianOrder`) and the
 * civilian at the bin; `[42..95]` are the same geometry pulled apart a frame
 * at a time, the last spread over 90 units of the alley. Flag 34 is the one
 * `ZombieStateTargetScriptWithFlag` raises on cursor 63 of the burst clip
 * (967, played from 33), so the planks go on the frame that clip reaches
 * it. Before this class had a module the script's spawn built
 * nothing, and the captor walked out of an empty doorway.
 *
 * ```
 * ScriptedPropInit12 (FUN_0043F9D0), from the {0x12, 0x0043F9D0} pair at 0x00593358
 *   sub = ActorAllocSub(0x1C) at obj+0x1310, filled from the tail at obj+0x130C
 *   obj+0x14C = tail+0x04          ; the shot mesh
 *   obj+0x3C  = -1
 *   obj+0x00  = ScriptedPropUpdate12
 * ```
 *
 * Unlike `ScriptedPropInit13` it does not call the behaviour; the update calls
 * it every frame, before the draw.
 *
 * ## What is here and what is not
 *
 * The draw is `render/slotmodels.ts`': `Translate(obj+0x40); RotX(+0x64);
 * RotZ(+0x6C); RotY(+0x68)`, the scale only when it is not 1.0, and
 * `AssetDrawSlot(__ftol(sub+0x14))` — class 0x13's matrix and a cursor for a
 * slot. `MatrixStore(obj+0x150)` follows it; that matrix and `obj+0x14C` are
 * what `ShotTestMesh` (`FUN_00404A00`) tests, because the record's flags word
 * is `0x10` — {@link ActorFlag.ShotTestMesh} — and the port has no mesh shot
 * test for an actor: `ProcessPlayerShotsTestList` in `combat/shot_test.ts`
 * passes a mesh entry by, and says so. So the panel is in the list and
 * cannot be hit. `0x40` is not in the word, so neither collision pass in
 * `coli.ts` takes the blob either, in the engine or here.
 */
import { ActorFlag, type Actor } from "../actor";
import { PropBehaviour } from "../class13";
import { NoOpStub } from "../class45";
import { RegisterForShotTest } from "../combat/shot_test";
import { ActorDespawn } from "../despawn";
import { G } from "../globals";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import type { ScriptedProp12Tail } from "./state";

/** The tail, when this actor has one. */
function Tail(obj: Actor): ScriptedProp12Tail | null {
  return obj.cls === SpawnClass.FlagStripProp
    ? (obj as { prop12: ScriptedProp12Tail }).prop12 : null;
}

/**
 * `ScriptedPropInit12` — `FUN_0043F9D0`.
 *
 * ```
 * 0043f9d8  MOV   ESI, [EDI + 0x130c]      ; the descriptor tail
 * 0043f9de  CALL  ActorAllocSub(0x1c)      ; -> obj+0x1310
 * 0043f9ec  MOVSX ECX, word ptr [ESI]      ; FILD / FSTP [EAX + 0x14]
 * 0043f9fa  MOV   EDX, [ESI + 0x4]         ; -> obj+0x14C
 * 0043fa03  MOVSX ECX, word ptr [ESI + 0x8]
 * 0043fa07  MOV   EDX, [ECX*4 + 0x5926a8]  ; g_prop_behaviours -> sub+0x00
 * 0043fa10  sub+0x04..+0x0E = tail+0x02, +0x0A, +0x0C, +0x0E, +0x10, +0x12
 * 0043fa40  sub+0x18 = tail+0x14 ; sub+0x10 = tail+0x18
 * 0043fa4c  MOV   dword ptr [EDI + 0x3c], -1
 * 0043fa53  MOV   dword ptr [EDI], 0x43fa60
 * ```
 *
 * `[proved]`. The three angles are `SpawnFromDescriptorSmall`'s (`FUN_00408BC0`)
 * and the flags word `ActorInitFlags`' (`FUN_00408970`), both before this
 * runs; nothing here touches them.
 */
export function ScriptedPropInit12(obj: Actor): void {
  const sub = Tail(obj);
  const p = obj.class12;
  if (!sub || !p) return;
  // `FILD` of the s16, `FSTP` to a float: exact for every slot.
  sub.cursor = Math.fround(p.slot);
  obj.coliBlob = p.coli;
  sub.behaviour = p.behaviour;
  sub.delay = p.delay;
  sub.camPath = p.cam_path;
  sub.camFrame = p.cam_frame;
  sub.first = p.first;
  sub.last = p.last;
  sub.flag = p.flag;
  sub.step = Math.fround(p.step);
  sub.scale = Math.fround(p.scale);
  // `obj+0x3C = -1`, the word class 0x13's Init writes too.
  obj.motion = -1;
}

/**
 * `ScriptedPropUpdate12` — `FUN_0043FA60`.
 *
 * ```
 * 0043fa66  CMP  g_active_cam_path, (s16)sub+0x06 / JNZ
 * 0043fa7e  CMP  g_cam_path_frame,  (s16)sub+0x08 / JNZ
 * 0043fa87  CALL ActorDespawn(obj) ; RET
 * 0043fa92  MOV  AX, [ESI + 0x4] ; TEST AX, AX ; JL draw
 * 0043fa9b  MOV  CX, [ESI + 0xe] ; CMP CX, -1 ; JZ go
 * 0043faa8  MOV  CL, [EDX + 0x9c7200] ; TEST CL, CL ; JZ draw
 * 0043fab2  go: TEST AX, AX ; JZ step
 * 0043fabb  DEC  EAX ; MOV [ESI + 0x4], AX ; JNZ draw
 * 0043fac5  FILD (s16)sub+0x0A ; FST [ESI + 0x14] ; CALL __ftol ; MOV [EDI + 0x1f4], AX
 * 0043fae0  MOV  dword ptr [ESI], NoOpStub ; obj+0x34 |= 0x8000
 * 0043faef  draw: CALL dword ptr [ESI] ; Push ; T ; Rx ; Rz ; Ry ; [Scale]
 * 0043fb54  FLD  [ESI + 0x14] ; CALL __ftol ; CALL AssetDrawSlot
 * 0043fb69  CALL MatrixStore(obj+0x150) ; Pop ; CALL RegisterForShotTest(obj)
 * 0043fb81  step: FLD [ESI + 0x18] ; FADD [ESI + 0x14] ; FST [ESI + 0x14]
 * 0043fb92  FILD (s16)sub+0x0C ; FXCH ; FCOMPP ; TEST AH, 0x41 ; JNZ draw
 * 0043fba6  CALL ActorDespawn(obj) ; RET
 * ```
 *
 * `[proved]`, from the disassembly: the pseudocode drops both `__ftol`
 * operands (`L1`). So the object waits, drawing its first slot, until its
 * flag is up; counts the delay down from that frame; on the frame it reaches
 * zero jumps to `sub+0x0A`, installs `NoOpStub` and leaves the shot test
 * (`0x8000`, {@link ActorFlag.NoShotTest}); and from the next frame steps the
 * cursor, despawning — **undrawn** — the frame the sum is strictly past
 * `sub+0x0C` (`TEST AH, 0x41` goes on to the draw for "less" and "equal").
 * The delay test is on the whole word: a negative delay never starts.
 *
 * The sum is compared on the FPU before it is rounded to the float it is
 * stored as; the port compares the stored float. They agree on every shipped
 * descriptor, whose steps are 1.0 and 0.5 and whose cursors are whole or
 * half slots, all exact in a float.
 *
 * The draw that follows the behaviour is `render/slotmodels.ts`'; the
 * registration after it is here.
 */
export function ScriptedPropUpdate12(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  if (G.g_active_cam_path === sub.camPath
      && G.g_cam_path_frame === sub.camFrame) {
    ActorDespawn(obj);
    return;
  }
  if (sub.delay >= 0
      && (sub.flag === -1 || (G.g_script_flags[sub.flag] ?? 0) !== 0)) {
    if (sub.delay === 0) {
      sub.cursor = Math.fround(sub.step + sub.cursor);
      if (sub.cursor > sub.last) {
        ActorDespawn(obj);
        return;
      }
    } else {
      sub.delay -= 1;
      if (sub.delay === 0) {
        sub.cursor = Math.fround(sub.first);
        sub.slot1F4 = Math.trunc(sub.cursor);
        sub.behaviour = PropBehaviour.None;
        obj.flags |= ActorFlag.NoShotTest;
      }
    }
  }
  // `CALL dword ptr [ESI]` at `0x0043FAF0`. Every shipped class-0x12
  // descriptor installs entry 0, `NoOpStub`, and the exporter carries none
  // that does not (`hod2lib/characters.ts`), so this is the bare `RET`.
  PROP12_BEHAVIOURS[sub.behaviour]?.(obj);
  RegisterForShotTest(obj, f.host);
}

/**
 * The `g_prop_behaviours` entries a class-0x12 object can have installed —
 * `0x005926A8`, indexed by `sub+0x00`'s index. Sparse, as
 * `g_carrier_prop_routines` is: only `NoOpStub` is reachable from a shipped
 * class-0x12 descriptor.
 */
const PROP12_BEHAVIOURS: Partial<Record<number, (obj: Actor) => void>> = {
  [PropBehaviour.None]: NoOpStub,
};

function ScriptedProp12Debug(obj: Actor): ActorDebug {
  const sub = Tail(obj);
  if (!sub) return { summary: "no class 0x12 tail", hot: true };
  const up = sub.flag === -1 || (G.g_script_flags[sub.flag] ?? 0) !== 0;
  return {
    summary: `slot 0x${Math.trunc(sub.cursor).toString(16)} · `
      + `flag ${sub.flag} ${up ? "up" : "down"} · delay ${sub.delay}`,
    detail: [
      `strip 0x${sub.first.toString(16)}..0x${sub.last.toString(16)} `
        + `by ${sub.step}`,
      `despawn on cam ${sub.camPath} frame ${sub.camFrame}`,
    ],
  };
}

export const ScriptedProp12Handler: ClassHandler = {
  init: ScriptedPropInit12,
  update: ScriptedPropUpdate12,
  // It calls `RegisterForShotTest` itself, at `0x0043FB76`; see the module
  // note for why nothing then picks it.
  registersForShotTest: true,
  // Nothing in the update reads the hit bit.
  ownsShotResult: true,
  debug: ScriptedProp12Debug,
};

registerClass(SpawnClass.FlagStripProp, ScriptedProp12Handler);
