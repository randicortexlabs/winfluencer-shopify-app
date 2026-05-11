import { Link, Outlet, useLoaderData, useRouteError, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import { NavMenu } from "@shopify/app-bridge-react";
import { Banner, BlockStack, Text } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import "@shopify/polaris/build/esm/styles.css";

export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const { default: db } = await import("../db.server");

  const { session } = await authenticate.admin(request);

  const store = await db.store.findUnique({
    where: { shop: session.shop },
    select: { appEmbedEnabled: true, shop: true },
  });

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    appEmbedEnabled: store?.appEmbedEnabled ?? false,
    shop: session.shop,
  };
};

export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const { default: db } = await import("../db.server");

  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "dismissEmbedBanner") {
    await db.store.update({
      where: { shop: session.shop },
      data: { appEmbedEnabled: true },
    });
  }

  return { ok: true };
};

function AppLink({ url, children, ...rest }) {
  return (
    <Link to={url} {...rest}>
      {children}
    </Link>
  );
}

function AppEmbedBanner({ shop }) {
  const fetcher = useFetcher();
  const themeEditorUrl = `https://${shop}/admin/themes/current/editor?context=apps`;
  const isDismissing = fetcher.state !== "idle";

  return (
    <div style={{ padding: "16px 16px 0 16px" }}>
      <Banner
        title="Enable Winfluencer tracking in your theme"
        tone="warning"
        action={{
          content: "Open Theme Editor → App Embeds",
          url: themeEditorUrl,
          external: true,
        }}
        secondaryAction={{
          content: isDismissing ? "Saving..." : "I've enabled it ✓",
          onAction: () => {
            fetcher.submit(
              { intent: "dismissEmbedBanner" },
              { method: "post", action: "/app" }
            );
          },
        }}
        onDismiss={() => {
          fetcher.submit(
            { intent: "dismissEmbedBanner" },
            { method: "post", action: "/app" }
          );
        }}
      >
        <BlockStack gap="100">
          <Text as="p">
            Influencer click tracking won't work until you enable the App Embed Block in your theme. It only takes 30 seconds:
          </Text>
          <Text as="p">
            1. Click <strong>"Open Theme Editor → App Embeds"</strong> below
            &nbsp;&nbsp;→&nbsp;&nbsp;
            2. Toggle <strong>"Winfluencer"</strong> ON
            &nbsp;&nbsp;→&nbsp;&nbsp;
            3. Click <strong>"Save"</strong>
            &nbsp;&nbsp;→&nbsp;&nbsp;
            4. Click <strong>"I've enabled it ✓"</strong>
          </Text>
        </BlockStack>
      </Banner>
    </div>
  );
}

export default function App() {
  const { apiKey, appEmbedEnabled, shop } = useLoaderData();

  return (
    <ShopifyAppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={enTranslations} linkComponent={AppLink}>
        <NavMenu>
          <Link to="/app" rel="home">Dashboard</Link>
          <Link to="/app/campaigns">Campaigns</Link>
          <Link to="/app/products">Products</Link>
          <Link to="/app/settings">Settings</Link>
        </NavMenu>
        {!appEmbedEnabled && <AppEmbedBanner shop={shop} />}
        <Outlet />
      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

// Revalidate after actions (so banner dismissal works instantly)
// but skip on regular navigations for performance
export const shouldRevalidate = ({ actionResult }) => !!actionResult;

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
