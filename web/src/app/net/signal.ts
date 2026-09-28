/**
 * The page's end of the rendezvous (`tools/signal/rooms.ts` has the server's
 * and the protocol): make a room or join one, then pass WebRTC's offers,
 * answers and candidates to the other side until the peers can talk.
 *
 * It stays open for the whole session, not just the connect. An ICE restart
 * -- a phone leaving Wi-Fi for cellular -- is a new offer and answer, and
 * they go this way.
 */

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** What the rendezvous says on the event stream. */
export type SignalEvent =
  /** Whether player 2 is in the room, and which of their joins this is. */
  | { t: "peer"; joined: boolean; n: number }
  | { t: "signal"; data: unknown }
  | { t: "closed"; reason: string };

/** Where the rendezvous is: `?signal=`, the build's setting, or the dev server. */
export function signalBase(search: string): string {
  const q = new URLSearchParams(search).get("signal");
  if (q) return q.replace(/\/+$/, "");
  const built = import.meta.env?.VITE_HOTD2_SIGNAL as string | undefined;
  if (built) return built.replace(/\/+$/, "");
  return new URL("net/signal", location.href).href.replace(/\/+$/, "");
}

export class SignalClient {
  onEvent: (e: SignalEvent) => void = () => {};
  /**
   * The last word on player 2's presence. A transport made after it -- the
   * host's next connection, once the last one dropped -- reads it rather
   * than waiting for an event that has already been and gone.
   */
  peer: { joined: boolean; n: number } | null = null;
  /** The stream's own state, for the lobby: it reconnects by itself. */
  onStream: (open: boolean) => void = () => {};
  private es: EventSource | null = null;
  private closed = false;

  private constructor(private readonly base: string, readonly code: string,
                      private readonly token: string,
                      readonly iceServers: IceServer[],
                      readonly role: "host" | "replica") {}

  private static async post(url: string, body?: unknown): Promise<unknown> {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? "{}" : JSON.stringify(body),
    });
    const text = await r.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* not JSON: an HTML 404 page */ }
    if (!r.ok) {
      const why = (json as { error?: string } | null)?.error;
      // A 404 with no JSON is no rendezvous at all, not a missing room: it
      // carries no status, so nobody takes it for "the room is gone".
      if (r.status === 404 && !json) throw new Error(`no rendezvous at ${url} (404)`);
      throw Object.assign(new Error(why ?? `${r.status} ${r.statusText}`),
                          { status: r.status });
    }
    return json;
  }

  /** Make a room. The code is what player 2 types, or follows a link to. */
  static async create(base: string): Promise<SignalClient> {
    const r = await SignalClient.post(`${base}/rooms`) as
      { code: string; token: string; iceServers: IceServer[] };
    return new SignalClient(base, r.code, r.token, r.iceServers, "host");
  }

  /**
   * Join a room -- or rejoin it with the token this tab had, when the last
   * connection died without its leave reaching the rendezvous. The token is
   * kept per tab (`sessionStorage`), so a reload rejoins and a new tab does
   * not take another's place.
   */
  static async join(base: string, code: string): Promise<SignalClient> {
    const c = code.trim().toUpperCase();
    const key = `hod2.net.token.${c}`;
    let kept: string | null = null;
    try { kept = sessionStorage.getItem(key); } catch { /* storage blocked */ }
    const r = await SignalClient.post(`${base}/rooms/${encodeURIComponent(c)}/join`,
                                      kept ? { token: kept } : {}) as
      { token: string; iceServers: IceServer[] };
    try { sessionStorage.setItem(key, r.token); } catch { /* storage blocked */ }
    return new SignalClient(base, c, r.token, r.iceServers, "replica");
  }

  private url(verb: string): string {
    return `${this.base}/rooms/${encodeURIComponent(this.code)}/${verb}`
      + `?token=${encodeURIComponent(this.token)}`;
  }

  /**
   * Open the event stream, if it is not open. `EventSource` reconnects on its
   * own after a drop; after a `pause` this opens it again.
   */
  listen(): void {
    if (this.es || this.closed) return;
    const es = new EventSource(this.url("events"));
    this.es = es;
    es.onopen = () => this.onStream(true);
    es.onerror = () => this.onStream(false);
    es.onmessage = (m) => {
      let e: SignalEvent;
      try {
        e = JSON.parse(m.data) as SignalEvent;
      } catch {
        return; // a malformed event is dropped, not fatal
      }
      if (e.t === "peer") this.peer = { joined: e.joined, n: e.n };
      this.onEvent(e);
    };
  }

  async send(data: unknown): Promise<void> {
    if (this.closed) return;
    await SignalClient.post(this.url("send"), { data });
  }

  /**
   * Stop listening without leaving: the connection is being made again on
   * the same room and token.
   */
  pause(): void {
    this.es?.close();
    this.es = null;
  }

  /**
   * Leave the room. Best effort: a page being closed may not finish it --
   * which is why a closing page (`keepToken`) keeps its token: if the leave
   * never arrives, the reload rejoins with it instead of finding its own
   * ghost in player 2's place.
   */
  close(opts: { keepToken?: boolean } = {}): void {
    if (this.closed) return;
    this.closed = true;
    this.es?.close();
    this.es = null;
    if (this.role === "replica" && !opts.keepToken) {
      try { sessionStorage.removeItem(`hod2.net.token.${this.code}`); } catch { /* */ }
    }
    const url = this.url("leave");
    // `sendBeacon` survives the page unloading; `fetch` is the fallback. The
    // body is a string, so `text/plain`: a beacon whose type is not one a
    // form could send needs a preflight it cannot make, and Chrome has thrown
    // on one rather than send it. The token is in the URL; the body is unread.
    let sent = false;
    try { sent = !!navigator.sendBeacon?.(url, "{}"); } catch { /* refused */ }
    if (!sent) void fetch(url, { method: "POST", body: "{}", keepalive: true }).catch(() => {});
  }
}
