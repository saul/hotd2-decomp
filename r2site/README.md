# The player as a site, on Cloudflare R2

`worker.ts` serves an R2 bucket over HTTPS under a secret path;
`web/tools/deploy.ts` (`npm run deploy`) fills the bucket with the built page,
the bundle and the sounds. HTTPS makes it a secure context on any phone, so the
Home Screen's full screen and the service worker's offline copy work there
with nothing installed.

| File | What |
|---|---|
| `worker.ts`, `wrangler.toml` | the Worker: `/<SITE_KEY>/...` from the bucket, 404 for anything else |
| `.deploy.env` | the deploy's settings and secrets -- **gitignored, never committed** |

## Deploying

From `web/`:

```sh
npm run deploy                 # stage the site (tools/site.ts --gzip), upload what changed
npm run deploy -- --dry-run    # stage, and say what would go
npm run deploy -- --no-stage   # upload what extract/site/ already holds
npm run deploy -- --worker     # deploy the Worker too (the first run does it anyway)
```

**Every rebundle deploys**: `npm run export` runs the deploy when it has
written the default bundle directory and `.deploy.env` exists
(`--no-deploy` skips it). An export into `--out` somewhere else is a scratch
copy and is not deployed; run `npm run deploy` after moving it into place.

The upload is incremental: an object whose ETag is the staged file's MD5 is
left alone, so a rebundle that changed one stage uploads one stage.
`index.html` goes last, so a new page never names an asset still uploading,
and objects the site no longer has are deleted after. The first deploy is
the whole site, about 640 MB (the bundle gzipped, 260 MB of it; the sounds
380 MB).

## `.deploy.env`

```sh
CLOUDFLARE_ACCOUNT_ID=<the account>
R2_BUCKET=hotd2              # must match wrangler.toml's bucket_name
SITE_KEY=<16+ of [A-Za-z0-9_-]>   # the path the site is served under
CLOUDFLARE_API_TOKEN=<token>      # Workers Scripts: Edit, Workers R2 Storage: Edit
```

The token doubles as the S3 credentials R2's upload API wants: its id is the
access key and the SHA-256 of its value the secret (`web/tools/lib/r2.ts`).
`R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` override that, for an R2 API
token of its own. The deploy sets `SITE_KEY` as the Worker's secret.

The site is then at `https://hotd2-site.<subdomain>.workers.dev/<SITE_KEY>/`;
the deploy prints it.

## What is public

The Worker serves nothing outside the secret path. The **bucket** is another
matter: with its `r2.dev` address on, or a custom domain, every object in it
is served there to anyone with that address -- the bundle and the sounds,
which are derived from a copyrighted install. The deploy says so when it
finds either, and goes on: whether that is acceptable is the bucket owner's
call, and for this one it has been made. To close it: the dashboard, R2, the
bucket, Settings, Public access.
