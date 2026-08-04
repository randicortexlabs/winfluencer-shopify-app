import { useState } from "react";
import { Form, redirect, useActionData, useLoaderData, useNavigate } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  DataTable,
  Divider,
  FormLayout,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Sankey, Tooltip, Layer, Rectangle } from "recharts";

function formatCurrency(val) {
  return `$${Number(val || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function statusTone(status) {
  const value = String(status || "").toLowerCase();
  if (value === "active") return "success";
  if (value === "draft") return "attention";
  if (value === "completed") return "info";
  return "new";
}

export const loader = async ({ request, params }) => {
  const { authenticate } = await import("../shopify.server");
  const { default: db } = await import("../db.server");
  const { getCampaignStats, getCampaignSankeyData, getProductIntelligence, computeSignal, getCampaignHubTaps } = await import("../services/analytics.server");

  const { session } = await authenticate.admin(request);
  const store = await db.store.findUnique({ where: { shop: session.shop } });
  if (!store) throw new Response("Store not found", { status: 404 });

  const campaign = await db.campaign.findUnique({
    where: { id: params.id },
    include: {
      influencers: true,
      store: { select: { id: true, shop: true } },
    },
  });

  if (!campaign || campaign.store.shop !== session.shop) {
    throw new Response("Campaign not found", { status: 404 });
  }

  const [stats, sankeyData, products, hubTaps] = await Promise.all([
    getCampaignStats(campaign.id),
    getCampaignSankeyData(campaign.id),
    getProductIntelligence(store.id, { campaignId: campaign.id }),
    getCampaignHubTaps(campaign.id),
  ]);

  // Get per-influencer stats
  const influencerIds = campaign.influencers.map((i) => i.id);
  const idFilter = influencerIds.length > 0 ? influencerIds : ["none"];

  const [eventGroups, purchaseEvents, checkoutGroups] = await Promise.all([
    db.event.groupBy({
      by: ["influencerId", "eventType"],
      where: { influencerId: { in: idFilter } },
      _count: true,
    }),
    db.event.findMany({
      where: { influencerId: { in: idFilter }, eventType: "item_purchased" },
      select: { influencerId: true, price: true, quantity: true },
    }),
    db.event.groupBy({
      by: ["influencerId"],
      where: { influencerId: { in: idFilter }, eventType: "checkout_completed" },
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

  const influencers = campaign.influencers.map((inf) => {
    const events = eventMap[inf.id] || {};
    const visitors = (events["pageview"] || 0) + (events["page_viewed"] || 0);
    const cart = events["product_added_to_cart"] || 0;
    const purchaseCount = purchaseMap[inf.id] || 0;
    const revenue = revenueMap[inf.id] || 0;
    const convRate = visitors > 0 ? ((purchaseCount / visitors) * 100).toFixed(1) : "0.0";
    const aov = purchaseCount > 0 ? (revenue / purchaseCount).toFixed(2) : "0.00";

    return {
      id: inf.id,
      name: inf.name,
      handle: inf.handle,
      platform: inf.platform,
      wfId: inf.wfId,
      trackingUrl: inf.trackingUrl,
      visitors,
      cart,
      cartPct: visitors > 0 ? ((cart / visitors) * 100).toFixed(0) : "0",
      purchases: purchaseCount,
      purchasePct: cart > 0 ? ((purchaseCount / cart) * 100).toFixed(0) : "0",
      convRate: parseFloat(convRate),
      revenue,
      aov: parseFloat(aov),
      hubTaps: hubTaps[inf.wfId] || 0,
    };
  });

  const totalHubTaps = Object.values(hubTaps).reduce((s, n) => s + n, 0);
  return { campaign, stats, influencers, sankeyData, products, totalHubTaps };
};

export const action = async ({ request, params }) => {
  const { authenticate } = await import("../shopify.server");
  const { default: db } = await import("../db.server");

  const { session } = await authenticate.admin(request);
  const store = await db.store.findUnique({ where: { shop: session.shop } });
  if (!store) throw new Response("Store not found", { status: 404 });

  const campaign = await db.campaign.findUnique({
    where: { id: params.id },
    include: { store: { select: { shop: true } } },
  });
  if (!campaign || campaign.store.shop !== session.shop) {
    throw new Response("Campaign not found", { status: 404 });
  }

  const formData = await request.formData();
  const name = String(formData.get("name") || "").trim();
  const handle = String(formData.get("handle") || "").trim();
  const platform = String(formData.get("platform") || "instagram");

  if (!name || !handle) return { error: "Name and handle are required." };

  const wfId = globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const targetUrl = `https://${store.shop}`;
  const trackingUrl = `${targetUrl}?wf_id=${wfId}`;

  await db.influencer.create({
    data: { campaignId: campaign.id, name, handle, platform, wfId, targetUrl, trackingUrl },
  });

  return redirect(`/app/campaigns/${params.id}`);
};

const PLATFORM_OPTIONS = [
  { label: "Instagram", value: "instagram" },
  { label: "TikTok", value: "tiktok" },
  { label: "YouTube", value: "youtube" },
  { label: "Other", value: "other" },
];

function SankeyNode({ x, y, width, height, index, payload }) {
  const name = payload?.name || "";
  const funnelStages = ["Page View", "Product View", "Add to Cart", "Checkout", "Purchase"];
  const isStage = funnelStages.includes(name);
  return (
    <Layer key={`node-${index}`}>
      <Rectangle x={x} y={y} width={width} height={height} fill={isStage ? "#9A3A15" : "#E8854A"} radius={2} />
      <text x={x + width + 6} y={y + height / 2} textAnchor="start" dominantBaseline="central" fontSize={12} fill="#303030">
        {name}
      </text>
    </Layer>
  );
}

function signalTone(signal) {
  if (signal === "Strong intent") return "success";
  if (signal === "High convert") return "info";
  if (signal === "Price friction") return "critical";
  return undefined;
}

function convRateColor(rate) {
  if (rate >= 10) return "#008060";
  if (rate >= 5) return "#916A00";
  return "#8C9196";
}

export default function CampaignDetailPage() {
  const { campaign, stats, influencers, sankeyData, products, totalHubTaps } = useLoaderData();
  const actionData = useActionData();
  const navigate = useNavigate();
  const enrichedInfluencers = influencers.map((inf) => ({
    ...inf,
    revPerSession: inf.visitors > 0 ? inf.revenue / inf.visitors : 0,
  }));
  const maxRevPerSession = Math.max(...enrichedInfluencers.map((i) => i.revPerSession), 0.01);
  const maxConvRate = Math.max(...enrichedInfluencers.map((i) => i.convRate), 0.01);
  const maxRevenue = Math.max(...enrichedInfluencers.map((i) => i.revenue), 0.01);
  const maxAov = Math.max(...enrichedInfluencers.map((i) => i.aov), 0.01);
  const maxVisitors = Math.max(...enrichedInfluencers.map((i) => i.visitors), 1);
  const sortedByRevPerSession = [...enrichedInfluencers].sort((a, b) => b.revPerSession - a.revPerSession);
  const highestConvId = enrichedInfluencers.reduce((best, inf) => inf.convRate > (best?.convRate || 0) ? inf : best, null)?.id;
  const highestAovId = enrichedInfluencers.reduce((best, inf) => inf.aov > (best?.aov || 0) ? inf : best, null)?.id;
  const highestRevenueId = enrichedInfluencers.reduce((best, inf) => inf.revenue > (best?.revenue || 0) ? inf : best, null)?.id;

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newHandle, setNewHandle] = useState("");
  const [newPlatform, setNewPlatform] = useState("instagram");


  return (
    <Page
      title={campaign.name}
      backAction={{ url: "/app/campaigns" }}
      titleMetadata={<Badge tone={statusTone(campaign.status)}>{campaign.status}</Badge>}
      subtitle={`${formatDate(campaign.startDate)} \u2013 ${formatDate(campaign.endDate)} \u00B7 ${influencers.length} influencer${influencers.length !== 1 ? "s" : ""}`}
    >
      <ui-title-bar title={campaign.name}>
        <button onClick={() => navigate("/app/campaigns")}>Back</button>
      </ui-title-bar>
      <Layout>
        {/* Metric cards */}
        <Layout.Section>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "14px" }}>
            <Card>
              <BlockStack gap="100">
                <Text as="p" tone="subdued" variant="bodySm">Total revenue</Text>
                <Text variant="headingLg" as="p">{formatCurrency(stats.totalRevenue)}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text as="p" tone="subdued" variant="bodySm">Visitor sessions</Text>
                <Text variant="headingLg" as="p">{stats.visitors.toLocaleString()}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text as="p" tone="subdued" variant="bodySm">Add to cart</Text>
                <Text variant="headingLg" as="p">{stats.addToCart.toLocaleString()}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text as="p" tone="subdued" variant="bodySm">Purchases</Text>
                <Text variant="headingLg" as="p">{stats.purchases}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text as="p" tone="subdued" variant="bodySm">Conv. rate</Text>
                <Text variant="headingLg" as="p" tone="success">{stats.convRate}%</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <InlineStack gap="100" blockAlign="center">
                  <Text as="p" tone="subdued" variant="bodySm">Link Hub taps</Text>
                  <Badge tone="info" size="small">Declared</Badge>
                </InlineStack>
                <Text variant="headingLg" as="p">{totalHubTaps.toLocaleString()}</Text>
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>

        {/* Creator at a glance */}
        {enrichedInfluencers.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="headingSm" as="h2">Creator performance at a glance</Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      Bars show each metric relative to the top performer in this campaign
                    </Text>
                  </BlockStack>
                  <Badge>Campaign avg {stats.convRate}% conv.</Badge>
                </InlineStack>
                <Divider />
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(enrichedInfluencers.length, 3)}, minmax(0, 1fr))`, gap: "12px" }}>
                  {enrichedInfluencers.map((inf) => {
                    const isTopConv = inf.id === highestConvId;
                    const isTopAov = inf.id === highestAovId;
                    const isTopRev = inf.id === highestRevenueId;
                    const cc = convRateColor(inf.convRate);
                    const hasSmallSample = inf.visitors > 0 && inf.visitors < 30;
                    return (
                      <div key={inf.id} style={{ border: `0.5px solid ${isTopConv ? "#008060" : "#E1E3E5"}`, borderRadius: "8px", padding: "14px", backgroundColor: isTopConv ? "#F1F8F5" : undefined }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "14px", paddingBottom: "12px", borderBottom: "0.5px solid #E1E3E5" }}>
                          <div style={{ width: "30px", height: "30px", borderRadius: "50%", background: isTopConv ? "#008060" : "#F0F0F0", color: isTopConv ? "#fff" : "#6D7175", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, flexShrink: 0 }}>
                            {inf.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontSize: "13px", fontWeight: 600 }}>{inf.name}</div>
                            <div style={{ fontSize: "10px", color: "#6D7175" }}>@{inf.handle} · {inf.platform}</div>
                          </div>
                        </div>
                        {[
                          { label: "Sessions", value: inf.visitors, display: String(inf.visitors), pct: Math.round((inf.visitors / maxVisitors) * 100), color: "#2C6ECB", note: hasSmallSample ? "small sample" : null, noteColor: "#916A00" },
                          { label: "Conv. rate", value: inf.convRate, display: `${inf.convRate}%`, pct: Math.round((inf.convRate / maxConvRate) * 100), color: cc, valueColor: cc },
                          { label: "Revenue", value: inf.revenue, display: formatCurrency(inf.revenue), pct: Math.round((inf.revenue / maxRevenue) * 100), color: "#008060", valueColor: isTopRev ? "#008060" : undefined },
                          { label: "AOV", value: inf.aov, display: formatCurrency(inf.aov), pct: Math.round((inf.aov / maxAov) * 100), color: "#E8854A" },
                        ].map((m) => (
                          <div key={m.label} style={{ marginBottom: "10px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                              <span style={{ fontSize: "10px", color: "#6D7175" }}>{m.label}</span>
                              <span style={{ fontSize: "12px", fontWeight: 600, color: m.valueColor, fontVariantNumeric: "tabular-nums" }}>
                                {m.display}
                                {m.note && <span style={{ fontSize: "10px", color: m.noteColor, marginLeft: "5px", fontWeight: 400 }}>{m.note}</span>}
                              </span>
                            </div>
                            <div style={{ height: "5px", background: "#F1F2F3", borderRadius: "3px", overflow: "hidden" }}>
                              <div style={{ width: `${m.pct}%`, height: "100%", background: m.color, borderRadius: "3px" }} />
                            </div>
                          </div>
                        ))}
                        <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", paddingTop: "10px", borderTop: "0.5px solid #E1E3E5" }}>
                          {isTopConv && <span style={{ display: "inline-flex", fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "20px", background: "#F1F8F5", color: "#008060" }}>Highest conv.</span>}
                          {isTopAov && <span style={{ display: "inline-flex", fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "20px", background: "#F1F8F5", color: "#008060" }}>Highest AOV</span>}
                          {inf.hubTaps > 0 && <span style={{ display: "inline-flex", fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "20px", background: "#EBF0FB", color: "#2C6ECB" }}>{inf.hubTaps} Hub tap{inf.hubTaps > 1 ? "s" : ""}</span>}
                          {!isTopConv && !isTopAov && inf.hubTaps === 0 && <span style={{ fontSize: "10px", color: "#8C9196" }}>{inf.visitors} sessions</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Paid amplification signals */}
        {enrichedInfluencers.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="headingSm" as="h2">Paid amplification signals</Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      Ranked by revenue per session — the most reliable proxy for paid ad ROI. Use to guide Meta / TikTok Ads budget allocation.
                    </Text>
                  </BlockStack>
                  <span style={{ display: "inline-flex", fontSize: "10px", fontWeight: 600, padding: "2px 10px", borderRadius: "20px", background: "#FFF0E5", color: "#B54708" }}>
                    Organic → Paid proxy
                  </span>
                </InlineStack>
                <Divider />
                <BlockStack gap="300">
                  {sortedByRevPerSession.map((inf, idx) => {
                    const rank = idx + 1;
                    const isTop = rank === 1;
                    const isLow = rank === sortedByRevPerSession.length && inf.revPerSession < 5;
                    const hasSmallSample = inf.visitors > 0 && inf.visitors < 30;
                    const cc = convRateColor(inf.convRate);
                    return (
                      <div key={inf.id} style={{ border: `0.5px solid ${isTop ? "#008060" : "#E1E3E5"}`, borderRadius: "8px", padding: "14px", backgroundColor: isTop ? "#F1F8F5" : undefined, opacity: isLow ? 0.75 : 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                          <span style={{ display: "inline-flex", fontSize: "12px", fontWeight: 600, padding: "3px 10px", borderRadius: "20px", background: isTop ? "#F1F8F5" : "#F6F6F7", color: isTop ? "#008060" : "#6D7175" }}>#{rank}</span>
                          <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: isTop ? "#008060" : "#F0F0F0", color: isTop ? "#fff" : "#6D7175", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, flexShrink: 0 }}>
                            {inf.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: "13px", fontWeight: 600 }}>{inf.name}</div>
                            <div style={{ fontSize: "10px", color: "#6D7175" }}>@{inf.handle} · {inf.platform}</div>
                          </div>
                          <span style={{ display: "inline-flex", fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "20px", background: hasSmallSample ? "#FFF8E5" : "#F1F8F5", color: hasSmallSample ? "#916A00" : "#008060" }}>
                            {hasSmallSample ? `⚠ ${inf.visitors} sessions — small sample` : `✓ ${inf.visitors} sessions — reliable`}
                          </span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "12px" }}>
                          {[
                            { label: "Rev / session", display: `$${inf.revPerSession.toFixed(2)}`, pct: Math.round((inf.revPerSession / maxRevPerSession) * 100), barColor: "#2C6ECB", valueColor: isTop ? "#008060" : undefined },
                            { label: "Conv. rate", display: `${inf.convRate}%`, pct: Math.round((inf.convRate / maxConvRate) * 100), barColor: cc, valueColor: cc },
                            { label: "AOV", display: formatCurrency(inf.aov), pct: Math.round((inf.aov / maxAov) * 100), barColor: "#E8854A" },
                            { label: "Sessions", display: String(inf.visitors), note: hasSmallSample ? "Validate before scaling" : "Solid sample size", noteColor: hasSmallSample ? "#916A00" : "#008060", valueColor: hasSmallSample ? "#916A00" : "#008060" },
                          ].map((m) => (
                            <div key={m.label}>
                              <div style={{ fontSize: "10px", color: "#6D7175", marginBottom: "4px" }}>{m.label}</div>
                              <div style={{ fontSize: "16px", fontWeight: 600, color: m.valueColor, fontVariantNumeric: "tabular-nums" }}>{m.display}</div>
                              {m.pct !== undefined ? (
                                <div style={{ height: "4px", background: "#F1F2F3", borderRadius: "3px", overflow: "hidden", marginTop: "5px" }}>
                                  <div style={{ width: `${m.pct}%`, height: "100%", background: m.barColor, borderRadius: "3px" }} />
                                </div>
                              ) : (
                                <div style={{ fontSize: "10px", color: m.noteColor, marginTop: "3px" }}>{m.note}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </BlockStack>
                <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "11px", color: "#2C6ECB", lineHeight: "1.55", background: "#EBF0FB", border: "0.5px solid #2C6ECB", borderRadius: "6px", padding: "10px 13px" }}>
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0, marginTop: "1px" }}>
                    <circle cx="6.5" cy="6.5" r="6" stroke="currentColor" strokeWidth="1.1"/>
                    <path d="M6.5 5.5v3.5M6.5 4v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                  <span><strong>How to read this:</strong> Revenue per session = total revenue ÷ sessions for that creator. It captures both conversion rate and order value in one number — the higher it is, the more each paid click is worth. Always weigh against sample size before scaling spend.</span>
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Influencer breakdown table */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingSm" as="h2">Influencer breakdown</Text>
                <InlineStack gap="200">
                  <Badge tone="attention">{influencers.length} influencers</Badge>
                  <Button size="slim" onClick={() => setShowAddForm((v) => !v)}>
                    {showAddForm ? "Cancel" : "Add influencer"}
                  </Button>
                </InlineStack>
              </InlineStack>
              <Divider />
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #E1E3E5" }}>
                      {["Influencer", "Tracking link", "Visitor sessions", "\u2192 Cart", "\u2192 Purchase", "Conv. rate", "Revenue", "AOV", "Hub taps"].map((h) => (
                        <th key={h} style={{ padding: "10px 12px", textAlign: h === "Influencer" || h === "Tracking link" ? "left" : "right", fontSize: "13px", fontWeight: 600, color: "#6D7175" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {influencers.map((inf) => (
                      <tr
                        key={inf.id}
                        onClick={() => navigate(`/app/campaigns/${campaign.id}/influencers/${inf.id}`)}
                        style={{ borderBottom: "1px solid #F1F2F3", cursor: "pointer" }}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = "#FEF0EA"}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                      >
                        <td style={{ padding: "10px 12px", fontWeight: 500 }}>{inf.name}</td>
                        <td style={{ padding: "10px 12px", color: "#6D7175", fontSize: "13px" }}>?wf_id={inf.wfId}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>{inf.visitors}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>{inf.cart} ({inf.cartPct}%)</td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>{inf.purchases} ({inf.purchasePct}%)</td>
                        <td style={{ padding: "10px 12px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "flex-end" }}>
                            <span style={{ fontVariantNumeric: "tabular-nums", color: convRateColor(inf.convRate), fontWeight: 600, minWidth: "38px", textAlign: "right" }}>
                              {inf.convRate}%
                            </span>
                            <div style={{ width: "50px", height: "5px", backgroundColor: "#F1F2F3", borderRadius: "3px", overflow: "hidden" }}>
                              <div style={{ width: `${Math.round((inf.convRate / maxConvRate) * 100)}%`, height: "100%", backgroundColor: convRateColor(inf.convRate), borderRadius: "3px" }} />
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>{formatCurrency(inf.revenue)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>{formatCurrency(inf.aov)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          {inf.hubTaps > 0 ? (
                            <Badge tone="info">{inf.hubTaps}</Badge>
                          ) : (
                            <span style={{ color: "#8C9196" }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {showAddForm && (
                <div style={{ borderTop: "1px solid #E1E3E5", paddingTop: "16px" }}>
                  <Form method="post" onSubmit={() => { setNewName(""); setNewHandle(""); setNewPlatform("instagram"); setShowAddForm(false); }}>
                    <BlockStack gap="300">
                      {actionData?.error && (
                        <Banner tone="critical" title={actionData.error} />
                      )}
                      <Text variant="headingSm" as="h3">New influencer</Text>
                      <FormLayout>
                        <TextField
                          label="Influencer name"
                          name="name"
                          value={newName}
                          onChange={setNewName}
                          autoComplete="off"
                          requiredIndicator
                        />
                        <TextField
                          label="Handle/username"
                          name="handle"
                          value={newHandle}
                          onChange={setNewHandle}
                          autoComplete="off"
                          prefix="@"
                          requiredIndicator
                        />
                        <Select
                          label="Platform"
                          name="platform"
                          options={PLATFORM_OPTIONS}
                          value={newPlatform}
                          onChange={setNewPlatform}
                        />
                      </FormLayout>
                      <InlineStack align="end">
                        <Button submit variant="primary" size="slim">Add influencer</Button>
                      </InlineStack>
                    </BlockStack>
                  </Form>
                </div>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        {/* Campaign Journey Flow (Sankey) */}
        {sankeyData.nodes.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="headingSm" as="h2">Campaign journey flow</Text>
                    <Text as="p" tone="subdued">
                      How this campaign's influencer traffic flows through the funnel
                    </Text>
                  </BlockStack>
                  <Badge tone="info">Multi-touch</Badge>
                </InlineStack>
                <Divider />
                <div style={{ width: "100%", overflowX: "auto" }}>
                  <Sankey
                    width={800}
                    height={350}
                    data={sankeyData}
                    node={<SankeyNode />}
                    link={{ stroke: "#F1D5C5", strokeOpacity: 0.6 }}
                    nodePadding={30}
                    nodeWidth={10}
                    margin={{ top: 10, right: 160, bottom: 10, left: 10 }}
                  >
                    <Tooltip />
                  </Sankey>
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Product Intelligence */}
        {products.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="headingSm" as="h2">Product intelligence</Text>
                    <Text as="p" tone="subdued">Cart intent vs confirmed purchase — per variant</Text>
                  </BlockStack>
                  <Badge>{products.length} products tracked</Badge>
                </InlineStack>
                <Divider />
                <DataTable
                  columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "numeric", "numeric", "text"]}
                  headings={["Product", "Variant", "Price", "Carted", "Purchased", "Cart\u2192Buy rate", "Revenue", "Signal"]}
                  rows={products.map((p) => [
                    p.productTitle,
                    p.variantTitle,
                    formatCurrency(p.price),
                    String(p.carted),
                    String(p.purchased),
                    `${p.rate}%`,
                    formatCurrency(p.revenue),
                    p.signal,
                  ])}
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
