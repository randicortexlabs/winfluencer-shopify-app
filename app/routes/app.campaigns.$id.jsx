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
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getCampaignStats, getTopInfluencers } from "../services/analytics.server";

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

  const stats = await getCampaignStats(campaign.id);

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
    const visitors = events["pageview"] || 0;
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

  return { campaign, stats, influencers };
};

export default function CampaignDetailPage() {
  const { campaign, stats, influencers } = useLoaderData();
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
      secondaryActions={[
        { content: "Generate links", onAction: () => {} },
      ]}
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
      </Layout>
    </Page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
