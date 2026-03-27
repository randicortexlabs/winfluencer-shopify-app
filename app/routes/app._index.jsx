import { Link, useLoaderData, useNavigate } from "react-router";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  DataTable,
  Divider,
  EmptyState,
  InlineStack,
  Layout,
  Page,
  ProgressBar,
  Text,
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const { default: db } = await import("../db.server");
  // Theme snippet injection removed — using App Embed Block instead
  // Custom Pixel is managed by shopify app deploy, not programmatically
  const {
    getStoreOverviewMetrics,
    getTopInfluencers,
    getInfluencerComparison,
    getTopProduct,
  } = await import("../services/analytics.server");

  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const accessToken = session.accessToken;

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

  if (store) {
    const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    try {
      const webhookRes = await fetch(
        `https://${shop}/admin/api/2024-10/webhooks.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": accessToken,
          },
          body: JSON.stringify({
            webhook: {
              topic: "orders/create",
              address: `${appUrl}/api/webhooks/orders`,
              format: "json",
            },
          }),
        }
      );
      const bodyText = await webhookRes.text();
      console.log("[Winfluencer] webhook registration", webhookRes.ok ? "success" : "failure", webhookRes.status, webhookRes.ok ? "" : bodyText);
    } catch (e) {
      console.log("[Winfluencer] webhook registration failure", e);
    }
    console.log("[Winfluencer] first-install setup finished for", shop);
  }

  if (!store) throw new Response("Store not available", { status: 500 });

  const [metrics, topInfluencers, allInfluencers, topProduct] = await Promise.all([
    getStoreOverviewMetrics(store.id),
    getTopInfluencers(store.id, 5),
    getInfluencerComparison(store.id),
    getTopProduct(store.id),
  ]);

  return { store, isNewInstall, metrics, topInfluencers, allInfluencers, topProduct };
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

export default function DashboardPage() {
  const { store, isNewInstall, metrics, topInfluencers, allInfluencers, topProduct } = useLoaderData();
  const navigate = useNavigate();
  const { funnel } = metrics;

  const funnelStages = [
    { label: "Visitors", value: funnel.visitors, tone: "highlight" },
    { label: "Product views", value: funnel.productViews, tone: "highlight" },
    { label: "Add to cart", value: funnel.addToCart, tone: "primary" },
    { label: "Checkout", value: funnel.checkoutStarted, tone: "primary" },
    { label: "Purchased", value: funnel.purchased, tone: "success" },
  ];
  const maxFunnel = Math.max(...funnelStages.map((s) => s.value), 1);
  const totalVisitors = funnel.visitors || 0;
  const uniqueVisitors = funnel.uniqueVisitors || 0;

  const comparisonRows = allInfluencers.map((inf) => [
    inf.name,
    inf.platform,
    String(inf.visitors),
    String(inf.addToCart),
    String(inf.purchases),
    `${inf.convRate}%`,
    formatCurrency(inf.revenue),
    formatCurrency(inf.aov),
    inf.purchases > 0 ? "Active" : "Inactive",
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
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingSm" as="h2">Setup complete</Text>
                <Badge tone="success">New install</Badge>
              </InlineStack>
              <div style={{ marginTop: "12px" }}>
                <Text as="p" tone="subdued">
                  Winfluencer is connected to your store. Tracking snippet,
                  pixel, and order webhook were installed automatically.
                </Text>
              </div>
            </Card>
          </Layout.Section>
        )}

        {/* Metric cards */}
        <Layout.Section>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "14px" }}>
            <Card>
              <BlockStack gap="150">
                <Text as="p" tone="subdued">Total Revenue</Text>
                <Text variant="headingLg" as="p">{formatCurrency(metrics.totalRevenue)}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="150">
                <Text as="p" tone="subdued">Total Visitors</Text>
                <Text variant="headingLg" as="p">{totalVisitors.toLocaleString()}</Text>
                <Text as="p" tone="subdued">page views</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="150">
                <Text as="p" tone="subdued">Unique Visitors</Text>
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
                        {totalVisitors.toLocaleString()} total visitors
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
                          <ProgressBar
                            progress={Math.round((stage.value / maxFunnel) * 100)}
                            tone={stage.tone}
                          />
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
                <DataTable
                  columnContentTypes={[
                    "text", "text", "numeric", "numeric", "numeric",
                    "numeric", "numeric", "numeric", "text",
                  ]}
                  headings={[
                    "Influencer", "Platform", "Visitors", "Add to cart",
                    "Purchases", "Conv. rate", "Revenue", "AOV", "Status",
                  ]}
                  rows={comparisonRows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
