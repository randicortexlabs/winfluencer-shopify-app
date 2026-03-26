import { register } from "@shopify/web-pixels-extension";

register(({ analytics, settings }) => {
  const pixelId = settings.pixelId;
  const endpoint = "/apps/winfluencer/events";

  function getSessionId() {
    try {
      const k = "wf_session_id";
      let id = sessionStorage.getItem(k);
      if (!id) {
        id =
          "wf_" +
          Math.random().toString(36).slice(2) +
          "_" +
          Date.now().toString(36);
        sessionStorage.setItem(k, id);
      }
      return id;
    } catch {
      return "wf_unknown";
    }
  }

  /**
   * Extract wf_influencer_id from checkout attributes (cart attribute bridge).
   * The theme snippet writes wf_influencer_id to cart attributes via /cart/update.js.
   * Shopify passes these through as checkout.attributes in pixel events.
   */
  function wfFromCheckoutAttributes(event) {
    try {
      const attrs =
        event?.data?.checkout?.attributes ||
        event?.data?.checkout?.customAttributes ||
        [];
      for (let i = 0; i < attrs.length; i++) {
        if (
          attrs[i].key === "wf_influencer_id" ||
          attrs[i].key === "_wf_influencer_id"
        ) {
          return attrs[i].value || "";
        }
      }
    } catch {
      // ignore
    }
    return "";
  }

  /**
   * Try multiple sources to find wf_id:
   * 1. Checkout/cart attributes (most reliable in sandbox)
   * 2. URL parameters (if somehow available)
   */
  function resolveWfId(event) {
    // Try checkout attributes first (cart attribute bridge)
    const fromAttrs = wfFromCheckoutAttributes(event);
    if (fromAttrs) return fromAttrs;

    // Try init data / settings
    if (settings.wfId) return settings.wfId;

    return "";
  }

  function postEvent(eventType, event, extra) {
    const wfId = resolveWfId(event);
    const body = {
      event_type: eventType,
      wf_id: wfId,
      pixel_id: pixelId,
      session_id: getSessionId(),
      product_id: null,
      product_title: null,
      variant_id: null,
      variant_title: null,
      price: null,
      quantity: null,
      page_url: null,
      ...extra,
    };
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  }

  /*
   * NOTE: product_viewed and product_added_to_cart are now primarily
   * tracked by the theme snippet (which HAS localStorage access).
   * The pixel still subscribes as a backup, but wf_id may be empty
   * for these events since cart attributes aren't available in their context.
   */

  analytics.subscribe("product_viewed", (event) => {
    const pv = event.data?.productVariant;
    postEvent("product_viewed", event, {
      product_id: pv?.product?.id != null ? String(pv.product.id) : null,
      product_title: pv?.product?.title ?? null,
      variant_id: pv?.id != null ? String(pv.id) : null,
      variant_title: pv?.title ?? null,
      price: pv?.price?.amount != null ? Number(pv.price.amount) : null,
      quantity: null,
    });
  });

  analytics.subscribe("product_added_to_cart", (event) => {
    const cartLine = event.data?.cartLine;
    const m = cartLine?.merchandise;
    const qty = cartLine?.quantity;
    const price = m?.price?.amount;
    postEvent("product_added_to_cart", event, {
      product_id: m?.product?.id != null ? String(m.product.id) : null,
      product_title: m?.product?.title ?? null,
      variant_id: m?.id != null ? String(m.id) : null,
      variant_title: m?.title ?? null,
      price: price != null ? Number(price) : null,
      quantity: qty != null ? Number(qty) : null,
    });
  });

  /*
   * Checkout events — these CAN read wf_id from checkout.attributes
   * because Shopify passes cart attributes through to checkout context.
   * This is the "cart attribute bridge" in action.
   */

  analytics.subscribe("checkout_started", (event) => {
    const checkout = event.data?.checkout;
    const lineItems = Array.isArray(checkout?.lineItems)
      ? checkout.lineItems.map((li) => ({
          title: li.title,
          quantity: li.quantity,
          variantId: li.variant?.id,
          price: li.finalLinePrice?.amount ?? null,
        }))
      : [];
    const total = checkout?.totalPrice?.amount;
    postEvent("checkout_started", event, {
      price: total != null ? Number(total) : null,
      checkout_line_items: lineItems,
    });
  });

  analytics.subscribe("checkout_completed", (event) => {
    const checkout = event.data?.checkout;
    const order = checkout?.order;
    const lineItems = Array.isArray(checkout?.lineItems)
      ? checkout.lineItems.map((li) => ({
          title: li.title,
          quantity: li.quantity,
          variantId: li.variant?.id,
          price: li.finalLinePrice?.amount ?? null,
        }))
      : [];
    const orderTotal =
      order?.totalPrice?.amount ?? checkout?.totalPrice?.amount;
    postEvent("checkout_completed", event, {
      product_id: order?.id != null ? String(order.id) : null,
      price: orderTotal != null ? Number(orderTotal) : null,
      checkout_line_items: lineItems,
    });
  });
});
