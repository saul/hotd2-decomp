/**
 * The port's data segment, on screen, read-only.
 *
 * The port keeps all its state in `G` and the actor list precisely so a
 * snapshot can be taken of it; the same property makes it displayable. What
 * the port believes, next to what the renderer is drawing.
 *
 * Read-only on purpose. A writable globals panel would be a fourth way for
 * state to enter the game — after the script, the port and a snapshot — and
 * nothing done here would be reproducible from a save. `app/` never installs a
 * command that writes one, and `no-engine-writes-in-ui` is the check.
 */
import type { GlobalsProjection } from "../projection";

export function Globals({ p }: { p: GlobalsProjection | null }) {
  // Null means the panel is folded and `app/` did not build it. Rendering
  // nothing is right: the `<details>` is closed, so nobody is looking.
  if (!p) return null;
  return (
    <>
      <table className="gt">
        <tbody>
          {p.rows.map((r) => (
            <tr key={r.name}>
              <td className="gk"
                  title={r.address ? `0x${r.address}`
                                   : "no address cited in game/globals.ts"}>
                {r.name}
              </td>
              <td className="gv">{r.value}</td>
              <td className="gaddr">{r.address ? `0x${r.address}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ghead">
        g_object_list · {p.liveActors} live of {p.actors.length}
      </div>
      <table className="gt">
        <tbody>
          {p.actors.map((a) => (
            <tr key={a.at} className={a.dead ? "gdead" : ""}>
              <td className="gk">{a.at.toString(16)}</td>
              <td>{a.className}</td>
              <td>{a.stateName}/{a.sub}</td>
              <td>hp {a.hp}</td>
              <td className="gdim">{a.flags}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {p.thrown.length > 0 && (
        <>
          <div className="ghead">g_thrown_weapons · {p.thrown.length}</div>
          <table className="gt">
            <tbody>
              {p.thrown.map((w) => (
                <tr key={w.id}>
                  <td className="gk">{w.id}</td>
                  <td>slot {w.slot}</td>
                  <td>ttl {w.ttl}</td>
                  <td className="gdim">{w.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
