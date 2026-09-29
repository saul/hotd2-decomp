/**
 * The page's end of the matchmaker (`matchmaker/rooms.ts` at the repository's
 * root has the server and the protocol): make a room or join one, get TURN
 * credentials, and pass the host's offer and player 2's answer. After that
 * the two browsers talk to each other and this is done.
 */

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * The deployed matchmaker: the Cloudflare Worker in `matchmaker/`, which mints
 * Cloudflare TURN credentials. Every page uses it unless told otherwise, the
 * dev server's included -- so a session between two machines, or two tabs,
 * goes the way a hosted one does, relay and all.
 */
export const DEFAULT_MATCHMAKER =
  "https://hotd2-matchmaker.saul-rennison.workers.dev/net/matchmaker";

/**
 * Where the matchmaker is: `?matchmaker=<url>`; `?matchmaker=local` for the
 * dev server's own, with its own TURN relay (no internet needed, and what the
 * tests use); a build's `VITE_HOTD2_MATCHMAKER`; else {@link DEFAULT_MATCHMAKER}.
 */
export function matchmakerBase(search: string): string {
  const q = new URLSearchParams(search).get("matchmaker");
  if (q === "local") return new URL("net/matchmaker", location.href).href.replace(/\/+$/, "");
  if (q) return q.replace(/\/+$/, "");
  const built = import.meta.env?.VITE_HOTD2_MATCHMAKER as string | undefined;
  return (built || DEFAULT_MATCHMAKER).replace(/\/+$/, "");
}

/** How often a side asks whether the other's message has arrived. */
const POLL_MS = 1000;

export class MatchClient {
  private closed = false;

  private constructor(private readonly base: string, readonly code: string,
                      private readonly token: string,
                      readonly iceServers: IceServer[],
                      readonly role: "host" | "replica") {}

  private static async call(method: string, url: string, body?: unknown): Promise<unknown> {
    const r = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* not JSON: an HTML 404 page */ }
    if (!r.ok) {
      // A 404 with no JSON is no matchmaker at all, not a missing room.
      if (r.status === 404 && !json) throw new Error(`no matchmaker at ${url} (404)`);
      const why = (json as { error?: string } | null)?.error ?? `${r.status} ${r.statusText}`;
      throw Object.assign(new Error(why), { status: r.status });
    }
    return json;
  }

  /** Make a room. The code is what player 2 types, or follows a link to. */
  static async create(base: string): Promise<MatchClient> {
    const r = await MatchClient.call("POST", `${base}/rooms`) as
      { code: string; token: string; iceServers: IceServer[] };
    return new MatchClient(base, r.code, r.token, r.iceServers, "host");
  }

  /** Join a room by its code, as player 2. */
  static async join(base: string, code: string): Promise<MatchClient> {
    const c = code.trim().toUpperCase();
    const r = await MatchClient.call("POST", `${base}/rooms/${encodeURIComponent(c)}/join`) as
      { token: string; iceServers: IceServer[] };
    return new MatchClient(base, c, r.token, r.iceServers, "replica");
  }

  private url(verb?: string): string {
    return `${this.base}/rooms/${encodeURIComponent(this.code)}${verb ? `/${verb}` : ""}`
      + `?token=${encodeURIComponent(this.token)}`;
  }

  /** The host's offer, every candidate in it. */
  async postOffer(sdp: string): Promise<void> {
    await MatchClient.call("PUT", this.url("offer"), { sdp });
  }

  /** Player 2's answer, every candidate in it. */
  async postAnswer(sdp: string): Promise<void> {
    await MatchClient.call("PUT", this.url("answer"), { sdp });
  }

  /** The host's offer, once it is there. */
  waitOffer(): Promise<string> {
    return this.wait("offer");
  }

  /** Player 2's answer, once it is there: the host waits here until player 2 comes. */
  waitAnswer(): Promise<string> {
    return this.wait("answer");
  }

  private async wait(verb: "offer" | "answer"): Promise<string> {
    for (;;) {
      if (this.closed) throw new Error("left the room");
      const r = await MatchClient.call("GET", this.url(verb)) as { sdp: string | null };
      if (r.sdp) return r.sdp;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  /**
   * Stop. The host's room is deleted, so a late join is told there is none;
   * `keepalive` lets that request outlive a page that is closing.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.role === "host") {
      void fetch(this.url(), { method: "DELETE", keepalive: true }).catch(() => {});
    }
  }
}
