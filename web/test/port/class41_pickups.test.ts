/**
 * What a broken container lets out: the score pickup (`SpawnScorePickup`,
 * `ScorePickupUpdate`), the golden frog (`SpawnGoldenFrog`,
 * `GoldenFrogUpdate`) and class 0x41 constructors 26 and 68. Every expected
 * number is worked from the listing and the image's tables, not measured
 * from the port.
 */
import { Rng } from "../../src/core/rng";
import type { BreakablesJson } from "../../src/bundle";
import { G } from "../../src/game/globals";
import { SetGameTables } from "../../src/game/tables";
import { GameMode } from "../../src/game/game_mode";
import {
  ItemSet, PlaceKindedProp, PropFamily, type BreakableProp,
} from "../../src/game/class41";
import {
  SCORE_PICKUP_ROUTINE_TYPE, SFX_SCORE_PICKUP, SFX_SCORE_PICKUP_PENALTY,
  SpawnScorePickup,
} from "../../src/game/class41/items";
import { BreakablePropPoolUpdate } from "../../src/game/class41/pool";
import { BreakablePropTakeShot } from "../../src/game/class41/prop";
import { makeBreakableProp } from "../../src/game/class41/prop_state";
import { PropMatrixClearRotation } from "../../src/game/class41/prop_draw";
import { CH_AMBIENT } from "../../src/game/light_block";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixScale, MatrixTranslate,
  type Mat,
} from "../../src/game/matrix";
import {
  check, CHARS, BREAKABLES, motion, propScene, TYPE,
} from "./harness";
import type { CharacterType, CharactersJson } from "../../src/bundle";
import type { Events } from "../../src/core/events";
import {
  ActorFlag, type Actor, type PropContainerActor,
} from "../../src/game/actor";
import { CameraBlockEye } from "../../src/game/camera/view";
import { SkeletonRecordCameraPoint } from "../../src/game/camera/track";
import { HIT_SLOT_NONE } from "../../src/game/globals";
import { NULL_HOST, type GameHost } from "../../src/game/host";
import { BuildSceneLightDirection } from "../../src/game/light_block";
import { g_class_handlers } from "../../src/game/registry";
import { ActorSpawn } from "../../src/game/spawn";
import { SpawnClass } from "../../src/game/spawn_class";
import { MotionPlayFrame, MotionPlayLength } from "../../src/game/tables";
import { vec3 } from "../../src/game/vec";
import {
  RESULT_FIGURE_AT_BIT, RESULT_FIGURE_TEMPLATE_BIT,
} from "../../src/game/class61/state";
import {
  g_class41_constructors, GOLDEN_FROG_CHAR_TYPE, GOLDEN_FROG_FADE_FROM,
  GOLDEN_FROG_IDLE_MOTION, GOLDEN_FROG_SHOT_MOTION, GOLDEN_FROG_STRIP_LAST,
  PropContainerRoutine, PropContainerType, SFX_GOLDEN_FROG, SpawnGoldenFrog,
} from "../../src/game/class41";

/**
 * `g_item_pickup_slot` (`0x00595058`), the five rows read out of the image
 * the way `hod2lib/class41_rows.ts` reads them:
 *
 * ```
 * 00595070  006410b3 3fc00000 3f666666   kind 2: 0x10B3, 100, 1.5, 0.9
 * 00595094  01901578 3fc00000 3f800000   kind 5: 0x1578, 400, 1.5, 1.0
 * 005950a0  025810b4 3fc00000 3fe66666   kind 6: 0x10B4, 600, 1.5, 1.8
 * 005950ac  fe700a4f 3fc00000 40000000   kind 7: 0x0A4F, -400, 1.5, 2.0
 * 005950b8  032010b2 3f800000 00000000   kind 8: 0x10B2, 800, 1.0, 0.0
 * ```
 */
const PICKUPS: Partial<BreakablesJson> = {
  item_pickups: {
    2: { slot: 0x10b3, score: 100, scale: 1.5, y_offset: Math.fround(0.9) },
    5: { slot: 0x1578, score: 400, scale: 1.5, y_offset: 1.0 },
    6: { slot: 0x10b4, score: 600, scale: 1.5, y_offset: Math.fround(1.8) },
    7: { slot: 0x0a4f, score: -400, scale: 1.5, y_offset: 2.0 },
    8: { slot: 0x10b2, score: 800, scale: 1.0, y_offset: 0.0 },
  },
};

function scene(rng: Rng, mode = GameMode.Arcade) {
  const events = propScene(rng, mode);
  SetGameTables(CHARS, { ...BREAKABLES, ...PICKUPS } as BreakablesJson);
  return events;
}

const f32 = Math.fround;

function world(build: (m: Mat) => void): Mat {
  const m = MatIdentity();
  build(m);
  return m;
}

function same(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length
    && a.every((v, i) => Math.abs(v - b[i]) < 1e-5);
}

function pickups(): BreakableProp[] {
  return G.g_breakable_props.filter(
    (q) => q.family === PropFamily.Generic
      && q.kind === SCORE_PICKUP_ROUTINE_TYPE && !q.dead);
}

console.log("\nthe score pickup, let out by a broken container:");
{
  const rng = new Rng(26);
  const events = scene(rng);
  const sounds: number[] = [];
  events.on("sound.play", (e) => sounds.push(e.id));
  G.g_scene_index = 1;
  // A kind-2 kinded prop in set 6, a set of one: `PlaceKindedProp` seeds the
  // countdown with `rand() % 1 + 1`, so this one is the one that pays.
  const k = PlaceKindedProp(0xd900, 2, ItemSet.Score6, 1, 5, 10, 10, -3, 0,
                            rng);
  G.g_breakable_props.push(k);
  BreakablePropTakeShot(k, 0);
  BreakablePropPoolUpdate(rng, events);
  const [q] = pickups();
  check("a broken set-6 prop lets out a score pickup object",
        !!q, `${G.g_breakable_props.map((p) => `${p.family}/${p.kind}`)}`);
  if (q) {
    // Set 6 lifts a kind-2 drop by 0.5 (`KindedPropUpdate`), and
    // `SpawnScorePickup` adds the row's 1.8 over that: `FLD [0x595060+0x48];
    // FADD [EAX+0x1A0]; FSTP`.
    check("...of kind 6, its row's model and 1.8 above the prop",
          q.words.o194 === 6 && q.slot === 0x10b4 && q.x === 10 && q.z === -3
          && q.y === f32(f32(1.8) + 10.5), `${q.words.o194} ${q.slot} ${q.y}`);
    check("...live with bit 31, a 3.0 sphere and the prop's lifetime",
          q.flags === 0x80000001 && q.hitRadius === 3.0 && q.lifetime === 5,
          `${q.flags.toString(16)} ${q.hitRadius} ${q.lifetime}`);
    // `ActorAlloc` appended it to the walk, so it has already run once:
    // turned by 0x200, drawn under block 1, its shadow beneath.
    check("...ran on the frame it was made: turned 0x200", q.yaw === 0x200);
    const b1 = G.g_scene_light_block1;
    const d = q.draws ?? [];
    check("...drawn T(pos) Ry(yaw) S(1.5), under block 1's light",
          d.length === 2 && d[0].slot === 0x10b4 && d[0].alpha === undefined
          && same(d[0].m, world((m) => {
            MatrixTranslate(m, q.x, q.y, q.z); MatrixRotateY(m, 0x200);
            MatrixScale(m, 1.5, 1.5, 1.5);
          }))
          && d[0].light?.ambient === b1.channels[CH_AMBIENT],
          JSON.stringify(d.map((c) => c.slot)));
    check("...over its shadow at the prop, 0.1 up, scaled 3 by 1 by 3",
          d[1]?.slot === 0x10d0 && same(d[1].m, world((m) => {
            MatrixTranslate(m, 10, f32(q.y - f32(1.8) + f32(0.1)), -3);
            MatrixScale(m, 3, 1, 3);
          })));
    check("...and is shot as a sphere at its origin",
          q.shotRegistered && q.shotY === q.y);

    const before = G.g_player_score[0];
    BreakablePropTakeShot(q, 0);
    BreakablePropPoolUpdate(rng, events);
    check("shot by player 0, it pays its row's 600 and no prop's ten",
          G.g_player_score[0] - before === 600,
          `${G.g_player_score[0] - before}`);
    check("...plays 0x3B17A9 and takes player 0's strip",
          sounds.includes(SFX_SCORE_PICKUP) && q.removeFlag === 0x116a
          && q.slot === 0x10b4);
    const d2 = q.draws ?? [];
    check("...draws frame 1 of the strip 2.5 below it, and no shadow",
          q.storyItem === 2 && d2.length === 2
          && d2[1].slot === 0x116a - 1 + 2
          && same(d2[1].m, world((m) => {
            MatrixTranslate(m, q.x, f32(q.y - 2.5), q.z);
            MatrixRotateY(m, q.yaw);
          })), JSON.stringify(d2.map((c) => c.slot)));
    BreakablePropTakeShot(q, 0);
    BreakablePropPoolUpdate(rng, events);
    check("...and the taken bit stops a second payment",
          G.g_player_score[0] - before === 600);
    // Frame 3 now. 0x19 is the first faded frame, and past 0x31 it goes.
    for (let i = 0; i < 0x19 - 3; i++) BreakablePropPoolUpdate(rng, events);
    check("from frame 0x19 the model fades by 0.02 a frame",
          q.storyItem === 0x19 && q.draws?.[0].alpha === f32(1 - 0x19 * 0.02),
          `${q.storyItem} ${q.draws?.[0].alpha}`);
    for (let i = 0; i < 0x31 - 0x19; i++) BreakablePropPoolUpdate(rng, events);
    check("...and it is still there on frame 0x31", !q.dead
          && q.storyItem === 0x31);
    BreakablePropPoolUpdate(rng, events);
    check("...and gone on the next", q.dead);
  }
}

console.log("\nthe score pickup's kinds:");
{
  const rng = new Rng(7);
  const events = scene(rng);
  const sounds: number[] = [];
  events.on("sound.play", (e) => sounds.push(e.id));
  const src = makeBreakableProp(990, 0, 0);
  Object.assign(src, { family: PropFamily.Kinded, x: 1, y: 2, z: 3,
                       lifetime: 4 });
  for (const kind of [2, 5, 7, 8]) SpawnScorePickup(src, kind, events);
  BreakablePropPoolUpdate(rng, events);
  const by = (k: number) => pickups().find((q) => q.words.o194 === k)!;
  const k2 = by(2), k5 = by(5), k7 = by(7), k8 = by(8);
  check("kind 2 is laid flat: T Ry Rx(0x4000) S",
        same(k2.draws![0].m, world((m) => {
          MatrixTranslate(m, 1, k2.y, 3); MatrixRotateY(m, 0x200);
          MatrixRotateX(m, 0x4000); MatrixScale(m, 1.5, 1.5, 1.5);
        })));
  check("kind 5 is never turned and faces the screen",
        k5.yaw === 0 && same(k5.draws![0].m, world((m) => {
          MatrixTranslate(m, 1, k5.y, 3); PropMatrixClearRotation(m);
          MatrixScale(m, 1.5, 1.5, 1.5);
        })));
  check("kind 7 is never turned", k7.yaw === 0);
  check("kind 8 draws 0x10B2 with UVs from its normals, shot 1.5 higher",
        k8.draws![0].slot === 0x10b2 && k8.draws![0].envUv === true
        && k8.shotY === f32(1.5 + k8.y) && k2.draws![0].envUv === undefined);
  G.g_player_score[1] = 1000;
  BreakablePropTakeShot(k7, 1);
  BreakablePropPoolUpdate(rng, events);
  check("kind 7 costs player 1 400 and plays 0x416A9",
        G.g_player_score[1] === 600 && sounds.includes(SFX_SCORE_PICKUP_PENALTY)
        && k7.removeFlag === 0x119c, `${G.g_player_score[1]}`);
  check("...and draws no strip once taken",
        k7.storyItem === 2 && k7.draws?.length === 1);
  // Both players' bits: `rand() % 2` picks who is paid, and the arm writes
  // the strip's base into the **model** and leaves `+0x2A4` at zero.
  G.g_player_score[0] = 0;
  G.g_player_score[1] = 0;
  k2.flags |= 0x8 | 0x2 | 0x4;
  BreakablePropPoolUpdate(rng, events);
  const who = G.g_player_score[0] === 100 ? 0 : 1;
  check("both players at once: one is paid, and the model becomes the strip",
        G.g_player_score[who] === 100 && G.g_player_score[1 - who] === 0
        && k2.slot === 0x116a + 50 * who && k2.removeFlag === 0,
        `${G.g_player_score} ${k2.slot.toString(16)}`);
  check("...and the strip drawn under it is slot n - 1",
        k2.draws?.[1]?.slot === k2.storyItem - 1);
}

// -- the golden frog ----------------------------------------------------------

/**
 * Character type 0x1C as the fixture has it: the test type's bones -- it has
 * root nodes, so the build raises `+0x34` bit 0x80 -- and the two clips
 * `GoldenFrogUpdate` plays, `0x140` the idle and `0x13F` the one it is shot
 * into, the second with a play length of 18.
 */
const FROG_TYPE = {
  ...TYPE, type: GOLDEN_FROG_CHAR_TYPE, name: "frog_gold", file: "frog_gold.bin",
  motions: {
    [String(GOLDEN_FROG_IDLE_MOTION)]: motion(30, 0, 58),
    [String(GOLDEN_FROG_SHOT_MOTION)]: motion(10, 0, 18),
  },
} as unknown as CharacterType;
const FROG_CHARS = { ...CHARS,
  types: { ...CHARS.types, [String(GOLDEN_FROG_CHAR_TYPE)]: FROG_TYPE },
} as CharactersJson;

/** A host whose tracked bone is `bone` and which has every point in front. */
function frogHost(bone: { x: number; y: number; z: number }): GameHost {
  return {
    ...NULL_HOST,
    boneWorld: (_at, _b, out) => { out.x = bone.x; out.y = bone.y;
                                   out.z = bone.z; return true; },
    // In front: `RegisterForShotTest` drops a point whose view z is above
    // its zero, which is behind the eye.
    viewSpaceOfPoint: (_p, out) => { out.x = 0; out.y = 0; out.z = -10;
                                     return true; },
  };
}

function frogScene(rng: Rng, mode = GameMode.Arcade) {
  const events = propScene(rng, mode);
  SetGameTables(FROG_CHARS, { ...BREAKABLES, ...PICKUPS } as BreakablesJson);
  return events;
}

const frogs = () => G.g_object_list.filter(
  (o) => o.cls === SpawnClass.PropContainerPlacer
    && o.placer.routine === PropContainerRoutine.GoldenFrog && !o.despawned);

/** One frame of the frog the way `SceneTaskWalk` runs it. */
function frogFrame(a: Actor, host: GameHost, rng: Rng, events?: Events): void {
  G.g_shot_test_list = [];
  if (!a.skel) SkeletonRecordCameraPoint(a, host);
  g_class_handlers[a.cls]?.update(a, { dt: 1 / 60, rng, host, events });
}

console.log("\nthe golden frog, let out by a broken container:");
{
  const rng = new Rng(3);
  const events = frogScene(rng);
  const sounds: number[] = [];
  events.on("sound.play", (e) => sounds.push(e.id));
  let released = -1;
  events.on("item.released", (e) => { released = e.set; });
  G.g_scene_index = 1;
  G.g_evt_step_index = 4;
  const k = PlaceKindedProp(0x248c, 0, ItemSet.GoldenFrog, 1, 3, 30, 5, -40,
                            0, rng);
  G.g_breakable_props.push(k);
  BreakablePropTakeShot(k, 0);
  BreakablePropPoolUpdate(rng, events);
  const [a] = frogs();
  check("a broken set-3 prop puts a golden frog in the object pool",
        !!a && released === 3, `${G.g_object_list.length}`);
  if (a && a.cls === SpawnClass.PropContainerPlacer) {
    const w = a.placer.frog!;
    // `atan2(x - eye.x, z - eye.z)` in BAMS, truncated, sign-extended -- and
    // no half turn added, where the extra life adds one.
    const eye = CameraBlockEye(G.g_camera_index);
    const yaw = (Math.trunc(Math.atan2(30 - eye.x, -40 - eye.z)
                            * 32768 / Math.PI) << 16) >> 16;
    check("...of type 0x1C on clip 0x140, at the prop, facing the camera",
          a.charType === 0x1c && a.motion === 0x140 && a.pos.x === 30
          && a.pos.y === 5 && a.pos.z === -40 && a.yaw === yaw,
          `${a.charType} ${a.motion.toString(16)} ${a.yaw} ${yaw}`);
    check("...one sphere of 4.0: the build's 0x80 is gone under `+0x34 = 1`",
          a.flags === 1 && a.hitRadius === 4.0
          && (a.flags & ActorFlag.ShootPerBone) === 0);
    check("...the build claimed it a hit slot",
          a.hitSlot !== HIT_SLOT_NONE && G.g_hit_slots[a.hitSlot] === a.at);
    check("...and the AND 0x7F / OR 0x80080000 lands on the prop's word",
          ((k.flags & 0x80080000) >>> 0) === 0x80080000
          && (k.flags & 0x80) === 0,
          k.flags.toString(16));
    check("...its step lifetime is the prop's, counted from this step",
          a.hp === 3 && w.stepSeen === 4 && w.steps === 0);
    check("...and it is the character layer's to clone from its template",
          (a.at & RESULT_FIGURE_AT_BIT) !== 0
          && (a.at & RESULT_FIGURE_TEMPLATE_BIT) === 0
          && (a.at & 0xff) === 0x1c);

    const bone = { x: 30, y: 7, z: -40 };
    const host = frogHost(bone);
    const ticks = a.playTicks;
    frogFrame(a, host, rng, events);
    const dir = vec3();
    BuildSceneLightDirection(0x300, -0x180, dir);
    check("a frame: the light turns 0x300 and -0x180 and the draw is under it",
          w.lightPitch === 0x300 && w.lightYaw === -0x180
          && !!w.drawDir && Math.abs(w.drawDir[0] - dir.x) < 1e-6
          && Math.abs(w.drawDir[2] - dir.z) < 1e-6);
    check("...the scene's direction is back after the draw",
          G.g_render_light_dir.x === G.g_scene_light_block0.dir.x
          && G.g_render_light_dir.z === G.g_scene_light_block0.dir.z);
    check("...the clip steps once",
          a.playTicks === ticks + 1, `${ticks} ${a.playTicks}`);
    check("...and it is shot as a sphere 0.25 under bone 1",
          G.g_shot_test_list.some((s) => s.at === a.at)
          && a.shotCentre.y === Math.fround(7 - 0.25) && a.shotCentre.x === 30);

    const before = G.g_player_score[0];
    a.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    frogFrame(a, host, rng, events);
    check("shot by player 0: 1000 points, 0x3B17A9, clip 0x13F",
          G.g_player_score[0] - before === 1000
          && sounds.includes(SFX_GOLDEN_FROG) && a.motion === 0x13f
          && a.state === 1, `${G.g_player_score[0] - before} ${a.state}`);
    check("...and player 0's strip, frame 0, at its feet",
          w.stripBase === 0x116a && w.stripDraw?.slot === 0x116a
          && w.strip === 1 && same(w.stripDraw.m, world((m) => {
            MatrixTranslate(m, 30, 5, -40); MatrixRotateY(m, a.yaw);
          })));
    a.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    frogFrame(a, host, rng, events);
    check("...the hit bit stays up and pays nothing more",
          G.g_player_score[0] - before === 1000 && w.strip === 2);
    // The shot clip's play length is 18: once the draw's cursor reaches it,
    // the state is 2 and the counter stops.
    let held = -1;
    for (let i = 0; i < 40 && a.state !== 2; i++) {
      frogFrame(a, host, rng, events);
    }
    held = a.playTicks;
    frogFrame(a, host, rng, events);
    check("the clip runs to its play length, and then the counter holds",
          a.state === 2 && a.playTicks === held
          && MotionPlayFrame(a) === MotionPlayLength(a),
          `${a.state} ${held} ${a.playTicks} ${MotionPlayFrame(a)}`);
    while (w.strip < GOLDEN_FROG_FADE_FROM) frogFrame(a, host, rng, events);
    check("solid while the strip is under frame 25",
          a.nodeDrawAlpha.every((x) => x === null || x === undefined));
    frogFrame(a, host, rng, events);
    check("...faded to 0.5 on every node from it",
          a.nodeDrawAlpha.filter((x) => x !== undefined)
            .every((x) => x === Math.fround(1 - 25 * 0.02))
          && a.nodeDrawAlpha.some((x) => x === 0.5),
          JSON.stringify(a.nodeDrawAlpha));
    const slot = a.hitSlot;
    while (w.strip <= GOLDEN_FROG_STRIP_LAST && !a.despawned) {
      frogFrame(a, host, rng, events);
    }
    check("gone once strip frame 0x31 has been drawn, its hit slot freed",
          a.despawned && w.stripDraw?.slot === 0x116a + 0x31
          && G.g_hit_slots[slot] === HIT_SLOT_NONE);
  }
}

console.log("\nthe golden frog's lifetime and its Training gate:");
{
  const rng = new Rng(4);
  const events = frogScene(rng);
  G.g_evt_step_index = 1;
  const src = makeBreakableProp(77, 0, 0);
  Object.assign(src, { family: PropFamily.Kinded, x: 1, y: 2, z: 3,
                       lifetime: 1 });
  SpawnGoldenFrog(src, events, rng);
  const [a] = frogs();
  const host = frogHost({ x: 1, y: 4, z: 3 });
  G.g_evt_step_index = 2;
  frogFrame(a, host, rng, events);
  check("one step change on a lifetime of 1 is outlived", !a.despawned);
  G.g_evt_step_index = 3;
  frogFrame(a, host, rng, events);
  check("...and the second takes it, hit slot and all",
        a.despawned && !G.g_hit_slots.includes(a.at));

  frogScene(rng, GameMode.Training);
  SpawnGoldenFrog(src, events, rng);
  const [t] = frogs();
  const w = (t as PropContainerActor).placer.frog!;
  const ticks = t.playTicks;
  frogFrame(t, host, rng, events);
  check("in Training with flag 0xF1 down, the clip holds and the light "
        + "keeps the scene's direction", t.playTicks === ticks
        && w.drawDir === null && w.lightPitch === 0x300);
  G.g_script_flags[0xf1] = 1;
  frogFrame(t, host, rng, events);
  check("...with 0xF1 up and 0xF2 down it steps and turns",
        t.playTicks === ticks + 1 && w.drawDir !== null);
  G.g_scene_index = 0;
  G.g_evt_block_index = 0xe;
  frogFrame(t, host, rng, events);
  check("Training's block 14 takes it", t.despawned);
}

console.log("\nclass 0x41 constructor 68, the Training lesson's frog:");
{
  const rng = new Rng(68);
  const events = frogScene(rng, GameMode.Training);
  void events;
  check("constructor 68 has a routine",
        !!g_class41_constructors[PropContainerType.GoldenFrogFromLessonTable]);
  // `g_golden_frog_lesson_xz` as the image has it, from `0x0059579C`.
  const XZ: [number, number][] = [
    [-5592, -30870], [-5691, -30870], [-5790, -30691], [-5628, -30939],
    [-5727, -30852], [-5826, -30760], [-5664, -31004], [-5763, -30917],
    [-5862, -30825], [-5699, -31071], [-5798, -30984], [-5897, -30892],
    [-5734, -31136], [-5833, -31049], [-5932, -30957],
  ];
  SetGameTables(FROG_CHARS, {
    ...BREAKABLES, ...PICKUPS,
    placements: [...BREAKABLES.placements,
                 { at: 0x9000, container: "golden_frog", xz: XZ,
                   lifetime_evt_steps: 2, pos: [0, -12, 0] }],
  } as BreakablesJson);
  G.g_training_lesson = 3;
  const placer = ActorSpawn(0x9000, SpawnClass.PropContainerPlacer, 0,
                            "placer", { hp: 2,
                                        condition: PropContainerType
                                          .GoldenFrogFromLessonTable });
  placer.pos = vec3(0, -12, 0);
  const r = new Rng(68).int(3);
  g_class_handlers[placer.cls]?.update(
    placer, { dt: 1 / 60, rng, host: NULL_HOST });
  const [a] = frogs();
  const row = XZ[r + 3 * 3];
  check("rand() % 3 + lesson * 3 picks the row, times 0.1, at the placer's y",
        !!a && a.pos.x === Math.fround(row[0] * Math.fround(0.1))
        && a.pos.z === Math.fround(row[1] * Math.fround(0.1))
        && a.pos.y === -12 && a.yaw === 0x9200,
        `${a?.pos.x} ${a?.pos.z} ${row}`);
  check("...with the placer's lifetime, and the placer's word takes the AND",
        !!a && a.hp === 2
        && ((placer.flags & 0x80080000) >>> 0) === 0x80080000
        && placer.dead);
}
