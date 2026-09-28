/**
 * The HUD shutter, as the script sees it.
 *
 * evt `0x1F` is `EvtOpSetHudShutterState1F` (`FUN_0045F380`), and the whole of
 * that routine is one store: its operand into `g_bHudShutterState`. The
 * machine behind the byte -- the seeding, the 40-frame slide, the one-frame
 * states, the restore, and every write of the firing gate -- is
 * `HudDrawShutterState` (`FUN_00413970`), which is a task of the scene's own
 * and runs once a frame after the player tasks. It is in `game/hud_shutter.ts`
 * for that reason, and `SceneTaskWalk` runs it where the engine's task list
 * does.
 *
 * It used to be here, stepped at the top of the walker's next tick, with the
 * seeding and the gate done by the opcode as well. That put every part of it
 * a frame out: the gate came up on the frame of the `0x1F` rather than the
 * one after, the slide drew one counter value behind, and a close dropped the
 * gate a frame early. What is left is the view the walker has always
 * exposed: `shutterState`, `shutterPrev`, `shutterCounter` and `firingGate`
 * are accessors onto this, and this is accessors onto `G`, so the save slice,
 * the HUD strip and `Walker.canSkip` go on speaking the same four names about
 * the one copy of each.
 */
import { G } from "../../game/globals";
import { HudShutterTaskCreate, ShutterState } from "../../game/hud_shutter";

export class Shutter {
  /** `g_bHudShutterState` (`0x009CA0F4`), which is `G`'s. */
  get state(): number { return G.g_bHudShutterState; }
  set state(v: number) { G.g_bHudShutterState = v; }
  /** `g_bHudShutterPrev` (`0x009C8E9C`), which is `G`'s. */
  get prev(): number { return G.g_bHudShutterPrev; }
  set prev(v: number) { G.g_bHudShutterPrev = v; }
  /** The draw task's slide counter, `G.g_hud_shutter_counter`. */
  get counter(): number { return G.g_hud_shutter_counter; }
  set counter(v: number) { G.g_hud_shutter_counter = v; }
  /** `g_nFiringGate` (`0x009C8E00`), which is `G`'s. */
  get firingGate(): boolean { return G.g_nFiringGate !== 0; }
  set firingGate(v: boolean) { G.g_nFiringGate = v ? 1 : 0; }

  /**
   * A stage from cold: the three writes a scene load makes to these words.
   *
   * `ResetSceneOnEnter` (`FUN_0045EDD0`) stores 5 into both bytes and drops the
   * gate, and `HudShutterTaskCreate` zeroes the counter. The port's own
   * `ResetSceneOnEnter` and `ResetGameGlobals` make the same writes, and a
   * stage load and a seek both go through them; this is here for a walker
   * reset on its own.
   */
  reset(): void {
    this.state = this.prev = ShutterState.CloseHoldFire;
    this.firingGate = false;
    HudShutterTaskCreate();
  }

  /** evt `0x1F`: the store, and nothing else. See the note at the top. */
  set(state: number): void {
    this.state = state;
  }
}
