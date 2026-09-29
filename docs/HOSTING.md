# Putting the player on a phone

## From the dev server, over HTTPS, and offline

The quickest way is the dev server itself. Over plain `http://` a phone gets
no secure context, and so none of what makes the page an app: no service
worker, no offline copy. So the dev server can run over HTTPS with a
certificate authority of this machine's own:

```sh
cd web
npm run https-cert     # once, and again when this machine's address changes
npm run dev-https      # https://<this machine>:5443
```

`https-cert` makes the CA once and a server certificate for every address the
machine has, into `extract/https/` (gitignored), and prints what a phone
needs: open `http://<this machine>:5174/__ca.crt` in Safari, install the
profile, and turn on full trust for "HOTD2 dev CA" in Settings, General,
About, Certificate Trust Settings. Then open the HTTPS address and add it to
the Home Screen, which is the full screen on an iPhone or an iPad
(`app/device.ts`, `appleTouch`).

**Or Tailscale**, which needs no certificate installed anywhere: its HTTPS
certificates are real ones, for `<machine>.<tailnet>.ts.net`, and it reaches
the Mac from wherever the phone is. With MagicDNS and HTTPS certificates
turned on for the tailnet (the admin console's DNS page), and the phone in
the tailnet:

```sh
tailscale serve --bg 5174        # https://<machine>.<tailnet>.ts.net -> the dev server
tailscale serve status
tailscale serve --https=443 off  # and to stop
```

`serve`, never `funnel`: the page serves the game's data, and `serve` keeps
it inside the tailnet. The dev server takes any `.ts.net` host
(`allowedHosts` in `vite.config.ts`); Vite refuses a host it does not know
with a 403.

Over HTTPS the page registers a **service worker** (`web/public/sw.js`) that
keeps the page and every stage played on the device. **While the server can
be reached, nothing kept is ever shown without asking it first:** each load's
own page request goes to the server, and if it answers within four seconds
every request of that load is checked against the kept copy -- a 304 uses
it, anything else is downloaded, handed to the page as it arrives, and kept
in its place. A re-exported stage is therefore the new one on the next
reload. Only a load whose page request the server did not answer -- the
phone away from the LAN, the Mac asleep -- plays from the device, and it
does so whole, never mixing kept files with new ones. `?sw=0` removes the
worker and everything it kept. `npm run offline-check` holds it to both
promises in Chrome.

A phone cannot build a bundle -- no mobile browser can open a folder -- so it
has to be served one, with the sounds beside it. `npm run site` stages
exactly that as a plain static site, and can upload it to S3.

**What it stages is the game's data.** The bundle and the sounds are derived
from a copyrighted install. Everything below keeps them **private to you**:
never make the bucket public, never turn on S3 static website hosting, and do
not share the URL. The staged directory defaults to `extract/site/`, which
`.gitignore` already keeps out of the repository.

## What gets published

```sh
cd web
npm run site -- --gzip --check
```

| Path | What | Size |
|---|---|---|
| `index.html`, `assets/` | `vite build`, with `base: "./"` so it works under any path | 2 MB |
| `bundle/` | the export, gzipped (`--gzip`) | about 240 MB (580 MB plain) |
| `bgm/`, `se/`, `voice/` | the install's `sound/`, **lowercased** | about 390 MB |

A stage costs a phone about 20-35 MB of bundle the first time it is opened
(stage 2 is the largest), plus the music and sounds as they play. The
browser's cache keeps them after that.

Three things had to be true for a static host to work, and are now:

* **Every URL the page makes is relative** to the page: `bundle/…`, `bgm/…`,
  and the build's own `assets/…` (`vite.config.ts`'s `base`). The same build
  works at a bucket's root or under a prefix.
* **Sound names are lowercase on both sides.** The exe's tables spell a name
  one way (`COMMON\GUN5_22.WAV`) and the install another; the dev server
  resolves the difference, and an S3 key cannot. `audio/bgm.ts`'s `soundUrl`
  asks for every file in lowercase, and `site.ts` stages every file that way.
  It refuses an install with two files that differ in case alone.
* **The bundle is refused before it is uploaded** if the page would refuse it,
  or if a stage was written by an older exporter (`--allow-stale` overrides
  the second).

`--gzip` stores each bundle file compressed **under its own name**, for a host
told to send `Content-Encoding: gzip` with it -- which `--sync` does. It is off
by default because a plain file server would hand the page the compressed
bytes as they are; leave it off for anything but S3.

`--check` (or `npm run site:check`) serves the staged directory the way S3
will -- every path segment compared exactly, nothing but the files, gzip
headers if the bundle was gzipped -- and plays stage 1 in Chrome. It fails if
the served bundle is not the one that loads, or if anything the page asks for
is missing, except the `_OFF` stop sounds the game never shipped.

## Recommended: a private S3 bucket behind CloudFront

CloudFront is what makes this private *and* HTTPS. HTTPS is not optional on a
phone: the flick-to-reload needs the motion sensors, and a browser only hands
those to a secure page.

**One-time setup** (in the AWS console, or the equivalent CLI):

1. **A bucket**, with *Block all public access* left **on** (the default).
   Any region.
2. **A CloudFront distribution** whose origin is that bucket's REST endpoint
   (`<bucket>.s3.<region>.amazonaws.com`, *not* the website endpoint), with:
   * *Origin access*: **Origin access control (OAC)** -- create one, and let
     the console update the bucket policy, or paste the policy below.
   * *Viewer protocol policy*: **Redirect HTTP to HTTPS**.
   * *Cache policy*: **CachingOptimized**. *Compress objects*: yes (for the
     page itself; the bundle arrives compressed already).
   * No default root object, no alternate domain name needed.
3. **A secret for the path**: `openssl rand -hex 16`.

The bucket policy OAC needs, with your bucket, account and distribution:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowCloudFrontRead",
    "Effect": "Allow",
    "Principal": { "Service": "cloudfront.amazonaws.com" },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::BUCKET/*",
    "Condition": { "StringEquals": {
      "AWS:SourceArn": "arn:aws:cloudfront::ACCOUNT:distribution/DISTRIBUTION"
    } }
  }]
}
```

**Publish** (needs the AWS CLI, signed in):

```sh
cd web
npm run site -- --gzip --check --sync s3://BUCKET/SECRET
```

It runs one `aws s3 sync` per kind of file, because they want different
headers: the bundle and `index.html` are `no-cache` (revalidated on every
load, so a re-export shows up on the next one), the hashed `assets/` are
immutable, the sounds are cached for a week. `index.html` goes last, so a new
one never names an asset still uploading. Add `--dryrun` to see what would
move. Staging is incremental and keeps each file's source mtime, so after a
re-export only what changed is uploaded.

**Open it on the phone** at `https://<id>.cloudfront.net/SECRET/index.html`,
then *Add to Home Screen*. On an iPhone that is how you get the whole screen:
iOS has no element fullscreen on a phone, and `index.html` asks to run as a
home-screen app. On Android, Start goes fullscreen and locks landscape itself.

**Why a secret path and not a password.** The bucket grants CloudFront
`GetObject` and nothing else, so there is no listing: a request under any
other prefix is refused, and the page makes no request to any other site
that could leak its URL in a `Referer`. The path is the key -- treat the URL
like a password. A password prompt is possible too (a CloudFront Function on
*viewer request*, below), but whether an iOS home-screen app keeps Basic auth
credentials between launches is **[open]**: try it in Safari before relying on
it from the home screen.

```js
// CloudFront Function, viewer request. EXPECTED is base64("user:password").
function handler(event) {
  var h = event.request.headers.authorization;
  if (h && h.value === "Basic EXPECTED") return event.request;
  return { statusCode: 401, statusDescription: "Unauthorized",
           headers: { "www-authenticate": { value: 'Basic realm="hotd2"' } } };
}
```

**What it costs** (list prices when this was written; check them): about
0.63 GB in S3 Standard is a couple of cents a month, and CloudFront's
always-free tier covers 1 TB of transfer and 10 million requests a month,
which personal play will not approach.

**Taking it down**: `aws s3 rm s3://BUCKET/SECRET --recursive`, then disable
and delete the distribution.

## Without a cloud: serve it from your own machine

* **On the same Wi-Fi**, `npm run dev -- --host` and open the printed network
  address. Everything works except the flick, which needs HTTPS; the
  second-finger tap still reloads.
* **Anywhere, privately**, with Tailscale on both devices: stage *without*
  `--gzip` (`npm run site`) and serve `extract/site/` with `tailscale serve`,
  which gives the machine an HTTPS name only your devices can reach (recent
  versions take a directory as the target -- see `tailscale serve --help`).
  The machine has to be awake to play.
