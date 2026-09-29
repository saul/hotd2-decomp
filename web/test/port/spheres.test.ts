import type { CharactersJson, CharacterType } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import {
  ActorSwapDamagedPart, ResolveDamagedPartSphere,
} from "../../src/game/combat/resolve_hit";
import { makeActor } from "../../src/game/actor";
import { ScriptedPropUpdate13 } from "../../src/game/class13";
import { CARRIER_SELECTORS_PORTED } from "../../src/game/class13/state";
import { ActorBuildSkinnedModel } from "../../src/game/spawn";
import { ProcessPlayerShotsTestList } from "../../src/game/combat/shot_test";
import { G, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST, type GameHost } from "../../src/game/host";
import { QueueShotRequest } from "../../src/game/combat/shot";
import { SetGameTables, T } from "../../src/game/tables";
import { ZombieThrowHandWeapon } from "../../src/game/class30/throw";
import {
  ActorFlag, ThrowerFlag, ZombieFlag2, type Actor, type ThrowerActor,
  type ZombieActor,
} from "../../src/game/actor";
import { ZombieOnShot } from "../../src/game/class30/on_shot";
import { SpawnClass } from "../../src/game/spawn_class";
import {
  ThrowerStateRearm, ThrowerStateRestoreBothHands,
} from "../../src/game/class31/standing";
import { ActorClipLength } from "../../src/game/class31/arc";
import { ThrowerState } from "../../src/game/class31/states";
import { SpawnThrownWeapon } from "../../src/game/class31/thrower";
import { vec3 } from "../../src/game/vec";
import { EffectCode, ResolveHit } from "../../src/game/combat/resolve_hit";
import { SpawnSlotActors } from "../../src/game/director";
import {
  check, motion, TYPE, CHARS, spawnZombie, scene, EnterPlay, TYPE31_ZSASS,
  TYPE31_ZSLMAN, CHARS31,
} from "./harness";

// -- a spawn record's three angles reach every slot actor ---------------------
//
// `SpawnFromDescriptorSmall` (`FUN_00408BC0`, opcode 0x0C) copies the record's
// sixth, seventh and eighth dwords to `obj+0x64/0x68/0x6C` (`0x00408C01`..
// `0x00408C10`), and so do the other two allocators, for every class.
// `ScriptedPropInit13` (`FUN_0043FE10`) writes none of the three, behaviour 0
// is `NoOpStub` -- a bare `RET` -- and `ScriptedPropUpdate13` (`FUN_0043FE90`)
// draws `T; RotX(+0x64); RotZ(+0x6C); RotY(+0x68)`. `SpawnSlotActor` took the
// yaw alone, and stage 2's five static props stood upright.
console.log("\na spawn record's three angles reach every slot actor:");
{
  const rng = new Rng(13);
  const events = scene(0, rng);
  // Stage 2 block 17 step 1's four `komono_st1.bin[3]`, as `st2evtbl.bin`
  // places them: yaw 0xC000, a pitch each, behaviour 0, gone on camera path 81
  // frame 549. And the fifth, `etc_1.bin[63]` at 15x, 1400 units up.
  const shipped: Array<[number, number, number, number]> = [
    [48896, 0x1000, 0xc000, 0x1237], [48952, 0x2800, 0xc000, 0x1237],
    [49008, 0xf000, 0xc000, 0x1237], [49064, 0xec00, 0xc000, 0x1237],
    [84232, 0x2800, 0, 0x1383],
  ];
  const tail = (slot: number) => ({
    slot, cam_path: slot === 0x1383 ? 114 : 81,
    cam_frame: slot === 0x1383 ? 0 : 549,
    scale: slot === 0x1383 ? 15 : 1, behaviour: 0, selector: 19,
  });
  SetGameTables({
    ...CHARS,
    placements: [
      ...shipped.map(([at, pitch, yaw, slot]) => ({
        at, class: 0x13, char_type: -1, motion: null, hp: 0, yaw, pitch,
        init_flags: 0x8000, class13: tail(slot),
      })),
      // No shipped class-0x13 record rolls; this one does, so a spawn arm
      // that took the pitch alone fails too.
      { at: 0x7130, class: 0x13, char_type: -1, motion: null, hp: 0,
        yaw: 0x4000, pitch: 0x0800, roll: 0x1234, init_flags: 0x8000,
        class13: tail(0x1237) },
      // Two other arms of the same routine, through the same helper.
      { at: 0x7152, class: 0x52, char_type: -1, motion: null, hp: 0,
        yaw: 0x2000, pitch: 0x0300, roll: 0x0500, class52: { subtype: 0 } },
      { at: 0x7116, class: 0x16, char_type: -1, motion: null, hp: 0,
        yaw: 0x2000, pitch: 0x0300, roll: 0x0500, class16: {} },
    ],
  } as unknown as CharactersJson);
  const at = (a: number, cls: SpawnClass) =>
    ({ at: a, class: cls, pos: [-602.5, 50.5, -1526.5] as [number, number, number] });
  SpawnSlotActors([
    ...shipped.map(([a]) => at(a, SpawnClass.ScriptedProp)),
    at(0x7130, SpawnClass.ScriptedProp),
    at(0x7152, SpawnClass.Mouse),
    at(0x7116, SpawnClass.WaterWaveField),
  ], rng);
  const props = shipped.map(([a]) => G.g_object_list.find((o) => o.at === a));
  const angles = (o: Actor | undefined) =>
    o ? `${o.pitch.toString(16)}/${o.yaw.toString(16)}/${o.roll.toString(16)}`
      : "none";
  check("stage 2's five static class-0x13 props spawn at the record's pitch, "
        + "not upright",
        props.every((o, i) => !!o && o.pitch === shipped[i][1]
                    && o.yaw === shipped[i][2] && o.roll === 0),
        props.map(angles).join(" "));
  const rolled = G.g_object_list.find((o) => o.at === 0x7130);
  check("...and a class-0x13 record's roll reaches `obj+0x6C` too",
        rolled?.pitch === 0x0800 && rolled.yaw === 0x4000
        && rolled.roll === 0x1234, angles(rolled));
  // `MouseInit` and `WaterFieldCreate` (`FUN_00442290`) write none of the
  // three either, so what they hold straight after the spawn is what the arm
  // handed them. Read before any update: the field kills itself in its `Init`
  // and the pool drops it at the end of the next frame.
  const mouse = G.g_object_list.find((o) => o.at === 0x7152);
  const field = G.g_object_list.find((o) => o.at === 0x7116);
  check("the mouse's and the wave field's arms take all three angles as well",
        mouse?.pitch === 0x0300 && mouse.roll === 0x0500
        && field?.pitch === 0x0300 && field.roll === 0x0500,
        `${angles(mouse)} ${angles(field)}`);
  // Behaviour 0 is `NoOpStub`: nothing between the spawn and the draw writes
  // an angle, so thirty frames later they are what the record said.
  for (let i = 0; i < 30; i++) GameUpdate(1 / 60, NULL_HOST, rng, events);
  check("a static class-0x13 prop keeps all three through thirty updates",
        props.every((o, i) => !!o && !o.despawned && o.pitch === shipped[i][1]
                    && o.yaw === shipped[i][2] && o.roll === 0)
        && rolled?.roll === 0x1234,
        props.map(angles).join(" "));
  SetGameTables(CHARS);
}

// ...and the other half: a carrier never draws them. `ScriptedPropUpdate13`
// (`FUN_0043FE90`) calls the behaviour at `0x0043FEC9` and only then draws off
// `obj+0x64/0x68/0x6C`, and every routine `CarrierPropSelectRoutine`
// (`FUN_00440190`) installs, bar one, falls from state 0 into
// `PropSeatOnObjectPath` (`FUN_00440130`) on that first call: 0 at
// `0x0044028F`, 1 at `0x00440440`, 2 and 9 at `0x00440969`/`0x00440997` and
// `0x004408E6`, 4 and 7 at `0x00440CE4`/`0x00440C7C`, 5 and 8 at
// `0x004410B7`/`0x0044105C`, 6 at `0x00441430`. The one is selector 3,
// `0x00440AD0`, which never stores to the object and so draws the record's
// angles for life, as behaviour 0 does -- it is unported, and when it is not,
// this loop expects exactly that of it.
console.log("\na carrier seats itself before the first draw reads its angles:");
{
  const rng = new Rng(19);
  scene(0, rng);
  const onPath = { pitch: 0x0400, yaw: 0x0800, roll: 0x0c00 };
  const record = { pitch: 0x1111, yaw: 0x2222, roll: 0x3333 };
  const host: GameHost = {
    ...NULL_HOST,
    objectPath: (slot, frame) => ({ x: frame, y: slot, z: 0, ...onPath }),
  };
  // A camera path none of the routines turns on (`CarrierPropRoutine2` adds
  // 0x8000 to the yaw on 0xBB and 0xBD) and a frame inside every ride.
  G.g_active_cam_path = 1;
  G.g_cam_path_frame = 200;
  const got: string[] = [];
  let ok = CARRIER_SELECTORS_PORTED.size > 0;
  for (const sel of CARRIER_SELECTORS_PORTED) {
    const prop = ActorSpawn(0x7200 + sel, SpawnClass.ScriptedProp, -1,
                            `carrier ${sel}`, {
      class13: { slot: 6711, cam_path: 134, cam_frame: 340, scale: 1,
                 behaviour: 8, selector: sel },
      ...record,
    }, rng);
    const spawned = prop.pitch === record.pitch && prop.yaw === record.yaw
      && prop.roll === record.roll;
    ScriptedPropUpdate13(prop, { dt: 1 / 60, rng, host });
    const want = sel === 3 ? record : onPath;
    ok &&= spawned && prop.pitch === want.pitch && prop.yaw === want.yaw
      && prop.roll === want.roll;
    got.push(`${sel}:${prop.pitch.toString(16)}/${prop.yaw.toString(16)}/`
             + `${prop.roll.toString(16)}`);
  }
  check("every ported carrier holds its op_ path's angles after its first "
        + "update, not the record's", ok, got.join(" "));
}
// -- the bone records' hit spheres ------------------------------------------
//
// `obj + 0x20C + bone*0x90` is a bone's draw record, and `+0x78` / `+0x7C..`
// its hit sphere's radius and centre. The port kept the radius on the actor
// (`Actor.boneRadius`) from the build alone and took every centre from the
// bundle, so the sphere a gore swap, a thrown weapon or a re-armed hand
// leaves on the record was never the one a shot met. These are the writers,
// one by one, in the engine's words.
console.log("\nthe bone records' hit spheres, every writer:");
{
  // Type 38 -- drawn at 0.9, so "scaled" and "unscaled" are different
  // numbers -- with four rows: bones 4, 5, 1 and 2 name their own nodes, and
  // bone 6's row names another model than its node does.
  const S38: CharacterType = {
    ...TYPE, type: 38, name: "test civilian",
    bones: [
      ...TYPE.bones.map((b) => ({ ...b,
        hit_centre: [0, b.bone, 0.5] as [number, number, number] })),
      { bone: 6, part: "l_upperarm", slot: 6, offset: [0, 0, 0], parent: null,
        damage_rank: [], hit_radius: 1.5, hit_centre: [9, 9, 9],
        hit_slot: 0x66, steps: [] },
    ],
  };
  // The damaged-part rows: type 38's own, and types 7 and 0xB.
  const PARTS = {
    "38": [{ slot: 0x11, centre: [1, 2, 3], radius: 0.5 },
           { slot: 0x13, centre: [3, 3, 3], radius: 0.3 },
           { slot: 0x50, centre: [5, 0, 0], radius: 5 }],
    "7": [{ slot: 0x12, centre: [4, 5, 6], radius: 0.75 },
          { slot: 0x13, centre: [7, 8, 9], radius: 0.25 },
          { slot: 0x50, centre: [7, 0, 0], radius: 7 }],
    "11": [{ slot: 0x50, centre: [11, 0, 0], radius: 11 }],
  };
  const tables = {
    ...CHARS, types: { ...CHARS.types, "38": S38 }, part_spheres: PARTS,
  } as unknown as CharactersJson;
  const fresh = (at: number, ct = 38): Actor => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(tables);
    const a = makeActor(at, SpawnClass.Zombie, ct, "rec");
    ActorBuildSkinnedModel(a);
    a.hp = 100;
    return a;
  };
  const s = Math.fround(0.9);

  // `SkeletonWalkNode` (`FUN_004107E0`): `CMP EDX,[EDI]; JNZ` at 0x00410830.
  const b = fresh(0x3100);
  check("the build takes a row whose slot is its node's: radius times the "
        + "size, centre as the row has it",
        b.boneRadius["4"] === Math.fround(s * 2)
        && JSON.stringify(b.boneCentre["4"]) === "[0,4,0.5]",
        `${b.boneRadius["4"]} ${JSON.stringify(b.boneCentre["4"])}`);
  check("...and zeroes radius and centre where the row names another slot",
        b.boneRadius["6"] === 0
        && JSON.stringify(b.boneCentre["6"]) === "[0,0,0]",
        `${b.boneRadius["6"]} ${JSON.stringify(b.boneCentre["6"])}`);

  // `ActorSwapDamagedPart` (`FUN_004098E0`) through `ResolveHit`: bone 4's
  // steps swap to 0x11, 0x12, 0x13, then sever with 0x14.
  const g = fresh(0x3101);
  const rng = new Rng(9);
  ResolveHit(g, 4, NULL_HOST, rng);
  check("a gore swap takes the part's own row out of the type's table, "
        + "unscaled -- `ResolveDamagedPartSphere`",
        g.boneSlot["4"] === 0x11 && g.boneRadius["4"] === 0.5
        && JSON.stringify(g.boneCentre["4"]) === "[1,2,3]",
        `${g.boneSlot["4"]} ${g.boneRadius["4"]} `
        + JSON.stringify(g.boneCentre["4"]));
  ResolveHit(g, 4, NULL_HOST, rng);
  check("...a part the type's table has no row for takes type 7's",
        g.boneRadius["4"] === 0.75
        && JSON.stringify(g.boneCentre["4"]) === "[4,5,6]",
        `${g.boneRadius["4"]} ${JSON.stringify(g.boneCentre["4"])}`);
  ResolveHit(g, 4, NULL_HOST, rng);
  check("...and **both** searches run, so where both tables have the part "
        + "type 7's row is the one left",
        g.boneRadius["4"] === 0.25
        && JSON.stringify(g.boneCentre["4"]) === "[7,8,9]",
        `${g.boneRadius["4"]} ${JSON.stringify(g.boneCentre["4"])}`);
  ResolveHit(g, 4, NULL_HOST, rng);
  check("a part neither table has leaves the record as it was",
        g.boneSlot["4"] === 0x14 && g.boneRadius["4"] === 0.25
        && JSON.stringify(g.boneCentre["4"]) === "[7,8,9]",
        `${g.boneSlot["4"]} ${g.boneRadius["4"]}`);
  // The same step severed bone 5, through `RemoveBoneSubtree`
  // (`FUN_00409AF0`): `rec+0x00 = 0; rec+0x78 = 0` at 0x00409B3A/0x00409B41.
  check("...and the sever zeroes the removed bone's radius with its slot",
        g.removed.includes(5) && g.boneRadius["5"] === 0,
        `${JSON.stringify(g.removed)} ${g.boneRadius["5"]}`);

  // Type 0xD searches 0xB second, not 7 (`0x0040994D`).
  const d = fresh(0x3102, 0xd);
  ActorSwapDamagedPart(d, 4, 0x50, NULL_HOST);
  check("character type 0xD's second search is type 0xB's table",
        d.boneRadius["4"] === 11, String(d.boneRadius["4"]));
  const e = fresh(0x3103);
  ActorSwapDamagedPart(e, 4, 0x50, NULL_HOST);
  check("...and every other type's, type 7's, over its own",
        e.boneRadius["4"] === 7, String(e.boneRadius["4"]));
  check("`ResolveDamagedPartSphere` returns 0 whatever it found",
        ResolveDamagedPartSphere(e, 4, 0x50, 38) === 0
        && ResolveDamagedPartSphere(e, 4, 0x50, 99) === 0);

  // Slot 0 or 1: `MOV [EDI+0x78], 0` at 0x00409973, and no search.
  const one = fresh(0x3104);
  ActorSwapDamagedPart(one, 4, 1, NULL_HOST);
  check("a swap to slot 1 zeroes the radius and searches nothing",
        one.boneSlot["4"] === 1 && one.boneRadius["4"] === 0
        && JSON.stringify(one.boneCentre["4"]) === "[0,4,0.5]",
        `${one.boneRadius["4"]} ${JSON.stringify(one.boneCentre["4"])}`);
  // The headshot's `ActorSwapDamagedPart(rec, 0, 2)` at 0x004097AA: the head
  // and nothing under it, and the zone bit only if the head's current step
  // is its last.
  const h = fresh(0x3105);
  const zones0 = h.zones;
  h.hits["2"] = 0;
  S38.bones.find((x) => x.bone === 2)!.steps =
    [[0x31, EffectCode.Escalate, 1]];
  ActorSwapDamagedPart(h, 2, 0, NULL_HOST);
  check("a swap to slot 0 takes the head alone, and its radius",
        JSON.stringify(h.removed) === "[2]" && h.boneRadius["2"] === 0,
        `${JSON.stringify(h.removed)} ${h.boneRadius["2"]}`);
  check("...with no zone bit while the head's step is not its last",
        h.zones === zones0, `${h.zones}`);
  S38.bones.find((x) => x.bone === 2)!.steps = [];
  const h2 = fresh(0x3106);
  ActorSwapDamagedPart(h2, 2, 0, NULL_HOST);
  check("...and with it when it is", (h2.zones & 1) !== 0, `${h2.zones}`);
  // `NoPartSwap`: `TEST CH,0x2` at 0x00409916, and the epilogue.
  const np = fresh(0x3107);
  np.flags |= ActorFlag.NoPartSwap;
  ActorSwapDamagedPart(np, 4, 0x11, NULL_HOST);
  check("`NoPartSwap` leaves the sphere as the build made it",
        np.boneRadius["4"] === Math.fround(s * 2), String(np.boneRadius["4"]));
}

console.log("\nthe weapon hands' spheres:");
{
  // `zsass`: the skeleton names the bare hands and the rows the armed ones
  // -- 0x16's rows 4 and 7 as `Hod2.exe` has them, bit for bit.
  const R4: [number, number, number] =
    [Math.fround(-0.1), Math.fround(-1.1), Math.fround(2.4)];
  const R7: [number, number, number] =
    [0, Math.fround(-1.3), Math.fround(2.25)];
  const HAND5 = { bone: 5, motion: 9, release_frame: 48, range: 20,
                  overlay_kind: 6, cancel_mask: 2, held: 0x1fa2, bare: 0x1f9f,
                  projectile: 0x1f91 };
  const ZSASS: CharacterType = {
    ...TYPE31_ZSASS,
    bones: [
      ...TYPE31_ZSASS.bones.filter((b) => b.bone === 1 || b.bone === 2),
      { bone: 5, part: "r_hand", slot: 0x1f9f, offset: [0, 0, 0],
        parent: null, damage_rank: [], hit_radius: 1.75, hit_centre: R4,
        hit_slot: 0x1fa2, steps: [] },
      { bone: 8, part: "l_hand", slot: 0x1f9b, offset: [0, 0, 0],
        parent: null, damage_rank: [], hit_radius: Math.fround(1.65),
        hit_centre: R7, hit_slot: 0x1f9e, steps: [] },
    ],
    motions: { ...TYPE31_ZSASS.motions, "5": motion(20) },
  };
  const ZSLMAN: CharacterType = {
    ...TYPE31_ZSLMAN,
    bones: [
      { bone: 5, part: "r_hand", slot: 0x1ff3, offset: [0, 0, 0],
        parent: null, damage_rank: [], hit_radius: Math.fround(1.05),
        hit_centre: [0, Math.fround(-2.05), 0], hit_slot: 0x1ff3,
        steps: [] },
      { bone: 8, part: "l_hand", slot: 0x1fef, offset: [0, 0, 0],
        parent: null, damage_rank: [], hit_radius: Math.fround(1.05),
        hit_centre: [0, Math.fround(-2.05), 0], hit_slot: 0x1fef,
        steps: [] },
    ],
    motions: { ...TYPE31_ZSLMAN.motions, "520": motion(40) },
  };
  const tables = {
    ...CHARS31, types: { ...CHARS31.types, "22": ZSASS, "24": ZSLMAN },
  } as unknown as CharactersJson;
  const spawn = (at: number, ct: number): ThrowerActor => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(tables);
    const a = ActorSpawn(at, SpawnClass.Thrower, ct, "hands");
    if (a.cls !== SpawnClass.Thrower) throw new Error("not class 0x31");
    a.visible = true;
    return a;
  };

  // `EnemyThrowerInit` (`FUN_00449620`), 0x00449877 / 0x00449881.
  const z = spawn(0x9400, 0x16);
  check("`zsass` is born holding its weapons: `EnemyThrowerInit` writes the "
        + "armed slots",
        z.boneSlot["5"] === 0x1fa2 && z.boneSlot["8"] === 0x1f9e,
        JSON.stringify(z.boneSlot));
  check("...and neither hand has a sphere, because the build refused both "
        + "rows",
        z.boneRadius["5"] === 0 && z.boneRadius["8"] === 0,
        `${z.boneRadius["5"]} ${z.boneRadius["8"]}`);
  // `SpawnThrownWeapon` (`FUN_004504E0`): the hand goes bare, radius 0.
  z.boneRadius["5"] = 3;
  SpawnThrownWeapon(z, HAND5 as never, NULL_HOST);
  check("the throw empties the hand and zeroes its sphere",
        z.boneSlot["5"] === 0x1f9f && z.boneRadius["5"] === 0,
        `${z.boneSlot["5"]} ${z.boneRadius["5"]}`);
  // `ThrowerStateRearm` (`FUN_0044F7A0`), at the clip's midpoint.
  z.boneSlot["8"] = 0x1f9b;
  z.state = ThrowerState.Rearm;
  z.sub = 0;
  ThrowerStateRearm(z, NULL_HOST);
  z.action!.ticks = Math.trunc(ActorClipLength(z, 5) / 2);
  ThrowerStateRearm(z, NULL_HOST);
  check("`ThrowerStateRearm` gives both hands type 0x16's rows 4 and 7, "
        + "unscaled and unasked",
        z.boneSlot["5"] === 0x1fa2 && z.boneRadius["5"] === 1.75
        && JSON.stringify(z.boneCentre["5"]) === JSON.stringify(R4)
        && z.boneSlot["8"] === 0x1f9e
        && z.boneRadius["8"] === Math.fround(1.65)
        && JSON.stringify(z.boneCentre["8"]) === JSON.stringify(R7),
        `${z.boneRadius["5"]} ${JSON.stringify(z.boneCentre["5"])} `
        + `${z.boneRadius["8"]}`);

  // `ThrowerStateRestoreBothHands` (`FUN_0044F900`), sub 1 with the latch
  // down: the actor's own type's rows.
  const m = spawn(0x9401, 0x18);
  check("`zslman`'s rows name its own nodes, so the build gives it both",
        m.boneRadius["5"] === Math.fround(1.05), String(m.boneRadius["5"]));
  m.boneSlot["5"] = 0x1ff1;
  m.boneRadius["5"] = 0;
  m.boneCentre["5"] = [0, 0, 0];
  m.state = ThrowerState.RestoreBothHands;
  m.sub = 1;
  m.flags2 &= ~ThrowerFlag.Regrowing;
  ThrowerStateRestoreBothHands(m, 0, NULL_HOST);
  check("`ThrowerStateRestoreBothHands` puts the row back with the weapon",
        m.boneSlot["5"] === 0x1ff3 && m.boneRadius["5"] === Math.fround(1.05)
        && m.boneCentre["5"][1] === Math.fround(-2.05),
        `${m.boneSlot["5"]} ${m.boneRadius["5"]} `
        + JSON.stringify(m.boneCentre["5"]));

  // `ZombieThrowHandWeapon` (`FUN_0045A240`): `MOV [EDI+0x554], EBX`.
  ResetGameGlobals();
  EnterPlay();
  SetGameTables(CHARS);
  const k = spawnZombie(0x9402, 1, "knife");
  k.pos = vec3(0, 0, 60);
  const r4 = k.boneRadius["4"];
  ZombieThrowHandWeapon(k, 5, NULL_HOST);
  check("class 0x30's throw zeroes the emptied hand's sphere and no other",
        k.boneRadius["5"] === 0 && k.boneRadius["4"] === r4 && r4 > 0,
        `${k.boneRadius["5"]} ${k.boneRadius["4"]}`);
}

console.log("\nEnemyZombieInitByCharType's mesh hands:");
{
  const MESH = "coli0.bin:4576";
  // `TYPE` with a left hand, so the arms that name bone 8 have one to name.
  const mk = (t: number): CharacterType => ({
    ...TYPE, type: t,
    bones: [...TYPE.bones,
            { bone: 8, part: "l_hand", slot: 8, offset: [0, 0, 0],
              parent: null, damage_rank: [], hit_radius: 2, hit_slot: 8,
              steps: [] }],
  });
  const tables = {
    ...CHARS,
    types: { "1": mk(1), "2": mk(2), "3": mk(3), "14": mk(14) },
  } as unknown as CharactersJson;
  const spawn = (at: number, ct: number): ZombieActor => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(tables);
    return spawnZombie(at, ct, "mesh", { boneMeshColi: MESH });
  };
  const c2 = spawn(0x9500, 2);
  check("types 2 and 3 test both hands against the tail's mesh, with no "
        + "sphere",
        c2.boneColi["5"] === MESH && c2.boneColi["8"] === MESH
        && c2.boneRadius["5"] === 0 && c2.boneRadius["8"] === 0,
        `${JSON.stringify(c2.boneColi)} ${c2.boneRadius["5"]}`);
  check("...and neither comes apart: `obj+0x34 |= 0x400`",
        (c2.flags & ActorFlag.NoDismember) !== 0);
  check("...and type 2 alone raises `obj+0x136C` bit 0x400 before it falls "
        + "into type 3's arm",
        (c2.flags2 & ZombieFlag2.EntryClipPlaying) !== 0);
  const c3 = spawn(0x9501, 3);
  check("...which type 3 does not",
        (c3.flags2 & ZombieFlag2.EntryClipPlaying) === 0
        && (c3.flags & ActorFlag.NoDismember) !== 0
        && c3.boneColi["8"] === MESH);
  const ce = spawn(0x9502, 14);
  check("type 0xE's arm is bone 5 alone",
        ce.boneColi["5"] === MESH && ce.boneColi["8"] === undefined
        && ce.boneRadius["5"] === 0 && ce.boneRadius["8"] > 0
        && (ce.flags & ActorFlag.NoDismember) === 0,
        `${JSON.stringify(ce.boneColi)} ${ce.boneRadius["8"]}`);
  const c1 = spawn(0x9503, 1);
  check("...and no other type reads the tail's `+0x10`",
        Object.keys(c1.boneColi).length === 0 && c1.boneRadius["5"] > 0);
  // `ZombieOnShot` (`FUN_00453EB0`) drops the latch for a landed shot:
  // `AND DH, 0xfb` at 0x00453F14.
  c2.pendingHit = { bone: 4, result: 2, player: 0 };
  ZombieOnShot(c2);
  check("...and a shot drops it",
        (c2.flags2 & ZombieFlag2.EntryClipPlaying) === 0);

  // **The shot meets the mesh.** `ShotTestBoneTree` (`FUN_00404750`) takes
  // `ShotTestBoneMesh` (`FUN_004048A0`) for these bones, and class 0x30 is
  // picked through the list: registered by its own update, broad phase at
  // `obj+0x124` round the tracked point, then the tree.
  const rng = new Rng(4);
  const events = scene(0, rng);
  SetGameTables(tables);
  const z = spawnZombie(0x9504, 2, "saw", { boneMeshColi: MESH });
  z.visible = true;
  z.hp = 50;
  z.pos = vec3(0, 0, 60);
  // A unit quad in bone 5's own space, a unit in front of it toward the eye,
  // facing it: `quadVsSegment` takes the segment from the plane's negative
  // side to its positive one, and the winding runs with the normal.
  T.coli = { files: ["t"], blobs: { [MESH]: {
    min: [-0.5, -0.5, -1], max: [0.5, 0.5, -1], n: 1, plane: [0, 0, -1, -1],
    verts: [-0.5, -0.5, -1, -0.5, 0.5, -1, 0.5, 0.5, -1, 0.5, -0.5, -1],
    axis: [2], surface: [0x33],
  } } } as never;
  // Every bone at (0, 10, 60), unrotated -- the tracked point the broad phase
  // is centred on included -- and no bone has a sphere; the camera at the
  // origin looking +z.
  const host: GameHost = {
    ...NULL_HOST,
    pickShot: () => null,
    boneWorld: (_at, _bone, out) => {
      out.x = 0; out.y = 10; out.z = 60;
      return true;
    },
    boneSphere: () => null,
    boneMatrix: (_at, _bone, out) => {
      for (let i = 0; i < 16; i++) out[i] = i % 5 === 0 ? 1 : 0;
      out[12] = 0; out[13] = 10; out[14] = 60;
      return true;
    },
    viewSpaceOfPoint: (p, out) => {
      out.x = p.x; out.y = p.y; out.z = -p.z;
      return true;
    },
  };
  const RAY = { origin: vec3(0, 10, 0), dir: vec3(0, 0, 1) };
  // One frame for the update to file the actor; the shot tests what the last
  // walk filed.
  GameUpdate(1 / 60, host, rng, events);
  const cand = ProcessPlayerShotsTestList(RAY, host);
  check("a shot along the hand meets its mesh, not a sphere: bone 5, the "
        + "quad's surface, a unit short of the bone",
        cand?.bone === 5 && cand.mesh?.surface === 0x33
        && Math.abs(cand.point.z - 59) < 1e-6,
        JSON.stringify(cand));
  check("...and misses it a unit to the side",
        ProcessPlayerShotsTestList({ origin: vec3(1, 10, 0),
                                     dir: vec3(0, 0, 1) }, host) === null);
  z.removed.push(5, 8);
  check("...and not at all once the hands' draw slots are zero",
        ProcessPlayerShotsTestList(RAY, host) === null);
  z.removed.length = 0;
  const resolved: { kind: string; at?: number; bone?: number }[] = [];
  events.on("shot.resolved", (r) => resolved.push(r));
  QueueShotRequest(0, RAY);
  GameUpdate(1 / 60, host, rng, events);
  const rec = G.g_shot_hit_records[0];
  check("the queued shot takes it: the impact of that surface, where "
        + "`MarkActorShot` spawns it",
        rec?.surface === 0x33 && Math.abs(rec.z - 59) < 1e-6,
        JSON.stringify(rec));
  check("...and the hit on the hand goes to the damage tables like any other",
        resolved.length === 1 && resolved[0].kind === "actor"
        && resolved[0].at === z.at && resolved[0].bone === 5,
        JSON.stringify(resolved));
  T.coli = null;
  SetGameTables(CHARS);
}
