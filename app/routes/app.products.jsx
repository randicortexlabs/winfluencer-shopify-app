import { useLoaderData, useNavigate } from "react-router";
import {
  Badge,
  BlockStack,
  Card,
  DataTable,
  Divider,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useState } from "react";

function formatCurrency(val) {
  return `$${Number(val || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const { default: db } = await import("../db.server");
  const { getProductIntelligence } = await import("../services/analytics.server");

  const { session } = await authenticate.admin(request);
  const store = await db.store.findUnique({ where: { shop: session.shop } });
  if (!store) throw new Response("Store not found", { status: 404 });

  const url = new URL(request.url);
  const campaignFilter = url.searchParams.get("campaign") || null;

  const filters = campaignFilter ? { campaignId: campaignFilter } : {};
  const products = await getProductIntelligence(store.id, filters);

  // Compute aggregate metrics
  const totalProducts = products.length;
  const highestRate = products.reduce(
    (best, p) => (p.rate > best.rate ? p : best),
    { rate: 0, productTitle: "—", variantTitle: "" }
  );
  const frictionCount = products.filter((p) => p.signal === "Price friction").length;

  // Fetch campaigns for filter dropdown
  const campaigns = await db.campaign.findMany({
    where: { storeId: store.id },
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
  });

  // Get influencer names for display
  const influencerIds = [
    ...new Set(
      (
        await db.event.findMany({
          where: {
            storeId: store.id,
            eventType: "product_added_to_cart",
            influencerId: { not: null },
          },
          select: { influencerId: true },
          distinct: ["influencerId"],
        })
      ).map((e) => e.influencerId)
    ),
  ];

  const influencers = await db.influencer.findMany({
    where: { id: { in: influencerIds.length > 0 ? influencerIds : ["none"] } },
    select: { id: true, name: true },
  });

  const influencerMap = {};
  for (const inf of influencers) {
    influencerMap[inf.id] = inf.name;
  }

  return {
    products,
    totalProducts,
    highestRate: highestRate.rate > 0 ? highestRate : null,
    frictionCount,
    campaigns,
    campaignFilter,
    influencerMap,
  };
};

export default function ProductsPage() {
  const {
    products,
    totalProducts,
    highestRate,
    frictionCount,
    campaigns,
    campaignFilter,
  } = useLoaderData();
  const navigate = useNavigate();

  const campaignOptions = [
    { label: "All campaigns", value: "" },
    ...campaigns.map((c) => ({ label: c.name, value: c.id })),
  ];

  const handleCampaignChange = (value) => {
    if (value) {
      navigate(`/app/products?campaign=${value}`);
    } else {
      navigate("/app/products");
    }
  };

  const strongCount = products.filter((p) => p.signal === "Strong intent").length;
  const highConvertCount = products.filter((p) => p.signal === "High convert").length;

  const rows = products.map((p) => [
    p.productTitle,
    p.variantTitle,
    formatCurrency(p.price),
    String(p.carted),
    String(p.purchased),
    `${p.rate}%`,
    formatCurrency(p.revenue),
    p.signal,
  ]);

  return (
    <Page
      title="Product intelligence"
      subtitle="Variant-level cart and purchase data across all campaigns"
    >
      <ui-title-bar title="Products" />
      <Layout>
        {/* Metric cards */}
        <Layout.Section>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px" }}>
            <Card>
              <BlockStack gap="100">
                <Text as="p" tone="subdued" variant="bodySm">Products tracked</Text>
                <Text variant="headingLg" as="p">{totalProducts}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text as="p" tone="subdued" variant="bodySm">Highest cart→buy</Text>
                <Text variant="headingLg" as="p" tone="success">
                  {highestRate ? `${highestRate.rate}%` : "—"}
                </Text>
                {highestRate && (
                  <Text as="p" tone="subdued" variant="bodySm">
                    {highestRate.productTitle} / {highestRate.variantTitle}
                  </Text>
                )}
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text as="p" tone="subdued" variant="bodySm">Price friction signals</Text>
                <Text variant="headingLg" as="p" tone="critical">
                  {frictionCount}
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  Products need attention
                </Text>
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>

        {/* Products table */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingSm" as="h2">All products — cart vs purchase</Text>
                <InlineStack gap="200">
                  {strongCount > 0 && <Badge tone="success">{strongCount} strong</Badge>}
                  {frictionCount > 0 && <Badge tone="critical">{frictionCount} friction</Badge>}
                  {highConvertCount > 0 && <Badge tone="info">{highConvertCount} high convert</Badge>}
                </InlineStack>
              </InlineStack>
              <div style={{ maxWidth: "250px" }}>
                <Select
                  label="Filter by campaign"
                  labelHidden
                  options={campaignOptions}
                  onChange={handleCampaignChange}
                  value={campaignFilter || ""}
                />
              </div>
              <Divider />
              {rows.length > 0 ? (
                <DataTable
                  columnContentTypes={[
                    "text", "text", "numeric", "numeric",
                    "numeric", "numeric", "numeric", "text",
                  ]}
                  headings={[
                    "Product", "Variant", "Price", "Carted",
                    "Purchased", "Rate", "Revenue", "Signal",
                  ]}
                  rows={rows}
                />
              ) : (
                <Text as="p" tone="subdued">No product data yet. Products appear here once visitors add items to cart.</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
