/**
 * The game-over screen, drawn from `game/game_over.ts`'s state -- and its
 * two port-only buttons.
 *
 * What the engine draws here is screen sprites `0x43A..0x43D` out of texbank
 * `0x155`, which the bundle does not carry (`[diverges]`, see
 * `game/game_over.ts`). Each live record is drawn where and as large and as
 * opaque as the record says, as text standing in for its picture: the plate
 * `0x43A` as GAME OVER, the three flashes as a glint.
 *
 * The buttons are **the page's, not the game's** (`[port-only]`): the engine
 * hands on to its next screen, which the port does not have. Both start a new
 * game through the same path a page load takes.
 */
import { useDispatch } from "../store_context";
import { useSlice } from "../useSlice";

/** What stands in for each sprite id's picture. */
const STAND_IN: Record<number, string> = {
  0x43a: "GAME OVER",
  0x43b: "\u2726",
  0x43c: "\u2727",
  0x43d: "\u2736",
};

export function GameOver() {
  const dispatch = useDispatch();
  const g = useSlice((s) => s?.gameOver);
  if (!g) return null;
  return (
    <div id="gameover" data-phase={g.phase}>
      {g.sprites.map((s, i) => (
        <span key={i} className={`go-sprite go-${s.id.toString(16)}`}
              style={{
                left: `${(s.x / 640) * 100}%`,
                top: `${(s.y / 480) * 100}%`,
                opacity: s.alpha,
                transform: `translate(-50%, -50%) scale(${s.sx}, ${s.sy})`,
              }}>{STAND_IN[s.id] ?? ""}</span>
      ))}
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
