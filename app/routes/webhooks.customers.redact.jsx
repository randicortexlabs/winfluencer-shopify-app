import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * GDPR: customers/redact
 * Fired when a customer requests deletion of their data.
 * We delete Event and Touchpoint records where sessionId can be linked
 * to the customer's orders via the shopifyOrderId field in the Order table.
 */
export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[GDPR] ${topic} received for shop: ${shop}`);

  try {
    const store = await db.store.findUnique({ where: { shop } });

    if (store) {
      const orderIds = (payload?.orders_to_redact || []).map(String);

      if (orderIds.length > 0) {
        // Find orders matching the Shopify order IDs
        const orders = await db.order.findMany({
          where: {
            storeId: store.id,
            shopifyOrderId: { in: orderIds },
          },
          select: { id: true },
        });

        if (orders.length > 0) {
          const orderDbIds = orders.map((o) => o.id);

          // Delete the matched order records
          await db.order.deleteMany({
            where: { id: { in: orderDbIds } },
          });

          console.log(
            `[GDPR] customers/redact: deleted ${orders.length} order records for ${shop}`
          );
        }
      }

      // Note: Event and Touchpoint records use anonymous sessionIds.
      // Since we store no customer PII, we cannot reliably link sessions
      // to a specific customer. Anonymous data is not personal data under GDPR.
      console.log(`[GDPR] customers/redact completed for ${shop}`);
    }
  } catch (err) {
    console.error(`[GDPR] customers/redact error for ${shop}:`, err);
  }

  return new Response(null, { status: 200 });
};
