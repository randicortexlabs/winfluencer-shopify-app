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
   * Winfluencer Theme Snippet
   * 1. Captures wf_id from URL → localStorage → cart attributes
   * 2. Sends pre-checkout events: page_viewed, product_viewed, product_added_to_cart
   * (Checkout events are handled by the Custom Pixel which has checkout.attributes access)
   */
  var ENDPOINT='/apps/winfluencer/events';

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

  function sendEvent(eventType, extra){
    var payload={
      event_type:eventType,
      wf_id:getWfId(),
      page_url:location.href,
      page_title:document.title||'',
      product_id:null,
      product_title:null,
      variant_id:null,
      variant_title:null,
      price:null,
      quantity:null
    };
    if(extra){for(var k in extra){payload[k]=extra[k];}}
    fetch(ENDPOINT,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload),
      keepalive:true
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

  /* 3. Send page_viewed on every page */
  sendEvent('page_viewed');

  /* 4. Send product_viewed on product pages — extract data from Shopify's JSON-LD */
  try{
    if(location.pathname.indexOf('/products/')!==-1){
      var jsonLd=document.querySelector('script[type="application/ld+json"]');
      if(jsonLd){
        var ld=JSON.parse(jsonLd.textContent);
        if(ld['@type']==='Product'){
          var offer=(ld.offers&&ld.offers[0])||ld.offers||{};
          sendEvent('product_viewed',{
            product_id:ld.productID||ld.sku||null,
            product_title:ld.name||null,
            product_vendor:ld.brand&&ld.brand.name?ld.brand.name:null,
            variant_title:null,
            price:offer.price?Number(offer.price):null,
            currency:offer.priceCurrency||null
          });
        }
      }else{
        /* Fallback: use ShopifyAnalytics.meta if JSON-LD not available */
        var meta=window.ShopifyAnalytics&&ShopifyAnalytics.meta||{};
        var p=meta.product||{};
        if(p.id){
          sendEvent('product_viewed',{
            product_id:String(p.id),
            product_title:p.type||document.title,
            variant_id:meta.selectedVariantId?String(meta.selectedVariantId):null,
            price:p.variants&&p.variants[0]?p.variants[0].price:null
          });
        }
      }
    }
  }catch(e){}

  /* 5. Intercept add-to-cart to track product_added_to_cart */
  try{
    var origFetch=window.fetch;
    window.fetch=function(){
      var url=arguments[0];
      var opts=arguments[1];
      if(typeof url==='string'&&url.indexOf('/cart/add')!==-1){
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
        /* Re-sync cart attribute after add-to-cart */
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
