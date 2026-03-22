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

  function wfFromStorage() {
    try {
      return localStorage.getItem("wf_id") || "";
    } catch {
      return "";
    }
  }

  function pageHref() {
    try {
      return document.location.href;
    } catch {
      return null;
    }
  }

  function postEvent(payload) {
    const body = {
      ...payload,
      wf_id: wfFromStorage(),
      pixel_id: pixelId,
      session_id: getSessionId(),
    };
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  }

  analytics.subscribe("product_added_to_cart", (event) => {
    const cartLine = event.data?.cartLine;
    const m = cartLine?.merchandise;
    const qty = cartLine?.quantity;
    const price = m?.price?.amount;
    postEvent({
      event_type: "product_added_to_cart",
      product_id: m?.product?.id != null ? String(m.product.id) : null,
      product_title: m?.product?.title ?? null,
      variant_id: m?.id != null ? String(m.id) : null,
      variant_title: m?.title ?? null,
      price: price != null ? Number(price) : null,
      quantity: qty != null ? Number(qty) : null,
      page_url: pageHref(),
    });
  });

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
    postEvent({
      event_type: "checkout_started",
      product_id: null,
      product_title: null,
      variant_id: null,
      variant_title: null,
      price: total != null ? Number(total) : null,
      quantity: null,
      page_url: pageHref(),
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
    const orderTotal = order?.totalPrice?.amount ?? checkout?.totalPrice?.amount;
    postEvent({
      event_type: "checkout_completed",
      product_id: order?.id != null ? String(order.id) : null,
      product_title: null,
      variant_id: null,
      variant_title: null,
      price: orderTotal != null ? Number(orderTotal) : null,
      quantity: null,
      page_url: pageHref(),
      checkout_line_items: lineItems,
    });
  });
});
