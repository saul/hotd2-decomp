/**
 * Class 0x41 constructors 16, 17, 29 and 37, and the routines they install --
 * stage 2's warehouse drums, the falling bridge pieces, the clock-tower gears
 * and the stacked pair. Every expected number here is worked from the
 * listing, not measured from the port.
 */
import { Rng } from "../../src/core/rng";
import { BAMS_TO_RAD_F64 } from "../../src/core/bams";
import type { BreakablePlacement, BreakablesJson } from "../../src/bundle";
import { G } from "../../src/game/globals";
import { SetGameTables } from "../../src/game/tables";
import { GameMode } from "../../src/game/game_mode";
import {
  BreakableFlag, g_class41_constructors, PlaceGenericProp, PropContainerType,
  PropFamily, type BreakableProp,
} from "../../src/game/class41";
import { BreakablePropPoolUpdate } from "../../src/game/class41/pool";
import { MsvcRand } from "../../src/game/class41/group";
import {
  PlaceTable16Props, TYPE16_GRAVITY, TYPE16_BOB_DECAY,
} from "../../src/game/class41/type16";
import { PlaceType17Props } from "../../src/game/class41/type17";
import { PlaceTable29Props } from "../../src/game/class41/type29";
import { PlaceType37PropPair, Type37Phase } from "../../src/game/class41/type37";
import { PropWords } from "../../src/game/class41/words";
import { check, CHARS, BREAKABLES, propScene } from "./harness";

/** The three tables as `hod2lib/class41_rows.ts` reads them from the image. */
const ROWS: Partial<BreakablesJson> = {
  type16_xz: [[-4752, -12304], [-4663, -12224], [-4531, -12579],
              [-4411, -12579], [-4213, -12301], [-4112, -12244]],
  type29_xyz: [[-907, 151, -1306], [-953, 137.5, -1322],
               [-911.5999755859375, 126, -1298],
               [-907.2999877929688, 127.9000015258789, -1337],
               [-941, 109.69999694824219, -1336],
               [-941, 110, -1255.969970703125],
               [-898.9000244140625, 121.5, -1270],
               [-853.5999755859375, 119.80000305175781, -1294],
               [-936.5999755859375, 142, -1264.6400146484375]],
  type37_hull: [[-3900, 7197, 3900], [-3900, 7197, -3900], [3900, 7197, 3900],
                [3900, 7197, -3900], [3900, 0, 3900], [3900, 0, -3900],
                [-3900, 0, 3900], [-3900, 0, -3900]],
};

/** `propScene`, with the three tables and `extra` placements in the bundle. */
function scene(rng: Rng, extra: BreakablePlacement[] = [],
               mode = GameMode.Arcade) {
  const events = propScene(rng, mode);
  SetGameTables(CHARS, {
    ...BREAKABLES, ...ROWS,
    placements: [...BREAKABLES.placements, ...extra],
  } as BreakablesJson);
  return events;
}

const f32 = Math.fround;
const shootProp = (p: BreakableProp, player = 0) => {
  p.flags |= BreakableFlag.Hit
    | (player ? BreakableFlag.HitByPlayer1 : BreakableFlag.HitByPlayer0);
};

console.log("\nclass 0x41 constructors 16, 17, 29 and 37 are in the table:");
{
  // `g_class41_constructors` read entry by entry: 16 0x00462FE0, 17
  // 0x004630B0, 29 0x00463270, 37 0x004632F0. A missing row builds nothing
  // and the placer dies silently, which is what the stage had before.
  for (const t of [PropContainerType.Table16Props, PropContainerType.Type17Props,
                   PropContainerType.Table29Props,
                   PropContainerType.Type37PropPair]) {
    check(`constructor ${t} has a routine`, !!g_class41_constructors[t]);
  }
}

console.log("\nclass 0x41 constructor 16, the six in the warehouse water:");
{
  const rng = new Rng(16);
  const events = scene(rng);
  const sounds: number[] = [];
  events.on("sound.play", (e) => sounds.push(e.id));
  const replay = new Rng(16);
  const alive = G.g_enemies_alive, present = G.g_enemies_present;
  const made = PlaceTable16Props(0x10980, 3, rng);
  G.g_breakable_props.push(...made);
  check("six objects, one per g_type16_prop_xz row", made.length === 6);
  const p = made[2];
  // `FILD; FMUL 0.1f; FSTP` of -4531 and -12579; y the literal 0xBFF33333.
  check("...each at its row in tenths, stood at y -1.9",
        p.x === f32(-4531 * f32(0.1)) && p.z === f32(-12579 * f32(0.1))
        && p.y === f32(-1.9), `${p.x} ${p.y} ${p.z}`);
  const yaws = made.map((q) => q.yaw);
  const want = made.map(() => MsvcRand(replay));
  check("...turned by one rand() each, in placement order",
        yaws.every((y, i) => y === want[i]), `${yaws}`);
  check("...two shots, dolam.bin[0], radius 8, the placer's lifetime byte",
        p.hp === 2 && p.slot === 0xa50 && p.hitRadius === 8
        && p.lifetime === 3 && p.family === PropFamily.Type16);

  // It registers every frame, at its origin.
  G.g_camera_block_yaw_bams = 0x2000;
  G.g_camera_yaw_bams = 0x5555;           // the one it must not read
  BreakablePropPoolUpdate(rng, events);
  check("the sphere is at the origin every frame",
        p.shotRegistered && p.shotX === p.x && p.shotY === p.y);

  // The first shot: `case 2` -- no score, 0xA51, turned to the camera block,
  // and the rattle.
  const score = G.g_player_score[0];
  shootProp(p);
  BreakablePropPoolUpdate(rng, events);
  check("the first shot cracks it for nothing and turns it to the camera block",
        p.hp === 1 && p.slot === 0xa51 && p.yaw === 0x2000
        && G.g_player_score[0] === score, `${p.hp} ${p.slot.toString(16)} ${p.yaw}`);
  check("...clearing the hit bit and both player bits",
        (p.flags & 0xe) === 0, (p.flags & 0xe).toString(16));
  const rattled = p.draws?.[0]?.m;
  check("...and it rattles: the draw is off its x by the rattle, which decays",
        !!rattled && rattled[12] !== p.x
        && PropWords(p, { o2c4: 0 }).o2c4 === f32(f32(1.0) * f32(0.9)),
        `${rattled?.[12]} vs ${p.x}`);
  check("...with the crack's sound", sounds.includes(0xe16a9));

  // The second: `case 1` -- 0xA56, scored, launched along the camera yaw
  // turned half round, and the base left where it stood.
  const x0 = p.x, z0 = p.z;
  shootProp(p);
  BreakablePropPoolUpdate(rng, events);
  const a = (0x2000 + 0x8000) * BAMS_TO_RAD_F64;
  check("the second shot launches it for ten",
        p.slot === 0xa56 && G.g_player_score[0] === score + 10,
        `${p.slot.toString(16)} +${G.g_player_score[0] - score}`);
  check("...along sin/cos of the camera yaw plus 0x8000, times 0.1",
        p.vx === f32(Math.sin(a) * 0.1) && p.vz === f32(Math.cos(a) * 0.1),
        `${p.vx} ${p.vz}`);
  const base = p.draws?.find((d) => d.slot === 0xa55);
  check("...leaving dolam.bin[5] at (x0, -7.5, z0)",
        !!base && base.m[12] === x0 && base.m[13] === -7.5 && base.m[14] === z0,
        JSON.stringify(base?.m.slice(12, 15)));
  check("...and it moved on the launch frame",
        p.x === f32(p.vx + x0), `${p.x}`);

  // The flight, worked from the listing: vy -= 0.05444f, y += vy, until the
  // unrounded sum is below -5.0.
  let vy = p.vy, y = p.y, frames = 0;
  for (;;) {
    const v = vy - TYPE16_GRAVITY;
    vy = f32(v);
    const s = v + y;
    y = f32(s);
    frames++;
    if (s < -5.0) break;
  }
  let n = 0;
  while (p.hp !== 0 && n < 500) { BreakablePropPoolUpdate(rng, events); n++; }
  check(`it lands after the frames the listing gives (${frames})`,
        n === frames, `${n}`);
  const strip = G.g_breakable_props.find(
    (q) => q.family === PropFamily.Type16DropStrip);
  check("...into a bob about -5.0 at 0x800, amplitude 1.5",
        p.restY === -5 && p.yawSpin === 0x800 && p.shake === 1.5);
  check("...and the drop strip has started, at its point, drawn after a step",
        !!strip && strip.slot === 0x133a && strip.draws?.[0]?.slot === 0x133a,
        `${strip?.slot.toString(16)}`);
  check("...with the landing's sound", sounds.includes(0x4616a9));

  // Afloat: y = sin(old phase) * amp - 5; the amplitude decays by 0.35 each
  // time the phase's low sixteen bits come round to zero -- 32 frames.
  for (let i = 0; i < 31; i++) BreakablePropPoolUpdate(rng, events);
  check("the amplitude decays by 0.35 once the phase comes round",
        p.shake === f32(1.5 * TYPE16_BOB_DECAY) && (p.hingeB & 0xffff) === 0,
        `${p.shake} ${p.hingeB.toString(16)}`);
  check("...and y is the sine of the phase before the step",
        p.y === f32(Math.sin((p.hingeB - 0x800) * BAMS_TO_RAD_F64) * 1.5 - 5),
        `${p.y}`);
  check("...the strip ran its 29 frames and went",
        !G.g_breakable_props.some((q) => q.family === PropFamily.Type16DropStrip));
  // Nothing in the routine writes `g_enemies_alive` or `g_enemies_present`.
  check("...and no enemy counter moved through any of it",
        G.g_enemies_alive === alive && G.g_enemies_present === present);

  // A lifetime of 3 step changes: the fourth despawns it.
  for (let s = 1; s <= 3; s++) {
    G.g_evt_step_index = 10 + s;
    BreakablePropPoolUpdate(rng, events);
  }
  check("three step changes leave it", !p.dead && !made[0].dead);
  G.g_evt_step_index = 20;
  BreakablePropPoolUpdate(rng, events);
  check("...the fourth despawns every one", made.every((q) => q.dead));
}

console.log("\nclass 0x41 constructor 16 obeys stage 2's sweep after its lifetime:");
{
  const rng = new Rng(160);
  const events = scene(rng);
  const made = PlaceTable16Props(0x10980, 3, rng);
  G.g_breakable_props.push(...made);
  G.g_scene_index = 1;
  G.g_script_flags[0x77] = 1;
  BreakablePropPoolUpdate(rng, events);
  check("flag 0x77 in scene 1 despawns all six", made.every((q) => q.dead));
}

console.log("\nclass 0x41 constructor 17, the three pieces that fall:");
{
  const rng = new Rng(17);
  const events = scene(rng);
  // Stage 2 evt 0xECBC's point.
  const made = PlaceType17Props(0xecbc, -815, 75, f32(-1298.8));
  G.g_breakable_props.push(...made);
  check("three objects: 0 and 2 at the placer, 1 at (+5, +4, +5)",
        made.length === 3
        && made[0].x === -815 && made[0].y === 75
        && made[2].x === -815 && made[2].y === 75
        && made[1].x === -810 && made[1].y === 79
        && made[1].z === f32(f32(-1298.8) + 5),
        made.map((q) => `${q.x},${q.y},${q.z}`).join(" "));
  check("...radius 2, falling at 0.1 to start",
        made.every((q) => q.hitRadius === 2 && q.vy === f32(-0.1)));

  G.g_camera_fixed_eye_y = -20;
  const p = made[1];
  BreakablePropPoolUpdate(rng, events);
  check("a frame takes 0.05444 off vy and adds it to y",
        p.vy === f32(f32(-0.1) - f32(0.05444))
        && p.y === f32(79 + (f32(-0.1) - f32(0.05444))), `${p.vy} ${p.y}`);
  const d = p.draws?.[0];
  check("...drawn as bridge.bin[5] at a twentieth",
        d?.slot === 0x843 && Math.abs((d?.m[0] ?? 0) - f32(0.05)) < 1e-7,
        `${d?.slot.toString(16)} ${d?.m[0]}`);

  // A hit: ten points, a bounce of 0.3, and only bit 3 cleared.
  const score = G.g_player_score[1];
  shootProp(p, 1);
  BreakablePropPoolUpdate(rng, events);
  check("every hit scores ten and bounces it at 0.3",
        G.g_player_score[1] === score + 10
        && p.vy === f32(f32(0.3) - f32(0.05444)), `${p.vy}`);
  check("...and the player bit it set stays set",
        (p.flags & BreakableFlag.Hit) === 0
        && (p.flags & BreakableFlag.HitByPlayer1) !== 0);

  // No lifetime: step changes do nothing; the floor ends it.
  for (let s = 1; s <= 10; s++) {
    G.g_evt_step_index = 30 + s;
    BreakablePropPoolUpdate(rng, events);
  }
  check("step changes do not retire it", !p.dead);
  let n = 0;
  while (!p.dead && n < 1000) { BreakablePropPoolUpdate(rng, events); n++; }
  check("...falling below g_camera_fixed_eye_y does",
        p.dead && made.every((q) => q.dead));
}

console.log("\nclass 0x41 constructor 29, the gears:");
{
  const rng = new Rng(29);
  const events = scene(rng);
  const made = PlaceTable29Props(0xece4, 4);
  G.g_breakable_props.push(...made);
  check("nine objects from g_type29_prop_xyz, none shootable",
        made.length === 9 && made[5].z === f32(-1255.969970703125)
        && made.every((q) => q.hitRadius === 0 && q.flags === 0));
  BreakablePropPoolUpdate(rng, events);
  check("4 and 5 turn about Y, the rest about X, 0x80 a frame",
        made[4].yaw === -0x80 && made[4].pitch === 0
        && made[0].pitch === -0x80 && made[0].yaw === 0);
  check("3 and 7 draw nothing", made[3].draws?.length === 0
        && made[7].draws?.length === 0);
  const d = made[8].draws?.[0];
  check("...the rest tokei_gear.bin[i] at (x + 17, y - 5, z)",
        d?.slot === 0x1a42 && d.m[12] === f32(made[8].x + 17)
        && d.m[13] === f32(made[8].y - 5) && d.m[14] === made[8].z,
        JSON.stringify(d?.m.slice(12, 15)));
  check("...and nothing registers for the shot test",
        made.every((q) => !q.shotRegistered));
  for (let s = 1; s <= 4; s++) {
    G.g_evt_step_index = 40 + s;
    BreakablePropPoolUpdate(rng, events);
  }
  check("a lifetime of 4 outlives four step changes", !made[0].dead);
  G.g_evt_step_index = 50;
  BreakablePropPoolUpdate(rng, events);
  check("...and not a fifth", made.every((q) => q.dead));
}

/** Stage 2's evt 0x24DC: item set 1 of one, lifetime 3. */
const PAIR: BreakablePlacement = {
  at: 0x24dc, container: "type37", lifetime_evt_steps: 3, field_1f4: 1,
  set_size: 1, effect: 7, motion: 0x1d5, pos: [-639, f32(49.1), -1098],
  yaw: 61895,
};

console.log("\nclass 0x41 constructor 37, the pair:");
{
  const rng = new Rng(37);
  const events = scene(rng, [PAIR]);
  const released: [number, number][] = [];
  events.on("item.released", (e) => released.push([e.set, e.y]));
  const alive = G.g_enemies_alive, present = G.g_enemies_present;
  const made = PlaceType37PropPair(PAIR, rng);
  G.g_breakable_props.push(...made);
  const [lo, hi] = made;
  check("two objects, the second 7.197 up and 0.05 across",
        lo.y === f32(49.1) && hi.y === f32(f32(7.197) + f32(49.1))
        && hi.x === f32(-639 + f32(0.05)) && hi.restHeight === f32(49.1),
        `${lo.y} ${hi.y} ${hi.x}`);
  check("...both turned by the placer's +0x68, komono_1.bin[114], radius 6",
        made.every((q) => q.yaw === 61895 && q.slot === 0x17a9
                   && q.hitRadius === 6));
  check("...g_type37_pair names them and two hits are left",
        G.g_type37_pair[0] === lo.id && G.g_type37_pair[1] === hi.id
        && G.g_type37_hits_left === 2);
  check("...and a set of one is counted down from 1, without a draw",
        G.g_item_set_countdown[1] === 1);

  BreakablePropPoolUpdate(rng, events);
  check("the sphere is 6.0 above the origin",
        hi.shotRegistered && hi.shotY === f32(hi.y + 6));

  // A shot on the lower one while both stand knocks the upper one down.
  const score = G.g_player_score[0];
  shootProp(lo);
  BreakablePropPoolUpdate(rng, events);
  check("the lower one breaks for ten", lo.routinePhase === Type37Phase.Broken
        && G.g_player_score[0] === score + 10);
  check("...and the upper one falls, turning at 0x80..0x100 either way",
        hi.routinePhase === Type37Phase.Falling
        && Math.abs(hi.spin) >= 0x80 && Math.abs(hi.spin) <= 0x100
        && Math.abs(hi.rollSpin) >= 0x80 && Math.abs(hi.rollSpin) <= 0x100,
        `${hi.spin} ${hi.rollSpin}`);
  check("...one hit left, and nothing let out yet",
        G.g_type37_hits_left === 1 && released.length === 0);
  check("the broken one's hit bit is never cleared, and it stays a target",
        (lo.flags & BreakableFlag.Hit) !== 0 && lo.shotRegistered);

  // Down on a corner: the pivot takes over at the first corner under the
  // floor, with the spins turned back by -1.5.
  let n = 0;
  let before = { spin: 0, roll: 0 };
  while (hi.routinePhase === Type37Phase.Falling && n < 500) {
    before = { spin: hi.spin, roll: hi.rollSpin };
    BreakablePropPoolUpdate(rng, events);
    n++;
  }
  check("the upper one comes down on a corner",
        hi.routinePhase === Type37Phase.Pivoting
        && hi.restY === hi.restHeight && hi.contact >= 0 && hi.contact < 8,
        `after ${n} frames, corner ${hi.contact}`);
  check("...its spins turned back by -1.5 and truncated",
        hi.storyItem === 0 && hi.spin === Math.trunc(before.spin * -1.5)
        && hi.rollSpin === Math.trunc(before.roll * -1.5),
        `${before.spin} -> ${hi.spin}`);
  // The pivot is the corner's world point: the corner turned by Ry Rz Rx
  // about the object's origin, at the height it was when it touched.
  {
    const c = ROWS.type37_hull![hi.contact].map((v) => f32(v * f32(0.001)));
    check("...pivoting on that corner, at the floor",
          c[1] >= 0 && hi.restY === f32(49.1)
          && Math.abs(hi.restX - hi.x) < 8 && Math.abs(hi.restZ - hi.z) < 8,
          `corner ${c} rest ${hi.restX},${hi.restY},${hi.restZ}`);
  }
  check("...drawn through the pivot matrix it stores",
        hi.drawMatrix.length === 16 && hi.draws?.[0]?.m[12] === hi.drawMatrix[12]
        && hi.x === f32(hi.drawMatrix[12]));
  n = 0;
  while (hi.routinePhase === Type37Phase.Pivoting && n < 500) {
    BreakablePropPoolUpdate(rng, events);
    n++;
  }
  check("...until both angles cross zero, and it stands at the floor",
        hi.routinePhase === Type37Phase.Standing && hi.pitch === 0
        && hi.roll === 0 && hi.y === hi.restHeight && hi.removeFlag >= 1);
  // The strip starts on the frame it stands: collect that frame's draws too.
  const strip: number[] = [];
  const take = () => {
    for (const d of hi.draws ?? []) if (d.slot !== 0x17a9) strip.push(d.slot);
  };
  take();
  for (let i = 0; i < 20; i++) {
    BreakablePropPoolUpdate(rng, events);
    take();
  }
  check("...with the landing strip, common.bin[25..39], once each",
        strip.length === 15 && strip[0] === 0x94 && strip[14] === 0xa2,
        strip.map((s) => s.toString(16)).join(","));

  // The second break lets the set's item out at the floor.
  shootProp(hi);
  BreakablePropPoolUpdate(rng, events);
  check("the second break releases set 1 at the rest height",
        released.length === 1 && released[0][0] === 1
        && G.g_type37_hits_left === 0 && G.g_item_set_countdown[1] === 0,
        JSON.stringify(released));

  // The break effect runs by twos and the object goes at 0x46.
  n = 0;
  while (!hi.dead && n < 100) { BreakablePropPoolUpdate(rng, events); n++; }
  check("the break runs 35 frames by twos and then despawns",
        n === 35, `${n}`);
  check("...and no enemy counter moved through any of it",
        G.g_enemies_alive === alive && G.g_enemies_present === present);
}

console.log("\nclass 0x41 constructor 37, the pair hit top first:");
{
  const rng = new Rng(370);
  const events = scene(rng, [PAIR]);
  const made = PlaceType37PropPair(PAIR, rng);
  G.g_breakable_props.push(...made);
  const [lo, hi] = made;
  shootProp(hi);
  BreakablePropPoolUpdate(rng, events);
  check("a shot on the upper one knocks nothing",
        hi.routinePhase === Type37Phase.Broken
        && lo.routinePhase === Type37Phase.Standing
        && G.g_type37_hits_left === 1);
  shootProp(lo);
  BreakablePropPoolUpdate(rng, events);
  check("...and the lower one's shot, at one left, only lets the item out",
        lo.routinePhase === Type37Phase.Broken && G.g_type37_hits_left === 0);
}

console.log("\nclass 0x41 constructor 37, the upper one shot as it falls:");
{
  const rng = new Rng(372);
  const events = scene(rng, [PAIR]);
  const released: number[] = [];
  events.on("item.released", (e) => released.push(e.y));
  const made = PlaceType37PropPair(PAIR, rng);
  G.g_breakable_props.push(...made);
  const [lo, hi] = made;
  shootProp(lo);
  BreakablePropPoolUpdate(rng, events);
  for (let i = 0; i < 3; i++) BreakablePropPoolUpdate(rng, events);
  const fallingAt = hi.y;
  shootProp(hi);
  BreakablePropPoolUpdate(rng, events);
  // `MOV ECX, [ESI+0x1B8]; MOV [ESI+0x1A0], ECX` before the release switch:
  // the item comes out at the floor, not where the object was shot, and the
  // extra life one unit above that (`SpawnExtraLifePickup`).
  check("its item comes out at the floor, not where it was hit",
        fallingAt > hi.restHeight + 1 && released.length === 1
        && released[0] === hi.restHeight + 1 && hi.y === hi.restHeight,
        `hit at ${fallingAt}, released at ${released}`);
}

console.log("\nclass 0x41 constructor 37 in Original Mode with item 0x1E:");
{
  const rng = new Rng(371);
  const events = scene(rng, [PAIR], GameMode.Original);
  const released: number[] = [];
  events.on("item.released", (e) => released.push(e.set));
  const made = PlaceType37PropPair({ ...PAIR, field_1f4: 2 }, rng);
  G.g_breakable_props.push(...made);
  G.g_original_first_aid = 1;
  shootProp(made[1]);
  BreakablePropPoolUpdate(rng, events);
  shootProp(made[0]);
  BreakablePropPoolUpdate(rng, events);
  check("the second break drops the extra life whatever the set",
        released.length === 1 && released[0] === 1
        && PropWords(made[0], { o194: 0 }).o194 === 1,
        JSON.stringify(released));
  G.g_original_first_aid = 0;
}

console.log("\nclass 0x41 type 43 reads g_original_first_aid too:");
{
  // `0x00462371`: `CMP g_GameMode, 1; ... MOV AL, [0x009C88AA]; TEST; JZ;
  // MOV byte [ESI+0x194], 1`. The byte is the one constructor 37 reads.
  const build = (mode: GameMode, drops: number) => {
    const rng = new Rng(43);
    scene(rng, [], mode);
    G.g_original_first_aid = drops;
    const p = PlaceGenericProp({
      at: 0xc000, container: "generic", type: 43, slot: 2,
      lifetime_evt_steps: 2, field_1f4: 2, pos: [10, 20, 30],
      pitch: 0, yaw: 0x4000, roll: 3,
    }, rng);
    G.g_original_first_aid = 0;
    return PropWords(p, { o194: 0 }).o194;
  };
  check("Original Mode with item 0x1E held turns set 2 into the life",
        build(GameMode.Original, 1) === 1);
  check("...not without the item", build(GameMode.Original, 0) === 2);
  check("...and not outside Original Mode", build(GameMode.Arcade, 1) === 2);
}
