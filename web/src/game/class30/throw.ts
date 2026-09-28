/**
 * The weapon a class-0x30 zombie lets go of: `ZombieThrowHandWeapon`.
 *
 * What happens to it afterwards is `class30/thrown_weapon.ts` — its own task,
 * `ZombieThrownWeaponUpdate` (`FUN_0045A4F0`), referenced exactly once in the
 * binary, by this allocation, and never through `g_class_handlers`. So it has
 * no `SpawnClass` here either; it goes into `G.g_thrown_weapons` beside class
 * 0x31's, carrying which routine it runs.
 */
import type { Events } from "../../core/events";
import type { ZombieActor } from "../actor";
import { G } from "../globals";
import type { GameHost } from "../host";
import { FtolS16 } from "../matrix";
import { CharacterTypeOf } from "../tables";
import {
  ThrownWeaponAlloc, ThrownWeaponCameraOf, ThrownWeaponRoutine,
  THROWN_WEAPON_DRAW_FLAGS, THROWN_WEAPON_HIT_RADIUS, THROWN_WEAPON_SPAWN_FLAGS,
} from "../thrown_weapon";
import { VecToAngles } from "../vec";
import { STAND_THROW_CONDITION } from "./stand_throw";
import {
  ZombieThrownWeaponAimAtCamera, ZombieThrownWeaponState, ZOMBIE_AXE_SLOT,
  ZOMBIE_AXE_SPIN, ZOMBIE_BLADE_SPIN, ZOMBIE_WEAPON_ROLL,
} from "./thrown_weapon";

/**
 * How high the hand is above the actor's own origin, for the fallback when
 * the host has no skeleton to ask. The same four units class 0x31 uses.
 */
const HAND_HEIGHT = 4;
/**
 * `obj+0x1370`: `0x3FC00000` for a thrower in body condition 7 and
 * `0x3F800000` otherwise (`0x0045A456`..`0x0045A46C`) — the stationary thrower
 * throws faster. Only the straight flight reads it; the arc passes a literal.
 */
const SPEED_STANDING = 1.5;
const SPEED = 1.0;

/**
 * `ZombieThrowHandWeapon` — `FUN_0045A240`. The weapon leaves the hand.
 *
 * ```
 * w = ActorAlloc(ZombieThrownWeaponUpdate, 0x13F4); ActorClearGameFields(w);
 * ActorClaimHitSlot(w)
 * switch (thrower char type) { hand 5 / 8: the hand's slot goes bare, the
 *     bone record's +0x78 goes to zero, w+0x13F0 = the projectile }
 * w+0x40 = the hand's bone position, into the world
 * w+0x34 = 0x80000001; w+0x124 = w+0x128 = 2.0
 * w+0x121 = thrower+0x121; thrower+0x121 = 0
 * w+0x1F8 = 5; w+0x1390 = thrower; w+0x1358 = hand; w+0x1338 = w+0x133C = 7
 * the axe:  w+0x135C = 0xB00,  state 1       anything else: 0x1600, state 2
 * w+0x1312 = 0; w+0x1370 = thrower condition == 7 ? 1.5 : 1.0
 * w+0x1360 = g_max_attackers; ZombieThrownWeaponAimAtCamera(w)
 * VecToAngles(target - pos, flat) -> w+0x64, w+0x68; w+0x6C = 0x800
 * w+0x100 = pos + (0, 1.5, 0) for the axe; RegisterForCameraTracking(w)
 * ```
 *
 * **The permit goes with the weapon** (`0x0045A3DD`..`0x0045A3EC`), and the
 * thrower is left holding **0, not -1**: `MOV byte ptr [EDI+0x121], BL` with
 * `EBX` zeroed at `0x0045A26F`. The weapon gives it back when it has blinked
 * out or been shot down; the thrower's own clip end drops only the off-screen
 * latch (`ZombieStateStandAndThrow`, `0x0045934C`), which unlike class 0x31's
 * launcher this one does not move across. `[proved]`
 *
 * A `hand` that is neither 5 nor 8 falls out of the switch with nothing
 * swapped and a zero model, and the weapon is **still made** — with no model
 * to draw it flies unseen and still lands on the player. `znassb`'s second
 * throw can ask for one (see `ZombieStateStandAndThrow`), and so it is kept.
 *
 * **The second write is not another bone.** `*(bone * 0x90 + 0x284 + obj) = 0`
 * — `899f54050000` for bone 5 at 0x0045A2B2 and `899f04070000` for bone 8 at
 * 0x0045A2DB — is the bone record's own `+0x78`, which `SkeletonWalkNode`
 * (`FUN_004107E0`) fills as the bone's **hit-sphere radius**; zeroing it makes
 * the hand it just emptied unshootable. `SpawnThrownWeapon` (`FUN_004504E0`)
 * does the identical write for class 0x31 at 0x00450540.
 *
 * `[diverges]` Three writes are not made. The hit sphere is not cleared,
 * because `render/characters.ts` tests `type.bones[].hit_radius` from the
 * static table and the actor has no per-bone radius to zero — the same gap
 * that lets a gore-swapped bone keep a sphere the engine drops. The hit slot
 * is not claimed, because `g_hit_slots` holds actors and the only thing that
 * reads it is a class-0x30 bone's cel phase. And the camera is not told,
 * because the candidate list takes actors only (`body_creature.ts` has the
 * same gap).
 */
export function ZombieThrowHandWeapon(obj: ZombieActor, hand: number,
                                      host: GameHost,
                                      events?: Events): void {
  const w = ThrownWeaponAlloc(ThrownWeaponRoutine.Zombie);
  const kit = CharacterTypeOf(obj)?.zombie_throw;
  const h = kit?.hands.find((x) => x.bone === hand);
  if (h) {
    obj.boneSlot[String(h.bone)] = h.bare;
    host.setBoneSlot(obj.at, h.bone, h.bare);
    w.slot = h.projectile;
  }

  if (!host.boneWorld(obj.at, hand, w.pos)) {
    w.pos.x = obj.pos.x; w.pos.y = obj.pos.y + HAND_HEIGHT; w.pos.z = obj.pos.z;
  }
  w.flags = THROWN_WEAPON_SPAWN_FLAGS;
  w.hitRadius = THROWN_WEAPON_HIT_RADIUS;
  w.attackPermit = obj.attackPermit;
  obj.attackPermit = 0;
  w.drawFlags = THROWN_WEAPON_DRAW_FLAGS;
  w.from = obj.at;
  w.hand = hand;
  // `obj+0x1338 = obj+0x133C = 7` at `0x0045A419`: the afterimage timers
  // class 0x31's `zslman` blades count down. Nothing in this family reads
  // them, so the record does not carry them.
  if (w.slot === ZOMBIE_AXE_SLOT) {
    w.spinRate = ZOMBIE_AXE_SPIN;
    w.state = ZombieThrownWeaponState.Straight;
  } else {
    w.spinRate = ZOMBIE_BLADE_SPIN;
    w.state = ZombieThrownWeaponState.Arc;
  }
  w.sub = 0;
  w.speed = obj.condition === STAND_THROW_CONDITION ? SPEED_STANDING : SPEED;
  w.maxAttackers = G.g_max_attackers;
  ZombieThrownWeaponAimAtCamera(w, ThrownWeaponCameraOf(host));
  const a = VecToAngles(w.target.x - w.pos.x, 0, w.target.z - w.pos.z);
  w.rx = FtolS16(a.pitch);
  w.ry = FtolS16(a.yaw);
  w.rz = ZOMBIE_WEAPON_ROLL;
  G.g_thrown_weapons.push(w);
  events?.emit("enemy.threw", { at: obj.at, who: obj.name });
}
