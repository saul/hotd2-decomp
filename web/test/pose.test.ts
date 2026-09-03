/**
 * A pose is finite, whatever the clock says.
 *
 * Every number the poser writes reaches the game: `SkeletonEmitNode` records
 * bone 1's world position into `obj+0x100`, `SelectCameraLookAtTarget`
 * (`FUN_00403050`) reads it, and `TurnLookAtToward` (`FUN_00403C00`) eases the
 * camera's aim onto it. So **one `undefined` read out of a motion array is a
 * NaN four layers away, in the aim the whole fight is meant to follow** — and
 * nothing in between says a word about it.
 *
 * That is not hypothetical. `Poser.pose` had a second entrance path that posed
 * `obj.intro`, the spawn **descriptor's** cue-clip field (`+0x04`/`+0x08`) —
 * permanent data, not a play state, so nothing ever cleared it. It clamped its
 * frame at the bottom and not at the top, ran off the end of a 41-frame clip,
 * and posed `m.root[undefined]`. `g_camera_lookat_target` went NaN and stage 2
 * block 3 could not be cleared by a player, because the camera was pointing at
 * nothing. `docs/PLAYER_HANGS.md` item 1.
 *
 * This drives every path through the poser well past the end of every clip and
 * asserts the arithmetic stays finite. It uses three.js, which is why it is
 * its own file rather than a case in `port.test.ts`: `Quaternion` and
 * `Object3D` are the units the poser works in, and swapping them for stubs
 * would test something else.
 *
 * Run with `npm run test:pose`.
 */
import { Group, Object3D, Quaternion, Vector3 } from "three";
import type { BakedMotion, CharacterType } from "../src/bundle";
import type { Actor } from "../src/game/actor";
import type { Instance } from "../src/render/characters/instance";
import { Poser } from "../src/render/characters/pose";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok    ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

const BONES = 4;

/** A clip with recognisable, finite data in every slot. */
function motion(id: number, frames: number, fps = 30): BakedMotion {
  const root: number[] = [];
  const rot: number[] = [];
  for (let f = 0; f < frames; f++) {
    root.push(f, 10 + f * 0.1, -f);
    for (let b = 0; b < BONES; b++) rot.push(id + b, f, b);
  }
  return { bank: "test", frames, fps, root, rot,
           play_length: 2 * frames - 2 } as unknown as BakedMotion;
}

function instance(motions: Record<string, BakedMotion>,
                  a: Partial<Actor>): Instance {
  const bones = new Map<number, Object3D>();
  for (let b = 1; b < BONES; b++) bones.set(b, new Object3D());
  return {
    at: 0x1e00,
    a: { motion: 1022, clock: 0, death: null, intro: null, action: null,
         react: null, fadeFrom: null, fade: 0, fadeLen: 0,
         ...a } as unknown as Actor,
    type: { bone_count: BONES, motions } as unknown as CharacterType,
    root: new Object3D(),
    pivot: new Group(),
    bones,
    gore: new Map(),
  };
}

/** Every number the pose left behind. */
function finite(inst: Instance): boolean {
  const ok = (v: Vector3 | Quaternion): boolean =>
    Object.values(v).every((n) => typeof n !== "number" || Number.isFinite(n));
  if (!ok(inst.pivot.position) || !ok(inst.pivot.quaternion)) return false;
  for (const [, node] of inst.bones) if (!ok(node.quaternion)) return false;
  return true;
}

/** Drive one instance across a wide sweep of clocks and report the first NaN. */
/**
 * `make` is handed a tick count, and that is the only clock there is.
 *
 * It used to be `t = i / 60` seconds, passed as both the play cursor and the
 * one-shot tracks' position, because the port kept those in different units.
 * It keeps them in one now -- whole 60 Hz ticks, which is what the engine
 * counts -- so there is nothing left to confuse.
 */
function sweep(name: string, make: (ticks: number) => Instance): void {
  const poser = new Poser();
  for (let i = 0; i <= 600; i++) {
    const inst = make(i);
    poser.pose(inst);
    if (!finite(inst)) {
      check(name, false, `not finite at tick ${i}`);
      return;
    }
  }
  check(name, true);
}

console.log("\npose: the arithmetic stays finite past the end of every clip\n");

// 41 frames is the van jump-out, `zom.bin` 923 -- the clip the bug ran off.
const CLIPS: Record<string, BakedMotion> = {
  "923": motion(923, 41),
  "1022": motion(1022, 24),
  "975": motion(975, 30),
  "1013": motion(1013, 12),
  "0x3f7": motion(1015, 8),
};

sweep("the looping motion wraps rather than running out",
      (ticks) => instance(CLIPS, { motion: 1022, playTicks: ticks }));

sweep("a one-shot action holds its last frame",
      (ticks) => instance(CLIPS, { motion: 1022, playTicks: ticks,
                               action: { motion: 1013, ticks } as Actor["action"] }));

sweep("a death clip holds its last frame",
      (ticks) => instance(CLIPS, { motion: 1022, playTicks: ticks,
                               death: { motion: 975, ticks } as Actor["death"] }));

sweep("a hit reaction blends without running out",
      (ticks) => instance(CLIPS, { motion: 1022, playTicks: ticks,
                               react: { motion: 975, ticks, blend: 10,
                                        hard: false } as Actor["react"] }));

sweep("a cross-fade out of the previous clip stays finite",
      (ticks) => instance(CLIPS, { motion: 1022, playTicks: ticks, fade: 5,
                               fadeLen: 10,
                               fadeFrom: { motion: 923, ticks } as
                                 Actor["fadeFrom"] }));

console.log("\nthe descriptor's cue clip is not a second channel\n");

// The regression. `obj.intro` is the spawn descriptor's `+0x04`/`+0x08`: which
// clip the entrance *will* play, kept for the actor's whole life because
// `ZombieStateMotionCue21` reads it every time it runs. The engine plays it by
// putting it in the ordinary motion -- `ActorSetMotion` (`FUN_00411930`)
// writes `obj+0x1B4` and zeroes the cursor at `obj+0x19C` -- so the renderer
// must follow `obj.motion` and never the descriptor.
{
  const poser = new Poser();
  // Long past the 41 frames of the entrance clip, with the descriptor still
  // naming it, which is the state every van zombie spends its life in.
  const inst = instance(CLIPS, { motion: 1022, playTicks: 360,
                                 intro: { motion: 923, delay: 0 } });
  poser.pose(inst);
  check("an actor whose descriptor names a cue clip still poses finitely",
        finite(inst));

  // And it poses the clip the *game* has running. Bone 1's first BAMS
  // component is the clip id, so the two are told apart by the pose itself.
  const a = new Quaternion().copy(inst.bones.get(1)!.quaternion);
  const same = instance(CLIPS, { motion: 1022, playTicks: 360 });
  poser.pose(same);
  check("...and poses `obj.motion`, not the descriptor's clip",
        a.equals(same.bones.get(1)!.quaternion));

  // During the entrance the state machine has put the cue clip in `obj.motion`
  // itself, so the jump is drawn -- by the ordinary path, with no second one.
  const during = instance(CLIPS, { motion: 923, playTicks: 30,
                                   intro: { motion: 923, delay: 0 } });
  poser.pose(during);
  const cue = instance(CLIPS, { motion: 923, playTicks: 30 });
  poser.pose(cue);
  check("...and the entrance itself is still drawn, through `obj.motion`",
        finite(during)
        && during.bones.get(1)!.quaternion.equals(cue.bones.get(1)!.quaternion));
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
