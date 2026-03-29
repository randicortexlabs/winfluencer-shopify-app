import { register } from "@shopify/web-pixels-extension";

register(({ analytics, init, browser }) => {
  /**
   * Winfluencer Custom Pixel — Multi-Touch Journey Tracking
   *
   * ARCHITECTURE:
   * - All events queued until async initialization completes
   * - LAST-TOUCH attribution: new ?wf_id= always overrides the current one
   * - Journey array tracks ALL influencer touches per visitor
   * - Journey sent with every event for server-side Touchpoint creation
   *
   * localStorage keys:
   *   wf_id        — current (last-touch) influencer wfId
   *   wf_id_ts     — timestamp for 90-day expiry
   *   wf_session_id — session identifier
   *   wf_session_ts — last activity timestamp (30-min inactivity expiry)
   *   wf_journey   — JSON array of {wfId, ts} objects (multi-touch history)
   */

  const ENDPOINT = "https://winfluencer-shopify-app.vercel.app/api/events";
  const shopDomain = init?.data?.shop?.myshopifyDomain || "";

  /* ─── STATE ─── */
  let cachedWfId = "";
  let sessionId = "";
  let journey = [];   // [{wfId: string, ts: number}, ...]
  let ready = false;
  let pendingEvents = [];

  /* ─── EXPIRATION CONSTANTS ─── */
  const SESSION_TTL = 30 * 60 * 1000;         // 30 minutes of inactivity
  const WF_ID_TTL = 90 * 24 * 60 * 60 * 1000; // 90 days attribution window
  const MAX_JOURNEY = 20;                      // max touches to store

  /* ─── HELPER: check if a stored timestamp has expired ─── */
  function isExpired(storedTimestamp, ttl) {
    if (!storedTimestamp) return false;
    return (Date.now() - Number(storedTimestamp)) > ttl;
  }

  /* ─── ASYNC INITIALIZATION ─── */
  async function initialize() {

    // ─── WF_ID (90-day expiry) ───
    try {
      const val = await browser.localStorage.getItem("wf_id");
      const ts = await browser.localStorage.getItem("wf_id_ts");
      if (val && !isExpired(ts, WF_ID_TTL)) {
        cachedWfId = val;
        if (!ts) {
          await browser.localStorage.setItem("wf_id_ts", String(Date.now()));
        }
      } else if (val && isExpired(ts, WF_ID_TTL)) {
        await browser.localStorage.removeItem("wf_id");
        await browser.localStorage.removeItem("wf_id_ts");
      }
    } catch (e) {}

    // If not in localStorage, try init.data.cart.attributes
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

    // Persist wf_id if found
    if (cachedWfId) {
      try {
        await browser.localStorage.setItem("wf_id", cachedWfId);
        const existingTs = await browser.localStorage.getItem("wf_id_ts");
        if (!existingTs) {
          await browser.localStorage.setItem("wf_id_ts", String(Date.now()));
        }
      } catch (e) {}
    }

    // ─── JOURNEY (load from localStorage, filter expired) ───
    try {
      const raw = await browser.localStorage.getItem("wf_journey");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          journey = parsed.filter(t => t.wfId && !isExpired(t.ts, WF_ID_TTL));
        }
      }
    } catch (e) {}

    // Ensure current wf_id is in the journey
    if (cachedWfId && !journey.find(t => t.wfId === cachedWfId)) {
      journey.push({ wfId: cachedWfId, ts: Date.now() });
      try {
        await browser.localStorage.setItem("wf_journey", JSON.stringify(journey));
      } catch (e) {}
    }

    // ─── SESSION ID (30-min inactivity expiry) ───
    try {
      const val = await browser.localStorage.getItem("wf_session_id");
      const ts = await browser.localStorage.getItem("wf_session_ts");
      if (val && !isExpired(ts, SESSION_TTL)) {
        sessionId = val;
      } else {
        await browser.localStorage.removeItem("wf_session_id");
        await browser.localStorage.removeItem("wf_session_ts");
      }
    } catch (e) {}

    if (!sessionId) {
      try { sessionId = init?.data?.cart?.token || ""; } catch (e) {}
    }
    if (!sessionId) {
      try { sessionId = init?.data?.checkout?.token || ""; } catch (e) {}
    }
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
    if (!sessionId) {
      sessionId = "wf_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 10);
    }

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

  /* ─── PERSIST WF_ID (last-touch) + append to journey ─── */
  async function persistWfId(value) {
    if (!value) return;
    const now = Date.now();
    cachedWfId = value;

    // Last-touch: always overwrite wf_id
    try {
      await browser.localStorage.setItem("wf_id", value);
      await browser.localStorage.setItem("wf_id_ts", String(now));
    } catch (e) {}

    // Append to journey (deduplicate by wfId)
    if (!journey.find(t => t.wfId === value)) {
      journey.push({ wfId: value, ts: now });
      // Cap at MAX_JOURNEY entries
      if (journey.length > MAX_JOURNEY) {
        journey = journey.slice(-MAX_JOURNEY);
      }
    }

    // Persist journey
    try {
      await browser.localStorage.setItem("wf_journey", JSON.stringify(journey));
    } catch (e) {}
  }

  /* ─── RESOLVE WF_ID: LAST-TOUCH — always check URL first ─── */
  function resolveWfId(event) {
    // ALWAYS check URL for new wf_id (last-touch override)
    try {
      const href = event?.context?.document?.location?.href || "";
      if (href.includes("wf_id=")) {
        const url = new URL(href);
        const fromUrl = url.searchParams.get("wf_id");
        if (fromUrl && fromUrl !== cachedWfId) {
          persistWfId(fromUrl); // updates cachedWfId + appends to journey
        } else if (fromUrl) {
          cachedWfId = fromUrl; // same wf_id, just ensure cached
        }
      }
    } catch (e) {}

    if (cachedWfId) return cachedWfId;

    // Fallback: cart attributes
    try {
      const cartAttrs = event?.data?.cart?.attributes || [];
      for (const attr of cartAttrs) {
        if (attr.key === "wf_influencer_id" && attr.value) {
          persistWfId(attr.value);
        }
      }
      if (cachedWfId) return cachedWfId;
    } catch (e) {}

    // Fallback: checkout attributes
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
    if (!payload.wf_id && cachedWfId) payload.wf_id = cachedWfId;

    // Attach journey for multi-touch tracking
    if (journey.length > 0) {
      payload.journey = journey;
    }

    // Update last-activity timestamp (resets 30-min inactivity timer)
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
