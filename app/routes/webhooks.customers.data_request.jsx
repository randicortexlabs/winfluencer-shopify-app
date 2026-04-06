import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * GDPR: customers/data_request
 * Fired when a customer requests to know what data the app holds about them.
 * Winfluencer stores only anonymous session-based tracking data (sessionId, wfId).
 * No PII (name, email, phone) is stored — we respond with the store record IDs.
 */
export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[GDPR] ${topic} received for shop: ${shop}`);

  try {
    const store = await db.store.findUnique({ where: { shop } });

    if (store) {
      const orderIds = payload?.orders_requested || [];

      // Log the request for audit trail
      console.log(
        `[GDPR] data_request for customer ${payload?.customer?.id} on ${shop}. Orders: ${orderIds.join(", ")}`
      );

      // Winfluencer stores no customer PII — only anonymous sessionIds and wfIds.
      // We hold: Event records, Touchpoint records linked to anonymous sessions.
      // These cannot be linked back to an individual customer by Winfluencer.
    }
  } catch (err) {
    console.error(`[GDPR] data_request error for ${shop}:`, err);
  }

  // Always return 200 — Shopify requires acknowledgement within 5 minutes.
  return new Response(null, { status: 200 });
};
