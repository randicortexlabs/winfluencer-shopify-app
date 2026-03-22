/* eslint-env node */
import crypto from "node:crypto";
import db from "../db.server";

const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "";

function verifyShopifyWebhook(rawBody, hmacHeader) {
  if (!SHOPIFY_API_SECRET || !hmacHeader) {
    return false;
  }
  const digest = crypto
    .createHmac("sha256", SHOPIFY_API_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(hmacHeader, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function getNoteAttribute(order, name) {
  const attrs = order?.note_attributes;
  if (!Array.isArray(attrs)) {
    return null;
  }
  const found = attrs.find(
    (attr) => attr && String(attr.name) === name,
  );
  return found?.value != null ? String(found.value) : null;
}

export async function action({ request }) {
  const rawBody = await request.text();
  const hmac = request.headers.get("X-Shopify-Hmac-Sha256") || "";

  if (!verifyShopifyWebhook(rawBody, hmac)) {
    console.error("[api.webhooks.orders] Invalid HMAC");
    return new Response("Unauthorized", { status: 401 });
  }

  let order;
  try {
    order = JSON.parse(rawBody);
  } catch (e) {
    console.error("[api.webhooks.orders] Invalid JSON:", e);
    return new Response(null, { status: 200 });
  }

  const shopDomain = request.headers.get("X-Shopify-Shop-Domain") || "";

  try {
    const wfId = getNoteAttribute(order, "wf_influencer_id");

    const store = await db.store.findUnique({
      where: { shop: shopDomain },
    });

    if (!store) {
      console.error(
        "[api.webhooks.orders] No Store for shop:",
        shopDomain,
      );
      return new Response(null, { status: 200 });
    }

    let influencerId = null;
    if (wfId) {
      const influencer = await db.influencer.findUnique({
        where: { wfId },
      });
      if (influencer) {
        influencerId = influencer.id;
      }
    }

    const shopifyOrderId = String(order.id ?? "");
    const totalPrice = Number.parseFloat(
      String(order.total_price ?? order.current_total_price ?? "0"),
    );
    const currency = String(
      order.currency ?? order.presentment_currency ?? "USD",
    );
    const lineItems = Array.isArray(order.line_items)
      ? order.line_items
      : [];

    await db.order.create({
      data: {
        storeId: store.id,
        influencerId,
        shopifyOrderId,
        wfId: wfId ?? null,
        totalPrice,
        currency,
        lineItems,
      },
    });
  } catch (err) {
    console.error("[api.webhooks.orders] Failed to save order:", err);
  }

  return new Response(null, { status: 200 });
}
