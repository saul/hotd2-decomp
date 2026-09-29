/**
 * The numbers `ZombieInitHalved` (`FUN_0045DA10`) is written in, kept apart
 * from `class30/split.ts` so the exporter can read them without importing the
 * engine -- the same arrangement as `class30/bonecels.ts`. `goreEntry` bakes
 * the stump for character type 0xC because no effect table names it.
 */

/** `EnemyZombieInitByCharType`'s type test for the arm: `case 0xc:`. */
export const CHAR_ZNKAGER = 0xc;
/** ...and the body condition that takes the halved arm. */
export const HALVED_CONDITION = 4;
/**
 * The bone and slot `MOV dword ptr [EAX + 0x71c], 0x1da3` writes at
 * `0x0045DA4A`: `0x71C = 0x20C + 9 * 0x90`, bone 9's draw record, and
 * `0x1DA3` is one past its own `0x1DA2`. No effect table names it -- bone 9's
 * own step is slot 0, damage only -- so this is the one reference in the
 * image.
 */
export const HALVED_STUMP_BONE = 9;
export const HALVED_STUMP_SLOT = 0x1da3;
