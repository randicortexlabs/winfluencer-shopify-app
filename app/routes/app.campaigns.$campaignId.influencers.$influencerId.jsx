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
  const { authenticate } = await import("../shopify.server");
  const { default: db } = await import("../db.server");
  const { getInfluencerStats, getProductIntelligence, getInfluencerRoleBreakdown, getRecentJourneys } = await import("../services/analytics.server");

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

  const [stats, products, roleBreakdown, recentJourneys] = await Promise.all([
    getInfluencerStats(influencer.id),
    getProductIntelligence(store.id, { influencerId: influencer.id }),
    getInfluencerRoleBreakdown(influencer.id),
    getRecentJourneys(influencer.id, 10),
  ]);

  const frictionProducts = products.filter((p) => p.signal === "Price friction");

  return {
    influencer,
    campaignId: params.campaignId,
    campaignName: influencer.campaign.name,
    stats,
    products,
    frictionProducts,
    roleBreakdown,
    recentJourneys,
  };
};

export default function InfluencerDetailPage() {
  const { influencer, campaignId, campaignName, stats, products, frictionProducts, roleBreakdown, recentJourneys } =
    useLoaderData();
  const navigate = useNavigate();
  const { funnel } = stats;

  const funnelStages = [
    { label: "Visitor sessions", value: funnel.visitors, tone: "highlight" },
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "14px" }}>
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
                <Text as="p" tone="subdued" variant="bodySm">Visitor sessions</Text>
                <Text variant="headingLg" as="p">{stats.visitors.toLocaleString()}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text as="p" tone="subdued" variant="bodySm">Unique sessions</Text>
                <Text variant="headingLg" as="p" tone="success">{stats.uniqueVisitors.toLocaleString()}</Text>
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

        {/* Journey Role Breakdown */}
        {roleBreakdown.total > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingSm" as="h2">Journey role</Text>
                  <Badge tone="info">{roleBreakdown.total} journeys</Badge>
                </InlineStack>
                <Text as="p" tone="subdued">
                  How often this influencer appears as the first, middle, or last touch in visitor journeys
                </Text>
                <Divider />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px", textAlign: "center" }}>
                  <BlockStack gap="100" inlineAlign="center">
                    <Text variant="headingLg" as="p" tone="warning">{roleBreakdown.introducerPct}%</Text>
                    <Text as="p" fontWeight="semibold">Introducer</Text>
                    <Text as="p" variant="bodySm" tone="subdued">{roleBreakdown.introducer} sessions</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Brought the visitor first time</Text>
                  </BlockStack>
                  <BlockStack gap="100" inlineAlign="center">
                    <Text variant="headingLg" as="p">{roleBreakdown.influencerPct}%</Text>
                    <Text as="p" fontWeight="semibold">Influencer</Text>
                    <Text as="p" variant="bodySm" tone="subdued">{roleBreakdown.influencer} sessions</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Middle of the journey</Text>
                  </BlockStack>
                  <BlockStack gap="100" inlineAlign="center">
                    <Text variant="headingLg" as="p" tone="success">{roleBreakdown.closerPct}%</Text>
                    <Text as="p" fontWeight="semibold">Closer</Text>
                    <Text as="p" variant="bodySm" tone="subdued">{roleBreakdown.closer} sessions</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Got the last click</Text>
                  </BlockStack>
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Recent Visitor Journeys */}
        {recentJourneys.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingSm" as="h2">Recent visitor journeys</Text>
                <Text as="p" tone="subdued">Multi-touch paths involving this influencer</Text>
                <Divider />
                <BlockStack gap="400">
                  {recentJourneys.map((j) => (
                    <div key={j.sessionId} style={{ padding: "8px 0", borderBottom: "1px solid #F1F2F3" }}>
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="200" wrap blockAlign="center">
                          {j.touches.map((t, i) => (
                            <span key={t.wfId} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                              {i > 0 && <span style={{ color: "#8C9196", fontSize: "14px" }}>&rarr;</span>}
                              <span style={{
                                padding: "3px 10px",
                                borderRadius: "12px",
                                fontSize: "12px",
                                fontWeight: t.isCurrentInfluencer ? 600 : 400,
                                backgroundColor: t.isCurrentInfluencer ? "#FEF0EA" : "#F1F2F3",
                                color: t.isCurrentInfluencer ? "#B8461A" : "#303030",
                                border: t.isCurrentInfluencer ? "1px solid #E8854A" : "1px solid transparent",
                              }}>
                                {t.influencerName}
                              </span>
                            </span>
                          ))}
                        </InlineStack>
                        <Badge tone={j.converted ? "success" : undefined}>
                          {j.converted ? "Purchased" : "Browsed"}
                        </Badge>
                      </InlineStack>
                    </div>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Funnel + Revenue breakdown */}
        <Layout.Section>
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="100">
                    <Text variant="headingSm" as="h2">Conversion funnel</Text>
                    <Text as="p" tone="subdued">
                      {totalVisitors.toLocaleString()} visitor sessions &middot; {stats.convRate}% overall conversion
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
