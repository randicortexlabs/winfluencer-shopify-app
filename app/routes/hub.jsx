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

// Deterministic pastel color from a string — 6 warm/cool hues
function avatarColor(name) {
  const palette = ["#F4C28A", "#A8C8F0", "#C4A8F0", "#A8F0D0", "#F0A8C8", "#A8E8A8"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return palette[h % palette.length];
}

export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const { default: db } = await import("../db.server");

  const { session: proxySession } = await authenticate.public.appProxy(request);
  const shop = proxySession?.shop ?? new URL(request.url).searchParams.get("shop");

  if (!shop) {
    return new Response("Bad request", { status: 400 });
  }

  const store = await db.store.findFirst({
    where: { shop, deletedAt: null },
    include: { linkHub: true },
  });

  if (!store || !store.linkHub || !store.linkHub.enabled) {
    return new Response(notConfiguredHtml(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const { linkHub } = store;
  const destinations = Array.isArray(linkHub.destinations) ? linkHub.destinations : [];
  const influencers = Array.isArray(linkHub.influencers) ? linkHub.influencers : [];
  const title = linkHub.title || shop.replace(".myshopify.com", "");
  const screen2Title = linkHub.screen2Title || "Shout out your creator!";
  const screen2Subtitle = linkHub.screen2Subtitle || "Who introduced you to us? Give them credit — it helps them out!";

  // Fetch store logo from Shopify using the stored offline access token
  const logoUrl = await fetchStoreLogo(shop, store.accessToken);

  const session = await db.hubSession.create({
    data: { storeId: store.id, linkHubId: linkHub.id, outcome: "abandoned" },
  });

  const shuffled = [...influencers].sort(() => 0.5 - Math.random());

  return new Response(buildHtml({ title, destinations, influencers: shuffled, sessionId: session.id, shop, logoUrl, screen2Title, screen2Subtitle }), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
};

async function fetchStoreLogo(shop, accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(`https://${shop}/admin/api/2026-04/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
      body: JSON.stringify({ query: "{ shop { brand { logo { image { url } } } } }" }),
    });
    const json = await res.json();
    return json?.data?.shop?.brand?.logo?.image?.url || null;
  } catch {
    return null;
  }
}

function buildHtml({ title, destinations, influencers, sessionId, shop, logoUrl, screen2Title, screen2Subtitle }) {
  const initial = esc(title.trim()[0]?.toUpperCase() || "S");

  const logoHtml = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${esc(title)}" class="store-logo" />`
    : `<div class="store-avatar">${initial}</div>`;

  const destCards = destinations.map((d) => `
    <button class="dest-card" data-url="${esc(sanitizeUrl(d.url))}" data-title="${esc(d.title)}">
      <span class="dest-label">${esc(d.title)}</span>
      <svg class="dest-arrow" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M7 4l6 6-6 6" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>`).join("");

  const infCards = influencers.map((inf) => {
    const color = avatarColor(inf.name || inf.wfId || "x");
    const initials = esc((inf.name || inf.wfId || "?").trim()[0]?.toUpperCase() || "?");
    return `
    <button class="inf-card" data-wfid="${esc(inf.wfId)}" data-name="${esc(inf.name)}">
      <div class="inf-avatar" style="background:${color}">${initials}</div>
      <span class="inf-name">${esc(inf.name)}</span>
      ${inf.handle ? `<span class="inf-handle">${esc(inf.handle)}</span>` : ""}
    </button>`;
  }).join("");

  const dataJson = JSON.stringify({ sessionId, shop });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="theme-color" content="#f6f5f3">
<title>${esc(title)}</title>
<style>
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    -webkit-tap-highlight-color: transparent;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    background: #f6f5f3;
    min-height: 100vh;
    color: #111;
    -webkit-font-smoothing: antialiased;
  }

  /* ── Screens ── */
  .screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 52px 20px 40px;
    min-height: 100vh;
    transition: opacity 0.18s ease, transform 0.18s ease;
  }
  .screen.hidden {
    display: none;
  }

  /* ── Store header ── */
  .store-avatar {
    width: 56px;
    height: 56px;
    border-radius: 16px;
    background: #111;
    color: #fff;
    font-size: 22px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 14px;
    letter-spacing: -0.5px;
  }

  .store-title {
    font-size: 20px;
    font-weight: 700;
    color: #111;
    letter-spacing: -0.4px;
    text-align: center;
    margin-bottom: 6px;
  }

  .store-sub {
    font-size: 14px;
    color: #888;
    text-align: center;
    margin-bottom: 36px;
    line-height: 1.4;
  }

  /* ── Destination cards ── */
  .dest-grid {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
    max-width: 380px;
  }

  .dest-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #fff;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 16px;
    padding: 18px 20px;
    font-size: 15px;
    font-weight: 500;
    color: #111;
    cursor: pointer;
    text-align: left;
    width: 100%;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    transition: background 0.12s ease, transform 0.1s ease, box-shadow 0.12s ease;
  }

  .dest-card:active {
    background: #f0ede8;
    transform: scale(0.98);
    box-shadow: none;
  }

  .dest-label {
    flex: 1;
  }

  .dest-arrow {
    width: 18px;
    height: 18px;
    color: #bbb;
    flex-shrink: 0;
    margin-left: 12px;
  }

  /* ── Screen 2 — influencer picker ── */
  .back-btn {
    align-self: flex-start;
    background: none;
    border: none;
    color: #888;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    padding: 0;
    margin-bottom: 32px;
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .back-btn svg {
    width: 16px;
    height: 16px;
  }

  .section-title {
    font-size: 20px;
    font-weight: 700;
    color: #111;
    letter-spacing: -0.4px;
    text-align: center;
    margin-bottom: 6px;
  }

  .section-sub {
    font-size: 14px;
    color: #888;
    text-align: center;
    margin-bottom: 28px;
  }

  /* ── Influencer grid ── */
  .inf-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    width: 100%;
    max-width: 380px;
    margin-bottom: 16px;
  }

  .inf-card {
    background: #fff;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 16px;
    padding: 20px 12px 18px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    transition: background 0.12s ease, transform 0.1s ease, box-shadow 0.12s ease;
  }

  .inf-card:active {
    background: #f0ede8;
    transform: scale(0.97);
    box-shadow: none;
  }

  .inf-avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 700;
    color: #111;
    letter-spacing: -0.3px;
  }

  .inf-name {
    font-size: 13px;
    font-weight: 600;
    color: #111;
    text-align: center;
    line-height: 1.3;
    word-break: break-word;
  }

  .inf-handle {
    font-size: 11px;
    color: #999;
    text-align: center;
  }

  /* ── Skip buttons ── */
  .skip-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    max-width: 380px;
  }

  .skip-btn {
    background: none;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 14px;
    padding: 15px 20px;
    font-size: 14px;
    color: #666;
    cursor: pointer;
    width: 100%;
    font-weight: 500;
    transition: background 0.1s ease;
  }

  .skip-btn:active {
    background: #ece9e4;
  }

  /* ── Footer ── */
  .store-logo {
    max-width: 140px;
    max-height: 52px;
    object-fit: contain;
    margin-bottom: 16px;
  }

  .hub-footer {
    margin-top: auto;
    padding-top: 32px;
    font-size: 11px;
    color: #bbb;
    letter-spacing: 0.2px;
  }

  /* ── Redirecting overlay ── */
  .going {
    position: fixed;
    inset: 0;
    background: rgba(246, 245, 243, 0.92);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    z-index: 100;
    opacity: 0;
    transition: opacity 0.2s ease;
    pointer-events: none;
  }

  .going.visible {
    opacity: 1;
    pointer-events: all;
  }

  .spinner {
    width: 30px;
    height: 30px;
    border: 2.5px solid #ddd;
    border-top-color: #111;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  .going-text {
    font-size: 14px;
    color: #888;
    font-weight: 500;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
</head>
<body>

<!-- Redirecting overlay -->
<div id="going" class="going">
  <div class="spinner"></div>
  <p class="going-text">Taking you there…</p>
</div>

<!-- Screen 1: Destination picker -->
<div id="s1" class="screen">
  ${logoHtml}
  <h1 class="store-title">${esc(title)}</h1>
  <p class="store-sub">Where would you like to go?</p>
  <div class="dest-grid">${destCards}</div>
  <p class="hub-footer">Built with Winfluencer</p>
</div>

<!-- Screen 2: Influencer picker -->
<div id="s2" class="screen hidden">
  <button class="back-btn" id="back-btn">
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M13 16l-6-6 6-6" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    Back
  </button>
  <h2 class="section-title">${esc(screen2Title)}</h2>
  <p class="section-sub">${esc(screen2Subtitle)}</p>
  <div class="inf-grid">${infCards}</div>
  <div class="skip-grid">
    <button class="skip-btn" id="nobody-btn">I found you myself</button>
    <button class="skip-btn" id="someone-btn">Someone else sent me</button>
  </div>
  <p class="hub-footer">Built with Winfluencer</p>
</div>

<script>
(function () {
  var D = ${dataJson};
  var _dest = '';
  var API = 'https://app.winfluencer.online/api/hub-session';

  function showScreen(fromId, toId) {
    var from = document.getElementById(fromId);
    var to = document.getElementById(toId);
    from.style.opacity = '0';
    from.style.transform = 'translateY(-8px)';
    setTimeout(function () {
      from.classList.add('hidden');
      from.style.opacity = '';
      from.style.transform = '';
      to.classList.remove('hidden');
      to.style.opacity = '0';
      to.style.transform = 'translateY(10px)';
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          to.style.opacity = '1';
          to.style.transform = 'translateY(0)';
        });
      });
    }, 190);
  }

  function showGoing() {
    document.getElementById('going').classList.add('visible');
  }

  // Screen 1 — destination tap
  document.querySelectorAll('.dest-card').forEach(function (btn) {
    btn.addEventListener('click', function () {
      _dest = this.dataset.url;
      showScreen('s1', 's2');
    });
  });

  // Back button
  document.getElementById('back-btn').addEventListener('click', function () {
    showScreen('s2', 's1');
  });

  // Screen 2 — influencer tap
  document.querySelectorAll('.inf-card').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var wfId = this.dataset.wfid;
      logSession(wfId, 'tapped');
      showGoing();
      writeCartAttr(wfId, function () {
        go(_dest + '?wf_id=' + encodeURIComponent(wfId) + '&wf_src=declared');
      });
    });
  });

  // Escape taps
  document.getElementById('nobody-btn').addEventListener('click', function () {
    logSession('', 'escaped');
    showGoing();
    go(_dest + '?wf_src=none');
  });
  document.getElementById('someone-btn').addEventListener('click', function () {
    logSession('', 'escaped');
    showGoing();
    go(_dest + '?wf_src=none');
  });

  function logSession(wfId, outcome) {
    try {
      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: D.sessionId, wfId: wfId || null, outcome: outcome }),
        keepalive: true,
      });
    } catch (e) {}
  }

  function writeCartAttr(wfId, cb) {
    fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attributes: { wf_influencer_id: wfId, wf_src: 'declared' } }),
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

function notConfiguredHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f6f5f3">
<title>Creator Hub</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #f6f5f3;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    margin: 0;
    -webkit-font-smoothing: antialiased;
  }
  .wrap {
    text-align: center;
    padding: 32px 24px;
  }
  .icon {
    width: 52px;
    height: 52px;
    border-radius: 14px;
    background: #e8e5e0;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 20px;
  }
  p {
    color: #888;
    font-size: 15px;
    line-height: 1.6;
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="icon">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" stroke="#aaa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <p>This store hasn't set up their creator hub yet.</p>
  </div>
</body>
</html>`;
}
