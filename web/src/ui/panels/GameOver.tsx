/**
 * The game-over screen's two port-only buttons, and the phase's name.
 *
 * What the engine draws on this screen -- the GAME OVER plate `0x43A`, the
 * flashes `0x43B..0x43D`, the route map's tiles -- are screen sprites, and
 * they go where every screen sprite goes: `DrawScreenSprite` records in
 * `G.g_screen_sprite_draws`, drawn by the HUD layer from the bundle's images.
 * Nothing of the game is drawn here.
 *
 * The buttons are **the page's, not the game's** (`[port-only]`): the engine
 * hands on to its next screen, which the port does not have. Both start a new
 * game through the same path a page load takes.
 */
import { useDispatch } from "../store_context";
import { useSlice } from "../useSlice";

export function GameOver() {
  const dispatch = useDispatch();
  const g = useSlice((s) => s?.gameOver);
  if (!g) return null;
  return (
    <div id="gameover" data-phase={g.phase}>
      <div className="go-panel">
        <span className="tag">{g.label}</span>
        <button id="gameover-restart"
                onClick={() => dispatch({ kind: "restartStage" })}>
          Restart this stage</button>
        <button id="gameover-first"
                onClick={() => dispatch({ kind: "restartFromStageOne" })}>
          Start from stage 1</button>
      </div>
    </div>
  );
}
