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
  | { t: "peer"; joined: boolean }
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
      const why = (json as { error?: string } | null)?.error
        ?? `${r.status} ${r.statusText}`;
      throw new Error(r.status === 404 && !json
        ? `no rendezvous at ${url} (${r.status})` : why);
    }
    return json;
  }

  /** Make a room. The code is what player 2 types, or follows a link to. */
  static async create(base: string): Promise<SignalClient> {
    const r = await SignalClient.post(`${base}/rooms`) as
      { code: string; token: string; iceServers: IceServer[] };
    return new SignalClient(base, r.code, r.token, r.iceServers, "host");
  }

  static async join(base: string, code: string): Promise<SignalClient> {
    const c = code.trim().toUpperCase();
    const r = await SignalClient.post(`${base}/rooms/${encodeURIComponent(c)}/join`) as
      { token: string; iceServers: IceServer[] };
    return new SignalClient(base, c, r.token, r.iceServers, "replica");
  }

  private url(verb: string): string {
    return `${this.base}/rooms/${encodeURIComponent(this.code)}/${verb}`
      + `?token=${encodeURIComponent(this.token)}`;
  }

  /** Open the event stream. `EventSource` reconnects on its own after a drop. */
  listen(): void {
    if (this.es || this.closed) return;
    const es = new EventSource(this.url("events"));
    this.es = es;
    es.onopen = () => this.onStream(true);
    es.onerror = () => this.onStream(false);
    es.onmessage = (m) => {
      try {
        this.onEvent(JSON.parse(m.data) as SignalEvent);
      } catch { /* a malformed event is dropped, not fatal */ }
    };
  }

  async send(data: unknown): Promise<void> {
    if (this.closed) return;
    await SignalClient.post(this.url("send"), { data });
  }

  /** Leave the room. Best effort: a page being closed may not finish it. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.es?.close();
    this.es = null;
    const url = this.url("leave");
    // `sendBeacon` survives the page unloading; `fetch` is the fallback.
    if (!navigator.sendBeacon?.(url, new Blob(["{}"], { type: "application/json" }))) {
      void fetch(url, { method: "POST", body: "{}", keepalive: true }).catch(() => {});
    }
  }
}
