import { useLoaderData } from "react-router";
import { Page, Card, Layout, Text, Badge } from "@shopify/polaris";
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

  return (
    <Page title="Winfluencer" subtitle={store.shop}>
      <Layout>
        <Layout.Section>
          {isNewInstall ? (
            <Card>
              <Text variant="headingMd" as="h2">Setup complete</Text>
              <Text as="p" tone="subdued">
                Winfluencer is connected. Tracking snippet, pixel, and order
                webhook were installed automatically.
              </Text>
              <div style={{ marginTop: "0.75rem" }}>
                <Badge tone="success">Ready</Badge>
              </div>
            </Card>
          ) : (
            <Card>
              <Text variant="headingMd" as="h2">Dashboard</Text>
              <Text as="p" tone="subdued">Store: {store.shop}</Text>
              <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
                <Text as="p"><strong>Campaigns:</strong> {stats.campaignCount}</Text>
                <Text as="p"><strong>Influencers:</strong> {stats.influencerCount}</Text>
                <Text as="p"><strong>Orders:</strong> {stats.orderCount}</Text>
                <Text as="p"><strong>Revenue:</strong> ${Number(stats.totalRevenue).toFixed(2)}</Text>
              </div>
            </Card>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);