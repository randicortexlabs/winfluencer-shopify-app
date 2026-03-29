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
      shop: shopFromBody,
      product_id,
      product_title,
      product_vendor,
      variant_id,
      variant_title,
      price,
      quantity,
      page_url,
      currency,
      items,
      transaction_id,
      session_id,
      journey,  // optional: [{wfId, ts}, ...] for multi-touch tracking
    } = body;

    /**
     * Find the store — try multiple methods:
     * 1. Shop domain from Shopify app proxy query params (?shop=)
     * 2. Shop domain from request body (sent by pixel)
     * 3. Fallback to pixel_id lookup
     */
    const url = new URL(request.url);
    const shopFromProxy = url.searchParams.get("shop");
    const shopDomain = shopFromProxy || shopFromBody || "";

    let store = null;

    // Method 1+2: Shop domain (from proxy or body)
    if (shopDomain) {
      store = await db.store.findUnique({
        where: { shop: shopDomain },
      });
    }

    // Method 3: Fallback to pixel_id
    if (!store && pixel_id) {
      store = await db.store.findUnique({
        where: { pixelId: String(pixel_id) },
      });
    }

    if (!store) {
      console.error(
        "[api.events] Store not found. shopFromProxy:",
        shopFromProxy,
        "shopFromBody:",
        shopFromBody,
        "pixel_id:",
        pixel_id,
      );
      return corsJson({ ok: true, saved: false, reason: "store_not_found" });
    }

    // Find influencer by wf_id if provided
    let influencerId = null;
    if (wf_id) {
      const influencer = await db.influencer.findFirst({
        where: { wfId: String(wf_id) },
      });
      if (influencer) {
        influencerId = influencer.id;
      }
    }

    // Save main event to database
    await db.event.create({
      data: {
        storeId: store.id,
        influencerId,
        wfId: wf_id ? String(wf_id) : null,
        sessionId: session_id ? String(session_id) : "",
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
        pageUrl: page_url ? String(page_url).substring(0, 2000) : null,
      },
    });

    // For checkout events with line items, save each item as a separate event
    if (items && Array.isArray(items) && items.length > 0 &&
        (event_type === "checkout_completed" || event_type === "checkout_started")) {
      const itemEvents = items.map((item) => ({
        storeId: store.id,
        influencerId,
        wfId: wf_id ? String(wf_id) : null,
        sessionId: session_id ? String(session_id) : "",
        eventType: event_type === "checkout_completed"
          ? "item_purchased"
          : "item_checkout_started",
        productId: item.product_id ? String(item.product_id) : null,
        productTitle: item.product_title ? String(item.product_title) : null,
        variantId: item.variant_id ? String(item.variant_id) : null,
        variantTitle: item.variant_title ? String(item.variant_title) : null,
        price: item.price != null ? Number.parseFloat(String(item.price)) : null,
        quantity: item.quantity || 1,
        pageUrl: page_url ? String(page_url).substring(0, 2000) : null,
      }));

      await db.event.createMany({ data: itemEvents });
    }

    // Create/update Touchpoint records from journey array (multi-touch tracking)
    if (journey && Array.isArray(journey) && journey.length > 0 && session_id) {
      try {
        // Batch lookup all influencerIds for wfIds in the journey
        const journeyWfIds = journey.map(t => String(t.wfId || "")).filter(Boolean);
        const influencers = await db.influencer.findMany({
          where: { wfId: { in: journeyWfIds } },
          select: { id: true, wfId: true },
        });
        const wfIdToInfluencerId = {};
        for (const inf of influencers) {
          wfIdToInfluencerId[inf.wfId] = inf.id;
        }

        // Upsert each touchpoint (idempotent via @@unique([sessionId, wfId]))
        for (let i = 0; i < journey.length; i++) {
          const touch = journey[i];
          const touchWfId = String(touch.wfId || "");
          if (!touchWfId) continue;

          await db.touchpoint.upsert({
            where: {
              sessionId_wfId: {
                sessionId: String(session_id),
                wfId: touchWfId,
              },
            },
            create: {
              storeId: store.id,
              sessionId: String(session_id),
              wfId: touchWfId,
              influencerId: wfIdToInfluencerId[touchWfId] || null,
              touchIndex: i,
              timestamp: touch.ts ? new Date(touch.ts) : new Date(),
            },
            update: {
              touchIndex: i,
            },
          });
        }
      } catch (touchErr) {
        console.error("[api.events] Touchpoint creation failed:", touchErr);
      }
    }

    console.log(
      "[api.events] Saved:",
      event_type,
      "wf_id:", wf_id || "none",
      "store:", store.shop,
      "product:", product_title || "n/a",
      "journey:", journey ? journey.length + " touches" : "none",
    );

    return corsJson({ ok: true, saved: true });
  } catch (err) {
    console.error("[api.events] Failed to persist event:", err);
    return corsJson({ ok: true, saved: false, reason: "internal_error" });
  }
}
