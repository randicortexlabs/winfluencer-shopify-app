import { register } from "@shopify/web-pixels-extension";

register(({ analytics, init, browser }) => {
  /**
   * Winfluencer Custom Pixel
   * Subscribes to ALL Shopify Customer Events and sends data to our API.
   * Uses ABSOLUTE URL to avoid sandbox routing issues.
   *
   * wf_id resolution strategy (in priority order):
   * 1. Cached value (already found in a previous event)
   * 2. URL parameter ?wf_id= from the page URL
   * 3. Cart attributes from the event data
   * 4. Checkout attributes from the event data
   * 5. Init cart attributes (loaded at pixel startup)
   */

  const ENDPOINT = "https://winfluencer-shopify-app.vercel.app/api/events";

  /* ─── WF_ID CACHE ─── */
  let cachedWfId = "";
  let cartFetchDone = false;
  let pendingEvents = [];

  /* ─── Try init.data.cart.attributes at startup ─── */
  try {
    const cartAttrs = init?.data?.cart?.attributes || [];
    for (const attr of cartAttrs) {
      if (attr.key === "wf_influencer_id" && attr.value) {
        cachedWfId = attr.value;
        break;
      }
    }
  } catch (e) {}

  /* ─── Fetch /cart.js to get fresh cart attributes (most reliable) ─── */
  const shopOrigin = init?.data?.shop?.myshopifyDomain
    ? "https://" + init.data.shop.myshopifyDomain
    : "";

  if (!cachedWfId && shopOrigin) {
    fetch(shopOrigin + "/cart.js", { method: "GET", credentials: "include" })
      .then((r) => r.json())
      .then((cart) => {
        if (cart.attributes && cart.attributes.wf_influencer_id) {
          cachedWfId = cart.attributes.wf_influencer_id;
        }
        if (!sessionId && cart.token) {
          sessionId = cart.token;
        }
        cartFetchDone = true;
        // Flush any events that were waiting for wf_id
        pendingEvents.forEach((fn) => fn());
        pendingEvents = [];
      })
      .catch(() => {
        cartFetchDone = true;
        pendingEvents.forEach((fn) => fn());
        pendingEvents = [];
      });
  } else {
    cartFetchDone = true;
  }

  /* ─── RESOLVE WF_ID: multi-source, re-checks on every event ─── */
  function resolveWfId(event) {
    // 1. Return cached if we already have it
    if (cachedWfId) return cachedWfId;

    // 2. Parse from page URL (?wf_id= parameter)
    try {
      const href = event?.context?.document?.location?.href || "";
      if (href.includes("wf_id=")) {
        const url = new URL(href);
        const fromUrl = url.searchParams.get("wf_id");
        if (fromUrl) {
          cachedWfId = fromUrl;
          return cachedWfId;
        }
      }
    } catch (e) {}

    // 3. Try cart attributes from the event (updated on every event)
    try {
      const cartAttrs = event?.data?.cart?.attributes || [];
      for (const attr of cartAttrs) {
        if (attr.key === "wf_influencer_id" && attr.value) {
          cachedWfId = attr.value;
          return cachedWfId;
        }
      }
    } catch (e) {}

    // 4. Try checkout attributes
    try {
      const attrs = event?.data?.checkout?.attributes || [];
      for (const attr of attrs) {
        if (attr.key === "wf_influencer_id" && attr.value) {
          cachedWfId = attr.value;
          return cachedWfId;
        }
      }
    } catch (e) {}

    // 5. Re-check init cart attributes (in case they loaded late)
    try {
      const initAttrs = init?.data?.cart?.attributes || [];
      for (const attr of initAttrs) {
        if (attr.key === "wf_influencer_id" && attr.value) {
          cachedWfId = attr.value;
          return cachedWfId;
        }
      }
    } catch (e) {}

    return "";
  }

  /* ─── GET SHOP DOMAIN for store lookup ─── */
  const shopDomain = init?.data?.shop?.myshopifyDomain || "";

  /* ─── SESSION ID: try multiple sources ─── */
  let sessionId = "";
  // 1. Try cart token from init data
  try { sessionId = init?.data?.cart?.token || ""; } catch (e) {}
  // 2. Try checkout token
  if (!sessionId) { try { sessionId = init?.data?.checkout?.token || ""; } catch (e) {} }

  /* ─── SEND EVENT ─── */
  function sendEvent(payload) {
    payload.shop = shopDomain;
    // Always use latest sessionId (may have been updated by /cart.js fetch)
    payload.session_id = sessionId || "";
    // If cart fetch is still pending and we don't have wf_id yet, queue the event
    if (!cartFetchDone && !cachedWfId && !payload.wf_id) {
      pendingEvents.push(() => {
        payload.wf_id = cachedWfId || "";
        doSend(payload);
      });
      return;
    }
    doSend(payload);
  }

  function doSend(payload) {
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }

  /* ─── HELPER: extract product from productVariant ─── */
  function extractProduct(pv) {
    if (!pv) return {};
    return {
      product_id: pv.product?.id ? String(pv.product.id) : null,
      product_title: pv.product?.title || null,
      product_vendor: pv.product?.vendor || null,
      product_type: pv.product?.type || null,
      variant_id: pv.id ? String(pv.id) : null,
      variant_title: pv.title || null,
      price: pv.price?.amount ? Number(pv.price.amount) : null,
      currency: pv.price?.currencyCode || null,
    };
  }

  /* ─── HELPER: extract line items from checkout ─── */
  function extractLineItems(lineItems) {
    if (!lineItems) return [];
    return lineItems.map((item) => ({
      product_id: item.variant?.product?.id ? String(item.variant.product.id) : null,
      product_title: item.variant?.product?.title || null,
      variant_id: item.variant?.id ? String(item.variant.id) : null,
      variant_title: item.variant?.title || null,
      price: item.variant?.price?.amount ? Number(item.variant.price.amount) : null,
      quantity: item.quantity || 1,
    }));
  }

  /* ═══════════════════════════════════════════════
     ALL SHOPIFY CUSTOMER EVENTS
     ═══════════════════════════════════════════════ */

  /* ─── PAGE VIEWED ─── */
  analytics.subscribe("page_viewed", (event) => {
    sendEvent({
      event_type: "page_viewed",
      wf_id: resolveWfId(event),
      page_url: event?.context?.document?.location?.href || "",
      product_id: null,
      product_title: null,
      variant_id: null,
      variant_title: null,
      price: null,
      quantity: null,
    });
  });

  /* ─── PRODUCT VIEWED ─── */
  analytics.subscribe("product_viewed", (event) => {
    const product = extractProduct(event?.data?.productVariant);
    sendEvent({
      event_type: "product_viewed",
      wf_id: resolveWfId(event),
      page_url: event?.context?.document?.location?.href || "",
      ...product,
      quantity: null,
    });
  });

  /* ─── PRODUCT ADDED TO CART ─── */
  analytics.subscribe("product_added_to_cart", (event) => {
    const cartLine = event?.data?.cartLine;
    const product = extractProduct(cartLine?.merchandise);
    sendEvent({
      event_type: "product_added_to_cart",
      wf_id: resolveWfId(event),
      page_url: event?.context?.document?.location?.href || "",
      ...product,
      quantity: cartLine?.quantity || 1,
    });
  });

  /* ─── CART VIEWED ─── */
  analytics.subscribe("cart_viewed", (event) => {
    const cart = event?.data?.cart;
    sendEvent({
      event_type: "cart_viewed",
      wf_id: resolveWfId(event),
      page_url: event?.context?.document?.location?.href || "",
      product_id: null,
      product_title: null,
      variant_id: null,
      variant_title: null,
      price: cart?.cost?.totalAmount?.amount ? Number(cart.cost.totalAmount.amount) : null,
      quantity: cart?.lines?.length || null,
    });
  });

  /* ─── COLLECTION VIEWED ─── */
  analytics.subscribe("collection_viewed", (event) => {
    const collection = event?.data?.collection;
    sendEvent({
      event_type: "collection_viewed",
      wf_id: resolveWfId(event),
      page_url: event?.context?.document?.location?.href || "",
      product_id: collection?.id ? String(collection.id) : null,
      product_title: collection?.title || null,
      variant_id: null,
      variant_title: null,
      price: null,
      quantity: collection?.productVariants?.length || null,
    });
  });

  /* ─── SEARCH SUBMITTED ─── */
  analytics.subscribe("search_submitted", (event) => {
    sendEvent({
      event_type: "search_submitted",
      wf_id: resolveWfId(event),
      page_url: event?.context?.document?.location?.href || "",
      product_id: null,
      product_title: event?.data?.searchResult?.query || null,
      variant_id: null,
      variant_title: null,
      price: null,
      quantity: event?.data?.searchResult?.productVariants?.length || null,
    });
  });

  /* ─── CHECKOUT STARTED ─── */
  analytics.subscribe("checkout_started", (event) => {
    const checkout = event?.data?.checkout;
    const items = extractLineItems(checkout?.lineItems);
    const totalPrice = checkout?.totalPrice?.amount || 0;
    const shipping = checkout?.shippingLine?.price?.amount || 0;
    const tax = checkout?.totalTax?.amount || 0;

    sendEvent({
      event_type: "checkout_started",
      wf_id: resolveWfId(event),
      page_url: event?.context?.document?.location?.href || "",
      product_id: null,
      product_title: null,
      variant_id: null,
      variant_title: null,
      price: Number(totalPrice) - Number(shipping) - Number(tax),
      currency: checkout?.currencyCode || null,
      quantity: items.length,
      items,
    });
  });

  /* ─── CHECKOUT COMPLETED (PURCHASE) ─── */
  analytics.subscribe("checkout_completed", (event) => {
    const checkout = event?.data?.checkout;
    const order = checkout?.order;
    const items = extractLineItems(checkout?.lineItems);
    const totalPrice = checkout?.totalPrice?.amount || 0;
    const shipping = checkout?.shippingLine?.price?.amount || 0;
    const tax = checkout?.totalTax?.amount || 0;

    sendEvent({
      event_type: "checkout_completed",
      wf_id: resolveWfId(event),
      page_url: event?.context?.document?.location?.href || "",
      product_id: order?.id ? String(order.id) : null,
      product_title: null,
      variant_id: null,
      variant_title: null,
      price: Number(totalPrice) - Number(shipping) - Number(tax),
      currency: checkout?.currencyCode || null,
      quantity: items.length,
      transaction_id: order?.id ? String(order.id) : null,
      items,
    });
  });
});
