import type { CharactersJson, CharacterType } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import {
  ActorSpawn, GameUpdate, SpawnScriptedCharacters,
} from "../../src/game/director";
import { ActorAdvanceMotion } from "../../src/game/motion";
import { MOTION_FLAGS_INIT, MotionFlag } from "../../src/game/actor";
import { G, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST } from "../../src/game/host";
import { SpriteEffectKind } from "../../src/game/effects/sprite";
import { MotionPlayLength, SetGameTables, T } from "../../src/game/tables";
import { ActorFlag, ThrowerFlag, ThrowerStance } from "../../src/game/actor";
import { DescriptorFromPlacement } from "../../src/game/descriptor";
import {
  PROJECTION_DISTANCE_PX as G_PROJECTION_DISTANCE_PX,
} from "../../src/game/combat/permits";
import { ArcPhase } from "../../src/game/class31/arc";
import { ApplyRootMotion } from "../../src/game/root_motion";
import {
  ThrowerStateLeapAside, ThrowerStateLeapDown,
} from "../../src/game/class31/pounce";
import { SpawnClass } from "../../src/game/spawn_class";
import { GameMode } from "../../src/game/game_mode";
import {
  ActorArcBegin, ActorArcBeginTo, ActorArcStep, ActorClipFrame,
  FitArcScriptByFadeLength, FitArcScriptByStartFrame, InstallArcMotionScript,
} from "../../src/game/class31/arc";
import { SND_PATH_LEG_LANDED } from "../../src/game/class31/path";
import { ThrowerState } from "../../src/game/class31/states";
import { ThrowerStrikeConnect } from "../../src/game/class31/strike";
import { ThrowerStanceOf } from "../../src/game/class31/tables";
import { ActorPlayCursor } from "../../src/game/class31/arc";
import { ThrowerPickLandingPoint } from "../../src/game/class31/leap_down";
import { SND_LEAP_LANDED } from "../../src/game/class31/leap";
import { dist2d, vec3, type Vec3 } from "../../src/game/vec";
import { ResolveHit } from "../../src/game/combat/resolve_hit";
import {
  check, motion, SCENE_MAJOR_PLAYING, EYE, HoldCameraAt, EnterPlay,
  RunOutInvulnerability, ARC, DROP_SCRIPT, PATH_STYLE0, PATH_STYLE1, TYPE31,
  CLASS31, TYPE31_ZSASS, TYPE31_ZSLMAN, CHARS31, CAM_HOST, WALL_BLOB,
  FLOOR_BLOB, thrower,
} from "./harness";
import { KNOCKDOWN_BODY } from "../../src/game/class31/death";

console.log("\nEnemyThrowerInit: zslman is born NoDismember");
// `EnemyThrowerInit` (`FUN_00449620`) is the fourth writer of the flag, and
// the only one outside class 0x30: character type 0x18, `zslman`, is **born**
// with it -- `CMP CX,0x18` / `OR AH,0x4` at `0x00449810`..`0x00449820`. The
// class-0x30 pass that found the other three could not reach this one,
// because it lives in class 0x31's Init.
{
  ResetGameGlobals();
  EnterPlay();
  SetGameTables(CHARS31);
  const zslman = ActorSpawn(0x9100, SpawnClass.Thrower, 0x18, "zslman",
                            { initialState: ThrowerState.StandAndDecide,
                              condition: 0 });
  check("`zslman` is born NoDismember",
        (zslman.flags & ActorFlag.NoDismember) !== 0,
        `flags ${zslman.flags.toString(16)}`);
  const zstin = ActorSpawn(0x9101, SpawnClass.Thrower, 0x19, "zstin",
                           { initialState: ThrowerState.StandAndDecide,
                             condition: 0 });
  check("...and no other thrower character type is",
        (zstin.flags & ActorFlag.NoDismember) === 0,
        `flags ${zstin.flags.toString(16)}`);
  // `obj+0x138C`: 1.0 for 0x17 and for 0x18, but a `zslman` that starts in
  // state 34 is born invisible, blinking and shadowless (`0x00449823`..
  // `0x0044983F`) -- stage 6's eight, and the parts `DrawCharacterPartSlot`
  // draws at the word go with them.
  check("...and a zslman that does not start in state 34 is born at alpha 1",
        zslman.alpha === 1 && (zslman.flags2 & ThrowerFlag.Blinking) === 0,
        `${zslman.alpha} ${zslman.flags2.toString(16)}`);
  const blinkIn = ActorSpawn(0x9102, SpawnClass.Thrower, 0x18, "zslman",
                             { initialState: ThrowerState.BlinkIn,
                               condition: 0 });
  check("...one that starts in state 34 is born at 0, blinking, no shadow",
        blinkIn.alpha === 0 && (blinkIn.flags2 & ThrowerFlag.Blinking) !== 0
        && (blinkIn.flags & ActorFlag.NoShadow) !== 0,
        `${blinkIn.alpha} ${blinkIn.flags2.toString(16)} `
        + `${blinkIn.flags.toString(16)}`);
}

// `ActorArcStep` (`FUN_0044D860`) sets each stage with `ActorSetMotionBlended`
// (`CALL 0x004119a0` at 0x0044D901, 0x0044D94D, 0x0044D9C9), and that writes
// `obj+0x19C = start` and raises the fade bit `SkeletonAdvancePlayCursor`
// (`FUN_004111A0`) holds the cursor on for the fade. The port's one-shot
// channel started the stage running at once, so a state that tests the cursor
// *before* it steps the arc -- `ThrowerStateDelayedPounce`'s `cursor > 66` --
// never saw a stage's start frame at all.
console.log("class 0x31, ActorArcStep holds each stage on its start frame:");
{
  const z = thrower(ThrowerState.LeapToPoint);
  z.pos = vec3(0, 60, 80);
  ActorArcBegin(z, vec3(0, 10, 80), 30);
  InstallArcMotionScript(z, DROP_SCRIPT(300));
  z.arcPhase = ArcPhase.Windup;
  const before: number[] = [];
  const after: number[] = [];
  let immuneAtWindup = false;
  let immuneInFlight = true;
  let steps = 0;
  let going = true;
  while (going && steps++ < 200) {
    // The director's order: the clocks, then the state.
    ActorAdvanceMotion(z, 1 / 60);
    before.push(ActorClipFrame(z));
    going = ActorArcStep(z, 1, 1 / 60);
    after.push(ActorClipFrame(z));
    if (z.arcPhase === ArcPhase.Crouched) {
      immuneAtWindup ||= (z.flags & ActorFlag.ShotImmune) !== 0;
    }
    if (z.arcPhase === ArcPhase.Flight) {
      immuneInFlight &&= (z.flags & ActorFlag.ShotImmune) !== 0;
    }
  }
  const s = z.arcScript!;
  // The fit ran on the first step and grew the two fades onto the thirty
  // frames: 30 - 5 - 0 - 63 + 56 = 18 of slack, nine onto each.
  check("the fit grew stage 1's fade and stage 2's onto the arc",
        s[1].fade === 9 && s[2].fade === 14,
        `fades ${s.map((st) => st.fade).join(", ")}`);
  const seen = (xs: number[], v: number) => xs.filter((x) => x === v).length;
  // `fade + 1` frames on the start frame, counting the frame of the call --
  // the base track's hold, and the engine's draws: it draws the start frame
  // at weights 1/(fade+1) through 1.
  check("stage 1 holds its start frame for its fade + 1",
        seen(after, s[1].start) === s[1].fade + 1,
        `${seen(after, s[1].start)} frames on ${s[1].start}`);
  check("...and stage 2 its own",
        seen(after, s[2].start) === s[2].fade + 1,
        `${seen(after, s[2].start)} frames on ${s[2].start}`);
  // A state that reads the cursor before it steps the arc sees stage 2's start
  // on the frame after the handover, not the frame after that.
  const firstPast = before.find((c) => c > s[1].until);
  check("a test before the step sees stage 2's start, not the frame after it",
        firstPast === s[2].start, `first past ${s[1].until}: ${firstPast}`);
  check("...and every frame of stage 1 on the way",
        Array.from({ length: s[1].until - s[1].start + 1 },
                   (_, i) => s[1].start + i)
          .every((c) => before.includes(c)),
        before.join(","));
  check("the arc ends once the cursor reaches stage 2's threshold",
        !going && after[after.length - 1] >= s[2].until
        && after[after.length - 2] < s[2].until,
        `${after.slice(-2).join(" -> ")}`);
  check("...standing on the point it named",
        Math.abs(z.pos.y - 10) < 1e-6, `y ${z.pos.y}`);
  // `0x0044D886`..`0x0044D8BE` and `0x0044D952`..`0x0044D97D`: types
  // 0x16..0x19 cannot be shot in the windup, and can from the takeoff.
  check("zstin cannot be shot in the windup, and can in flight",
        immuneAtWindup && !immuneInFlight,
        `windup ${immuneAtWindup} flight ${immuneInFlight}`);
  // `OR dword ptr [ESI + 0x136c], 0x180000` at 0x0044DA39.
  check("...and lands colliding with the world and with actors",
        (z.flags2 & ThrowerFlag.Collide) === ThrowerFlag.Collide,
        `flags2 0x${z.flags2.toString(16)}`);

  // `CMP word ptr [ESI + 0x1310], 0xa / JZ` at 0x0044D89A: the leap aside's
  // windup is the one that can be shot.
  const w = thrower(ThrowerState.LeapAside);
  w.state = ThrowerState.LeapAside;     // the spawn applies it on first update
  w.flags &= ~ActorFlag.ShotImmune;
  ActorArcBegin(w, vec3(0, 0, 60), 30);
  InstallArcMotionScript(w, DROP_SCRIPT(300));
  w.arcPhase = ArcPhase.Windup;
  ActorAdvanceMotion(w, 1 / 60);
  ActorArcStep(w, 1, 1 / 60);
  check("the leap aside's windup is not shot-immune",
        w.arcPhase === ArcPhase.Crouched
        && (w.flags & ActorFlag.ShotImmune) === 0,
        `phase ${w.arcPhase} flags 0x${(w.flags >>> 0).toString(16)}`);
}

console.log("class 0x31, ThrowerStateLeapToPoint:");
{
  const rng = new Rng(41);
  const events = new Events();
  let thumps = 0;
  events.on("sound.play", (d) => {
    if (d.id === SND_LEAP_LANDED) thumps += 1;
  });
  // Stage 2 block 5 step 6's first zsass, verbatim: spawned at y = 87 with a
  // descriptor naming the street at y = 37, thirty frames away. The other
  // shape is stage 2 block 11 step 4 -- the script plays the glass and then
  // puts two `zstin` in this state so they arrive through the window.
  const z = thrower(ThrowerState.LeapToPoint, {
    leap: { dest: [-732.8, 37.0, -1206.5], frames: 30 },
  });
  z.pos = vec3(-732.8, 87.0, -1206.5);
  z.motion = 10;

  check("it starts in the descriptor's own state, not the throw",
        z.state === ThrowerState.LeapToPoint, `state ${z.state}`);

  const ys: number[] = [];
  let clip = -1;
  let immune = 0;
  for (let i = 0; i < 200 && z.state === ThrowerState.LeapToPoint; i++) {
    GameUpdate(1 / 60, CAM_HOST, rng, events);
    ys.push(z.pos.y);
    if (z.action) clip = z.action.motion;
    if (z.flags & ActorFlag.ShotImmune) immune += 1;
  }
  // **The arc script is the point of this state**, and without it the actor
  // slid to the ground in whatever pose it was already in. Clip 300 is the
  // leap, cut into a windup at 50..55, a flight at 56..63 and a landing at
  // 64..98 by `CLASS31_ARC_SCRIPTS.drop`.
  check("it plays the leap clip the arc script names",
        clip === 300, `clip ${clip}`);
  check("it falls", ys[8] < 87 && ys[8] > 37, `y ${ys[8]?.toFixed(1)}`);
  check("it accelerates rather than sliding down at a constant rate",
        ys[7] - ys[8] < ys[22] - ys[23],
        `${(ys[7] - ys[8]).toFixed(3)} then ${(ys[22] - ys[23]).toFixed(3)}`);
  check("it lands on the point the descriptor names",
        Math.abs(z.pos.y - 37) < 0.01 && Math.abs(z.pos.x + 732.8) < 0.01,
        `(${z.pos.x.toFixed(1)}, ${z.pos.y.toFixed(1)})`);
  // `OR CH, 1` at `0x0044E4E3`, `AND AH, 0xFE` at `0x0044E5B2`: it cannot be
  // shot on the way through.
  // Every frame but the last: the flag is cleared inside the same update that
  // hands the actor to state 7, which is the frame the loop stops on.
  check("it is shot-immune for the whole leap and not after",
        immune === ys.length - 1 && (z.flags & ActorFlag.ShotImmune) === 0,
        `${immune} of ${ys.length} frames`);
  check("and then stands up to throw",
        z.state === ThrowerState.StandAndDecide, `state ${z.state}`);
  // The footfall, once: `PlaySoundId(0x2916A9)` at `0x0044E58E`.
  check("...having thumped exactly once on the way down",
        thumps === 1, `${thumps}`);

  // **And the hub replaces the landing clip rather than deferring to it.**
  //
  // `ThrowerStateLeapToPoint` clears nothing on its way out: `0x0044E5A6` to
  // `0x0044E5BE` writes state 7, sub 0 and drops `obj+0x34` bit 0x100, and
  // touches no motion field at all. The landing clip is *meant* to still be
  // running, because `0x0044B29E` is `SetCurrentActorMotionBlended`, which is
  // unconditional -- the engine's one track means writing the idle is what
  // ends the leap's clip.
  //
  // The port called class 0x30's `ZombieSetMotionIfIdle` here instead, which
  // returns early while a one-shot is on `obj.action`. State 7 runs sub 0 on
  // exactly one frame, that frame arrived with the leap's landing clip live,
  // and so the idle was never set at all: stage 4's nine state-20 `zskamere`
  // held the pose they were spawned in -- their set's `IdleAlt`, the hang --
  // while standing on the floor.
  const oneShotAtHandover = z.action?.motion ?? -1;
  check("the landing clip is still running when it hands over",
        oneShotAtHandover === 300 && z.sub === 0,
        `action ${oneShotAtHandover} sub ${z.sub}`);
  GameUpdate(1 / 60, CAM_HOST, rng, events);
  // 313 is `g_class31_motion_sets[0][2]`, the set's walk -- the clip state 7
  // names on the ground.
  check("...and the first frame of the hub overwrites it with the set's walk",
        z.motion === 313 && z.action === null,
        `motion ${z.motion} action ${z.action?.motion ?? "null"}`);
}

// `FitArcScriptByFadeLength` (`FUN_0044D5F0`) and `FitArcScriptByStartFrame`
// (`FUN_0044E140`) are two routines with two slacks, and the port had one
// function standing in for both. Every expected value here is worked by hand
// from the listing, not from the port.
console.log("class 0x31, the two arc-script fits:");
{
  const fit = (script: typeof PATH_STYLE0, T: number, byStart = false) => {
    const a = thrower(ThrowerState.Idle);
    InstallArcMotionScript(a, script);
    a.arcTotal = T;
    if (byStart) FitArcScriptByStartFrame(a);
    else FitArcScriptByFadeLength(a);
    return a.arcScript!;
  };
  // slack = s1.start - s1.until + T = 9 - 17 + 19 = 11: both fades climb to
  // 6 and 6, twelve is past eleven, so stage 1 gives one back.
  let s = fit(PATH_STYLE0, 19);
  check("the fade fit grows both fades and gives the odd frame to stage 2",
        s[1].fade === 5 && s[2].fade === 6,
        `fades ${s[1].fade}, ${s[2].fade}`);
  s = fit(PATH_STYLE1, 24);
  check("...a slack of 24 splits evenly", s[1].fade === 12 && s[2].fade === 12,
        `fades ${s[1].fade}, ${s[2].fade}`);
  s = fit(PATH_STYLE0, 8);
  check("...a slack of 0 leaves the script alone",
        s[1].fade === 0 && s[2].fade === 0 && s[1].start === 9
        && s[1].until === 17, JSON.stringify(s[1]));
  // A slack the authored fades already cover: 10 - 12 + 5 = 3 against fades
  // of 4 and 6. The engine runs no increment and takes stage 1's fade down to
  // 3 -- `CMP EDI, ESI / JGE` then `DEC EDX` at 0x0044D68F. The old single
  // function measured this slack net of the fades, found it negative, and
  // walked stage 1's window instead.
  s = fit([{ motion: 301, start: 0, fade: 0, until: 5 },
           { motion: 301, start: 10, fade: 4, until: 12 },
           { motion: 301, start: 13, fade: 6, until: 20 }], 5);
  check("...and a slack inside the fades only trims stage 1's",
        s[1].fade === 3 && s[2].fade === 6 && s[1].start === 10
        && s[1].until === 12, JSON.stringify(s.slice(1)));
  // 9 - 17 + 4 = -4: both fades to 1, then stage 1's window closes from both
  // ends -- 10..16, 11..15, 12..14, 13..13 -- until it fits and is at most a
  // frame wide, and a window of nothing gives its start back.
  s = fit(PATH_STYLE0, 4);
  check("the tight branch resets both fades to 1 and closes stage 1",
        s[1].fade === 1 && s[2].fade === 1 && s[1].start === 12
        && s[1].until === 13, JSON.stringify(s.slice(1)));
  // zstin's: slack = 400 - 0 - 5 - 46 + 23 = 372, k = 186, and nothing clamps.
  s = fit(ARC(303), 400, true);
  check("the start-frame fit halves its slack onto both fades, unclamped",
        s[1].fade === 191 && s[2].fade === 186,
        `fades ${s[1].fade}, ${s[2].fade}`);
}

console.log("class 0x31, ThrowerStatePathFollow:");
{
  // Stage 2 block 14's zsass, descriptor 0x7EA4, verbatim out of the bundle:
  // wait 45 frames, then five legs over the rooftops -- the first at step 1
  // on style 3 (which is style 0), the other four at step 3 on style 1.
  const route = {
    delay: 45,
    points: [
      { step: 1, motion_set: 3, dest: [-984.199951171875, 23.599998474121094, -1087.5] as [number, number, number] },
      { step: 3, motion_set: 1, dest: [-984.0999755859375, 37.29999923706055, -1095.699951171875] as [number, number, number] },
      { step: 3, motion_set: 1, dest: [-979.2999877929688, 45.19999694824219, -1111] as [number, number, number] },
      { step: 3, motion_set: 1, dest: [-964.5, 47.69999694824219, -1114.89990234375] as [number, number, number] },
      { step: 3, motion_set: 1, dest: [-952.5, 27.599998474121094, -1114.5999755859375] as [number, number, number] },
    ],
  };
  // `ActorArcBeginTo`: n = (int)(dist2d * step), T = n - n % step.
  const t = thrower(ThrowerState.Idle);
  t.pos = vec3(...route.points[0].dest);
  ActorArcBeginTo(t, vec3(...route.points[1].dest), 3);
  check("a step-3 leg of 8.2 units is 24 parameter frames",
        t.arcTotal === 24, `T ${t.arcTotal}`);

  const rng = new Rng(14);
  const events = new Events();
  // `thrower()`'s scene without its zstin.
  ResetGameGlobals();
  SetGameTables(CHARS31);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
  EnterPlay();
  G.g_camera_yaw_bams = 0;
  const a = ActorSpawn(0x7ea4, SpawnClass.Thrower, 0x16, "zsass", {
    initialState: ThrowerState.PathFollow, condition: 0, path: route,
  });
  if (a.cls !== SpawnClass.Thrower) throw new Error("not class 0x31");
  a.visible = true;
  a.hp = 130;
  a.motion = 936;
  a.pos = vec3(-1003.7, 17.1, -1086.2);
  const start = { ...a.pos };
  let frame = 0;
  const ends: number[] = [];
  events.on("sound.play", (d) => {
    if (d.id === SND_PATH_LEG_LANDED) ends.push(frame);
  });
  // The pounce at the end lands in front of the camera, so put one where the
  // route comes down: on the street below its last roof.
  const roofEye = vec3(-952.5, 10.0, -1090.0);
  const roofHost = {
    ...NULL_HOST,
    viewPoint: (x: number, y: number, zz: number, out: Vec3) => {
      out.x = roofEye.x + x; out.y = roofEye.y + y; out.z = roofEye.z + zz;
    },
  };
  HoldCameraAt(roofEye);
  const pos: Vec3[] = [];
  const sub: number[] = [];
  const clip: number[] = [];
  const cursor: number[] = [];
  let immune = 0;
  for (; frame < 400 && a.state === ThrowerState.PathFollow; frame++) {
    GameUpdate(1 / 60, roofHost, rng, events);
    pos.push({ ...a.pos });
    sub.push(a.sub);
    clip.push(a.action?.motion ?? -1);
    cursor.push(ActorClipFrame(a));
    if (a.flags & ActorFlag.ShotImmune) immune += 1;
  }
  const same = (p: Vec3, q: Vec3, e = 1e-6) =>
    Math.abs(p.x - q.x) < e && Math.abs(p.y - q.y) < e && Math.abs(p.z - q.z) < e;
  // `DEC` then `JG`: the 45th update is the one that begins the first leg.
  check("it waits out the descriptor's 45 frames where it stands",
        sub[43] === 1 && sub[44] === 3 && pos.slice(0, 44).every((p) => same(p, start)),
        `sub ${sub[43]} -> ${sub[44]}`);
  check("...and winds up on the spot for style 0's first stage",
        pos.slice(44, 52).every((p) => same(p, start)) && clip[44] === 301,
        `clip ${clip[44]}`);
  check("five legs, and a footfall at the end of each",
        ends.length === 5, `${ends.length}: ${ends.join(", ")}`);
  // **The pace.** `ActorArcStep` flies the arc `step` parameter frames a
  // frame, so a step-3 leg of T lasts T/3 frames of flight, plus the frame it
  // begins on and the frame `ActorArcInterpolate` reports it over: 24/3 + 2,
  // 48/3 + 2, 45/3 + 2 and 36/3 + 2. The port flew one parameter frame a frame,
  // which made these 25, 49, 46 and 37 -- the "moves quite slowly" report.
  const legs = ends.slice(1).map((e, i) => e - ends[i]);
  check("each step-3 leg lasts T / 3 + 2 frames",
        legs.join() === "10,18,17,14", legs.join(", "));
  // 3 * 8.2006 / 24 on the ground each frame of the second leg's flight.
  let fastest = 0;
  for (let i = ends[0] + 2; i <= ends[1]; i++) {
    fastest = Math.max(fastest, dist2d(pos[i], pos[i - 1]));
  }
  check("...covering about a unit of ground a frame",
        Math.abs(fastest - 3 * 8.200609 / 24) < 1e-3, fastest.toFixed(4));
  check("every leg lands on its waypoint",
        ends.every((e, k) => same(pos[e], vec3(...route.points[k].dest), 1e-3)),
        ends.map((e) => `(${pos[e].x.toFixed(2)}, ${pos[e].y.toFixed(2)}, `
                        + `${pos[e].z.toFixed(2)})`).join(" "));
  // Style 1 is motion 301 held on frame 12 by three fade-1 stages, and the fit
  // grows the fades to cover the leg, so the clip never leaves the frame.
  const hop = clip.slice(ends[0] + 1, ends[4]);
  const hopAt = cursor.slice(ends[0] + 1, ends[4]);
  check("the four hops are clip 301 held on frame 12",
        hop.every((m) => m === 301) && hopAt.every((c) => c === 12),
        `${[...new Set(hop)].join()} at ${[...new Set(hopAt)].join()}`);
  // `OR AH, 0x1` at 0x0044EE3E and `AND CH, 0xFE` at 0x0044EF22; the arc's own
  // windup finds the bit already up and leaves it alone.
  check("it cannot be shot on the route, and can when it leaves it",
        immune === pos.length - 1 && (a.flags & ActorFlag.ShotImmune) === 0,
        `${immune} of ${pos.length}`);
  check("then it claims a permit and pounces",
        a.state === ThrowerState.Pounce && a.attackPermit !== -1,
        `state ${a.state} permit ${a.attackPermit}`);
  // `ThrowerStateLeapDown`: off the roof and into shot, at a place picked on
  // the *screen* -- 15.5 in front, 9.4 below.
  for (let i = 0; i < 300 && a.state === ThrowerState.Pounce; i++) {
    GameUpdate(1 / 60, roofHost, rng, events);
  }
  check("then it comes down off the roof, in front of the camera",
        Math.abs(a.pos.z - (roofEye.z - 15.5)) < 0.5 && a.pos.y < roofEye.y,
        `(${a.pos.x.toFixed(1)}, ${a.pos.y.toFixed(1)}, ${a.pos.z.toFixed(1)})`);
  check("...and the pounce hands to the leap aside",
        a.state === ThrowerState.LeapAside, `state ${a.state}`);
}

console.log("class 0x31, ThrowerStateWalkDistance:");
{
  const rng = new Rng(11);
  const events = new Events();
  const z = thrower(ThrowerState.WalkDistance, { walkDistance: 15 });
  const start = { ...z.pos };
  check("it starts in the entrance the descriptor names",
        z.state === ThrowerState.WalkDistance, `state ${z.state}`);
  let walked = 0;
  for (let i = 0; i < 600 && z.state === ThrowerState.WalkDistance; i++) {
    GameUpdate(1 / 60, CAM_HOST, rng, events);
    walked = Math.hypot(z.pos.x - start.x, z.pos.z - start.z);
  }
  // It stops on the frame it passes the distance, so it may overshoot by one
  // frame of the walk -- 2.08 units -- and no more.
  check("and stops within a frame of the fifteen units it names",
        walked >= 15 && walked < 15 + 2.2, `${walked.toFixed(2)}`);
  check("then it stands and decides",
        z.state === ThrowerState.StandAndDecide, `state ${z.state}`);
}

console.log("class 0x31, the climb:");
{
  const rng = new Rng(3);
  const events = new Events();
  const z = thrower(ThrowerState.StandAndDecide);
  // Band 1 is 40 < d <= 50, and the pick table there is nine parts climb.
  z.pos = vec3(0, 0, 45);
  z.yaw = 0;                             // facing the camera, which the gate needs

  // With no collision the search fails, and the engine's answer to that is to
  // refuse the state -- not to leap at nothing. It still pounces, because one
  // slot in ten of band 1's picks is the pounce and that needs no wall.
  T.coli = null;
  G.g_coli_full_set = [];
  let climbed = false;
  for (let i = 0; i < 300; i++) {
    GameUpdate(1 / 60, CAM_HOST, rng, events);
    if (z.state === ThrowerState.LeapToWallA
        || z.state === ThrowerState.LeapToWallB
        || z.state === ThrowerState.LeapToCeiling) climbed = true;
  }
  check("with nothing to climb it never enters a surface leap", !climbed,
        `state ${z.state}`);
  check("...and its stance is still the ground", z.thr.stance === 0
        && (z.flags2 & 0x1c0) === 0, `flags2 ${z.flags2.toString(16)}`);
  z.state = ThrowerState.StandAndDecide;
  z.sub = 0;
  z.flags2 = 0;
  z.pos = vec3(0, 0, 45);

  // Now give the level a wall in the plane x = 30 — a real quad, tested by the
  // real intersector — and the same search finds it.
  T.coli = { files: ["test"], blobs: { wall: WALL_BLOB, floor: FLOOR_BLOB } };
  G.g_coli_full_set = ["wall", "floor"];
  let sawLeap = false;
  for (let i = 0; i < 900; i++) {
    GameUpdate(1 / 60, CAM_HOST, rng, events);
    if (z.state === ThrowerState.LeapToWallA
        || z.state === ThrowerState.LeapToWallB
        || z.state === ThrowerState.LeapToCeiling) sawLeap = true;
    if ((z.flags2 & 0x1c0) !== 0) break;
  }
  check("given a wall it leaps at it", sawLeap, `state ${z.state}`);
  check("and arriving changes its stance off the ground",
        (z.flags2 & 0x1c0) !== 0 && (z.flags2 & 0x20) !== 0
        && ThrowerStanceOf(z) > 0,
        `flags2 0x${z.flags2.toString(16)} stance ${ThrowerStanceOf(z)}`);
  check("...and left it up on the wall", z.pos.y > 5,
        `y ${z.pos.y.toFixed(1)}`);
}

// **The descriptor's own flag word, which the exporter used to throw away.**
//
// `SpawnFromDescriptor` (`FUN_00408A20`) copies the spawn record's `+0x20`
// u16 into `obj+0x1316` before the class `Init` runs, and `EnemyThrowerInit`
// (`FUN_00449620`) makes it the low half of `obj+0x136C`:
//
//   00449762  MOVSX EAX, word ptr [ESI + 0x1316]   0fbf8616130000
//   00449769  OR    EAX, 0x180000                  0d00001800
//   0044977a  MOV   dword ptr [ESI + 0x136c], EAX  89866c130000
//
// That word has been called "unused in every shipped file". It
// is not: 23 of 51 class-0x31 and 76 of 345 class-0x30 descriptors set it, and
// the five stage-6 `zslman` that blink in on a wall or the ceiling get their
// whole stance from it and nowhere else. Dropping it gave all five stance 0 —
// the ground motion row, the ground attack row, the floor gravity axis, and no
// `OffGround`.
console.log("class 0x31, the stance the spawn descriptor names:");
{
  // The seam first: bundle field -> actor field. It is one hop and it is the
  // hop that was missing.
  const d = DescriptorFromPlacement({ desc_flags: 0x100 } as never);
  check("`desc_flags` reaches `Actor.descFlags` (`obj+0x1316`)",
        d.descFlags === 0x100, `${d.descFlags}`);
  check("a placement without one is zero, not undefined",
        DescriptorFromPlacement({} as never).descFlags === 0, "");

  // Then the three stances the shipped stage-6 spawns actually carry, and the
  // ground for contrast. `st6evtbl.bin` off=001604/001630/002680 are 0x100,
  // off=002654 is 0x40 and off=0026ac is 0x80 -- all character type 0x18
  // entering state 34.
  const cases: [number, number][] = [
    [0, ThrowerStance.Ground],
    [ThrowerFlag.WallA, ThrowerStance.WallA],
    [ThrowerFlag.WallB, ThrowerStance.WallB],
    [ThrowerFlag.Ceiling, ThrowerStance.Ceiling],
  ];
  for (const [word, want] of cases) {
    const z = thrower(ThrowerState.StandAndDecide, { descFlags: word });
    check(`descriptor word 0x${word.toString(16)} gives stance ${want}`,
          ThrowerStanceOf(z) === want,
          `flags2 0x${(z.flags2 >>> 0).toString(16)}`
          + ` stance ${ThrowerStanceOf(z)}`);
    check("...and the surface bits are the descriptor's own",
          (z.flags2 & ThrowerFlag.Surface) === word,
          `0x${(z.flags2 & ThrowerFlag.Surface).toString(16)}`);
    // `OR AL, 0x20` (`0c20`) on each of the three non-ground arms of the jump
    // table at 0x00449900; the ground arm at 0x004497A7 does not.
    check("...and only a non-ground stance is off the ground",
          !!(z.flags2 & ThrowerFlag.OffGround) === (want !== 0),
          `flags2 0x${(z.flags2 >>> 0).toString(16)}`);
    // `| 0x180000` is unconditional and comes after, so it survives whatever
    // the descriptor said.
    check("...and it is still born colliding",
          (z.flags2 & ThrowerFlag.Collide) === ThrowerFlag.Collide,
          `0x${(z.flags2 >>> 0).toString(16)}`);
  }

  // Bit 0 is the other bit the shipped data sets -- 18 of the 51 -- and it is
  // a draw selector, not a stance. It must not move the stance.
  {
    const z = thrower(ThrowerState.StandAndDecide,
                      { descFlags: ThrowerFlag.SceneLit });
    check("bit 0 carries through without changing the stance",
          (z.flags2 & ThrowerFlag.SceneLit) !== 0
          && ThrowerStanceOf(z) === ThrowerStance.Ground
          && (z.flags2 & ThrowerFlag.OffGround) === 0,
          `flags2 0x${(z.flags2 >>> 0).toString(16)}`);
  }

  // Two surface bits at once overflow the four-arm table: `CMP ECX, 0x3` /
  // `JA` (`83f903` / `7745`) at 0x0044979B skips the whole switch, so the
  // actor keeps the bits but gets neither `OffGround` nor a `+0x134C`. No
  // shipped descriptor does it; the arm is here because the engine has it.
  {
    const z = thrower(ThrowerState.StandAndDecide,
                      { descFlags: ThrowerFlag.WallA | ThrowerFlag.Ceiling });
    check("two surface bits at once fall out of the switch",
          (z.flags2 & ThrowerFlag.OffGround) === 0,
          `flags2 0x${(z.flags2 >>> 0).toString(16)}`);
  }
}

console.log("class 0x31, the pounce and the leap back:");
{
  const rng = new Rng(5);
  const events = new Events();
  let hits = 0;
  let overlayKind = -1;
  events.on("player.damaged", () => { hits++; overlayKind = G.g_player_damage_overlay_kind[0]; });
  const z = thrower(ThrowerState.StandAndDecide);
  z.pos = vec3(0, 0, 25);                // inside 30: the router goes straight to 8

  GameUpdate(1 / 60, CAM_HOST, rng, events);
  check("inside thirty units it stops deciding and waits for a permit",
        z.state === ThrowerState.WaitForPermit, `state ${z.state}`);

  let sawPounce = false;
  let closest = Infinity;
  let sawAside = false;
  for (let i = 0; i < 900; i++) {
    GameUpdate(1 / 60, CAM_HOST, rng, events);
    if (z.state === ThrowerState.Pounce) sawPounce = true;
    if (z.state === ThrowerState.LeapAside) sawAside = true;
    closest = Math.min(closest, dist2d(z.pos, EYE));
  }
  check("it takes the permit and pounces", sawPounce, `state ${z.state}`);
  // `ThrowerPickLandingPoint` puts it 15.5 in front of the camera, which is
  // the whole reason the stab connects without any range test.
  check("the leap puts it on the landing point, not at a range it chose",
        Math.abs(closest - 15.5) < 0.6, `closest ${closest.toFixed(2)}`);
  check("and the stab lands", hits > 0, `${hits} hits`);
  // Attack 0's `overlay_kind` is 2, attack 1's is 3: whichever it drew, the
  // reaction is the attack entry's, not a constant.
  check("with the reaction the attack entry names",
        overlayKind === 2 || overlayKind === 3, `motion ${overlayKind}`);
  check("then it leaps back out", sawAside, `state ${z.state}`);
  check("and the permit is free again for the next one",
        G.g_attack_permits.filter((p) => p !== -1).length <= 1,
        `${G.g_attack_permits.join()}`);
}

console.log("class 0x31, ThrowerStrikeConnect tests no range:");
{
  const rng = new Rng(9);
  const events = new Events();
  void rng;
  let hits = 0;
  events.on("player.damaged", () => hits++);
  const z = thrower(ThrowerState.StandAndDecide);
  z.pos = vec3(0, 0, 400);              // nowhere near the camera
  z.attackPermit = 0;
  G.g_attack_permits[0] = z.at;
  z.attack = 0;
  z.thr.stance = 0;
  z.action = { motion: 303, ticks: 62 };
  check("a swing on its hit frame connects from four hundred units away",
        ThrowerStrikeConnect(z, events) && hits === 1, `${hits} hits`);
  // ...and the cancel mask is the only thing that stops it.
  z.flags2 = 0;
  z.zones = 2;                          // attack 0 names zone 2, the right arm
  z.action = { motion: 303, ticks: 62 };
  RunOutInvulnerability();
  const before = hits;
  ThrowerStrikeConnect(z, events);
  check("but an attack whose zone has been shot off whiffs", hits === before,
        `${hits} vs ${before}`);
}

// `ThrowerStateLeapDown` (`FUN_0044B670`), states 9/12/13, and
// `ThrowerStateLeapAside` (`FUN_0044B880`), state 10, against the listing --
// and `ThrowerStrikeConnect` (`FUN_0044CE60`) and `ActorArcBeginToWaypoint`
// (`FUN_0044D780`), which the pounce runs every frame of.
console.log("class 0x31, states 9 and 10 -- the pounce and the leap back:");
{
  /** `zslman`'s leap-aside scripts: one clip cut 0..1, 2..21 and 22..43. */
  const ASIDE_ZSLMAN = (m: number) => [
    { motion: m, start: 0, fade: 5, until: 1 },
    { motion: m, start: 2, fade: 5, until: 21 },
    { motion: m, start: 22, fade: 0, until: 43 },
  ];
  const SET0 = CLASS31.sets[0]!;
  // What these states read that CHARS31 does not carry: the cry's pair, a
  // `zskamere`, `zslman`'s four leap-aside scripts and four landing clips, a
  // wall row for `zslman`'s forced attack 3, and set 0's throw-table row 0.
  const TABLES = {
    ...CHARS31,
    types: {
      ...CHARS31.types,
      "23": { ...TYPE31, type: 0x17, name: "zskamere" },
      "24": {
        ...TYPE31_ZSLMAN,
        motions: {
          ...TYPE31_ZSLMAN.motions,
          "491": motion(23), "505": motion(23), "495": motion(23),
          "513": motion(23),
          "523": motion(20), "526": motion(20), "529": motion(20),
          "532": motion(20),
        },
      },
    },
    class31: {
      ...CLASS31,
      sets: [{
        ...SET0,
        attacks: {
          ...SET0.attacks,
          "1": { ...SET0.attacks["1"],
                 "3": { script: ARC(299), hit_frame: 41, overlay_kind: 7,
                        cancel_mask: 8 } },
        },
        strikes: {
          "0": { strike: 9, lunge: 287, distance: 20, hit_frame: 48,
                 overlay_kind: 6, cancel_mask: 2 },
        },
      }],
      scripts: {
        ...CLASS31.scripts,
        aside_zslman_0: ASIDE_ZSLMAN(491), aside_zslman_1: ASIDE_ZSLMAN(505),
        aside_zslman_2: ASIDE_ZSLMAN(495), aside_zslman_3: ASIDE_ZSLMAN(513),
      },
    },
    combat: {
      impact: [], head_impact: [],
      voice: { hurt: [], kill: [], head: [],
               attack: [[{ id: 40, file: "" }, { id: 41, file: "" }],
                        [{ id: 50, file: "" }, { id: 51, file: "" }]] },
      voice_set_a_types: [], ricochet: {},
    },
  } as unknown as CharactersJson;

  const at = (type: number, state: ThrowerState) => {
    ResetGameGlobals();
    SetGameTables(TABLES);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
    G.g_camera_yaw_bams = 0;
    const a = ActorSpawn(0x9000, SpawnClass.Thrower, type, "t",
                         { initialState: state, condition: 0 });
    if (a.cls !== SpawnClass.Thrower) throw new Error("not class 0x31");
    a.visible = true;
    a.hp = 100;
    a.motion = 936;
    a.pos = vec3(0, 0, 80);
    a.yaw = 0;
    a.state = state;
    a.sub = 0;
    return a;
  };
  const near = (p: Vec3, q: Vec3) =>
    Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6
    && Math.abs(p.z - q.z) < 1e-6;
  const columns = (since: number) => G.g_sprite_effects.filter(
    (e) => e.id >= since && e.kind === SpriteEffectKind.DustAlt).length;
  // A seed whose first draw is under 5: set 0's intact picks then name
  // attack 0, the one every stance in the fixture has.
  let seed = 1;
  while (new Rng(seed).int(10) >= 5) seed++;

  // -- sub 0 -------------------------------------------------------------------
  {
    const z = at(0x19, ThrowerState.Pounce);
    z.flags &= ~(ActorFlag.ShotImmune | ActorFlag.BackingOff
                 | ActorFlag.Committed);
    z.flags2 = ThrowerFlag.WallA | ThrowerFlag.OffGround | ThrowerFlag.Struck
             | ThrowerFlag.ArcSuppressedShotImmune;
    ThrowerStateLeapDown(z, 1 / 60, new Rng(seed), CAM_HOST);
    check("the pounce raises 0x10000000 (`OR ECX` at 0x0044B6F0), not BackingOff",
          (z.flags & ActorFlag.Committed) !== 0
          && (z.flags & ActorFlag.BackingOff) === 0,
          `flags 0x${(z.flags >>> 0).toString(16)}`);
    check("...latches the wall's row, then takes the actor off the wall",
          z.state === ThrowerState.Pounce && z.sub === 1
          && z.thr.stance === ThrowerStance.WallA
          && (z.flags2 & (ThrowerFlag.Surface | ThrowerFlag.OffGround
                          | ThrowerFlag.Struck)) === 0,
          `sub ${z.sub} stance ${z.thr.stance} 0x${z.flags2.toString(16)}`);
    check("...and leaves bit 0x200 alone (`AND EAX, 0xfffff61f`)",
          (z.flags2 & ThrowerFlag.ArcSuppressedShotImmune) !== 0,
          `0x${z.flags2.toString(16)}`);
  }
  {
    // `zslman`: the draw is still taken inside `ActorArcBeginToWaypoint`,
    // then overwritten with 3; the wall stays; the start point is kept.
    const z = at(0x18, ThrowerState.Pounce);
    z.pos = vec3(3, 12, 70);
    z.flags2 = ThrowerFlag.WallA | ThrowerFlag.OffGround | ThrowerFlag.Struck;
    const rng = new Rng(8);
    const ref = new Rng(8);
    ref.int(10);
    ThrowerStateLeapDown(z, 1 / 60, rng, CAM_HOST);
    check("zslman's pounce takes the attack draw (`0x0044D7FC`) and swings 3",
          rng.state === ref.state && z.attack === 3,
          `attack ${z.attack} draws ${rng.state === ref.state ? 1 : "?"}`);
    check("...keeps its wall, dropping only the connect latch",
          z.sub === 1 && (z.flags2 & ThrowerFlag.WallA) !== 0
          && (z.flags2 & ThrowerFlag.OffGround) !== 0
          && (z.flags2 & ThrowerFlag.Struck) === 0,
          `sub ${z.sub} 0x${z.flags2.toString(16)}`);
    check("...and records where it left from in obj+0x13D8 (`0x0044B737`)",
          near(z.strikeStart, vec3(3, 12, 70)),
          `(${z.strikeStart.x}, ${z.strikeStart.y}, ${z.strikeStart.z})`);
  }
  {
    // The cry is `obj+0x32C == 0x2002`, the head's draw record.
    const cried = (slot: number) => {
      const z = at(0x19, ThrowerState.Pounce);
      z.boneSlot["2"] = slot;
      const heard: number[] = [];
      const ev = new Events();
      ev.on("sound.play", (d) => heard.push(d.id));
      ThrowerStateLeapDown(z, 1 / 60, new Rng(seed), CAM_HOST, ev);
      return heard.some((id) => id === 50 || id === 51);
    };
    check("a pounce with head slot 0x2002 cries out (`0x0044B709`)",
          cried(0x2002));
    check("...and one with any other head does not", !cried(0x2003));
  }

  // -- the flight, the landing and the exit -------------------------------------
  {
    const z = at(0x19, ThrowerState.Pounce);
    z.flags2 |= ThrowerFlag.Collide;
    const rng = new Rng(seed);
    const seq0 = G.g_sprite_effect_seq;
    let collideAtLanding = -1;
    let exitCursor = -1;
    let exitLength = -1;
    let exitOnClip = false;
    for (let i = 0; i < 400 && z.state === ThrowerState.Pounce; i++) {
      ActorAdvanceMotion(z, 1 / 60);
      const wasSub = z.sub;
      const cursor = ActorPlayCursor(z);
      const len = z.action ? MotionPlayLength(z, z.action.motion) : -1;
      const onClip = z.action !== null;
      ThrowerStateLeapDown(z, 1 / 60, rng, CAM_HOST);
      if (wasSub === 1 && z.sub === 2) {
        collideAtLanding = z.flags2 & ThrowerFlag.Collide;
      }
      if ((z.state as ThrowerState) === ThrowerState.LeapAside) {
        exitCursor = cursor;
        exitLength = len;
        exitOnClip = onClip;
      }
    }
    check("it lands with both collision bits down (`AND ECX, 0xffe7ffff`)",
          collideAtLanding === 0, `0x${collideAtLanding.toString(16)}`);
    check("...and leaves two frames short of the clip's end, the clip still on",
          exitOnClip && exitCursor === exitLength - 2,
          `cursor ${exitCursor} of ${exitLength}, on ${exitOnClip}`);
    check("...having dropped 0x10000000 and the connect latch on the way",
          (z.flags & ActorFlag.Committed) === 0
          && (z.flags2 & ThrowerFlag.Struck) === 0);
    // `ThrowerEmitGroundDust`'s column answers `0x20000000` with
    // `0x10000000` down -- the leap back, not the pounce.
    check("the pounce's landing raises no dust column", columns(seq0) === 0,
          `${columns(seq0)}`);
  }
  {
    // Training Mode holds the re-snap while `g_script_flags[0xF2]` is up.
    const snapped = (mode: GameMode, flag: number) => {
      const z = at(0x19, ThrowerState.Pounce);
      z.sub = 2;
      z.action = { motion: 303, ticks: 0 };
      z.pos = vec3(1, 2, 3);
      G.g_GameMode = mode;
      G.g_script_flags[0xf2] = flag;
      ThrowerStateLeapDown(z, 1 / 60, new Rng(1), CAM_HOST);
      return !near(z.pos, vec3(1, 2, 3));
    };
    check("sub 2 re-snaps to the landing point every frame",
          snapped(GameMode.Arcade, 1) && snapped(GameMode.Training, 0));
    check("...except in Training Mode with g_script_flags[0xF2] up (`0x0044B7EE`)",
          !snapped(GameMode.Training, 1));
    const z = at(0x19, ThrowerState.Pounce);
    z.sub = 4;
    ThrowerStateLeapDown(z, 1 / 60, new Rng(1), CAM_HOST);
    check("a sub past 3 does nothing (`JA 0x0044B861`)",
          z.state === ThrowerState.Pounce && z.sub === 4, `state ${z.state}`);
  }

  // -- ThrowerStrikeConnect -------------------------------------------------------
  {
    const z = at(0x19, ThrowerState.StandAndDecide);
    z.attackPermit = 0;
    G.g_attack_permits[0] = z.at;
    z.attack = 0;
    z.thr.stance = 0;
    let hits = 0;
    const ev = new Events();
    ev.on("player.damaged", () => hits++);
    z.action = { motion: 303, ticks: 63 };
    ThrowerStrikeConnect(z, ev);
    check("a swing one frame past its hit frame does not connect "
          + "(`CMP EDX, ECX` at 0x0044CE9F is ==)", hits === 0, `${hits}`);
    RunOutInvulnerability();
    let h0 = hits;
    z.flags2 |= ThrowerFlag.Struck;
    z.action = { motion: 303, ticks: 62 };
    ThrowerStrikeConnect(z, ev);
    check("...and 0x800 is the caller's to test: the connect lands through it",
          hits === h0 + 1, `${hits - h0}`);
    RunOutInvulnerability();
    h0 = hits;
    z.flags2 = ThrowerFlag.UseThrowTable;
    z.action = { motion: 9, ticks: 48 };
    ThrowerStrikeConnect(z, ev);
    check("with 0x400 up it lands on g_class31_throws' frame and overlay",
          hits === h0 + 1 && G.g_player_damage_overlay_kind[0] === 6
          && (z.flags2 & ThrowerFlag.Struck) === 0,
          `${hits - h0} hits, overlay ${G.g_player_damage_overlay_kind[0]}`);
    z.flags2 = 0;
    z.attackPermit = -1;
    z.flags |= ActorFlag.StrikeAndLeave;
    z.action = { motion: 303, ticks: 62 };
    ThrowerStrikeConnect(z, ev);
    check("the despawning arm leaves even with no player to hit",
          z.despawned && (z.flags2 & ThrowerFlag.Struck) !== 0,
          `despawned ${z.despawned}`);
  }

  // -- ThrowerStateLeapAside -------------------------------------------------------
  {
    const z = at(0x19, ThrowerState.LeapAside);
    z.flags &= ~(ActorFlag.BackingOff | ActorFlag.NoHitReaction);
    z.flags2 &= ~ThrowerFlag.Collide;
    ThrowerStateLeapAside(z, 1 / 60, new Rng(2), CAM_HOST);
    check("the leap back raises 0x20000000 and both collision bits "
          + "(`0x0044B8BA`)",
          z.sub === 1 && (z.flags & ActorFlag.BackingOff) !== 0
          && (z.flags2 & ThrowerFlag.Collide) === ThrowerFlag.Collide
          && (z.flags & ActorFlag.NoHitReaction) === 0,
          `sub ${z.sub} 0x${(z.flags >>> 0).toString(16)} `
          + `0x${z.flags2.toString(16)}`);
    const k = at(0x17, ThrowerState.LeapAside);
    k.flags &= ~ActorFlag.NoHitReaction;
    k.attack = 0;
    ThrowerStateLeapAside(k, 1 / 60, new Rng(2), CAM_HOST);
    check("zskamere raises 0x2000 as well, and is given no script "
          + "(`JZ 0x0044BAE7`)",
          (k.flags & ActorFlag.NoHitReaction) !== 0 && k.arcScript === null,
          `script ${k.arcScript?.[0]?.motion}`);
  }
  {
    // `zslman` leaps back to where `ThrowerStateLeapDown` said it left from.
    const z = at(0x18, ThrowerState.LeapAside);
    z.flags2 = ThrowerFlag.WallB | ThrowerFlag.OffGround;
    z.strikeStart.x = 7;
    z.strikeStart.y = 30;
    z.strikeStart.z = 90;
    const rng = new Rng(5);
    const s0 = rng.state;
    ThrowerStateLeapAside(z, 1 / 60, rng, CAM_HOST);
    check("zslman leaps back to where it pounced from, drawing no side",
          near(z.arcTo, vec3(7, 30, 90)) && rng.state === s0,
          `to (${z.arcTo.x}, ${z.arcTo.y}, ${z.arcTo.z})`);
    check("...on its own wall's script", z.arcScript?.[0]?.motion === 495,
          `${z.arcScript?.[0]?.motion}`);
    for (let i = 0; i < 400 && z.sub === 1; i++) {
      ActorAdvanceMotion(z, 1 / 60);
      ThrowerStateLeapAside(z, 1 / 60, rng, CAM_HOST);
    }
    check("...and lands into that wall's own clip, 0x20E (`0x0044BBC6`)",
          z.sub === 2 && z.motion === 0x20e && z.action === null,
          `sub ${z.sub} motion 0x${z.motion.toString(16)}`);
    const w = at(0x18, ThrowerState.LeapAside);
    w.flags2 = ThrowerFlag.WallB | ThrowerFlag.Ceiling;
    ThrowerStateLeapAside(w, 1 / 60, new Rng(5), CAM_HOST);
    check("...and a row the switch does not name takes the default arm",
          w.arcScript?.[0]?.motion === 491, `${w.arcScript?.[0]?.motion}`);
  }
  {
    // The landing clip is set outright, over the arc's own clip, at fade 1,
    // and the landing is where the column goes up.
    const z = at(0x19, ThrowerState.LeapAside);
    const rng = new Rng(6);
    const seq0 = G.g_sprite_effect_seq;
    let landed = false;
    let drew = true;
    let motionAfter = -1;
    let oneShotAfter = true;
    for (let i = 0; i < 400 && z.sub < 2; i++) {
      if (z.sub === 1) ActorAdvanceMotion(z, 1 / 60);
      const was = z.sub;
      const before = rng.state;
      ThrowerStateLeapAside(z, 1 / 60, rng, CAM_HOST);
      if (was === 1 && z.sub === 2) {
        landed = true;
        drew = rng.state !== before;
        motionAfter = z.motion;
        oneShotAfter = z.action !== null;
      }
    }
    check("the leap back lands straight into the set's landing clip "
          + "(`SetCurrentActorMotionBlended` at 0x0044BB84)",
          landed && motionAfter === 283 && !oneShotAfter,
          `motion ${motionAfter}, one-shot ${oneShotAfter}`);
    check("...drawing nothing on the way", landed && !drew);
    check("...and its landing puts up the dust column", columns(seq0) === 1,
          `${columns(seq0)}`);
  }
  {
    const z = at(0x19, ThrowerState.LeapAside);
    z.sub = 2;
    z.pos = vec3(0, 0, 20);                // inside fifty units
    z.action = null;
    z.motion = 283;                        // 16 frames, play length 30
    z.playTicks = 30;
    z.thr.sinceLanding = 0x59;
    ThrowerStateLeapAside(z, 1 / 60, new Rng(1), CAM_HOST);
    check("the pause is ninety frames counted with >= (`JGE` at 0x0044BBFF)",
          z.state === ThrowerState.StandAndDecide, `state ${z.state}`);
    const y = at(0x19, ThrowerState.LeapAside);
    y.sub = 2;
    y.pos = vec3(0, 0, 80);                // clear of the camera
    y.action = null;
    y.motion = 283;
    y.playTicks = 27;
    ThrowerStateLeapAside(y, 1 / 60, new Rng(1), CAM_HOST);
    const waited = y.state === ThrowerState.LeapAside;
    y.playTicks = 28;
    ThrowerStateLeapAside(y, 1 / 60, new Rng(1), CAM_HOST);
    check("...and clear or not it waits for the cursor to reach length - 2",
          waited && y.state === ThrowerState.StandAndDecide,
          `waited ${waited} state ${y.state}`);
    const q = at(0x19, ThrowerState.LeapAside);
    q.sub = 3;
    q.pos = vec3(0, 0, 80);
    q.motion = 283;
    q.playTicks = 28;
    ThrowerStateLeapAside(q, 1 / 60, new Rng(1), CAM_HOST);
    check("a sub past 2 does nothing (`RET` at 0x0044B8A8)",
          q.state === ThrowerState.LeapAside, `state ${q.state}`);
  }
}


// `ThrowerStateDelayedPounce` (`FUN_0044E830`), state 23, against the exe's
// three subs. Stage 2 block 21's pair: motion 310 over 45 frames, set 0.
console.log("class 0x31, state 23 -- the wait, then the pounce at eye height:");
{
  // `g_class31_melee_attacks` set 0's pounce rows (stance 4), verbatim: clip
  // 289 cut 25..34, 34..66, 67..90, both hands hitting on 66. Row 0 hits on
  // 62 and 64, which is the point -- the connect reads a different row.
  const POUNCE_ARC = [
    { motion: 289, start: 25, fade: 5, until: 34 },
    { motion: 289, start: 34, fade: 5, until: 66 },
    { motion: 289, start: 67, fade: 5, until: 90 },
  ];
  const set0 = CLASS31.sets[0];
  const chars = {
    ...CHARS31,
    types: {
      ...CHARS31.types,
      "25": {
        ...TYPE31,
        motions: {
          ...TYPE31.motions,
          // The wait: a walk, and -- unlike the shipped 310, whose root height
          // is flat -- one whose root rises, so the bit-0x10 arm can be seen.
          "310": { ...motion(16, 0.45),
                   root: Array.from({ length: 48 }, (_, i) =>
                     i % 3 === 1 ? 0.25 * Math.floor(i / 3)
                       : i % 3 === 2 ? -0.45 * Math.floor(i / 3) : 0) },
          "289": motion(58),
        },
      },
    },
    class31: {
      ...CLASS31,
      sets: [{
        ...set0,
        attacks: {
          ...set0.attacks,
          "4": {
            "0": { script: POUNCE_ARC, hit_frame: 66, overlay_kind: 2,
                   cancel_mask: 2 },
            "1": { script: POUNCE_ARC, hit_frame: 66, overlay_kind: 3,
                   cancel_mask: 4 },
          },
        },
      }],
    },
  } as unknown as CharactersJson;

  // An eye twelve units up, so `g_camera_eye_y` and the actor's own tracked
  // point (`obj.lookAt`, at the origin) cannot be mistaken for each other.
  const eye = vec3(0, 12, 0);
  const host = {
    ...CAM_HOST,
    viewPoint: (x: number, y: number, z: number, out: Vec3) => {
      out.x = eye.x + x; out.y = eye.y + y; out.z = eye.z - z;
    },
  };
  const rng = new Rng(23);
  const events = new Events();
  let cursorAtHit = -1;
  let vetoAtHit = true;
  events.on("player.damaged", () => {
    cursorAtHit = ActorClipFrame(z);
    vetoAtHit = (z.flags & ActorFlag.NoHitReaction) !== 0;
  });
  const z = thrower(ThrowerState.DelayedPounce,
                    { pounce: { motion: 310, frames: 45 } });
  SetGameTables(chars);
  G.g_max_attackers = 1;
  // The lens twelve up, so the gameplay eye the hook writes is at -3.
  HoldCameraAt(eye);

  GameUpdate(1 / 60, host, rng, events);
  check("sub 0 falls into sub 1 on its own frame, and counts it",
        z.sub === 1 && z.slideTimer === 44, `sub ${z.sub} timer ${z.slideTimer}`);
  check("obj+0x1F8 |= 0x10 -- the wait clip carries the root's height",
        (z.motionFlags & MotionFlag.RootMotionY) !== 0,
        `0x${z.motionFlags.toString(16)}`);
  check("obj+0x34 |= 0x100 -- the wait cannot be shot",
        (z.flags & ActorFlag.ShotImmune) !== 0,
        `0x${(z.flags >>> 0).toString(16)}`);
  check("the wait clip is the ordinary motion, not a one-shot",
        z.motion === 310 && z.action === null,
        `motion ${z.motion} action ${JSON.stringify(z.action)}`);

  // A shot during the wait ricochets: the state does not move.
  ResolveHit(z, 4, host, rng);
  GameUpdate(1 / 60, host, rng, events);
  check("a shot in the wait neither reacts nor interrupts it",
        z.state === ThrowerState.DelayedPounce && z.sub === 1
        && z.slideTimer === 43, `state ${z.state} sub ${z.sub}`);

  const y0 = z.pos.y;
  const z0 = z.pos.z;
  for (let i = 0; i < 42; i++) GameUpdate(1 / 60, host, rng, events);
  check("frame 44: still waiting", z.sub === 1 && z.slideTimer === 1,
        `sub ${z.sub} timer ${z.slideTimer}`);
  // Sixteen authored frames are 30 cursor ticks; forty frames in it is on its
  // second cycle and has not dropped back to anything else.
  check("the clip loops for the whole wait", z.motion === 310
        && z.action === null && ActorPlayCursor(z) < 30,
        `motion ${z.motion} cursor ${ActorPlayCursor(z)}`);
  check("and its root walks the actor and lifts it",
        z.pos.z < z0 - 5 && z.pos.y > y0 + 2,
        `z ${z0.toFixed(2)} -> ${z.pos.z.toFixed(2)}, `
        + `y ${y0.toFixed(2)} -> ${z.pos.y.toFixed(2)}`);

  GameUpdate(1 / 60, host, rng, events);
  check("frame 45: the counter runs out and it falls through to sub 2",
        z.sub === 2 && z.state === ThrowerState.DelayedPounce, `sub ${z.sub}`);
  // Sub 1 drops both bits (`0x0044E8BA`), and the same frame's fall into
  // `ActorArcStep` puts `0x100` straight back up for the windup: phase 0 at
  // `0x0044D8A4`..`0x0044D8BE`, types 0x16..0x19 outside state 10. It latches
  // `obj+0x136C` bit `0x200` only if `0x100` was already up, and it was not.
  check("...with the wait's height bit down and the windup shot-proof",
        (z.motionFlags & MotionFlag.RootMotionY) === 0
        && (z.flags & ActorFlag.ShotImmune) !== 0
        && (z.flags2 & ThrowerFlag.ArcSuppressedShotImmune) === 0
        && z.arcPhase === ArcPhase.Crouched,
        `motion 0x${z.motionFlags.toString(16)} `
        + `flags 0x${(z.flags >>> 0).toString(16)} phase ${z.arcPhase}`);
  check("obj+0x34 |= 0x10000000, not BackingOff's 0x20000000",
        (z.flags & ActorFlag.Committed) !== 0
        && (z.flags & ActorFlag.BackingOff) === 0,
        `0x${(z.flags >>> 0).toString(16)}`);
  check("obj+0x136C |= 0x20000, and it holds the permit it claimed",
        (z.flags2 & ThrowerFlag.Pouncing) !== 0 && z.attackPermit === 0
        && G.g_attack_permits[0] === z.at,
        `flags2 0x${(z.flags2 >>> 0).toString(16)} permit ${z.attackPermit}`);
  check("the script is the pounce row's -- clip 289, stage 0 at 25",
        z.arcScript?.[0].motion === 289 && z.arcScript?.[0].start === 25,
        JSON.stringify(z.arcScript?.[0]));
  check("ThrowerLoadAttackArcScript latches no stance into obj+0x1364",
        z.thr.stance === 0, `stance ${z.thr.stance}`);
  // `ThrowerPickLandingPoint`'s state-23 arm: six units out, not 15.5, and
  // then `g_camera_eye_y` in place of the height it computed -- the gameplay
  // eye the hold hook wrote, fifteen under the lens, not the lens's 12.
  check("it aims six units in front of the eye, at the eye's own height",
        Math.abs(z.arcTo.x) < 1e-9 && Math.abs(z.arcTo.z - 6) < 1e-9
        && G.g_camera_eye.y === eye.y - 15
        && z.arcTo.y === G.g_camera_eye.y && z.arcTotal === 45,
        `to (${z.arcTo.x}, ${z.arcTo.y}, ${z.arcTo.z}) over ${z.arcTotal}, `
        + `g_camera_eye.y ${G.g_camera_eye.y}`);

  let vetoCursor = -1;
  let flightFrames = 0;
  let immuneInFlight = false;
  let frames = 0;
  while (z.state === ThrowerState.DelayedPounce && frames++ < 400) {
    const had = (z.flags & ActorFlag.NoHitReaction) !== 0;
    GameUpdate(1 / 60, host, rng, events);
    if (!had && (z.flags & ActorFlag.NoHitReaction) !== 0) {
      vetoCursor = ActorPlayCursor(z);
    }
    if (z.arcPhase === ArcPhase.Flight) {
      flightFrames++;
      if (z.flags & ActorFlag.ShotImmune) immuneInFlight = true;
    }
  }
  // ...and the takeoff drops it, with `0x200` clear (`0x0044D966`..`D977`).
  check("the takeoff takes the windup's immunity down",
        flightFrames > 0 && !immuneInFlight,
        `${flightFrames} flight frames, immune ${immuneInFlight}`);
  // The connect reads `obj+0x1364` -- row 0 -- and the veto the live stance
  // -- row 4. Both halves of the same state, on different rows.
  const row0 = set0.attacks["0"][String(z.attack) as "0" | "1"].hit_frame;
  check("the stab lands on row 0's hit frame, through obj+0x1364",
        cursorAtHit === row0, `hit at cursor ${cursorAtHit}, row 0 ${row0}`);
  // Stage 2 starts on 67 and holds there through its fade, so 67 is the
  // first cursor past row 4's 66. A row-0 reading would raise it at 63 or 65.
  check("...before the flinch veto, which waits for row 4's 66",
        !vetoAtHit && vetoCursor === 67, `veto at cursor ${vetoCursor}`);
  check("the arc ends in ThrowerStateWithdraw",
        z.state === ThrowerState.Withdraw && z.sub === 0, `state ${z.state}`);
  check("...with 0x10000000 and 0x20000 taken down on the way out",
        (z.flags & ActorFlag.Committed) === 0
        && (z.flags2 & ThrowerFlag.Pouncing) === 0,
        `flags 0x${(z.flags >>> 0).toString(16)} `
        + `flags2 0x${(z.flags2 >>> 0).toString(16)}`);
}

// `ThrowerPickLandingPoint` (`FUN_0044CBA0`) switches on the **state**, not
// only on the character type -- every arm, through a host that is the
// identity with -z in front.
console.log("class 0x31, ThrowerPickLandingPoint's arms:");
{
  const z = thrower(ThrowerState.StandAndDecide);
  const host = {
    ...NULL_HOST,
    viewPoint: (x: number, y: number, zz: number, out: Vec3) => {
      out.x = x; out.y = y; out.z = -zz;
    },
  };
  const out = vec3();
  const at = (state: number, charType: number, permit: number,
              attackers: number) => {
    z.state = state; z.charType = charType; z.attackPermit = permit;
    G.g_max_attackers = attackers;
    ThrowerPickLandingPoint(z, host, out);
    return { x: out.x, y: out.y, z: out.z };
  };
  // `g_projection_distance_px`, `[proved]` 240 / tan(0.35866388296751145) =
  // 640.2079 from `SetupSceneProjection`'s listing.
  const PX = G_PROJECTION_DISTANCE_PX;
  check("g_projection_distance_px is SetupSceneProjection's 240 / tan(20.55 deg)",
        Math.abs(PX - 640.2079) < 1e-4, `${PX}`);
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  let p = at(ThrowerState.PounceNear, 0x19, 0, 1);
  check("an ordinary leap: 320px down at -15.5, one attacker, no side",
        near(p.x, 0) && near(p.y, 320 * -15.5 / PX) && near(p.z, 15.5),
        JSON.stringify(p));
  p = at(ThrowerState.PounceNear, 0x16, 0, 1);
  check("zsass drops further, 390px", near(p.y, 390 * -15.5 / PX),
        JSON.stringify(p));
  p = at(ThrowerState.LeapStrike, 0x16, 0, 1);
  check("state 22: -350px whatever the type, at -15.5",
        near(p.y, -350 * -15.5 / PX) && near(p.z, 15.5), JSON.stringify(p));
  p = at(ThrowerState.DelayedPounce, 0x19, 0, 1);
  check("state 23: -350px at -6.0",
        near(p.y, -350 * -6 / PX) && near(p.z, 6), JSON.stringify(p));
  p = at(ThrowerState.PounceNear, 0x19, 0, 2);
  check("two attackers: player 0's holder lands 160px to one side",
        near(p.x, 160 * -15.5 / PX), JSON.stringify(p));
  p = at(ThrowerState.PounceNear, 0x19, 1, 2);
  check("...player 1's to the other", near(p.x, -160 * -15.5 / PX),
        JSON.stringify(p));
  p = at(ThrowerState.PounceNear, 0x19, -1, 2);
  check("...and no permit in the middle", near(p.x, 0), JSON.stringify(p));
}

// `SkeletonApplyRootMotion`'s bit-0x10 arm (`TEST [model+0x64], 0x10` at
// `0x00410DB0`): the height moves the actor only with the bit up.
console.log("root motion: model+0x64 bit 0x10 carries the height:");
{
  const z = thrower(ThrowerState.StandAndDecide);
  z.pos = vec3(0, 3, 50);
  z.motionFlags = MOTION_FLAGS_INIT;
  ApplyRootMotion(z, 0, 1, 2);
  check("without the bit the height is left alone",
        z.pos.y === 3 && z.pos.z !== 50, `y ${z.pos.y} z ${z.pos.z}`);
  z.motionFlags |= MotionFlag.RootMotionY;
  ApplyRootMotion(z, 0, 0, 2);
  check("with it, the actor rises by the delta times its scale",
        z.pos.y === 3 + 2 * z.scale, `y ${z.pos.y} scale ${z.scale}`);
  z.motionFlags &= ~MotionFlag.RootMotion;
  ApplyRootMotion(z, 0, 0, 2);
  check("and bit 1 still gates the whole arm", z.pos.y === 3 + 2 * z.scale,
        `y ${z.pos.y}`);
}

// ...and the delta is turned by **all three** angles first:
// `T · Rz(obj+0x6C) · Ry(obj+0x68) · Rx(obj+0x64) · S`, `0x00410D56` to
// `0x00410D9B`. It used to be turned by yaw alone. L48: a quarter turn on
// each axis, where a wrong axis, sign or order all show.
console.log("root motion: the delta is turned by roll, yaw and pitch:");
{
  const z = thrower(ThrowerState.StandAndDecide);
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
  const put = (pitch: number, yaw: number, roll: number, flags: number) => {
    z.pos = vec3(10, 20, 30);
    z.pitch = pitch; z.yaw = yaw; z.roll = roll;
    z.motionFlags = flags;
  };
  const at = () => `(${z.pos.x.toFixed(4)}, ${z.pos.y.toFixed(4)}, `
    + `${z.pos.z.toFixed(4)})`;
  const WITH_Y = MOTION_FLAGS_INIT | MotionFlag.RootMotionY;

  // Stage 2 block 21's pair, as their spawn record places them.
  put(0, 0xc000, 0xc000, WITH_Y);
  ApplyRootMotion(z, 0, -7, 0);
  check("rolled onto a wall (yaw and roll 0xC000), the clip's -Z is world -Y",
        near(z.pos.x, 10) && near(z.pos.y, 13) && near(z.pos.z, 30), at());
  put(0, 0xc000, 0xc000, MOTION_FLAGS_INIT);
  ApplyRootMotion(z, 0, -7, 0);
  check("...and with bit 0x10 down the same step goes nowhere at all",
        near(z.pos.x, 10) && near(z.pos.y, 20) && near(z.pos.z, 30), at());
  put(0, 0xc000, 0xc000, WITH_Y);
  ApplyRootMotion(z, -1.75, 0, 0);
  check("...where the clip's sideways sway runs along the wall, in z",
        near(z.pos.x, 10) && near(z.pos.y, 20) && near(z.pos.z, 28.25), at());

  // Upright: yaw alone, which is the old formula and has to survive.
  put(0, 0x4000, 0, MOTION_FLAGS_INIT);
  ApplyRootMotion(z, 0, -7, 0);
  check("upright, a quarter yaw takes -Z to -X, exactly as it always did",
        near(z.pos.x, 3) && near(z.pos.y, 20) && near(z.pos.z, 30), at());
  put(0x4000, 0, 0, WITH_Y);
  ApplyRootMotion(z, 0, -7, 0);
  check("a quarter pitch takes -Z to +Y", near(z.pos.x, 10)
        && near(z.pos.y, 27) && near(z.pos.z, 30), at());
  // Pitch first, then yaw: +X under Rx is +X, and Ry(0x4000) takes that to
  // -Z. Yaw first and pitch after would take it to +Y instead.
  put(0x4000, 0x4000, 0, WITH_Y);
  ApplyRootMotion(z, 1, 0, 0);
  check("the pitch is applied before the yaw, not after it",
        near(z.pos.x, 10) && near(z.pos.y, 20) && near(z.pos.z, 29), at());
}

// Stage 2 block 21 step 2's two `zstin`, from the placement to the leap:
// `SpawnFromDescriptor` (`FUN_00408A20`) copies the record's orientation --
// `(0, 0xC000, 0xC000)` -- to `obj+0x64..0x6C`, `ThrowerStateDelayedPounce`
// (`FUN_0044E830`) plays motion 310 with bit 0x10 up for 45 frames, and the
// root the clip carries along its -Z is a climb down the wall.
console.log("class 0x31, state 23 -- the wall-climbers climb down the wall:");
{
  // Motion 310 as `szom.bin` ships it: sixteen frames, a flat root height of
  // 5.26, a sway of up to 1.75 sideways and 7.19 along -Z.
  const ROOT_310 = [
    0, 5.2569, 0, -0.06, 5.2569, -0.4957, -0.2209, 5.2569, -0.9915,
    -0.4537, 5.2569, -1.4872, -0.7298, 5.2569, -1.9829, -1.0202, 5.2569,
    -2.4787, -1.2963, 5.2569, -2.9744, -1.5291, 5.2569, -3.4701, -1.69,
    5.2569, -3.9658, -1.75, 5.2569, -4.4616, -1.6204, 5.2569, -4.9573,
    -1.2963, 5.2569, -5.453, -0.875, 5.2569, -5.9487, -0.4537, 5.2569,
    -6.4445, -0.1296, 5.2569, -6.9402, -0.0344, 5.2569, -7.1881,
  ];
  const AT = 59548;
  const chars = {
    ...CHARS31,
    types: {
      ...CHARS31.types,
      "25": {
        ...TYPE31,
        motions: {
          ...TYPE31.motions,
          "310": { ...motion(16, 0, 29), root: ROOT_310 },
          "289": motion(58),
          "936": motion(20),
        },
      },
    },
    // Set 0's pounce rows (stance 4) as the game ships them, so the leap has
    // an arc script to ride: clip 289 cut 25..34, 34..66, 67..90.
    class31: {
      ...CLASS31,
      sets: [{
        ...CLASS31.sets[0],
        attacks: {
          ...CLASS31.sets[0].attacks,
          "4": Object.fromEntries(["0", "1"].map((k) => [k, {
            script: [
              { motion: 289, start: 25, fade: 5, until: 34 },
              { motion: 289, start: 34, fade: 5, until: 66 },
              { motion: 289, start: 67, fade: 5, until: 90 },
            ],
            hit_frame: 66, overlay_kind: 2, cancel_mask: 2,
          }])),
        },
      }],
    },
    // The exporter's row for it, and the two keys this fix added.
    placements: [{
      at: AT, class: 0x31, char_type: 25, motion: 936, hp: 100,
      body_condition: 0, initial_state: ThrowerState.DelayedPounce,
      attack_state: 0, ring_set: 0, yaw: 0xc000, roll: 0xc000,
      pounce: { motion: 310, frames: 45 },
    }],
  } as unknown as CharactersJson;

  ResetGameGlobals();
  SetGameTables(chars);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
  EnterPlay();
  G.g_max_attackers = 1;
  const [a] = SpawnScriptedCharacters(
    [{ at: AT, motion: 936, pos: vec3(-830.3, 163.9, -1289.8) }]);
  check("the spawn carries all three words of the record's orientation",
        !!a && a.pitch === 0 && a.yaw === 0xc000 && a.roll === 0xc000,
        a ? `${a.pitch}/${a.yaw}/${a.roll}` : "no actor");
  if (!a || a.cls !== SpawnClass.Thrower) throw new Error("no zstin");
  check("...and starts in state 23", a.state === ThrowerState.DelayedPounce,
        `state ${a.state}`);

  // The camera where the block's `finish_sequence` leaves it: path 33 at
  // frame 64, eye height 51 -- a hundred units below the pair.
  const eye = vec3(-766.8, 51, -1299.3);
  const host = {
    ...CAM_HOST,
    viewPoint: (x: number, y: number, zz: number, out: Vec3) => {
      out.x = eye.x + zz; out.y = eye.y + y; out.z = eye.z + x;
    },
  };
  HoldCameraAt(eye);
  const rng = new Rng(21);
  const events = new Events();
  const x0 = a.pos.x;
  const y0 = a.pos.y;
  let offWall = 0;
  let frames = 0;
  while (a.state === ThrowerState.DelayedPounce && a.sub !== 2
         && frames++ < 100) {
    GameUpdate(1 / 60, host, rng, events);
    if (a.sub !== 2) offWall = Math.max(offWall, Math.abs(a.pos.x - x0));
  }
  const climbed = y0 - a.pos.y;
  // Thirty cursor ticks a cycle, less the six the fade holds the start frame:
  // about 39 frames of a 7.19-unit cycle.
  check("the 45-frame wait climbs down the wall, not along the floor",
        frames === 45 && climbed > 8 && climbed < 10 && offWall < 1e-6,
        `${frames} frames, down ${climbed.toFixed(3)}, off the wall `
        + `${offWall.toFixed(6)}`);
  check("...and the leap starts from where the climb ended",
        a.arcFrom.y === a.pos.y && a.arcTo.y === G.g_camera_eye.y
        && G.g_camera_eye.y === eye.y - 15,
        `from ${a.arcFrom.y.toFixed(2)} to ${a.arcTo.y}`);
  // `TurnAngleToward(obj+0x6C, 0, 0xCCC)`: 0x4000 to go through the seam,
  // five steps and a sixth that lands.
  let level = -1;
  const rolls: string[] = [a.roll.toString(16)];
  for (let i = 1; i <= 10 && level < 0; i++) {
    GameUpdate(1 / 60, host, rng, events);
    rolls.push(a.roll.toString(16));
    if ((a.roll & 0xffff) === 0) level = i;
  }
  check("the roll comes back to level early in the leap",
        level > 0 && level <= 6, `level after ${level} frames: ${rolls}`);
}


// -- 13. class 0x31's own damage and death ----------------------------------

console.log("class 0x31, the stumble and the death chain:");
{
  const rng = new Rng(21);
  const events = new Events();
  const z = thrower(ThrowerState.StandAndDecide);
  z.pos = vec3(0, 0, 45);
  z.hp = 100;
  // A loop on track 0, at its start. A stumble below bone 9 plays on track 1
  // and lasts until **track 0's** cursor reaches its play length less one
  // (`ThrowerStateHitReaction`, `0x0044A3EA`), so a fixture whose loop has
  // no clip ends the stumble on the frame it starts.
  z.motion = 295;
  z.playTicks = 0;

  // `ResolveHit` hands class 0x31 a *pending hit* instead of the shared
  // stagger and the shared directional death: the class picks its own.
  ResolveHit(z, 4, CAM_HOST, rng);
  check("a shot leaves a pending hit rather than a stumble clip",
        !!z.pendingHit && z.react === null, `${JSON.stringify(z.pendingHit)}`);
  GameUpdate(1 / 60, CAM_HOST, rng, events);
  check("...which the next tick turns into its own state",
        z.state === ThrowerState.HitReaction
        || z.state === ThrowerState.FallAndLand, `state ${z.state}`);
  check("and the pending hit is drained", z.pendingHit === null);

  // Now kill it, and watch the whole chain rather than a death clip.
  z.state = ThrowerState.StandAndDecide;
  z.sub = 0;
  z.flags = 0;
  z.flags2 = 0;
  z.hp = 1;
  ResolveHit(z, 1, CAM_HOST, rng);
  check("the kill sets no directional death clip", z.death === null,
        `${JSON.stringify(z.death)}`);
  GameUpdate(1 / 60, CAM_HOST, rng, events);
  check("it falls instead", z.state === ThrowerState.FallAndLand,
        `state ${z.state}`);

  const seen = new Set<number>();
  for (let i = 0; i < 1200 && z.visible; i++) {
    GameUpdate(1 / 60, CAM_HOST, rng, events);
    seen.add(z.state);
  }
  check("the fall becomes a corpse", seen.has(ThrowerState.Corpse),
        [...seen].join());
  check("and the corpse despawns rather than lying there for ever",
        !z.visible && z.dead, `visible ${z.visible}`);
}

console.log("class 0x31, being knocked down is survivable:");
{
  const rng = new Rng(31);
  const events = new Events();
  const z = thrower(ThrowerState.StandAndDecide);
  z.pos = vec3(0, 0, 45);
  z.hp = 100;
  // A body shot on an actor that is *not* in the hub falls rather than
  // stumbles, and a fall it survives ends back at the hub.
  z.state = ThrowerState.LeapAside;
  z.sub = 0;
  ResolveHit(z, 1, CAM_HOST, rng);
  GameUpdate(1 / 60, CAM_HOST, rng, events);
  check("a shot outside the hub knocks it over",
        z.state === ThrowerState.FallAndLand, `state ${z.state}`);
  let recovered = false;
  for (let i = 0; i < 900; i++) {
    GameUpdate(1 / 60, CAM_HOST, rng, events);
    if (z.state === ThrowerState.StandAndDecide) { recovered = true; break; }
  }
  check("and it gets back up", recovered && !z.dead, `state ${z.state}`);
  check("with its hit points intact", z.hp > 0, `hp ${z.hp}`);
}

/**
 * **How far a shot `zsass` goes** -- reported against stage 2's block 5 step 6
 * (Original Mode), whose two `zsass` "get pushed back much too far by being
 * shot": held under fire they walked backwards off the walkway.
 *
 * Some of that push is the engine's own, and the numbers here are the
 * engine's. A knockdown is `ThrowerStateFallAndLand` (`FUN_0044A450`):
 *
 * * the arc `ThrowerBeginKnockbackArc` (`FUN_0044D120`) builds throws the
 *   body `t = 15.0 / |obj+0x70| * 10.0` units along the camera's own depth
 *   (`[0x004C4398]` = 15.0f, `[0x004C43A4]` = 10.0f) -- 150/45 here;
 * * sub 3 then plays `0x11B`, which in `szom.bin` is a back handspring whose
 *   root runs 21.43 units along its own +z. Root motion is on for every
 *   class-0x31 actor, so the body goes with it -- but only as far as sub 4
 *   lets the clip run: `g_motion_play_length[0x11B] - 2` = 27 on the cursor,
 *   and the draw that follows the hand-back takes it to 28, authored frame
 *   14 -- **20.3593** of the root, not the clip's last frame.
 *
 * And the end of the fall hands a `zsass` back with **thirty frames** of shot
 * immunity (`MOV [ESI+0x133C], 0x1e` / `OR AH, 0x1` at `0x0044A7EB`), which
 * the port forgot, so the next round knocked it straight down again.
 *
 * The actor faces a quarter turn round (L48): the handspring's travel is
 * then world +x and the arc's world +z, so each is measured on its own axis.
 */
console.log("class 0x31, how far a knocked-down zsass goes:");
{
  // `szom.bin` motion 0x11B's root track, as the bundle bakes it, and
  // `g_motion_play_length[0x11B]` = 29.
  const HANDSPRING = [
    0, 7.4452, 0, 0, 7.3737, 0.3161, 0, 7.3608, 0.6777, 0.0241, 7.3915, 0.241,
    -0.1094, 9.287, 0.9994, -0.3247, 12.0678, 3.1227, 0.0261, 11.6264, 5.2612,
    0.0563, 10.4954, 7.4827, 0.0266, 9.2097, 9.6385, 0, 8.3039, 11.5801,
    -0.002, 7.8577, 13.1024, -0.0015, 7.6589, 14.3476, -0.0002, 7.8042,
    15.6877, 0, 8.1077, 17.6252, 0, 7.5922, 20.3593, 0, 7.4452, 21.4343,
  ];
  // Authored frame 14's z less frame 0's: where sub 4's exit leaves it.
  const HOP = HANDSPRING[14 * 3 + 2] - HANDSPRING[2];
  const ZSASS_FLIP: CharacterType = {
    ...TYPE31_ZSASS,
    motions: {
      ...TYPE31_ZSASS.motions,
      "283": { bank: "szom.bin", frames: 16, fps: 30, root: HANDSPRING,
               rot: [], play: 29 },
      // Behaviour set 0's airborne clip, 26 frames, play length 50.
      "934": motion(26, 0, 50),
      // The stumble set 0 plays for bone 4, given a root that runs back a
      // unit a frame -- which is what a flinch played on the wrong track
      // would carry the body by.
      "935": motion(18, -1, 34),
    },
  };
  const SET = CLASS31.sets[0];
  const chars = {
    ...CHARS31,
    types: { ...CHARS31.types, "22": ZSASS_FLIP },
    // The router's picks all 7, so nothing after the hand-back moves it.
    class31: { ...CLASS31, sets: [{ ...SET, state_picks: {
      "1": new Array(80).fill(7), "2": new Array(80).fill(7) } }] },
  } as unknown as CharactersJson;
  const spawn = (state: number) => {
    ResetGameGlobals();
    SetGameTables(chars);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
    G.g_camera_yaw_bams = 0;
    const a = ActorSpawn(0x9100, SpawnClass.Thrower, 0x16, "zsass", {
      initialState: state, condition: 0,
    });
    if (a.cls !== SpawnClass.Thrower) throw new Error("not class 0x31");
    a.visible = true;
    a.hp = a.maxHp = 130;
    a.pos = vec3(0, 0, 45);
    a.yaw = 0x4000;
    return a;
  };

  // Knocked down out of any state but the hub -- here the wait for a permit,
  // entered by hand after the spawn, whose own entry state is the hub.
  const rng = new Rng(51);
  const events = new Events();
  const z = spawn(ThrowerState.StandAndDecide);
  z.state = ThrowerState.WaitForPermit;
  z.sub = 0;
  const x0 = z.pos.x;
  const z0 = z.pos.z;
  ResolveHit(z, 1, CAM_HOST, rng);
  GameUpdate(1 / 60, CAM_HOST, rng, events);
  check("a body shot outside the hub knocks a zsass down",
        z.state === ThrowerState.FallAndLand
        && (z.flags & KNOCKDOWN_BODY) !== 0,
        `state ${z.state}, flags ${z.flags.toString(16)}`);
  let n = 0;
  while (z.state === ThrowerState.FallAndLand && n++ < 400) {
    GameUpdate(1 / 60, CAM_HOST, rng, events);
  }
  // The frame it hands back: thirty frames of immunity, the knocked-down
  // bit gone.
  const cooldownAtExit = z.cooldown;
  const immuneAtExit = (z.flags & ActorFlag.ShotImmune) !== 0;
  const bodyBitAtExit = (z.flags & KNOCKDOWN_BODY) !== 0;
  // One more frame: the draw after the hand-back is the one that takes the
  // clip to authored frame 14.
  GameUpdate(1 / 60, CAM_HOST, rng, events);
  const dx = z.pos.x - x0;
  const dz = z.pos.z - z0;
  check("the knockback arc throws it 150/45 units along the camera's depth",
        Math.abs(dz - 150 / 45) < 1e-3, `dz ${dz.toFixed(4)}`);
  check("...and the handspring carries it 0x11B's root to authored frame 14",
        Math.abs(dx - HOP) < 1e-3,
        `dx ${dx.toFixed(4)}, want ${HOP.toFixed(4)} (the clip's last frame `
        + `is ${HANDSPRING[15 * 3 + 2]})`);
  check("it hands back to the hub shot-immune, the cooldown at thirty",
        z.state === ThrowerState.StandAndDecide && immuneAtExit
        && cooldownAtExit === 0x1e && !bodyBitAtExit,
        `state ${z.state}, immune ${immuneAtExit}, cooldown ${cooldownAtExit}, `
        + `body bit ${bodyBitAtExit}`);
  // Twenty-nine more updates -- thirty since the hand-back -- and the round
  // that lands is still refused; the thirtieth takes the bit down.
  for (let i = 0; i < 28; i++) GameUpdate(1 / 60, CAM_HOST, rng, events);
  const stillImmune = (z.flags & ActorFlag.ShotImmune) !== 0;
  GameUpdate(1 / 60, CAM_HOST, rng, events);
  check("...for thirty frames and no more",
        stillImmune && (z.flags & ActorFlag.ShotImmune) === 0
        && z.cooldown === 0, `after 29: ${stillImmune}, after 30: `
        + `${(z.flags & ActorFlag.ShotImmune) !== 0}, cooldown ${z.cooldown}`);

  // The stumble: a hub shot below bone 9 plays on track 1, which carries no
  // root, and lasts until **track 0's** loop reaches its play length less one.
  // The loop here is set 0's idle, 0x127 = 295, 31 frames and a play length
  // of 60, standing at cursor 50: nine frames from 59.
  const s = spawn(ThrowerState.StandAndDecide);
  s.sub = 1;
  s.motion = 295;
  s.playTicks = 50;
  const sx0 = s.pos.x;
  const sz0 = s.pos.z;
  ResolveHit(s, 4, CAM_HOST, rng);
  let frames = 0;
  let drift = 0;
  let onOneShot = false;
  do {
    GameUpdate(1 / 60, CAM_HOST, rng, events);
    frames += 1;
    drift = Math.max(drift, Math.hypot(s.pos.x - sx0, s.pos.z - sz0));
    if (s.state === ThrowerState.HitReaction && s.action) onOneShot = true;
  } while (s.state === ThrowerState.HitReaction && frames < 120);
  check("a hub shot on bone 4 stumbles on track 1 and does not move the body",
        !onOneShot && drift < 1e-9 && s.react?.motion === 0x3a7,
        `one-shot ${onOneShot}, drift ${drift.toFixed(4)}, `
        + `react ${s.react?.motion}`);
  check("...and is over when the loop underneath reaches its end: 9 frames, "
        + "not the stumble clip's 34", frames === 9, `${frames} frames`);
}

console.log("class 0x31, the scripted entrances:");
{
  const rng = new Rng(41);
  const events = new Events();
  // Stage 6's `zslman` blink in: three hops from 90 units out, 30 apart.
  const z = thrower(ThrowerState.BlinkIn, { backAwayDelay: 0, attackState: 7 });
  z.pos = vec3(0, 0, 45);
  z.yaw = 0;
  const origin = { ...z.pos };
  check("it starts in the entrance", z.state === ThrowerState.BlinkIn,
        `state ${z.state}`);
  const hops: number[] = [];
  for (let i = 0; i < 300 && z.state === ThrowerState.BlinkIn; i++) {
    GameUpdate(1 / 60, CAM_HOST, rng, events);
    const d = Math.round(Math.hypot(z.pos.x - origin.x, z.pos.z - origin.z));
    if (hops[hops.length - 1] !== d) hops.push(d);
  }
  // With a delay of 0 the first hop lands on the entry frame itself, so the
  // origin never shows up in the trace.
  check("three hops, at 90, 60 and 30 units from where it appeared",
        hops.join() === "90,60,30", hops.join());
  check("then it hands to the state its descriptor names",
        z.state === ThrowerState.StandAndDecide, `state ${z.state}`);
}

console.log("class 0x31, ThrowerStateWaitForCue:");
{
  const rng = new Rng(51);
  const events = new Events();
  // The training stage's six: hold a clip until the camera path reaches a
  // frame, then become state 7.
  const z = thrower(ThrowerState.WaitForCue, {
    cue: { motion: 295, cond: 1, operand: 140 }, attackState: 7,
  });
  G.g_cam_path_frame = 0;
  for (let i = 0; i < 120; i++) GameUpdate(1 / 60, CAM_HOST, rng, events);
  check("it waits while the camera is short of the cue frame",
        z.state === ThrowerState.WaitForCue, `state ${z.state}`);
  G.g_cam_path_frame = 140;
  GameUpdate(1 / 60, CAM_HOST, rng, events);
  check("and goes the moment the camera reaches it",
        z.state === ThrowerState.StandAndDecide, `state ${z.state}`);
}


console.log("class 0x31, ThrowerStateGrabPlayer's sound cues:");
{
  const rng = new Rng(61);
  const events = new Events();
  const heard: number[] = [];
  events.on("sound.play", (e: { id: number }) => heard.push(e.id));
  // Stage 5's four `zslman`: ride the camera, drop on a cue, hold, grab.
  const z = thrower(ThrowerState.GrabPlayer, {
    attackState: 7,
    grab: {
      offset: [0, -40, 0], cue_frame: 20, drop_frames: 10, hold_frames: 25,
      player: 0,
    },
  });
  z.pos = vec3(0, 60, 0);
  G.g_cam_path_frame = 0;
  for (let i = 0; i < 5; i++) GameUpdate(1 / 60, CAM_HOST, rng, events);
  check("no sound while it hangs off the camera waiting for the cue",
        heard.length === 0, heard.map((h) => h.toString(16)).join());
  G.g_cam_path_frame = 20;
  GameUpdate(1 / 60, CAM_HOST, rng, events);
  check("the cue frame plays one step -- COMMON\\ENE_WALK2_11",
        heard.join() === String(0x2516a9), heard.map((h) => h.toString(16)).join());
  for (let i = 0; i < 10; i++) GameUpdate(1 / 60, CAM_HOST, rng, events);
  check("landing plays the thump, then ignites the looping laser sword",
        heard.join() === [0x2516a9, 0x2916a9, 0x1f23a9].join(),
        heard.map((h) => h.toString(16)).join());
  // It blinks for the *first* fifteen frames of the hold and is solid for the
  // rest, and the `_OFF` stopper sits in the `else` arm of that per-frame
  // branch with no edge test -- so with a 25-frame hold it fires ten times.
  for (let i = 0; i < 25; i++) GameUpdate(1 / 60, CAM_HOST, rng, events);
  const offs = heard.filter((h) => h === 0x2023a9).length;
  check("...and the `_OFF` stopper fires on each of the 10 non-blinking frames",
        offs === 10, `${offs}`);

}

{
  // `CMP [0x9a6458], EAX` at `0x0044F078`: the drop's cue takes camera block
  // 2's path frame too, which is always 0, so a cue of 0 drops on the first
  // frame wherever block 0's path is.
  const rng = new Rng(62);
  const events = new Events();
  const heard: number[] = [];
  events.on("sound.play", (e: { id: number }) => heard.push(e.id));
  const z = thrower(ThrowerState.GrabPlayer, {
    attackState: 7,
    grab: {
      offset: [0, -40, 0], cue_frame: 0, drop_frames: 10, hold_frames: 25,
      player: 0,
    },
  });
  z.pos = vec3(0, 60, 0);
  G.g_cam_path_frame = 7;
  for (let i = 0; i < 2; i++) GameUpdate(1 / 60, CAM_HOST, rng, events);
  check("a zslman whose cue is 0 drops at once, on block 2's frame "
        + "(`0x0044F078`)", heard.includes(0x2516a9),
        heard.map((h) => h.toString(16)).join());
}
