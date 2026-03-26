const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Max-Age": "86400",
};

function corsJson(body, status = 200) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return corsJson({ ok: false, error: "Method not allowed" }, 405);
}

export async function action({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return corsJson({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const { default: db } = await import("../db.server");

    const body = await request.json();
    const {
      event_type,
      wf_id,
      pixel_id,
      product_id,
      product_title,
      variant_id,
      variant_title,
      price,
      quantity,
      page_url,
    } = body;

    /**
     * Find the store — try multiple methods:
     * 1. Shop domain from Shopify app proxy query params (most reliable)
     * 2. Fallback to pixel_id lookup
     */
    const url = new URL(request.url);
    const shopFromProxy = url.searchParams.get("shop");

    let store = null;

    // Method 1: Shop from app proxy params
    if (shopFromProxy) {
      store = await db.store.findUnique({
        where: { shop: shopFromProxy },
      });
    }

    // Method 2: Fallback to pixel_id
    if (!store && pixel_id) {
      store = await db.store.findUnique({
        where: { pixelId: String(pixel_id) },
      });
    }

    if (!store) {
      console.error(
        "[api.events] Store not found. shop:",
        shopFromProxy,
        "pixel_id:",
        pixel_id
      );
      // Still return ok to avoid errors on storefront
      return corsJson({ ok: true, saved: false });
    }

    // Find influencer by wf_id if provided
    let influencerId = null;
    if (wf_id) {
      const influencer = await db.influencer.findUnique({
        where: { wfId: String(wf_id) },
      });
      if (influencer) {
        influencerId = influencer.id;
      }
    }

    // Save event to database
    await db.event.create({
      data: {
        storeId: store.id,
        influencerId,
        wfId: wf_id ? String(wf_id) : null,
        sessionId: "",
        eventType: event_type ? String(event_type) : "unknown",
        productId: product_id ? String(product_id) : null,
        productTitle: product_title ? String(product_title) : null,
        variantId: variant_id ? String(variant_id) : null,
        variantTitle: variant_title ? String(variant_title) : null,
        price:
          price != null && price !== ""
            ? Number.parseFloat(String(price))
            : null,
        quantity:
          quantity != null && quantity !== ""
            ? Number.parseInt(String(quantity), 10)
            : null,
        pageUrl: page_url ? String(page_url) : null,
      },
    });

    return corsJson({ ok: true, saved: true });
  } catch (err) {
    console.error("[api.events] Failed to persist event:", err);
    return corsJson({ ok: true, saved: false });
  }
}
