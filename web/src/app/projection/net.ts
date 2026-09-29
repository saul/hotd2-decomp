/**
 * Netplay, for the UI: the badge over the game, the overlay's figures, the
 * lobby, and the sidebar's rows -- formatted here, so `ui/` draws strings and
 * decides nothing.
 *
 * The levels are the judgement the overlay is for. A figure is `bad` when it
 * means the game on this screen is not the host's -- a desync, an op that
 * would not apply, a link that has gone quiet while the host's clock runs --
 * and `warn` when it means play will feel worse than it should.
 */
import type { NetLevel, NetProjection, NetRow, StripRow } from "../../ui/projection";
import type { NetSession } from "../net/session";
import { describePath } from "../net/transport";
import type { NetStats } from "../net/stats";

/** No packet for this long, while one is expected, is worth a look... */
const SILENCE_WARN_MS = 150;
/** ...and this long is a link that has stopped. */
const SILENCE_BAD_MS = 500;

const ms = (v: number): string => Number.isNaN(v) ? "—" : `${Math.round(v)} ms`;
const pct = (v: number): string => `${v.toFixed(v < 10 ? 1 : 0)}%`;
const kb = (v: number): string => `${v.toFixed(v < 10 ? 1 : 0)} KB/s`;

/**
 * A tick's cost, mean and worst over the last second, and where it went:
 * "0.84 ms, worst 2.1 · diff 0.52 · hash 0.11 · send 0.18".
 */
function cost(s: NetStats): string {
  const parts = s.costParts.filter(([, v]) => v >= 0.005)
    .map(([k, v]) => `${k} ${v.toFixed(2)}`).join(" · ");
  return `${s.costMs.toFixed(2)} ms, worst ${s.costMax.toFixed(1)}${parts ? ` · ${parts}` : ""}`;
}

function level(bad: boolean, warn: boolean): NetLevel {
  return bad ? "bad" : warn ? "warn" : "ok";
}

function silenceLevel(s: NetStats): NetLevel {
  if (!s.expectTicks) return "";
  return level(s.silence > SILENCE_BAD_MS, s.silence > SILENCE_WARN_MS);
}

/** The badge's one line, and how it should look. */
function badge(net: NetSession, s: NetStats): { text: string; level: NetLevel } {
  const who = net.role === "host" ? "P1 host" : "P2";
  const lobby = net.lobby;
  if (lobby.phase === "error" || lobby.phase === "closed") {
    return { text: `${who} · ${lobby.error ?? lobby.phase}`, level: "bad" };
  }
  if (s.problem) return { text: `${who} · ${s.problem}`, level: "bad" };
  if (lobby.phase === "waiting" && net.role === "host" && lobby.code) {
    return { text: `${who} · waiting for player 2 · code ${lobby.code}`, level: "warn" };
  }
  if (lobby.phase !== "connected") return { text: `${who} · ${lobby.phase}…`, level: "warn" };
  if (s.desynced) return { text: `${who} · DESYNC -- resyncing`, level: "bad" };
  if (silenceLevel(s) === "bad") {
    return { text: `${who} · no packets for ${(s.silence / 1000).toFixed(1)} s`, level: "bad" };
  }
  const parts = [who, ms(s.rtt)];
  if (s.lossIn > 0.5 || s.lossOut > 0.5) {
    parts.push(`loss ${pct(Math.max(s.lossIn, s.lossOut))}`);
  }
  if (s.route.includes("relay")) parts.push("relayed");
  if (s.phase !== "streaming") parts.push(s.phase);
  const warn = s.rtt > 150 || s.lossIn > 3 || s.lossOut > 3
    || silenceLevel(s) === "warn";
  return { text: parts.join(" · "), level: warn ? "warn" : "ok" };
}

function sections(net: NetSession, s: NetStats): { title: string; rows: NetRow[] }[] {
  const host = net.role === "host";
  const link: NetRow[] = [
    { label: "phase", value: s.phase, level: s.problem ? "bad" : "" },
    { label: "transport", value: s.transport || "—", level: "" },
    { label: "route", value: s.route || "—",
      level: s.route.includes("relay") ? "warn" : "",
      title: "The ICE candidate pair in use: host (LAN), srflx (through NAT, found by STUN), relay (through TURN)." },
    { label: "ICE", value: s.ice || "—",
      level: level(s.ice === "failed" || s.ice === "closed", s.ice === "disconnected" || s.ice === "checking") },
    { label: "round trip", value: `${ms(s.rtt)} (min ${ms(s.rttMin)}, max ${ms(s.rttMax)})`,
      level: level(s.rtt > 300, s.rtt > 150),
      title: "From pings on the tick channel, four a second, smoothed." },
    { label: "ICE round trip", value: ms(s.iceRtt), level: "",
      title: "WebRTC's own measure of the selected candidate pair." },
    { label: "loss in / out", value: `${pct(s.lossIn)} / ${pct(s.lossOut)}`,
      level: level(Math.max(s.lossIn, s.lossOut) > 10, Math.max(s.lossIn, s.lossOut) > 2),
      title: "Tick-channel packets missing by sequence over the last second; out is what the other end reports." },
    { label: "since last packet", value: s.expectTicks ? ms(s.silence) : `${ms(s.silence)} (not expected)`,
      level: silenceLevel(s),
      title: "How long since anything arrived on the tick channel. The host sends every tick while its clock runs." },
    { label: "bandwidth in / out", value: `${kb(s.kbIn)} / ${kb(s.kbOut)}`, level: "" },
    { label: "packets in / out", value: `${Math.round(s.pktIn)}/s / ${Math.round(s.pktOut)}/s`, level: "" },
  ];
  const sync: NetRow[] = host ? [
    { label: "epoch · tick", value: `${s.epoch} · ${s.tick}`, level: "" },
    { label: "player 2 behind by", value: `${s.lag} ticks`, level: level(s.lag > 60, s.lag > 20),
      title: "Ticks since the newest one player 2 has said it applied: the base of every delta." },
    { label: "delta, mean", value: `${Math.round(s.deltaBytes)} B`, level: level(s.deltaBytes > 12000, s.deltaBytes > 4000) },
    { label: "keyframes", value: `${s.keyframes} (last ${(s.keyframeBytes / 1024).toFixed(1)} KiB)`, level: "" },
    { label: "cost per tick", value: cost(s), level: level(s.costMs > 4, s.costMs > 2),
      title: "Diffing the state, hashing it and encoding the packet, on this machine." },
    { label: "presses taken", value: String(s.presses), level: "" },
    { label: "player 2's aim", value: Number.isNaN(s.aimError) ? "—" : `${s.aimError.toFixed(4)}° off`,
      level: Number.isNaN(s.aimError) ? "" : level(s.aimError > 1, s.aimError > 0.05),
      title: "The last shot's segment against the host's own record of the camera at the tick player 2 saw. Zero to rounding when replication is right." },
  ] : [
    { label: "epoch · tick", value: `${s.epoch} · ${s.tick}`, level: "" },
    { label: "behind newest", value: `${s.lag} ticks`, level: "" },
    { label: "buffer", value: `${s.depth} ticks, aiming for ${s.target}`,
      level: level(false, s.depth > s.target + 3),
      title: "Ticks received and not yet shown. The aim follows the arrival jitter." },
    { label: "jitter", value: ms(s.jitter), level: level(s.jitter > 80, s.jitter > 30) },
    { label: "underruns · skips", value: `${s.underruns} · ${s.skips}`, level: "",
      title: "A frame with nothing new to show, and ticks jumped over. Both follow lost packets; neither loses state." },
    { label: "keyframes", value: `${s.keyframes} (last ${(s.keyframeBytes / 1024).toFixed(1)} KiB)`, level: "" },
    { label: "cost per tick", value: cost(s), level: level(s.costMs > 4, s.costMs > 2),
      title: "Applying the host's delta and hashing the result." },
    { label: "presses sent", value: String(s.presses), level: "" },
  ];
  const truth: NetRow[] = host ? [
    { label: "desync reports", value: String(s.log.filter((e) => e.kind === "report").length),
      level: s.log.some((e) => e.kind === "report") ? "warn" : "ok" },
  ] : [
    { label: "state", value: s.desynced ? "DIFFERS from the host's" : "matches the host's",
      level: s.desynced ? "bad" : s.verified ? "ok" : "" },
    { label: "ticks verified", value: String(s.verified), level: "",
      title: "Every tick applied is hashed and compared with the hash the host sent with it." },
    { label: "hash mismatches", value: String(s.mismatches), level: s.mismatches ? "bad" : "ok" },
    { label: "apply errors", value: String(s.applyErrors), level: s.applyErrors ? "bad" : "ok" },
    { label: "systems disagree", value: String(s.liveMismatches),
      level: s.liveMismatches ? "bad" : "ok",
      title: "The page's systems re-read and hashed a few times a second: a system "
        + "that does not load what the host sent it shows here and nowhere else." },
  ];
  return [
    { title: "Link", rows: link },
    { title: host ? "Sending" : "Receiving", rows: sync },
    { title: "Is it the same game?", rows: truth },
  ];
}

/**
 * "Copy report"'s JSON, remade at most once a second. It is every figure and
 * the log, and making it -- and handing React a new string for the field it is
 * copied from -- on every frame the overlay was open cost more than the
 * netplay it reports on.
 */
let reported = { at: -Infinity, text: "" };
function report(net: NetSession, s: NetStats, now: number): string {
  if (now - reported.at < 1000) return reported.text;
  const text = JSON.stringify({
    at: new Date().toISOString(), role: net.role, lobby: net.lobby,
    stats: { ...s, log: s.log },
    ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
  }, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v), 2);
  reported = { at: now, text };
  return text;
}

/** What the UI is told about netplay, or null when there is none. */
export function netProjection(net: NetSession, wantStats: boolean,
                              now: number): NetProjection | null {
  const s = net.stats;
  if (!s && net.lobby.phase === "idle") return null;
  // WebRTC's search, while there is one and the link is not up: what each
  // end offered, how the pairs fared, and -- once it is stuck -- why.
  const link = net.link;
  const searching = link?.path && link.state !== "open" && !Number.isNaN(link.path.since)
    && net.lobby.phase !== "error" && net.lobby.phase !== "closed";
  const found = searching ? describePath(link!.path!, link!.ice, now) : null;
  const lobby = { ...net.lobby, path: found?.line ?? null, hint: found?.hint ?? null };
  const held = net.role === "replica" && net.hostHold ? net.hostHold : null;
  if (!s) {
    return { role: net.role, player: net.role === "replica" ? 2 : 1, lobby,
             badge: net.lobby.phase === "error"
               ? { text: net.lobby.error ?? "error", level: "bad" } : null,
             held, stats: null };
  }
  const secs = wantStats ? sections(net, s) : null;
  return {
    role: net.role,
    player: net.role === "replica" ? 2 : 1,
    lobby,
    badge: badge(net, s),
    held,
    stats: secs && {
      sections: secs,
      log: s.log.slice().reverse().map((e) => ({
        age: `${Math.max(0, (now - e.at) / 1000).toFixed(1)} s`,
        tick: e.tick, kind: e.kind, text: e.text,
      })),
      report: report(net, s, now),
    },
  };
}

/** The sidebar's rows: the figures that say whether the session is well. */
export function netRows(net: NetSession): StripRow[] {
  const s = net.stats;
  if (!s) return [["session", net.lobby.phase === "idle" ? "none" : net.lobby.phase]];
  return [
    ["role", net.role === "host" ? "host (player 1)" : "replica (player 2)"],
    ["phase", s.phase, !!s.problem],
    ["round trip", ms(s.rtt)],
    ["loss in / out", `${pct(s.lossIn)} / ${pct(s.lossOut)}`],
    ["route", s.route || "—"],
    ...(net.role === "replica"
      ? [["verified · mismatches", `${s.verified} · ${s.mismatches}`, s.mismatches > 0] as StripRow]
      : [["player 2 behind", `${s.lag} ticks`] as StripRow]),
  ];
}
