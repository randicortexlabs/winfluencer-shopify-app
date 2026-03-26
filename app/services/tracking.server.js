const ADMIN_API = "2024-10";
const WINFLUENCER_MARKER = "<!-- winfluencer-tracking -->";

function normalizeShopDomain(shop) {
  const s = String(shop || "").trim();
  if (!s) {
    return "";
  }
  return s.includes(".") ? s : `${s}.myshopify.com`;
}

/**
 * Returns inline JavaScript for theme injection: URL wf_id capture, cart attribute,
 * session id, and pageview to the app proxy events path.
 */
export function buildTrackingSnippet(pixelId) {
  return `(function(){
  /**
   * Winfluencer Theme Snippet — ONLY captures wf_id and writes to cart attributes.
   * All event tracking is handled by the Custom Pixel via Shopify Customer Events API.
   */

  function getWfId(){
    try{ return localStorage.getItem('wf_id')||''; }catch(e){ return ''; }
  }

  function writeCartAttribute(wfId){
    fetch('/cart/update.js',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({attributes:{'wf_influencer_id':wfId}})
    }).catch(function(){});
  }

  /* 1. Capture wf_id from URL param and persist to localStorage */
  try{
    var params=new URLSearchParams(window.location.search);
    var wfFromUrl=params.get('wf_id');
    if(wfFromUrl){
      try{ localStorage.setItem('wf_id',wfFromUrl); }catch(e){}
      writeCartAttribute(wfFromUrl);
    }
  }catch(e){}

  /* 2. Keep cart attribute in sync on every page load */
  var storedWf=getWfId();
  if(storedWf){
    writeCartAttribute(storedWf);
  }

  /* 3. Re-sync cart attribute after any add-to-cart (ensures wf_id survives cart changes) */
  try{
    var origFetch=window.fetch;
    window.fetch=function(){
      var url=arguments[0];
      if(typeof url==='string'&&url.indexOf('/cart/add')!==-1){
        var wf=getWfId();
        if(wf){
          setTimeout(function(){ writeCartAttribute(wf); },500);
        }
      }
      return origFetch.apply(this,arguments);
    };
  }catch(e){}
})();`;
}

/**
 * Injects the Winfluencer tracking script into layout/theme.liquid before </body>.
 * Fails quietly (returns false) on any error.
 */
export async function injectSnippetIntoTheme(shop, accessToken, pixelId) {
  const domain = normalizeShopDomain(shop);
  if (!domain || !accessToken) {
    return false;
  }

  const base = `https://${domain}/admin/api/${ADMIN_API}`;
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": accessToken,
  };

  try {
    const themesRes = await fetch(`${base}/themes.json`, { headers });
    if (!themesRes.ok) {
      return false;
    }
    const themesJson = await themesRes.json();
    const themes = themesJson.themes || [];
    const main = themes.find((t) => t.role === "main");
    if (!main?.id) {
      return false;
    }

    const assetKey = "layout/theme.liquid";
    const assetUrl = `${base}/themes/${main.id}/assets.json?${new URLSearchParams({ "asset[key]": assetKey })}`;
    const assetRes = await fetch(assetUrl, { headers });
    if (!assetRes.ok) {
      return false;
    }
    const assetJson = await assetRes.json();
    const value = assetJson.asset?.value;
    if (typeof value !== "string") {
      return false;
    }

    if (value.includes(WINFLUENCER_MARKER)) {
      return true;
    }

    const snippet = `${WINFLUENCER_MARKER}\n<script>\n${buildTrackingSnippet(pixelId)}\n</script>\n`;
    const lower = value.toLowerCase();
    const idx = lower.lastIndexOf("</body>");
    const updated =
      idx === -1 ? value + snippet : value.slice(0, idx) + snippet + value.slice(idx);

    const putRes = await fetch(`${base}/themes/${main.id}/assets.json`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        asset: {
          key: assetKey,
          value: updated,
        },
      }),
    });

    return putRes.ok;
  } catch (err) {
    console.error("[injectSnippetIntoTheme]", err);
    return false;
  }
}
