// One-time Facebook + Instagram setup. Takes the short-lived user token you copy from Meta's Graph API Explorer
// (META_USER_TOKEN in video/.daily.env), exchanges it for a long-lived one, and saves the Page token (which does not
// expire) plus the Page and Instagram account IDs: FB_PAGE_ID, FB_PAGE_TOKEN, IG_USER_ID, IG_ACCESS_TOKEN.
// Needs META_APP_ID, META_APP_SECRET, META_USER_TOKEN; with several Pages, also FB_PAGE_ID. Prints no tokens.
import { env, missing, request, saveEnv } from "./lib.mjs";

const V = env("META_GRAPH_VERSION", "v27.0");
const gaps = missing(["META_APP_ID", "META_APP_SECRET", "META_USER_TOKEN"]);
if (gaps.length) {
  console.error(`✗ Add ${gaps.join(", ")} to video/.daily.env first (see video/README.md, "Posting automatically").`);
  process.exit(1);
}
try {
  // Meta's token exchange takes its parameters in the query; this request is never logged.
  const { body: long } = await request(`https://graph.facebook.com/${V}/oauth/access_token?${new URLSearchParams({
    grant_type: "fb_exchange_token", client_id: env("META_APP_ID"), client_secret: env("META_APP_SECRET"), fb_exchange_token: env("META_USER_TOKEN"),
  })}`, {}, { label: "Meta token exchange" });
  const { body: pages } = await request(`https://graph.facebook.com/${V}/me/accounts?${new URLSearchParams({ fields: "id,name,access_token,instagram_business_account{id,username}" })}`,
    { headers: { Authorization: `OAuth ${long.access_token}` } }, { label: "Facebook Pages" });
  const list = pages.data ?? [];
  const wanted = env("FB_PAGE_ID");
  const page = wanted ? list.find((p) => p.id === wanted) : list.length === 1 ? list[0] : null;
  if (!page) {
    console.error(list.length ? `✗ Several Pages found; set FB_PAGE_ID to one of:\n${list.map((p) => `   ${p.id}  ${p.name}`).join("\n")}` : "✗ This account manages no Facebook Page, or the token lacks pages_show_list.");
    process.exit(1);
  }
  saveEnv("FB_PAGE_ID", page.id);
  saveEnv("FB_PAGE_TOKEN", page.access_token);
  console.log(`✓ Facebook Page: ${page.name}`);
  const ig = page.instagram_business_account;
  if (ig?.id) {
    saveEnv("IG_USER_ID", ig.id);
    saveEnv("IG_ACCESS_TOKEN", page.access_token);
    console.log(`✓ Instagram: @${ig.username}`);
  } else {
    console.log("! No Instagram professional account is linked to this Page; link it in Instagram (Settings → Account type and tools / Accounts Center), then run this again.");
  }
  saveEnv("META_USER_TOKEN", "");
  console.log("Saved in video/.daily.env. Check it: npm --workspace video run publish:check");
} catch (error) {
  console.error(`✗ ${error.message}`);
  process.exit(1);
}
