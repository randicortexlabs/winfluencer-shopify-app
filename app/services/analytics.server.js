import db from "../db.server";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function sumRevenue(where) {
  const events = await db.event.findMany({
    where: { ...where, eventType: "item_purchased" },
    select: { price: true, quantity: true },
  });
  return events.reduce((sum, e) => sum + parseFloat(e.price || 0) * (e.quantity || 1), 0);
}

async function countPurchases(where) {
  return db.event.count({ where: { ...where, eventType: "checkout_completed" } });
}

// ─── Funnel counts ────────────────────────────────────────────────────────────

export async function getStoreFunnelCounts(storeId) {
  // Exclude checkout page views — checkout.shopify.com fires page_viewed on every
  // checkout step, inflating the storefront visitor count.
  const storefrontPageFilter = {
    storeId,
    eventType: { in: ["page_viewed", "pageview"] },
    NOT: { pageUrl: { contains: "/checkouts/" } },
  };

  const [eventGroups, purchased, uniqueSessions, storefrontPageViews] = await Promise.all([
    db.event.groupBy({
      by: ["eventType"],
      where: { storeId },
      _count: true,
    }),
    countPurchases({ storeId }),
    db.event.findMany({
      where: { ...storefrontPageFilter, sessionId: { not: "" } },
      select: { sessionId: true },
      distinct: ["sessionId"],
    }),
    db.event.count({ where: storefrontPageFilter }),
  ]);

  const counts = {};
  for (const g of eventGroups) counts[g.eventType] = g._count;

  return {
    visitors: storefrontPageViews,
    uniqueVisitors: uniqueSessions.length,
    productViews: counts["product_viewed"] || 0,
    addToCart: counts["product_added_to_cart"] || 0,
    checkoutStarted: counts["checkout_started"] || 0,
    checkoutCompleted: counts["checkout_completed"] || 0,
    purchased,
  };
}

export async function getInfluencerFunnelCounts(influencerId) {
  const storefrontPageFilter = {
    influencerId,
    eventType: { in: ["page_viewed", "pageview"] },
    NOT: { pageUrl: { contains: "/checkouts/" } },
  };

  const [eventGroups, purchased, uniqueSessions, storefrontPageViews] = await Promise.all([
    db.event.groupBy({
      by: ["eventType"],
      where: { influencerId },
      _count: true,
    }),
    countPurchases({ influencerId }),
    db.event.findMany({
      where: { ...storefrontPageFilter, sessionId: { not: "" } },
      select: { sessionId: true },
      distinct: ["sessionId"],
    }),
    db.event.count({ where: storefrontPageFilter }),
  ]);

  const counts = {};
  for (const g of eventGroups) counts[g.eventType] = g._count;

  return {
    visitors: storefrontPageViews,
    uniqueVisitors: uniqueSessions.length,
    productViews: counts["product_viewed"] || 0,
    addToCart: counts["product_added_to_cart"] || 0,
    checkoutStarted: counts["checkout_started"] || 0,
    checkoutCompleted: counts["checkout_completed"] || 0,
    purchased,
  };
}

export async function getCampaignFunnelCounts(campaignId) {
  const influencers = await db.influencer.findMany({
    where: { campaignId },
    select: { id: true },
  });
  const influencerIds = influencers.map((i) => i.id);
  const idFilter = influencerIds.length > 0 ? influencerIds : ["none"];

  const storefrontPageFilter = {
    influencerId: { in: idFilter },
    eventType: { in: ["page_viewed", "pageview"] },
    NOT: { pageUrl: { contains: "/checkouts/" } },
  };

  const [eventGroups, purchased, storefrontPageViews] = await Promise.all([
    db.event.groupBy({
      by: ["eventType"],
      where: { influencerId: { in: idFilter } },
      _count: true,
    }),
    countPurchases({ influencerId: { in: idFilter } }),
    db.event.count({ where: storefrontPageFilter }),
  ]);

  const counts = {};
  for (const g of eventGroups) counts[g.eventType] = g._count;

  return {
    visitors: storefrontPageViews,
    productViews: counts["product_viewed"] || 0,
    addToCart: counts["product_added_to_cart"] || 0,
    checkoutStarted: counts["checkout_started"] || 0,
    checkoutCompleted: counts["checkout_completed"] || 0,
    purchased,
  };
}

// ─── Overview metrics ─────────────────────────────────────────────────────────

export async function getStoreOverviewMetrics(storeId) {
  const [funnel, totalRevenue] = await Promise.all([
    getStoreFunnelCounts(storeId),
    sumRevenue({ storeId }),
  ]);

  const avgConversion =
    funnel.visitors > 0
      ? ((funnel.purchased / funnel.visitors) * 100).toFixed(1)
      : null;

  return {
    totalRevenue,
    avgConversion,
    funnel,
  };
}

// ─── Top influencers ──────────────────────────────────────────────────────────

export async function getTopInfluencers(storeId, limit = 5) {
  const influencers = await db.influencer.findMany({
    where: { campaign: { storeId } },
    include: { campaign: true },
    take: 50,
  });

  if (influencers.length === 0) return [];

  const ids = influencers.map((i) => i.id);

  const [eventGroups, purchaseEvents, checkoutGroups] = await Promise.all([
    db.event.groupBy({
      by: ["influencerId", "eventType"],
      where: { influencerId: { in: ids } },
      _count: true,
    }),
    db.event.findMany({
      where: { influencerId: { in: ids }, eventType: "item_purchased" },
      select: { influencerId: true, price: true, quantity: true },
    }),
    db.event.groupBy({
      by: ["influencerId"],
      where: { influencerId: { in: ids }, eventType: "checkout_completed" },
      _count: true,
    }),
  ]);

  const eventMap = {};
  for (const g of eventGroups) {
    if (!g.influencerId) continue;
    if (!eventMap[g.influencerId]) eventMap[g.influencerId] = {};
    eventMap[g.influencerId][g.eventType] = g._count;
  }

  const revenueMap = {};
  for (const e of purchaseEvents) {
    if (!e.influencerId) continue;
    revenueMap[e.influencerId] = (revenueMap[e.influencerId] || 0) + parseFloat(e.price || 0) * (e.quantity || 1);
  }

  const purchaseMap = {};
  for (const g of checkoutGroups) {
    if (!g.influencerId) continue;
    purchaseMap[g.influencerId] = g._count;
  }

  const enriched = influencers.map((inf) => {
    const events = eventMap[inf.id] || {};
    const visitors = (events["page_viewed"] || 0) + (events["pageview"] || 0);
    const addToCart = events["product_added_to_cart"] || 0;
    const purchaseCount = purchaseMap[inf.id] || 0;
    const revenue = revenueMap[inf.id] || 0;
    const convRate = visitors > 0 ? ((purchaseCount / visitors) * 100).toFixed(1) : "0.0";
    const aov = purchaseCount > 0 ? (revenue / purchaseCount).toFixed(2) : "0.00";

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
      purchases: purchaseCount,
      revenue,
      convRate: parseFloat(convRate),
      aov: parseFloat(aov),
    };
  });

  enriched.sort((a, b) => b.revenue - a.revenue);
  return limit ? enriched.slice(0, limit) : enriched;
}

// ─── Influencer comparison ────────────────────────────────────────────────────

export async function getInfluencerComparison(storeId) {
  return getTopInfluencers(storeId, 0);
}

// ─── Campaign stats ───────────────────────────────────────────────────────────

export async function getCampaignStats(campaignId) {
  const influencers = await db.influencer.findMany({
    where: { campaignId },
    select: { id: true },
  });
  const influencerIds = influencers.map((i) => i.id);
  const idFilter = influencerIds.length > 0 ? influencerIds : ["none"];

  const [funnel, totalRevenue, influencerCount] = await Promise.all([
    getCampaignFunnelCounts(campaignId),
    sumRevenue({ influencerId: { in: idFilter } }),
    db.influencer.count({ where: { campaignId } }),
  ]);

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

// ─── Influencer stats ─────────────────────────────────────────────────────────

export async function getInfluencerStats(influencerId) {
  const [funnel, revenue] = await Promise.all([
    getInfluencerFunnelCounts(influencerId),
    sumRevenue({ influencerId }),
  ]);

  const convRate =
    funnel.visitors > 0
      ? ((funnel.purchased / funnel.visitors) * 100).toFixed(1)
      : "0.0";
  const aov =
    funnel.purchased > 0 ? (revenue / funnel.purchased).toFixed(2) : "0.00";

  return {
    revenue,
    purchases: funnel.purchased,
    convRate: parseFloat(convRate),
    aov: parseFloat(aov),
    visitors: funnel.visitors,
    uniqueVisitors: funnel.uniqueVisitors || 0,
    funnel,
  };
}

// ─── Product intelligence ─────────────────────────────────────────────────────

export async function getProductIntelligence(storeId, filters = {}) {
  const { campaignId, influencerId } = filters;

  const baseWhere = { storeId, productId: { not: null } };
  if (influencerId) baseWhere.influencerId = influencerId;
  if (campaignId) {
    const infs = await db.influencer.findMany({ where: { campaignId }, select: { id: true } });
    const ids = infs.map((i) => i.id);
    baseWhere.influencerId = { in: ids.length > 0 ? ids : ["none"] };
  }

  const cartWhere = { ...baseWhere, eventType: "product_added_to_cart" };
  const purchaseWhere = { ...baseWhere, eventType: "item_purchased" };

  const [cartGroups, purchaseEvents] = await Promise.all([
    db.event.groupBy({
      by: ["productId", "productTitle", "variantId", "variantTitle", "price"],
      where: cartWhere,
      _sum: { quantity: true },
      _count: true,
    }),
    db.event.findMany({
      where: purchaseWhere,
      select: { variantId: true, productTitle: true, price: true, quantity: true },
    }),
  ]);

  // Build purchase map keyed by variantId
  const purchaseMap = {};
  for (const e of purchaseEvents) {
    const key = e.variantId || "unknown";
    if (!purchaseMap[key]) purchaseMap[key] = { count: 0, revenue: 0 };
    purchaseMap[key].count += e.quantity || 1;
    purchaseMap[key].revenue += parseFloat(e.price || 0) * (e.quantity || 1);
  }

  const products = cartGroups.map((cg) => {
    const key = cg.variantId || "unknown";
    const purchased = purchaseMap[key] || { count: 0, revenue: 0 };
    const cartCount = cg._count;
    const purchaseCount = purchased.count;
    const rate =
      cartCount > 0 ? ((purchaseCount / cartCount) * 100).toFixed(1) : "0.0";

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

  products.sort((a, b) => b.carted - a.carted);
  return products;
}

// ─── Signal computation ───────────────────────────────────────────────────────

export function computeSignal(cartCount, purchaseCount) {
  if (cartCount === 0) return "Normal";
  const rate = purchaseCount / cartCount;
  if (rate > 0.75) return "High convert";
  if (rate > 0.5) return "Strong intent";
  if (rate < 0.15 && cartCount > 10) return "Price friction";
  return "Normal";
}

// ─── Top product by revenue ───────────────────────────────────────────────────

export async function getTopProduct(storeId) {
  const events = await db.event.findMany({
    where: { storeId, eventType: "item_purchased", productTitle: { not: null } },
    select: { productTitle: true, price: true, quantity: true },
  });

  const productRevenue = {};
  for (const e of events) {
    const title = e.productTitle || "Unknown";
    if (!productRevenue[title]) productRevenue[title] = { revenue: 0, units: 0 };
    productRevenue[title].revenue += parseFloat(e.price || 0) * (e.quantity || 1);
    productRevenue[title].units += e.quantity || 1;
  }

  const sorted = Object.entries(productRevenue).sort((a, b) => b[1].revenue - a[1].revenue);
  if (sorted.length === 0) return null;
  return { title: sorted[0][0], revenue: sorted[0][1].revenue, units: sorted[0][1].units };
}

// ─── Campaign list enrichment ─────────────────────────────────────────────────

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
      const idFilter = influencerIds.length > 0 ? influencerIds : ["none"];

      const [revenue, purchases, visitorCount] = await Promise.all([
        sumRevenue({ influencerId: { in: idFilter } }),
        countPurchases({ influencerId: { in: idFilter } }),
        db.event.count({
          where: {
            influencerId: { in: idFilter },
            eventType: { in: ["pageview", "page_viewed"] },
          },
        }),
      ]);

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

// ─── Sankey diagram data ──────────────────────────────────────────────────────

export async function getSankeyData(storeId) {
  const touchpoints = await db.touchpoint.findMany({
    where: { storeId },
    include: { influencer: { select: { name: true } } },
    orderBy: [{ sessionId: "asc" }, { touchIndex: "asc" }],
  });

  if (touchpoints.length === 0) return { nodes: [], links: [] };

  const sessionEvents = await db.event.groupBy({
    by: ["sessionId", "eventType"],
    where: {
      storeId,
      sessionId: { not: "" },
      eventType: {
        in: ["page_viewed", "product_viewed", "product_added_to_cart", "checkout_started", "checkout_completed"],
      },
    },
    _count: true,
  });

  const stageOrder = ["page_viewed", "product_viewed", "product_added_to_cart", "checkout_started", "checkout_completed"];
  const stageLabels = {
    page_viewed: "Page View",
    product_viewed: "Product View",
    product_added_to_cart: "Add to Cart",
    checkout_started: "Checkout",
    checkout_completed: "Purchase",
  };

  const sessionMaxStage = {};
  for (const se of sessionEvents) {
    const idx = stageOrder.indexOf(se.eventType);
    if (idx > (sessionMaxStage[se.sessionId] ?? -1)) {
      sessionMaxStage[se.sessionId] = idx;
    }
  }

  const sessionTouchpoints = {};
  for (const tp of touchpoints) {
    if (!sessionTouchpoints[tp.sessionId]) sessionTouchpoints[tp.sessionId] = [];
    sessionTouchpoints[tp.sessionId].push(tp);
  }

  const nodeSet = new Set();
  const linkMap = {};

  for (const [sessionId, tps] of Object.entries(sessionTouchpoints)) {
    const maxStageIdx = sessionMaxStage[sessionId];
    if (maxStageIdx === undefined) continue;

    const lastTouch = tps[tps.length - 1];
    const influencerName = lastTouch.influencer?.name || lastTouch.wfId;
    const stageName = stageLabels[stageOrder[maxStageIdx]];

    nodeSet.add(influencerName);
    nodeSet.add(stageName);

    const key = `${influencerName}|${stageName}`;
    linkMap[key] = (linkMap[key] || 0) + 1;
  }

  const nodes = Array.from(nodeSet).map((name) => ({ name }));
  const nodeIndex = {};
  nodes.forEach((n, i) => { nodeIndex[n.name] = i; });

  const links = Object.entries(linkMap).map(([key, value]) => {
    const [source, target] = key.split("|");
    return { source: nodeIndex[source], target: nodeIndex[target], value };
  });

  return { nodes, links };
}

// ─── Campaign-level Sankey data ───────────────────────────────────────────────

export async function getCampaignSankeyData(campaignId) {
  const influencers = await db.influencer.findMany({
    where: { campaignId },
    select: { id: true },
  });
  const influencerIds = influencers.map((i) => i.id);
  if (influencerIds.length === 0) return { nodes: [], links: [] };

  const touchpoints = await db.touchpoint.findMany({
    where: { influencerId: { in: influencerIds } },
    include: { influencer: { select: { name: true } } },
    orderBy: [{ sessionId: "asc" }, { touchIndex: "asc" }],
  });

  if (touchpoints.length === 0) return { nodes: [], links: [] };

  const sessionIds = [...new Set(touchpoints.map((tp) => tp.sessionId))];

  const sessionEvents = await db.event.groupBy({
    by: ["sessionId", "eventType"],
    where: {
      sessionId: { in: sessionIds },
      eventType: {
        in: ["page_viewed", "product_viewed", "product_added_to_cart", "checkout_started", "checkout_completed"],
      },
    },
    _count: true,
  });

  const stageOrder = ["page_viewed", "product_viewed", "product_added_to_cart", "checkout_started", "checkout_completed"];
  const stageLabels = {
    page_viewed: "Page View",
    product_viewed: "Product View",
    product_added_to_cart: "Add to Cart",
    checkout_started: "Checkout",
    checkout_completed: "Purchase",
  };

  const sessionMaxStage = {};
  for (const se of sessionEvents) {
    const idx = stageOrder.indexOf(se.eventType);
    if (idx > (sessionMaxStage[se.sessionId] ?? -1)) {
      sessionMaxStage[se.sessionId] = idx;
    }
  }

  const sessionTouchpoints = {};
  for (const tp of touchpoints) {
    if (!sessionTouchpoints[tp.sessionId]) sessionTouchpoints[tp.sessionId] = [];
    sessionTouchpoints[tp.sessionId].push(tp);
  }

  const nodeSet = new Set();
  const linkMap = {};

  for (const [sessionId, tps] of Object.entries(sessionTouchpoints)) {
    const maxStageIdx = sessionMaxStage[sessionId];
    if (maxStageIdx === undefined) continue;

    const lastTouch = tps[tps.length - 1];
    const influencerName = lastTouch.influencer?.name || lastTouch.wfId;
    const stageName = stageLabels[stageOrder[maxStageIdx]];

    nodeSet.add(influencerName);
    nodeSet.add(stageName);

    const key = `${influencerName}|${stageName}`;
    linkMap[key] = (linkMap[key] || 0) + 1;
  }

  const nodes = Array.from(nodeSet).map((name) => ({ name }));
  const nodeIndex = {};
  nodes.forEach((n, i) => { nodeIndex[n.name] = i; });

  const links = Object.entries(linkMap).map(([key, value]) => {
    const [source, target] = key.split("|");
    return { source: nodeIndex[source], target: nodeIndex[target], value };
  });

  return { nodes, links };
}

// ─── Influencer role breakdown ────────────────────────────────────────────────

export async function getInfluencerRoleBreakdown(influencerId) {
  const touchpoints = await db.touchpoint.findMany({
    where: { influencerId },
    select: { sessionId: true, touchIndex: true },
  });

  if (touchpoints.length === 0) {
    return { introducer: 0, influencer: 0, closer: 0, total: 0, introducerPct: 0, influencerPct: 0, closerPct: 0 };
  }

  const sessionIds = [...new Set(touchpoints.map((tp) => tp.sessionId))];
  const allTouchpoints = await db.touchpoint.findMany({
    where: { sessionId: { in: sessionIds } },
    select: { sessionId: true, touchIndex: true },
  });

  const sessionMaxIndex = {};
  for (const tp of allTouchpoints) {
    sessionMaxIndex[tp.sessionId] = Math.max(sessionMaxIndex[tp.sessionId] ?? 0, tp.touchIndex);
  }

  let introducer = 0;
  let closer = 0;
  let influencerMid = 0;

  for (const tp of touchpoints) {
    const maxIdx = sessionMaxIndex[tp.sessionId] ?? 0;
    const isFirst = tp.touchIndex === 0;
    const isLast  = tp.touchIndex === maxIdx;

    if (maxIdx === 0) {
      // Single-touch journey: this influencer is the only touch.
      // Last-touch attribution gives them full Closer credit
      // (they had the final click that led to the session outcome).
      closer++;
    } else if (isFirst) {
      introducer++;
    } else if (isLast) {
      closer++;
    } else {
      influencerMid++;
    }
  }

  const total = touchpoints.length;
  return {
    introducer,
    influencer: influencerMid,
    closer,
    total,
    introducerPct: total > 0 ? Math.round((introducer / total) * 100) : 0,
    influencerPct: total > 0 ? Math.round((influencerMid / total) * 100) : 0,
    closerPct: total > 0 ? Math.round((closer / total) * 100) : 0,
  };
}

// ─── Recent visitor journeys ──────────────────────────────────────────────────

export async function getRecentJourneys(influencerId, limit = 10) {
  const touchpoints = await db.touchpoint.findMany({
    where: { influencerId },
    orderBy: { timestamp: "desc" },
    take: limit,
    select: { sessionId: true },
  });

  if (touchpoints.length === 0) return [];

  const sessionIds = [...new Set(touchpoints.map((tp) => tp.sessionId))];

  const [allTouchpoints, conversionEvents] = await Promise.all([
    db.touchpoint.findMany({
      where: { sessionId: { in: sessionIds } },
      include: { influencer: { select: { name: true, id: true } } },
      orderBy: [{ sessionId: "asc" }, { touchIndex: "asc" }],
    }),
    db.event.findMany({
      where: { sessionId: { in: sessionIds }, eventType: "checkout_completed" },
      select: { sessionId: true },
      distinct: ["sessionId"],
    }),
  ]);

  const convertedSessions = new Set(conversionEvents.map((e) => e.sessionId));

  const journeyMap = {};
  for (const tp of allTouchpoints) {
    if (!journeyMap[tp.sessionId]) journeyMap[tp.sessionId] = [];
    journeyMap[tp.sessionId].push({
      wfId: tp.wfId,
      influencerName: tp.influencer?.name || tp.wfId,
      touchIndex: tp.touchIndex,
      isCurrentInfluencer: tp.influencer?.id === influencerId,
    });
  }

  return sessionIds.map((sid) => ({
    sessionId: sid,
    converted: convertedSessions.has(sid),
    touches: journeyMap[sid] || [],
  }));
}
