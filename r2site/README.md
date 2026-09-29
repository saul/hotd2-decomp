# The player as a site, on Cloudflare R2

`worker.ts` serves an R2 bucket over HTTPS, at the root of its address;
`web/tools/deploy.ts` (`npm run deploy`) fills the bucket with the built page,
the bundle and the sounds. HTTPS makes it a secure context on any phone, so the
Home Screen's full screen and the service worker's offline copy work there
with nothing installed.

| File | What |
|---|---|
| `worker.ts`, `wrangler.toml` | the Worker: the bucket's files at `/`, `index.html` for `/`, 404 for anything else |
| `.deploy.env` | the deploy's settings and secrets -- **gitignored, never committed** |

## Deploying

From `web/`:

```sh
npm run deploy                 # stage the site (tools/site.ts --gzip), upload what changed
npm run deploy -- --dry-run    # stage, and say what would go
npm run deploy -- --no-stage   # upload what extract/site/ already holds
npm run deploy -- --worker     # deploy the Worker even if it has not changed
```

**Every rebundle deploys**: `npm run export` runs the deploy when it has
written the default bundle directory and `.deploy.env` exists
(`--no-deploy` skips it). An export into `--out` somewhere else is a scratch
copy and is not deployed; run `npm run deploy` after moving it into place.

The upload is incremental: an object whose ETag is the staged file's MD5 is
left alone, so a rebundle that changed one stage uploads one stage.
`index.html` goes last, so a new page never names an asset still uploading,
and objects the site no longer has are deleted after. The first deploy is
the whole site, about 620 MB (the bundle gzipped, 260 MB of it; the sounds
360 MB, the voices gzipped).

The Worker is deployed when `worker.ts` or `wrangler.toml` is not what was
last deployed: the deploy hands it their hash as the variable `SOURCE` and
reads it back from the Worker's settings.

## `.deploy.env`

```sh
CLOUDFLARE_ACCOUNT_ID=<the account>
R2_BUCKET=hotd2                 # must match wrangler.toml's bucket_name
CLOUDFLARE_API_TOKEN=<token>    # Workers Scripts: Edit, Workers R2 Storage: Edit
```

The token doubles as the S3 credentials R2's upload API wants: its id is the
access key and the SHA-256 of its value the secret (`web/tools/lib/r2.ts`).
`R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` override that, for an R2 API
token of its own.

The site is then at `https://hotd2-site.<subdomain>.workers.dev/`; the deploy
prints it.

## What is public

All of it. The Worker serves the page, the bundle and the sounds -- derived
from a copyrighted install -- to anyone with its address, and a bucket with
its `r2.dev` address on, or a custom domain, serves them there too; the
deploy names those when it finds them. Whether that is acceptable is the
owner's call, and for this one it has been made. The site was served under a
secret path at first, and the owner had it moved to the root.
