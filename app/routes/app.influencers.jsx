import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import {
  Badge,
  BlockStack,
  Card,
  Divider,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";

function formatCurrency(val) {
  return `$${Number(val || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function roleTone(role) {
  if (role === "Introducer") return "warning";
  if (role === "Closer") return "success";
  if (role === "Influencer") return "info";
  return undefined;
}

export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const { default: db } = await import("../db.server");
  const { getAllInfluencersWithRoles } = await import("../services/analytics.server");

  const { session } = await authenticate.admin(request);
  const store = await db.store.findUnique({ where: { shop: session.shop } });
  if (!store) throw new Response("Store not found", { status: 404 });

  const url = new URL(request.url);
  const campaignId = url.searchParams.get("campaign") || null;

  const [campaigns, influencers] = await Promise.all([
    db.campaign.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
    getAllInfluencersWithRoles(store.id, { campaignId: campaignId || undefined }),
  ]);

  return { campaigns, influencers, activeCampaignId: campaignId };
};

export default function InfluencersPage() {
  const { campaigns, influencers, activeCampaignId } = useLoaderData();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const campaignOptions = [
    { label: "All campaigns", value: "" },
    ...campaigns.map((c) => ({ label: c.name, value: c.id })),
  ];

  const handleCampaignChange = (value) => {
    if (value) setSearchParams({ campaign: value });
    else setSearchParams({});
  };

  return (
    <Page
      title="Influencers"
      subtitle="Cross-campaign view — who's introducing, influencing, and closing"
    >
      <ui-title-bar title="Influencers" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingSm" as="h2">
                  {influencers.length} influencer{influencers.length !== 1 ? "s" : ""}
                </Text>
                <div style={{ minWidth: 220 }}>
                  <Select
                    label=""
                    labelHidden
                    options={campaignOptions}
                    value={activeCampaignId || ""}
                    onChange={handleCampaignChange}
                  />
                </div>
              </InlineStack>

              <Divider />

              {influencers.length === 0 ? (
                <Text as="p" tone="subdued">No influencers found. Add influencers to a campaign to get started.</Text>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #E1E3E5" }}>
                        {["Influencer", "Campaign", "Sessions", "Add to cart", "Purchases", "Conv. rate", "Revenue", "AOV", "Primary role", "Status"].map((h) => (
                          <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: "#6D7175", fontWeight: 500, whiteSpace: "nowrap" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {influencers.map((inf, i) => (
                        <tr
                          key={inf.id}
                          onClick={() => navigate(`/app/campaigns/${inf.campaignId}/influencers/${inf.id}`)}
                          style={{
                            borderBottom: i < influencers.length - 1 ? "1px solid #F1F2F3" : "none",
                            cursor: "pointer",
                            transition: "background 0.1s",
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#F9FAFB"}
                          onMouseLeave={(e) => e.currentTarget.style.background = ""}
                        >
                          <td style={{ padding: "12px 12px" }}>
                            <BlockStack gap="050">
                              <Text as="p" fontWeight="semibold">{inf.name}</Text>
                              <Text as="p" tone="subdued" variant="bodySm">@{inf.handle}</Text>
                            </BlockStack>
                          </td>
                          <td style={{ padding: "12px 12px" }}>
                            <InlineStack gap="150" blockAlign="center">
                              <Badge>{inf.platform}</Badge>
                              <Text as="p" variant="bodySm" tone="subdued">{inf.campaignName}</Text>
                            </InlineStack>
                          </td>
                          <td style={{ padding: "12px 12px", fontVariantNumeric: "tabular-nums" }}>{inf.visitors.toLocaleString()}</td>
                          <td style={{ padding: "12px 12px", fontVariantNumeric: "tabular-nums" }}>{inf.addToCart.toLocaleString()}</td>
                          <td style={{ padding: "12px 12px", fontVariantNumeric: "tabular-nums" }}>{inf.purchases.toLocaleString()}</td>
                          <td style={{ padding: "12px 12px" }}>
                            <span style={{ color: inf.convRate > 10 ? "#008060" : inf.convRate > 3 ? "#B97504" : "#303030", fontWeight: 600 }}>
                              {inf.convRate}%
                            </span>
                          </td>
                          <td style={{ padding: "12px 12px", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{formatCurrency(inf.revenue)}</td>
                          <td style={{ padding: "12px 12px", fontVariantNumeric: "tabular-nums" }}>{formatCurrency(inf.aov)}</td>
                          <td style={{ padding: "12px 12px" }}>
                            {inf.primaryRole ? (
                              <BlockStack gap="050">
                                <Badge tone={roleTone(inf.primaryRole)}>{inf.primaryRole}</Badge>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {inf.introducerPct}% intro · {inf.closerPct}% close
                                </Text>
                              </BlockStack>
                            ) : (
                              <Text as="p" tone="subdued">—</Text>
                            )}
                          </td>
                          <td style={{ padding: "12px 12px" }}>
                            <Badge tone="success">Active</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Role legend */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingSm" as="h2">Journey role guide</Text>
              <Divider />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone="warning">Introducer</Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Most often the first touch — they bring new visitors to the store for the first time.
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone="info">Influencer</Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Most often a middle touch — they nurture consideration but rarely open or close the journey.
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone="success">Closer</Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Most often the last touch — they get the final click and push visitors to purchase.
                  </Text>
                </BlockStack>
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
