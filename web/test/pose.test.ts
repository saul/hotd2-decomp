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
 * nothing.
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
import { MOTION_FLAGS_INIT, MotionFlag } from "../src/game/actor";
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
         // What `ActorBuildSkinnedModel` (`FUN_00410440`) leaves on every
         // skeletal actor in the game: `model+0x64 = 3`, root motion on.
         motionFlags: MOTION_FLAGS_INIT,
         ...a } as unknown as Actor,
    // Two roots, as every class-0x30 skeleton has: bone 1 with bone 2 under
    // it, and bone 3 on its own -- the upper body and the legs, in small.
    // `parent` is an index into the list, as the exporter writes it.
    type: { bone_count: BONES, motions,
            bones: [{ bone: 1, parent: null }, { bone: 2, parent: 0 },
                    { bone: 3, parent: null }] } as unknown as CharacterType,
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

/** Track 1, as `MotionCrossFadeTo` leaves it: bone 1's subtree. */
function overlay(motion: number, ticks: number,
                 more: Partial<NonNullable<Actor["react"]>> = {}):
    Actor["react"] {
  return { motion, ticks, bone: 1, fadeFrom: null, fade: 0, fadeLen: 0,
           fadeOut: 0, back: false, hold: false, ...more };
}

sweep("a hit reaction plays past the end of its clip without running out",
      (ticks) => instance(CLIPS, { motion: 1022, playTicks: ticks,
                               react: overlay(975, ticks) }));

sweep("...and fades on its track without running out",
      (ticks) => instance(CLIPS, { motion: 1022, playTicks: ticks,
                               react: overlay(975, ticks, {
                                 fadeFrom: { motion: 923, ticks }, fade: 5,
                                 fadeLen: 12 }) }));

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


console.log("\nthe clip root goes to the object or to the pose, never both\n");

// `SkeletonApplyRootMotion` (`FUN_00410C50`) asks `model+0x64` bit 1 twice in
// one routine: once to decide whether the frame-to-frame delta moves the
// object, and once, in the tail Ghidra does not show, to decide whether the
// draw matrix gets `MatrixTranslate(0, root.y, 0)` or the whole
// `MatrixTranslate(root.x, root.y, root.z)`. The port's two halves are
// `ApplyRootMotion` in `game/` and `Poser` here, and **exactly one of them
// must take the horizontal part**. For eleven months this file's half took
// none of it, on a comment that said the other half already had -- which is
// true only when the bit is set.
//
// `motion()` above builds frame f's root as `(f, 10 + f * 0.1, -f)`, so frame
// 0 is `(0, 10, 0)` and the horizontal part is only visible away from it.
// Frame 6 of a 24-frame clip is 12 ticks at 30 fps against a 60 Hz cursor.
{
  const poser = new Poser();
  const AT = { motion: 1022, playTicks: 12 };
  const ON = instance(CLIPS, { ...AT, motionFlags: MOTION_FLAGS_INIT });
  const OFF = instance(CLIPS, { ...AT, motionFlags: MOTION_FLAGS_INIT
                                       & ~MotionFlag.RootMotion });
  poser.pose(ON);
  poser.pose(OFF);
  check("root motion on: the pose takes the height and nothing else",
        ON.pivot.position.x === 0 && ON.pivot.position.z === 0,
        `(${ON.pivot.position.x}, ${ON.pivot.position.z})`);
  check("...and the height is still there",
        ON.pivot.position.y === 10.6, `${ON.pivot.position.y}`);
  check("root motion off: the pose takes the whole translation",
        OFF.pivot.position.x === 6 && OFF.pivot.position.z === -6
        && OFF.pivot.position.y === 10.6,
        `(${OFF.pivot.position.x}, ${OFF.pivot.position.y}, `
        + `${OFF.pivot.position.z})`);

  // The blend path reaches the same two arms, and it used to hard-code the
  // y-only one in its own separate line -- so a civilian cross-fading into a
  // clip in a root-motion-off block would have snapped by the horizontal part
  // for the length of the fade and then not.
  const mid = { motion: 1022, playTicks: 12, fade: 5, fadeLen: 10,
                fadeFrom: { motion: 1022, ticks: 12 } as Actor["fadeFrom"] };
  const bON = instance(CLIPS, { ...mid, motionFlags: MOTION_FLAGS_INIT });
  const bOFF = instance(CLIPS, { ...mid, motionFlags: MOTION_FLAGS_INIT
                                         & ~MotionFlag.RootMotion });
  poser.pose(bON);
  poser.pose(bOFF);
  check("a cross-fade obeys the same gate: on",
        bON.pivot.position.x === 0 && bON.pivot.position.z === 0);
  check("...and off -- two frames of one clip blend to that clip's own root",
        bOFF.pivot.position.x === 6 && bOFF.pivot.position.z === -6,
        `(${bOFF.pivot.position.x}, ${bOFF.pivot.position.z})`);

  // A hit reaction does not reach the root at all. `SkeletonPoseRootFrame`
  // (`FUN_00410920`) takes the root translation and bone 0's rotation from
  // track 0 with no track test, and the reaction is on track 1. This used to
  // assert the opposite -- that the reaction's clip blended into the root --
  // and that is the belief that stood a crawler up on a standing flinch.
  const rOFF = instance(CLIPS, {
    motion: 1022, playTicks: 12,
    motionFlags: MOTION_FLAGS_INIT & ~MotionFlag.RootMotion,
    react: overlay(975, 12) });
  poser.pose(rOFF);
  check("a hit reaction leaves the root to the base clip",
        rOFF.pivot.position.x === 6 && rOFF.pivot.position.z === -6
        && rOFF.pivot.position.y === 10.6
        && rOFF.pivot.quaternion.equals(OFF.pivot.quaternion),
        `(${rOFF.pivot.position.x}, ${rOFF.pivot.position.y}, `
        + `${rOFF.pivot.position.z})`);

  // And the death clip keeps the whole root whatever the gate says. It is the
  // one declared override in the file: `ActorAdvanceMotion` does not run root
  // motion through a death, so nothing else would provide a falling body's
  // travel. If that ever changes, this is the assertion that says so.
  const dON = instance(CLIPS, { motion: 1022, playTicks: 0,
                                motionFlags: MOTION_FLAGS_INIT,
                                death: { motion: 975,
                                         ticks: 12 } as Actor["death"] });
  poser.pose(dON);
  check("the death clip keeps its own travel even with the gate set",
        dON.pivot.position.x === 6 && dON.pivot.position.z === -6,
        `(${dON.pivot.position.x}, ${dON.pivot.position.z})`);
}

console.log("\nthe stumble is on bone 1's subtree and nowhere else\n");

// `MotionCrossFadeTo(obj+0x194, 1, clip, ...)` hands track 1 bone 1 and its
// children -- `SkeletonAssignSubtreeTrack` (`FUN_00412200`) -- and
// `MotionWriteBoneAngles` (`FUN_00411D70`) poses a bone from the track its
// record names. The fixture's bone 1 has bone 2 under it and bone 3 is a
// root of its own, so the reaction's clip (975) must show on 1 and 2 and the
// base clip (1022) on 3. `motion()` puts the clip id in each bone's first
// BAMS component, so the pose itself says which clip drew it.
{
  const poser = new Poser();
  const base = instance(CLIPS, { motion: 1022, playTicks: 12 });
  const hit = instance(CLIPS, { motion: 975, playTicks: 12 });
  const both = instance(CLIPS, { motion: 1022, playTicks: 12,
                                 react: overlay(975, 12) });
  poser.pose(base);
  poser.pose(hit);
  poser.pose(both);
  const q = (i: Instance, b: number): Quaternion => i.bones.get(b)!.quaternion;
  check("bones 1 and 2 -- the subtree -- take the reaction's clip",
        q(both, 1).equals(q(hit, 1)) && q(both, 2).equals(q(hit, 2)));
  check("...and bone 3, a root of its own, keeps the base clip",
        q(both, 3).equals(q(base, 3)) && !q(both, 3).equals(q(hit, 3)));
  check("...as do the root's position and rotation",
        both.pivot.position.equals(base.pivot.position)
        && both.pivot.quaternion.equals(base.pivot.quaternion));

  // A fade on the track dissolves from its snapshot to the clip by
  // `1 - fade / fadeLen`, on the subtree alone: half way, bone 1 sits between
  // the snapshot's clip (923) and the reaction's, and bone 3 is untouched.
  const from = instance(CLIPS, { motion: 923, playTicks: 12 });
  const half = instance(CLIPS, {
    motion: 1022, playTicks: 12,
    react: overlay(975, 12, { fadeFrom: { motion: 923, ticks: 12 }, fade: 6,
                              fadeLen: 12 }) });
  poser.pose(from);
  poser.pose(half);
  const mid = new Quaternion().copy(q(from, 1)).slerp(q(hit, 1), 0.5);
  check("a fade on the track blends the subtree by 1 - fade / fadeLen",
        q(half, 1).angleTo(mid) < 1e-6 && q(half, 3).equals(q(base, 3)),
        `angle ${q(half, 1).angleTo(mid)}`);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
