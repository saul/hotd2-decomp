/**
 * The data segment, turned into rows the UI can draw.
 *
 * This is `app/`'s job and not the panel's: `ui/` may not import `game/`, so
 * everything that knows what an `Actor` is or where `g_attack_permits` lives
 * happens here, and the panel receives strings and numbers.
 *
 * The addresses come out of `game/globals.ts` itself, at build time, by the
 * same regex `tools/verify_port.py` uses. Retyping them would be a second
 * source of truth for something already checked against `globals.tsv`.
 */
import globalsSrc from "../../game/globals.ts?raw";
import { G } from "../../game/globals";
import type { Actor } from "../../game/actor";
import { SpawnClass } from "../../game/spawn_class";
import { SetPieceState } from "../../game/class24";
import { ZombieState } from "../../game/class30/states";
import { g_class_handlers } from "../../game/registry";
import type { ActorRow, GlobalRow, GlobalsProjection, ThrownRow }
  from "../../ui/projection";

/** `` `g_attack_permits` — `0x009A2BA0` `` in a doc comment. */
const CITATION = /`(g_[A-Za-z0-9_]+)`\s*[-—]+\s*`?0x([0-9A-Fa-f]{6,8})`?/g;

const ADDRESSES: Map<string, string> = new Map(
  [...globalsSrc.matchAll(CITATION)].map(
    (m) => [m[1], m[2].toUpperCase().padStart(8, "0")]),
);

/** Keys rendered as their own section rather than as a value. */
const POOLS = new Set(["g_object_list", "g_thrown_weapons", "g_rain_particles"]);

const num = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(2);

function value(v: unknown): string {
  if (typeof v === "number") return num(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return `[${v.map((x) => value(x)).join(", ")}]`;
  if (v && typeof v === "object" && "x" in v) {
    const p = v as { x: number; y: number; z: number };
    return `(${num(p.x)}, ${num(p.y)}, ${num(p.z)})`;
  }
  return String(v);
}

/**
 * The classes whose state indices are named.
 *
 * Class 0x24 is here because its selector is `obj+0x130C`, not `obj+0x1310`:
 * once that was corrected, `a.state` was permanently 0 for a set-piece and
 * this row read `state 0` for all 21 of them on stage 2.
 *
 * [port-only] This layer *may* ask the class -- `app/` sees everything, and
 * `ClassHandler.debug()` is the seam built for exactly this. It does not yet,
 * because the debug-box labels in `render/debug.ts` need the same string and
 * that layer may not make an engine call. Both should read one summary from
 * this projection; until they do, two places name classes by hand.
 */
function stateName(a: Actor): string {
  if (a.cls === SpawnClass.SetPieceProp) {
    return SetPieceState[a.selector] ?? `selector ${a.selector}`;
  }
  if (a.cls !== SpawnClass.Zombie) return `state ${a.state}`;
  return ZombieState[a.state] ?? `state ${a.state}`;
}

/** One actor, flattened. The sidebar and the debug boxes both read these. */
export function actorRow(a: Actor, range = 0, blocking = false): ActorRow {
  const ported = g_class_handlers[a.cls] !== undefined;
  return {
    at: a.at,
    cls: a.cls,
    className: SpawnClass[a.cls] ?? `0x${a.cls.toString(16)}`,
    state: a.state,
    stateName: ported ? stateName(a) : "—",
    hp: a.hp,
    dead: a.dead,
    visible: a.visible,
    despawned: a.despawned,
    range,
    blocking,
    ported,
    sub: a.sub,
    flags: [
      a.dead ? "dead" : null,
      !a.visible ? "unloaded" : null,
      a.attackPermit >= 0 ? `permit ${a.attackPermit}` : null,
      a.zones ? `zones ${a.zones}` : null,
      ported ? null : "no module",
    ].filter(Boolean).join(" · "),
  };
}

/**
 * The whole panel's worth.
 *
 * Built only while the panel is open, because it walks every global and every
 * actor and formats them all — cheap once, wasteful sixty times a second at
 * the bottom of a folded `<details>`.
 */
export function globalsProjection(): GlobalsProjection {
  const rows: GlobalRow[] = [];
  for (const [k, v] of Object.entries(G)) {
    if (POOLS.has(k)) continue;
    rows.push({ name: k, value: value(v), address: ADDRESSES.get(k) ?? "" });
  }
  const thrown: ThrownRow[] = G.g_thrown_weapons.map((w) => ({
    id: w.id, slot: w.slot, ttl: num(w.ttl),
    state: w.hit ? "hit" : "in flight",
  }));
  return {
    rows,
    actors: G.g_object_list.map((a) => actorRow(a)),
    liveActors: G.g_object_list.filter((a) => a.visible && !a.dead).length,
    thrown,
  };
}
