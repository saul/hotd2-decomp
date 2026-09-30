/**
 * `g_wCaptionMode` — `0x009C911E`, as this build leaves it.
 *
 * One instruction in the image stores it: `MOV word ptr [0x009c911e], 0x2`
 * at `0x0040AC71`, in `FUN_0040AC60`. A byte search for the address
 * (`1e919c00`) finds that store and sixteen reads -- the credit prompt, the
 * blood sprays, the chapter card's six arms, `DrawDialogueSubtitleTask`,
 * `LoadSceneAndReset`, `AppStateAdvanceByTable` and two routines at
 * `0x0043159F` and `0x00431780` -- and no other write. So every arm that
 * tests for 1 (`CreditPromptMessageIndex`'s blink arm, the chapter card's
 * caption sprite) is one this build never takes, and the port transcribes
 * the test against this constant rather than dropping the arm. A named
 * constant rather than a field of `G` because nothing the port runs can
 * change it. `[proved]`
 */
export const CAPTION_MODE: number = 2;

/** The value the captioned arms test for: `CMP ..., 0x1` / `CMP ..., BX = 1`. */
export const CAPTION_MODE_CAPTIONED = 1;
