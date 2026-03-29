import { useLoaderData, useNavigate } from "react-router";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  DataTable,
  Divider,
  InlineStack,
  Layout,
  Page,
  Text,
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
  const { getCampaignStats, getCampaignSankeyData, getProductIntelligence, computeSignal } = await import("../services/analytics.server");

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

  const [stats, sankeyData, products] = await Promise.all([
    getCampaignStats(campaign.id),
    getCampaignSankeyData(campaign.id),
    getProductIntelligence(store.id, { campaignId: campaign.id }),
  ]);

  // Get per-influencer stats
  const influencerIds = campaign.influencers.map((i) => i.id);

  const [eventGroups, orderGroups] = await Promise.all([
    db.event.groupBy({
      by: ["influencerId", "eventType"],
      where: { influencerId: { in: influencerIds.length > 0 ? influencerIds : ["none"] } },
      _count: true,
    }),
    db.order.groupBy({
      by: ["influencerId"],
      where: { influencerId: { in: influencerIds.length > 0 ? influencerIds : ["none"] } },
      _count: true,
      _sum: { totalPrice: true },
    }),
  ]);

  const eventMap = {};
  for (const g of eventGroups) {
    if (!g.influencerId) continue;
    if (!eventMap[g.influencerId]) eventMap[g.influencerId] = {};
    eventMap[g.influencerId][g.eventType] = g._count;
  }

  const orderMap = {};
  for (const g of orderGroups) {
    if (!g.influencerId) continue;
    orderMap[g.influencerId] = { count: g._count, revenue: g._sum.totalPrice ?? 0 };
  }

  const influencers = campaign.influencers.map((inf) => {
    const events = eventMap[inf.id] || {};
    const orders = orderMap[inf.id] || { count: 0, revenue: 0 };
    const visitors = (events["pageview"] || 0) + (events["page_viewed"] || 0);
    const cart = events["product_added_to_cart"] || 0;
    const convRate = visitors > 0 ? ((orders.count / visitors) * 100).toFixed(1) : "0.0";
    const aov = orders.count > 0 ? (orders.revenue / orders.count).toFixed(2) : "0.00";

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
      purchases: orders.count,
      purchasePct: cart > 0 ? ((orders.count / cart) * 100).toFixed(0) : "0",
      convRate: parseFloat(convRate),
      revenue: orders.revenue,
      aov: parseFloat(aov),
    };
  });

  return { campaign, stats, influencers, sankeyData, products };
};

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

export default function CampaignDetailPage() {
  const { campaign, stats, influencers, sankeyData, products } = useLoaderData();
  const navigate = useNavigate();

  const rows = influencers.map((inf) => [
    inf.name,
    `?wf_id=${inf.wfId}`,
    String(inf.visitors),
    `${inf.cart} (${inf.cartPct}%)`,
    `${inf.purchases} (${inf.purchasePct}%)`,
    `${inf.convRate}%`,
    formatCurrency(inf.revenue),
    formatCurrency(inf.aov),
    "View →",
  ]);

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
        {/* 5 metric cards */}
        <Layout.Section>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "14px" }}>
            <Card>
              <BlockStack gap="100">
                <Text as="p" tone="subdued" variant="bodySm">Total revenue</Text>
                <Text variant="headingLg" as="p">{formatCurrency(stats.totalRevenue)}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text as="p" tone="subdued" variant="bodySm">Visitors</Text>
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
          </div>
        </Layout.Section>

        {/* Influencer breakdown table */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingSm" as="h2">Influencer breakdown</Text>
                <Badge tone="attention">{influencers.length} influencers</Badge>
              </InlineStack>
              <Divider />
              <DataTable
                columnContentTypes={[
                  "text", "text", "numeric", "text", "text",
                  "numeric", "numeric", "numeric", "text",
                ]}
                headings={[
                  "Influencer", "Tracking link", "Visitors", "\u2192 Cart",
                  "\u2192 Purchase", "Conv. rate", "Revenue", "AOV", "",
                ]}
                rows={rows}
              />
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
