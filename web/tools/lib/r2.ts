/**
 * A Cloudflare R2 bucket through its S3-compatible API: list, put, delete,
 * and nothing else -- what `tools/deploy.ts` needs to keep a bucket in step
 * with a staged site.
 *
 * Its own AWS Signature Version 4 rather than the AWS CLI or an SDK: the CLI
 * is a Python install that breaks with the Python under it (it did, on the
 * machine this was written on), and an SDK is megabytes for four requests.
 * Path-style URLs (`https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`)
 * in region `auto`, as R2 asks; bodies are sent unsigned
 * (`UNSIGNED-PAYLOAD`), which R2 accepts over TLS.
 *
 * **Credentials from an API token**: R2 takes a Cloudflare API token that has
 * R2 permissions as S3 credentials, the token's id as the access key and the
 * SHA-256 of its value as the secret (`r2CredentialsFromToken`).
 */
import { createHash, createHmac } from "node:crypto";

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface R2Object {
  key: string;
  size: number;
  /** The quoted ETag stripped: a single-part object's MD5, in hex. */
  etag: string;
}

/** What a put sets besides the body. */
export interface R2Put {
  contentType?: string;
  cacheControl?: string;
  contentEncoding?: string;
  /** `x-amz-meta-*`: R2's custom metadata. */
  meta?: Record<string, string>;
}

const hex = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const hmac = (k: Buffer | string, s: string) => createHmac("sha256", k).update(s).digest();

/** S3's encoding of a key: every byte but the unreserved ones, `/` kept. */
function encodeKey(key: string): string {
  return key.split("/").map((p) => encodeURIComponent(p)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
}

export class R2 {
  private readonly host: string;

  constructor(private readonly cfg: R2Config) {
    this.host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  }

  private async request(method: string, key: string, query: Record<string, string>,
                        headers: Record<string, string>, body?: Buffer): Promise<Response> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const day = amzDate.slice(0, 8);
    const path = `/${this.cfg.bucket}${key ? `/${encodeKey(key)}` : ""}`;
    const qs = Object.keys(query).sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join("&");
    const payload = body ? "UNSIGNED-PAYLOAD" : hex("");
    const all: Record<string, string> = {
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()])),
      host: this.host, "x-amz-date": amzDate, "x-amz-content-sha256": payload,
    };
    const names = Object.keys(all).sort();
    const canonical = [method, path, qs, names.map((n) => `${n}:${all[n]}\n`).join(""),
                       names.join(";"), payload].join("\n");
    const scope = `${day}/auto/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, hex(canonical)].join("\n");
    let k = hmac(`AWS4${this.cfg.secretAccessKey}`, day);
    for (const part of ["auto", "s3", "aws4_request"]) k = hmac(k, part);
    const signature = createHmac("sha256", k).update(toSign).digest("hex");
    const auth = `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, `
      + `SignedHeaders=${names.join(";")}, Signature=${signature}`;
    const { host: _host, ...sent } = all;
    const res = await fetch(`https://${this.host}${path}${qs ? `?${qs}` : ""}`, {
      // A Buffer is bytes as far as `fetch` is concerned; its typings disagree.
      method, headers: { ...sent, authorization: auth }, body: body as unknown as BodyInit | undefined,
    });
    if (!res.ok && !(method === "DELETE" && res.status === 404)) {
      throw new Error(`R2 ${method} ${key || "(bucket)"}: ${res.status} ${(await res.text()).slice(0, 300)}`);
    }
    return res;
  }

  /** Every object under `prefix`. */
  async list(prefix = ""): Promise<R2Object[]> {
    const out: R2Object[] = [];
    let token: string | undefined;
    do {
      const q: Record<string, string> = { "list-type": "2", "max-keys": "1000" };
      if (prefix) q.prefix = prefix;
      if (token) q["continuation-token"] = token;
      const xml = await (await this.request("GET", "", q, {})).text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const tag = (t: string) => new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(m[1])?.[1] ?? "";
        out.push({ key: decodeXml(tag("Key")), size: Number(tag("Size")),
                   etag: decodeXml(tag("ETag")).replace(/"/g, "") });
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
        ? decodeXml(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "")
        : undefined;
    } while (token);
    return out;
  }

  async put(key: string, body: Buffer, p: R2Put = {}): Promise<void> {
    const h: Record<string, string> = { "content-length": String(body.length) };
    if (p.contentType) h["content-type"] = p.contentType;
    if (p.cacheControl) h["cache-control"] = p.cacheControl;
    if (p.contentEncoding) h["content-encoding"] = p.contentEncoding;
    for (const [k, v] of Object.entries(p.meta ?? {})) h[`x-amz-meta-${k}`] = v;
    await this.request("PUT", key, {}, h, body);
  }

  async delete(key: string): Promise<void> {
    await this.request("DELETE", key, {}, {});
  }
}

function decodeXml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/**
 * S3 credentials from a Cloudflare API token with R2 permissions: the
 * token's id, which the API tells its bearer, and the SHA-256 of its value.
 */
export async function r2CredentialsFromToken(token: string):
    Promise<{ accessKeyId: string; secretAccessKey: string }> {
  const r = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify",
                        { headers: { authorization: `Bearer ${token}` } });
  const j = await r.json() as { success: boolean; result?: { id: string; status: string } };
  if (!j.success || !j.result || j.result.status !== "active") {
    throw new Error("the Cloudflare API token is not active (expired, or revoked)");
  }
  return { accessKeyId: j.result.id, secretAccessKey: hex(token) };
}
