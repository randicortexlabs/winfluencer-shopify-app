import { register } from "@shopify/web-pixels-extension";

register(({ analytics, init, settings, browser }) => {
  const ENDPOINT = "/apps/winfluencer/events";
  const pixelId = settings.pixelId || "";

  /**
   * Resolve wf_id from multiple sources (priority order):
   * 1. init.data.cart.attributes — available at pixel startup (cart attribute bridge)
   * 2. event.data.checkout.attributes — available during checkout events
   * 3. event.data.cart.attributes — available for cart events
   * 4. URL params from event context — landing page only
   */
  let cachedWfId = "";

  // Read wf_id from initial cart data (set by theme snippet via /cart/update.js)
  try {
    const cartAttrs = init?.data?.cart?.attributes || [];
    for (const attr of cartAttrs) {
      if (attr.key === "wf_influencer_id" && attr.value) {
        cachedWfId = attr.value;
        break;
      }
    }
  } catch (e) {
    // ignore
  }

  function resolveWfId(event) {
    // Use cached value if available
    if (cachedWfId) return cachedWfId;

    // Try checkout attributes
    try {
      const checkoutAttrs =
        event?.data?.checkout?.attributes ||
        event?.data?.checkout?.customAttributes ||
        [];
      for (const attr of checkoutAttrs) {
        if (attr.key === "wf_influencer_id" && attr.value) {
          cachedWfId = attr.value;
          return cachedWfId;
        }
      }
    } catch (e) {
      // ignore
    }

    // Try cart attributes
    try {
      const cartAttrs = event?.data?.cart?.attributes || [];
      for (const attr of cartAttrs) {
        if (attr.key === "wf_influencer_id" && attr.value) {
          cachedWfId = attr.value;
          return cachedWfId;
        }
      }
    } catch (e) {
      // ignore
    }

    // Try URL params from event context (landing page)
    try {
      const href = event?.context?.document?.location?.href || "";
      if (href.includes("wf_id=")) {
        const url = new URL(href);
        const wfId = url.searchParams.get("wf_id");
        if (wfId) {
          cachedWfId = wfId;
          return cachedWfId;
        }
      }
    } catch (e) {
      // ignore
    }

    return "";
  }

  function sendEvent(eventType, event, extra) {
    const wfId = resolveWfId(event);
    const payload = {
      event_type: eventType,
      wf_id: wfId,
      pixel_id: pixelId,
      page_url: "",
      product_id: null,
      product_title: null,
      variant_id: null,
      variant_title: null,
      price: null,
      quantity: null,
      ...extra,
    };

    // Get page URL from event context
    try {
      payload.page_url = event?.context?.document?.location?.href || "";
    } catch (e) {
      // ignore
    }

    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }

  // ─── PAGE VIEWED ────────────────────────────────────────────
  analytics.subscribe("page_viewed", (event) => {
    sendEvent("page_viewed", event);
  });

  // ─── PRODUCT VIEWED ─────────────────────────────────────────
  analytics.subscribe("product_viewed", (event) => {
    const pv = event?.data?.productVariant;
    sendEvent("product_viewed", event, {
      product_id: pv?.product?.id ? String(pv.product.id) : null,
      product_title: pv?.product?.title || null,
      variant_id: pv?.id ? String(pv.id) : null,
      variant_title: pv?.title || null,
      price: pv?.price?.amount != null ? Number(pv.price.amount) : null,
    });
  });

  // ─── PRODUCT ADDED TO CART ──────────────────────────────────
  analytics.subscribe("product_added_to_cart", (event) => {
    const cartLine = event?.data?.cartLine;
    const merchandise = cartLine?.merchandise;
    sendEvent("product_added_to_cart", event, {
      product_id: merchandise?.product?.id
        ? String(merchandise.product.id)
        : null,
      product_title: merchandise?.product?.title || null,
      variant_id: merchandise?.id ? String(merchandise.id) : null,
      variant_title: merchandise?.title || null,
      price:
        merchandise?.price?.amount != null
          ? Number(merchandise.price.amount)
          : null,
      quantity: cartLine?.quantity != null ? Number(cartLine.quantity) : null,
    });
  });

  // ─── CHECKOUT STARTED ───────────────────────────────────────
  analytics.subscribe("checkout_started", (event) => {
    const checkout = event?.data?.checkout;
    const lineItems = Array.isArray(checkout?.lineItems)
      ? checkout.lineItems.map((li) => ({
          title: li.title,
          quantity: li.quantity,
          variantId: li.variant?.id ? String(li.variant.id) : null,
          price: li.finalLinePrice?.amount ?? null,
        }))
      : [];

    sendEvent("checkout_started", event, {
      price:
        checkout?.totalPrice?.amount != null
          ? Number(checkout.totalPrice.amount)
          : null,
      quantity: lineItems.length,
      checkout_line_items: lineItems,
    });
  });

  // ─── CHECKOUT COMPLETED (PURCHASE) ──────────────────────────
  analytics.subscribe("checkout_completed", (event) => {
    const checkout = event?.data?.checkout;
    const order = checkout?.order;
    const lineItems = Array.isArray(checkout?.lineItems)
      ? checkout.lineItems.map((li) => ({
          title: li.title,
          quantity: li.quantity,
          variantId: li.variant?.id ? String(li.variant.id) : null,
          price: li.finalLinePrice?.amount ?? null,
        }))
      : [];

    const orderTotal =
      order?.totalPrice?.amount ?? checkout?.totalPrice?.amount;

    sendEvent("checkout_completed", event, {
      product_id: order?.id ? String(order.id) : null,
      price: orderTotal != null ? Number(orderTotal) : null,
      quantity: lineItems.length,
      checkout_line_items: lineItems,
    });
  });
});
