import type { BreakablePlacement } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { AppState, G } from "../../src/game/globals";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
  MatrixTransformPoint,
} from "../../src/game/matrix";
import { SetGameTables } from "../../src/game/tables";
import { GameMode } from "../../src/game/game_mode";
import {
  BreakableFlag, BreakablePropTakeShot, BreakableSlot, ItemSet, PropFamily,
  SLOT_NONE, PlaceGenericProp, GENERIC_POSE_ORDER, GENERIC_SLOT_STRIP,
  PoseOrder, GENERIC_DESCRIPTOR_SLOT, type BreakableProp,
} from "../../src/game/class41";
import { BreakablePropPoolUpdate } from "../../src/game/class41/pool";
import { MsvcRand } from "../../src/game/class41/group";
import {
  Type43ItemSet, TYPE43_PICKUP_SLOT,
} from "../../src/game/class41/type43";
import type { EffectDefJson } from "../../src/bundle";
import { BAMS_TO_RAD_F64 } from "../../src/core/bams";
import { PropWords } from "../../src/game/class41/words";
import {
  TYPE43_FLAG_TAKEN, TYPE43_WORDS_ZERO,
} from "../../src/game/class41/type43";
import {
  SFX_TYPE8_PART_SPLASH, TYPE8_PART_ANGLES, TYPE8_PART_POSITIONS,
} from "../../src/game/class41/type08";
import { SFX_TYPE14_HIT, Type14Phase } from "../../src/game/class41/type14";
import {
  SFX_TYPE19_GIVE_UP, SFX_TYPE19_HIT, SFX_TYPE19_KNOCK, SFX_TYPE19_LINE,
  SFX_TYPE19_OPEN, Type19Phase,
} from "../../src/game/class41/type19";
import { SFX_TYPE25_HIT } from "../../src/game/class41/type25";
import { TYPE45_ROWS } from "../../src/game/class41/type45";
import { TYPE49_HULL } from "../../src/game/class41/type49";
import {
  TYPE67_CARGO_CRACKED_SLOT, TYPE67_CARGO_CRATE_SLOT,
  TYPE67_CARGO_TARGET_SLOT, TYPE67_SLOT, TYPE67_SLOT_INDEX2,
} from "../../src/game/class41/type67";
import {
  PlaceFallingContainer, FALLING_SLOT_WHOLE,
} from "../../src/game/class44";
import { CamPaths } from "../../src/game/camera/curve";
import { SetCameraPaths } from "../../src/game/tables";
import { check, CHARS, BREAKABLES, propScene } from "./harness";

console.log("\nclass 0x41 type 49, the rim that rocks:");
{
  const rng = new Rng(49);
  const events = propScene(rng);
  const snd: number[] = [];
  events.on("sound.play", ({ id }) => { snd.push(id); });
  const near = (a: number, b: number, e = 1e-4) => Math.abs(a - b) <= e;
  G.g_camera_fixed_eye_y = Math.fround(33.17);
  // Stage 2 block 8 step 1's one spawn, descriptor 0x43B4.
  const p = PlaceGenericProp({
    at: 0x43b4, container: "generic", type: 49, slot: 1,
    lifetime_evt_steps: 1, field_1f4: 0,
    pos: [Math.fround(-585.7), Math.fround(33.3), -1225], pitch: 0, yaw: 0,
    roll: 0,
  }, rng);
  G.g_breakable_props.push(p);
  const x0 = p.x, y0 = p.y, z0 = p.z;
  check("type 49's arm sets radius 5.0 and rests it on vertex 0",
        p.hitRadius === 5 && p.contact === 0 && p.restY === y0
        && p.restX === Math.fround(3228 * Math.fround(0.001) + x0)
        && p.restZ === z0,
        `${p.hitRadius} ${p.contact} ${p.restX} ${p.restY} ${p.restZ}`);

  BreakablePropPoolUpdate(rng, events);
  check("...unshot, it stays where the script put it",
        near(p.x, x0) && near(p.y, y0) && near(p.z, z0) && p.contact === 0,
        `${p.x} ${p.y} ${p.z} c${p.contact}`);
  check("...draws the object 0x1D2 then the shadow 0x10D0",
        p.draws?.length === 2 && p.draws[0].slot === 0x1d2
        && p.draws[1].slot === 0x10d0,
        JSON.stringify(p.draws?.map((d) => d.slot)));
  const sh = p.draws![1].m;
  check("...the shadow at the ground plane + 0.1, scaled (10, 1, 10)",
        sh[13] === Math.fround(Math.fround(33.17) + Math.fround(0.1))
        && sh[12] === p.x && sh[14] === p.z
        && sh[0] === 10 && sh[5] === 1 && sh[10] === 10,
        `${sh[12]} ${sh[13]} ${sh[14]} ${sh[0]} ${sh[5]} ${sh[10]}`);
  check("...its shot point is (x, y + 1.0, z)",
        p.shotRegistered && p.shotX === p.x
        && p.shotY === Math.fround(p.y + 1) && p.shotZ === p.z,
        `${p.shotX} ${p.shotY} ${p.shotZ}`);
  check("...no angle moves while unshot",
        p.pitch === 0 && p.yaw === 0 && p.roll === 0 && p.spin === 0);

  // The kick: five draws in the exe's order.
  const before = new Rng(); before.state = rng.state;
  const score0 = G.g_player_score[0] ?? 0;
  const hits0 = G.g_player_hit_count[0] ?? 0;
  BreakablePropTakeShot(p, 0);
  p.hitAim = { x: 1, y: 2 };
  const zHit = p.z;
  const fx49 = G.g_sprite_effects.length;
  BreakablePropPoolUpdate(rng, events);
  const e49 = G.g_sprite_effects[fx49];
  check("...a hit spawns the scaled hit effect at the aim, z from +0x1A4",
        G.g_sprite_effects.length === fx49 + 1 && e49.pos.x === 1
        && e49.pos.y === 2 && e49.pos.z === zHit && e49.scale.x === 1.5,
        JSON.stringify(e49));
  const sx = 1 - before.int(2) * 2;
  const kx = sx * (before.int(0x101) + 0x100);
  const sz = 1 - before.int(2) * 2;
  const kz = sz * (before.int(0x101) + 0x100);
  const ky = before.int(0x201) - 0x300;
  check("...a hit draws exactly five rands", before.state === rng.state);
  const expSpin = kx - ((kx + ((kx >> 31) & 31)) >> 5);
  const expYs = Math.trunc(ky * Math.fround(0.95));
  check("...kicks the pitch spin and springs it the same frame",
        p.spin === expSpin
        && p.pitch === Math.trunc(expSpin * Math.fround(0.99)),
        `${p.spin} vs ${expSpin}, pitch ${p.pitch}`);
  check("...kicks the roll spin",
        p.rollSpin === kz - ((kz + ((kz >> 31) & 31)) >> 5), `${p.rollSpin}`);
  check("...and a negative yaw spin, decayed by 0.95 and added to the yaw",
        p.yawSpin === expYs && p.yaw === expYs && expYs < 0,
        `${p.yawSpin} ${p.yaw}`);
  check("...plays BULLET_WOD1 once", snd.length === 1 && snd[0] === 0x1516a9,
        JSON.stringify(snd));
  check("...pays no score but counts the hit",
        (G.g_player_score[0] ?? 0) === score0
        && (G.g_player_hit_count[0] ?? 0) === hits0 + 1,
        `${G.g_player_score[0]} ${G.g_player_hit_count[0]}`);
  check("...and clears all three hit bits", (p.flags & 0xe) === 0,
        p.flags.toString(16));

  let seated = -1;
  for (let f = 0; f < 60 && seated < 0; f++) {
    BreakablePropPoolUpdate(rng, events);
    if (p.contact !== 0) seated = f;
  }
  check("...a tilt seats it on a new rim vertex, lifted to the floor",
        seated >= 0 && p.restY === G.g_camera_fixed_eye_y,
        `f${seated} c${p.contact} ${p.restY}`);
  const r = MatIdentity();
  MatrixRotateY(r, p.yaw); MatrixRotateZ(r, p.roll); MatrixRotateX(r, p.pitch);
  const h = TYPE49_HULL[p.contact];
  const v = { x: 0, y: 0, z: 0 };
  MatrixTransformPoint(r, { x: h[0] * 0.001, y: 0, z: h[1] * 0.001 }, v);
  check("...and its position puts that vertex on the rest point",
        near(p.x + v.x, p.restX, 1e-3) && near(p.y + v.y, p.restY, 1e-3)
        && near(p.z + v.z, p.restZ, 1e-3),
        `${p.x + v.x}/${p.restX} ${p.y + v.y}/${p.restY}`);
  check("...and the shot point follows the re-seated position",
        p.shotY === Math.fround(p.y + 1) && p.shotX === p.x);
  for (let f = 0; f < 3000; f++) BreakablePropPoolUpdate(rng, events);
  const st = [p.pitch, p.roll, p.spin, p.rollSpin, p.yaw, p.x, p.y, p.z].join();
  BreakablePropPoolUpdate(rng, events);
  // The ftols leave a fixed point short of level: roll -30, spin -1 is one.
  check("...it rings down to a standstill, not quite level",
        [p.pitch, p.roll, p.spin, p.rollSpin, p.yaw, p.x, p.y, p.z].join() === st
        && p.yawSpin === 0 && Math.abs(p.pitch + p.spin) < 32
        && Math.abs(p.roll + p.rollSpin) < 32,
        `${p.pitch} ${p.roll} ${p.yawSpin} ${p.spin} ${p.rollSpin}`);

  G.g_evt_step_index += 1;
  BreakablePropPoolUpdate(rng, events);
  check("...one step change: still here", G.g_breakable_props.includes(p));
  G.g_evt_step_index += 1;
  BreakablePropPoolUpdate(rng, events);
  check("...the second step change despawns it",
        !G.g_breakable_props.includes(p));
}

console.log("\nclass 0x41 type 11, the circler that drops:");
{
  const rng = new Rng(11);
  const events = propScene(rng);
  const snd: number[] = [];
  events.on("sound.play", ({ id }) => { snd.push(id); });
  const near = (a: number, b: number, e = 1e-9) => Math.abs(a - b) <= e;
  G.g_camera_fixed_eye_y = Math.fround(-12.69);
  G.g_frame_counter = 0;
  // Stage 2's one spawn, descriptor 0x11F40 (blocks 23 and 26).
  const p = PlaceGenericProp({
    at: 0x11f40, container: "generic", type: 11, slot: 1,
    lifetime_evt_steps: 1, field_1f4: 2,
    pos: [Math.fround(-545.8), 15, Math.fround(-1310.2)], pitch: 0, yaw: 0,
    roll: 0,
  }, rng);
  G.g_breakable_props.push(p);
  check("type 11's arm sets radius 2.0", p.hitRadius === 2);
  const before = new Rng(); before.state = rng.state;
  BreakablePropPoolUpdate(rng, events);
  const step = before.int(0x501) + 0x900;
  check("...an unshot frame draws exactly one rand", before.state === rng.state);
  check("...circles 0x400 and bobs 0x1000 a frame",
        p.yaw === 0x400 && p.pitch === 0x1000 && p.yawSpin === step,
        `${p.yaw} ${p.pitch} ${p.yawSpin}`);
  const s = Math.sin(step * BAMS_TO_RAD_F64);
  const amp = Math.fround(s * 1.5);
  check("...radius 3 +/- 0.5 and bob 1.5 on the breathing phase",
        p.shake === Math.fround(s * 0.5 + 3) && p.words.o2C4 === amp,
        `${p.shake} ${p.words.o2C4}`);
  const d = p.draws![0];
  const a = 0x400 * BAMS_TO_RAD_F64;
  check("...draws 0x1CF on an even frame counter",
        p.draws!.length === 1 && d.slot === 0x1cf, `${d?.slot}`);
  check("...at the orbit offset",
        d.m[12] === Math.fround(Math.sin(a) * p.shake + p.x)
        && d.m[13] === Math.fround(Math.sin(0x1000 * BAMS_TO_RAD_F64) * amp
                                   + p.y)
        && d.m[14] === Math.fround(Math.cos(a) * p.shake + p.z),
        `${d.m[12]} ${d.m[13]} ${d.m[14]}`);
  const ry = MatIdentity(); MatrixRotateY(ry, -0x400);
  check("...turned by RotY(-yaw)",
        near(d.m[0], ry[0]) && near(d.m[8], ry[8]) && near(d.m[2], ry[2]),
        `${d.m[0]} ${d.m[2]} ${d.m[8]}`);
  check("...and registers its raw origin, not the orbit",
        p.shotRegistered && p.shotX === p.x && p.shotY === p.y
        && p.shotZ === p.z);
  G.g_frame_counter = 7;
  BreakablePropPoolUpdate(rng, events);
  check("...an odd frame counter draws 0x1D0", p.draws![0].slot === 0x1d0);

  const score0 = G.g_player_score[0] ?? 0;
  const yaw0 = p.yaw;
  BreakablePropTakeShot(p, 0);
  const before2 = new Rng(); before2.state = rng.state;
  BreakablePropPoolUpdate(rng, events);
  check("...a hit pays 10 and latches bit 30",
        (G.g_player_score[0] ?? 0) === score0 + 10
        && (p.flags & 0x40000000) !== 0,
        `${G.g_player_score[0]} ${p.flags.toString(16)}`);
  check("...stops the circling that same frame, with no rand",
        p.yaw === yaw0 && before2.state === rng.state);
  check("...and starts the fall that same frame",
        p.vy === Math.fround(-Math.fround(0.02722)) && p.y < 15,
        `${p.vy} ${p.y}`);
  check("...no sound", snd.length === 0, JSON.stringify(snd));
  check("...and the hit bits are never cleared", (p.flags & 0x8) !== 0);
  BreakablePropPoolUpdate(rng, events);
  check("...a second frame with the bit still set pays nothing more",
        (G.g_player_score[0] ?? 0) === score0 + 10);
  // 15 - 0.02722 * n(n+1)/2 < -12.69 first at n = 45; the hit frame was n = 1.
  let n = 2;
  while (p.y > G.g_camera_fixed_eye_y && n < 200) {
    BreakablePropPoolUpdate(rng, events);
    n++;
  }
  check("...it lands on the ground plane on its 45th falling frame",
        n === 45 && p.y === G.g_camera_fixed_eye_y, `n=${n} y=${p.y}`);
  check("...and the sphere is on the floor with it",
        p.shotY === G.g_camera_fixed_eye_y);
  G.g_scene_index = 1;
  G.g_script_flags[0x77] = 1;
  BreakablePropPoolUpdate(rng, events);
  check("...the scene-1 sweep despawns it", !G.g_breakable_props.includes(p));
  G.g_script_flags[0x77] = 0;
}

console.log("\nclass 0x41 type 8, the swaying object and its three parts:");
{
  const rng = new Rng(8);
  const events = propScene(rng);
  const snd: number[] = [];
  events.on("sound.play", ({ id }) => { snd.push(id); });
  const near = (a: number, b: number, e = 1e-4) => Math.abs(a - b) <= e;
  G.g_camera_fixed_eye_y = -9;
  G.g_camera_block_yaw_bams = 0x1234;
  const before = new Rng(); before.state = rng.state;
  // What the bridge must do: the object ahead of whatever its arm appended.
  const n0 = G.g_breakable_props.length;
  // Stage 2 block 9 step 4's first, descriptor 0x539C.
  const p = PlaceGenericProp({
    at: 0x539c, container: "generic", type: 8, slot: 0, lifetime_evt_steps: 0,
    field_1f4: 0, pos: [Math.fround(-147.9), -26.25, -1505], pitch: 0,
    yaw: 18432, roll: 0,
  }, rng);
  G.g_breakable_props.splice(n0, 0, p);
  const ph = MsvcRand(before), s0 = MsvcRand(before), r0 = MsvcRand(before);
  check("type 8's arm draws three rands: sway, pitch and roll phases",
        before.state === rng.state && p.words.o298 === ph && p.spin === s0
        && p.rollSpin === r0, `${p.words.o298} ${p.spin} ${p.rollSpin}`);
  check("...and sets no radius on the object", p.hitRadius === 0);
  const parts = G.g_breakable_props.filter((q) => q !== p);
  check("...three parts (not eight), after the object",
        parts.length === 3 && G.g_breakable_props[0] === p,
        `${G.g_breakable_props.length}`);
  check("...of their own family",
        parts.every((q) => q.family === PropFamily.Type8Piece));
  check("...each with its table position, angles, index, parent, radius, flags",
        parts.every((q, i) => q.words.o194 === TYPE8_PART_POSITIONS[i][0]
          && q.words.o198 === TYPE8_PART_POSITIONS[i][1]
          && q.words.o19C === TYPE8_PART_POSITIONS[i][2]
          && q.words.o1AC === TYPE8_PART_ANGLES[i][0]
          && q.words.o1B0 === TYPE8_PART_ANGLES[i][1]
          && q.words.o1B4 === TYPE8_PART_ANGLES[i][2]
          && q.words.o1B8 === i && q.words.o1BC === p.id
          && q.hitRadius === 2.5 && (q.flags >>> 0) === 0x80000001),
        JSON.stringify(parts.map((q) => q.words)));
  const f32 = (u: number) => new Float32Array(new Uint32Array([u]).buffer)[0];
  check("...the table floats are the image's bits",
        TYPE8_PART_POSITIONS[0][0] === f32(0x4057f972)
        && TYPE8_PART_POSITIONS[2][2] === f32(0xc0ca4674)
        && TYPE8_PART_POSITIONS[1][1] === f32(0x402a809d));

  const before2 = new Rng(); before2.state = rng.state;
  BreakablePropPoolUpdate(rng, events);
  check("...a frame draws no rand", before2.state === rng.state);
  check("...steps the sway 0x180 and both rock phases 0x100",
        p.words.o298 === ph + 0x180 && p.spin === s0 + 0x100
        && p.rollSpin === r0 + 0x100);
  check("...pitch and roll are ftol(sin/cos(phase) * 384)",
        p.pitch === Math.trunc(Math.sin(p.spin * BAMS_TO_RAD_F64) * 384)
        && p.roll === Math.trunc(Math.cos(p.rollSpin * BAMS_TO_RAD_F64) * 384),
        `${p.pitch} ${p.roll}`);
  check("...draws 0x1A36 once, and stores that matrix at +0x2E4",
        p.draws?.length === 1 && p.draws[0].slot === 0x1a36
        && p.drawMatrix.length === 16
        && p.drawMatrix.every((e, i) => e === p.draws![0].m[i]));
  const m = p.drawMatrix;
  const rowLen = (i: number) => Math.hypot(m[i], m[i + 1], m[i + 2]);
  check("...scaled 2.5", near(rowLen(0), 2.5, 1e-6)
        && near(rowLen(4), 2.5, 1e-6) && near(rowLen(8), 2.5, 1e-6));
  const sway = p.words.o298 * BAMS_TO_RAD_F64;
  const dx = Math.fround(Math.sin(sway) * Math.fround(0.15));
  const dz = Math.fround(Math.cos(sway) * Math.fround(0.15));
  const R = MatIdentity();
  MatrixRotateY(R, p.yaw); MatrixRotateZ(R, p.roll); MatrixRotateX(R, p.pitch);
  const o = { x: 0, y: 0, z: 0 };
  MatrixTransformPoint(R, { x: dx, y: 0, z: dz }, o);
  const ro = { x: 0, y: 0, z: 0 };
  MatrixTransformPoint(R, { x: -Math.fround(o.x), y: -Math.fround(o.y),
                            z: -Math.fround(o.z) }, ro);
  check("...at (pos + sway), back by the rocked sway, rocked again",
        near(m[12], Math.fround(dx + p.x) + ro.x)
        && near(m[13], p.y + ro.y) && near(m[14], Math.fround(dz + p.z) + ro.z),
        `${m[12]} ${m[13]} ${m[14]}`);
  check("...the object registers no sphere", !p.shotRegistered);

  const wp = { x: 0, y: 0, z: 0 };
  const okPose = parts.every((q, i) => {
    MatrixTransformPoint(p.drawMatrix, {
      x: TYPE8_PART_POSITIONS[i][0], y: TYPE8_PART_POSITIONS[i][1],
      z: TYPE8_PART_POSITIONS[i][2] }, wp);
    return q.draws?.length === 1 && q.draws[0].slot === 0x1aaa
      && near(q.hitPos.x, wp.x, 1e-3) && near(q.hitPos.y, wp.y, 1e-3)
      && near(q.hitPos.z, wp.z, 1e-3)
      && near(q.draws[0].m[12], q.hitPos.x, 1e-3);
  });
  check("...each part draws 0x1AAA on the object's matrix; +0x40 is its world point",
        okPose, JSON.stringify(parts.map((q) => q.hitPos)));
  check("...and registers there, above the -25 line",
        parts.every((q) => q.shotRegistered && q.shotX === q.hitPos.x
          && q.shotY === q.hitPos.y && q.hitPos.y > -25),
        JSON.stringify(parts.map((q) => q.shotY)));

  const [a, b, c] = parts;
  const score0 = G.g_player_score[0] ?? 0;
  const bY = b.words.o198;
  BreakablePropTakeShot(a, 0);
  a.hitAim = { x: 3, y: 4 };
  const zA = a.hitPos.z;
  const fx8 = G.g_sprite_effects.length;
  BreakablePropPoolUpdate(rng, events);
  const e8 = G.g_sprite_effects[fx8];
  check("...a hit on a part spawns the scaled effect at the aim, z its world +0x48",
        G.g_sprite_effects.length === fx8 + 1 && e8.pos.x === 3
        && e8.pos.y === 4 && e8.pos.z === zA && e8.scale.x === 1.5,
        JSON.stringify(e8));
  check("...pays 10 and plays the crack",
        (G.g_player_score[0] ?? 0) === score0 + 10 && snd.length === 1
        && snd[0] === 0x1d16a9, `${G.g_player_score[0]} ${JSON.stringify(snd)}`);
  check("...clears bit 3 only: the player bit stays",
        (a.flags & 8) === 0 && (a.flags & 2) !== 0, a.flags.toString(16));
  check("...knocks it loose (+0x1B9 = 1) and it falls that frame",
        a.words.o1B9 === 1 && a.words.o1A4 === Math.fround(-Math.fround(0.006805))
        && a.words.o1B4 === -0x200,
        `${a.words.o1B9} ${a.words.o1A4} ${a.words.o1B4}`);
  check("...and the others stay put", b.words.o198 === bY && b.words.o1B9 === 0);
  BreakablePropTakeShot(b, 0);
  BreakablePropPoolUpdate(rng, events);
  BreakablePropTakeShot(b, 0);
  BreakablePropPoolUpdate(rng, events);
  check("...every hit on a part pays again (no latch)",
        (G.g_player_score[0] ?? 0) === score0 + 30, `${G.g_player_score[0]}`);

  let n = 0;
  let lastY = a.hitPos.y;
  while (!a.dead && n < 200) {
    lastY = a.hitPos.y;
    BreakablePropPoolUpdate(rng, events);
    n++;
  }
  const fx = G.g_sprite_effects[G.g_sprite_effects.length - 1];
  check("...part 0 falls below -25.0 and is gone in a splash",
        !G.g_breakable_props.includes(a) && n > 0 && n < 60 && lastY >= -25
        && snd.includes(SFX_TYPE8_PART_SPLASH),
        `n=${n} lastY=${lastY} ${JSON.stringify(snd)}`);
  check("...the splash is 0x8F8..0x903 at scale 8, facing the camera's yaw then",
        fx && fx.slot === 0x8f8 && fx.lastSlot === 0x903 && fx.scale.x === 8
        && fx.yaw === 0x1234 && fx.pos.y < -25 && fx.pos.x === a.hitPos.x,
        JSON.stringify(fx));

  for (let i = 0; i < 11; i++) {
    G.g_evt_step_index += 1;
    BreakablePropPoolUpdate(rng, events);
  }
  check("...eleven step changes: the object and the unfallen part live",
        G.g_breakable_props.includes(p) && G.g_breakable_props.includes(c),
        `${p.stepsElapsed}`);
  G.g_evt_step_index += 1;
  const cPos = JSON.stringify(c.hitPos);
  BreakablePropPoolUpdate(rng, events);
  check("...the twelfth kills the object and despawns the parts, same frame",
        !G.g_breakable_props.includes(p) && !G.g_breakable_props.includes(c)
        && (c.flags & 0x8000) !== 0, `${c.flags.toString(16)}`);
  check("...and a despawned part stops there: no draw, no new position",
        c.draws?.length === 0 && JSON.stringify(c.hitPos) === cPos,
        `${c.draws?.length} ${JSON.stringify(c.hitPos)}`);
}

/**
 * A one-bone effect whose single drawn node sits at `(frame, tag, 0)` on every
 * play frame, so a recorded draw's translation says which cursor and which
 * effect it was drawn at. Per-frame interpolation, one key per play frame.
 */
function g41t9Effect(tag: number, motion: number, playLength: number,
                     slot: number): EffectDefJson {
  const t: number[] = [];
  const r: number[] = [];
  for (let k = 0; k < playLength; k++) { t.push(k, tag, 0); r.push(0, 0, 0); }
  return {
    nodes: [{ slot: 0, bone: 0, children: [1] }, { slot, bone: 1, children: [] }],
    interp: 0, motion, play_length: playLength, frames: playLength, bones: 1,
    t, r, cues: [],
  };
}

/** `propScene`, plus the six effect records these types draw, in a scene. */
function g41t9Scene(rng: Rng, sceneIndex: number):
    { events: Events; sounds: number[] } {
  const events = propScene(rng, GameMode.Arcade);
  SetGameTables(CHARS, { ...BREAKABLES, effects: {
    ...BREAKABLES.effects,
    // The real play lengths: g_motion_play_length[0x1D0/0x1D1/0x1D8/0x1D5/0x1C9].
    "8": g41t9Effect(8, 0x1d0, 80, 0x1577),
    "9": g41t9Effect(9, 0x1d1, 80, 0x1aed),
    "1": g41t9Effect(1, 0x1d8, 110, 0x845),
    "25": g41t9Effect(25, 0x1d8, 110, 0x1609),
    "7": g41t9Effect(7, 0x1d5, 74, 0x10ef),
    "10": g41t9Effect(10, 0x1c9, 100, 0x19e5),
  } });
  G.g_scene_index = sceneIndex;
  G.g_evt_step_index = 1;
  G.g_evt_block_index = 0;
  G.g_script_branch_var = 0;
  const sounds: number[] = [];
  events.on("sound.play", ({ id }) => { sounds.push(id); });
  return { events, sounds };
}

function g41t9Place(pl: Partial<BreakablePlacement>, rng: Rng): BreakableProp {
  const p = PlaceGenericProp(
    { at: 1, container: "generic", ...pl } as BreakablePlacement, rng);
  G.g_breakable_props.push(p);
  return p;
}
function g41t9Run(n: number, rng: Rng, events: Events): void {
  for (let i = 0; i < n; i++) BreakablePropPoolUpdate(rng, events);
}
const g41t9Near = (a: number, b: number, e = 1e-4) => Math.abs(a - b) <= e;
const g41t9Tr = (m: number[]) => [m[12], m[13], m[14]];
const g41t9Live = (p: BreakableProp) =>
  G.g_breakable_props.includes(p) && !p.dead;

console.log("\nclass 0x41 type 9, the church window (PropUpdateType9):");
{
  const near = g41t9Near, tr = g41t9Tr, live = g41t9Live;
  const rng = new Rng(9);
  const { events } = g41t9Scene(rng, 0);
  // Stage 1's one spawn: at the origin, descriptor lifetime 1.
  const p = g41t9Place({ type: 9, slot: 1, lifetime_evt_steps: 1, field_1f4: 0,
                         pos: [0, 0, 0], pitch: 0, yaw: 0, roll: 0 }, rng);
  check("type 9's arm: effect 8 on motion 0x1D0, +0x1A8..0x1B0 = 1.0",
        p.effect === 8 && p.effectVariant === 0x1d0
        && p.restX === 1 && p.restY === 1 && p.restZ === 1);
  g41t9Run(1, rng, events);
  check("type 9 whole: one draw, 0x123B at world (0, 0, -5)",
        p.draws?.length === 1 && p.draws[0].slot === 0x123b
        && tr(p.draws[0].m).join() === "0,0,-5",
        JSON.stringify(p.draws?.map((d) => [d.slot, tr(d.m)])));
  G.g_script_flags[0x1f] = 2;
  g41t9Run(3, rng, events);
  check("type 9: flag 0x1F at 2 is not 1, the cursor stays 0",
        p.effectFrames === 0, `${p.effectFrames}`);
  G.g_script_flags[0x1f] = 1;
  g41t9Run(1, rng, events);
  const d = p.draws ?? [];
  check("type 9's first broken frame: cursor 1, the frame and both trees",
        p.effectFrames === 1 && d.length === 3 && d[0].slot === 0x123c
        && d[1].slot === 0x1577 && d[2].slot === 0x1aed,
        JSON.stringify(d.map((x) => x.slot)));
  check("type 9's frame model at (0, 0, -5)", tr(d[0].m).join() === "0,0,-5");
  const e8 = tr(d[1].m), e9 = tr(d[2].m);
  check("type 9's tree 8 at the shatter offset, key 1",
        near(e8[0], Math.fround(-0.7741) + 1) && near(e8[1], Math.fround(-0.0591) + 8)
        && near(e8[2], -5 + Math.fround(-171.08)), e8.join());
  check("type 9's tree 9 under the same matrix at the same cursor",
        near(e9[0], Math.fround(-0.7741) + 1) && near(e9[1], Math.fround(-0.0591) + 9)
        && near(e9[2], -5 + Math.fround(-171.08)), e9.join());
  check("type 9 leaves 9/0x1D1 in its state block and prev frame 1",
        p.effect === 9 && p.effectVariant === 0x1d1 && p.effectPrevFrame === 1);
  g41t9Run(80, rng, events);
  check("type 9's cursor holds on 0x4E", p.effectFrames === 0x4e,
        `${p.effectFrames}`);
  check("type 9 is not shootable", !p.shotRegistered);
  G.g_scene_index = 1; G.g_script_flags[0x77] = 1;
  g41t9Run(1, rng, events);
  check("type 9 has no scene-1 sweep", live(p));
  G.g_scene_index = 0; G.g_script_flags[0x77] = 0;
  for (let s = 2; s <= 6; s++) { G.g_evt_step_index = s; g41t9Run(1, rng, events); }
  check("type 9 lives through five step changes (its descriptor says 1)",
        live(p), `stepsElapsed ${p.stepsElapsed}`);
  G.g_evt_step_index = 7; g41t9Run(1, rng, events);
  check("type 9 is killed on the sixth", !G.g_breakable_props.includes(p));

  g41t9Scene(rng, 0);
  const q = g41t9Place({ type: 9, slot: 1, lifetime_evt_steps: 1, field_1f4: 0,
                         pos: [100, 20, -300], pitch: 0, yaw: 0x4000, roll: 0 },
                       rng);
  g41t9Run(1, rng, events);
  check("type 9 never reads its own position or pose",
        q.draws?.length === 1 && tr(q.draws[0].m).join() === "0,0,-5"
        && q.draws[0].m[0] === 1);
}

console.log("\nclass 0x41 type 18, the bridge (PropUpdateType18):");
{
  const near = g41t9Near, tr = g41t9Tr, live = g41t9Live;
  const rng = new Rng(18);
  let { events } = g41t9Scene(rng, 1);
  const pos: [number, number, number] = [229.36, 12.8, -2188];
  const spawn = { type: 18, slot: 1, lifetime_evt_steps: 1, field_1f4: 0, pos,
                  pitch: 0, yaw: 0, roll: 0 };
  let p = g41t9Place(spawn, rng);
  check("type 18's arm in scene 1: effect 1 on 0x1D8",
        p.effect === 1 && p.effectVariant === 0x1d8);
  g41t9Run(5, rng, events);
  const t0 = tr(p.draws![0].m);
  check("type 18, flag down: frame 0 of the clip at its position, no step",
        p.effectFrames === 0 && p.draws!.length === 1 && near(t0[0], pos[0])
        && near(t0[1], pos[1] + 1) && near(t0[2], pos[2]), t0.join());
  G.g_evt_step_index = 2; g41t9Run(1, rng, events);
  G.g_evt_step_index = 3; g41t9Run(1, rng, events);
  check("type 18 has no lifetime", live(p));
  G.g_evt_block_index = 0x25;
  G.g_script_flags[0x5f] = 1;
  g41t9Run(1, rng, events);
  check("type 18 draws cursor 0 and then steps to 1 (the draw arm falls through)",
        p.effectFrames === 1 && near(tr(p.draws![0].m)[0], pos[0]));
  g41t9Run(106, rng, events);
  check("type 18 alive having drawn cursor 106",
        live(p) && p.effectFrames === 107
        && near(tr(p.draws![0].m)[0], pos[0] + 106), `${p.effectFrames}`);
  g41t9Run(1, rng, events);
  check("type 18 is killed the frame its cursor reaches 0x6C",
        !G.g_breakable_props.includes(p));
  check("type 18 in block 0x25 leaves flag 0x5F up",
        G.g_script_flags[0x5f] === 1);

  ({ events } = g41t9Scene(rng, 1));
  p = g41t9Place(spawn, rng);
  G.g_evt_block_index = 0x26; G.g_script_flags[0x5f] = 1;
  g41t9Run(108, rng, events);
  check("type 18 outside block 0x25 lowers flag 0x5F as it dies",
        !G.g_breakable_props.includes(p) && G.g_script_flags[0x5f] === 0);

  ({ events } = g41t9Scene(rng, 4));
  p = g41t9Place({ ...spawn, slot: 2, lifetime_evt_steps: 2,
                   pos: [583.4, -81, -5041.5] }, rng);
  check("type 18's arm in scene 4: effect 0x19 on 0x1D8",
        p.effect === 0x19 && p.effectVariant === 0x1d8);
  G.g_script_flags[0x5f] = 1;
  g41t9Run(2, rng, events);
  check("type 18 in scene 4 ignores flag 0x5F", p.effectFrames === 0);
  G.g_script_flags[0x0b] = 2;
  g41t9Run(2, rng, events);
  check("type 18 in scene 4 steps on any non-zero flag 0x0B",
        p.effectFrames === 2);

  ({ events } = g41t9Scene(rng, 3));
  p = g41t9Place({ ...spawn, pos: [0, 0, 0] }, rng);
  G.g_script_flags[0x5f] = 1; G.g_script_flags[0x0b] = 1;
  g41t9Run(3, rng, events);
  check("type 18 in any other scene never steps",
        p.effectFrames === 0 && live(p));
}

console.log("\nclass 0x41 type 27, the piece that bursts (PropKillOnBranchOneUpdate):");
{
  const near = g41t9Near, tr = g41t9Tr, live = g41t9Live;
  const rng = new Rng(27);
  let { events } = g41t9Scene(rng, 1);
  const pos: [number, number, number] = [-591, -13.7, -1261.3];
  const spawn = { type: 27, slot: 4, lifetime_evt_steps: 4, field_1f4: 0, pos,
                  pitch: 0, yaw: 0, roll: 0 };
  // A descriptor yaw the routine must not apply: it turns by obj+0x68.
  let p = g41t9Place({ ...spawn, yaw: 0x4000 }, rng);
  check("type 27's arm: effect 7 on 0x1D5",
        p.effect === 7 && p.effectVariant === 0x1d5);
  g41t9Run(1, rng, events);
  const d0 = p.draws![0];
  check("type 27, flag down: 0x17A9 at its position, unrotated whatever its yaw",
        p.draws!.length === 1 && d0.slot === 0x17a9 && near(d0.m[0], 1)
        && near(d0.m[10], 1) && near(tr(d0.m)[0], pos[0]));
  G.g_script_flags[0x61] = 1;
  g41t9Run(1, rng, events);
  check("type 27, flag up: it steps before it draws (cursor 1 drawn)",
        p.effectFrames === 1 && p.draws!.length === 1
        && p.draws![0].slot === 0x10ef
        && near(tr(p.draws![0].m)[0], pos[0] + 1));
  g41t9Run(100, rng, events);
  check("type 27 holds on play_length - 2 = 72",
        p.effectFrames === 72 && near(tr(p.draws![0].m)[0], pos[0] + 72),
        `${p.effectFrames}`);

  ({ events } = g41t9Scene(rng, 1));
  p = g41t9Place(spawn, rng);
  G.g_script_flags[0x61] = 2;
  g41t9Run(3, rng, events);
  check("type 27 with flag 0x61 at 2: the effect, unstepped",
        p.effectFrames === 0 && p.draws?.[0]?.slot === 0x10ef);
  G.g_script_branch_var = 1;
  g41t9Run(1, rng, events);
  check("type 27 is killed when g_script_branch_var is 1",
        !G.g_breakable_props.includes(p));

  ({ events } = g41t9Scene(rng, 1));
  p = g41t9Place(spawn, rng);
  for (let s = 2; s <= 5; s++) { G.g_evt_step_index = s; g41t9Run(1, rng, events); }
  check("type 27 alive after four step changes", live(p));
  G.g_evt_step_index = 6; g41t9Run(1, rng, events);
  check("type 27 despawned on the fifth", !G.g_breakable_props.includes(p));
  check("type 27 never registers a shot sphere", !p.shotRegistered);

  ({ events } = g41t9Scene(rng, 1));
  p = g41t9Place(spawn, rng);
  G.g_script_flags[0x77] = 1; g41t9Run(1, rng, events);
  check("type 27 is swept by scene 1's flag 0x77",
        !G.g_breakable_props.includes(p));
}

console.log("\nclass 0x41 type 28, the swing (PropUpdateType28):");
{
  const near = g41t9Near, tr = g41t9Tr, live = g41t9Live;
  const rng = new Rng(28);
  let { events, sounds } = g41t9Scene(rng, 1);
  const pos: [number, number, number] = [-633.9, -13.7, -1302];
  const spawn = { type: 28, slot: 3, lifetime_evt_steps: 3, field_1f4: 0, pos,
                  pitch: 0, yaw: 0, roll: 0 };
  let p = g41t9Place(spawn, rng);
  check("type 28's arm: effect 10 on 0x1C9",
        p.effect === 10 && p.effectVariant === 0x1c9);
  g41t9Run(2, rng, events);
  let t = tr(p.draws![0].m);
  check("type 28 at rest: its node 6.5 along -Z from its origin",
        near(t[0], pos[0]) && near(t[1], pos[1] + 10) && near(t[2], pos[2] - 6.5),
        t.join());
  G.g_script_flags[0x60] = 1;
  g41t9Run(31, rng, events);
  check("type 28, 31 frames into the swing: 0x3FF0 and no sound",
        p.words.o64 === 0x3ff0 && sounds.length === 0, `${p.words.o64}`);
  g41t9Run(1, rng, events);
  check("type 28's 32nd frame: clamped to 0x4000, and the break sound",
        p.words.o64 === 0x4000 && sounds.length === 1 && sounds[0] === 0x1a16a9);
  t = tr(p.draws![0].m);
  check("type 28 at the end of the swing: pivot + (0, 6.5, 0) + the node",
        near(t[0], pos[0]) && near(t[1], pos[1] + 6.5, 1e-3)
        && near(t[2], pos[2] + 10, 1e-3), t.join());
  g41t9Run(20, rng, events);
  check("type 28 stays at 0x4000 with one sound",
        p.words.o64 === 0x4000 && sounds.length === 1);
  check("type 28's effect cursor never moves",
        p.effectFrames === 0 && p.effectPrevFrame === 0);
  G.g_script_flags[0x60] = 0; g41t9Run(1, rng, events);
  G.g_script_flags[0x60] = 1; g41t9Run(5, rng, events);
  check("type 28 does not read its flag again once it has moved",
        p.words.o64 === 0x4000 && sounds.length === 1);

  ({ events, sounds } = g41t9Scene(rng, 1));
  p = g41t9Place({ ...spawn, yaw: 0xc000 }, rng);
  g41t9Run(1, rng, events);
  t = tr(p.draws![0].m);
  check("type 28 turns by the descriptor's yaw",
        near(t[0], pos[0] + 6.5, 1e-3) && near(t[1], pos[1] + 10, 1e-3)
        && near(t[2], pos[2], 1e-3), t.join());
  G.g_script_flags[0x60] = 1;
  g41t9Run(32, rng, events);
  t = tr(p.draws![0].m);
  check("type 28: yaw first, then the swing about X",
        near(t[0], pos[0] - 10, 1e-3) && near(t[1], pos[1] + 6.5, 1e-3)
        && near(t[2], pos[2], 1e-3), t.join());
  for (let s = 2; s <= 4; s++) { G.g_evt_step_index = s; g41t9Run(1, rng, events); }
  check("type 28 alive after three step changes", live(p));
  G.g_evt_step_index = 5; g41t9Run(1, rng, events);
  check("type 28 despawned on the fourth", !G.g_breakable_props.includes(p));
}

console.log("\nclass 0x41 type 30, the drop (PropUpdateType30):");
{
  const near = g41t9Near, tr = g41t9Tr, live = g41t9Live;
  const rng = new Rng(30);
  const { events } = g41t9Scene(rng, 1);
  const pos: [number, number, number] = [-495.2, 66.3, -1351.8];
  const p = g41t9Place({ type: 30, slot: 2, lifetime_evt_steps: 2, field_1f4: 0,
                         pos, pitch: 0, yaw: 0x8000, roll: 0 }, rng);
  g41t9Run(3, rng, events);
  const d = p.draws![0];
  check("type 30, flag down: 0x1DF at its position, turned half round",
        p.draws!.length === 1 && d.slot === 0x1df && near(d.m[0], -1)
        && near(tr(d.m)[0], pos[0]) && p.vy === 0);
  const y0 = p.y, z0 = p.z;
  G.g_script_flags[0x67] = 1;
  g41t9Run(1, rng, events);
  check("type 30's first frame: vy -0.02722, y and z moved, pitch -0x100, roll +0x100",
        p.vy === -Math.fround(0.02722)
        && p.y === Math.fround(y0 - Math.fround(0.02722))
        && p.z === Math.fround(z0 + Math.fround(0.8))
        && p.pitch === -0x100 && p.roll === 0x100,
        `${p.vy} ${p.y} ${p.z} ${p.pitch} ${p.roll}`);
  check("type 30 draws after it steps", near(tr(p.draws![0].m)[1], p.y));
  g41t9Run(59, rng, events);
  check("type 30 after 60 frames: y down by 0.02722 * 60 * 61 / 2, z up 48",
        near(p.y, y0 - 0.02722 * 1830, 1e-2) && near(p.z, z0 + 48, 1e-2)
        && p.pitch === -0x100 * 60, `${p.y} ${p.z}`);
  check("type 30 is not shootable", !p.shotRegistered);
  G.g_evt_step_index = 2; g41t9Run(1, rng, events);
  G.g_evt_step_index = 3; g41t9Run(1, rng, events);
  check("type 30 alive after two step changes", live(p));
  G.g_evt_step_index = 4; g41t9Run(1, rng, events);
  check("type 30 despawned on the third", !G.g_breakable_props.includes(p));
}

console.log("\nclass 0x41 type 59, the invisible target (PropUpdateType59):");
{
  const live = g41t9Live;
  const rng = new Rng(59);
  const { events, sounds } = g41t9Scene(rng, 2);
  const pos: [number, number, number] = [-1101.5, 16.2, -3888];
  const p = g41t9Place({ type: 59, slot: 3, lifetime_evt_steps: 3,
                         field_1f4: 30, pos, pitch: 0, yaw: 0, roll: 0 }, rng);
  check("type 59's arm: radius (s16)placer+0x1F4 * 0.1f = 3.0",
        p.hitRadius === 3, `${p.hitRadius}`);
  g41t9Run(1, rng, events);
  check("type 59 draws nothing (an empty list, not the renderer's fallback)",
        Array.isArray(p.draws) && p.draws.length === 0);
  check("type 59 registers its own position",
        p.shotRegistered && p.shotX === pos[0] && p.shotY === p.y
        && p.shotZ === pos[2]);
  const fx0 = G.g_sprite_effects.length;
  p.hitAim = { x: -1100, y: 17 };
  BreakablePropTakeShot(p, 0);
  g41t9Run(1, rng, events);
  check("type 59: a shot plays BULLET_MET1 and spawns the hit effect at 1.0",
        sounds.length === 1 && sounds[0] === 0x0e16a9
        && G.g_sprite_effects.length === fx0 + 1
        && G.g_sprite_effects[fx0].scale.x === 1.5);
  check("type 59 clears the hit and player bits", (p.flags & 0xe) === 0);
  BreakablePropTakeShot(p, 1);
  g41t9Run(1, rng, events);
  check("type 59 rings on every shot (no latch)", sounds.length === 2);
  check("type 59 still registered after a hit", p.shotRegistered);
  G.g_scene_index = 1; G.g_script_flags[0x77] = 1; g41t9Run(1, rng, events);
  check("type 59 has no scene-1 sweep", live(p));
  G.g_script_flags[0x77] = 0;
  for (let s = 2; s <= 4; s++) { G.g_evt_step_index = s; g41t9Run(1, rng, events); }
  check("type 59 alive after three step changes", live(p));
  G.g_evt_step_index = 5; g41t9Run(1, rng, events);
  check("type 59 despawned on the fourth (ActorDespawn's flags)",
        !G.g_breakable_props.includes(p) && (p.flags & 0x8000) !== 0);
}

console.log("\nclass 0x41 types 14, 19 and 25, the enemies standing still:");
{
  // A one-bone effect 10 on motion 0x1C9 with the engine's play length (100,
  // `g_motion_play_length[0x1C9]` at 0x004E0B62), and a hinge curve 0 whose
  // frame f is (10f, 100f, 20f).
  const table = {
    ...BREAKABLES,
    effects: {
      ...BREAKABLES.effects,
      "10": {
        nodes: [
          { slot: 0, bone: 0, children: [1] },
          { slot: 0x1500, bone: 1, children: [] },
        ],
        interp: 1, motion: 0x1c9, play_length: 100, frames: 51, bones: 1,
        t: Array.from({ length: 51 * 3 }, () => 0),
        r: Array.from({ length: 51 * 3 }, () => 0),
        cues: [],
      },
    },
    hinge_curves_xyz: {
      "0": Array.from({ length: 60 }, (_, f) => [f * 10, f * 100, f * 20]),
    },
  };
  const scene = (rng: Rng): Events => {
    propScene(rng, GameMode.Arcade);
    SetGameTables(CHARS, table);
    const events = new Events();
    return events;
  };
  const heard = (events: Events): number[] => {
    const out: number[] = [];
    events.on("sound.play", (d) => out.push(d.id));
    return out;
  };
  const put = (pl: Omit<BreakablePlacement, "container">, rng: Rng) => {
    const p = PlaceGenericProp({ ...pl, container: "generic" }, rng);
    G.g_breakable_props.push(p);
    return p;
  };
  const run = (rng: Rng, events: Events, n = 1): void => {
    for (let i = 0; i < n; i++) BreakablePropPoolUpdate(rng, events);
  };
  const near = (a: number, b: number, e = 1e-4) => Math.abs(a - b) < e;
  // The shipped spawns: stage 2 blocks 5, 7 and 23.
  const SPAWN14 = { at: 7640, type: 14, slot: 0, lifetime_evt_steps: 0,
    field_1f4: 2, pos: [-727.199951171875, 36.25, -1328.5] as [number, number, number],
    pitch: 16384, yaw: 4096, roll: 0 };
  const SPAWN19 = { at: 12664, type: 19, slot: 0, lifetime_evt_steps: 0,
    field_1f4: 0,
    pos: [-568.5399780273438, 33.69999694824219, -1299.2999267578125] as [number, number, number],
    pitch: 0, yaw: 16384, roll: 0 };
  const SPAWN25 = { at: 64204, type: 25, slot: 1, lifetime_evt_steps: 1,
    field_1f4: 0,
    pos: [-565.199951171875, -13.799999237060547, -1282.699951171875] as [number, number, number],
    pitch: 0, yaw: 32768, roll: 0 };

  // -- type 14: PlaceGenericProp case 0x0E and PropUpdateType14 ----------
  {
    const rng = new Rng(3);
    const events = scene(rng);
    const sounds = heard(events);
    G.g_script_branch_var = 5;
    const p = put(SPAWN14, rng);
    check("type 14's arm puts it at y 36.0 whatever the spawn says", p.y === 36,
          String(p.y));
    check("...radius 2.0, +0x199 the placer's +0x1F4 byte",
          p.hitRadius === 2 && p.words.o199 === 2);
    check("...counts it into g_enemies_alive and seeds the route with +0x11C",
          G.g_enemies_alive === 1 && G.g_script_branch_var === 0,
          `${G.g_enemies_alive} ${G.g_script_branch_var}`);
    run(rng, events);
    check("...draws 0x10D2 at its position, scaled 0.4",
          p.draws?.length === 1 && p.draws[0].slot === 0x10d2
          && p.draws[0].m[13] === 36
          && near(Math.hypot(p.draws[0].m[0], p.draws[0].m[1], p.draws[0].m[2]),
                  0.4, 1e-6));
    check("...and registers that position", p.shotRegistered
          && p.shotX === p.x && p.shotY === 36 && p.shotZ === p.z);
    run(rng, events, 0xd1 - 2);
    check("unshot it is still counted in at frame 0xD0", G.g_enemies_alive === 1);
    run(rng, events);
    check("...and counted out on frame 0xD1, latched",
          G.g_enemies_alive === 0 && (p.flags & 0x40000000) !== 0);
    BreakablePropTakeShot(p, 0);
    run(rng, events);
    check("...after which a shot does nothing",
          p.routinePhase === Type14Phase.Standing && G.g_script_branch_var === 0
          && sounds.length === 0);
    while (!p.dead && p.storyItem < 1000) run(rng, events);
    check("...ActorKill on frame 0x1C2, with alive given back once only",
          p.storyItem === 0x1c2 && G.g_enemies_alive === 0,
          `${p.storyItem} ${G.g_enemies_alive}`);
  }
  {
    const rng = new Rng(3);
    const events = scene(rng);
    const sounds = heard(events);
    const p = put(SPAWN14, rng);
    run(rng, events, 10);
    const ref = new Rng(rng.state);
    BreakablePropTakeShot(p, 0);
    run(rng, events);
    check("type 14 shot writes 1 - +0x11C and plays 0x1116A9",
          G.g_script_branch_var === 1 && sounds.join() === String(SFX_TYPE14_HIT));
    check("...tumbling at rand() % 0x81 + 0xC0 a frame, one draw",
          p.spin === ref.int(0x81) + 0xc0 && rng.state === ref.state);
    check("...and is still counted in, and still shootable",
          G.g_enemies_alive === 1 && p.shotRegistered);
    const hitAt = p.storyItem;
    while (p.routinePhase !== Type14Phase.Rest && p.storyItem < 0x1c0) {
      run(rng, events);
    }
    check("...lands on its +1 end -- the -1 end's latch is the frame counter",
          p.words.o290 === 1 && p.cueCursorB === 1);
    check("...pivots to pitch 0x4000 and gives alive back there, once",
          p.pitch === 0x4000 && G.g_enemies_alive === 0
          && p.storyItem - hitAt < 60, `${p.pitch} ${p.storyItem - hitAt}`);
    check("...out of the shot test once landed", !p.shotRegistered);
    check("...drawn about the pivot, 0.96 from it",
          near(Math.hypot(p.x - p.restX, p.y - p.restY, p.z - p.restZ), 0.96,
               1e-3));
    run(rng, events, 0xd2 - p.storyItem);
    check("...and frame 0xD1 does not give back again", G.g_enemies_alive === 0);
    G.g_evt_block_index = 6;
    run(rng, events);
    check("g_evt_block_index 6 kills it", p.dead);
  }

  // -- type 19: PlaceGenericProp case 0x13 and PropUpdateType19 ----------
  {
    const rng = new Rng(5);
    const events = scene(rng);
    const sounds = heard(events);
    G.g_script_branch_var = 5;
    const p = put(SPAWN19, rng);
    check("type 19's arm copies the position to +0x40, seeds the route, "
          + "radius 1.5, slot 0x10D3",
          p.hitPos.x === SPAWN19.pos[0] && p.hitPos.z === SPAWN19.pos[2]
          && G.g_script_branch_var === 0 && p.hitRadius === 1.5
          && p.slot === 0x10d3);
    check("...and counts it into g_enemies_present", G.g_enemies_present === 1);
    run(rng, events);
    check("...draws 0x1CE and then 0x10D3",
          p.draws?.map((d) => d.slot).join() === [0x1ce, 0x10d3].join());
    // RotY(0xC000) carries (-9, 11 - 2, 0.5) to (-0.5, 9, -9).
    check("...registers +0x40 + RotY(0xC000)(-9, 9, 0.5), not its placement",
          near(p.shotX, SPAWN19.pos[0] - 0.5) && near(p.shotY, SPAWN19.pos[1] + 9)
          && near(p.shotZ, SPAWN19.pos[2] - 9),
          `${p.shotX}/${p.shotY}/${p.shotZ}`);
    const knocks: number[] = [];
    let out = -1;
    for (let f = 2; f <= 200; f++) {
      const n = sounds.length;
      run(rng, events);
      if (sounds.slice(n).includes(SFX_TYPE19_KNOCK)) knocks.push(f);
      if (out < 0 && G.g_enemies_present === 0) out = f;
    }
    check("unshot it knocks at frames 30, 83, 126 and 179",
          knocks.join() === "30,83,126,179", knocks.join());
    check("...says its line once, and counts itself out as the fourth ends, "
          + "frame 192", out === 192
          && sounds.filter((s) => s === SFX_TYPE19_LINE).length === 1
          && sounds.filter((s) => s === SFX_TYPE19_GIVE_UP).length === 1,
          String(out));
    check("...retired, so a shot now does nothing",
          p.routinePhase === Type19Phase.Retired && (() => {
            BreakablePropTakeShot(p, 0);
            run(rng, events);
            return G.g_script_branch_var === 0;
          })());
  }
  {
    const rng = new Rng(5);
    const events = scene(rng);
    const sounds = heard(events);
    const p = put(SPAWN19, rng);
    run(rng, events, 50);
    BreakablePropTakeShot(p, 1);
    run(rng, events);
    check("type 19 shot writes 1 - +0x11C, plays 0xF16A9, counts it out",
          G.g_script_branch_var === 1 && G.g_enemies_present === 0
          && sounds.filter((s) => s === SFX_TYPE19_HIT).length === 1);
    const y = p.shotY;
    run(rng, events, 10);
    check("...the part drops away and the shot point does not follow it",
          p.restY < -1 && near(p.shotY, y));
    // Another enemy present: the fourth knock takes it too, which is the
    // engine's own double give-back on this path.
    G.g_enemies_present = 1;
    while (p.routinePhase !== Type19Phase.Retired && p.storyItem < 400) {
      run(rng, events);
    }
    check("...it keeps knocking, and the fourth knock gives back again",
          G.g_enemies_present === 0 && p.removeFlag === 4);
  }
  {
    const rng = new Rng(5);
    const events = scene(rng);
    const sounds = heard(events);
    const p = put(SPAWN19, rng);
    run(rng, events, 5);
    G.g_evt_step_index += 1;
    run(rng, events);
    BreakablePropTakeShot(p, 0);
    run(rng, events);
    check("type 19: a step change retires it unshootable, still counted in",
          p.routinePhase === Type19Phase.Retired && G.g_script_branch_var === 0
          && G.g_enemies_present === 1);
    G.g_script_flags[0x21] = 1;
    run(rng, events, 6);
    check("...flag 0x21 swings it on curve 0: frame 5 on +0x64/+0x68/+0x6C",
          p.routinePhase === Type19Phase.Opening && p.cueCursorB === 6
          && p.words.o64 === 50 && p.words.o68 === 500 && p.words.o6C === 100
          && sounds.filter((s) => s === SFX_TYPE19_OPEN).length === 1);
    run(rng, events, 100);
    check("...for sixty frames", p.cueCursorB === 60 && p.words.o68 === 5900);
    G.g_evt_step_index += 1;
    run(rng, events);
    const second = !p.dead;
    G.g_evt_step_index += 1;
    run(rng, events);
    check("...and the third step change despawns it, not the second",
          second && p.dead);
  }

  // -- type 25: PlaceGenericProp case 0x19 and PropUpdateType25 ----------
  {
    const rng = new Rng(7);
    const events = scene(rng);
    const sounds = heard(events);
    G.g_script_branch_var = 5;
    G.g_evt_block_index = 0x17;
    const p = put(SPAWN25, rng);
    check("type 25's arm seeds 0, radius 12, effect 10 on motion 0x1C9, "
          + "and counts it into g_enemies_present",
          G.g_script_branch_var === 0 && p.hitRadius === 12 && p.effect === 10
          && p.effectVariant === 0x1c9 && G.g_enemies_present === 1);
    run(rng, events);
    check("...draws effect 10, held on frame 0",
          p.draws?.length === 1 && p.draws[0].slot === 0x1500
          && p.effectFrames === 0);
    check("...registered 12 above its origin", p.shotRegistered
          && p.shotY === Math.fround(p.y + 12));
    run(rng, events, 0xfe - 2);
    const before = G.g_enemies_present;
    run(rng, events);
    check("...unshot, counted out on frame 0xFE and latched, still shootable",
          before === 1 && G.g_enemies_present === 0
          && (p.flags & 0x40000000) !== 0 && p.shotRegistered);
    BreakablePropTakeShot(p, 0);
    run(rng, events);
    check("...after which a shot pays nothing",
          G.g_script_branch_var === 0 && sounds.length === 0);
  }
  {
    const rng = new Rng(7);
    const events = scene(rng);
    const sounds = heard(events);
    G.g_evt_block_index = 0x16;
    const p = put(SPAWN25, rng);
    run(rng, events, 3);
    BreakablePropTakeShot(p, 0);
    run(rng, events);
    check("type 25 shot outside block 0x17 does nothing",
          G.g_script_branch_var === 0 && G.g_enemies_present === 1
          && sounds.length === 0);
    G.g_evt_block_index = 0x17;
    run(rng, events);
    check("...in block 0x17 writes 1, plays 0x2F16A9, counts it out",
          G.g_script_branch_var === 1 && sounds.join() === String(SFX_TYPE25_HIT)
          && G.g_enemies_present === 0);
    check("...sets 0x44000000 and leaves the shot test, the clip starting",
          (p.flags & 0x44000000) === 0x44000000 && !p.shotRegistered
          && p.effectFrames === 1);
    const drawn: number[] = [];
    for (let i = 0; i < 140; i++) {
      run(rng, events);
      drawn.push(p.draws?.length ?? 0);
    }
    check("...plays to play_length - 2, then blinks on even counts to 29",
          p.effectFrames === 98 && drawn.slice(0, 97).every((n) => n === 1)
          && drawn.slice(97, 129).join("") === "01".repeat(14) + "0000",
          drawn.slice(97, 129).join(""));
  }
  {
    const rng = new Rng(7);
    const events = scene(rng);
    G.g_evt_block_index = 0x17;
    const p = put(SPAWN25, rng);
    run(rng, events, 174);
    G.g_evt_step_index += 1;
    run(rng, events);
    const first = !p.dead;
    G.g_evt_step_index += 1;
    run(rng, events);
    // The shipped unshot path: block 23 waits on alive, not present, and the
    // second step change comes at about frame 176 of 254.
    check("type 25 unshot dies on its second step change still counted in "
          + "-- the engine's own leak", first && p.dead
          && G.g_enemies_present === 1, String(G.g_enemies_present));
  }
}

console.log("\nclass 0x41 type 64, stage 2's rocker:");
{
  const rng = new Rng(64);
  const events = propScene(rng);
  const tr = (p: BreakableProp, k: number) =>
    [p.draws![k].m[12], p.draws![k].m[13], p.draws![k].m[14]];
  const near = (a: number, b: number, e = 1e-4) => Math.abs(a - b) <= e;
  G.g_scene_index = 1;
  const p = PlaceGenericProp({
    at: 0xbe88, container: "generic", type: 64, slot: 4,
    lifetime_evt_steps: 4, field_1f4: 0, pos: [-671, 38.5, -1498],
    pitch: 0, yaw: 0, roll: 0,
  }, rng);
  G.g_breakable_props.push(p);
  check("type 64's arm: roll 0x400, rate -32, acceleration -2",
        p.roll === 0x400 && p.storyItem === -32 && p.removeFlag === -2,
        `${p.roll} ${p.storyItem} ${p.removeFlag}`);
  BreakablePropPoolUpdate(rng, events);
  check("...the roll takes the rate the frame started with",
        p.roll === 0x400 - 32 && p.storyItem === -34,
        `${p.roll} ${p.storyItem}`);
  check("...draws 0x1A39 at the spawn, scaled 0.7",
        p.draws?.length === 2 && p.draws[0].slot === 0x1a39
        && near(tr(p, 0)[0], -671) && near(tr(p, 0)[1], 38.5)
        && near(tr(p, 0)[2], -1498)
        && p.draws[0].m[0] === Math.fround(0.7), String(tr(p, 0)));
  check("...and 0x0C27 18 up the scaled body, rolled by +0x1D4",
        p.draws![1].slot === 0x0c27
        && near(tr(p, 1)[1], 38.5 + 18 * Math.fround(0.7))
        && near(p.draws![1].m[1],
                0.7 * Math.sin((0x400 - 32) * Math.PI * 2 / 65536), 1e-5),
        String(tr(p, 1)));
  for (let i = 1; i < 15; i++) BreakablePropPoolUpdate(rng, events);
  check("...15 frames: the rate is at -62 and has not flipped",
        p.storyItem === -62 && p.removeFlag === -2,
        `${p.storyItem} ${p.removeFlag}`);
  BreakablePropPoolUpdate(rng, events);
  check("...frame 16 starts past 60, so the acceleration flips",
        p.storyItem === -60 && p.removeFlag === 2,
        `${p.storyItem} ${p.removeFlag}`);
  let lo = 0, hi = 0;
  for (let i = 0; i < 248; i++) {
    BreakablePropPoolUpdate(rng, events);
    lo = Math.min(lo, p.storyItem); hi = Math.max(hi, p.storyItem);
  }
  check("...the rate swings between -62 and +62", lo === -62 && hi === 62,
        `${lo} ${hi}`);
  check("...and nothing registers a sphere", !p.shotRegistered);
  G.g_script_flags[0x77] = 1;
  BreakablePropPoolUpdate(rng, events);
  check("...it opens with PropExpireByStepLifetime: the scene-1 sweep",
        p.dead && !G.g_breakable_props.includes(p));
}

console.log("\nclass 0x41 type 57, stage 1's shudder:");
{
  const rng = new Rng(57);
  const events = propScene(rng);
  const heard: number[] = [];
  events.on("sound.play", (e) => heard.push(e.id));
  const tr = (p: BreakableProp, k: number) =>
    [p.draws![k].m[12], p.draws![k].m[13], p.draws![k].m[14]];
  const f32 = Math.fround;
  const p = PlaceGenericProp({
    at: 0x3b3c, container: "generic", type: 57, slot: 4,
    lifetime_evt_steps: 4, field_1f4: 0, pos: [0, 0, 0],
    pitch: 0, yaw: 0, roll: 0,
  }, rng);
  G.g_breakable_props.push(p);
  check("type 57's arm: radius 5.0", p.hitRadius === 5);
  const s0 = rng.state;
  BreakablePropPoolUpdate(rng, events);
  check("...at rest it draws no rand()", rng.state === s0);
  check("...0xD43 at its world literal, 0xD44 5.68 above it",
        p.draws?.length === 2 && p.draws[0].slot === 0xd43
        && p.draws[1].slot === 0xd44
        && tr(p, 0)[0] === f32(-697.042) && tr(p, 0)[1] === f32(-12.701)
        && tr(p, 0)[2] === f32(-529.244)
        && Math.abs(tr(p, 1)[1] - tr(p, 0)[1] - f32(5.68)) < 1e-5,
        `${tr(p, 0)} ${tr(p, 1)}`);
  check("...registered every frame at the literal, not its position",
        p.shotRegistered && p.shotX === f32(-697.042)
        && p.shotY === f32(-9.861) && p.shotZ === f32(-529.244));
  for (let s = 1; s <= 10; s++) {
    G.g_evt_step_index = s;
    BreakablePropPoolUpdate(rng, events);
  }
  check("...it has no lifetime at all", !p.dead);

  BreakablePropTakeShot(p, 0);
  p.hitAim = { x: 1, y: 2 };
  const ref = new Rng(0);
  ref.state = rng.state;
  const nsprites = G.g_sprite_effects.length;
  BreakablePropPoolUpdate(rng, events);
  check("...a hit plays BULLET_WOD1 and clears every hit bit",
        heard.length === 1 && heard[0] === 0x1516a9 && (p.flags & 0xe) === 0,
        String(heard));
  check("...the spark takes obj+0x1A4 before the hit writes it",
        G.g_sprite_effects.length === nsprites + 1
        && G.g_sprite_effects[nsprites].pos.z === 0
        && p.z === f32(-529.244));
  const j = () => f32((ref.int(101) - 50) * 1.0 * f32(0.01));
  const ja = j(), jb = j(), jc = j(), jd = j();
  check("...the hit frame jitters: four draws, a b c d",
        rng.state === ref.state
        && tr(p, 0)[0] === f32(ja - 697.042) && tr(p, 0)[2] === f32(jb - 529.244),
        String(tr(p, 0)));
  const h0 = tr(p, 0), h1 = tr(p, 1);
  check("...the upper part jitters by (c - a, d - b) in the lower's frame",
        Math.abs(Math.hypot(h1[0] - h0[0], h1[1] - h0[1], h1[2] - h0[2])
                 - Math.hypot(f32(jc - ja), f32(5.68), f32(jd - jb))) < 1e-4);
  check("...no score, no hit counted",
        (G.g_player_hit_count[0] ?? 0) === 0 && (G.g_player_score[0] ?? 0) === 0);
  let frames = 1;
  for (let i = 0; i < 40; i++) {
    const before = rng.state;
    BreakablePropPoolUpdate(rng, events);
    if (rng.state !== before) frames++;
  }
  check("...the shudder runs 29 frames, decaying by 0.85",
        frames === 29 && tr(p, 0)[0] === f32(-697.042), String(frames));
  G.g_active_cam_path = 0x2f;
  G.g_cam_path_frame = 0x95;
  BreakablePropPoolUpdate(rng, events);
  check("...camera path 0x2F frame 0x95: still there", !p.dead);
  G.g_cam_path_frame = 0x96;
  BreakablePropPoolUpdate(rng, events);
  check("...frame 0x96: ActorDespawn, and no sphere",
        p.dead && ((p.flags & 0x80018000) >>> 0) === 0x80018000
        && !p.shotRegistered);
}

console.log("\nclass 0x41 type 36, stage 3's three flickers:");
{
  const rng = new Rng(36);
  const events = propScene(rng);
  const tr = (p: BreakableProp, k: number) =>
    [p.draws![k].m[12], p.draws![k].m[13], p.draws![k].m[14]];
  const f32 = Math.fround;
  G.g_scene_index = 2;
  G.g_evt_step_index = 1;
  const ref = new Rng(0);
  ref.state = rng.state;
  const p = PlaceGenericProp({
    at: 0x0cfc, container: "generic", type: 36, slot: 1,
    lifetime_evt_steps: 1, field_1f4: 0, pos: [0, 0, 0],
    pitch: 0, yaw: 0, roll: 0,
  }, rng);
  G.g_breakable_props.push(p);
  const seed = [0, 1, 2].map(() => ({
    x: ref.int(9), y: ref.int(11), h: f32(ref.int(41) * f32(0.01) + f32(0.8)),
  }));
  check("type 36's arm: nine draws, x then y then height, per part",
        rng.state === ref.state && p.words.o22c === seed[0].x
        && p.words.o230 === seed[0].y && p.shake === seed[0].h
        && p.words.o244 === seed[2].x && p.words.o2c8 === seed[2].h);
  check("...and no timer: all three start at 0",
        p.storyItem === 0 && p.removeFlag === 0 && p.cueCursorB === 0);
  G.g_scene_tick_counter = 30;
  BreakablePropPoolUpdate(rng, events);
  check("...frame 1: all three show strip frame tick % 24",
        p.draws?.length === 3 && p.draws.every((d) => d.slot === 0x161b + 6));
  check("...at (x - 995, y - 12, -2970.7), scaled (0.2, h * 0.2, 0.2)",
        tr(p, 0)[0] === seed[0].x - 995 && tr(p, 0)[1] === seed[0].y - 12
        && tr(p, 0)[2] === f32(-2970.7) && p.draws![0].m[0] === f32(0.2)
        && p.draws![0].m[5] === f32(seed[0].h * f32(0.2)), String(tr(p, 0)));
  let clean = true;
  for (let i = 2; i <= 11; i++) {
    const s = rng.state;
    BreakablePropPoolUpdate(rng, events);
    clean &&= rng.state === s && p.draws?.length === 3;
  }
  check("...frames 2..11 draw and draw no rand()", clean);
  const r2 = new Rng(0);
  r2.state = rng.state;
  BreakablePropPoolUpdate(rng, events);
  const re = [0, 1, 2].map(() => ({
    w: r2.int(31), x: r2.int(7), y: r2.int(5),
    h: f32(r2.int(41) * f32(0.01) + f32(0.8)),
  }));
  check("...frame 12 (timer -12) draws at the old spot and reseeds from "
        + "% 31, % 7, % 5", rng.state === r2.state && p.draws?.length === 3
        && tr(p, 0)[0] === seed[0].x - 995 && p.storyItem === re[0].w
        && p.words.o22c === re[0].x && p.words.o230 === re[0].y
        && p.cueCursorB === re[2].w, JSON.stringify(re));
  BreakablePropPoolUpdate(rng, events);
  check("...frame 13: only the parts whose new wait is up",
        p.draws?.length === re.filter((q) => q.w - 1 <= 0).length);
  G.g_scene_index = 1;
  G.g_script_flags[0x77] = 1;
  BreakablePropPoolUpdate(rng, events);
  check("...its inline lifetime has no scene-1 sweep", !p.dead);
  G.g_evt_step_index = 2;
  BreakablePropPoolUpdate(rng, events);
  G.g_evt_step_index = 3;
  BreakablePropPoolUpdate(rng, events);
  check("...and ActorKill on the second step change", p.dead
        && (p.flags & 0x8000) === 0 && !p.shotRegistered);
}

console.log("\nclass 0x41 type 62, stage 6's eight waters:");
{
  const rng = new Rng(62);
  const events = propScene(rng);
  const near = (a: number, b: number, e = 1e-4) => Math.abs(a - b) <= e;
  // Effect 0x1C on motion 0x1C6, shaped like the real one: a root and six
  // water pieces, one key a frame, a 100-frame clip standing at the origin.
  SetGameTables(CHARS, { ...BREAKABLES, effects: {
    ...BREAKABLES.effects,
    "28": {
      nodes: [
        { slot: 0, bone: 0, children: [1, 2, 3, 4, 5, 6] },
        ...Array.from({ length: 6 }, (_, i) => (
          { slot: 0xcd - i, bone: i + 1, children: [] as number[] })),
      ],
      interp: 0, motion: 0x1c6, play_length: 100, frames: 100, bones: 6,
      t: Array.from({ length: 100 * 6 * 3 }, () => 0),
      r: Array.from({ length: 100 * 6 * 3 }, () => 0),
      cues: [],
    },
  } });
  const ref = new Rng(0);
  ref.state = rng.state;
  const p = PlaceGenericProp({
    at: 0x2080, container: "generic", type: 62, slot: 1,
    lifetime_evt_steps: 1, field_1f4: 0, pos: [0, 0, 0],
    pitch: 0, yaw: 0, roll: 0,
  }, rng);
  G.g_breakable_props.push(p);
  let last = 0;
  for (let k = 0; k < 8; k++) last = ref.int(100);
  check("type 62's arm: eight rand() into +0x2A0, the last one kept",
        rng.state === ref.state && p.storyItem === last
        && p.removeFlag === 0 && (p.words.o2bc ?? 0) === 0);
  check("...effect 0x1C on motion 0x1C6",
        p.effect === 0x1c && p.effectVariant === 0x1c6);
  p.storyItem = 40;
  G.g_camera_block_eye = { x: 79, y: 2510, z: -9505 };
  BreakablePropPoolUpdate(rng, events);
  const at = (c: number) =>
    [p.draws![c * 6].m[12], p.draws![c * 6].m[13], p.draws![c * 6].m[14]];
  check("...eight copies of the six-piece effect", p.draws?.length === 48,
        String(p.draws?.length));
  check("...each copy steps its own cursor; the block keeps copy 7's",
        p.storyItem === 41 && p.words.o2bc === 1 && p.effectFrames === 1);
  check("...two rows of four at y 2510",
        near(at(0)[0], 79) && near(at(3)[0], 151) && near(at(0)[2], -9605)
        && near(at(4)[0], 65) && near(at(7)[0], 137) && near(at(7)[2], -9568)
        && near(at(0)[1], 2510), `${at(3)} ${at(7)}`);
  check("...facing the eye from behind: yaw atan2 + 0x8000, scale 0.3",
        near(p.draws![0].m[0], Math.fround(0.3), 1e-6)
        && near(p.draws![0].m[2], 0, 1e-6));
  G.g_camera_block_eye = { x: 179, y: 2510, z: -9605 };
  BreakablePropPoolUpdate(rng, events);
  check("...and turning a quarter as the eye moves round",
        near(p.draws![0].m[0], 0, 1e-5)
        && near(Math.abs(p.draws![0].m[2]), Math.fround(0.3), 1e-5));
  p.storyItem = 99;
  BreakablePropPoolUpdate(rng, events);
  check("...a cursor may read 100", p.storyItem === 100);
  BreakablePropPoolUpdate(rng, events);
  check("...and past 100 goes to 0", p.storyItem === 0);
  check("...nothing registers a sphere", !p.shotRegistered);
  G.g_script_flags[0] = 1;
  BreakablePropPoolUpdate(rng, events);
  check("...g_script_flags[0] == 1: ActorKill", p.dead);
}

console.log("\nclass 0x41 type 45, stage 1's banners:");
{
  const rng = new Rng(45);
  const events = propScene(rng);
  const tr = (p: BreakableProp, k: number) =>
    [p.draws![k].m[12], p.draws![k].m[13], p.draws![k].m[14]];
  G.g_evt_step_index = 1;
  G.g_evt_block_index = 3;
  const s0 = rng.state;
  const p = PlaceGenericProp({
    at: 0x2d74, container: "generic", type: 45, slot: 7,
    lifetime_evt_steps: 7, field_1f4: 0, pos: [0, 0, 0],
    pitch: 0, yaw: 0, roll: 0,
  }, rng);
  G.g_breakable_props.push(p);
  check("type 45 has no arm: the generator is untouched", rng.state === s0);
  BreakablePropPoolUpdate(rng, events);
  check("...the second line and the two posts: eight draws, in table order",
        JSON.stringify(p.draws?.map((d) => d.slot)) === JSON.stringify(
          [0x1732, 0x1731, 0x1733, 0x1734, 0x1731, 0x1732, 0x1735, 0x1735]));
  check("...row 5 at its literal, 65 up, facing 0x3C4D",
        tr(p, 0)[0] === TYPE45_ROWS[5][0] && tr(p, 0)[1] === 65
        && tr(p, 0)[2] === TYPE45_ROWS[5][1]
        && Math.abs(p.draws![0].m[0]
                    - Math.cos(0x3c4d * Math.PI * 2 / 65536)) < 1e-6);
  check("...the wave's clock, +0x1D0, steps 0x800 a frame", p.yaw === 0x800);
  // The models' state, which the renderer walks: model k bent at the frame's
  // start plus 0x200 k, and drawn -- before the walk -- as authored.
  check("...model k is bent at the frame's start + 0x200 k",
        JSON.stringify(G.g_prop45_wave_clock) === "[0,512,1024,1536]",
        JSON.stringify(G.g_prop45_wave_clock));
  check("...and this frame's draws went out against the models as authored",
        JSON.stringify(G.g_prop45_wave_clock_drawn) === "[-1,-1,-1,-1]",
        JSON.stringify(G.g_prop45_wave_clock_drawn));
  G.g_active_cam_path = 0x2a;
  G.g_cam_path_frame = 499;
  BreakablePropPoolUpdate(rng, events);
  check("...camera path 0x2A frame 499: the first line is still down",
        p.draws?.length === 8);
  check("...the next frame's draws show the last frame's bend, and the "
        + "models step 0x800",
        JSON.stringify(G.g_prop45_wave_clock_drawn) === "[0,512,1024,1536]"
        && JSON.stringify(G.g_prop45_wave_clock)
           === "[2048,2560,3072,3584]",
        JSON.stringify([G.g_prop45_wave_clock_drawn, G.g_prop45_wave_clock]));
  G.g_cam_path_frame = 500;
  BreakablePropPoolUpdate(rng, events);
  check("...frame 500 raises it: thirteen draws, row 0 first, facing 0x145E",
        p.storyItem === 1 && p.draws?.length === 13
        && p.draws[0].slot === 0x1731 && tr(p, 0)[0] === TYPE45_ROWS[0][0]
        && Math.abs(p.draws[0].m[0]
                    - Math.cos(0x145e * Math.PI * 2 / 65536)) < 1e-6);
  check("...not shootable", !p.shotRegistered);
  for (let s = 2; s <= 8; s++) {
    G.g_evt_step_index = s;
    BreakablePropPoolUpdate(rng, events);
  }
  check("...a seven-step life survives seven step changes", !p.dead);
  G.g_evt_block_index = 0xe;
  BreakablePropPoolUpdate(rng, events);
  check("...block 0xE: ActorKill", p.dead && (p.flags & 0x8000) === 0);
  const bent = JSON.stringify(G.g_prop45_wave_clock);
  BreakablePropPoolUpdate(rng, events);
  check("...and the models keep the bend they had when it went",
        JSON.stringify(G.g_prop45_wave_clock) === bent
        && G.g_prop45_wave_clock[0] !== -1, bent);
}

console.log("\nclass 0x41 types 41, 56, 69 and 73, transcribed whole:");
{
  const near = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) <= eps;
  const tr = (m: number[]) => [m[12], m[13], m[14]];
  const BAMS = Math.PI * 2 / 65536;
  // A synthetic hinge curve 0: frame i is (i, 100 i, -i), so any frame the
  // routine reads is identifiable. The real one is `.rdata` at 0x00595B00.
  const CURVE0 = Array.from({ length: 60 }, (_, i) => [i, 100 * i, -i]);
  const withCurve = (): void => {
    SetGameTables(CHARS, { ...BREAKABLES, hinge_curves_xyz: { "0": CURVE0 } });
  };
  // Object path 0x179 (377): flat-tangent keys at 0 and 105.
  const key2 = (a: number, b: number) => [[0, a, 0, 0], [105, b, 0, 0]];
  const withPath = (): void => {
    SetCameraPaths(new CamPaths({ fps: 60, paths: {}, object_paths: {
      "377": { file: "op_st4", index: 6, start: 0, duration: 105, channels: {
        pos_x: key2(-326.7, -394.5623), pos_y: key2(32.8, 28.165),
        pos_z: key2(-803, -798.7787), rot_x: key2(0, 12475.83),
        rot_y: key2(0, 2408.98), rot_z: key2(0, 15430.44),
      } },
    } } as never));
  };
  const place = (rng: Rng, type: number, pos: [number, number, number],
                 lifetime: number, yaw = 0, pitch = 0, roll = 0) => {
    const p = PlaceGenericProp({ at: 0x5000 + type, container: "generic",
                                 type, slot: lifetime,
                                 lifetime_evt_steps: lifetime, field_1f4: 0,
                                 pos, pitch, yaw, roll }, rng);
    G.g_breakable_props.push(p);
    return p;
  };
  const listen = (events: Events) => {
    const out: number[] = [];
    events.on("sound.play", (e) => out.push(e.id));
    return out;
  };

  // -- type 56: stage 4 block 9. The flag swings it and opens the route; the
  //    shot knocks a part off.
  {
    const rng = new Rng(56);
    const events = propScene(rng);
    withCurve();
    const snd = listen(events);
    G.g_evt_block_index = 9;
    const POS: [number, number, number] = [-196.5, -76.5, -282.29998779296875];
    const p = place(rng, 56, POS, 2, 0x1234, 0x40, 0x80);
    check("type 56's arm: base point, radius 1.5, slot 0x10D3, +0x68 = yaw",
          p.hitPos.x === POS[0] && p.hitPos.z === POS[2] && p.hitRadius === 1.5
          && p.slot === 0x10d3 && p.words.o68 === 0x1234);
    BreakablePropPoolUpdate(rng, events);
    const d = p.draws ?? [];
    check("...draws the body 0x1866 at the base and the part 0x10D3 off it",
          d.length === 2 && d[0].slot === 0x1866 && d[1].slot === 0x10d3
          && tr(d[0].m).every((v, i) => near(v, POS[i]))
          && near(d[1].m[12], POS[0] + 4.8) && near(d[1].m[13], POS[1] - 0.55)
          && near(d[1].m[14], POS[2] - 10.5),
          JSON.stringify(d.map((x) => [x.slot, tr(x.m)])));
    const a = (0x6b00 + 0x1234) * BAMS;
    check("...the body turned RotY(0x6B00) then by +0x68",
          d.length > 0 && near(d[0].m[0], Math.cos(a)), String(d[0]?.m[0]));
    check("...the part scaled 1.1",
          d.length > 1 && near(Math.hypot(d[1].m[0], d[1].m[1], d[1].m[2]), 1.1));
    check("...and the sphere is the part's start, written over x/y/z",
          p.shotRegistered && near(p.shotY, POS[1] - 0.55) && p.y === p.shotY);

    G.g_script_flags[5] = 1;
    BreakablePropPoolUpdate(rng, events);
    check("flag 5 opens the route in block 9 and plays 0x2116A9",
          G.g_script_branch_var === 2 && snd.join() === String(0x2116a9)
          && p.routinePhase === 1, `${G.g_script_branch_var} ${snd}`);
    check("...and the hinge's frame 0 lands the same frame (+0x68 := y alone)",
          p.cueCursorB === 1 && p.words.o68 === 0 && p.words.o64 === 0x40
          && p.words.o6C === 0x80, JSON.stringify(p.words));
    for (let i = 0; i < 70; i++) BreakablePropPoolUpdate(rng, events);
    check("...sixty frames of it, ending on frame 59",
          p.cueCursorB === 60 && p.words.o68 === 5900
          && p.words.o64 === 59 + 0x40 && p.words.o6C === -59 + 0x80,
          `${p.cueCursorB} ${JSON.stringify(p.words)}`);
    check("...and the latch fires once", snd.length === 1);

    const score = G.g_player_score[0], hits = G.g_player_hit_count[0];
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng, events);
    check("the shot raises flag 0x0E, plays 0xF16A9, pays no points",
          G.g_script_flags[0x0e] === 1 && snd[1] === 0xf16a9
          && G.g_player_score[0] === score
          && G.g_player_hit_count[0] === hits + 1, `${snd}`);
    check("...re-zeroes the hinge cursor (the swing replays)",
          p.cueCursorB === 1 && p.words.o68 === 0, String(p.cueCursorB));
    const g = Math.fround(0.02722);
    check("...and the part falls from that frame, the sphere staying put",
          p.vy === Math.fround(-g) && p.restY === Math.fround(-g)
          && near(p.shotY, POS[1] - 0.55), `${p.vy} ${p.restY}`);
    BreakablePropPoolUpdate(rng, events);
    check("...no second hit arm, and the hit bit is never cleared",
          snd.length === 2 && (p.flags & 8) !== 0);

    G.g_scene_index = 1; G.g_script_flags[0x77] = 1;
    BreakablePropPoolUpdate(rng, events);
    check("type 56's lifetime has no scene-1 sweep", !p.dead);
    for (let i = 0; i < 2; i++) {
      G.g_evt_step_index += 1; BreakablePropPoolUpdate(rng, events);
    }
    check("...two step changes on a lifetime of 2 and alive", !p.dead);
    G.g_evt_step_index += 1; BreakablePropPoolUpdate(rng, events);
    check("...the third despawns it", p.dead);

    propScene(rng, GameMode.Arcade);
    withCurve();
    G.g_evt_block_index = 9;
    const q = place(rng, 56, POS, 2);
    G.g_script_flags[5] = 1;
    BreakablePropPoolUpdate(rng, events);
    check("in arcade the flag swings it and writes no route",
          q.routinePhase === 1 && G.g_script_branch_var === 0);
  }

  // -- type 69: stage 1's promotion, with no lifetime at all.
  {
    const rng = new Rng(69);
    const POS: [number, number, number] =
      [-138.64498901367188, 11.89109992980957, -324.0649719238281];
    let events = propScene(rng, GameMode.Arcade);
    let p = place(rng, 69, POS, 1);
    BreakablePropPoolUpdate(rng, events);
    check("type 69 despawns on its first frame in arcade", p.dead);
    for (const blk of [8, 3]) {
      events = propScene(rng);
      G.g_evt_block_index = blk;
      p = place(rng, 69, POS, 1);
      BreakablePropPoolUpdate(rng, events);
      check(`...and in block ${blk}`, p.dead);
    }

    events = propScene(rng);
    const snd = listen(events);
    const items: { kind?: number; x: number; y: number }[] = [];
    events.on("item.released", (e) => items.push(e as never));
    G.g_evt_block_index = 1;
    p = place(rng, 69, POS, 1);
    for (let i = 0; i < 5; i++) {
      G.g_evt_step_index += 1; BreakablePropPoolUpdate(rng, events);
    }
    check("...has no lifetime: five step changes on a lifetime of 1", !p.dead);
    const d = p.draws ?? [];
    check("...draws 0x13F8 at itself and 0x13F7 at a fixed world point",
          d.length === 2 && d[0].slot === 0x13f8 && d[1].slot === 0x13f7
          && near(d[1].m[12], -138.338) && near(d[1].m[13], 25.5026),
          JSON.stringify(d.map((x) => [x.slot, tr(x.m)])));
    G.g_script_flags[0x23] = 1;
    G.g_script_branch_var = 1;
    BreakablePropPoolUpdate(rng, events);
    check("...does not promote before it has been shot",
          G.g_script_branch_var === 1 && items.length === 0);
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng, events);
    check("...a shot plays 0x1D16A9 and knocks it off at -0.2",
          snd.join() === String(0x1d16a9) && p.routinePhase === 1
          && p.vy === Math.fround(-0.2), `${snd} ${p.vy}`);
    const y0 = p.y;
    G.g_original_item_pickup_blocked = 1;
    BreakablePropPoolUpdate(rng, events);
    check("...then promotes 1 to 2 and drops item set 1 at (-140.7, 3, -328.7)",
          G.g_original_item_pickup_blocked === 0
          && G.g_script_branch_var === 2 && items.length === 1
          && items[0].kind === 1 && near(items[0].x, -140.7) && items[0].y === 3,
          JSON.stringify(items));
    check("...and puts its own position back",
          p.x === POS[0] && p.z === POS[2] && p.storyItem === 1);
    const vy = Math.fround(Math.fround(-0.2) - 0.02722);
    check("...falling and tumbling -0x100 a frame, the sphere with it",
          p.vy === vy && p.pitch === -0x100 && p.roll === -0x100
          && p.y === Math.fround(vy + y0) && p.shotY === Math.fround(p.y + 1.5),
          `${p.vy} ${p.pitch} ${p.y}`);
  }

  // -- type 73: stage 4 block 7, the key after the hit, and the ride.
  {
    const rng = new Rng(73);
    const POS: [number, number, number] =
      [-326.6999816894531, 32.79999923706055, -803];
    let events = propScene(rng);
    withPath();
    G.g_app_state = AppState.Attract;
    let p = place(rng, 73, POS, 3);
    BreakablePropPoolUpdate(rng, events);
    check("type 73 despawns in the attract demo", p.dead);

    events = propScene(rng);
    withPath();
    p = place(rng, 73, [0, 0, 0], 3);
    BreakablePropPoolUpdate(rng, events);
    check("...is posed from object path 0x179, not its placement",
          near(p.x, -326.7) && p.z === -803 && p.draws?.[0]?.slot === 0x1871
          && near(p.shotY, 32.8 + 8), `${p.x} ${p.z} ${p.shotY}`);
    for (let i = 0; i < 3; i++) {
      G.g_evt_step_index += 1; BreakablePropPoolUpdate(rng, events);
    }
    G.g_evt_step_index += 1; BreakablePropPoolUpdate(rng, events);
    check("...and ActorKill takes it on the fourth step change, not ActorDespawn",
          p.dead && (p.flags & 0x8000) === 0, p.flags.toString(16));

    events = propScene(rng, GameMode.Arcade);
    withPath();
    G.g_evt_block_index = 7; G.g_script_flags[0x12] = 1;
    p = place(rng, 73, POS, 3);
    const hits = G.g_player_hit_count[0];
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng, events);
    check("...in arcade a shot is not taken and bit 3 stays up",
          G.g_player_hit_count[0] === hits && (p.flags & 8) !== 0
          && (p.flags & 6) === 0);

    events = propScene(rng);
    withPath();
    let snd = listen(events);
    G.g_evt_block_index = 7; G.g_script_flags[0x12] = 1;
    G.g_original_item_slots[G.g_active_player] = [-1, -1];
    p = place(rng, 73, POS, 3);
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng, events);
    check("...without the key the shot is paid and the road stays shut",
          snd.join() === String(0xe16a9) && (p.flags & 8) === 0
          && G.g_script_branch_var === 0 && p.routinePhase === 0, `${snd}`);

    events = propScene(rng);
    withPath();
    snd = listen(events);
    G.g_evt_block_index = 7; G.g_script_flags[0x12] = 1;
    G.g_original_item_slots[G.g_active_player] = [-1, 6];
    p = place(rng, 73, POS, 3);
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng, events);
    check("...with item 6 it writes 2, plays 0x381BA9 and starts the ride",
          G.g_script_branch_var === 2
          && snd.join() === [0xe16a9, 0x381ba9].join()
          && p.routinePhase === 1 && p.shake === 1, `${snd} ${p.shake}`);
    let cueAt = -1;
    for (let i = 0; i < 120; i++) {
      const n = snd.length;
      BreakablePropPoolUpdate(rng, events);
      if (snd.length > n && snd[n] === 0x371ba9) cueAt = p.shake;
    }
    check("...0x371BA9 once at cursor 70, and the ride stops at 105",
          cueAt === 70 && snd.filter((s) => s === 0x371ba9).length === 1
          && p.routinePhase === 2 && p.shake === 105, `${cueAt} ${p.shake}`);
    check("...on the path's last key, angles truncated by __ftol",
          near(p.x, -394.5623) && p.yaw === 2408 && p.pitch === 12475,
          `${p.x} ${p.yaw} ${p.pitch}`);
  }

  // -- type 41: stage 1's two-panel hinge.
  {
    const rng = new Rng(41);
    const events = propScene(rng, GameMode.Arcade);
    const snd = listen(events);
    const POS: [number, number, number] = [84, 1.7999999523162842, 112];
    const p = place(rng, 41, POS, 2, 36864);
    check("type 41's arm: the panel points, radius 7, +0x2A4 zero",
          p.words.o238 === 92 && p.words.o240 === 111 && p.words.o244 === 102
          && p.hitRadius === 7 && p.removeFlag === 0, JSON.stringify(p.words));
    BreakablePropPoolUpdate(rng, events);
    check("...draws 0x930 twice, at the placement and 8 along X, 1 back",
          p.draws?.length === 2 && p.draws.every((x) => x.slot === 0x930)
          && near(p.draws[1].m[12], 92) && near(p.draws[1].m[14], 111));
    check("...its sphere 5.0 above the placement",
          p.shotRegistered && p.shotY === Math.fround(POS[1] + 5));
    const score = G.g_player_score[0];
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng, events);
    check("...a shot pays ten, plays 0xE16A9 and swings the first at 0x230",
          G.g_player_score[0] === score + 10 && snd.join() === String(0xe16a9)
          && p.storyItem === 0x230 && p.words.o200 === 0x230);
    let stop0 = -1, stop1 = -1;
    for (let f = 2; f <= 60; f++) {
      const n = snd.length;
      BreakablePropPoolUpdate(rng, events);
      if (f === 4) {
        check("...frame 4: the second starts and the first is checked by 0x200",
              p.words.o2AC === 1 && p.storyItem === 0xc0
              && p.words.o206 === 0x20, p.storyItem.toString(16));
      }
      if (snd.length > n) { if (stop0 < 0) stop0 = f; else stop1 = f; }
    }
    check("...the first stops on frame 23 at 0x3800, the second on 35 at 0x3F00",
          stop0 === 23 && stop1 === 35 && p.words.o200 === 0x3800
          && p.words.o206 === 0x3f00, `${stop0} ${stop1}`);
    check("...paid once; the hit bit is never cleared",
          G.g_player_score[0] === score + 10 && (p.flags & 8) !== 0);
    const m = p.draws?.[0]?.m ?? [];
    const y = 0x9000 * BAMS, z = 0x3800 * BAMS;
    check("...each panel is RotY(yaw) then RotZ(its hinge) then RotX(pitch)",
          near(m[0], Math.cos(z) * Math.cos(y)) && near(m[1], Math.sin(z)),
          `${m.slice(0, 3)}`);
  }
}

console.log("\nclass 0x41 type 67, Training's boats and their cargo:");
{
  const SLOTS_A0 = 0x19ea;    // BREAKABLES.shatter.slots_a[0]
  const SLOTS_B0 = 0x1a11;    // BREAKABLES.shatter.slots_b[0]
  const near = (a: number, b: number, e = 1e-4) => Math.abs(a - b) < e;
  const scene67 = (lesson: number) => {
    const rng = new Rng(67);
    const events = propScene(rng, GameMode.Training);
    G.g_training_lesson = lesson;
    G.g_evt_step_index = 1;
    return { rng, events };
  };
  const place = (n: number, rng: Rng, life = 0): BreakableProp => {
    const len = G.g_breakable_props.length;
    const p = PlaceGenericProp({
      at: 0x20d4 + 0x28 * n, container: "generic", type: 67, slot: life,
      lifetime_evt_steps: life, field_1f4: n, pos: [0, 0, 0],
      pitch: 0, yaw: 0, roll: 0,
    }, rng);
    G.g_breakable_props.splice(len, 0, p);
    return p;
  };
  const cargoOf = (p: BreakableProp) => {
    const i = G.g_breakable_props.indexOf(p);
    return G.g_breakable_props.slice(i + 1, i + 4);
  };
  const kinds = (p: BreakableProp) => cargoOf(p).map((c) =>
    c.slot === TYPE67_CARGO_CRATE_SLOT && c.hp === 2 && c.effect === 0 ? "C"
      : c.slot === TYPE67_CARGO_TARGET_SLOT && c.hp === 1 && c.effect === 6
        ? "T" : "?").join("");

  // ---- the arm: three draws, index, slot, yaw, table, and the cargo ------
  {
    const { rng } = scene67(0);
    const twin = new Rng(67);
    const b0 = place(0, rng);
    const want = [0, 1, 2].map(() => MsvcRand(twin) % 0x10000);
    check("type 67's arm: three rand()s into +0x298, +0x1D8, +0x1E0",
          b0.words.o298 === want[0] && b0.spin === want[1]
          && b0.rollSpin === want[2] && rng.next() === twin.next(),
          `${b0.words.o298} ${b0.spin} ${b0.rollSpin} vs ${want}`);
    const b1 = place(1, rng);
    const b2 = place(2, rng);
    check("...yaw 0x4000 for index 0 and 0xC000 otherwise; 0x1A35 for 2",
          b0.yaw === 0x4000 && b1.yaw === 0xc000 && b2.yaw === 0xc000
          && b0.slot === TYPE67_SLOT && b1.slot === TYPE67_SLOT
          && b2.slot === TYPE67_SLOT_INDEX2);
    check("...0x7DCD08 names each boat by its index",
          G.g_prop67_by_index.slice(0, 3).join()
          === [b0.id, b1.id, b2.id].join());
    check("...each boat is followed by its three cargo objects",
          G.g_breakable_props.map((q) =>
            q.family === PropFamily.Type67Piece ? "c" : "B").join("")
          === "BcccBcccBccc");
    check("...at the s8 table's offsets times 0.25",
          cargoOf(b2).map((q) => [q.x, q.y, q.z].join()).join(" ")
          === "1.75,11,4.25 -0.75,11,-7.5 -2,12.5,-17");
    const t = cargoOf(b0)[0];
    check("...a target: 0x1A0F, one shot, effect 6/0x1D9, radius 5, flags 1",
          t.slot === 0x1a0f && t.hp === 1 && t.effect === 6
          && t.effectVariant === 0x1d9 && t.hitRadius === 5 && t.flags === 1);
  }
  for (const [lesson, want] of [
    [0, "TCT TCT TCT"], [1, "TCT TCC CCC"], [2, "CCT CCT CCT"],
    [3, "CCC CCC CCC"], [0xff, "TCT TCT TCT"],
  ] as Array<[number, string]>) {
    const { rng } = scene67(lesson);
    const bs = [place(0, rng), place(1, rng), place(2, rng)];
    check(`...g_training_lesson ${lesson}: targets and crates ${want}`,
          bs.map(kinds).join(" ") === want, bs.map(kinds).join(" "));
  }

  // ---- the boat: an object path, a sway, a rock, a draw ------------------
  {
    const { rng, events } = scene67(0);
    // Object path 0x196 (406): keys at 0 and 1, so frame 0 and frame 1 read
    // back distinct points. `PropEvalObjectPath6` on the stage's own paths.
    const k = (a: number, b: number) => [[0, a, 0, 0], [1, b, 0, 0]];
    SetCameraPaths(new CamPaths({ fps: 60, paths: {}, object_paths: {
      "406": { file: "op_train", index: 0, start: 0, duration: 1, channels: {
        pos_x: k(506, 507), pos_y: k(10, 11), pos_z: k(0, -2),
        rot_x: k(0, 0), rot_y: k(0, 0), rot_z: k(0, 0),
      } },
    } } as never));
    const b0 = place(0, rng);
    const r1d8 = b0.spin, r1e0 = b0.rollSpin, sway0 = b0.words.o298;
    BreakablePropPoolUpdate(rng, events);
    const x0 = b0.x;
    BreakablePropPoolUpdate(rng, events);
    check("the boat rides path 0x196 + index, read at the frame before the "
          + "1.0 step", x0 === 506 && b0.shake === 2
          && b0.x === 507 && b0.y === 11 && b0.z === -2,
          `${x0} ${b0.x} ${b0.y} ${b0.z} ${b0.shake}`);
    const ep = Math.trunc(Math.sin((r1d8 + 0x200) * BAMS_TO_RAD_F64) * 640);
    const er = Math.trunc(Math.cos((r1e0 + 0x200) * BAMS_TO_RAD_F64) * 640);
    check("...sway +0x180, rock +0x100; pitch/roll = ftol(sin/cos * 640)",
          b0.words.o298 === sway0 + 0x300 && b0.pitch === ep
          && b0.roll === er, `${b0.pitch} ${b0.roll} vs ${ep} ${er}`);
    // Phases that make this frame's pitch and roll exactly zero: the draw is
    // then Translate(P + s); RotY(0x4000); Translate(-(s R)) = P + 2s.
    b0.spin = -0x100;
    b0.rollSpin = 0x4000 - 0x100;
    BreakablePropPoolUpdate(rng, events);
    const a = b0.words.o298 * BAMS_TO_RAD_F64;
    const sx = Math.fround(Math.sin(a) * Math.fround(0.15));
    const sz = Math.fround(Math.cos(a) * Math.fround(0.15));
    const m = b0.draws?.[0]?.m ?? [];
    check("...one draw of its slot at P + 2s, scaled 2.5",
          b0.pitch === 0 && b0.roll === 0 && b0.draws?.length === 1
          && b0.draws[0].slot === TYPE67_SLOT
          && near(m[12], b0.x + 2 * sx) && near(m[13], b0.y)
          && near(m[14], b0.z + 2 * sz)
          && near(Math.hypot(m[0], m[1], m[2]), 2.5),
          `${m.slice(12, 15)}`);
    check("...and stores its matrix at scale 1.0 for the cargo",
          near(Math.hypot(b0.drawMatrix[0], b0.drawMatrix[1],
                          b0.drawMatrix[2]), 1.0, 1e-6));
    BreakablePropTakeShot(b0, 0);
    const f = b0.flags;
    BreakablePropPoolUpdate(rng, events);
    check("...no shot sphere and no mask on +0x34",
          !b0.shotRegistered && b0.flags === f);
  }

  // ---- the cargo: the boat's frame, the crack, the burst -----------------
  {
    const { rng, events } = scene67(0);
    const sounds: number[] = [];
    events.on("sound.play", (e) => sounds.push(e.id));
    const b0 = place(0, rng);
    const [target, crate, third] = cargoOf(b0);
    BreakablePropPoolUpdate(rng, events);
    const pm = b0.drawMatrix;
    const ex = pm[12] + target.x * pm[0] + target.y * pm[4] + target.z * pm[8];
    const ey = pm[13] + target.x * pm[1] + target.y * pm[5] + target.z * pm[9];
    const ez = pm[14] + target.x * pm[2] + target.y * pm[6] + target.z * pm[10];
    const tm = target.draws?.[0]?.m ?? [];
    check("type 67's cargo draws in this frame's boat matrix at its offset",
          target.draws?.[0]?.slot === 0x1a0f && near(tm[12], ex)
          && near(tm[13], ey) && near(tm[14], ez),
          `${tm.slice(12, 15)} vs ${ex},${ey},${ez}`);
    check("...+0x40 is that point and the sphere is 5.0 above it",
          near(target.hitPos.x, ex) && target.shotRegistered
          && near(target.shotY, ey + 5) && near(target.shotZ, ez));

    BreakablePropTakeShot(crate, 1);
    BreakablePropPoolUpdate(rng, events);
    check("...a crate's first shot: 0x1A16A9, 0x19E6, half round from the "
          + "boat, one shot left", sounds.join() === String(0x1a16a9)
          && crate.hp === 1 && crate.slot === TYPE67_CARGO_CRACKED_SLOT
          && crate.yaw === b0.yaw + 0x8000 && (crate.flags & 0xe) === 0
          && crate.shotRegistered);

    sounds.length = 0;
    G.g_GameMode = GameMode.Arcade;   // where an award of 1 would pay
    const score = G.g_player_score[0];
    const n = G.g_prop_shatters.length;
    BreakablePropTakeShot(target, 0);
    BreakablePropPoolUpdate(rng, events);
    const s = G.g_prop_shatters[n];
    check("...a target's shot: the sound, a burst with no floor from table "
          + "_b, ActorDespawn, no points",
          sounds.join() === String(0x1a16a9) && target.dead
          && ((target.flags & 0x80018000) >>> 0) === 0x80018000
          && s?.group === 0x63 && s.pieces[0].slot === SLOTS_B0
          && G.g_player_score[0] === score && target.draws?.length === 0);
    BreakablePropTakeShot(crate, 0);
    BreakablePropPoolUpdate(rng, events);
    check("...the cracked crate's second shot bursts from table _a",
          crate.dead
          && G.g_prop_shatters[G.g_prop_shatters.length - 1].pieces[0].slot
            === SLOTS_A0);
    third.hp = 0;   // a count the arm never writes: neither arm runs
    BreakablePropTakeShot(third, 0);
    BreakablePropPoolUpdate(rng, events);
    check("...the tail masks 0xFFFFFFF9, so bit 3 outlives a hit no arm took",
          (third.flags & 0xe) === 0x8, third.flags.toString(16));
  }

  // ---- the lifetime: any step change, ActorKill, whatever +0x11C holds ---
  {
    const { rng, events } = scene67(0);
    const b = place(1, rng, 5);
    const cargo = cargoOf(b);
    BreakablePropPoolUpdate(rng, events);
    const flags = [b, ...cargo].map((q) => q.flags);
    G.g_evt_step_index = 2;
    BreakablePropPoolUpdate(rng, events);
    check("type 67: the first step change takes the boat and its cargo "
          + "(lifetime 5 notwithstanding), as ActorKill",
          b.dead && cargo.every((c) => c.dead)
          && [b, ...cargo].every((q, i) => q.flags === flags[i])
          && !G.g_breakable_props.some((q) => q === b || cargo.includes(q)));
  }
}

console.log("\nclass 0x41 type 43, stage 3's seven shootable props:");
{
  const rng = new Rng(43);
  const events = propScene(rng);
  // Stage 3's kind-3 crate at evt 0x6900: the descriptor's THIRD orientation
  // word is the kind, its `+0x11C` is a lifetime, and its pitch and roll are
  // thrown away by the arm.
  const crate = PlaceGenericProp({
    at: 0xc000, container: "generic", type: 43, slot: 2,
    lifetime_evt_steps: 2, field_1f4: 1, pos: [10, 20, 30],
    pitch: 0x111, yaw: 0x4000, roll: 3,
  }, rng);
  G.g_breakable_props.push(crate);
  check("a type-43 prop takes its kind from the third orientation word",
        PropWords(crate, TYPE43_WORDS_ZERO).o290 === 3
        && crate.kind === 43 && crate.family === PropFamily.Type43,
        `kind ${PropWords(crate, TYPE43_WORDS_ZERO).o290} ${PropFamily[crate.family]}`);
  check("...its item set from desc+0x24, not from the byte above it",
        PropWords(crate, TYPE43_WORDS_ZERO).o194 === Type43ItemSet.ExtraLife,
        `${PropWords(crate, TYPE43_WORDS_ZERO).o194}`);
  check("...the kind table's radius, effect and variant",
        crate.hitRadius === 5 && crate.effect === 0
        && crate.effectVariant === 473,
        `r${crate.hitRadius} e${crate.effect} v${crate.effectVariant}`);
  check("...kind 3 wears the ordinary breakable model",
        crate.slot === BreakableSlot.Default, crate.slot.toString(16));
  check("...and the arm throws the descriptor's pitch and roll away",
        crate.pitch === 0 && crate.roll === 0 && crate.yaw === 0x4000,
        `${crate.pitch}/${crate.yaw}/${crate.roll}`);
  check("...with a radius, which is what makes it shootable at all",
        crate.hitRadius > 0);

  // It registers a shot sphere every frame, at the kind's own rise.
  BreakablePropPoolUpdate(rng, events);
  check("...and it publishes that sphere each frame",
        crate.shotRegistered, `${crate.shotRegistered}`);

  // The first shot cracks it: no points, the model swaps, and it turns to
  // face the camera. `KindedPropUpdate` hides the model instead. The heading
  // is the camera block's (`0x0046CF9C`); `g_camera_yaw_bams` is set to
  // something else so that reading it cannot pass.
  G.g_camera_block_yaw_bams = 0x2000;
  G.g_camera_yaw_bams = 0x5555;
  const score = G.g_player_score[0];
  crate.flags |= BreakableFlag.Hit | BreakableFlag.HitByPlayer0;
  BreakablePropPoolUpdate(rng, events);
  check("one shot cracks a kind 3 and pays nothing",
        crate.slot === BreakableSlot.Broken
        && G.g_player_score[0] === score,
        `${crate.slot.toString(16)} +${G.g_player_score[0] - score}`);
  check("...turning the broken model to face the camera",
        crate.yaw === 0x2000, crate.yaw.toString(16));
  check("...and it is still alive and still shootable",
        !crate.dead && crate.effectFrames === 0);

  // The second shot destroys it: ten points, the puff starts, and because it
  // is holding a life it stays standing for a third.
  crate.flags |= BreakableFlag.Hit | BreakableFlag.HitByPlayer0;
  BreakablePropPoolUpdate(rng, events);
  check("the second shot destroys it, for ten",
        crate.effectFrames >= 1 && G.g_player_score[0] - score === 10,
        `f${crate.effectFrames} +${G.g_player_score[0] - score}`);
  check("...and a wreck that was holding something is not taken away",
        !crate.dead, `${crate.dead}`);
  for (let i = 0; i < 0x50; i += 1) BreakablePropPoolUpdate(rng, events);
  check("...even after its puff has run out",
        !crate.dead, `${crate.dead}`);

  // The third shot is the one that pays out.
  const lives = G.g_player_lives[0];
  crate.flags |= BreakableFlag.Hit | BreakableFlag.HitByPlayer0;
  BreakablePropPoolUpdate(rng, events);
  check("a shot into the wreckage hands over the life",
        G.g_player_lives[0] === lives + 1
        && (crate.flags & TYPE43_FLAG_TAKEN) !== 0,
        `${lives} -> ${G.g_player_lives[0]}`);
  check("...and the wreck wears the pickup's own model",
        crate.slot === TYPE43_PICKUP_SLOT, crate.slot.toString(16));
  crate.flags |= BreakableFlag.Hit | BreakableFlag.HitByPlayer0;
  BreakablePropPoolUpdate(rng, events);
  check("...once, and not again",
        G.g_player_lives[0] === lives + 1, `${G.g_player_lives[0]}`);
}

{
  // A kind 2 has an effect id, so the first shot goes straight to the destroy
  // arm: one shot, ten points, and no crate model at any point.
  const rng = new Rng(143);
  const events = propScene(rng);
  const piece = PlaceGenericProp({
    at: 0xc100, container: "generic", type: 43, slot: 2,
    lifetime_evt_steps: 2, field_1f4: 0, pos: [0, 0, 0], roll: 2,
  }, rng);
  G.g_breakable_props.push(piece);
  check("a kind 2 carries no body model and an effect id",
        piece.slot === SLOT_NONE && piece.effect === 7,
        `${piece.slot.toString(16)} e${piece.effect}`);
  check("...and the kind table's own radius and rise, not the switch's",
        piece.hitRadius === 6, `${piece.hitRadius}`);
  const score = G.g_player_score[0];
  piece.flags |= BreakableFlag.Hit | BreakableFlag.HitByPlayer0;
  BreakablePropPoolUpdate(rng, events);
  check("...and one shot destroys it, for ten",
        piece.effectFrames >= 1 && G.g_player_score[0] - score === 10,
        `f${piece.effectFrames} +${G.g_player_score[0] - score}`);
  // Item set 0: this one IS taken away when the puff ends.
  for (let i = 0; i < 0x50; i += 1) BreakablePropPoolUpdate(rng, events);
  check("...and a wreck hiding nothing goes when its puff ends",
        !G.g_breakable_props.includes(piece),
        `${G.g_breakable_props.length} left`);
}

{
  // The bob and the tumble. Both are seeded at placement and both move every
  // frame; the bob is measured against `restY`, which the sine never touches.
  const rng = new Rng(243);
  const events = propScene(rng);
  const p = PlaceGenericProp({
    at: 0xc200, container: "generic", type: 43, slot: 1,
    lifetime_evt_steps: 1, field_1f4: 0, pos: [0, 50, 0], roll: 3,
  }, rng);
  G.g_breakable_props.push(p);
  check("its bob keeps the descriptor's Y as the centre it swings about",
        p.restY === 50, `${p.restY}`);
  // The arm's amplitude is the literal 1.5 (`MOV [ESI+0x2C0],0x3FC00000`
  // at 0x0046230E); only the routine's re-seed draws one.
  check("...with an amplitude of 1.5 and two spin rates drawn at placement",
        p.shake === 1.5 && p.spin !== 0 && p.rollSpin !== 0,
        `a${p.shake} ${p.spin}/${p.rollSpin}`);
  const pitch0 = p.pitch, roll0 = p.roll;
  BreakablePropPoolUpdate(rng, events);
  // The sine takes the phase BEFORE the step, and the phase starts at 0, so
  // the first frame draws exactly at the centre. The tumble has no such
  // delay: its rates are seeded non-zero and applied at once.
  check("...the first frame leaves the bob at its centre, sine of nothing",
        p.y === p.restY && p.pitch !== pitch0 && p.roll !== roll0,
        `${p.y} ${pitch0}->${p.pitch} ${roll0}->${p.roll}`);
  BreakablePropPoolUpdate(rng, events);
  check("...and the second frame has moved it off the centre",
        p.y !== p.restY, `${p.y - p.restY}`);
  // The spring pulls the rate toward the angle's opposite, so over a long run
  // the angle stays bounded rather than winding up.
  let worst = 0;
  for (let i = 0; i < 600; i += 1) {
    BreakablePropPoolUpdate(rng, events);
    worst = Math.max(worst, Math.abs(p.pitch), Math.abs(p.roll));
  }
  // A band and not just an upper bound: the divisor IS the stiffness, so the
  // worst excursion over a fixed seed pins it. 48 gives 915 BAMS -- five
  // degrees -- where 12 gives 336 and 192 gives 1742, so a wrong divisor
  // fails this whichever way it is wrong. An `< 0x8000` bound passed all of
  // them and asserted nothing about the spring at all.
  check("...and the tumble is a damped spring of the stiffness the shift says",
        worst > 700 && worst < 1100, `${worst}`);
  check("...and the bob stays within its amplitude of the centre",
        Math.abs(p.y - p.restY) <= p.shake + 1e-6,
        `${p.y - p.restY} vs ${p.shake}`);
}

console.log("\nclass 0x41's pose orders come from the routines:");
{
  // The table the renderer reads. `web/tools/checks/prop_pose.ts` is what says
  // the values match the EXE; this is what says the port's own three types
  // are in it and that the set the fix was about did not drift.
  check("type 51 is the only descriptor-slot type that composes Ry.Rz.Rx",
        GENERIC_POSE_ORDER[51] === PoseOrder.YawRollPitch
        && [5, 12, 31, 33, 53, 54].every(
          (ty) => GENERIC_POSE_ORDER[ty] === PoseOrder.RollYawPitch),
        `${[5, 12, 31, 33, 51, 53, 54].map((ty) => GENERIC_POSE_ORDER[ty])
          .join()}`);
  check("the descriptor-slot set is the seven types that draw obj+0x28C",
        [5, 12, 31, 33, 51, 53, 54].every(
          (ty) => GENERIC_DESCRIPTOR_SLOT.has(ty))
        && GENERIC_DESCRIPTOR_SLOT.size === 7,
        `${[...GENERIC_DESCRIPTOR_SLOT].join()}`);
  check("and the two strip types are the two whose roll is a count",
        GENERIC_SLOT_STRIP.has(31) && GENERIC_SLOT_STRIP.has(33)
        && GENERIC_SLOT_STRIP.size === 2, `${[...GENERIC_SLOT_STRIP].join()}`);
  // Fourteen routines pass `obj+0x28C` to their first draw and only seven of
  // them are descriptor-slot types. These four are the ones that look like
  // they belong and do not, so a well-meaning addition trips here as well as
  // in `web/tools/checks/prop_pose.ts`:
  //
  // * 43 -- its arm computes the field (`0x19E8` or `0xFFFF`) rather than
  //   leaving the prologue's, and it ages `obj+0x11C` as a lifetime. All seven
  //   of its stage-3 spawns carry 1, 2 or 3 there.
  // * 70, 71 and 72 -- their arms call `PickOriginalModeItem`, which writes
  //   the chosen item's model over `obj+0x28C`: the descriptor word is only
  //   ever a lifetime (70, 71) or nothing (72). 72 was the one type that
  //   passed every code clause and failed the data one, until the call was
  //   read as the overwrite it is.
  check("the four types that draw obj+0x28C and are not descriptor slots",
        [43, 70, 71, 72].every((ty) => !GENERIC_DESCRIPTOR_SLOT.has(ty)),
        `${[43, 70, 71, 72].filter((ty) => GENERIC_DESCRIPTOR_SLOT.has(ty))}`);
}

console.log("\nclass 0x41 type 34 is a falling container:");
{
  const rng = new Rng(9);
  const events = propScene(rng);
  // The generic constructor's case 0x22 builds the same object class 0x44
  // selector 16 does -- so the type-34 spawns in stages 1, 3, 4 and 5 are
  // item containers, and they were absent entirely.
  const before = G.g_item_set_countdown[ItemSet.Score2] ?? 0;
  const c = PlaceFallingContainer(0xf200, 0, ItemSet.Score2, -1, 1, 4,
                                  0, 20, 0, 0, rng);
  G.g_breakable_props.push(c);
  check("it seeds an item countdown, which is why it could not be skipped",
        G.g_item_set_countdown[ItemSet.Score2] === 1
        && before !== G.g_item_set_countdown[ItemSet.Score2]);
  check("and it is the same two-shot falling object",
        c.family === PropFamily.Falling && c.hp === 2
        && c.slot === FALLING_SLOT_WHOLE);
  void events;
}
