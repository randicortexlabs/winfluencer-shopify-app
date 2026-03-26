import { register } from "@shopify/web-pixels-extension";

register(({ analytics, init }) => {
  /**
   * Winfluencer Custom Pixel — handles CHECKOUT events only.
   * Pre-checkout events (page_viewed, product_viewed, add_to_cart) are
   * handled by the theme snippet which has direct access to the storefront.
   *
   * The pixel sandbox cannot reliably reach /apps/winfluencer/events via
   * relative URLs, so we construct the absolute store URL.
   */

  // Build absolute endpoint URL from the store's myshopify domain
  const shopDomain = init?.data?.shop?.myshopifyDomain
    || init?.data?.shop?.storefrontUrl?.replace("https://", "").replace(/\/$/, "")
    || "";
  const ENDPOINT = shopDomain
    ? `https://${shopDomain}/apps/winfluencer/events`
    : "/apps/winfluencer/events"; // fallback to relative

  /* ─── RESOLVE WF_ID ─── */
  let cachedWfId = "";

  // Read from init.data.cart.attributes (cart attribute bridge)
  try {
    const cartAttrs = init?.data?.cart?.attributes || [];
    for (const attr of cartAttrs) {
      if (attr.key === "wf_influencer_id" && attr.value) {
        cachedWfId = attr.value;
        break;
      }
    }
  } catch (e) {}

  function resolveWfId(event) {
    if (cachedWfId) return cachedWfId;

    // Try checkout attributes
    try {
      const attrs = event?.data?.checkout?.attributes || [];
      for (const attr of attrs) {
        if (attr.key === "wf_influencer_id" && attr.value) {
          cachedWfId = attr.value;
          return cachedWfId;
        }
      }
    } catch (e) {}

    return "";
  }

  /* ─── SEND EVENT ─── */
  function sendEvent(payload) {
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }

  /* ─── HELPER: PROCESS CHECKOUT LINE ITEMS ─── */
  function processCheckoutProducts(items) {
    const products = [];
    if (!items) return products;

    items.forEach((item, index) => {
      let discount = 0;
      item.discountAllocations?.forEach((a) => {
        discount += a?.amount?.amount || 0;
      });

      const price = item.variant?.price?.amount || 0;
      const priceAfterDiscount = Math.max(price - discount / (item.quantity || 1), 0);

      products.push({
        item_id: item.variant?.product?.id || null,
        item_name: item.variant?.product?.title || null,
        item_variant: item.variant?.title || null,
        price: priceAfterDiscount,
        quantity: item.quantity || 1,
        index,
      });
    });
    return products;
  }

  /* ═══════════════════════════════════════════════
     CHECKOUT EVENTS (pixel-only — has checkout.attributes)
     ═══════════════════════════════════════════════ */

  /* ─── CHECKOUT STARTED ─── */
  analytics.subscribe("checkout_started", (event) => {
    const checkout = event?.data?.checkout;
    const totalPrice = checkout?.totalPrice?.amount || 0;
    const shipping = checkout?.shippingLine?.price?.amount || 0;
    const tax = checkout?.totalTax?.amount || 0;
    const items = processCheckoutProducts(checkout?.lineItems);

    sendEvent({
      event_type: "checkout_started",
      wf_id: resolveWfId(event),
      page_url: event?.context?.document?.location?.href || "",
      product_id: null,
      product_title: null,
      variant_id: null,
      variant_title: null,
      price: totalPrice - shipping - tax,
      currency: checkout?.currencyCode || null,
      quantity: items.length,
      items,
    });
  });

  /* ─── SHIPPING INFO SUBMITTED ─── */
  analytics.subscribe("checkout_shipping_info_submitted", (event) => {
    const checkout = event?.data?.checkout;
    sendEvent({
      event_type: "shipping_info_submitted",
      wf_id: resolveWfId(event),
      page_url: event?.context?.document?.location?.href || "",
      product_id: null,
      product_title: null,
      variant_id: null,
      variant_title: null,
      price: checkout?.totalPrice?.amount || null,
      currency: checkout?.currencyCode || null,
      quantity: null,
    });
  });

  /* ─── PAYMENT INFO SUBMITTED ─── */
  analytics.subscribe("payment_info_submitted", (event) => {
    const checkout = event?.data?.checkout;
    sendEvent({
      event_type: "payment_info_submitted",
      wf_id: resolveWfId(event),
      page_url: event?.context?.document?.location?.href || "",
      product_id: null,
      product_title: null,
      variant_id: null,
      variant_title: null,
      price: checkout?.totalPrice?.amount || null,
      currency: checkout?.currencyCode || null,
      quantity: null,
    });
  });

  /* ─── CHECKOUT COMPLETED (PURCHASE) ─── */
  analytics.subscribe("checkout_completed", (event) => {
    const checkout = event?.data?.checkout;
    const order = checkout?.order;
    const totalPrice = checkout?.totalPrice?.amount || 0;
    const shipping = checkout?.shippingLine?.price?.amount || 0;
    const tax = checkout?.totalTax?.amount || 0;
    const discount = checkout?.discountsAmount?.amount || 0;
    const items = processCheckoutProducts(checkout?.lineItems);
    const coupon = checkout?.discountApplications
      ?.map((d) => d.title).filter(Boolean).join(",") || null;

    sendEvent({
      event_type: "checkout_completed",
      wf_id: resolveWfId(event),
      page_url: event?.context?.document?.location?.href || "",
      product_id: order?.id ? String(order.id) : null,
      product_title: null,
      variant_id: null,
      variant_title: null,
      price: totalPrice - shipping - tax,
      currency: checkout?.currencyCode || null,
      quantity: items.length,
      discount,
      coupon,
      tax,
      shipping,
      transaction_id: order?.id ? String(order.id) : null,
      payment_type: checkout?.transactions?.[0]?.gateway || null,
      user_email: checkout?.email || null,
      items,
    });
  });
});
