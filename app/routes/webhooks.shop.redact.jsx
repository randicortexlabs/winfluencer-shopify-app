import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * GDPR: shop/redact
 * Fired 48 hours after a merchant uninstalls the app.
 * We immediately delete all visitor tracking data (Events, Touchpoints, Orders).
 * Campaign and Influencer records are retained for 30 days (merchant-created content)
 * by soft-deleting the store via the deletedAt field.
 *
 * A separate cleanup process (or manual run) should hard-delete stores
 * where deletedAt is older than 30 days.
 */
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`[GDPR] ${topic} received for shop: ${shop}`);

  try {
    const store = await db.store.findUnique({ where: { shop } });

    if (store) {
      // Step 1: Immediately delete all visitor tracking data
      await Promise.all([
        db.event.deleteMany({ where: { storeId: store.id } }),
        db.touchpoint.deleteMany({ where: { storeId: store.id } }),
        db.order.deleteMany({ where: { storeId: store.id } }),
        db.teamMember.deleteMany({ where: { storeId: store.id } }),
      ]);

      console.log(`[GDPR] shop/redact: deleted all tracking data for ${shop}`);

      // Step 2: Soft-delete the store — retains Campaign/Influencer records
      // for 30 days in case the merchant reinstalls.
      // These records are merchant-created content, not customer data.
      await db.store.update({
        where: { id: store.id },
        data: { deletedAt: new Date() },
      });

      console.log(
        `[GDPR] shop/redact: store ${shop} soft-deleted. Campaign/Influencer data will be retained for 30 days.`
      );

      // Step 3: Delete Shopify sessions
      await db.session.deleteMany({ where: { shop } });
    }
  } catch (err) {
    console.error(`[GDPR] shop/redact error for ${shop}:`, err);
  }

  return new Response(null, { status: 200 });
};
