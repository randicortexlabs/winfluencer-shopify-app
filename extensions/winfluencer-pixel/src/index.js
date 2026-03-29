import { register } from "@shopify/web-pixels-extension";

register(({ analytics, init, browser }) => {
  /**
   * Winfluencer Custom Pixel
   *
   * ARCHITECTURE: All events are queued until async initialization completes.
   * This ensures wf_id and sessionId are resolved from localStorage BEFORE
   * any events are sent. Without this, the async browser.localStorage calls
   * would not resolve in time and events would be sent with empty values.
   *
   * wf_id resolution (in priority order):
   * 1. browser.localStorage "wf_id" (set by App Embed Block on storefront)
   * 2. init.data.cart.attributes "wf_influencer_id"
   * 3. URL parameter ?wf_id= from the page URL (per-event)
   * 4. Event cart/checkout attributes (per-event)
   *
   * sessionId resolution:
   * 1. browser.localStorage "wf_session_id" (persisted across pages)
   * 2. init.data.cart.token
   * 3. init.data.checkout.token
   * 4. cart attributes "wf_session_id"
   * 5. Generate random + persist to localStorage
   */

  const ENDPOINT = "https://winfluencer-shopify-app.vercel.app/api/events";
  const shopDomain = init?.data?.shop?.myshopifyDomain || "";

  /* ─── STATE ─── */
  let cachedWfId = "";
  let sessionId = "";
  let ready = false;
  let pendingEvents = [];

  /* ─── EXPIRATION CONSTANTS ─── */
  const SESSION_TTL = 30 * 60 * 1000;        // 30 minutes of inactivity
  const WF_ID_TTL = 90 * 24 * 60 * 60 * 1000; // 90 days attribution window

  /* ─── HELPER: check if a stored timestamp has expired ─── */
  function isExpired(storedTimestamp, ttl) {
    // If no timestamp saved, treat as NOT expired (be safe, keep the value)
    if (!storedTimestamp) return false;
    return (Date.now() - Number(storedTimestamp)) > ttl;
  }

  /* ─── ASYNC INITIALIZATION ─── */
  async function initialize() {

    // ─── WF_ID (90-day expiry) ───

    // 1. Try browser.localStorage for wf_id + check expiry
    try {
      const val = await browser.localStorage.getItem("wf_id");
      const ts = await browser.localStorage.getItem("wf_id_ts");
      if (val && !isExpired(ts, WF_ID_TTL)) {
        cachedWfId = val;
        // Ensure timestamp exists (fix missing ts from older saves)
        if (!ts) {
          await browser.localStorage.setItem("wf_id_ts", String(Date.now()));
        }
      } else if (val && isExpired(ts, WF_ID_TTL)) {
        // Genuinely expired (has timestamp and it's > 90 days) — clear it
        await browser.localStorage.removeItem("wf_id");
        await browser.localStorage.removeItem("wf_id_ts");
      }
    } catch (e) {}

    // 2. If not in localStorage, try init.data.cart.attributes
    if (!cachedWfId) {
      try {
        const cartAttrs = init?.data?.cart?.attributes || [];
        for (const attr of cartAttrs) {
          if (attr.key === "wf_influencer_id" && attr.value) {
            cachedWfId = attr.value;
            break;
          }
        }
      } catch (e) {}
    }

    // 3. If wf_id was found from any source, persist it properly with await
    if (cachedWfId) {
      try {
        await browser.localStorage.setItem("wf_id", cachedWfId);
        // Only set timestamp if not already set (don't reset the 90-day clock)
        const existingTs = await browser.localStorage.getItem("wf_id_ts");
        if (!existingTs) {
          await browser.localStorage.setItem("wf_id_ts", String(Date.now()));
        }
      } catch (e) {}
    }

    // ─── SESSION ID (30-min inactivity expiry) ───

    // 1. Try browser.localStorage for persisted session ID + check expiry
    try {
      const val = await browser.localStorage.getItem("wf_session_id");
      const ts = await browser.localStorage.getItem("wf_session_ts");
      if (val && !isExpired(ts, SESSION_TTL)) {
        sessionId = val;
      } else {
        // Expired or missing — clear for fresh generation
        await browser.localStorage.removeItem("wf_session_id");
        await browser.localStorage.removeItem("wf_session_ts");
      }
    } catch (e) {}

    // 2. Try cart token from init data
    if (!sessionId) {
      try { sessionId = init?.data?.cart?.token || ""; } catch (e) {}
    }

    // 3. Try checkout token
    if (!sessionId) {
      try { sessionId = init?.data?.checkout?.token || ""; } catch (e) {}
    }

    // 4. Try wf_session_id from cart attributes
    if (!sessionId) {
      try {
        const cartAttrs = init?.data?.cart?.attributes || [];
        for (const attr of cartAttrs) {
          if (attr.key === "wf_session_id" && attr.value) {
            sessionId = attr.value;
            break;
          }
        }
      } catch (e) {}
    }

    // 5. Generate random session ID as last resort
    if (!sessionId) {
      sessionId = "wf_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 10);
    }

    // Persist sessionId + update last-activity timestamp (awaited!)
    try {
      await browser.localStorage.setItem("wf_session_id", sessionId);
      await browser.localStorage.setItem("wf_session_ts", String(Date.now()));
    } catch (e) {}

    // Mark ready and flush queued events
    ready = true;
    for (const fn of pendingEvents) fn();
    pendingEvents = [];
  }

  initialize();

  /* ─── PERSIST WF_ID to sandbox localStorage with timestamp ─── */
  async function persistWfId(value) {
    if (!value) return;
    cachedWfId = value;
    try {
      await browser.localStorage.setItem("wf_id", value);
      // Only set timestamp if not already set (don't reset the 90-day clock on every page)
      const existingTs = await browser.localStorage.getItem("wf_id_ts");
      if (!existingTs) {
        await browser.localStorage.setItem("wf_id_ts", String(Date.now()));
      }
    } catch (e) {}
  }

  /* ─── RESOLVE WF_ID: re-checks per-event sources ─── */
  function resolveWfId(event) {
    if (cachedWfId) return cachedWfId;

    // Try URL parameter ?wf_id=
    try {
      const href = event?.context?.document?.location?.href || "";
      if (href.includes("wf_id=")) {
        const url = new URL(href);
        const fromUrl = url.searchParams.get("wf_id");
        if (fromUrl) {
          persistWfId(fromUrl);
          return cachedWfId;
        }
      }
    } catch (e) {}

    // Try cart attributes from event data
    try {
      const cartAttrs = event?.data?.cart?.attributes || [];
      for (const attr of cartAttrs) {
        if (attr.key === "wf_influencer_id" && attr.value) {
          persistWfId(attr.value);
        }
      }
      if (cachedWfId) return cachedWfId;
    } catch (e) {}

    // Try checkout attributes
    try {
      const attrs = event?.data?.checkout?.attributes || [];
      for (const attr of attrs) {
        if (attr.key === "wf_influencer_id" && attr.value) {
          persistWfId(attr.value);
          return cachedWfId;
        }
      }
    } catch (e) {}

    return "";
  }

  /* ─── SEND EVENT (queues until ready) ─── */
  function sendEvent(payload) {
    if (!ready) {
      pendingEvents.push(() => doSend(payload));
      return;
    }
    doSend(payload);
  }

  function doSend(payload) {
    payload.shop = shopDomain;
    payload.session_id = sessionId || "";
    // Re-resolve wf_id in case it was found after initial queue
    if (!payload.wf_id && cachedWfId) payload.wf_id = cachedWfId;

    // Update last-activity timestamp (resets the 30-min inactivity timer)
    try {
      browser.localStorage.setItem("wf_session_ts", String(Date.now())).catch(() => {});
    } catch (e) {}

    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }

  /* ─── HELPERS ─── */
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
     EVENT SUBSCRIPTIONS
     ═══════════════════════════════════════════════ */

  analytics.subscribe("page_viewed", (event) => {
    sendEvent({
      event_type: "page_viewed",
      wf_id: resolveWfId(event),
      page_url: event?.context?.document?.location?.href || "",
      product_id: null, product_title: null,
      variant_id: null, variant_title: null,
      price: null, quantity: null,
    });
  });

  analytics.subscribe("product_viewed", (event) => {
    const product = extractProduct(event?.data?.productVariant);
    sendEvent({
      event_type: "product_viewed",
      wf_id: resolveWfId(event),
      page_url: event?.context?.document?.location?.href || "",
      ...product, quantity: null,
    });
  });

  analytics.subscribe("product_added_to_cart", (event) => {
    const cartLine = event?.data?.cartLine;
    const product = extractProduct(cartLine?.merchandise);
    sendEvent({
      event_type: "product_added_to_cart",
      wf_id: resolveWfId(event),
      page_url: event?.context?.document?.location?.href || "",
      ...product, quantity: cartLine?.quantity || 1,
    });
  });

  analytics.subscribe("cart_viewed", (event) => {
    const cart = event?.data?.cart;
    sendEvent({
      event_type: "cart_viewed",
      wf_id: resolveWfId(event),
      page_url: event?.context?.document?.location?.href || "",
      product_id: null, product_title: null,
      variant_id: null, variant_title: null,
      price: cart?.cost?.totalAmount?.amount ? Number(cart.cost.totalAmount.amount) : null,
      quantity: cart?.lines?.length || null,
    });
  });

  analytics.subscribe("collection_viewed", (event) => {
    const collection = event?.data?.collection;
    sendEvent({
      event_type: "collection_viewed",
      wf_id: resolveWfId(event),
      page_url: event?.context?.document?.location?.href || "",
      product_id: collection?.id ? String(collection.id) : null,
      product_title: collection?.title || null,
      variant_id: null, variant_title: null,
      price: null,
      quantity: collection?.productVariants?.length || null,
    });
  });

  analytics.subscribe("search_submitted", (event) => {
    sendEvent({
      event_type: "search_submitted",
      wf_id: resolveWfId(event),
      page_url: event?.context?.document?.location?.href || "",
      product_id: null,
      product_title: event?.data?.searchResult?.query || null,
      variant_id: null, variant_title: null,
      price: null,
      quantity: event?.data?.searchResult?.productVariants?.length || null,
    });
  });

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
      product_id: null, product_title: null,
      variant_id: null, variant_title: null,
      price: Number(totalPrice) - Number(shipping) - Number(tax),
      currency: checkout?.currencyCode || null,
      quantity: items.length, items,
    });
  });

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
      variant_id: null, variant_title: null,
      price: Number(totalPrice) - Number(shipping) - Number(tax),
      currency: checkout?.currencyCode || null,
      quantity: items.length,
      transaction_id: order?.id ? String(order.id) : null,
      items,
    });
  });
});
