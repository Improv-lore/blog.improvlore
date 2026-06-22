// Fires the Cloudflare Pages deploy hook to rebuild the live blog on demand.
//
// The hook URL is a secret: it lives in a git-ignored .env file as
// CF_DEPLOY_HOOK and is read via Node's --env-file flag (see package.json).

const hook = process.env.CF_DEPLOY_HOOK;

if (!hook) {
  console.error(
    "Missing CF_DEPLOY_HOOK. Add it to a .env file in the project root:\n" +
      "  CF_DEPLOY_HOOK=https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/<token>"
  );
  process.exit(1);
}

const res = await fetch(hook, { method: "POST" });

if (!res.ok) {
  console.error(`Deploy hook failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}

console.log("Rebuild triggered. Cloudflare Pages is deploying the blog.");
