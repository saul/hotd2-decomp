/**
 * Class 0x15, stage 2's floating planks, and class 0x2B, the scripted lights.
 *
 * Both are driven the way the page drives them: a placement the bundle
 * carries, the director's `SpawnSlotActor` for the walker's spawn record, and
 * `GameUpdate` from `ResetGameGlobals`. The numbers are the exe's -- the
 * descriptor's bytes (evt 84156, 27716, 25684, 3900), the routines'
 * immediates and float constants -- not measurements of the port.
 */
import type { CharactersJson } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { GameUpdate, SpawnSlotActor } from "../../src/game/director";
import { G, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST } from "../../src/game/host";
import { SetGameTables } from "../../src/game/tables";
import { SpawnClass } from "../../src/game/spawn_class";
import { RenderLightType } from "../../src/game/entity_light";
import { CameraBlockYaw } from "../../src/game/camera/view";
import { FloatingPropRoutine } from "../../src/game/class15/state";
import type { Actor } from "../../src/game/actor";
import * as evt from "../../src/hod2lib/evt";
import { class15Tail } from "../../src/hod2lib/characters";
import { check, CHARS, EnterPlay } from "./harness";

const f32 = Math.fround;
/** The IEEE-754 single bits of `v`. */
function bits(v: number): number {
  const d = new DataView(new ArrayBuffer(4));
  d.setFloat32(0, v, true);
  return d.getUint32(0, true);
}

type PlankActor = Extract<Actor, { cls: SpawnClass.FloatingPropRow }>;
type LightActor = Extract<Actor, { cls: SpawnClass.DynamicLight }>;

/** Records every `int(n)` the frame asks for, and what it got. */
class RecordingRng extends Rng {
  calls: [number, number][] = [];
  override int(n: number): number {
    const v = super.int(n);
    this.calls.push([n, v]);
    return v;
  }
}

// -- class 0x15 --------------------------------------------------------------

/** Stage 2's evt 84156, as the exporter reads it (`class15Tail`). */
const ROW_TAIL = {
  slot: 0x16e0, coli: "coli2.bin:6160", behaviour: 0, cam_path: 114,
  cam_frame: 0, word_0e: 0x16dc, word_10: 0x16df, flag: 8,
  delta: [0, 0, -10] as [number, number, number], count: 30, keep: 6,
  delay_step: 10,
};
/** The spawn record's own position, and the field's (evt 83976). */
const ROW_AT = 84156;
const ROW_POS: [number, number, number] =
  [f32(-1338.17), f32(-23.0007), f32(-1902.56)];
const FIELD_AT = 83976;
const FIELD_Y = f32(-25.5007);

function rowTables(pitch = 0): void {
  SetGameTables({
    ...CHARS,
    placements: [
      { at: FIELD_AT, class: 0x16, char_type: -1, motion: null, hp: 0,
        class16: {} },
      { at: ROW_AT, class: 0x15, char_type: -1, motion: null, hp: 0,
        init_flags: 0x50, pitch, class15: ROW_TAIL },
    ],
  } as unknown as CharactersJson);
}

function planks(): PlankActor[] {
  return G.g_object_list.filter(
    (o): o is PlankActor => o.cls === SpawnClass.FloatingPropRow
      && !o.despawned && o.float15.routine === FloatingPropRoutine.Plank);
}

/** Block 16 step 14: the field at op 0, the row at op 2, one frame. */
function spawnRow(rng: Rng, spawnY = ROW_POS[1]): void {
  SpawnSlotActor({ at: FIELD_AT, class: 0x16, pos: [0, FIELD_Y, 0] });
  SpawnSlotActor({ at: ROW_AT, class: 0x15,
                   pos: [ROW_POS[0], spawnY, ROW_POS[2]] });
  GameUpdate(1 / 60, NULL_HOST, rng);
}

console.log("\nclass 0x15 -- FloatingPropRowSpawn builds the row and dies:");
{
  ResetGameGlobals();
  EnterPlay();
  rowTables();
  // Points kept, strengths cleared: the routine's loop stores only `+0`.
  for (const c of G.g_class14_foot_contacts) {
    c.strength = 75; c.x = 1; c.y = 2; c.z = 3;
  }
  spawnRow(new Rng(15));
  const ps = planks();
  check("thirty planks, `(s8)tail+0x24`, and the placer gone",
        ps.length === 30
        && !G.g_object_list.some((o) => o.at === ROW_AT && !o.despawned),
        `${ps.length} planks`);
  const byIndex = new Map(ps.map((p) => [p.float15.rowIndex, p]));
  const p29 = byIndex.get(29), p6 = byIndex.get(6), p5 = byIndex.get(5);
  check("plank i stands at i * (0, 0, -10) from the record, allocated N-1 first",
        ps[0]?.float15.rowIndex === 29 && ps[29]?.float15.rowIndex === 0
        && p29?.pos.z === f32(29 * -10 + ROW_POS[2])
        && p29?.pos.x === ROW_POS[0],
        `${ps[0]?.float15.rowIndex} z ${p29?.pos.z}`);
  check("delays 0, 10, 20 ... from the first allocated; the last six never",
        p29?.float15.delay === 0 && byIndex.get(28)?.float15.delay === 10
        && p6?.float15.delay === 230 && p5?.float15.delay === -1
        && byIndex.get(0)?.float15.delay === -1,
        `${p29?.float15.delay} ${byIndex.get(28)?.float15.delay} `
        + `${p6?.float15.delay} ${p5?.float15.delay}`);
  check("each copies the record's flags word (0x50 | 1), slot, blob and cues",
        ps.length === 30 && ps.every((p) => p.flags === 0x51 && p.float15.slot === 0x16e0
                 && p.coliBlob === "coli2.bin:6160" && p.float15.flag === 8
                 && p.float15.camPath === 114 && p.float15.camFrame === 0),
        `flags ${p29?.flags} blob ${p29?.coliBlob}`);
  check("the four foot-contact strengths are 0 and their points are not",
        G.g_class14_foot_contacts.every((c) => c.strength === 0 && c.z === 3));
  // The walk reaches every plank on the frame its placer made it.
  const drawn = G.g_world_slot_draws.filter((d) => d.slot === 0x16e0);
  check("...and every plank ran its update that frame: thirty draws of 0x16E0",
        drawn.length === 30, `${drawn.length}`);
  check("...and is in the shot test, by the mesh arm (0x10)",
        ps.length === 30
        && ps.every((p) => G.g_shot_test_list.some((e) => e.at === p.at))
        && ps.every((p) => p.coliMatrix !== null));
}

console.log("\nclass 0x15 -- floating: the mean of four samples, 0x60 a frame:");
{
  ResetGameGlobals();
  EnterPlay();
  // Pitched 0x400 at spawn, and ten units above the water.
  rowTables(0x400);
  spawnRow(new Rng(15), -10);
  const p = planks().find((q) => q.float15.rowIndex === 0);
  check("plank 0 is there to float", !!p);
  if (p) {
  // A flat field: every corner is the plane, and `+ 2.5` in float.
  const mean = f32(f32(FIELD_Y + 2.5) * 0.25 * 4);
  check("the plank is seated on the mean height, the plane + 2.5",
        p.pos.y === mean, `${p.pos.y} vs ${mean}`);
  check("...and turned at most 0x60 toward level on its first frame",
        Math.abs(p.pitch - (0x400 - 0x60)) <= 1 && p.yaw === 0 && p.roll === 0,
        `pitch 0x${p.pitch.toString(16)} yaw ${p.yaw} roll ${p.roll}`);
  GameUpdate(1 / 60, NULL_HOST, new Rng(16));
  check("...and 0x60 again the next",
        Math.abs(p.pitch - (0x400 - 0xc0)) <= 2, `0x${p.pitch.toString(16)}`);
  for (let i = 0; i < 20; i++) GameUpdate(1 / 60, NULL_HOST, new Rng(17));
  check("...until it lies flat", p.pitch === 0, `0x${p.pitch.toString(16)}`);
  // Flat in its own frame, the turn arm does not run, and `obj+0x44` is
  // written only there: the stored height stays where it is put, and the
  // draw is still at the mean.
  p.pos.y = -5;
  GameUpdate(1 / 60, NULL_HOST, new Rng(18));
  const d = G.g_world_slot_draws.find((w) => w.slot === 0x16e0
    && Math.abs(w.m[12] - p.pos.x) < 1e-3 && Math.abs(w.m[14] - p.pos.z) < 1e-3);
  check("level, the stored y is left alone and the draw is at the mean",
        p.pos.y === -5 && d !== undefined && d.m[13] === mean,
        `y ${p.pos.y} draw ${d?.m[13]}`);
  }
}

console.log("\nclass 0x15 -- a foot presses, and the plank swings back:");
{
  ResetGameGlobals();
  EnterPlay();
  rowTables();
  spawnRow(new Rng(15));
  const p = planks().find((q) => q.float15.rowIndex === 3);
  const other = planks().find((q) => q.float15.rowIndex === 10);
  check("planks 3 and 10 are there to press", !!p && !!other);
  if (p && other) {
  const mean = f32(f32(FIELD_Y + 2.5) * 0.25 * 4);
  // A foot two units ahead of plank 3 in z and four to its side.
  const foot = G.g_class14_foot_contacts[0];
  foot.strength = 75; foot.x = p.pos.x + 4; foot.y = mean; foot.z = p.pos.z + 2;
  GameUpdate(1 / 60, NULL_HOST, new Rng(19));
  const sink1 = f32(f32(75 * f32(0.005)) * 0.25);
  check("pressed: the sink eases a quarter of the way to strength * 0.005",
        p.float15.pressed === 1 && p.float15.sink === sink1,
        `pressed ${p.float15.pressed} sink ${p.float15.sink} want ${sink1}`);
  check("...and tips it about the foot's side, a quarter of the first turn",
        p.float15.tiltBams !== 0 && p.float15.tiltAxis.y === 0,
        `tilt ${p.float15.tiltBams}`);
  check("...and a plank ten away is left alone (the window is z +- 5)",
        other.float15.pressed === 0 && other.float15.sink === 0
        && other.float15.tiltBams === 0);
  const draw = G.g_world_slot_draws.find((w) => w.slot === 0x16e0
    && Math.abs(w.m[14] - p.pos.z) < 1e-3);
  check("...drawn sink below the mean",
        draw !== undefined && Math.abs(draw.m[13] - f32(mean - sink1)) < 1e-4,
        `${draw?.m[13]}`);
  const heldTilt = p.float15.tiltBams;
  const heldSink = p.float15.sink;
  foot.strength = 0;
  GameUpdate(1 / 60, NULL_HOST, new Rng(20));
  // Released: amplitude = what it held, phase from 0, stepped 0x400 at once.
  const cs = Math.cos(0x400 * 9.587379924285257e-05);
  check("released, it swings: sink = cos(0x400 BAMS) * the sink it held",
        p.float15.pressed === 0 && p.float15.swingSink === heldSink
        && p.float15.sink === f32(cs * heldSink)
        && p.float15.tiltBams === Math.trunc(heldTilt * cs),
        `sink ${p.float15.sink} tilt ${p.float15.tiltBams}`);
  for (let i = 0; i < 64; i++) GameUpdate(1 / 60, NULL_HOST, new Rng(21));
  check("...and the amplitude is never decayed: cos is never exactly 0.0",
        p.float15.swingSink === heldSink && p.float15.swingBams === heldTilt,
        `${p.float15.swingSink} ${p.float15.swingBams}`);
  }
}

console.log("\nclass 0x15 -- flag 8 takes them a delay apart; cam 114/0 takes all:");
{
  ResetGameGlobals();
  EnterPlay();
  rowTables();
  spawnRow(new Rng(15));
  G.g_script_flags[8] = 1;
  GameUpdate(1 / 60, NULL_HOST, new Rng(22));
  let ps = planks();
  check("the frame the flag is up, plank 29 (delay 0) leaves",
        ps.length === 29 && !ps.some((q) => q.float15.rowIndex === 29),
        `${ps.length}`);
  check("(30 - 29) % 3 == 1: it throws strip kind 1 at 0.7 and shakes 6",
        G.g_prop_strip_effects.length === 1
        && G.g_prop_strip_effects[0].first === 0x16e1
        && G.g_prop_strip_effects[0].last === 0x172f
        && G.g_prop_strip_effects[0].scale === f32(0.7)
        && G.g_prop_strip_effects[0].yaw === CameraBlockYaw(G.g_camera_index)
        && G.g_screen_shake_frames === 6,
        `${G.g_prop_strip_effects.length} shake ${G.g_screen_shake_frames}`);
  for (let i = 0; i < 10; i++) GameUpdate(1 / 60, NULL_HOST, new Rng(23));
  ps = planks();
  check("ten frames later plank 28 goes, with no strip ((30 - 28) % 3 == 2)",
        ps.length === 28 && !ps.some((q) => q.float15.rowIndex === 28),
        `${ps.length}`);
  for (let i = 0; i < 400; i++) GameUpdate(1 / 60, NULL_HOST, new Rng(24));
  ps = planks();
  check("...and the six with no delay stay",
        ps.length === 6 && ps.every((q) => q.float15.rowIndex < 6),
        ps.map((q) => q.float15.rowIndex).join(","));
  const last = ps[0] as PlankActor | undefined;
  G.g_active_cam_path = 114;
  G.g_cam_path_frame = 0;
  GameUpdate(1 / 60, NULL_HOST, new Rng(25));
  check("camera path 114 frame 0 kills the rest, raising 0x80008000",
        !!last && planks().length === 0
        && (last.flags & 0x80008000) === (0x80008000 | 0) && (last.flags & 1) === 0,
        `${planks().length} flags ${((last?.flags ?? 0) >>> 0).toString(16)}`);
}

console.log("\nclass 0x15 -- the exporter reads the tail at the routine's offsets:");
{
  // Every tail byte different, every word negative as an s16: a field read
  // at the wrong offset or width cannot come out right.
  const TAIL = 0x28;
  const buf = new Uint8Array(evt.SPAWN_HEADER + TAIL);
  const v = new DataView(buf.buffer);
  v.setUint32(0, 0x15, true);
  for (let k = 0; k < TAIL; k++) buf[evt.SPAWN_HEADER + k] = 0x80 + k;
  v.setUint32(evt.SPAWN_HEADER + 4, 0xffffffff, true);
  const rec = evt.readSpawn(new evt.EvtFile(buf, "probe"), 0, 0x0c);
  const t = class15Tail(rec, null) as typeof ROW_TAIL;
  const tv = new DataView(buf.buffer, evt.SPAWN_HEADER);
  check("slot +0x00, behaviour +0x08, cam +0x0A/+0x0C, flag +0x12 (s16)",
        t.slot === tv.getInt16(0, true) && t.behaviour === tv.getInt16(8, true)
        && t.cam_path === tv.getInt16(0xa, true)
        && t.cam_frame === tv.getInt16(0xc, true)
        && t.word_0e === tv.getInt16(0xe, true)
        && t.word_10 === tv.getInt16(0x10, true)
        && t.flag === tv.getInt16(0x12, true));
  check("delta +0x18..+0x20 (f32), count +0x24 and keep +0x25 (s8), "
        + "delay step +0x26 (s16), coli -1 is none",
        bits(t.delta[0]) === tv.getUint32(0x18, true)
        && bits(t.delta[2]) === tv.getUint32(0x20, true)
        && t.count === tv.getInt8(0x24) && t.keep === tv.getInt8(0x25)
        && t.delay_step === tv.getInt16(0x26, true) && t.coli === null,
        JSON.stringify(t));
}

// -- class 0x2B --------------------------------------------------------------

function lightTables(): void {
  SetGameTables({
    ...CHARS,
    placements: [27716, 25684, 3900].map((at, hp) => ({
      at, class: 0x2b, char_type: -1, motion: null, hp,
    })),
  } as unknown as CharactersJson);
}

function lightOf(at: number): LightActor | undefined {
  return G.g_object_list.find(
    (o): o is LightActor => o.at === at && o.cls === SpawnClass.DynamicLight
      && !o.despawned);
}

console.log("\nclass 0x2B selector 0 -- stage 2's flickering point light:");
{
  ResetGameGlobals();
  EnterPlay();
  lightTables();
  // Block 11 step 7: evt 0x14 raises the lighting, then the spawn.
  G.g_scene_lighting = 1;
  const rng = new RecordingRng(43);
  SpawnSlotActor({ at: 27716, class: 0x2b, hp: 0 });
  GameUpdate(1 / 60, NULL_HOST, rng);
  const o = lightOf(27716);
  check("the spawn is a class-0x2B object", !!o);
  if (o) {
  const t = o.light2b;
  const e = G.g_entity_lights[t.slot];
  const draws = rng.calls.filter(([n]) => n === 8 || n === 16);
  check("its first frame claims an entry from 3 up and steps 0x1312 to 1",
        !!o && t.slot >= 3 && !!e?.inUse && o.sub === 1, `slot ${t?.slot}`);
  check("...draws rand() % 8 and then rand() % 16, once",
        draws.length === 2 && draws[0][0] === 8 && draws[1][0] === 16,
        JSON.stringify(draws));
  check("...and runs the routine once: the hold is rand() % 16 + 3, less one",
        t.countdown === draws[1][1] + 3 - 1 && t.att2Step === draws[0][1],
        `countdown ${t.countdown} draws ${JSON.stringify(draws)}`);
  check("a point light at the routine's immediates",
        !!e && e.enabled && e.type === RenderLightType.Point
        && bits(e.pos.x) === 0xc4603333 && bits(e.pos.y) === 0x40833333
        && bits(e.pos.z) === 0xc485eccd
        && bits(e.diffuse[0]) === 0x3e4ccccd && bits(e.diffuse[1]) === 0x3f19999a
        && bits(e.diffuse[2]) === 0x41000000 && bits(e.att0) === 0x3dcccccd
        && e.att1 === 0 && e.range === 100,
        JSON.stringify(e));
  check("...whose quadratic term is the draw times float 1e-4 (0x0055E1C4)",
        e?.att2 === f32(t.att2Step * f32(1e-4)), `${e?.att2}`);
  // The hold runs out on the frame the countdown reaches 0.
  const left = t.countdown;
  for (let i = 0; i < left - 1; i++) GameUpdate(1 / 60, NULL_HOST, rng);
  const before = rng.calls.length;
  GameUpdate(1 / 60, NULL_HOST, rng);
  const redrawn = rng.calls.slice(before).filter(([n]) => n === 8 || n === 16);
  check("after the hold, both are drawn again, in the same order",
        redrawn.length === 2 && redrawn[0][0] === 8 && redrawn[1][0] === 16
        && t.countdown === redrawn[1][1] + 3,
        JSON.stringify(redrawn));
  // Lighting off (block 11 step 8): the entry goes out and the hold stands.
  G.g_scene_lighting = 0;
  const hold = t.countdown;
  GameUpdate(1 / 60, NULL_HOST, rng);
  check("with the scene lighting off the entry is disabled and the hold stands",
        !!e && !e.enabled && e.inUse && t.countdown === hold);
  G.g_scene_lighting = 1;
  GameUpdate(1 / 60, NULL_HOST, rng);
  check("...and back on, it is lit again from the same entry",
        !!e && e.enabled && G.g_entity_lights[t.slot] === e);
  // Block 12 step 1: set_script_flag 225.
  const slot = t.slot;
  G.g_script_flags[0xe1] = 1;
  GameUpdate(1 / 60, NULL_HOST, rng);
  check("flag 225 switches it off, gives the entry back, and kills it",
        !lightOf(27716) && !G.g_entity_lights[slot].enabled
        && !G.g_entity_lights[slot].inUse);
  }
}

console.log("\nclass 0x2B selectors 1 and 2 -- the two spots:");
{
  ResetGameGlobals();
  EnterPlay();
  lightTables();
  G.g_scene_lighting = 1;
  G.g_active_cam_path = 0xae;
  G.g_cam_path_frame = 100;
  SpawnSlotActor({ at: 25684, class: 0x2b, hp: 1 });
  SpawnSlotActor({ at: 3900, class: 0x2b, hp: 2 });
  GameUpdate(1 / 60, NULL_HOST, new Rng(44));
  const down = lightOf(25684), tilted = lightOf(3900);
  check("both spawns are class-0x2B objects", !!down && !!tilted);
  if (down && tilted) {
  const ed = G.g_entity_lights[down.light2b.slot];
  const et = G.g_entity_lights[tilted.light2b.slot];
  check("each claims its own entry",
        down.light2b.slot >= 3 && tilted.light2b.slot >= 3
        && down.light2b.slot !== tilted.light2b.slot);
  check("selector 1: a spot at (-125, -25, -670), diffuse 10, att0 0.1, "
        + "range 65536, theta pi/8 (0x3EC90FDB)",
        ed.enabled && ed.type === RenderLightType.Spot
        && ed.pos.x === -125 && ed.pos.y === -25 && ed.pos.z === -670
        && ed.diffuse.every((c) => c === 10) && bits(ed.att0) === 0x3dcccccd
        && ed.att1 === 0 && ed.att2 === 0 && ed.range === 65536
        && bits(ed.theta) === 0x3ec90fdb, JSON.stringify(ed));
  check("...pointing straight down: RotX(0x4000) of +z",
        Math.abs(ed.dir.x) < 1e-6 && Math.abs(ed.dir.y + 1) < 1e-6
        && Math.abs(ed.dir.z) < 1e-4, JSON.stringify(ed.dir));
  // RotZ(0) RotY(y) RotX(x) on (0, 0, 1), row-vector: the third row,
  // (cos x sin y, -sin x, cos x cos y).
  const x = 0x6f00 * Math.PI / 32768, y = 0x400 * Math.PI / 32768;
  const want = [Math.cos(x) * Math.sin(y), -Math.sin(x),
                Math.cos(x) * Math.cos(y)];
  check("selector 2: at (762.2, 2616, -9778.5), diffuse 4, att0 0.5, pi/16, "
        + "aimed RotY(0x400) RotX(0x6F00)",
        et.enabled && et.type === RenderLightType.Spot
        && bits(et.pos.x) === 0x443e8ccd && et.pos.y === 2616
        && et.pos.z === -9778.5 && et.diffuse.every((c) => c === 4)
        && et.att0 === 0.5 && bits(et.theta) === 0x3e490fdb
        && Math.abs(et.dir.x - want[0]) < 1e-5
        && Math.abs(et.dir.y - want[1]) < 1e-5
        && Math.abs(et.dir.z - want[2]) < 1e-5,
        `${JSON.stringify(et.dir)} want ${want}`);
  // Selector 1 stops on camera path 0xAF from frame 0x6E, not before.
  G.g_active_cam_path = 0xaf;
  G.g_cam_path_frame = 0x6d;
  GameUpdate(1 / 60, NULL_HOST, new Rng(45));
  check("selector 1 holds on path 0xAF frame 0x6D", !!lightOf(25684));
  G.g_cam_path_frame = 0x6e;
  const ds = down.light2b.slot;
  GameUpdate(1 / 60, NULL_HOST, new Rng(46));
  check("...and goes at 0x6E, its entry off and given back",
        !lightOf(25684) && !G.g_entity_lights[ds].enabled
        && !G.g_entity_lights[ds].inUse && !!lightOf(3900));
  G.g_active_cam_path = 0xcc;
  G.g_cam_path_frame = 0;
  GameUpdate(1 / 60, NULL_HOST, new Rng(47));
  check("selector 2 goes on path 0xCC from frame 0", !lightOf(3900));
  }
}
