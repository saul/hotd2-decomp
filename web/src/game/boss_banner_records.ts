/**
 * The boss-name banner's records, as data.
 *
 * A declarations-and-constants file with no module-scope side effect, for the
 * same reason as `hud_sprites.ts`: the exporter imports the name sprites from
 * here to put them in the bundle, and it has no business pulling the engine in
 * with it. `boss_banner.ts` is the code.
 *
 * Every boss that has a banner passes `BossIntroBannerSpawn` (`FUN_00437A70`)
 * a pointer to one 0x40-byte record, and `BossIntroBannerUpdate`
 * (`FUN_00437AC0`) reads nothing else. Seven records, one per call site, read
 * out of `.rdata` with `read_memory` -- the bytes are quoted on each.
 *
 * ```
 * +0x00 s16  the g_script_flags byte the banner waits for
 * +0x02 s16  the cp_ camera path it flies the camera along
 * +0x04 s16  the frame it ends on (300 in every record)
 * +0x06 s16  the asset slot of the boss's own card -- the one card of eight
 *            that is not a card back
 * +0x08 f32  x, y, z the cards are laid out at, in camera space
 * +0x14 f32  x, y the boss's card slides to while it grows
 * +0x1C f32  -1.0 in every record; nothing in the routine reads it
 * +0x20 s32  the first name sprite, then its x, y and depth
 * +0x30 s32  the second name sprite, then its x, y and depth
 * ```
 */

/** One name sprite: a `SpriteDrawCheckedBank` record's first four words. */
export interface BannerNameSprite {
  sprite: number;
  x: number;
  y: number;
  depth: number;
}

/** One `BossIntroBannerUpdate` record. */
export interface BossIntroBannerRecord {
  /** `+0x00` — the `g_script_flags` byte the banner waits for. */
  flag: number;
  /** `+0x02` — the camera path the banner flies. */
  camPath: number;
  /** `+0x04` — the frame the banner ends on and opens the shutter. */
  endFrame: number;
  /** `+0x06` — the boss's card, an asset slot in the boss's own pol file. */
  cardSlot: number;
  /** `+0x08`..`+0x10` — where the eight cards are laid out. */
  x: number;
  y: number;
  z: number;
  /** `+0x14`/`+0x18` — where the boss's card slides to. */
  toX: number;
  toY: number;
  /** `+0x20`..`+0x2C` and `+0x30`..`+0x3C`. */
  names: readonly [BannerNameSprite, BannerNameSprite];
}

/**
 * The seven records, by the address the caller pushes.
 *
 * The floats are the bytes read back through `Math.fround`, so the port holds
 * exactly the single-precision values the engine does.
 */
export const BOSS_INTRO_BANNERS: Readonly<Record<number, BossIntroBannerRecord>>
  = {
  // `1e00 b500 2c01 7318 1f856bbe 295c8fbd 000080bf b81e05bf 00000000 ...`
  // -- `Boss4StateEntranceCarried`'s, `PUSH 0x5972f8` at `0x00493A9A`.
  0x005972f8: {
    flag: 30, camPath: 181, endFrame: 300, cardSlot: 0x1873,
    x: Math.fround(-0.23), y: Math.fround(-0.07), z: -1,
    toX: Math.fround(-0.52), toY: 0,
    names: [{ sprite: 0xbd, x: 14, y: 104, depth: 1 },
            { sprite: 0xcb, x: 224, y: 104, depth: 1 }],
  },
  // The same but for the path, `bd00` -- `Boss4StateEntranceDropped`'s.
  0x00597338: {
    flag: 30, camPath: 189, endFrame: 300, cardSlot: 0x1873,
    x: Math.fround(-0.23), y: Math.fround(-0.07), z: -1,
    toX: Math.fround(-0.52), toY: 0,
    names: [{ sprite: 0xbd, x: 14, y: 104, depth: 1 },
            { sprite: 0xcb, x: 224, y: 104, depth: 1 }],
  },
  // `0200 3000 2c01 1d18 ec51383e 295c8fbd 000080bf 8fc2753d 0ad7233c ...`
  // -- `Class22Init`'s, variant 1 (`PUSH 0x570ec8` before `0x0049B204`).
  0x00570ec8: {
    flag: 2, camPath: 48, endFrame: 300, cardSlot: 0x181d,
    x: Math.fround(0.18), y: Math.fround(-0.07), z: -1,
    toX: Math.fround(0.06), toY: Math.fround(0.01),
    names: [{ sprite: 0xba, x: 310, y: 84, depth: 1 },
            { sprite: 0xc8, x: 526, y: 84, depth: 1 }],
  },
  // `0900 6500 2c01 2118 1f856bbe 295c8fbd 000080bf b81e05bf 00000000 ...`
  // -- `Class14StateEntranceA`'s, `PUSH 0x5966b8` at `0x0047817C`.
  0x005966b8: {
    flag: 9, camPath: 101, endFrame: 300, cardSlot: 0x1821,
    x: Math.fround(-0.23), y: Math.fround(-0.07), z: -1,
    toX: Math.fround(-0.52), toY: 0,
    names: [{ sprite: 0xbb, x: 14, y: 104, depth: 1 },
            { sprite: 0xc9, x: 264, y: 104, depth: 1 }],
  },
  // The same but for the path, `6900` -- `Class14StateEntranceB`'s,
  // `PUSH 0x5966f8` at `0x004783D1`.
  0x005966f8: {
    flag: 9, camPath: 105, endFrame: 300, cardSlot: 0x1821,
    x: Math.fround(-0.23), y: Math.fround(-0.07), z: -1,
    toX: Math.fround(-0.52), toY: 0,
    names: [{ sprite: 0xbb, x: 14, y: 104, depth: 1 },
            { sprite: 0xc9, x: 264, y: 104, depth: 1 }],
  },
  // `3200 e100 2c01 2619 ec51383e ...` -- class 0x2D's, `PUSH 0x5898c8` at
  // `0x00426B46`. Not one of this work's bosses; carried so the table is the
  // whole of what the routine can be handed.
  0x005898c8: {
    flag: 50, camPath: 225, endFrame: 300, cardSlot: 0x1926,
    x: Math.fround(0.18), y: Math.fround(-0.07), z: -1,
    toX: Math.fround(0.06), toY: Math.fround(0.01),
    names: [{ sprite: 0xbf, x: 310, y: 80, depth: 1 },
            { sprite: 0xcd, x: 526, y: 84, depth: 1 }],
  },
  // `1600 d400 2c01 aa18 1f856bbe ...` -- `Class32Init`'s, `PUSH 0x596ac0` at
  // `0x0047F762`. Likewise carried, not used by this work.
  0x00596ac0: {
    flag: 22, camPath: 212, endFrame: 300, cardSlot: 0x18aa,
    x: Math.fround(-0.23), y: Math.fround(-0.07), z: -1,
    toX: Math.fround(-0.52), toY: 0,
    names: [{ sprite: 0xbe, x: 14, y: 104, depth: 1 },
            { sprite: 0xcc, x: 264, y: 104, depth: 1 }],
  },
};

/**
 * The card backs, `PUSH 0x7ed` / `PUSH 0x7ee` at `0x00437BBF`/`0x00437BC9`:
 * `etc_2.bin`. Card 0 draws the first and every card but 0 and 6 the second.
 */
export const BANNER_CARD_BACK_FIRST = 0x7ed;
export const BANNER_CARD_BACK = 0x7ee;

/**
 * Which records each spawn class hands `BossIntroBannerSpawn`, by the call
 * site: `Boss4StateEntranceCarried`/`Dropped` (0x19), `Class22Init` (0x22),
 * `Class14StateEntranceA`/`B` (0x14), `0x00426B4B` (0x2D) and `Class32Init`
 * (0x32). The seven `get_xrefs_to 0x00437A70` returns, and no others.
 */
export const BANNER_RECORDS_BY_CLASS:
    Readonly<Record<number, readonly number[]>> = {
  0x14: [0x005966b8, 0x005966f8],
  0x19: [0x005972f8, 0x00597338],
  0x22: [0x00570ec8],
  0x2d: [0x005898c8],
  0x32: [0x00596ac0],
};

/**
 * `[port-only]` -- every model a banner could draw in a stage whose script
 * spawns `classes`:
 * the two card backs and each record's boss card. The exporter's list for
 * the view-space rig `render/effects.ts` draws the cards from.
 */
export function bannerCardSlots(classes: Iterable<number>): number[] {
  const out: number[] = [];
  for (const cls of classes) {
    for (const r of BANNER_RECORDS_BY_CLASS[cls] ?? []) {
      const rec = BOSS_INTRO_BANNERS[r];
      for (const s of [BANNER_CARD_BACK_FIRST, BANNER_CARD_BACK, rec.cardSlot]) {
        if (!out.includes(s)) out.push(s);
      }
    }
  }
  return out;
}

/** Every name sprite a banner can draw -- the exporter's list. */
export const BOSS_BANNER_SPRITES: readonly number[] = [
  ...new Set(Object.values(BOSS_INTRO_BANNERS)
    .flatMap((r) => r.names.map((n) => n.sprite))),
];
