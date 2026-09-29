import type { CharacterPlacement } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { authoredFrameOfTicks } from "../../src/core/play_cursor";
import {
  ActorInitHitPoints, ActorSpawn, GameUpdate,
} from "../../src/game/director";
import { ActorKillAll } from "../../src/game/combat/resolve_hit";
import { ActorAdvanceMotion } from "../../src/game/motion";
import { ShotTestPickedHere } from "../../src/game/combat/shot_test";
import { G, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST } from "../../src/game/host";
import { MarkActorShot } from "../../src/game/combat/shot";
import { MotionOf, SetGameTables } from "../../src/game/tables";
import {
  ActorFlag, type Actor, type OneHitTargetActor, type SetPiecePropActor,
} from "../../src/game/actor";
import { ActorIsEnemy, g_class_handlers } from "../../src/game/registry";
import {
  CLASS20_DEATH_MOTION, CLASS20_HEAD_BONE, CLASS20_SCORE_HEAD,
  CLASS20_SCORE_HEAD_COMBO_STEP, CLASS20_SCORE_KILL, CLASS20_SINK_FRAMES,
  CLASS20_SINK_PER_FRAME, CLASS20_SPIN_STEP, CLASS20_WALL_TURN,
  OneHitTargetState, OneHitTargetUpdate, g_class20_idle_motions,
} from "../../src/game/class20";
import { SpawnClass } from "../../src/game/spawn_class";
import { vec3 } from "../../src/game/vec";
import { PlaceBreakableGroup } from "../../src/game/class41";
import {
  SetPieceState, SetPiecePropUpdate,
  DROP_GRAVITY, SLIDE_FRAMES, SLIDE_VX, SLIDE_VZ,
  type SetPieceParams,
} from "../../src/game/class24";
import { check, CHARS, EnterPlay, propScene } from "./harness";

// -- 9b. class 0x20, the one-hit target -------------------------------------

/**
 * One class-0x20 actor with a descriptor of its own.
 *
 * The tail this hands over is the exporter's `class20` block, which is a
 * **separate key** from `body_condition`/`initial_state` precisely because
 * `OneHitTargetInit` (`FUN_00448ED0`) reads the same two descriptor bytes as
 * the character type and a sub-type where `EnemyZombieInit` reads them as the
 * body condition and the initial state.
 */
function targetScene(over: Partial<NonNullable<Actor["oneHitTarget"]>> = {},
                     rng = new Rng(7)):
    { a: OneHitTargetActor; events: Events; rng: Rng } {
  ResetGameGlobals();
  EnterPlay();
  SetGameTables(CHARS, undefined, undefined, undefined);
  G.g_active_cam_path = -1;
  G.g_cam_path_frame = 0;
  const a = ActorSpawn(0x52ec, SpawnClass.OneHitTarget, 1, "target", {
    oneHitTarget: {
      subtype: 0, remove_path: 68, remove_frame: 260, motion: 10, box: null,
      ...over,
    },
  });
  if (a.cls !== SpawnClass.OneHitTarget) throw new Error("not class 0x20");
  a.visible = true;
  a.pos = vec3(0, 0, 0);
  g_class_handlers[SpawnClass.OneHitTarget]?.init(a, rng);
  return { a, events: new Events(), rng };
}

const tFrame = (a: OneHitTargetActor, events: Events, rng: Rng) =>
  OneHitTargetUpdate(a, { dt: 1 / 60, rng, host: NULL_HOST, events });

console.log("\nclass 0x20, the Init reads its own tail:");
{
  const { a } = targetScene({ motion: 1024 });
  check("an authored motion is taken as it is", a.motion === 1024,
        String(a.motion));
  check("...and the state opens on the alive routine",
        a.tgt.state === OneHitTargetState.Alive, String(a.tgt.state));

  // `if (tail+6 == 0) obj+0x1B4 = g_class20_idle_motions[rand() & 3]`. Which
  // one is the draw's business; that it is one of the four is the assertion,
  // and that it comes from `ctx.rng` is what makes the snapshot restore.
  const drawn = targetScene({ motion: 0 });
  check("motion 0 draws one of `g_class20_idle_motions`",
        g_class20_idle_motions.includes(drawn.a.motion), String(drawn.a.motion));
  const again = targetScene({ motion: 0 }, new Rng(7));
  check("...from the seeded rng, so two runs of one seed agree",
        again.a.motion === drawn.a.motion,
        `${again.a.motion} vs ${drawn.a.motion}`);
}

console.log("\nclass 0x20, the removal cue:");
{
  const { a, events, rng } = targetScene();
  G.g_active_cam_path = 68;
  G.g_cam_path_frame = 259;
  tFrame(a, events, rng);
  check("one frame short of the cue it stays", !a.despawned && !a.dead);
  G.g_cam_path_frame = 260;
  tFrame(a, events, rng);
  check("at the cue it despawns", a.despawned, `dead ${a.dead}`);

  // The wrong path at the right frame is not the cue. This is the test class
  // 0x24 and class 0x25 share, and class 0x20 has no script-flag alternative.
  const other = targetScene();
  G.g_active_cam_path = 67;
  G.g_cam_path_frame = 900;
  tFrame(other.a, other.events, other.rng);
  check("...and another path at any frame is not it", !other.a.despawned);
}

console.log("\nclass 0x20 dies to one hit, and pays for it:");
{
  const { a, events, rng } = targetScene();
  G.g_player_score = [0, 0];
  // Bone 4 is not the head: 10 points, then 80 for the kill.
  MarkActorShot(a, 0, 4);
  tFrame(a, events, rng);
  check("any hit kills it", a.dead && a.tgt.state === OneHitTargetState.Dying,
        `dead ${a.dead} state ${a.tgt.state}`);
  check("...for 10 + 80", G.g_player_score[0] === 90,
        String(G.g_player_score[0]));
  check("...and it cues the death clip", a.motion === CLASS20_DEATH_MOTION,
        String(a.motion));
  check("...and leaves the shot list -- `obj+0x34` bit 0 is cleared",
        (a.flags & 0x1) === 0, `flags 0x${(a.flags >>> 0).toString(16)}`);
  check("...and the kill counter moved", G.g_one_hit_target_kills === 1,
        String(G.g_one_hit_target_kills));

  const head = targetScene();
  G.g_player_score = [0, 0];
  MarkActorShot(head.a, 0, CLASS20_HEAD_BONE);
  tFrame(head.a, head.events, head.rng);
  check("a head hit pays 120 + the combo + 80",
        G.g_player_score[0] === CLASS20_SCORE_HEAD + CLASS20_SCORE_KILL,
        String(G.g_player_score[0]));
  check("...and grows `g_head_combo_bonus`",
        G.g_head_combo_bonus[0] === CLASS20_SCORE_HEAD_COMBO_STEP,
        String(G.g_head_combo_bonus[0]));

  // The head combo is a per-player counter the whole game shares, and any
  // non-head hit zeroes it -- which is the rule that makes it worth having.
  const body = targetScene();
  G.g_head_combo_bonus = [30, 0];
  MarkActorShot(body.a, 0, 4);
  tFrame(body.a, body.events, body.rng);
  check("a non-head hit zeroes the combo", G.g_head_combo_bonus[0] === 0,
        String(G.g_head_combo_bonus[0]));
}

console.log("\nclass 0x20's death chain runs to the despawn:");
{
  const { a, events, rng } = targetScene();
  MarkActorShot(a, 0, 4);
  tFrame(a, events, rng);
  // `OneHitTargetPlayDeathClip` holds the clip's last frame, then arms the
  // 120-frame countdown at `obj+0x1330` -- which is the head's `arcFrames`,
  // because that word is also the shared arc record's and class 0x24's.
  for (let i = 0; i < 200 && a.tgt.state === OneHitTargetState.Dying; i++) {
    ActorAdvanceMotion(a, 1 / 60);
    tFrame(a, events, rng);
  }
  check("the death clip hands over to the sink",
        a.tgt.state === OneHitTargetState.Sinking, String(a.tgt.state));
  check("...with 120 frames of body armed",
        a.arcFrames === CLASS20_SINK_FRAMES, String(a.arcFrames));
  const y0 = a.pos.y;
  for (let i = 0; i < CLASS20_SINK_FRAMES; i++) tFrame(a, events, rng);
  check("...which sinks 0.04 a frame",
        Math.abs((y0 - a.pos.y) - CLASS20_SINK_FRAMES * CLASS20_SINK_PER_FRAME)
          < 1e-6,
        `${y0} -> ${a.pos.y}`);
  check("...and despawns at zero", a.despawned, `arcFrames ${a.arcFrames}`);
}

/**
 * **...and the clip plays once, not twice.**
 *
 * `OneHitTargetPlayDeathClip` (`FUN_00449380`) puts `obj+0x194` back on the
 * frame the clip ends (`004493e3 MOV [EDI], EAX`) and
 * `OneHitTargetSinkAndDespawn` (`FUN_00449430`) never steps it, so the body
 * sinks on the death clip's last pose. The port's clock is shared and runs for
 * every actor before any handler, and the poser reads the base track with the
 * **wrapping** conversion — so the clip restarted under the sink and the
 * report was "the death animation plays twice". 82 authored frames against a
 * 120-frame sink: once through and 38 frames into a third.
 */
console.log("\n...and the death clip is held, not looped, under the sink:");
{
  const { a, events, rng } = targetScene();
  const clip = () => {
    const m = MotionOf(a, a.motion);
    return m && m.frames > 0
      ? authoredFrameOfTicks(a.playTicks, m.fps, m.frames) : -1;
  };
  MarkActorShot(a, 0, 4);
  tFrame(a, events, rng);
  for (let i = 0; i < 400 && a.tgt.state === OneHitTargetState.Dying; i++) {
    ActorAdvanceMotion(a, 1 / 60);
    tFrame(a, events, rng);
  }
  const m = MotionOf(a, a.motion);
  const last = (m?.frames ?? 1) - 1;
  check("the sink starts on the clip's last authored frame",
        clip() === last, `frame ${clip()} of ${m?.frames}`);
  // The wrap, if it happens, is a frame number going *down*. One pass and no
  // restarts is the whole assertion.
  let restarts = 0;
  let prev = clip();
  for (let i = 0; i < CLASS20_SINK_FRAMES - 1; i++) {
    ActorAdvanceMotion(a, 1 / 60);
    tFrame(a, events, rng);
    const now = clip();
    if (now < prev) restarts += 1;
    prev = now;
  }
  check("...and holds it for the whole 120 frames",
        restarts === 0 && clip() === last,
        `${restarts} restart(s), frame ${clip()}`);
}

console.log("\nclass 0x20's three sub-types:");
{
  // Sub-type 0 has no idle motion of its own at all; whatever moves it is the
  // clip's root translation, which is `ActorAdvanceMotion`'s.
  const still = targetScene({ subtype: 0 });
  const yaw0 = still.a.yaw;
  for (let i = 0; i < 10; i++) tFrame(still.a, still.events, still.rng);
  check("sub-type 0 neither spins nor is clamped", still.a.yaw === yaw0,
        String(still.a.yaw));

  // Sub-type 1 spins, and `obj+0x11C` -- the descriptor's `+0x22`, which the
  // bundle calls `hp` -- is the direction and not a hit-point count.
  const cw = targetScene({ subtype: 1 });
  cw.a.hp = 1;
  for (let i = 0; i < 4; i++) tFrame(cw.a, cw.events, cw.rng);
  check("sub-type 1 with a non-zero `obj+0x11C` spins one way",
        cw.a.yaw === 4 * CLASS20_SPIN_STEP, String(cw.a.yaw));
  const ccw = targetScene({ subtype: 1 });
  ccw.a.hp = 0;
  ccw.a.yaw = 0x8000;
  for (let i = 0; i < 4; i++) tFrame(ccw.a, ccw.events, ccw.rng);
  check("...and with zero it spins the other", ccw.a.yaw === 0x8000 - 4 * CLASS20_SPIN_STEP,
        String(ccw.a.yaw));

  // Sub-type 2 is clamped into the tail's box and turns away from the wall.
  const boxed = targetScene({ subtype: 2, box: [-10, 10, -10, 10] });
  boxed.a.pos.x = 25;
  boxed.a.yaw = 0;
  tFrame(boxed.a, boxed.events, boxed.rng);
  check("sub-type 2 is clamped to the box's x max", boxed.a.pos.x === 10,
        String(boxed.a.pos.x));
  check("...and turns away from that wall",
        boxed.a.yaw === -CLASS20_WALL_TURN, String(boxed.a.yaw));

  // A corner turns ONCE: the engine's `bVar3` suppresses the z turn after an
  // x clamp, so this is 0x100 and not 0x200.
  const corner = targetScene({ subtype: 2, box: [-10, 10, -10, 10] });
  corner.a.pos.x = 25;
  corner.a.pos.z = 25;
  corner.a.yaw = 0;
  tFrame(corner.a, corner.events, corner.rng);
  check("a corner clamps both axes", corner.a.pos.x === 10 && corner.a.pos.z === 10,
        `${corner.a.pos.x},${corner.a.pos.z}`);
  check("...but turns only once", corner.a.yaw === -CLASS20_WALL_TURN,
        String(corner.a.yaw));
}

console.log("\n`ActorInitHitPoints` runs for two classes, not for every spawn:");
{
  // `[proved]` -- `FUN_0040A8B0` has exactly two callers in the image,
  // `EnemyZombieInit` (0x00452DF2) and `EnemyThrowerInit` (0x0044964A). Every
  // other class reads `obj+0x11C` as `SpawnFromDescriptor` left it, and the
  // clamp's floor of 1 turns an honest zero into a one. For a class-0x20
  // sub-type 1 that zero **is** the spin direction, so the clamp reversed it.
  ResetGameGlobals();
  EnterPlay();
  SetGameTables(CHARS, undefined, undefined, undefined);
  const zero = { hp: 0 } as unknown as CharacterPlacement;
  check("a class-0x30 spawn is scaled and clamped to at least 1",
        ActorInitHitPoints(zero, SpawnClass.Zombie) >= 1,
        String(ActorInitHitPoints(zero, SpawnClass.Zombie)));
  check("...and a class-0x31 spawn too",
        ActorInitHitPoints(zero, SpawnClass.Thrower) >= 1);
  check("a class-0x20 spawn keeps its raw `obj+0x11C`",
        ActorInitHitPoints(zero, SpawnClass.OneHitTarget) === 0,
        String(ActorInitHitPoints(zero, SpawnClass.OneHitTarget)));
  check("...and so do the other non-combat classes",
        ActorInitHitPoints(zero, SpawnClass.ScriptedHumanoid) === 0
        && ActorInitHitPoints(zero, SpawnClass.SetPieceProp) === 0
        && ActorInitHitPoints(zero, SpawnClass.Civilian) === 0);
}

console.log("\nclass 0x20 is not an enemy, and owns its own shot:");
{
  const { a, events, rng } = targetScene();
  tFrame(a, events, rng);
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  check("a one-hit target is not counted as a live enemy",
        G.g_enemies_alive === 0, String(G.g_enemies_alive));
  check("...and `ActorIsEnemy` agrees", !ActorIsEnemy(SpawnClass.OneHitTarget));
  // `ownsShotResult` is what keeps `ResolveHit` off it: this actor has no hit
  // points and no damage row, so the combat path would charge it nothing and
  // look up a table it has no entry in.
  check("the class reads `obj+0x34` bit 3 itself",
        g_class_handlers[SpawnClass.OneHitTarget]?.ownsShotResult === true);
  check("...and keeps ticking once dead, or the body would hang in the air",
        g_class_handlers[SpawnClass.OneHitTarget]?.updatesWhenDead === true);
}

// -- 10. class 0x24, the set-pieces ----------------------------------------

const SETPIECE_BASE: SetPieceParams = {
  selector: 0, removePath: 7, removeFrame: 100, motion: 10, hold: 0,
  cuePath: 3, cueFrame: 40, cue2Path: 4, cue2Frame: 20, phase: 0,
};

/** A stage with one set-piece of the given shape, and the camera at nothing. */
function setPieceScene(over: Partial<SetPieceParams>, rng: Rng): {
  a: SetPiecePropActor; events: Events;
} {
  ResetGameGlobals();
  EnterPlay();
  const params = { ...SETPIECE_BASE, ...over };
  SetGameTables(CHARS, undefined, { "12288": params });
  G.g_camera_fixed_eye_y = 0;
  G.g_active_cam_path = -1;
  G.g_cam_path_frame = 0;
  const a = ActorSpawn(0x3000, SpawnClass.SetPieceProp, 1, "set-piece");
  // Narrowing, not a cast — the same reason the humanoid fixture does it.
  if (a.cls !== SpawnClass.SetPieceProp) throw new Error("not class 0x24");
  a.visible = true;
  a.pos = vec3(0, 40, 0);
  void rng;
  return { a, events: new Events() };
}

const frame = (a: SetPiecePropActor, events: Events, rng: Rng) =>
  SetPiecePropUpdate(a, { dt: 1 / 60, rng, host: NULL_HOST, events });

console.log("\nclass 0x24, the removal trigger:");
{
  const rng = new Rng(2);
  const { a, events } = setPieceScene({}, rng);
  frame(a, events, rng);
  check("it stays while the camera is elsewhere", !a.dead);

  G.g_active_cam_path = 7;
  G.g_cam_path_frame = 99;
  frame(a, events, rng);
  check("and while the path matches but the frame has not arrived", !a.dead);

  G.g_cam_path_frame = 100;
  let removed = 0;
  events.on("setpiece.removed", () => removed++);
  frame(a, events, rng);
  check("it leaves the moment the camera reaches the path and frame",
        a.dead && removed === 1);
}

console.log("\nclass 0x24, the freeze cues:");
{
  const rng = new Rng(2);
  // Selector 2 opens frozen and takes two cues: one starts it, one stops it.
  const { a, events } = setPieceScene(
    { selector: SetPieceState.StartAndStopOnCues }, rng);
  check("selector 2 opens frozen", a.frozen === 1);

  G.g_active_cam_path = 4;
  G.g_cam_path_frame = 20;
  frame(a, events, rng);
  check("the start cue releases it", a.frozen === 0);

  G.g_active_cam_path = 3;
  G.g_cam_path_frame = 40;
  frame(a, events, rng);
  check("the stop cue freezes it again", a.frozen === 1);

  // And a frozen actor's clip does not advance -- the freeze is in
  // `ActorAdvanceMotion`, where the engine keeps it.
  a.motion = 10;
  const before = a.playTicks;
  ActorAdvanceMotion(a, 1 / 60);
  check("a frozen set-piece holds its pose", a.playTicks === before);
  a.frozen = 0;
  ActorAdvanceMotion(a, 1 / 60);
  check("and an unfrozen one does not", a.playTicks > before);
}

console.log("\nclass 0x24, the drop:");
{
  const rng = new Rng(2);
  const { a, events } = setPieceScene(
    { selector: SetPieceState.DropToGround }, rng);
  check("selector 3 opens frozen and in the air",
        a.frozen === 1 && a.pos.y === 40);

  frame(a, events, rng);
  check("the first frame only arms the fall", a.sub === 1 && a.pos.y === 40);

  frame(a, events, rng);
  check("then it accelerates downward",
        Math.abs(a.vel.y - -DROP_GRAVITY) < 1e-9 && a.pos.y < 40,
        `vel ${a.vel.y}`);

  for (let i = 0; i < 3000 && a.sub === 1; i++) frame(a, events, rng);
  check("it lands on the ground plane and stops exactly there",
        a.sub === 2 && a.pos.y === G.g_camera_fixed_eye_y, String(a.pos.y));
  check("and landing is what starts the animation", a.frozen === 0);
}

console.log("\nclass 0x24, the slide:");
{
  const rng = new Rng(2);
  const { a, events } = setPieceScene({ selector: SetPieceState.Slide }, rng);
  frame(a, events, rng);
  check("it takes the fixed heading",
        Math.abs(a.vel.x - SLIDE_VX) < 1e-6
        && Math.abs(a.vel.z - SLIDE_VZ) < 1e-6);
  const x0 = a.pos.x;
  for (let i = 0; i < SLIDE_FRAMES + 4; i++) frame(a, events, rng);
  check("it travels along it and then stops",
        a.pos.x > x0 && a.sub >= 2, `x ${a.pos.x.toFixed(1)} sub ${a.sub}`);
  const rest = a.pos.x;
  for (let i = 0; i < 200; i++) frame(a, events, rng);
  check("and stays stopped", a.pos.x === rest);
}

console.log("\nclass 0x24, the selector is +0x130C:");
{
  const rng = new Rng(2);
  const { a, events } = setPieceScene(
    { selector: SetPieceState.DropToGround }, rng);
  check("the Init writes the selector to +0x130C and leaves +0x1310 alone",
        a.prop.selector === SetPieceState.DropToGround && a.state === 0,
        `selector ${a.prop.selector} state ${a.state}`);

  // `+0x1310` is the combat classes' state word; class 0x24 never reads it,
  // so writing it must not change which state routine runs.
  a.state = SetPieceState.Slide;
  frame(a, events, rng);
  check("and the dispatch ignores +0x1310",
        a.sub === 1 && a.vel.x === 0, `sub ${a.sub} vx ${a.vel.x}`);
}

console.log("\nclass 0x24, the hold-then-play count:");
{
  const rng = new Rng(2);
  const HOLD = 4;
  const { a, events } = setPieceScene(
    { selector: SetPieceState.Idle, hold: HOLD, cuePath: 21, motion: 10 },
    rng);
  // The engine compares the counter *before* stepping it, so the swap lands
  // on the frame after the hold has been counted out in full.
  for (let i = 0; i < HOLD; i++) frame(a, events, rng);
  check("the hold runs its full count before the motion swaps",
        a.motion === 10 && a.holdFrames === HOLD,
        `motion ${a.motion} hold ${a.holdFrames}`);
  frame(a, events, rng);
  check("and swaps on the next frame, tail+0x0E being a motion id here",
        a.motion === 21 && a.playTicks === 0,
        `motion ${a.motion}`);
  frame(a, events, rng);
  frame(a, events, rng);
  check("then the entry point is SetPieceStateIdle and it never swaps again",
        a.motion === 21 && a.holdFrames === HOLD + 1,
        `hold ${a.holdFrames}`);
}

console.log("\nclass 0x24, the script-flag removal variant:");
{
  const rng = new Rng(2);
  const { a, events } = setPieceScene({}, rng);
  // Bit 0x2000000 swaps the removal trigger for a script flag.
  a.flags |= 0x2000000;
  G.g_active_cam_path = 7;
  G.g_cam_path_frame = 999;
  frame(a, events, rng);
  check("the camera no longer removes it once the flag bit is set", !a.dead);
  G.g_script_flags[7] = 1;
  frame(a, events, rng);
  check("but the script flag does", a.dead);
}

/**
 * **No shot can touch a set-piece.** Nothing class 0x24 runs calls
 * `RegisterForShotTest` (`FUN_00405160`), directly or through
 * `ActorRegisterCameraPoint` (`FUN_00409B70`): not `SetPiecePropInit`
 * (`FUN_00482CE0`), not one of the six states it installs, not
 * `SetPiecePropDrawAndTick` (`FUN_004834F0`), not the per-bone hook at
 * `obj+0x12EC`. So a set-piece is never on the list `ProcessPlayerShots`
 * walks, and a bullet passes through it. The port offered it to the render
 * pick like any other actor, and `ResolveHit` then gave the body a death
 * clip: stage 1's man lying under the library desk (`0x1548`, `hito_marioaa`,
 * at `?stage=1&block=1&step=3&op=9`) fell over again when shot, and so did
 * every other body and bystander of the class's 28 people.
 */
console.log("\nclass 0x24 is never shot:");
{
  const rng = new Rng(2);
  const h = g_class_handlers[SpawnClass.SetPieceProp];
  check("it is picked the engine's way, through the registration list alone",
        h?.registersForShotTest === true, `${h?.registersForShotTest}`);
  // Every selector, every frame: the list never holds it.
  let listed = 0;
  for (const selector of [0, 1, 2, 3, 4, 5]) {
    const { a, events } = setPieceScene({ selector }, rng);
    check(`selector ${selector}: ShotTestPickedHere`, ShotTestPickedHere(a));
    for (let i = 0; i < 90; i++) {
      frame(a, events, rng);
      if (G.g_shot_test_list.some((e) => e.at === a.at)) listed += 1;
    }
  }
  check("...and no frame of any of its six states registers it", listed === 0,
        `${listed} frames listed`);
  // The debug clear takes only what a shot could.
  {
    const { a } = setPieceScene({}, rng);
    const hp = a.hp;
    ActorKillAll(rng);
    check("the Kill button leaves a set-piece standing, with no death clip",
          !a.dead && a.death === null && a.hp === hp
          && (a.flags & ActorFlag.Dead) === 0,
          `dead ${a.dead} death ${JSON.stringify(a.death)} hp ${a.hp}`);
  }
}

console.log("\nclass 0x41, the props are in the save state:");
{
  const rng = new Rng(21);
  const events = propScene(rng);
  PlaceBreakableGroup(1, 4, rng);
  const snap = JSON.stringify(G.g_breakable_props);
  check("the prop pool survives JSON.stringify",
        JSON.parse(snap).length === 3);
  // Plain objects and plain arrays of them, all the way down: type 39's
  // stack and type 40's burst are arrays of records, which `structuredClone`
  // and `JSON` carry exactly as they carry an object.
  const plain = (v: unknown): boolean =>
    typeof v !== "function"
    && (typeof v !== "object" || v === null
        || (Array.isArray(v) && v.every(plain))
        || (Object.getPrototypeOf(v) === Object.prototype
            && Object.values(v).every(plain)));
  check("a prop holds no functions or class instances",
        G.g_breakable_props.every((p) => plain(p)));
  void events;
}
