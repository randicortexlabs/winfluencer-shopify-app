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
    };
  });

  return { campaign, stats, influencers, sankeyData, products };
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

export default function CampaignDetailPage() {
  const { campaign, stats, influencers, sankeyData, products } = useLoaderData();
  const actionData = useActionData();
  const navigate = useNavigate();
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
          </div>
        </Layout.Section>

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
                      {["Influencer", "Tracking link", "Visitor sessions", "\u2192 Cart", "\u2192 Purchase", "Conv. rate", "Revenue", "AOV"].map((h) => (
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
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>{inf.convRate}%</td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>{formatCurrency(inf.revenue)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>{formatCurrency(inf.aov)}</td>
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
