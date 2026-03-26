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
  const pid = JSON.stringify(String(pixelId));
  return `(function(){
  var ENDPOINT='/apps/winfluencer/api/events';
  var PIXEL_ID=${pid};

  function getSessionId(){
    try{
      var k='wf_session_id';
      var id=sessionStorage.getItem(k);
      if(!id){
        id='wf_'+Math.random().toString(36).slice(2)+'_'+Date.now().toString(36);
        sessionStorage.setItem(k,id);
      }
      return id;
    }catch(e){ return 'wf_unknown'; }
  }

  function getWfId(){
    try{ return localStorage.getItem('wf_id')||''; }catch(e){ return ''; }
  }

  function sendEvent(eventType, extra){
    var payload={
      event_type:eventType,
      wf_id:getWfId(),
      pixel_id:PIXEL_ID,
      session_id:getSessionId(),
      product_id:null,
      product_title:null,
      variant_id:null,
      variant_title:null,
      price:null,
      quantity:null,
      page_url:typeof location!=='undefined'?location.href:null
    };
    if(extra){for(var k in extra){payload[k]=extra[k];}}
    fetch(ENDPOINT,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload),
      keepalive:true
    }).catch(function(){});
  }

  /* 1. Capture wf_id from URL and persist */
  try{
    var params=new URLSearchParams(window.location.search);
    var wfFromUrl=params.get('wf_id');
    if(wfFromUrl){
      try{ localStorage.setItem('wf_id',wfFromUrl); }catch(e){}
      fetch('/cart/update.js',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({attributes:{'wf_influencer_id':wfFromUrl}})
      }).catch(function(){});
    }
  }catch(e){}

  /* 2. Keep cart attribute in sync (even without URL param, if wf_id exists in localStorage) */
  var storedWf=getWfId();
  if(storedWf){
    fetch('/cart/update.js',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({attributes:{'wf_influencer_id':storedWf}})
    }).catch(function(){});
  }

  /* 3. Send pageview event */
  sendEvent('pageview');

  /* 4. Track product_viewed on product pages */
  try{
    if(window.location.pathname.indexOf('/products/')!==-1){
      var meta=window.meta||window.ShopifyAnalytics&&ShopifyAnalytics.meta||{};
      var product=meta.product||{};
      var selectedVariant=meta.selectedVariantId||null;
      sendEvent('product_viewed',{
        product_id:product.id?String(product.id):null,
        product_title:product.type||document.title||null,
        variant_id:selectedVariant?String(selectedVariant):null,
        price:product.variants&&product.variants[0]?product.variants[0].price:null
      });
    }
  }catch(e){}

  /* 5. Intercept add-to-cart to track product_added_to_cart */
  try{
    var origFetch=window.fetch;
    window.fetch=function(){
      var url=arguments[0];
      var opts=arguments[1];
      if(typeof url==='string'&&(url.indexOf('/cart/add')!==-1)){
        try{
          var bodyStr=opts&&opts.body?opts.body:'';
          if(typeof bodyStr==='string'&&bodyStr){
            var cartData=JSON.parse(bodyStr);
            var items=cartData.items||[cartData];
            for(var i=0;i<items.length;i++){
              sendEvent('product_added_to_cart',{
                variant_id:items[i].id?String(items[i].id):null,
                quantity:items[i].quantity||1
              });
            }
          }
        }catch(e){}
        /* Also refresh cart attribute with wf_id after add-to-cart */
        var wf=getWfId();
        if(wf){
          origFetch('/cart/update.js',{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({attributes:{'wf_influencer_id':wf}})
          }).catch(function(){});
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
