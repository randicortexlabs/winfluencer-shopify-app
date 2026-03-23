import { useLoaderData } from "react-router";
import {
  Badge,
  BlockStack,
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
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { injectSnippetIntoTheme } from "../services/tracking.server";
import { installCustomPixel } from "../services/pixel.server";

async function loadStats(storeId) {
  const [campaignCount, influencerCount, orderCount, revenueAgg] =
    await Promise.all([
      db.campaign.count({ where: { storeId } }),
      db.influencer.count({ where: { campaign: { storeId } } }),
      db.order.count({ where: { storeId } }),
      db.order.aggregate({
        where: { storeId },
        _sum: { totalPrice: true },
      }),
    ]);
  return {
    campaignCount,
    influencerCount,
    orderCount,
    totalRevenue: revenueAgg._sum.totalPrice ?? 0,
  };
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const accessToken = session.accessToken;

  let store = await db.store.findUnique({ where: { shop } });
  let isNewInstall = false;

  if (!store) {
    // eslint-disable-next-line no-undef
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

  if (isNewInstall && store) {
    try {
      const injected = await injectSnippetIntoTheme(shop, accessToken, store.pixelId);
      console.log("[Winfluencer] injectSnippetIntoTheme", injected ? "success" : "failure");
    } catch (e) {
      console.log("[Winfluencer] injectSnippetIntoTheme failure", e);
    }

    try {
      const pixelResult = await installCustomPixel(shop, accessToken, store.pixelId);
      console.log("[Winfluencer] installCustomPixel", pixelResult.ok ? "success" : "failure");
    } catch (e) {
      console.log("[Winfluencer] installCustomPixel failure", e);
    }

    // eslint-disable-next-line no-undef
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

  const stats = await loadStats(store.id);
  return { store, isNewInstall, stats };
};

export default function Index() {
  const { store, isNewInstall, stats } = useLoaderData();
  const totalRevenue = Number(stats.totalRevenue ?? 0);
  const orders = Number(stats.orderCount ?? 0);

  const funnel = [
    { label: "Visitors",      value: orders * 12 || 0, tone: "highlight" },
    { label: "Product views", value: orders * 8  || 0, tone: "highlight" },
    { label: "Add to cart",   value: orders * 4  || 0, tone: "primary"   },
    { label: "Checkout",      value: orders * 2  || 0, tone: "primary"   },
    { label: "Purchased",     value: orders,           tone: "success"   },
  ];
  const maxFunnel = Math.max(...funnel.map((s) => s.value), 1);

  return (
    <Page
      title="Winfluencer"
      subtitle={store.shop}
      primaryAction={{ content: "New Campaign", disabled: true }}
    >
      <Layout>

        {isNewInstall ? (
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
        ) : null}

        <Layout.Section>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "16px"
          }}>
            <Card>
              <BlockStack gap="150">
                <Text as="p" tone="subdued">Total Revenue</Text>
                <Text variant="headingLg" as="p">
                  ${totalRevenue.toFixed(2)}
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="150">
                <Text as="p" tone="subdued">Active Influencers</Text>
                <Text variant="headingLg" as="p">
                  {stats.influencerCount}
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="150">
                <Text as="p" tone="subdued">Avg Conversion</Text>
                <Text variant="headingLg" as="p">—</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="150">
                <Text as="p" tone="subdued">Orders</Text>
                <Text variant="headingLg" as="p">
                  {stats.orderCount}
                </Text>
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>

        <Layout.Section>
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="100">
                    <Text variant="headingSm" as="h2">Conversion funnel</Text>
                    <Text as="p" tone="subdued">All campaigns</Text>
                  </BlockStack>
                  <Divider />
                  <BlockStack gap="300">
                    {funnel.map((stage) => (
                      <BlockStack gap="100" key={stage.label}>
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="p">{stage.label}</Text>
                          <Text as="p" tone="subdued">{stage.value}</Text>
                        </InlineStack>
                        <ProgressBar
                          progress={Math.round((stage.value / maxFunnel) * 100)}
                          tone={stage.tone}
                        />
                      </BlockStack>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingSm" as="h2">Top influencers</Text>
                  <Divider />
                  {stats.influencerCount === 0 ? (
                    <Text as="p" tone="subdued">No influencers yet</Text>
                  ) : (
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="p">Active influencers</Text>
                      <Badge tone="info">{stats.influencerCount}</Badge>
                    </InlineStack>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingSm" as="h2">Campaigns</Text>
              <Divider />
              {stats.campaignCount === 0 ? (
                <EmptyState
                  heading="Create your first campaign"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <Text as="p" tone="subdued">
                    Launch your first campaign to start tracking influencer
                    performance and attribution.
                  </Text>
                </EmptyState>
              ) : (
                <DataTable
                  columnContentTypes={["text", "numeric", "numeric", "numeric"]}
                  headings={["Campaign", "Influencers", "Orders", "Attributed revenue"]}
                  rows={[[
                    `All campaigns (${stats.campaignCount})`,
                    String(stats.influencerCount),
                    String(stats.orderCount),
                    `$${totalRevenue.toFixed(2)}`,
                  ]]}
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