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
import { Sankey, Tooltip, Layer, Rectangle, Text as RText } from "recharts";

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
    getSankeyData,
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

  // orders/created webhook is registered declaratively in shopify.app.toml
  // No runtime REST registration needed — avoids duplicate webhooks and
  // deprecated API usage on every page load.

  if (!store) throw new Response("Store not available", { status: 500 });

  const [metrics, topInfluencers, allInfluencers, topProduct, sankeyData] = await Promise.all([
    getStoreOverviewMetrics(store.id),
    getTopInfluencers(store.id, 5),
    getInfluencerComparison(store.id),
    getTopProduct(store.id),
    getSankeyData(store.id),
  ]);

  return { store, isNewInstall, metrics, topInfluencers, allInfluencers, topProduct, sankeyData };
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
  const { store, isNewInstall, metrics, topInfluencers, allInfluencers, topProduct, sankeyData } = useLoaderData();
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
                <Text as="p" tone="subdued">Total Revenue</Text>
                <Text variant="headingLg" as="p">{formatCurrency(metrics.totalRevenue)}</Text>
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
                          <td style={{ padding: "10px 12px", textAlign: "right" }}>{inf.convRate}%</td>
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
