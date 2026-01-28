## iMicroSeq Dashboard

POPULATE WITH TEXT :)

### Deploying to Cloudflare Workers

The app can run as a Cloudflare Worker with static assets:

1. **Prerequisites**: [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) and a Cloudflare account. Log in with `npx wrangler login`.

2. **Local dev**: `npm run cf:dev` (serves the Worker and assets locally).

3. **Deploy**: `npm run cf:deploy` (or `npx wrangler deploy`). Your dashboard will be live at `https://imicroseq-dashboard.<your-subdomain>.workers.dev` (or your custom domain).