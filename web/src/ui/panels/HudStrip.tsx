/**
 * The key/value strip along the top: what the player believes, right now.
 *
 * Every row is assembled in `app/`, because most of them are a layer's own
 * one-line `describe` and the UI has no business asking a layer anything.
 */
export function HudStrip(
  { rows }: { rows: readonly [string, string, boolean?][] },
) {
  return (
    <>
      {rows.map(([k, v, hot], i) => (
        <span key={i} style={{ display: "contents" }}>
          <span className="k">{k}</span>
          <span className={hot ? "v hot" : "v"}>{v}</span>
        </span>
      ))}
    </>
  );
}
