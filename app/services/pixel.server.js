// Customer-event subscriptions live in extensions/winfluencer-pixel; this activates that extension.
const ADMIN_GRAPHQL = "2024-10";

function normalizeShopDomain(shop) {
  const s = String(shop || "").trim();
  if (!s) {
    return "";
  }
  return s.includes(".") ? s : `${s}.myshopify.com`;
}

const WEB_PIXEL_CREATE = `#graphql
  mutation webPixelCreate($webPixel: WebPixelInput!) {
    webPixelCreate(webPixel: $webPixel) {
      userErrors {
        field
        message
        code
      }
      webPixel {
        id
        settings
      }
    }
  }
`;

/**
 * Activates the app's web pixel extension via Admin GraphQL (webPixelCreate).
 * Settings must match the web pixel extension schema (e.g. pixelId in shopify.extension.toml).
 */
export async function installCustomPixel(shop, accessToken, pixelId) {
  const domain = normalizeShopDomain(shop);
  if (!domain || !accessToken || !pixelId) {
    return { ok: false, errors: [{ message: "Missing shop, token, or pixelId" }] };
  }

  const url = `https://${domain}/admin/api/${ADMIN_GRAPHQL}/graphql.json`;
  const settingsPayload = JSON.stringify({ pixelId: String(pixelId) });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query: WEB_PIXEL_CREATE,
        variables: {
          webPixel: {
            settings: settingsPayload,
          },
        },
      }),
    });

    const json = await res.json().catch(() => ({}));
    const payload = json.data?.webPixelCreate;
    const userErrors = payload?.userErrors ?? json.errors ?? [];

    if (!res.ok || (userErrors && userErrors.length > 0)) {
      console.error("[installCustomPixel] webPixelCreate failed:", json);
      return { ok: false, errors: userErrors, data: payload };
    }

    return { ok: true, webPixel: payload?.webPixel };
  } catch (err) {
    console.error("[installCustomPixel]", err);
    return { ok: false, errors: [{ message: String(err) }] };
  }
}
