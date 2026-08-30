/**
 * `PlaceBreakableGroup` — the class-0x41 type-0 constructor.
 *
 * This is the routine behind "item placement" in this game: the items are not
 * placed, the containers are. One spawn builds a whole group of shootable
 * props from records compiled into the exe, and one of the props of an item
 * set is carrying that set's item.
 */
import type { Rng } from "../../core/rng";
import type { BreakableMember } from "../../bundle";
import { G } from "../globals";
import { T } from "../tables";
import {
  BreakableFlag, BreakableSlot, BreakableState, makeBreakableProp,
  type BreakableProp,
} from "./prop_state";

/**
 * One stack level, in world units. `PlaceBreakableGroup` multiplies the
 * record's `level` byte by it.
 */
export const BREAKABLE_LEVEL_HEIGHT = 7.540296;

/**
 * The floor sits this far below `g_camera_fixed_eye_y`. The constructor adds
 * `g_camera_fixed_eye_y - 0.1` to every member's relative y, and
 * `BreakablePropGroundContact` tests against the same value.
 */
export const BREAKABLE_FLOOR_DROP = 0.1;

/**
 * Group 7's own floor. The constructor overrides the shared floor for this one
 * group with a flat `level * 7.540296 - 14.9`, off `PTR_DAT_00593D0C` rather
 * than the group pointer — so its props are placed relative to nothing, at a
 * fixed height. Stage 2 is the only stage that places it.
 */
export const GROUP7_FLOOR = -14.9;

/** `g_breakable_members` is `group * 9 + member`; nine is the largest group. */
export const MEMBERS_PER_GROUP = 9;

/**
 * `rand()` as the engine's CRT provides it: 15 bits, `[0, 0x7FFF]`.
 *
 * The port's `Rng` is 32-bit, so every `rand()` in this class goes through
 * here. It matters wherever the engine masks or sign-tests the result — a
 * 32-bit draw makes those branches live when the real ones are dead.
 */
export function MsvcRand(rng: Rng): number {
  return rng.int(0x8000);
}

/**
 * The members `g_prop_target_set` turns into one-shot targets while
 * `g_GameMode` is 2.
 *
 * The engine spells this as a chain of comparisons against the *byte offset*
 * into the member records — `iVar8 != 0x14 && iVar8 != 0x1E && …` — which is
 * `member * 10`. Divided through, the four sets are these. Set 3 falls into
 * set 0's test, which is why they are the same list rather than a copy.
 */
export const PROP_TARGET_SETS: number[][] = [
  [2, 3, 4, 6],
  [0, 1, 5],
  [0, 6],
  [2, 3, 4, 6],
];

/** `g_breakable_members[group * 9 + member]`, or 0 when nothing is there. */
export function BreakableMemberSlot(group: number, member: number): number {
  return G.g_breakable_members[group * MEMBERS_PER_GROUP + member] ?? 0;
}

export function SetBreakableMemberSlot(group: number, member: number,
                                       id: number): void {
  G.g_breakable_members[group * MEMBERS_PER_GROUP + member] = id;
}

/** The live prop at a member slot, or undefined once it has been destroyed. */
export function BreakablePropAt(group: number, member: number):
    BreakableProp | undefined {
  const id = BreakableMemberSlot(group, member);
  if (!id) return undefined;
  return G.g_breakable_props.find((p) => p.id === id && !p.dead);
}

/**
 * `PlaceBreakableGroup` — `FUN_00462A80`. Builds one prop per member of the
 * group named by the placer's `+0x11C`, then seeds the item countdown.
 *
 * `lifetime` is the placer's `+0x1F4`, which for this class is the number of
 * evt blocks the props live for and **not** a character type — the same
 * polymorphic field that made 400 spawns look like `char_adv02`.
 *
 * The last thing it does is the mechanic worth reading twice: the group's
 * item-set members are counted, and `g_item_set_countdown` is seeded with
 * `rand() % n + 1`. So the item drops on a *random* one of that set's breaks.
 * It is not the last prop, and a player who breaks them in a different order
 * gets it at a different time.
 */
export function PlaceBreakableGroup(group: number, lifetime: number,
                                    rng: Rng): BreakableProp[] {
  const members = T.breakables?.groups?.[group];
  if (!members?.length) return [];

  const built: BreakableProp[] = [];
  // The engine's two locals: how many members of this group carry an item set,
  // and which set that was. A group holds at most one distinct non-zero set in
  // the shipped data, which is what makes one pair of locals enough.
  let inSet = 0;
  let setId = 0;

  for (const m of members) {
    const p = makeBreakableProp(G.g_breakable_next_id++, group, m.index);
    p.itemSet = m.item_set;
    p.storyItem = m.story_item;
    p.lifetime = lifetime;
    p.spawnBlock = G.g_evt_block_counter;
    p.blocksElapsed = 0;
    p.hp = 2;
    p.slot = BreakableSlot.Default;
    p.state = BreakableState.Standing;
    p.flags = 0x80000000 | BreakableFlag.Live;
    p.effect = 0;

    p.x = m.x;
    p.y = BreakableGroupFloor(group) + m.level * BREAKABLE_LEVEL_HEIGHT;
    p.z = m.z;

    // The engine writes one draw to both the yaw and the topple bearing:
    //     uVar5 = rand() & 0x8000FFFF;  if ((int)uVar5 < 0) sign-extend;
    //     obj+0x1D0 = uVar5;  (s16)obj+0x1FE = uVar5;
    // The mask and the sign-extension are the compiler's `% 0x10000` idiom,
    // and both are **dead**: MSVC's `rand()` is 15 bits, so the value is
    // already in [0, 0x7FFF] and neither the high half nor the sign is ever
    // set. Drawing 16 bits here instead would put half the props at a
    // negative yaw the engine can never produce.
    const r = MsvcRand(rng);
    p.yaw = r;
    p.topple = r;

    // In mode 2 the selected members become one-shot targets with their own
    // model. Everything else keeps two shots and the default slot.
    if (G.g_GameMode === 2
        && (PROP_TARGET_SETS[G.g_prop_target_set] ?? []).includes(m.index)) {
      p.effect = 6;
      p.hp = 1;
      p.slot = BreakableSlot.OneShotTarget;
    }

    SetBreakableMemberSlot(group, m.index, p.id);

    // Three members have an authored topple bearing rather than a random one,
    // and the flag says so. Group 0's member 3 and group 7's member 5 fall a
    // fixed way; group 4's members 2..4 lean by a fixed amount.
    if (group === 0 && m.index === 3) FixTopple(p, 0, rng);
    if (group === 7 && m.index === 5) FixTopple(p, 0x8000, rng);
    if (group === 4) {
      p.flags |= BreakableFlag.FixedTopple;
      if (m.index === 2) p.topple = 0x3000;
      else if (m.index === 3) p.topple = 0x5000;
      else if (m.index === 4) p.topple = 0x4000;
    }

    if (m.item_set > 0) {
      inSet += 1;
      setId = m.item_set;
    }

    G.g_breakable_props.push(p);
    built.push(p);
  }

  if (inSet > 1) {
    G.g_item_set_countdown[setId] = (MsvcRand(rng) % inSet) + 1;
  } else if (inSet === 1) {
    G.g_item_set_countdown[setId] = 1;
  }
  return built;
}

/** The authored-topple case: a fixed bearing and a random backward spin. */
function FixTopple(p: BreakableProp, bearing: number, rng: Rng): void {
  p.topple = bearing;
  p.flags |= BreakableFlag.FixedTopple;
  p.spin = -0x80 - (MsvcRand(rng) % 0x81);
}

/** Where a group's props sit before their stack level is added. */
export function BreakableGroupFloor(group: number): number {
  return group === 7
    ? GROUP7_FLOOR
    : G.g_camera_fixed_eye_y - BREAKABLE_FLOOR_DROP;
}

/** The member records of a group, for the renderer and the tests. */
export function BreakableGroupMembers(group: number): BreakableMember[] {
  return T.breakables?.groups?.[group] ?? [];
}
