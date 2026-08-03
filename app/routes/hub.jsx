import crypto from "crypto";

function verifyProxyHmac(requestUrl, clientSecret) {
  try {
    const url = new URL(requestUrl);
    const signature = url.searchParams.get("signature");
    if (!signature) return false;

    const pairs = [];
    for (const [key, value] of url.searchParams.entries()) {
      if (key !== "signature") pairs.push(`${key}=${value}`);
    }
    pairs.sort();

    const digest = crypto
      .createHmac("sha256", clientSecret)
      .update(pairs.join("&"))
      .digest("hex");

    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

function sanitizeUrl(url) {
  if (!url) return "/";
  const str = String(url).trim();
  if (str.startsWith("/") || str.startsWith("https://") || str.startsWith("http://")) {
    return str;
  }
  return "/";
}

function esc(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export const loader = async ({ request }) => {
  const { default: db } = await import("../db.server");

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return new Response("Bad request", { status: 400 });
  }

  // Verify Shopify App Proxy HMAC in production
  if (process.env.NODE_ENV === "production") {
    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret || !verifyProxyHmac(request.url, secret)) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const store = await db.store.findFirst({
    where: { shop, deletedAt: null },
    include: { linkHub: true },
  });

  if (!store || !store.linkHub || !store.linkHub.enabled) {
    return new Response(notConfiguredHtml(shop), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const { linkHub } = store;
  const destinations = Array.isArray(linkHub.destinations) ? linkHub.destinations : [];
  const influencers = Array.isArray(linkHub.influencers) ? linkHub.influencers : [];
  const title = linkHub.title || shop.replace(".myshopify.com", "");

  // Create initial hub session with outcome abandoned — updated on tap
  const session = await db.hubSession.create({
    data: {
      storeId: store.id,
      linkHubId: linkHub.id,
      outcome: "abandoned",
    },
  });

  // Shuffle influencer order on every load to prevent position bias
  const shuffled = [...influencers].sort(() => 0.5 - Math.random());

  return new Response(buildHtml({ title, destinations, influencers: shuffled, sessionId: session.id, shop }), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
};

function buildHtml({ title, destinations, influencers, sessionId, shop }) {
  const destCards = destinations
    .map(
      (d, i) => `
    <button class="dest-card" data-url="${esc(sanitizeUrl(d.url))}" data-title="${esc(d.title)}">
      ${esc(d.title)}
    </button>`
    )
    .join("");

  const infCards = influencers
    .map(
      (inf) => `
    <button class="inf-card" data-wfid="${esc(inf.wfId)}" data-name="${esc(inf.name)}">
      <span class="inf-name">${esc(inf.name)}</span>
      <span class="inf-handle">${esc(inf.handle || "")}</span>
    </button>`
    )
    .join("");

  const dataJson = JSON.stringify({ sessionId, shop });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="theme-color" content="#ffffff">
<title>${esc(title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#fff;min-height:100vh;color:#111}
.screen{display:flex;flex-direction:column;align-items:center;padding:48px 20px 32px;min-height:100vh}
.screen.hidden{display:none}
.store-title{font-size:20px;font-weight:600;color:#111;margin-bottom:6px;text-align:center;letter-spacing:-0.3px}
.subheading{font-size:15px;color:#777;margin-bottom:32px;text-align:center}
.dest-grid{display:flex;flex-direction:column;gap:10px;width:100%;max-width:360px}
.dest-card{background:#f4f4f4;border:none;border-radius:14px;padding:18px 20px;font-size:16px;font-weight:500;color:#111;cursor:pointer;text-align:left;width:100%}
.dest-card:active{background:#e8e8e8}
.back-btn{align-self:flex-start;background:none;border:none;color:#888;font-size:14px;cursor:pointer;margin-bottom:28px;padding:0}
.inf-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%;max-width:360px;margin-bottom:14px}
.inf-card{background:#f4f4f4;border:none;border-radius:14px;padding:18px 12px;cursor:pointer;text-align:center;display:flex;flex-direction:column;gap:3px}
.inf-card:active{background:#e8e8e8}
.inf-name{font-size:14px;font-weight:600;color:#111}
.inf-handle{font-size:12px;color:#888}
.skip-btn{background:none;border:1px solid #e0e0e0;border-radius:12px;padding:14px 20px;font-size:14px;color:#666;cursor:pointer;width:100%;max-width:360px;margin-bottom:8px}
.skip-btn:active{background:#f4f4f4}
</style>
</head>
<body>

<div id="s1" class="screen">
  <p class="store-title">${esc(title)}</p>
  <p class="subheading">Where would you like to go?</p>
  <div class="dest-grid">${destCards}</div>
</div>

<div id="s2" class="screen hidden">
  <button class="back-btn" id="back-btn">&#8592; Back</button>
  <p class="store-title">Who brought you here?</p>
  <p class="subheading">Tap who inspired your visit</p>
  <div class="inf-grid">${infCards}</div>
  <button class="skip-btn" id="nobody-btn">I found you myself</button>
  <button class="skip-btn" id="someone-btn">Someone else</button>
</div>

<script>
(function(){
  var D = ${dataJson};
  var _dest = '';
  var API = 'https://app.winfluencer.online/api/hub-session';

  // Screen 1 — destination tap
  document.querySelectorAll('.dest-card').forEach(function(btn){
    btn.addEventListener('click', function(){
      _dest = this.dataset.url;
      document.getElementById('s1').classList.add('hidden');
      document.getElementById('s2').classList.remove('hidden');
    });
  });

  // Back button
  document.getElementById('back-btn').addEventListener('click', function(){
    document.getElementById('s2').classList.add('hidden');
    document.getElementById('s1').classList.remove('hidden');
  });

  // Screen 2 — influencer tap
  document.querySelectorAll('.inf-card').forEach(function(btn){
    btn.addEventListener('click', function(){
      var wfId = this.dataset.wfid;
      logSession(wfId, 'tapped');
      writeCartAttr(wfId, function(){
        go(_dest + '?wf_id=' + encodeURIComponent(wfId) + '&wf_src=declared');
      });
    });
  });

  // Escape taps
  document.getElementById('nobody-btn').addEventListener('click', function(){
    logSession('', 'escaped');
    go(_dest + '?wf_src=none');
  });
  document.getElementById('someone-btn').addEventListener('click', function(){
    logSession('', 'escaped');
    go(_dest + '?wf_src=none');
  });

  function logSession(wfId, outcome) {
    try {
      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: D.sessionId, wfId: wfId || null, outcome: outcome }),
        keepalive: true
      });
    } catch(e){}
  }

  function writeCartAttr(wfId, cb) {
    fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attributes: { wf_influencer_id: wfId, wf_src: 'declared' } })
    }).then(cb).catch(cb);
  }

  function go(path) {
    var base = path.startsWith('/') ? 'https://' + D.shop : '';
    window.location.href = base + path;
  }
})();
</script>
</body>
</html>`;
}

function notConfiguredHtml(shop) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Creator Hub</title><style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fff}p{color:#888;font-size:16px;text-align:center;padding:24px;line-height:1.6}</style></head><body><p>This store hasn't set up their creator hub yet.</p></body></html>`;
}
