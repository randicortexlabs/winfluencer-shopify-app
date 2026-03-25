import { useLoaderData, useNavigate } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  DataTable,
  Divider,
  InlineStack,
  Layout,
  Page,
  ProgressBar,
  Text,
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  getInfluencerStats,
  getProductIntelligence,
} from "../services/analytics.server";

function formatCurrency(val) {
  return `$${Number(val || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signalTone(signal) {
  if (signal === "Strong intent") return "success";
  if (signal === "High convert") return "info";
  if (signal === "Price friction") return "critical";
  return undefined;
}

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const store = await db.store.findUnique({ where: { shop: session.shop } });
  if (!store) throw new Response("Store not found", { status: 404 });

  const influencer = await db.influencer.findUnique({
    where: { id: params.influencerId },
    include: {
      campaign: { include: { store: { select: { shop: true } } } },
    },
  });

  if (!influencer || influencer.campaign.store.shop !== session.shop) {
    throw new Response("Influencer not found", { status: 404 });
  }

  const [stats, products] = await Promise.all([
    getInfluencerStats(influencer.id),
    getProductIntelligence(store.id, { influencerId: influencer.id }),
  ]);

  const frictionProducts = products.filter((p) => p.signal === "Price friction");

  return {
    influencer,
    campaignId: params.campaignId,
    campaignName: influencer.campaign.name,
    stats,
    products,
    frictionProducts,
  };
};

export default function InfluencerDetailPage() {
  const { influencer, campaignId, campaignName, stats, products, frictionProducts } =
    useLoaderData();
  const navigate = useNavigate();
  const { funnel } = stats;

  const funnelStages = [
    { label: "Visitors", value: funnel.visitors, tone: "highlight" },
    { label: "Product views", value: funnel.productViews, tone: "highlight" },
    { label: "Add to cart", value: funnel.addToCart, tone: "primary" },
    { label: "Checkout", value: funnel.checkoutStarted, tone: "primary" },
    { label: "Purchased", value: funnel.purchased, tone: "success" },
  ];
  const maxFunnel = Math.max(...funnelStages.map((s) => s.value), 1);
  const totalVisitors = funnel.visitors || 0;

  const productRows = products.map((p) => [
    p.productTitle,
    p.variantTitle,
    formatCurrency(p.price),
    String(p.carted),
    String(p.purchased),
    `${p.rate}%`,
    formatCurrency(p.revenue),
    p.signal,
  ]);

  const initials = influencer.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const revenuePerVisitor =
    totalVisitors > 0 ? (stats.revenue / totalVisitors).toFixed(2) : "0.00";

  const topProductName =
    products.length > 0
      ? products.sort((a, b) => b.revenue - a.revenue)[0]?.productTitle
      : "—";

  return (
    <Page
      title={influencer.name}
      backAction={{ url: `/app/campaigns/${campaignId}` }}
      titleMetadata={
        <InlineStack gap="200">
          <Badge tone="attention">{influencer.platform}</Badge>
          <Badge tone="success">Active</Badge>
        </InlineStack>
      }
      subtitle={`@${influencer.handle}`}
    >
      <ui-title-bar title={influencer.name}>
        <button onClick={() => navigate(`/app/campaigns/${campaignId}`)}>Back</button>
      </ui-title-bar>
      <Layout>
        {/* Stats row */}
        <Layout.Section>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "14px" }}>
            <Card>
              <BlockStack gap="100">
                <Text as="p" tone="subdued" variant="bodySm">Revenue</Text>
                <Text variant="headingLg" as="p">{formatCurrency(stats.revenue)}</Text>
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
                <Text as="p" tone="subdued" variant="bodySm">AOV</Text>
                <Text variant="headingLg" as="p">{formatCurrency(stats.aov)}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text as="p" tone="subdued" variant="bodySm">Visitors</Text>
                <Text variant="headingLg" as="p">{stats.visitors.toLocaleString()}</Text>
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>

        {/* Tracking link */}
        <Layout.Section>
          <Card>
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="p" tone="subdued" variant="bodySm">Tracking link</Text>
                <Text as="p" fontWeight="semibold" variant="bodyMd">
                  {influencer.trackingUrl || `?wf_id=${influencer.wfId}`}
                </Text>
              </BlockStack>
              <Button
                variant="plain"
                onClick={() => {
                  navigator.clipboard.writeText(
                    influencer.trackingUrl || `?wf_id=${influencer.wfId}`
                  );
                }}
              >
                Copy link
              </Button>
            </InlineStack>
          </Card>
        </Layout.Section>

        {/* Funnel + Revenue breakdown */}
        <Layout.Section>
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="100">
                    <Text variant="headingSm" as="h2">Conversion funnel</Text>
                    <Text as="p" tone="subdued">
                      {totalVisitors.toLocaleString()} visitors &middot; {stats.convRate}% overall conversion
                    </Text>
                  </BlockStack>
                  <Divider />
                  <BlockStack gap="300">
                    {funnelStages.map((stage) => {
                      const pct =
                        totalVisitors > 0
                          ? ((stage.value / totalVisitors) * 100).toFixed(0)
                          : "0";
                      return (
                        <BlockStack gap="100" key={stage.label}>
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="p">{stage.label}</Text>
                            <InlineStack gap="200">
                              <Text as="p" fontWeight="semibold">
                                {stage.value.toLocaleString()}
                              </Text>
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
                  <Text variant="headingSm" as="h2">Revenue breakdown</Text>
                  <Divider />
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="p" tone="subdued">Total revenue</Text>
                      <Text as="p" fontWeight="semibold">{formatCurrency(stats.revenue)}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="p" tone="subdued">Avg order value</Text>
                      <Text as="p" fontWeight="semibold">{formatCurrency(stats.aov)}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="p" tone="subdued">Revenue / visitor</Text>
                      <Text as="p" fontWeight="semibold">${revenuePerVisitor}</Text>
                    </InlineStack>
                    <Divider />
                    <InlineStack align="space-between">
                      <Text as="p" tone="subdued">Top product</Text>
                      <Text as="p" fontWeight="bold">{topProductName}</Text>
                    </InlineStack>
                    {frictionProducts.length > 0 && (
                      <InlineStack align="space-between">
                        <Text as="p" tone="critical">Price friction</Text>
                        <Text as="p" fontWeight="bold" tone="critical">
                          {frictionProducts[0].productTitle}
                        </Text>
                      </InlineStack>
                    )}
                  </BlockStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        </Layout.Section>

        {/* Product intelligence */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text variant="headingSm" as="h2">Product intelligence</Text>
                  <Text as="p" tone="subdued">
                    Cart intent vs confirmed purchase — per variant
                  </Text>
                </BlockStack>
                <Badge tone="info">{products.length} products tracked</Badge>
              </InlineStack>
              <Divider />
              {products.length > 0 ? (
                <DataTable
                  columnContentTypes={[
                    "text", "text", "numeric", "numeric",
                    "numeric", "numeric", "numeric", "text",
                  ]}
                  headings={[
                    "Product", "Variant", "Price", "Carted",
                    "Purchased", "Cart\u2192Buy rate", "Revenue", "Signal",
                  ]}
                  rows={productRows}
                />
              ) : (
                <Text as="p" tone="subdued">No product data yet</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Price friction alert */}
        {frictionProducts.length > 0 && (
          <Layout.Section>
            <Banner tone="warning" title="Price friction detected">
              <BlockStack gap="100">
                {frictionProducts.map((p) => (
                  <Text as="p" key={p.variantId || p.productId}>
                    <strong>{p.productTitle}</strong>: {p.carted} add-to-cart events but only{" "}
                    {p.purchased} purchases ({p.rate}%). Consider an exclusive bundle or
                    time-limited discount for this influencer&rsquo;s audience.
                  </Text>
                ))}
              </BlockStack>
            </Banner>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
