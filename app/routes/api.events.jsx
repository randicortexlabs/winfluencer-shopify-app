import db from "../db.server";

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
    const body = await request.json();
    const {
      event_type,
      wf_id,
      pixel_id,
      session_id,
      product_id,
      product_title,
      variant_id,
      variant_title,
      price,
      quantity,
      page_url,
    } = body;

    if (!pixel_id) {
      console.error("[api.events] Missing pixel_id");
      return corsJson({ ok: true });
    }

    const store = await db.store.findUnique({
      where: { pixelId: String(pixel_id) },
    });

    if (!store) {
      console.error("[api.events] Unknown pixel_id:", pixel_id);
      return corsJson({ ok: true });
    }

    let influencerId = null;
    if (wf_id) {
      const influencer = await db.influencer.findUnique({
        where: { wfId: String(wf_id) },
      });
      if (influencer) {
        influencerId = influencer.id;
      }
    }

    await db.event.create({
      data: {
        storeId: store.id,
        influencerId,
        wfId: wf_id != null ? String(wf_id) : null,
        sessionId: session_id != null ? String(session_id) : "",
        eventType: event_type != null ? String(event_type) : "unknown",
        productId: product_id != null ? String(product_id) : null,
        productTitle: product_title != null ? String(product_title) : null,
        variantId: variant_id != null ? String(variant_id) : null,
        variantTitle: variant_title != null ? String(variant_title) : null,
        price:
          price != null && price !== ""
            ? Number.parseFloat(String(price))
            : null,
        quantity:
          quantity != null && quantity !== ""
            ? Number.parseInt(String(quantity), 10)
            : null,
        pageUrl: page_url != null ? String(page_url) : null,
      },
    });
  } catch (err) {
    console.error("[api.events] Failed to persist event:", err);
  }

  return corsJson({ ok: true });
}
