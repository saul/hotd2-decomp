/**
 * Two players over the network, on the page: the badge that says how the link
 * is, the overlay that says everything, the card that shows the room code
 * while player 2 is on the way, and the menu's section that starts it all.
 *
 * Every figure and every judgement of it -- `ok`, `warn`, `bad` -- is
 * `app/projection/net.ts`'s; these lay it out. What they add is only what
 * never leaves the page: copying a code or a report to the clipboard.
 */
import { useRef, useState } from "react";
import { useDispatch } from "../store_context";
import { useSlice } from "../useSlice";
import type { NetProjection } from "../projection";

type CopyField = HTMLInputElement | HTMLTextAreaElement;

/**
 * Put `field`'s text on the clipboard, and say whether it got there.
 *
 * `navigator.clipboard` exists only on a secure page -- https, or localhost --
 * and the dev server reached from a phone is neither (`http://192.168.x.x`),
 * so there the button said "Link copied" over an empty clipboard. The old
 * way still works there: select the text in a field and `execCommand("copy")`,
 * inside the press (so the clipboard API is not awaited first on such a page),
 * and on iOS with an explicit selection range. The field is one React renders
 * -- the join link's own box, or a hidden one beside the button.
 */
async function copy(field: CopyField): Promise<boolean> {
  const text = field.value;
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* refused: the old way, below, if the press still counts */ }
  }
  field.select();
  field.setSelectionRange(0, text.length);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

/** A copy button's state: what it says, and the press that copies a field. */
function useCopy(): [string | null, (field: CopyField | null) => void] {
  const [said, setSaid] = useState<string | null>(null);
  return [said, (field) => {
    if (!field) return;
    void copy(field).then((ok) => setSaid(ok ? "copied" : "failed"));
  }];
}

/**
 * The one line over the game whenever a session is up: who this page is, the
 * round trip, the loss -- and in red, whatever means the game on this screen
 * may not be the host's. A press opens the overlay.
 */
export function NetBadge() {
  const net = useSlice((p) => p?.net ?? null);
  const dispatch = useDispatch();
  const open = useSlice((p) => p?.toggles.netStats) === true;
  if (!net?.badge) return null;
  return (
    <button id="net-badge" className={`net-${net.badge.level}`}
            title="Netplay: press for the whole of it (I)"
            aria-pressed={open}
            onClick={() => dispatch({ kind: "toggle", name: "netStats", on: !open })}>
      <span className="net-dot" aria-hidden="true" />
      {net.badge.text}
    </button>
  );
}

/** Everything the session measures, grouped, with the desync log under it. */
export function NetOverlay() {
  const net = useSlice((p) => p?.net ?? null);
  const dispatch = useDispatch();
  const [copied, copyNow] = useCopy();
  const reportField = useRef<HTMLTextAreaElement>(null);
  const stats = net?.stats;
  if (!net || !stats) return null;
  return (
    <div id="net-overlay" role="dialog" aria-label="Netplay">
      <div className="net-head">
        <b>{net.role === "host" ? "Player 1 · host" : "Player 2 · replica"}</b>
        {net.held && <span className="net-held"> · host {net.held}</span>}
        <span className="net-actions">
          {net.role === "replica" && (
            <button onClick={() => dispatch({ kind: "netResync" })}
                    title="Ask the host for a keyframe: the whole state, again">
              Resync
            </button>
          )}
          <textarea className="net-copy-field" ref={reportField} value={stats.report}
                    readOnly tabIndex={-1} aria-hidden="true" />
          <button onClick={() => copyNow(reportField.current)}
                  title="Every figure and the log, as JSON, for a bug report">
            {copied === "copied" ? "Copied" : copied === "failed" ? "Could not copy" : "Copy report"}
          </button>
          <button onClick={() => dispatch({ kind: "toggle", name: "netStats", on: false })}
                  aria-label="Close">×</button>
        </span>
      </div>
      {stats.sections.map((s) => (
        <section key={s.title}>
          <h6>{s.title}</h6>
          <table>
            <tbody>
              {s.rows.map((r) => (
                <tr key={r.label} title={r.title}>
                  <th>{r.label}</th>
                  <td className={r.level ? `net-${r.level}` : undefined}>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <section>
        <h6>Log</h6>
        {stats.log.length === 0
          ? <p className="net-dim">Nothing has gone wrong.</p>
          : (
            <ol className="net-log">
              {stats.log.map((e, i) => (
                <li key={i} className={`net-log-${e.kind}`}>
                  <span className="net-dim">{e.age} ago · tick {e.tick} · {e.kind}</span>
                  <br />{e.text}
                </li>
              ))}
            </ol>
          )}
      </section>
    </div>
  );
}

function lobbyText(net: NetProjection): { title: string; body: string } | null {
  const l = net.lobby;
  switch (l.phase) {
    case "creating": return { title: "Making a room…", body: "" };
    case "waiting":
      if (net.role !== "host") return null;
      if (l.path) {
        return { title: "Connecting to player 2…",
                 body: "Their page is in the room. The game is held until they are in." };
      }
      return { title: "Waiting for player 2",
               body: "Send them the link, or have them choose Join and type the code."
                 + " The game is held until they are in; Cancel plays on alone." };
    case "joining": return { title: `Joining ${l.code ?? ""}…`, body: "" };
    case "connecting":
      return l.hint
        ? { title: "No way through yet", body: "Still trying; this is what it has found." }
        : { title: "Connecting…", body: "Finding a way through both networks." };
    case "error":
    case "closed":
      return { title: l.phase === "error" ? "Could not connect" : "The session ended",
               body: l.error ?? "" };
    default: return null;
  }
}

/**
 * The card over the game while a session is being made: the room code big
 * enough to read across a room, the link to send, and a way out.
 */
export function NetLobbyCard() {
  const net = useSlice((p) => p?.net ?? null);
  const dispatch = useDispatch();
  const [copied, copyNow] = useCopy();
  const linkField = useRef<HTMLInputElement>(null);
  const share = typeof navigator !== "undefined" && typeof navigator.share === "function";
  if (!net) return null;
  const t = lobbyText(net);
  if (!t) return null;
  const l = net.lobby;
  const bad = l.phase === "error" || l.phase === "closed";
  return (
    <div id="net-lobby" className={bad ? "net-bad" : undefined} role="status">
      <h5>{t.title}</h5>
      {net.role === "host" && l.phase === "waiting" && l.code && (
        <>
          <div className="net-code">{l.code}</div>
          {l.link && (
            <>
              <div className="net-link-row">
                <button className="net-link" onClick={() => copyNow(linkField.current)}>
                  {copied === "copied" ? "Link copied"
                    : copied === "failed" ? "Could not copy" : "Copy the join link"}
                </button>
                {/* The share sheet, where there is one (a secure page): on a
                    phone, the way to send a link is Messages, not a clipboard. */}
                {share && (
                  <button className="net-link"
                          onClick={() => void navigator.share({ url: l.link! }).catch(() => {})}>
                    Share
                  </button>
                )}
              </div>
              {/* The link itself: what the button copies from, and a box to
                  press and hold, or select, when copying is not allowed. */}
              <input className="net-link-text" ref={linkField} value={l.link} readOnly
                     aria-label="Join link" onFocus={(e) => e.currentTarget.select()} />
            </>
          )}
        </>
      )}
      {t.body && <p>{t.body}</p>}
      {l.path && <p className="net-path">{l.path}</p>}
      {l.hint && <p className="net-hint">{l.hint}</p>}
      <button className="net-leave" onClick={() => dispatch({ kind: "netLeave" })}>
        {bad ? "Close" : "Cancel"}
      </button>
    </div>
  );
}

/** The menu's section: host, join, or -- in a session -- leave. */
export function NetMenuSection({ onClose }: { onClose: () => void }) {
  const net = useSlice((p) => p?.net ?? null);
  const dispatch = useDispatch();
  const [code, setCode] = useState("");
  const active = net && net.role !== "solo";
  return (
    <section className="menu-net">
      <h6>Two players</h6>
      {active ? (
        <div className="net-menu-row">
          <span className="net-dim">
            {net.role === "host" ? "Hosting" : "Player 2"}
            {net.lobby.code ? ` · ${net.lobby.code}` : ""}
          </span>
          <button onClick={() => { dispatch({ kind: "netLeave" }); onClose(); }}>
            Leave
          </button>
        </div>
      ) : (
        <>
          <button className="net-host"
                  title="Make a room and play this stage with a friend: you run the game, they join from their own browser"
                  onClick={() => { dispatch({ kind: "netHost" }); onClose(); }}>
            <span className="mi">⇄</span> Host a two-player game
          </button>
          <form className="net-join"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (code.trim().length >= 4) {
                    dispatch({ kind: "netJoin", code: code.trim() });
                    onClose();
                  }
                }}>
            <input value={code} maxLength={12} placeholder="Room code"
                   aria-label="Room code" autoCapitalize="characters"
                   spellCheck={false}
                   onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <button type="submit" disabled={code.trim().length < 4}>Join</button>
          </form>
        </>
      )}
    </section>
  );
}

/**
 * The other player's crosshair, where the game says they are aiming: blue
 * for player 2, red for player 1, as the cabinet's two guns were.
 */
export function PeerCrosshair() {
  const peer = useSlice((p) => p?.netPeer ?? null);
  if (!peer) return null;
  return (
    <div className={`crosshair peer p${peer.player}`}
         style={{ left: `${peer.x}px`, top: `${peer.y}px` }}>
      <span>P{peer.player}</span>
    </div>
  );
}
