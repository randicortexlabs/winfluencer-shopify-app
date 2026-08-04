export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const { default: db } = await import("../db.server");

  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const store = await db.store.findFirst({ where: { shop, deletedAt: null } });
    if (!store) return new Response();

    const shopifyOrderId = String(payload.id);
    const existing = await db.order.findFirst({ where: { storeId: store.id, shopifyOrderId } });
    if (existing) return new Response();

    await db.order.create({
      data: {
        storeId: store.id,
        shopifyOrderId,
        wfId: null,
        totalPrice: parseFloat(payload.total_price || 0),
        currency: payload.currency || "USD",
        lineItems: payload.line_items || [],
      },
    });
  } catch (err) {
    console.error("orders/created webhook error:", err);
  }

  return new Response();
};
