/**
 * Class 0x41 constructors 42, 52, 55, 61 and 65, each placed the way the page
 * places it -- a placement in the bundle, the walker's spawn,
 * `SpawnPropContainers` and a frame of `GameUpdate` from `ResetGameGlobals`
 * -- and held to the numbers their routines' instructions give.
 */
import type { BreakablePlacement, CharacterType } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { GameUpdate, SpawnPropContainers } from "../../src/game/director";
import { G } from "../../src/game/globals";
import { NULL_HOST } from "../../src/game/host";
import { SetGameTables } from "../../src/game/tables";
import { SpawnClass } from "../../src/game/spawn_class";
import { GameMode } from "../../src/game/game_mode";
import { ActorFlag } from "../../src/game/actor";
import { g_class_handlers } from "../../src/game/registry";
import { ShotTestPickedHere } from "../../src/game/combat/shot_test";
import {
  ActorDrawLightDirection, ActorDrawsUnderSecondaryLights,
} from "../../src/game/light_sets";
import {
  PropContainerRoutine, PropFamily, Type61FigureAt, TYPE42_SLOT, TYPE52_SLOT,
  TYPE55_SLOT, TYPE65_SLOT, PropExpireByStepLifetime,
} from "../../src/game/class41";
import { BreakablePropPoolUpdate } from "../../src/game/class41/pool";
import { PropUpdateType55Particles } from "../../src/game/class41/type55";
import { PlaceType65Particles } from "../../src/game/class41/type65";
import { PropWords } from "../../src/game/class41/words";
import { BREAKABLES, CHARS, TYPE, check, propScene } from "./harness";

/** `9.58738e-05` -- the engine's BAMS to radians, `MatrixRotateY`'s own. */
const BAMS = 9.58738e-05;

/** One frame of the port, as the page runs it. */
function frame(rng: Rng, events: Events): void {
  GameUpdate(1 / 60, NULL_HOST, rng, events);
}

/** A scene with these placements in the bundle and these spawns listed. */
function placeScene(rng: Rng, pls: BreakablePlacement[],
                    types: Record<string, CharacterType> = {}): Events {
  const events = propScene(rng, GameMode.Arcade);
  SetGameTables({ ...CHARS, types: { ...CHARS.types, ...types } },
                { ...BREAKABLES,
                  placements: [...(BREAKABLES.placements ?? []), ...pls] });
  SpawnPropContainers(pls.map((p) => ({
    at: p.at, class: SpawnClass.PropContainerPlacer, pos: p.pos })));
  return events;
}

console.log("\nclass 0x41 constructor 42, stage 2's model at its own coordinates:");
{
  const rng = new Rng(4201);
  // Stage 2 block 35 step 1 op 52: evt 0x14968, lifetime 0x14, at the origin.
  const pl: BreakablePlacement = {
    at: 0x14968, container: "type42", lifetime_evt_steps: 0x14,
    pos: [0, 0, 0], yaw: 0 };
  const events = placeScene(rng, [pl]);
  G.g_evt_step_index = 1;
  frame(rng, events);
  const placer = G.g_object_list.find((o) => o.at === 0x14968);
  const p = G.g_breakable_props.find((q) => q.at === 0x14968);
  check("the placer runs constructor 42 and is gone",
        placer?.condition === 42 && placer.dead === true,
        String(placer?.condition));
  check("one frame builds the task", p?.family === PropFamily.Type42);
  if (!p) throw new Error("no type-42 task");
  BreakablePropPoolUpdate(rng, events);
  const d = p.draws?.[0];
  // `PUSH 0x1823; CALL AssetDrawSlot` with no push: the model's own world
  // coordinates, which the recording's identity is.
  check("it draws komono_boss2.bin[7] under the identity -- no transform",
        p.draws?.length === 1 && d?.slot === 0x1823 && TYPE42_SLOT === 0x1823
        && d.m.every((v, i) => v === (i % 5 === 0 ? 1 : 0)),
        JSON.stringify(d));
  G.g_evt_step_index = 3;
  BreakablePropPoolUpdate(rng, events);
  check("any step index but 2 draws on", !p.dead && p.draws?.length === 1);
  G.g_evt_step_index = 2;
  BreakablePropPoolUpdate(rng, events);
  check("step index 2 kills it before it draws, lifetime or not",
        G.g_breakable_props.every((q) => q.at !== 0x14968)
        && p.draws?.length === 0);
}

console.log("\nclass 0x41 constructor 52, the van's doors drawn shut:");
{
  const rng = new Rng(5201);
  // Stage 1 block 14 step 1: evt 0x68AC at (-870.1, -7, -464.8), yaw
  // 0xB433, lifetime 0.
  const pos: [number, number, number] =
    [Math.fround(-870.1), -7, Math.fround(-464.8)];
  const yaw = 0xb433;
  const pl: BreakablePlacement = {
    at: 0x68ac, container: "type52", lifetime_evt_steps: 0, pos, yaw };
  const events = placeScene(rng, [pl]);
  G.g_evt_step_index = 1;
  frame(rng, events);
  const doors = G.g_breakable_props.filter((q) => q.at === 0x68ac);
  check("two objects, type 12's routine, slots 0x1794 and 0x1795",
        doors.length === 2 && TYPE52_SLOT === 0x1794
        && doors.every((q) => q.family === PropFamily.DrawOnlyType12)
        && doors[0].slot === 0x1794 && doors[1].slot === 0x1795);
  // `T(pos) . Ry(yaw)` of (i * 9.29f, 11.5, 22.68f): x' = x c + z s,
  // z' = -x s + z c, as `MatrixRotateY` builds rows 0 and 2.
  const c = Math.cos(yaw * BAMS), s = Math.sin(yaw * BAMS);
  const want = [-1, 1].map((i) => {
    const lx = Math.fround(i * Math.fround(9.29)), lz = Math.fround(22.68);
    return [Math.fround(pos[0] + lx * c + lz * s), Math.fround(pos[1] + 11.5),
            Math.fround(pos[2] - lx * s + lz * c)];
  });
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;
  check("each at T(placer) . Ry(placer yaw) of (-/+9.29, 11.5, 22.68)",
        doors.length === 2 && doors.every((q, k) =>
          near(q.x, want[k][0]) && q.y === want[k][1] && near(q.z, want[k][2])),
        JSON.stringify(doors.map((q) => [q.x, q.y, q.z])) + " "
          + JSON.stringify(want));
  check("the second turned half round, both at unit scale",
        doors[0]?.yaw === yaw && doors[1]?.yaw === yaw + 0x8000
        && doors.every((q) => q.restX === 1 && q.restY === 1 && q.restZ === 1
                              && q.pitch === 0 && q.roll === 0));
  check("...and neither registers a sphere or moves a counter",
        doors.every((q) => !q.shotRegistered) && G.g_enemies_alive === 0
        && G.g_enemies_present === 0);
  const still = !PropExpireByStepLifetime(doors[0]);
  G.g_evt_step_index = 2;
  check("lifetime 0: the first step change retires both",
        still && PropExpireByStepLifetime(doors[0])
        && PropExpireByStepLifetime(doors[1]));
}

console.log("\nclass 0x41 constructor 52, stage 5's pair lives four step changes:");
{
  const rng = new Rng(5202);
  const pl: BreakablePlacement = {
    at: 0x0dd4, container: "type52", lifetime_evt_steps: 4,
    pos: [362.5, Math.fround(-0.1), Math.fround(-262.8)], yaw: 0 };
  const events = placeScene(rng, [pl]);
  G.g_evt_step_index = 2;
  frame(rng, events);
  const doors = G.g_breakable_props.filter((q) => q.at === 0x0dd4);
  let changes = 0;
  for (let s = 3; doors.some((q) => !q.dead) && s < 20; s++) {
    G.g_evt_step_index = s;
    changes++;
    BreakablePropPoolUpdate(rng, events);
  }
  // At yaw 0 the doors stand at x -/+9.29 from the placer and 22.68 on.
  check("at yaw 0: (362.5 -/+ 9.29, 11.4, -240.12)",
        doors[0]?.x === Math.fround(362.5 - Math.fround(9.29))
        && doors[1]?.x === Math.fround(362.5 + Math.fround(9.29))
        && doors[0]?.z === Math.fround(Math.fround(-262.8) + Math.fround(22.68)),
        JSON.stringify(doors.map((q) => [q.x, q.y, q.z])));
  check("they go on the fifth step change, `4 < ++count`", changes === 5,
        String(changes));
}

console.log("\nclass 0x41 constructor 55, stage 6's eight hundred pieces:");
{
  const rng = new Rng(5501);
  // The first three rows of `g_type55_particle_offsets` (0x00594F2A), as the
  // image holds them; the rest do not matter to what is asserted.
  const rows: [number, number, number][] = [
    [2726, -1467, 12079], [-3181, -1467, 11890], [5842, 463, 10987]];
  while (rows.length < 0x30) rows.push([0, 0, 0]);
  const pos: [number, number, number] = [Math.fround(752.8), 2781, -9872];
  const pl: BreakablePlacement = {
    at: 0x4780, container: "type55", lifetime_evt_steps: 0, pos, yaw: 0,
    offsets: rows };
  const events = placeScene(rng, [pl]);
  G.g_evt_step_index = 1;
  frame(rng, events);
  const p = G.g_breakable_props.find((q) => q.at === 0x4780);
  check("one 0x8500-byte task of eight hundred pieces",
        p?.family === PropFamily.Type55 && p.particles.length === 800);
  if (!p) throw new Error("no type-55 task");
  const q0 = p.particles[0], q1 = p.particles[1];
  check("piece i < 48 starts at row i * 0.001 from the placer, 10.5 up",
        q0.x === Math.fround(2726 * Math.fround(0.001) + pos[0])
        && q0.y === Math.fround(-1467 * Math.fround(0.001) + pos[1] + 10.5)
        && q0.z === Math.fround(12079 * Math.fround(0.001) + pos[2])
        && q1.x === Math.fround(-3181 * Math.fround(0.001) + pos[0]),
        JSON.stringify([q0.x, q0.y, q0.z]));
  check("...and is never given a scale: the JL steps over the only store",
        p.particles.slice(0, 48).every((q) => q.s === 0)
        && p.particles.slice(48).every((q) => q.s >= 0.1 && q.s <= 0.5
                                              && q.s !== 0));
  check("the speeds: out along the row, 1..4 up, rates within 0x300",
        p.particles.every((q) => q.vy >= 1 && q.vy <= 4.01
          && Math.abs(q.wx) <= 0x300 && Math.abs(q.wy) <= 0x300
          && Math.abs(q.wz) <= 0x300 && q.rx === 0)
        && q0.vx >= 0 && q0.vx <= Math.fround(0.1 * 2726 * 0.001) + 1e-6
        && q1.vx <= 0);
  const before = { ...q0 };
  BreakablePropPoolUpdate(rng, events);
  check("while flag 0x31 is down: nothing moves, nothing is drawn",
        p.draws?.length === 0 && q0.y === before.y
        && PropWords(p, { o1A0: 0 }).o1A0 === 0);
  G.g_script_flags[0x31] = 1;
  G.g_scene_tick_counter = 7;
  BreakablePropPoolUpdate(rng, events);
  check("the flag: a frame of gravity 0.05444 and the step, all drawn at 0.5",
        q0.vy === Math.fround(before.vy - Math.fround(0.05444))
        && q0.y === Math.fround(q0.vy + before.y)
        && q0.rx === ((before.wx << 16) >> 16)
        && p.draws?.length === 800 && p.draws[1].slot === TYPE55_SLOT + 1
        && p.draws[49].slot === 0x19d + 1 && p.draws[0].alpha === 0.5,
        `${p.draws?.length}`);
  // A piece put under the floor bounces: -(rand % 21 * 0.01 + 0.3) * vy.
  const q = p.particles[100];
  q.y = 2700; q.vy = -2;
  BreakablePropPoolUpdate(rng, events);
  const fell = Math.fround(-2 - Math.fround(0.05444));
  check("under 2782.09 a piece bounces up at 0.3..0.5 of its speed",
        q.vy > 0 && q.vy >= -fell * 0.3 - 1e-5 && q.vy <= -fell * 0.5 + 1e-5,
        String(q.vy));
  // Two flagged frames so far, both drawn. The task runs its body while
  // `+0x1A0` read 0..0x8C and dies on the frame it reads 0x8D; it draws
  // while the incremented word is <= 0x6E.
  let flagged = 2;
  let drawnFrames = 2;
  while (!p.dead && flagged < 400) {
    BreakablePropPoolUpdate(rng, events);
    flagged++;
    if (!p.dead && p.draws?.length) drawnFrames++;
  }
  check("141 frames of the task, the first 110 of them drawn, gone on the 142nd",
        p.dead && flagged === 142 && drawnFrames === 110,
        `${flagged} ${drawnFrames}`);
  check("no counter moved", G.g_enemies_alive === 0
        && G.g_enemies_present === 0);
}

console.log("\nclass 0x41 constructor 55's late draw is the scene's first tick only:");
{
  const rng = new Rng(5502);
  const rows: [number, number, number][] = [];
  while (rows.length < 0x30) rows.push([1000, 0, 0]);
  const pl: BreakablePlacement = {
    at: 0x4780, container: "type55", lifetime_evt_steps: 0,
    pos: [0, 5000, 0], yaw: 0, offsets: rows };
  const events = placeScene(rng, [pl]);
  frame(rng, events);
  const p = G.g_breakable_props.find((q) => q.at === 0x4780)!;
  G.g_script_flags[0x31] = 1;
  PropWords(p, { o1A0: 0 }).o1A0 = 120;
  G.g_scene_tick_counter = 0;
  PropUpdateType55Particles(p, rng);
  check("past frame 110 it draws when g_scene_tick_counter is 0",
        p.draws?.length === 800);
  G.g_scene_tick_counter = 1;
  PropUpdateType55Particles(p, rng);
  check("...and not otherwise", p.draws?.length === 0 && !p.dead);
}

console.log("\nclass 0x41 constructor 65, stage 5's three hundred pieces:");
{
  const rng = new Rng(6501);
  // The placer somewhere else entirely: the pieces start at the literals.
  const pl: BreakablePlacement = {
    at: 0x3d5c, container: "type65", lifetime_evt_steps: 0,
    pos: [0, 0, 0], yaw: 0 };
  const events = placeScene(rng, [pl]);
  frame(rng, events);
  const p = G.g_breakable_props.find((q) => q.at === 0x3d5c);
  check("one task of three hundred pieces",
        p?.family === PropFamily.Type65 && p.particles.length === 300);
  if (!p) throw new Error("no type-65 task");
  // The constructor's own output, before any frame: the frame above has
  // already run the task once, as `ActorAlloc`'s append makes it.
  const fresh = PlaceType65Particles(0x3d5c, { x: 0, y: 0, z: 0 },
                                     new Rng(6502));
  check("round (580, 2200, -9149) whatever the placer, +-5",
        fresh.particles.every((q) => q.x >= 575 && q.x <= 585
          && q.y >= 2195 && q.y <= 2205 && q.z >= -9154 && q.z <= -9144
          && Number.isInteger(q.x) && Number.isInteger(q.y))
        && new Set(fresh.particles.map((q) => q.x)).size === 11);
  check("speeds vx -0.4..0.4, vy -1.5..-0.5, vz 0.5..1.5, scale 1.5",
        fresh.particles.every((q) => q.vx >= -0.4001 && q.vx <= 0.4001
          && q.vy >= -1.5 && q.vy <= -0.5 && q.vz >= 0.5 && q.vz <= 1.5
          && q.s === 1.5));
  const b = { ...p.particles[7] };
  BreakablePropPoolUpdate(rng, events);
  const q = p.particles[7];
  const d = p.draws?.[7];
  const len = (i: number) => Math.hypot(d!.m[i], d!.m[i + 1], d!.m[i + 2]);
  check("a frame: gravity 0.10888, the step, and 0xCA5 + i % 72 at "
        + "(1.5, 1.5, 1.2)",
        q.vy === Math.fround(b.vy - Math.fround(0.10888))
        && q.x === Math.fround(b.vx + b.x) && p.draws?.length === 300
        && d?.slot === TYPE65_SLOT + 7 && p.draws[72].slot === 0xca5
        && d.alpha === undefined && Math.abs(len(0) - 1.5) < 1e-5
        && Math.abs(len(8) - Math.fround(1.5 * Math.fround(0.8))) < 1e-5,
        JSON.stringify(d));
  // The frame that built it ran it once, and the update above once more.
  let n = 2;
  while (!p.dead && n < 400) { BreakablePropPoolUpdate(rng, events); n++; }
  check("301 frames drawn, gone on the 302nd", p.dead && n === 302, String(n));
}

console.log("\nclass 0x41 constructor 61, stage 6's nine figures:");
{
  const rng = new Rng(6101);
  // `g_type61_figure_types` (0x0059504C), as the image holds it.
  const types = [0x13, 0x0b, 0x19, 0x0a, 0x07, 0x0d, 0x10, 0x16, 0x12];
  const chars: Record<string, CharacterType> = {};
  for (const t of types) chars[String(t)] = { ...TYPE, type: t };
  const pl: BreakablePlacement = {
    at: 0x2058, container: "type61", lifetime_evt_steps: 1,
    pos: [0, 0, 0], yaw: 0, char_types: types };
  const events = placeScene(rng, [pl], chars);
  frame(rng, events);
  const figs = G.g_object_list.filter((o) => !o.despawned
    && o.cls === SpawnClass.PropContainerPlacer
    && o.placer.routine === PropContainerRoutine.Type61Figure);
  const placer = G.g_object_list.find((o) => o.at === 0x2058);
  check("the placer builds nine skinned actors and dies",
        figs.length === 9 && placer?.dead === true
        && figs.every((f, i) => f.at === Type61FigureAt(0x2058, i)));
  const at = (i: number) => figs[i];
  // i < 4: z -9605, yaw 0x8000, x = i*24 + 79; else z -9568, yaw 0,
  // x = (i-4)*24 + 41; y 2510, 2507 for types 0x19 and 0x16; type 0x13 z
  // -9608 on 0x3EA, 0x16 z -9566.1 on 0x3DA, the rest 0x2F6.
  check("figure 0, tutorial: (79, 2510, -9608) facing 0x8000 on clip 0x3EA",
        at(0).pos.x === 79 && at(0).pos.y === 2510 && at(0).pos.z === -9608
        && at(0).yaw === 0x8000 && at(0).motion === 0x3ea
        && at(0).charType === 0x13);
  check("figure 2, zstin: (127, 2507, -9605) on 0x2F6",
        at(2).pos.x === 127 && at(2).pos.y === 2507 && at(2).pos.z === -9605
        && at(2).motion === 0x2f6);
  check("figure 4, char_adv00: (41, 2510, -9568) facing 0",
        at(4).pos.x === 41 && at(4).pos.y === 2510 && at(4).pos.z === -9568
        && at(4).yaw === 0 && at(4).charType === 7);
  check("figure 7, zsass: (113, 2507, -9566.1) on 0x3DA",
        at(7).pos.x === 113 && at(7).pos.y === 2507
        && at(7).pos.z === Math.fround(-9566.1) && at(7).motion === 0x3da);
  check("each keeps the 0x80 its build raised: the AND is the placer's",
        figs.every((f) => (f.flags & ActorFlag.ShootPerBone) !== 0
                          && (f.flags & 0x80080000) === 0 && f.hp === 1));
  for (let i = 0; i < 30; i++) frame(rng, events);
  check("thirty frames on, every one still holds frame 0 of its clip",
        figs.every((f) => f.playTicks === 0 && !f.despawned));
  check("under light block 1, lit from (0, 0x4000); the placer is not",
        figs.every((f) => ActorDrawsUnderSecondaryLights(f)
          && ActorDrawLightDirection(f)?.pitch === 0
          && ActorDrawLightDirection(f)?.yaw === 0x4000)
        && !ActorDrawsUnderSecondaryLights(placer!)
        && ActorDrawLightDirection(placer!) === null);
  check("never filed for the shot test, and the renderer's pick passes them by",
        figs.every((f) => ShotTestPickedHere(f))
        && !G.g_shot_test_list.some((e) => figs.some((f) => f.at === e.at))
        && g_class_handlers[SpawnClass.PropContainerPlacer]?.registersForShotTest
          === true);
  check("no counter moved", G.g_enemies_alive === 0
        && G.g_enemies_present === 0);
  G.g_script_flags[0] = 2;
  frame(rng, events);
  check("flag 0 at 2 is not the test's 1", figs.every((f) => !f.despawned));
  G.g_script_flags[0] = 1;
  frame(rng, events);
  check("flag 0 at 1 despawns all nine", figs.every((f) => f.despawned));
}
