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

  const [eventGroups, purchaseEvents, checkoutGroups, visitorGroups] = await Promise.all([
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
    // Exclude checkout page views — checkout.shopify.com fires page_viewed on
    // every checkout step, inflating storefront visitor counts.
    db.event.groupBy({
      by: ["influencerId"],
      where: {
        influencerId: { in: ids },
        eventType: { in: ["page_viewed", "pageview"] },
        NOT: { pageUrl: { contains: "/checkouts/" } },
      },
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

  // Map of storefront-only (non-checkout) visitor counts per influencer
  const visitorMap = {};
  for (const g of visitorGroups) {
    if (!g.influencerId) continue;
    visitorMap[g.influencerId] = g._count;
  }

  const enriched = influencers.map((inf) => {
    const events = eventMap[inf.id] || {};
    const visitors = visitorMap[inf.id] || 0;
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

  // Influencer/campaign filter — resolved once, applied to both queries
  const influencerFilter = {};
  if (influencerId) influencerFilter.influencerId = influencerId;
  if (campaignId) {
    const infs = await db.influencer.findMany({ where: { campaignId }, select: { id: true } });
    const ids = infs.map((i) => i.id);
    influencerFilter.influencerId = { in: ids.length > 0 ? ids : ["none"] };
  }

  // Cart events: require productId so we can group by it
  const cartWhere = {
    storeId,
    productId: { not: null },
    eventType: "product_added_to_cart",
    ...influencerFilter,
  };

  // Purchase events: do NOT require productId — item_purchased events created
  // from checkout line items sometimes lack productId (nested GID not always
  // returned by the Web Pixel). productTitle + variantId is enough to identify.
  const purchaseWhere = {
    storeId,
    eventType: "item_purchased",
    ...influencerFilter,
  };

  const [cartGroups, purchaseEvents] = await Promise.all([
    db.event.groupBy({
      by: ["productId", "productTitle", "variantId", "variantTitle", "price"],
      where: cartWhere,
      _sum: { quantity: true },
      _count: true,
    }),
    db.event.findMany({
      where: purchaseWhere,
      select: {
        variantId: true, productId: true,
        productTitle: true, variantTitle: true,
        price: true, quantity: true,
      },
    }),
  ]);

  // Build purchase map keyed by variantId (fall back to productTitle)
  const purchaseMap = {};
  for (const e of purchaseEvents) {
    const key = e.variantId || e.productTitle || "unknown";
    if (!purchaseMap[key]) {
      purchaseMap[key] = {
        count: 0, revenue: 0,
        productId: e.productId,
        productTitle: e.productTitle,
        variantTitle: e.variantTitle,
        price: e.price,
      };
    }
    purchaseMap[key].count += e.quantity || 1;
    purchaseMap[key].revenue += parseFloat(e.price || 0) * (e.quantity || 1);
  }

  // Start building the product map from cart groups
  const productMap = {};
  for (const cg of cartGroups) {
    const key = cg.variantId || cg.productTitle || "unknown";
    const purchased = purchaseMap[key] || { count: 0, revenue: 0 };
    const cartCount = cg._count;
    const purchaseCount = purchased.count;
    const rate = cartCount > 0 ? ((purchaseCount / cartCount) * 100).toFixed(1) : "0.0";

    productMap[key] = {
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
  }

  // Add products that were purchased but NOT in any cart group.
  // This covers: "Buy Now" button, direct checkout, or add-to-cart before
  // the visitor clicked the influencer tracking link (cart event unattributed).
  for (const [key, purch] of Object.entries(purchaseMap)) {
    if (productMap[key]) continue; // already merged above
    productMap[key] = {
      productId: purch.productId || null,
      productTitle: purch.productTitle || "Unknown",
      variantId: key !== "unknown" ? key : null,
      variantTitle: purch.variantTitle || "Default",
      price: purch.price || 0,
      carted: 0,
      purchased: purch.count,
      rate: 0,
      revenue: purch.revenue,
      signal: computeSignal(0, purch.count),
    };
  }

  const products = Object.values(productMap);
  // Sort: most carted first, then most purchased, then highest revenue
  products.sort((a, b) => b.carted - a.carted || b.purchased - a.purchased || b.revenue - a.revenue);
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
        // Exclude checkout page views — checkout.shopify.com fires page_viewed
        // on every step, inflating campaign visitor totals.
        db.event.count({
          where: {
            influencerId: { in: idFilter },
            eventType: { in: ["pageview", "page_viewed"] },
            NOT: { pageUrl: { contains: "/checkouts/" } },
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

// ─── Link Hub metrics ─────────────────────────────────────────────────────────

export async function getStoreHubMetrics(storeId) {
  const linkHub = await db.linkHub.findUnique({ where: { storeId } });
  if (!linkHub) return null;

  const [total, tapped, escaped, byInfluencer] = await Promise.all([
    db.hubSession.count({ where: { linkHubId: linkHub.id } }),
    db.hubSession.count({ where: { linkHubId: linkHub.id, outcome: "tapped" } }),
    db.hubSession.count({ where: { linkHubId: linkHub.id, outcome: "escaped" } }),
    db.hubSession.groupBy({
      by: ["selectedWfId"],
      where: { linkHubId: linkHub.id, outcome: "tapped", selectedWfId: { not: null } },
      _count: true,
    }),
  ]);

  return {
    total,
    tapped,
    escaped,
    abandoned: total - tapped - escaped,
    completionRate: total > 0 ? ((tapped / total) * 100).toFixed(1) : "0.0",
    byWfId: byInfluencer.reduce((acc, g) => {
      if (g.selectedWfId) acc[g.selectedWfId] = g._count;
      return acc;
    }, {}),
  };
}

export async function getCampaignHubTaps(campaignId) {
  const influencers = await db.influencer.findMany({
    where: { campaignId },
    select: { wfId: true },
  });
  const wfIds = influencers.map((i) => i.wfId);
  if (wfIds.length === 0) return {};

  const groups = await db.hubSession.groupBy({
    by: ["selectedWfId"],
    where: { selectedWfId: { in: wfIds }, outcome: "tapped" },
    _count: true,
  });

  return groups.reduce((acc, g) => {
    if (g.selectedWfId) acc[g.selectedWfId] = g._count;
    return acc;
  }, {});
}

// ─── Store revenue trend ─────────────────────────────────────────────────────

export async function getStoreRevenueTrend(storeId, shop, accessToken) {
  const now = new Date();
  const MIN_WEEKS = 20;
  const PRE_CAMPAIGN_WEEKS = 6; // always show at least 6 weeks before campaign launch

  // Fetch campaign first so we can size the window to always include pre-campaign weeks
  const earliestCampaign = await db.campaign.findFirst({
    where: { storeId, startDate: { not: null } },
    orderBy: { startDate: "asc" },
    select: { startDate: true },
  });

  // Default window: 20 weeks back
  const defaultStart = new Date(now);
  defaultStart.setDate(defaultStart.getDate() - MIN_WEEKS * 7);

  // Extend back if campaign start is close to or before the default window edge
  let startDate = defaultStart;
  if (earliestCampaign?.startDate) {
    const launchDate = new Date(earliestCampaign.startDate);
    const prelaunchStart = new Date(launchDate);
    prelaunchStart.setDate(prelaunchStart.getDate() - PRE_CAMPAIGN_WEEKS * 7);
    if (prelaunchStart < defaultStart) startDate = prelaunchStart;
  }

  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
  const WEEKS = Math.ceil((now - startDate) / MS_PER_WEEK);

  const [attributedEvents, shopifyDays] = await Promise.all([
    db.event.findMany({
      where: { storeId, eventType: "item_purchased", influencerId: { not: null }, timestamp: { gte: startDate } },
      select: { timestamp: true, price: true, quantity: true },
    }),
    fetchShopifyDailyRevenue(shop, accessToken, startDate, now).catch((err) => {
      console.error("getStoreRevenueTrend: Shopify Analytics error", err.message);
      return [];
    }),
  ]);

  // Build weekly buckets
  const weeks = [];
  for (let i = 0; i < WEEKS; i++) {
    const weekStart = new Date(startDate);
    weekStart.setDate(weekStart.getDate() + i * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const label = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    const storeTotal = shopifyDays
      .filter((d) => { const date = new Date(d.date); return date >= weekStart && date < weekEnd; })
      .reduce((sum, d) => sum + d.revenue, 0);

    const attributed = attributedEvents
      .filter((e) => { const d = new Date(e.timestamp); return d >= weekStart && d < weekEnd; })
      .reduce((sum, e) => sum + parseFloat(e.price || 0) * (e.quantity || 1), 0);

    weeks.push({ week: label, storeTotal: Math.round(storeTotal * 100) / 100, attributed: Math.round(attributed * 100) / 100 });
  }

  // Find campaign launch week index
  let campaignLaunchWeek = null;
  if (earliestCampaign?.startDate) {
    const launchDate = new Date(earliestCampaign.startDate);
    for (let i = 0; i < WEEKS; i++) {
      const weekStart = new Date(startDate);
      weekStart.setDate(weekStart.getDate() + i * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      if (launchDate >= weekStart && launchDate < weekEnd) { campaignLaunchWeek = i; break; }
    }
    // Campaign predates even the extended window — pin to week 0
    if (campaignLaunchWeek === null && launchDate < startDate) {
      campaignLaunchWeek = 0;
    }
  }

  // Before / after averages
  let beforeAvg = null, afterAvg = null, pctChange = null, attributionPenetration = null;
  if (campaignLaunchWeek !== null) {
    const beforeWeeks = weeks.slice(0, campaignLaunchWeek).filter((w) => w.storeTotal > 0);
    const afterWeeks  = weeks.slice(campaignLaunchWeek).filter((w) => w.storeTotal > 0);
    if (beforeWeeks.length > 0) beforeAvg = Math.round(beforeWeeks.reduce((s, w) => s + w.storeTotal, 0) / beforeWeeks.length);
    if (afterWeeks.length > 0)  afterAvg  = Math.round(afterWeeks.reduce((s, w) => s + w.storeTotal, 0) / afterWeeks.length);
    if (beforeAvg && afterAvg)  pctChange = Math.round(((afterAvg - beforeAvg) / beforeAvg) * 100);
    const totalAfterRevenue = afterWeeks.reduce((s, w) => s + w.storeTotal, 0);
    const totalAfterAttributed = afterWeeks.reduce((s, w) => s + w.attributed, 0);
    if (totalAfterRevenue > 0) attributionPenetration = Math.round((totalAfterAttributed / totalAfterRevenue) * 100);
  }

  return { weeks, campaignLaunchWeek, beforeAvg, afterAvg, pctChange, attributionPenetration };
}

async function fetchShopifyDailyRevenue(shop, accessToken, since, until) {
  if (!accessToken) {
    console.error("[wf] fetchShopifyDailyRevenue: accessToken is missing");
    return [];
  }

  // Use orders GraphQL API — requires read_orders + PCD Level 1 only (no PII fields requested).
  const sinceISO = since.toISOString();
  const untilISO = until.toISOString();
  const dayMap = {};
  let cursor = null;
  let hasNextPage = true;
  let pageCount = 0;

  while (hasNextPage) {
    const after = cursor ? `, after: ${JSON.stringify(cursor)}` : "";
    const res = await fetch(`https://${shop}/admin/api/2026-04/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
      body: JSON.stringify({
        query: `{ orders(first: 250, query: "created_at:>=${sinceISO} AND created_at:<=${untilISO}"${after}) { edges { node { createdAt totalPriceSet { shopMoney { amount } } } } pageInfo { hasNextPage endCursor } } }`,
      }),
    });

    if (!res.ok) throw new Error(`Shopify GraphQL ${res.status}`);

    const json = await res.json();

    if (json.errors) {
      console.error(`[wf] fetchShopifyDailyRevenue errors: ${JSON.stringify(json.errors).slice(0, 400)}`);
      return [];
    }

    const orders = json?.data?.orders;
    if (!orders) break;

    for (const { node } of orders.edges) {
      const date = node.createdAt.split("T")[0];
      dayMap[date] = (dayMap[date] || 0) + parseFloat(node.totalPriceSet?.shopMoney?.amount || 0);
    }

    hasNextPage = orders.pageInfo.hasNextPage;
    cursor = orders.pageInfo.endCursor;
    pageCount++;
  }

  console.log(`[wf] fetchShopifyDailyRevenue: ${Object.keys(dayMap).length} days across ${pageCount} page(s)`);
  return Object.entries(dayMap).map(([date, revenue]) => ({ date, revenue }));
}

// ─── Recent visitor journeys ──────────────────────────────────────────────────

// ─── All influencers with bulk role computation ───────────────────────────────

export async function getAllInfluencersWithRoles(storeId, { campaignId } = {}) {
  const influencers = await db.influencer.findMany({
    where: { campaign: { storeId, ...(campaignId ? { id: campaignId } : {}) } },
    include: { campaign: true },
  });
  if (influencers.length === 0) return [];

  const ids = influencers.map((i) => i.id);

  const [eventGroups, purchaseEvents, checkoutGroups, visitorGroups, touchpoints] = await Promise.all([
    db.event.groupBy({ by: ["influencerId", "eventType"], where: { influencerId: { in: ids } }, _count: true }),
    db.event.findMany({ where: { influencerId: { in: ids }, eventType: "item_purchased" }, select: { influencerId: true, price: true, quantity: true } }),
    db.event.groupBy({ by: ["influencerId"], where: { influencerId: { in: ids }, eventType: "checkout_completed" }, _count: true }),
    db.event.groupBy({ by: ["influencerId"], where: { influencerId: { in: ids }, eventType: { in: ["page_viewed", "pageview"] }, NOT: { pageUrl: { contains: "/checkouts/" } } }, _count: true }),
    db.touchpoint.findMany({ where: { influencerId: { in: ids } }, select: { sessionId: true, touchIndex: true, influencerId: true } }),
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
  for (const g of checkoutGroups) { if (g.influencerId) purchaseMap[g.influencerId] = g._count; }
  const visitorMap = {};
  for (const g of visitorGroups) { if (g.influencerId) visitorMap[g.influencerId] = g._count; }

  const sessionIds = [...new Set(touchpoints.map((tp) => tp.sessionId))];
  const sessionMaxIndex = {};
  if (sessionIds.length > 0) {
    const allTps = await db.touchpoint.findMany({ where: { sessionId: { in: sessionIds } }, select: { sessionId: true, touchIndex: true } });
    for (const tp of allTps) sessionMaxIndex[tp.sessionId] = Math.max(sessionMaxIndex[tp.sessionId] ?? 0, tp.touchIndex);
  }

  const roleMap = {};
  for (const id of ids) roleMap[id] = { introducer: 0, influencer: 0, closer: 0, total: 0 };
  for (const tp of touchpoints) {
    if (!tp.influencerId || !roleMap[tp.influencerId]) continue;
    const maxIdx = sessionMaxIndex[tp.sessionId] ?? 0;
    roleMap[tp.influencerId].total++;
    if (maxIdx === 0)           roleMap[tp.influencerId].closer++;
    else if (tp.touchIndex === 0)         roleMap[tp.influencerId].introducer++;
    else if (tp.touchIndex === maxIdx)    roleMap[tp.influencerId].closer++;
    else                                  roleMap[tp.influencerId].influencer++;
  }

  const enriched = influencers.map((inf) => {
    const events = eventMap[inf.id] || {};
    const visitors = visitorMap[inf.id] || 0;
    const addToCart = events["product_added_to_cart"] || 0;
    const purchaseCount = purchaseMap[inf.id] || 0;
    const revenue = revenueMap[inf.id] || 0;
    const convRate = visitors > 0 ? ((purchaseCount / visitors) * 100).toFixed(1) : "0.0";
    const aov = purchaseCount > 0 ? (revenue / purchaseCount).toFixed(2) : "0.00";

    const r = roleMap[inf.id];
    const { introducer, influencer: mid, closer, total: rTotal } = r;
    let primaryRole = null;
    if (rTotal > 0) {
      if (closer >= introducer && closer >= mid) primaryRole = "Closer";
      else if (introducer >= closer && introducer >= mid) primaryRole = "Introducer";
      else primaryRole = "Influencer";
    }

    return {
      id: inf.id,
      name: inf.name,
      handle: inf.handle,
      platform: inf.platform,
      campaignId: inf.campaignId,
      campaignName: inf.campaign.name,
      wfId: inf.wfId,
      visitors,
      addToCart,
      purchases: purchaseCount,
      revenue,
      convRate: parseFloat(convRate),
      aov: parseFloat(aov),
      primaryRole,
      introducerPct: rTotal > 0 ? Math.round((introducer / rTotal) * 100) : 0,
      influencerPct: rTotal > 0 ? Math.round((mid / rTotal) * 100) : 0,
      closerPct: rTotal > 0 ? Math.round((closer / rTotal) * 100) : 0,
    };
  });

  enriched.sort((a, b) => b.revenue - a.revenue);
  return enriched;
}

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
