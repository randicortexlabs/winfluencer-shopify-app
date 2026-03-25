import db from "../db.server";

// ─── Funnel counts ──────────────────────────────────────────────────────────

/**
 * Returns { pageview, product_viewed, product_added_to_cart, checkout_started, checkout_completed, purchased }
 */
export async function getStoreFunnelCounts(storeId) {
  const [eventGroups, orderCount] = await Promise.all([
    db.event.groupBy({
      by: ["eventType"],
      where: { storeId },
      _count: true,
    }),
    db.order.count({ where: { storeId } }),
  ]);

  const counts = {};
  for (const g of eventGroups) {
    counts[g.eventType] = g._count;
  }

  return {
    visitors: counts["pageview"] || 0,
    productViews: counts["product_viewed"] || 0,
    addToCart: counts["product_added_to_cart"] || 0,
    checkoutStarted: counts["checkout_started"] || 0,
    checkoutCompleted: counts["checkout_completed"] || 0,
    purchased: orderCount,
  };
}

export async function getInfluencerFunnelCounts(influencerId) {
  const [eventGroups, orderCount] = await Promise.all([
    db.event.groupBy({
      by: ["eventType"],
      where: { influencerId },
      _count: true,
    }),
    db.order.count({ where: { influencerId } }),
  ]);

  const counts = {};
  for (const g of eventGroups) {
    counts[g.eventType] = g._count;
  }

  return {
    visitors: counts["pageview"] || 0,
    productViews: counts["product_viewed"] || 0,
    addToCart: counts["product_added_to_cart"] || 0,
    checkoutStarted: counts["checkout_started"] || 0,
    checkoutCompleted: counts["checkout_completed"] || 0,
    purchased: orderCount,
  };
}

export async function getCampaignFunnelCounts(campaignId) {
  const [eventGroups, orderCount] = await Promise.all([
    db.event.groupBy({
      by: ["eventType"],
      where: { influencer: { campaignId } },
      _count: true,
    }),
    db.order.count({ where: { influencer: { campaignId } } }),
  ]);

  const counts = {};
  for (const g of eventGroups) {
    counts[g.eventType] = g._count;
  }

  return {
    visitors: counts["pageview"] || 0,
    productViews: counts["product_viewed"] || 0,
    addToCart: counts["product_added_to_cart"] || 0,
    checkoutStarted: counts["checkout_started"] || 0,
    checkoutCompleted: counts["checkout_completed"] || 0,
    purchased: orderCount,
  };
}

// ─── Overview metrics ───────────────────────────────────────────────────────

export async function getStoreOverviewMetrics(storeId) {
  const [campaignCount, influencerCount, orderCount, revenueAgg, funnel] =
    await Promise.all([
      db.campaign.count({ where: { storeId } }),
      db.influencer.count({ where: { campaign: { storeId } } }),
      db.order.count({ where: { storeId } }),
      db.order.aggregate({ where: { storeId }, _sum: { totalPrice: true } }),
      getStoreFunnelCounts(storeId),
    ]);

  const totalRevenue = revenueAgg._sum.totalPrice ?? 0;
  const avgConversion =
    funnel.visitors > 0
      ? ((funnel.purchased / funnel.visitors) * 100).toFixed(1)
      : null;

  return {
    campaignCount,
    influencerCount,
    orderCount,
    totalRevenue,
    avgConversion,
    funnel,
  };
}

// ─── Top influencers ────────────────────────────────────────────────────────

export async function getTopInfluencers(storeId, limit = 5) {
  const influencers = await db.influencer.findMany({
    where: { campaign: { storeId } },
    include: { campaign: true },
    take: 50,
  });

  if (influencers.length === 0) return [];

  const ids = influencers.map((i) => i.id);

  const [eventGroups, orderGroups] = await Promise.all([
    db.event.groupBy({
      by: ["influencerId", "eventType"],
      where: { influencerId: { in: ids } },
      _count: true,
    }),
    db.order.groupBy({
      by: ["influencerId"],
      where: { influencerId: { in: ids } },
      _count: true,
      _sum: { totalPrice: true },
    }),
  ]);

  // Build lookup maps
  const eventMap = {};
  for (const g of eventGroups) {
    if (!g.influencerId) continue;
    if (!eventMap[g.influencerId]) eventMap[g.influencerId] = {};
    eventMap[g.influencerId][g.eventType] = g._count;
  }

  const orderMap = {};
  for (const g of orderGroups) {
    if (!g.influencerId) continue;
    orderMap[g.influencerId] = {
      count: g._count,
      revenue: g._sum.totalPrice ?? 0,
    };
  }

  const enriched = influencers.map((inf) => {
    const events = eventMap[inf.id] || {};
    const orders = orderMap[inf.id] || { count: 0, revenue: 0 };
    const visitors = events["pageview"] || 0;
    const addToCart = events["product_added_to_cart"] || 0;
    const convRate =
      visitors > 0 ? ((orders.count / visitors) * 100).toFixed(1) : "0.0";
    const aov = orders.count > 0 ? (orders.revenue / orders.count).toFixed(2) : "0.00";

    return {
      id: inf.id,
      name: inf.name,
      handle: inf.handle,
      platform: inf.platform,
      campaignId: inf.campaignId,
      campaignName: inf.campaign.name,
      wfId: inf.wfId,
      trackingUrl: inf.trackingUrl,
      visitors,
      addToCart,
      purchases: orders.count,
      revenue: orders.revenue,
      convRate: parseFloat(convRate),
      aov: parseFloat(aov),
    };
  });

  // Sort by revenue descending
  enriched.sort((a, b) => b.revenue - a.revenue);

  return limit ? enriched.slice(0, limit) : enriched;
}

// ─── Influencer comparison (all influencers for a store) ────────────────────

export async function getInfluencerComparison(storeId) {
  return getTopInfluencers(storeId, 0); // 0 = no limit
}

// ─── Campaign stats ─────────────────────────────────────────────────────────

export async function getCampaignStats(campaignId) {
  const [funnel, revenueAgg, influencerCount] = await Promise.all([
    getCampaignFunnelCounts(campaignId),
    db.order.aggregate({
      where: { influencer: { campaignId } },
      _sum: { totalPrice: true },
    }),
    db.influencer.count({ where: { campaignId } }),
  ]);

  const totalRevenue = revenueAgg._sum.totalPrice ?? 0;
  const convRate =
    funnel.visitors > 0
      ? ((funnel.purchased / funnel.visitors) * 100).toFixed(1)
      : "0.0";

  return {
    totalRevenue,
    visitors: funnel.visitors,
    addToCart: funnel.addToCart,
    purchases: funnel.purchased,
    convRate: parseFloat(convRate),
    influencerCount,
    funnel,
  };
}

// ─── Influencer stats ───────────────────────────────────────────────────────

export async function getInfluencerStats(influencerId) {
  const [funnel, revenueAgg] = await Promise.all([
    getInfluencerFunnelCounts(influencerId),
    db.order.aggregate({
      where: { influencerId },
      _sum: { totalPrice: true },
    }),
  ]);

  const revenue = revenueAgg._sum.totalPrice ?? 0;
  const convRate =
    funnel.visitors > 0
      ? ((funnel.purchased / funnel.visitors) * 100).toFixed(1)
      : "0.0";
  const aov =
    funnel.purchased > 0
      ? (revenue / funnel.purchased).toFixed(2)
      : "0.00";

  return {
    revenue,
    purchases: funnel.purchased,
    convRate: parseFloat(convRate),
    aov: parseFloat(aov),
    visitors: funnel.visitors,
    funnel,
  };
}

// ─── Product intelligence ───────────────────────────────────────────────────

export async function getProductIntelligence(storeId, filters = {}) {
  const { campaignId, influencerId } = filters;

  // Build where clause for events (carted)
  const eventWhere = {
    storeId,
    eventType: "product_added_to_cart",
    productId: { not: null },
  };
  if (influencerId) eventWhere.influencerId = influencerId;
  if (campaignId) eventWhere.influencer = { campaignId };

  // Get cart events grouped by product+variant
  const cartGroups = await db.event.groupBy({
    by: ["productId", "productTitle", "variantId", "variantTitle", "price"],
    where: eventWhere,
    _sum: { quantity: true },
    _count: true,
  });

  // Get orders for purchase data
  const orderWhere = { storeId };
  if (influencerId) orderWhere.influencerId = influencerId;
  if (campaignId) orderWhere.influencer = { campaignId };

  const orders = await db.order.findMany({
    where: orderWhere,
    select: { lineItems: true, influencerId: true },
  });

  // Parse lineItems to count purchases per variant
  const purchaseMap = {};
  for (const order of orders) {
    const items = Array.isArray(order.lineItems) ? order.lineItems : [];
    for (const item of items) {
      const key = item.variant_id || item.variantId || item.title || "unknown";
      if (!purchaseMap[key]) {
        purchaseMap[key] = { count: 0, revenue: 0, title: item.title || "" };
      }
      purchaseMap[key].count += item.quantity || 1;
      purchaseMap[key].revenue += parseFloat(item.price || 0) * (item.quantity || 1);
    }
  }

  // Merge cart and purchase data
  const products = cartGroups.map((cg) => {
    const variantKey = cg.variantId || cg.productTitle || "unknown";
    const purchased = purchaseMap[variantKey] || { count: 0, revenue: 0 };
    const cartCount = cg._count;
    const purchaseCount = purchased.count;
    const rate =
      cartCount > 0
        ? ((purchaseCount / cartCount) * 100).toFixed(1)
        : "0.0";

    return {
      productId: cg.productId,
      productTitle: cg.productTitle || "Unknown",
      variantId: cg.variantId,
      variantTitle: cg.variantTitle || "Default",
      price: cg.price || 0,
      carted: cartCount,
      purchased: purchaseCount,
      rate: parseFloat(rate),
      revenue: purchased.revenue,
      signal: computeSignal(cartCount, purchaseCount),
    };
  });

  // Sort by carted desc
  products.sort((a, b) => b.carted - a.carted);

  return products;
}

// ─── Signal computation ─────────────────────────────────────────────────────

export function computeSignal(cartCount, purchaseCount) {
  if (cartCount === 0) return "Normal";
  const rate = purchaseCount / cartCount;
  if (rate > 0.75) return "High convert";
  if (rate > 0.5) return "Strong intent";
  if (rate < 0.15 && cartCount > 10) return "Price friction";
  return "Normal";
}

// ─── Top product by revenue ─────────────────────────────────────────────────

export async function getTopProduct(storeId) {
  const orders = await db.order.findMany({
    where: { storeId },
    select: { lineItems: true },
  });

  const productRevenue = {};
  for (const order of orders) {
    const items = Array.isArray(order.lineItems) ? order.lineItems : [];
    for (const item of items) {
      const title = item.title || "Unknown";
      if (!productRevenue[title]) {
        productRevenue[title] = { revenue: 0, units: 0 };
      }
      productRevenue[title].revenue += parseFloat(item.price || 0) * (item.quantity || 1);
      productRevenue[title].units += item.quantity || 1;
    }
  }

  const sorted = Object.entries(productRevenue).sort(
    (a, b) => b[1].revenue - a[1].revenue
  );

  if (sorted.length === 0) return null;
  return {
    title: sorted[0][0],
    revenue: sorted[0][1].revenue,
    units: sorted[0][1].units,
  };
}

// ─── Campaign list enrichment ───────────────────────────────────────────────

export async function getEnrichedCampaigns(storeId) {
  const campaigns = await db.campaign.findMany({
    where: { storeId },
    include: {
      _count: { select: { influencers: true } },
      influencers: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  if (campaigns.length === 0) return [];

  const enriched = await Promise.all(
    campaigns.map(async (c) => {
      const influencerIds = c.influencers.map((i) => i.id);

      const [orderAgg, visitorCount] = await Promise.all([
        db.order.aggregate({
          where: { influencer: { campaignId: c.id } },
          _sum: { totalPrice: true },
          _count: true,
        }),
        db.event.count({
          where: {
            influencerId: { in: influencerIds.length > 0 ? influencerIds : ["none"] },
            eventType: "pageview",
          },
        }),
      ]);

      const revenue = orderAgg._sum.totalPrice ?? 0;
      const purchases = orderAgg._count;
      const convRate =
        visitorCount > 0
          ? ((purchases / visitorCount) * 100).toFixed(1)
          : "0.0";

      return {
        id: c.id,
        name: c.name,
        status: c.status,
        startDate: c.startDate,
        endDate: c.endDate,
        budget: c.budget ?? null,
        influencerCount: c._count.influencers,
        revenue,
        purchases,
        visitors: visitorCount,
        convRate: parseFloat(convRate),
      };
    })
  );

  return enriched;
}
