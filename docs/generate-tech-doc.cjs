const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat,
  HeadingLevel, BorderStyle, WidthType, ShadingType,
  PageNumber, PageBreak, TabStopType, TabStopPosition,
} = require("docx");

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };
const PAGE_W = 9360; // US Letter content width with 1" margins

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({ heading: level, children: [new TextRun(text)] });
}

function para(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    ...opts,
    children: [new TextRun({ font: "Arial", size: 22, ...opts.run, text })],
  });
}

function bold(text) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ font: "Arial", size: 22, bold: true, text })],
  });
}

function headerCell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: "B8461A", type: ShadingType.CLEAR },
    margins: cellMargins,
    verticalAlign: "center",
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF", font: "Arial", size: 20 })] })],
  });
}

function cell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    margins: cellMargins,
    children: [new Paragraph({ children: [new TextRun({ text, font: "Arial", size: 20 })] })],
  });
}

function makeTable(headers, rows, colWidths) {
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: tableWidth, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [
      new TableRow({ children: headers.map((h, i) => headerCell(h, colWidths[i])) }),
      ...rows.map((row) =>
        new TableRow({ children: row.map((c, i) => cell(c, colWidths[i])) })
      ),
    ],
  });
}

function spacer() {
  return new Paragraph({ spacing: { after: 200 }, children: [] });
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      {
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Arial", color: "B8461A" },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 },
      },
      {
        id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial", color: "9A3A15" },
        paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 1 },
      },
      {
        id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Arial", color: "303030" },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
      {
        reference: "numbers",
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
    ],
  },
  sections: [
    // ═══════════════ TITLE PAGE ═══════════════
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children: [
        spacer(), spacer(), spacer(), spacer(), spacer(), spacer(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text: "WINFLUENCER", font: "Arial", size: 56, bold: true, color: "B8461A" })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          children: [new TextRun({ text: "Technical Architecture Document", font: "Arial", size: 32, color: "9A3A15" })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [new TextRun({ text: "Influencer Marketing Attribution Platform for Shopify", font: "Arial", size: 24, color: "6D7175" })],
        }),
        spacer(), spacer(), spacer(), spacer(), spacer(), spacer(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "Version 1.0 | March 2026", font: "Arial", size: 22, color: "6D7175" })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "Confidential", font: "Arial", size: 22, color: "6D7175", italics: true })],
        }),
        new Paragraph({ children: [new PageBreak()] }),
      ],
    },
    // ═══════════════ MAIN CONTENT ═══════════════
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [
              new TextRun({ text: "Winfluencer Technical Architecture", font: "Arial", size: 18, color: "B8461A", italics: true }),
            ],
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "Page ", font: "Arial", size: 18, color: "6D7175" }),
              new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 18, color: "6D7175" }),
            ],
          })],
        }),
      },
      children: [
        // ─── 1. EXECUTIVE SUMMARY ───
        heading("1. Executive Summary"),
        para("Winfluencer is a Shopify embedded app that provides real-time influencer marketing attribution and analytics. It tracks visitor journeys from influencer referral links through to purchase, using a multi-touch attribution model with last-touch credit assignment."),
        para("The platform consists of four core components: a storefront App Embed Block for URL capture, a Custom Pixel for event tracking, a server-side API for data ingestion, and a React dashboard for analytics visualization."),
        spacer(),

        // ─── 2. SYSTEM ARCHITECTURE ───
        heading("2. System Architecture Overview"),
        para("The tracking pipeline follows a linear data flow from the storefront to the merchant dashboard:"),
        spacer(),

        makeTable(
          ["Layer", "Component", "Technology", "Purpose"],
          [
            ["Storefront", "App Embed Block", "Liquid + JavaScript", "Capture wf_id from URL, write to cart attributes and localStorage"],
            ["Storefront", "Custom Pixel", "Web Pixels API", "Track all customer events, manage journey array, send to API"],
            ["Server", "Events API", "React Router (Vercel)", "Receive events, store in database, create touchpoints"],
            ["Server", "Orders Webhook", "Shopify Webhook", "Capture completed orders with HMAC verification"],
            ["Server", "Analytics Service", "Node.js + Prisma", "Compute funnel metrics, Sankey data, role breakdowns"],
            ["Client", "Dashboard", "React + Polaris + Recharts", "Visualize metrics, funnels, Sankey diagrams, journey timelines"],
            ["Database", "PostgreSQL", "NeonDB + Prisma ORM", "Store events, orders, touchpoints, campaigns, influencers"],
          ],
          [1200, 1800, 2160, 4200]
        ),
        spacer(),

        // ─── 3. SHOPIFY INFRASTRUCTURE ───
        heading("3. Shopify Infrastructure Components"),

        heading("3.1 App Embed Block (wf-tracker.liquid)", HeadingLevel.HEADING_2),
        para("The App Embed Block is a Liquid snippet injected into the storefront theme body via Shopify Extensions. It runs on every page load in the main browsing context (not sandboxed)."),
        spacer(),
        bold("Responsibilities:"),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Extract wf_id from URL query parameter (?wf_id=xxx)" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Persist wf_id to localStorage as backup for cross-page persistence" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Write wf_influencer_id to Shopify cart attributes via /cart/update.js" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Fetch cart token from /cart.js and write as wf_session_id to cart attributes and localStorage" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Intercept fetch calls to /cart/add and /cart/change to re-sync wf_id after cart modifications" })] }),
        spacer(),
        para("Cart attributes are first-party functional data and do not require cookie consent. This makes the tracking GDPR-friendly by design."),
        spacer(),

        heading("3.2 Custom Pixel (Web Pixels API)", HeadingLevel.HEADING_2),
        para("The Custom Pixel runs inside Shopify's sandboxed iframe environment. It subscribes to all customer events via the Web Pixels API and sends tracking data to the Winfluencer backend."),
        spacer(),
        bold("Sandbox Constraints:"),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Cannot fetch from the store's origin (e.g., /cart.js throws RestrictedUrlError)" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Has its own isolated localStorage (separate from the storefront's localStorage)" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "All browser.localStorage calls are async (return Promises)" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Can access init.data for cart token and cart attributes at startup" })] }),
        spacer(),

        bold("Event Queue Architecture:"),
        para("All events are queued in a pendingEvents array until the async initialize() function completes. This ensures wf_id and sessionId are resolved from localStorage BEFORE any events are sent. Without this pattern, the async browser.localStorage calls would not resolve in time."),
        spacer(),

        heading("3.3 Shopify Webhooks", HeadingLevel.HEADING_2),
        para("The app registers an orders/create webhook that fires when a new order is placed. The webhook handler verifies the HMAC-SHA256 signature, extracts the wf_influencer_id from order note_attributes, and creates an Order record linked to the originating influencer."),
        spacer(),

        heading("3.4 App Proxy", HeadingLevel.HEADING_2),
        para("The app proxy routes requests from apps/winfluencer/* on the storefront to the Vercel backend. This enables the events API to receive data from the storefront context with automatic shop verification."),
        spacer(),

        // ─── 4. DATA FLOW ───
        heading("4. Complete Data Flow"),

        heading("4.1 Visitor Arrives via Influencer Link", HeadingLevel.HEADING_2),
        spacer(),
        makeTable(
          ["Step", "Component", "Action", "Data Written"],
          [
            ["1", "Browser", "Visitor clicks influencer link with ?wf_id=abc123", "URL parameter"],
            ["2", "App Embed Block", "Extracts wf_id from URL, saves to localStorage", "localStorage: wf_id=abc123"],
            ["3", "App Embed Block", "Fetches /cart.js to get cart token", "Cart token retrieved"],
            ["4", "App Embed Block", "Writes wf_influencer_id and wf_session_id to cart attributes", "Cart attributes updated"],
            ["5", "Custom Pixel", "initialize() reads wf_id from sandbox localStorage", "cachedWfId set"],
            ["6", "Custom Pixel", "Loads journey array, appends current wf_id", "journey = [{wfId: abc123, ts: ...}]"],
            ["7", "Custom Pixel", "Resolves or generates sessionId", "sessionId set"],
            ["8", "Custom Pixel", "Subscribes page_viewed event, sends to API", "POST /api/events"],
            ["9", "Events API", "Stores Event record, creates Touchpoint", "Database updated"],
          ],
          [600, 1600, 3800, 3360]
        ),
        spacer(),

        heading("4.2 Multi-Touch Journey (Last-Touch Attribution)", HeadingLevel.HEADING_2),
        para("When a visitor clicks a second influencer link, the pixel detects the new ?wf_id= in the URL and overrides the cached value (last-touch). The previous influencer remains in the journey array for multi-touch analysis."),
        spacer(),
        makeTable(
          ["Visit", "URL", "wf_id (last-touch)", "Journey Array"],
          [
            ["1", "store.com/?wf_id=influencer_A", "influencer_A", "[{wfId: A, ts: ...}]"],
            ["2", "store.com/?wf_id=influencer_B", "influencer_B (overrides A)", "[{wfId: A, ts: ...}, {wfId: B, ts: ...}]"],
            ["3", "Product page (no wf_id)", "influencer_B (persisted)", "[{wfId: A}, {wfId: B}] (unchanged)"],
            ["Purchase", "Checkout completed", "Credit goes to B", "Full journey A then B stored as Touchpoints"],
          ],
          [1200, 2800, 2600, 2760]
        ),
        spacer(),

        // ─── 5. LOCALSTORAGE KEYS ───
        heading("5. Pixel localStorage Keys and Expiration"),
        spacer(),
        makeTable(
          ["Key", "Value", "TTL", "Purpose"],
          [
            ["wf_id", "Influencer wfId string", "90 days", "Current last-touch influencer for attribution"],
            ["wf_id_ts", "Unix timestamp (ms)", "N/A", "Tracks when wf_id was first set for expiry calculation"],
            ["wf_session_id", "Random string (wf_...)", "30 min inactivity", "Unique visitor session identifier"],
            ["wf_session_ts", "Unix timestamp (ms)", "N/A", "Last activity timestamp, reset on every event sent"],
            ["wf_journey", "JSON array [{wfId, ts}]", "90 days per entry", "Multi-touch journey history (max 20 entries)"],
          ],
          [1600, 2200, 1800, 3760]
        ),
        spacer(),
        para("Session expiry follows a 30-minute inactivity model (same as Google Analytics). Each event resets the inactivity timer. A returning visitor after 30+ minutes of no activity gets a new session, enabling accurate unique visitor counting."),
        spacer(),

        // ─── 6. TRACKED EVENTS ───
        heading("6. Tracked Customer Events"),
        spacer(),
        makeTable(
          ["Event Type", "Shopify Event", "Data Captured", "Funnel Stage"],
          [
            ["page_viewed", "page_viewed", "Page URL", "Visitors"],
            ["product_viewed", "product_viewed", "Product ID, title, vendor, variant, price", "Product Views"],
            ["product_added_to_cart", "product_added_to_cart", "Product details + quantity", "Add to Cart"],
            ["cart_viewed", "cart_viewed", "Cart total, line count", "N/A"],
            ["collection_viewed", "collection_viewed", "Collection ID, title", "N/A"],
            ["search_submitted", "search_submitted", "Search query, result count", "N/A"],
            ["checkout_started", "checkout_started", "Total price, line items array", "Checkout"],
            ["checkout_completed", "checkout_completed", "Order ID, total, line items", "Purchased"],
          ],
          [2200, 2000, 3160, 2000]
        ),
        spacer(),
        para("For checkout_completed and checkout_started events, the API also creates individual item_purchased or item_checkout_started records for each line item, enabling product-level attribution analysis."),
        spacer(),

        new Paragraph({ children: [new PageBreak()] }),

        // ─── 7. DATABASE SCHEMA ───
        heading("7. Database Schema"),
        para("The application uses PostgreSQL (hosted on NeonDB) with Prisma ORM. The schema contains 8 models:"),
        spacer(),

        heading("7.1 Core Models", HeadingLevel.HEADING_2),
        spacer(),
        makeTable(
          ["Model", "Primary Key", "Key Fields", "Relations"],
          [
            ["Store", "id (cuid)", "shop (unique), accessToken, pixelId (unique)", "Has many: Campaign, Event, Order, Touchpoint, TeamMember"],
            ["Campaign", "id (cuid)", "storeId, name, status, startDate, endDate, budget", "Belongs to Store; Has many Influencer"],
            ["Influencer", "id (cuid)", "campaignId, name, handle, platform, wfId (unique), trackingUrl", "Belongs to Campaign; Has many Event, Order, Touchpoint"],
            ["Event", "id (cuid)", "storeId, influencerId?, wfId?, sessionId, eventType, product fields, timestamp", "Belongs to Store and optionally Influencer"],
            ["Order", "id (cuid)", "storeId, influencerId?, shopifyOrderId, wfId?, totalPrice, lineItems (JSON)", "Belongs to Store and optionally Influencer"],
            ["Touchpoint", "id (cuid)", "storeId, sessionId, wfId, influencerId?, touchIndex, timestamp", "Belongs to Store and optionally Influencer; Unique on (sessionId, wfId)"],
            ["TeamMember", "id (cuid)", "storeId, email, name, role, invitedAt, acceptedAt", "Belongs to Store; Unique on (storeId, email)"],
            ["Session", "id", "shop, accessToken, scope, refreshToken", "Shopify OAuth session management"],
          ],
          [1400, 1400, 3800, 2760]
        ),
        spacer(),

        heading("7.2 Database Indexes", HeadingLevel.HEADING_2),
        spacer(),
        makeTable(
          ["Table", "Index", "Purpose"],
          [
            ["Event", "(storeId, eventType)", "Fast funnel aggregation per store"],
            ["Event", "(influencerId, eventType)", "Fast per-influencer funnel queries"],
            ["Order", "(storeId)", "Revenue aggregation per store"],
            ["Order", "(influencerId)", "Per-influencer revenue queries"],
            ["Touchpoint", "(storeId, sessionId)", "Journey lookups per store"],
            ["Touchpoint", "(influencerId)", "Role breakdown queries"],
            ["Touchpoint", "(sessionId, touchIndex)", "Ordered journey retrieval"],
          ],
          [1600, 3000, 4760]
        ),
        spacer(),

        new Paragraph({ children: [new PageBreak()] }),

        // ─── 8. ANALYTICS FUNCTIONS ───
        heading("8. Analytics Service Functions"),
        para("All analytics are computed server-side in analytics.server.js. Functions are grouped by scope:"),
        spacer(),

        heading("8.1 Funnel and Overview Metrics", HeadingLevel.HEADING_2),
        spacer(),
        makeTable(
          ["Function", "Input", "Returns"],
          [
            ["getStoreFunnelCounts(storeId)", "Store ID", "visitors, uniqueVisitors, productViews, addToCart, checkoutStarted, purchased"],
            ["getInfluencerFunnelCounts(influencerId)", "Influencer ID", "Same as above, filtered by influencer"],
            ["getCampaignFunnelCounts(campaignId)", "Campaign ID", "Same, filtered by campaign influencers"],
            ["getStoreOverviewMetrics(storeId)", "Store ID", "campaignCount, influencerCount, totalRevenue, avgConversion%, funnel"],
            ["getCampaignStats(campaignId)", "Campaign ID", "totalRevenue, visitors, addToCart, purchases, convRate%, funnel"],
            ["getInfluencerStats(influencerId)", "Influencer ID", "revenue, purchases, convRate%, aov, visitors, uniqueVisitors, funnel"],
          ],
          [3200, 1400, 4760]
        ),
        spacer(),

        heading("8.2 Attribution and Journey Functions", HeadingLevel.HEADING_2),
        spacer(),
        makeTable(
          ["Function", "Input", "Returns"],
          [
            ["getSankeyData(storeId)", "Store ID", "Recharts-compatible {nodes, links} for Sankey diagram"],
            ["getCampaignSankeyData(campaignId)", "Campaign ID", "Same, filtered by campaign influencers"],
            ["getInfluencerRoleBreakdown(influencerId)", "Influencer ID", "introducer%, influencer%, closer% with counts"],
            ["getRecentJourneys(influencerId, limit)", "Influencer ID, count", "Array of {sessionId, converted, touches[]}"],
          ],
          [3200, 1800, 4360]
        ),
        spacer(),

        heading("8.3 Product Intelligence Functions", HeadingLevel.HEADING_2),
        spacer(),
        makeTable(
          ["Function", "Input", "Returns"],
          [
            ["getProductIntelligence(storeId, filters)", "Store ID + optional campaign/influencer filter", "Products with carted, purchased, cart-to-buy rate, revenue, signal"],
            ["computeSignal(cartCount, purchaseCount)", "Cart and purchase counts", "Signal: Normal, High convert, Strong intent, or Price friction"],
            ["getTopProduct(storeId)", "Store ID", "Top product by revenue with title, revenue, units"],
          ],
          [3200, 2800, 3360]
        ),
        spacer(),
        para("Signal Classification: High convert (>75% buy rate), Strong intent (>50%), Price friction (<15% and >10 carts), Normal (everything else)."),
        spacer(),

        new Paragraph({ children: [new PageBreak()] }),

        // ─── 9. DASHBOARD VISUALIZATIONS ───
        heading("9. Dashboard Visualizations"),

        heading("9.1 Main Dashboard", HeadingLevel.HEADING_2),
        spacer(),
        makeTable(
          ["Component", "Data Source", "Description"],
          [
            ["Metric Cards (5)", "getStoreOverviewMetrics", "Total Revenue, Total Visitors, Unique Visitors, Avg Conversion, Top Product"],
            ["Conversion Funnel", "getStoreOverviewMetrics.funnel", "5-stage funnel with brand-colored bars (Visitors through Purchased)"],
            ["Top Influencers", "getTopInfluencers", "Top 5 influencers by revenue with name, handle, revenue, conv rate"],
            ["Sankey Diagram", "getSankeyData", "Multi-touch journey flow from influencers to funnel stages (Recharts)"],
            ["Influencer Comparison Table", "getInfluencerComparison", "All influencers with clickable rows, Active/Inactive status badges"],
          ],
          [2400, 2800, 4160]
        ),
        spacer(),

        heading("9.2 Campaign Detail Page", HeadingLevel.HEADING_2),
        spacer(),
        makeTable(
          ["Component", "Data Source", "Description"],
          [
            ["Metric Cards (5)", "getCampaignStats", "Total revenue, visitors, add to cart, purchases, conv. rate"],
            ["Influencer Breakdown", "Per-influencer event/order groupBy", "Clickable table with visitors, cart%, purchase%, revenue, AOV"],
            ["Campaign Sankey", "getCampaignSankeyData", "Journey flow filtered to this campaign's influencers"],
            ["Product Intelligence", "getProductIntelligence", "Products carted vs purchased with signal classification"],
          ],
          [2400, 2800, 4160]
        ),
        spacer(),

        heading("9.3 Influencer Profile Page", HeadingLevel.HEADING_2),
        spacer(),
        makeTable(
          ["Component", "Data Source", "Description"],
          [
            ["Metric Cards (6)", "getInfluencerStats", "Revenue, Purchases, Conv. rate, AOV, Visitors, Unique Visitors"],
            ["Tracking Link", "influencer.trackingUrl", "Copyable tracking URL with wf_id parameter"],
            ["Journey Role Card", "getInfluencerRoleBreakdown", "Introducer / Influencer / Closer percentages with session counts"],
            ["Recent Journeys", "getRecentJourneys", "Arrow chain timeline: Influencer A -> B -> C with Converted/Browsed badges"],
            ["Conversion Funnel", "getInfluencerStats.funnel", "5-stage funnel with progress bars"],
            ["Revenue Breakdown", "getInfluencerStats", "Total revenue, AOV, Revenue/visitor, Top product, Price friction alert"],
            ["Product Intelligence", "getProductIntelligence", "Products carted vs purchased with signal badges"],
          ],
          [2200, 2800, 4360]
        ),
        spacer(),

        new Paragraph({ children: [new PageBreak()] }),

        // ─── 10. TECH STACK ───
        heading("10. Technology Stack"),
        spacer(),
        makeTable(
          ["Category", "Technology", "Version", "Purpose"],
          [
            ["Runtime", "Node.js", ">=20.19", "Server-side JavaScript"],
            ["Framework", "React Router v7", "7.12.0", "Full-stack React framework (SSR)"],
            ["UI Library", "Shopify Polaris", "13.9.5", "Shopify admin design system"],
            ["UI Components", "App Bridge React", "4.2.10", "Shopify embedded app integration"],
            ["Charting", "Recharts", "3.8.1", "Sankey diagrams and data visualization"],
            ["Database", "PostgreSQL (NeonDB)", "Serverless", "Event storage, analytics data"],
            ["ORM", "Prisma", "6.19.2", "Type-safe database queries and migrations"],
            ["Hosting", "Vercel", "Serverless", "API and SSR hosting"],
            ["Build", "Vite", "6.3.6", "Development server and bundling"],
            ["Pixel Build", "esbuild", "CLI", "Custom pixel bundling (IIFE format)"],
            ["Authentication", "Shopify OAuth", "Embedded auth", "Merchant authentication"],
            ["Session Storage", "Prisma Session Storage", "8.0.0", "Database-backed sessions (no cookies)"],
          ],
          [1600, 2400, 1600, 3760]
        ),
        spacer(),

        // ─── 11. API SCOPES ───
        heading("11. Shopify API Scopes"),
        spacer(),
        makeTable(
          ["Scope", "Access Level", "Purpose"],
          [
            ["read_customer_events", "Read", "Access customer event data for pixel tracking"],
            ["read_orders", "Read", "Read order information for revenue attribution"],
            ["write_pixels", "Write", "Register and manage custom pixel extensions"],
            ["write_themes", "Write", "App embed block injection into storefront theme"],
            ["write_products", "Write", "Product data access for intelligence features"],
            ["write_metaobject_definitions", "Write", "Custom metaobject type creation"],
            ["write_metaobjects", "Write", "Custom metaobject instance management"],
          ],
          [2800, 1200, 5360]
        ),
        spacer(),

        // ─── 12. DEPLOYMENT ───
        heading("12. Deployment Architecture"),
        spacer(),
        makeTable(
          ["Component", "Deploy Method", "Hosting", "Trigger"],
          [
            ["React Dashboard + API", "git push to main", "Vercel (auto-deploy)", "Every push to GitHub main branch"],
            ["Custom Pixel", "shopify app deploy", "Shopify CDN", "Manual CLI command"],
            ["App Embed Block", "shopify app deploy", "Shopify CDN", "Manual CLI command"],
            ["Database Migrations", "prisma migrate deploy", "NeonDB", "Runs automatically during Vercel build"],
            ["Pixel Source Build", "npx esbuild (IIFE)", "Local then committed", "Before shopify app deploy"],
          ],
          [2200, 2000, 2200, 2960]
        ),
        spacer(),
        para("Important: Dashboard UI changes only require git push (Vercel). Pixel and embed block changes require shopify app deploy because they run on Shopify's infrastructure, not Vercel."),
        spacer(),
        spacer(),

        // ─── END ───
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 400 },
          children: [new TextRun({ text: "--- End of Document ---", font: "Arial", size: 20, color: "6D7175", italics: true })],
        }),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buffer) => {
  const outputPath = process.argv[2] || "Winfluencer_Technical_Architecture.docx";
  fs.writeFileSync(outputPath, buffer);
  console.log("Document created:", outputPath);
});
