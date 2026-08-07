import { Link, useLoaderData, useNavigate } from "react-router";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  Divider,
  EmptyState,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Sankey, Tooltip, Layer, Rectangle, Text as RText, BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, ReferenceLine } from "recharts";

export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const { default: db } = await import("../db.server");
  const { installCustomPixel } = await import("../services/pixel.server");
  const {
    getStoreOverviewMetrics,
    getTopInfluencers,
    getInfluencerComparison,
    getTopProduct,
    getSankeyData,
    getStoreRevenueTrend,
  } = await import("../services/analytics.server");

  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Use the offline (permanent) session token for Admin API calls.
  // session.accessToken is the online token — it expires when the merchant logs out.
  const offlineSession = await db.session.findFirst({ where: { shop, isOnline: false } });
  const accessToken = offlineSession?.accessToken || session.accessToken;

  let store = await db.store.findUnique({ where: { shop } });
  let isNewInstall = false;

  if (!store) {
    const pixelId = globalThis.crypto.randomUUID();
    try {
      store = await db.store.create({
        data: { shop, accessToken, pixelId },
      });
      isNewInstall = true;
    } catch (err) {
      if (err?.code === "P2002") {
        store = await db.store.findUnique({ where: { shop } });
      } else {
        throw err;
      }
    }
  }

  // orders/created webhook is registered declaratively in shopify.app.toml
  // No runtime REST registration needed — avoids duplicate webhooks and
  // deprecated API usage on every page load.

  if (!store) throw new Response("Store not available", { status: 500 });

  // Activate the web pixel extension for this merchant via webPixelCreate.
  // This is required for every merchant — the extension won't fire until connected.
  // Idempotent: if already connected, the mutation returns a userError which we silently ignore.
  installCustomPixel(shop, accessToken, store.pixelId).catch(() => {});

  const [metrics, topInfluencers, allInfluencers, topProduct, sankeyData, revenueTrend] = await Promise.all([
    getStoreOverviewMetrics(store.id),
    getTopInfluencers(store.id, 5),
    getInfluencerComparison(store.id),
    getTopProduct(store.id),
    getSankeyData(store.id),
    getStoreRevenueTrend(store.id, shop, accessToken),
  ]);

  return { store, isNewInstall, metrics, topInfluencers, allInfluencers, topProduct, sankeyData, revenueTrend };
};

function formatCurrency(val) {
  return `$${Number(val || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function platformTone(platform) {
  const p = (platform || "").toLowerCase();
  if (p === "tiktok") return "attention";
  if (p === "instagram") return "info";
  if (p === "youtube") return "critical";
  return "new";
}

function convRateColor(rate) {
  if (rate >= 10) return "#008060";
  if (rate >= 5) return "#916A00";
  return "#8C9196";
}

function RevenueTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0]?.payload;
  return (
    <div style={{ background: "#fff", border: "0.5px solid #E1E3E5", borderRadius: "6px", padding: "8px 12px", fontSize: "12px", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
      <div style={{ fontWeight: 600, marginBottom: "6px", color: "#202223" }}>
        {label} – {data?.weekEnd}
        {data?.isCurrentWeek && (
          <span style={{ marginLeft: "6px", fontSize: "10px", fontWeight: 400, color: "#6D7175", background: "#F1F2F3", borderRadius: "4px", padding: "1px 5px" }}>
            current week
          </span>
        )}
      </div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: "flex", justifyContent: "space-between", gap: "16px", marginTop: "2px" }}>
          <span style={{ color: "#6D7175" }}>{p.dataKey === "storeTotal" ? "Store total" : "Attributed"}</span>
          <span style={{ fontWeight: 600, color: p.fill, fontVariantNumeric: "tabular-nums" }}>
            ${Number(p.value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      ))}
      {data?.isCurrentWeek && (
        <div style={{ marginTop: "6px", fontSize: "10px", color: "#6D7175", borderTop: "0.5px solid #F1F2F3", paddingTop: "5px" }}>
          Week in progress — totals will grow until {data?.weekEnd}
        </div>
      )}
    </div>
  );
}

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

export default function DashboardPage() {
  const { store, isNewInstall, metrics, topInfluencers, allInfluencers, topProduct, sankeyData, revenueTrend } = useLoaderData();
  const navigate = useNavigate();
  const { funnel } = metrics;

  const funnelStages = [
    { label: "Visitor sessions", value: funnel.visitors, color: "#E8854A" },
    { label: "Product views", value: funnel.productViews, color: "#D4692E" },
    { label: "Add to cart", value: funnel.addToCart, color: "#B8461A" },
    { label: "Checkout", value: funnel.checkoutStarted, color: "#9A3A15" },
    { label: "Purchased", value: funnel.purchased, color: "#7D2E10" },
  ];
  const maxFunnel = Math.max(...funnelStages.map((s) => s.value), 1);
  const totalVisitors = funnel.visitors || 0;
  const uniqueVisitors = funnel.uniqueVisitors || 0;

  const maxConvRate = Math.max(...allInfluencers.map((i) => parseFloat(i.convRate) || 0), 0.01);
  const enrichedAll = allInfluencers.map((inf) => ({
    ...inf,
    revPerSession: inf.visitors > 0 ? inf.revenue / inf.visitors : 0,
  }));
  const paidCandidate = enrichedAll.length > 0
    ? [...enrichedAll].sort((a, b) => b.revPerSession - a.revPerSession)[0]
    : null;

  const comparisonRows = allInfluencers.map((inf) => [
    inf.name,
    inf.platform,
    String(inf.visitors),
    String(inf.addToCart),
    String(inf.purchases),
    `${inf.convRate}%`,
    formatCurrency(inf.revenue),
    formatCurrency(inf.aov),
    inf.visitors > 0 ? "Active" : "Inactive",
  ]);

  return (
    <Page
      title="Dashboard"
      subtitle={store.shop}
      primaryAction={{ content: "New Campaign", onAction: () => navigate("/app/campaigns/new") }}
    >
      <ui-title-bar title="Winfluencer" />
      <Layout>
        {isNewInstall && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="headingMd" as="h2">Welcome to Winfluencer! 🎉</Text>
                    <Text as="p" tone="subdued">Complete these 4 steps to start tracking influencer sales.</Text>
                  </BlockStack>
                  <Badge tone="success">New install</Badge>
                </InlineStack>
                <Divider />
                <BlockStack gap="400">
                  {/* Step 1 */}
                  <InlineStack gap="300" blockAlign="start" wrap={false}>
                    <div style={{ width: "28px", height: "28px", borderRadius: "50%", backgroundColor: "#D1FAE5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Text as="p" fontWeight="bold" tone="success">✓</Text>
                    </div>
                    <BlockStack gap="050" inlineSize="fill">
                      <Text as="p" fontWeight="semibold">Store connected via OAuth</Text>
                      <Text as="p" tone="subdued" variant="bodySm">
                        Winfluencer is authenticated and linked to <strong>{store.shop}</strong>.
                      </Text>
                    </BlockStack>
                    <Badge tone="success">Done</Badge>
                  </InlineStack>

                  {/* Step 2 */}
                  <InlineStack gap="300" blockAlign="start" wrap={false}>
                    <div style={{ width: "28px", height: "28px", borderRadius: "50%", backgroundColor: "#D1FAE5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Text as="p" fontWeight="bold" tone="success">✓</Text>
                    </div>
                    <BlockStack gap="050" inlineSize="fill">
                      <Text as="p" fontWeight="semibold">Tracking pixel &amp; webhook installed</Text>
                      <Text as="p" tone="subdued" variant="bodySm">
                        Web pixel is active and capturing page views, add-to-cart, checkout, and purchase events. Order webhook is registered for server-side attribution.
                      </Text>
                    </BlockStack>
                    <Badge tone="success">Done</Badge>
                  </InlineStack>

                  {/* Step 3 — requires merchant action */}
                  <InlineStack gap="300" blockAlign="start" wrap={false}>
                    <div style={{ width: "28px", height: "28px", borderRadius: "50%", backgroundColor: "#FEF3C7", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Text as="p" fontWeight="bold">3</Text>
                    </div>
                    <BlockStack gap="200" inlineSize="fill">
                      <BlockStack gap="050">
                        <Text as="p" fontWeight="semibold">Enable the Winfluencer App Embed in your theme</Text>
                        <Text as="p" tone="subdued" variant="bodySm">
                          The App Embed Block enables first-party <code>wf_id</code> parameter capture on your storefront. Without it, influencer click attribution will not work.
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" fontWeight="semibold">How to enable:</Text>
                        <BlockStack gap="050">
                          <Text as="p" tone="subdued" variant="bodySm">1. Click <strong>"Open Theme Editor"</strong> below</Text>
                          <Text as="p" tone="subdued" variant="bodySm">2. In the left sidebar, click <strong>"App Embeds"</strong></Text>
                          <Text as="p" tone="subdued" variant="bodySm">3. Toggle on <strong>"Winfluencer"</strong></Text>
                          <Text as="p" tone="subdued" variant="bodySm">4. Click <strong>"Save"</strong> in the top right</Text>
                        </BlockStack>
                      </BlockStack>
                      <div>
                        <Button
                          url={`https://${store.shop}/admin/themes/current/editor?context=apps`}
                          external
                          variant="primary"
                        >
                          Open Theme Editor → App Embeds
                        </Button>
                      </div>
                    </BlockStack>
                    <Badge tone="attention">Action needed</Badge>
                  </InlineStack>

                  {/* Step 4 */}
                  <InlineStack gap="300" blockAlign="start" wrap={false}>
                    <div style={{ width: "28px", height: "28px", borderRadius: "50%", backgroundColor: "#F1F2F3", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Text as="p" fontWeight="bold">4</Text>
                    </div>
                    <BlockStack gap="100" inlineSize="fill">
                      <Text as="p" fontWeight="semibold">Create your first campaign</Text>
                      <Text as="p" tone="subdued" variant="bodySm">
                        Add your influencers and generate unique tracking links (<code>?wf_id=</code>). Share the links with influencers — every click, cart, and purchase will be attributed automatically.
                      </Text>
                      <div>
                        <Button url="/app/campaigns/new" variant="secondary">
                          Create your first campaign
                        </Button>
                      </div>
                    </BlockStack>
                    <Badge>Up next</Badge>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Metric cards */}
        <Layout.Section>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "14px" }}>
            <Card>
              <BlockStack gap="150">
                <Text as="p" tone="subdued">Attributed Revenue</Text>
                <Text variant="headingLg" as="p">{formatCurrency(metrics.totalRevenue)}</Text>
                <Text as="p" tone="subdued">influencer-driven sales</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="150">
                <Text as="p" tone="subdued">Visitor sessions</Text>
                <Text variant="headingLg" as="p">{totalVisitors.toLocaleString()}</Text>
                <Text as="p" tone="subdued">page views</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="150">
                <Text as="p" tone="subdued">Unique sessions</Text>
                <Text variant="headingLg" as="p" tone="success">{uniqueVisitors.toLocaleString()}</Text>
                <Text as="p" tone="subdued">distinct sessions</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="150">
                <Text as="p" tone="subdued">Avg Conversion</Text>
                <Text variant="headingLg" as="p">
                  {metrics.avgConversion ? `${metrics.avgConversion}%` : "—"}
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="150">
                <Text as="p" tone="subdued">Top Product</Text>
                <Text variant="headingMd" as="p">
                  {topProduct ? topProduct.title : "—"}
                </Text>
                {topProduct && (
                  <Text as="p" tone="subdued">
                    {topProduct.units} units &middot; {formatCurrency(topProduct.revenue)}
                  </Text>
                )}
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>

        {/* Paid amplification candidate callout */}
        {paidCandidate && paidCandidate.visitors > 0 && (
          <Layout.Section>
            <div style={{ background: "#FFF0E5", border: "0.5px solid #E8854A", borderRadius: "8px", padding: "13px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ width: "34px", height: "34px", background: "#E8854A", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M8 2L9.8 6.5L15 7.3L11.5 10.7L12.4 16L8 13.5L3.6 16L4.5 10.7L1 7.3L6.2 6.5L8 2Z" fill="white" stroke="white" strokeWidth="0.5" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: "10px", fontWeight: 600, color: "#B54708", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "3px" }}>
                    Top paid amplification candidate — this month
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: 600 }}>
                    {paidCandidate.name}{" "}
                    <span style={{ fontSize: "12px", fontWeight: 400, color: "#202223" }}>
                      · ${paidCandidate.revPerSession.toFixed(2)}/session · {paidCandidate.convRate}% conv. · {formatCurrency(paidCandidate.aov)} AOV
                    </span>
                  </div>
                  {paidCandidate.visitors < 30 && (
                    <div style={{ fontSize: "11px", color: "#6D7175", marginTop: "3px" }}>
                      ⚠ Based on {paidCandidate.visitors} sessions — validate at small scale before increasing budget
                    </div>
                  )}
                </div>
              </div>
              <Button url={`/app/campaigns/${paidCandidate.campaignId}`} variant="secondary">
                View campaign →
              </Button>
            </div>
          </Layout.Section>
        )}

        {/* Store revenue trend */}
        {revenueTrend.weeks.some((w) => w.storeTotal > 0 || w.attributed > 0) && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="headingSm" as="h2">Store revenue trend vs. attributed revenue</Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      Total Shopify orders (gray) alongside influencer-attributed revenue (orange) — each bar = one week · hover for date range
                    </Text>
                  </BlockStack>
                  <InlineStack gap="200">
                    <InlineStack gap="100" blockAlign="center"><div style={{ width: "10px", height: "10px", borderRadius: "2px", background: "#B0BEC5" }} /><Text as="p" variant="bodySm" tone="subdued">Store total</Text></InlineStack>
                    <InlineStack gap="100" blockAlign="center"><div style={{ width: "10px", height: "10px", borderRadius: "2px", background: "#E8854A" }} /><Text as="p" variant="bodySm" tone="subdued">Attributed</Text></InlineStack>
                    {revenueTrend.campaignLaunchWeek !== null && (
                      <InlineStack gap="100" blockAlign="center"><div style={{ width: "10px", height: "2px", background: "#2C6ECB" }} /><Text as="p" variant="bodySm" tone="subdued">Campaign launch</Text></InlineStack>
                    )}
                    <InlineStack gap="100" blockAlign="center"><div style={{ width: "10px", height: "10px", borderRadius: "2px", background: "#B0BEC5", opacity: 0.45 }} /><Text as="p" variant="bodySm" tone="subdued">Current week</Text></InlineStack>
                  </InlineStack>
                </InlineStack>

                {revenueTrend.campaignLaunchWeek !== null && (() => {
                  const hasStoreData = revenueTrend.weeks.some((w) => w.storeTotal > 0);
                  const totalAttributed = revenueTrend.weeks.reduce((s, w) => s + w.attributed, 0);
                  const postLaunchWeeks = revenueTrend.weeks.slice(revenueTrend.campaignLaunchWeek).filter((w) => w.attributed > 0);
                  const postLaunchAvg = postLaunchWeeks.length > 0
                    ? Math.round(postLaunchWeeks.reduce((s, w) => s + w.attributed, 0) / postLaunchWeeks.length)
                    : null;
                  const scorecards = hasStoreData
                    ? [
                        { label: "Avg. weekly revenue — before", value: revenueTrend.beforeAvg ? `$${revenueTrend.beforeAvg.toLocaleString()}` : "—", note: "pre-campaign baseline" },
                        { label: "Avg. weekly revenue — after", value: revenueTrend.afterAvg ? `$${revenueTrend.afterAvg.toLocaleString()}` : "—", note: revenueTrend.beforeAvg && revenueTrend.afterAvg ? `↑ +$${(revenueTrend.afterAvg - revenueTrend.beforeAvg).toLocaleString()}/week` : "since launch", positive: true },
                        { label: "Store revenue change", value: revenueTrend.pctChange !== null ? `${revenueTrend.pctChange > 0 ? "+" : ""}${revenueTrend.pctChange}%` : "—", note: "since campaign launch", accent: true },
                        { label: "Attribution penetration", value: revenueTrend.attributionPenetration !== null ? `${revenueTrend.attributionPenetration}%` : "—", note: "of post-launch revenue tracked", orange: true },
                      ]
                    : [
                        { label: "Total attributed revenue", value: `$${Math.round(totalAttributed).toLocaleString()}`, note: "influencer-driven sales", orange: true },
                        { label: "Avg. weekly attributed", value: postLaunchAvg ? `$${postLaunchAvg.toLocaleString()}` : "—", note: "post-launch avg per active week", positive: true },
                        { label: "Store baseline — before", value: "—", note: "awaiting store order data" },
                        { label: "Store lift vs baseline", value: "—", note: "awaiting store order data" },
                      ];
                  return (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
                      {scorecards.map((s) => (
                        <div key={s.label} style={{ background: "#F6F6F7", borderRadius: "8px", padding: "10px 12px" }}>
                          <div style={{ fontSize: "10px", color: "#6D7175", marginBottom: "4px" }}>{s.label}</div>
                          <div style={{ fontSize: "17px", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: s.accent ? "#008060" : s.orange ? "#E8854A" : undefined }}>{s.value}</div>
                          <div style={{ fontSize: "10px", color: s.positive ? "#008060" : "#6D7175", marginTop: "3px" }}>{s.note}</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                <div style={{ width: "100%", height: "200px" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={revenueTrend.weeks} margin={{ top: 5, right: 10, left: 0, bottom: 5 }} barGap={2} barCategoryGap="20%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F2F3" vertical={false} />
                      <XAxis dataKey="week" tick={{ fontSize: 9, fill: "#6D7175" }} tickLine={false} axisLine={false} interval={3} />
                      <YAxis tick={{ fontSize: 9, fill: "#6D7175" }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} width={38} />
                      <Tooltip content={<RevenueTooltip />} />
                      <Bar dataKey="storeTotal" radius={[2, 2, 0, 0]} fill="#B0BEC5"
                        label={false}
                        shape={(props) => {
                          const { x, y, width, height, payload } = props;
                          return <rect x={x} y={y} width={width} height={height} fill="#B0BEC5" opacity={payload.isCurrentWeek ? 0.45 : 1} rx={2} ry={2} />;
                        }}
                      />
                      <Bar dataKey="attributed" radius={[2, 2, 0, 0]} fill="#E8854A"
                        shape={(props) => {
                          const { x, y, width, height, payload } = props;
                          return <rect x={x} y={y} width={width} height={height} fill="#E8854A" opacity={payload.isCurrentWeek ? 0.45 : 1} rx={2} ry={2} />;
                        }}
                      />
                      {revenueTrend.campaignLaunchWeek !== null && revenueTrend.weeks[revenueTrend.campaignLaunchWeek] && (
                        <ReferenceLine
                          x={revenueTrend.weeks[revenueTrend.campaignLaunchWeek].week}
                          stroke="#2C6ECB"
                          strokeWidth={1.5}
                          strokeDasharray="4 3"
                          label={{ value: "Campaign launch", position: "insideTopLeft", fontSize: 9, fill: "#2C6ECB", dy: -4 }}
                        />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "11px", color: "#2C6ECB", lineHeight: "1.5", background: "#EBF0FB", border: "0.5px solid #2C6ECB", borderRadius: "6px", padding: "10px 13px" }}>
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0, marginTop: "1px" }}>
                    <circle cx="6.5" cy="6.5" r="6" stroke="currentColor" strokeWidth="1.1"/>
                    <path d="M6.5 5.5v3.5M6.5 4v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                  <span>This shows correlation, not causation. Seasonality and other marketing may also contribute — this is context for your decisions.</span>
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Funnel + Top influencers */}
        <Layout.Section>
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text variant="headingSm" as="h2">Conversion funnel</Text>
                      <Text as="p" tone="subdued">
                        {totalVisitors.toLocaleString()} visitor sessions
                      </Text>
                    </BlockStack>
                    <Badge tone="success">Live</Badge>
                  </InlineStack>
                  <Divider />
                  <BlockStack gap="300">
                    {funnelStages.map((stage, i) => {
                      const pct = totalVisitors > 0
                        ? ((stage.value / totalVisitors) * 100).toFixed(0)
                        : "0";
                      return (
                        <BlockStack gap="100" key={stage.label}>
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="p">{stage.label}</Text>
                            <InlineStack gap="200">
                              <Text as="p" fontWeight="semibold">{stage.value.toLocaleString()}</Text>
                              <Text as="p" tone="subdued">{pct}%</Text>
                            </InlineStack>
                          </InlineStack>
                          <div style={{ width: "100%", height: "8px", borderRadius: "4px", backgroundColor: "#F1F2F3" }}>
                            <div style={{
                              width: `${Math.round((stage.value / maxFunnel) * 100)}%`,
                              height: "100%",
                              borderRadius: "4px",
                              backgroundColor: stage.color,
                              transition: "width 0.3s ease",
                            }} />
                          </div>
                        </BlockStack>
                      );
                    })}
                  </BlockStack>
                </BlockStack>
              </Card>
            </Layout.Section>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingSm" as="h2">Top influencers</Text>
                  <Divider />
                  {topInfluencers.length === 0 ? (
                    <Text as="p" tone="subdued">No influencers yet</Text>
                  ) : (
                    <BlockStack gap="300">
                      {topInfluencers.map((inf) => (
                        <div
                          key={inf.id}
                          style={{ cursor: "pointer" }}
                          onClick={() => navigate(`/app/campaigns/${inf.campaignId}/influencers/${inf.id}`)}
                        >
                          <InlineStack align="space-between" blockAlign="center" wrap={false}>
                            <BlockStack gap="050">
                              <Text as="p" fontWeight="semibold">{inf.name}</Text>
                              <Text as="p" tone="subdued" variant="bodySm">@{inf.handle}</Text>
                            </BlockStack>
                            <BlockStack gap="050">
                              <Text as="p" fontWeight="semibold" alignment="end">
                                {formatCurrency(inf.revenue)}
                              </Text>
                              <Text as="p" tone="subdued" variant="bodySm" alignment="end">
                                {inf.convRate}% conv.
                              </Text>
                            </BlockStack>
                          </InlineStack>
                        </div>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        </Layout.Section>

        {/* Influencer journey flow (Sankey) */}
        {sankeyData.nodes.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="headingSm" as="h2">Influencer journey flow</Text>
                    <Text as="p" tone="subdued">
                      How influencer traffic flows through your funnel (last-touch attribution)
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

        {/* Influencer comparison table */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text variant="headingSm" as="h2">Influencer comparison</Text>
                  <Text as="p" tone="subdued">Click any row for full analytics</Text>
                </BlockStack>
              </InlineStack>
              <Divider />
              {comparisonRows.length === 0 ? (
                <EmptyState
                  heading="Create your first campaign"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <Text as="p" tone="subdued">
                    Launch your first campaign to start tracking influencer performance.
                  </Text>
                  <div style={{ marginTop: "12px" }}>
                    <Link to="/app/campaigns/new">
                      <Button variant="primary">Create campaign</Button>
                    </Link>
                  </div>
                </EmptyState>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #E1E3E5" }}>
                        {["Influencer", "Platform", "Visitor sessions", "Add to cart", "Purchases", "Conv. rate", "Revenue", "AOV", "Status"].map((h) => (
                          <th key={h} style={{ padding: "10px 12px", textAlign: h === "Influencer" || h === "Platform" || h === "Status" ? "left" : "right", fontSize: "13px", fontWeight: 600, color: "#6D7175" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {allInfluencers.map((inf) => (
                        <tr
                          key={inf.id}
                          onClick={() => navigate(`/app/campaigns/${inf.campaignId}/influencers/${inf.id}`)}
                          style={{ borderBottom: "1px solid #F1F2F3", cursor: "pointer" }}
                          onMouseOver={(e) => e.currentTarget.style.backgroundColor = "#FEF0EA"}
                          onMouseOut={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                        >
                          <td style={{ padding: "10px 12px", fontWeight: 500 }}>{inf.name}</td>
                          <td style={{ padding: "10px 12px" }}>{inf.platform}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right" }}>{inf.visitors}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right" }}>{inf.addToCart}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right" }}>{inf.purchases}</td>
                          <td style={{ padding: "10px 12px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "flex-end" }}>
                              <span style={{ fontVariantNumeric: "tabular-nums", color: convRateColor(parseFloat(inf.convRate)), fontWeight: 600, minWidth: "38px", textAlign: "right" }}>
                                {inf.convRate}%
                              </span>
                              <div style={{ width: "50px", height: "5px", backgroundColor: "#F1F2F3", borderRadius: "3px", overflow: "hidden" }}>
                                <div style={{ width: `${Math.round((parseFloat(inf.convRate) / maxConvRate) * 100)}%`, height: "100%", backgroundColor: convRateColor(parseFloat(inf.convRate)), borderRadius: "3px" }} />
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right" }}>{formatCurrency(inf.revenue)}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right" }}>{formatCurrency(inf.aov)}</td>
                          <td style={{ padding: "10px 12px" }}>
                            <span style={{
                              padding: "2px 8px",
                              borderRadius: "10px",
                              fontSize: "12px",
                              fontWeight: 500,
                              backgroundColor: inf.visitors > 0 ? "#D1FAE5" : "#F1F2F3",
                              color: inf.visitors > 0 ? "#065F46" : "#6D7175",
                            }}>
                              {inf.visitors > 0 ? "Active" : "Inactive"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
