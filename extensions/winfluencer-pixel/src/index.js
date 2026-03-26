import { register } from "@shopify/web-pixels-extension";

register(({ analytics, init, settings }) => {
  const ENDPOINT = "/apps/winfluencer/events";
  const shopName = init?.data?.shop?.name || "";

  /* ─── RESOLVE WF_ID FROM MULTIPLE SOURCES ─── */
  let cachedWfId = "";

  // 1. Try init.data.cart.attributes (cart attribute bridge from theme snippet)
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

    // Try cart attributes (available on cart events)
    try {
      const attrs = event?.data?.cart?.attributes || [];
      for (const attr of attrs) {
        if (attr.key === "wf_influencer_id" && attr.value) {
          cachedWfId = attr.value;
          return cachedWfId;
        }
      }
    } catch (e) {}

    // Try URL params (landing page)
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
    } catch (e) {}

    return "";
  }

  /* ─── SEND EVENT TO WINFLUENCER API ─── */
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
      let itemDiscountAmount = 0;
      item.discountAllocations?.forEach((allocation) => {
        itemDiscountAmount += allocation?.amount?.amount || 0;
      });

      const itemPrice = item.variant?.price?.amount || 0;
      let priceAfterDiscount = itemPrice - itemDiscountAmount / (item.quantity || 1);
      priceAfterDiscount = Math.max(priceAfterDiscount, 0);

      products.push({
        item_id: item.variant?.product?.id || null,
        item_name: item.variant?.product?.title || null,
        item_brand: item.variant?.product?.vendor || null,
        item_category: item.variant?.product?.type || null,
        item_variant: item.variant?.title || null,
        price: priceAfterDiscount,
        quantity: item.quantity || 1,
        discount: itemDiscountAmount / (item.quantity || 1),
        index,
      });
    });

    return products;
  }

  /* ═══════════════════════════════════════════════════════════
     NON-ECOMMERCE EVENTS
     ═══════════════════════════════════════════════════════════ */

  /* ─── PAGE VIEWED ─── */
  analytics.subscribe("page_viewed", (event) => {
    const ctx = event?.context?.document;
    sendEvent({
      event_type: "page_viewed",
      wf_id: resolveWfId(event),
      page_url: ctx?.location?.href || "",
      page_referrer: ctx?.referrer || "",
      page_title: ctx?.title || "",
      product_id: null,
      product_title: null,
      variant_id: null,
      variant_title: null,
      price: null,
      quantity: null,
    });
  });

  /* ═══════════════════════════════════════════════════════════
     ECOMMERCE EVENTS
     ═══════════════════════════════════════════════════════════ */

  /* ─── PRODUCT VIEWED (view_item) ─── */
  analytics.subscribe("product_viewed", (event) => {
    const ctx = event?.context?.document;
    const pv = event?.data?.productVariant;

    sendEvent({
      event_type: "product_viewed",
      wf_id: resolveWfId(event),
      page_url: ctx?.location?.href || "",
      page_referrer: ctx?.referrer || "",
      page_title: ctx?.title || "",
      product_id: pv?.product?.id ? String(pv.product.id) : null,
      product_title: pv?.product?.title || null,
      product_vendor: pv?.product?.vendor || null,
      product_type: pv?.product?.type || null,
      variant_id: pv?.id ? String(pv.id) : null,
      variant_title: pv?.title || null,
      price: pv?.price?.amount != null ? Number(pv.price.amount) : null,
      currency: pv?.price?.currencyCode || null,
      quantity: 1,
    });
  });

  /* ─── COLLECTION VIEWED (view_item_list) ─── */
  analytics.subscribe("collection_viewed", (event) => {
    const ctx = event?.context?.document;
    const collection = event?.data?.collection;
    const items = [];

    collection?.productVariants?.forEach((item, index) => {
      items.push({
        item_id: item.product?.id || null,
        item_name: item.product?.title || null,
        item_brand: item.product?.vendor || null,
        item_category: item.product?.type || null,
        price: item.price?.amount || null,
        index,
      });
    });

    sendEvent({
      event_type: "collection_viewed",
      wf_id: resolveWfId(event),
      page_url: ctx?.location?.href || "",
      page_title: ctx?.title || "",
      product_id: collection?.id ? String(collection.id) : null,
      product_title: collection?.title || null,
      variant_id: null,
      variant_title: null,
      price: null,
      quantity: items.length,
      items,
    });
  });

  /* ─── ADD TO CART ─── */
  analytics.subscribe("product_added_to_cart", (event) => {
    const ctx = event?.context?.document;
    const cartLine = event?.data?.cartLine;
    const m = cartLine?.merchandise;

    sendEvent({
      event_type: "product_added_to_cart",
      wf_id: resolveWfId(event),
      page_url: ctx?.location?.href || "",
      page_title: ctx?.title || "",
      product_id: m?.product?.id ? String(m.product.id) : null,
      product_title: m?.product?.title || null,
      product_vendor: m?.product?.vendor || null,
      product_type: m?.product?.type || null,
      variant_id: m?.id ? String(m.id) : null,
      variant_title: m?.title || null,
      price: m?.price?.amount != null ? Number(m.price.amount) : null,
      currency: cartLine?.cost?.totalAmount?.currencyCode || null,
      quantity: cartLine?.quantity != null ? Number(cartLine.quantity) : null,
    });
  });

  /* ─── CART VIEWED ─── */
  analytics.subscribe("cart_viewed", (event) => {
    const ctx = event?.context?.document;
    const cart = event?.data?.cart;
    const items = [];

    cart?.lines?.forEach((item, index) => {
      items.push({
        item_id: item.merchandise?.product?.id || null,
        item_name: item.merchandise?.product?.title || null,
        item_brand: item.merchandise?.product?.vendor || null,
        item_variant: item.merchandise?.title || null,
        price: item.merchandise?.price?.amount || null,
        quantity: item.quantity || 1,
        index,
      });
    });

    sendEvent({
      event_type: "cart_viewed",
      wf_id: resolveWfId(event),
      page_url: ctx?.location?.href || "",
      page_title: ctx?.title || "",
      product_id: null,
      product_title: null,
      variant_id: null,
      variant_title: null,
      price: cart?.cost?.totalAmount?.amount != null ? Number(cart.cost.totalAmount.amount) : null,
      currency: cart?.cost?.totalAmount?.currencyCode || null,
      quantity: items.length,
      items,
    });
  });

  /* ─── CHECKOUT STARTED (begin_checkout) ─── */
  analytics.subscribe("checkout_started", (event) => {
    const ctx = event?.context?.document;
    const checkout = event?.data?.checkout;
    const totalPrice = checkout?.totalPrice?.amount || 0;
    const shipping = checkout?.shippingLine?.price?.amount || 0;
    const tax = checkout?.totalTax?.amount || 0;
    const discount = checkout?.discountsAmount?.amount || 0;
    const totalOrderValue = totalPrice - shipping - tax;

    const items = processCheckoutProducts(checkout?.lineItems);

    sendEvent({
      event_type: "checkout_started",
      wf_id: resolveWfId(event),
      page_url: ctx?.location?.href || "",
      page_title: ctx?.title || "",
      product_id: null,
      product_title: null,
      variant_id: null,
      variant_title: null,
      price: totalOrderValue,
      currency: checkout?.currencyCode || null,
      quantity: items.length,
      discount,
      items,
    });
  });

  /* ─── SHIPPING INFO SUBMITTED ─── */
  analytics.subscribe("checkout_shipping_info_submitted", (event) => {
    const ctx = event?.context?.document;
    const checkout = event?.data?.checkout;
    const totalPrice = checkout?.totalPrice?.amount || 0;
    const shipping = checkout?.shippingLine?.price?.amount || 0;
    const tax = checkout?.totalTax?.amount || 0;

    sendEvent({
      event_type: "shipping_info_submitted",
      wf_id: resolveWfId(event),
      page_url: ctx?.location?.href || "",
      price: totalPrice - shipping - tax,
      currency: checkout?.currencyCode || null,
      product_id: null,
      product_title: null,
      variant_id: null,
      variant_title: null,
      quantity: null,
    });
  });

  /* ─── PAYMENT INFO SUBMITTED ─── */
  analytics.subscribe("payment_info_submitted", (event) => {
    const ctx = event?.context?.document;
    const checkout = event?.data?.checkout;
    const totalPrice = checkout?.totalPrice?.amount || 0;
    const shipping = checkout?.shippingLine?.price?.amount || 0;
    const tax = checkout?.totalTax?.amount || 0;

    sendEvent({
      event_type: "payment_info_submitted",
      wf_id: resolveWfId(event),
      page_url: ctx?.location?.href || "",
      price: totalPrice - shipping - tax,
      currency: checkout?.currencyCode || null,
      product_id: null,
      product_title: null,
      variant_id: null,
      variant_title: null,
      quantity: null,
    });
  });

  /* ─── CHECKOUT COMPLETED (purchase) ─── */
  analytics.subscribe("checkout_completed", (event) => {
    const ctx = event?.context?.document;
    const checkout = event?.data?.checkout;
    const order = checkout?.order;
    const totalPrice = checkout?.totalPrice?.amount || 0;
    const shipping = checkout?.shippingLine?.price?.amount || 0;
    const tax = checkout?.totalTax?.amount || 0;
    const discount = checkout?.discountsAmount?.amount || 0;
    const totalOrderValue = totalPrice - shipping - tax;
    const paymentType = checkout?.transactions?.[0]?.gateway || null;

    const items = processCheckoutProducts(checkout?.lineItems);
    const coupon = checkout?.discountApplications
      ?.map((d) => d.title)
      .filter(Boolean)
      .join(",") || null;

    sendEvent({
      event_type: "checkout_completed",
      wf_id: resolveWfId(event),
      page_url: ctx?.location?.href || "",
      page_title: ctx?.title || "",
      product_id: order?.id ? String(order.id) : null,
      product_title: null,
      variant_id: null,
      variant_title: null,
      price: totalOrderValue,
      currency: checkout?.currencyCode || null,
      quantity: items.length,
      discount,
      coupon,
      payment_type: paymentType,
      transaction_id: order?.id ? String(order.id) : null,
      tax,
      shipping,
      user_email: checkout?.email || null,
      items,
    });
  });

  /* ─── SEARCH SUBMITTED ─── */
  analytics.subscribe("search_submitted", (event) => {
    const ctx = event?.context?.document;
    sendEvent({
      event_type: "search_submitted",
      wf_id: resolveWfId(event),
      page_url: ctx?.location?.href || "",
      page_title: ctx?.title || "",
      search_term: event?.data?.searchResult?.query || null,
      product_id: null,
      product_title: null,
      variant_id: null,
      variant_title: null,
      price: null,
      quantity: null,
    });
  });
});
