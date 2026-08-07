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

    const noteAttrs = Array.isArray(payload.note_attributes) ? payload.note_attributes : [];
    const wfId = noteAttrs.find((a) => a?.name === "wf_influencer_id")?.value || null;

    let influencerId = null;
    if (wfId) {
      const influencer = await db.influencer.findUnique({ where: { wfId } });
      if (influencer) influencerId = influencer.id;
    }

    await db.order.create({
      data: {
        storeId: store.id,
        shopifyOrderId,
        wfId,
        influencerId,
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
