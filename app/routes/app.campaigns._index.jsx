import { useLoaderData, useNavigate } from "react-router";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  EmptyState,
  InlineStack,
  Layout,
  Page,
  ProgressBar,
  Text,
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getEnrichedCampaigns } from "../services/analytics.server";

function statusTone(status) {
  const value = String(status || "").toLowerCase();
  if (value === "active") return "success";
  if (value === "draft") return "attention";
  if (value === "completed") return "info";
  return "new";
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatCurrency(val) {
  return `$${Number(val || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await db.store.findUnique({ where: { shop: session.shop } });
  if (!store) throw new Response("Store not found", { status: 404 });

  const campaigns = await getEnrichedCampaigns(store.id);
  const totalInfluencers = campaigns.reduce((sum, c) => sum + c.influencerCount, 0);

  return { campaigns, totalInfluencers };
};

export default function CampaignsListPage() {
  const { campaigns, totalInfluencers } = useLoaderData();
  const navigate = useNavigate();

  return (
    <Page
      title="Campaigns"
      subtitle={`${campaigns.length} campaign${campaigns.length !== 1 ? "s" : ""} \u00B7 ${totalInfluencers} active influencers`}
      primaryAction={{ content: "New Campaign", onAction: () => navigate("/app/campaigns/new") }}
    >
      <ui-title-bar title="Campaigns" />
      <Layout>
        <Layout.Section>
          {campaigns.length === 0 ? (
            <Card>
              <EmptyState
                heading="No campaigns yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <Text as="p" tone="subdued">
                  Create your first campaign to start assigning influencers and
                  tracking attribution.
                </Text>
                <div style={{ marginTop: "12px" }}>
                  <Button onClick={() => navigate("/app/campaigns/new")}>
                    Create campaign
                  </Button>
                </div>
              </EmptyState>
            </Card>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
              {campaigns.map((campaign) => {
                const budgetPct = campaign.budget && campaign.budget > 0
                  ? Math.min(Math.round((campaign.revenue / campaign.budget) * 100), 100)
                  : null;

                return (
                  <div
                    key={campaign.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => navigate(`/app/campaigns/${campaign.id}`)}
                  >
                    <Card>
                      <BlockStack gap="300">
                        {/* Header */}
                        <InlineStack align="space-between" blockAlign="start">
                          <Text variant="headingSm" as="h3" fontWeight="bold">
                            {campaign.name}
                          </Text>
                          <Badge tone={statusTone(campaign.status)}>
                            {campaign.status}
                          </Badge>
                        </InlineStack>
                        <Text as="p" tone="subdued" variant="bodySm">
                          {formatDate(campaign.startDate)}
                          {campaign.endDate ? ` \u2013 ${formatDate(campaign.endDate)}` : ""}
                          {` \u00B7 ${campaign.influencerCount} influencer${campaign.influencerCount !== 1 ? "s" : ""}`}
                        </Text>

                        {/* Metrics grid */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                          <BlockStack gap="050">
                            <Text as="p" tone="subdued" variant="bodySm">Revenue</Text>
                            <Text as="p" fontWeight="semibold">{formatCurrency(campaign.revenue)}</Text>
                          </BlockStack>
                          <BlockStack gap="050">
                            <Text as="p" tone="subdued" variant="bodySm">Conv. rate</Text>
                            <Text as="p" fontWeight="semibold" tone={campaign.convRate > 5 ? "success" : undefined}>
                              {campaign.convRate}%
                            </Text>
                          </BlockStack>
                          <BlockStack gap="050">
                            <Text as="p" tone="subdued" variant="bodySm">Visitors</Text>
                            <Text as="p" fontWeight="semibold">{campaign.visitors.toLocaleString()}</Text>
                          </BlockStack>
                          <BlockStack gap="050">
                            <Text as="p" tone="subdued" variant="bodySm">Purchases</Text>
                            <Text as="p" fontWeight="semibold">{campaign.purchases}</Text>
                          </BlockStack>
                        </div>

                        {/* Budget utilisation */}
                        {budgetPct !== null && (
                          <BlockStack gap="100">
                            <InlineStack align="space-between">
                              <Text as="p" tone="subdued" variant="bodySm">Budget utilisation</Text>
                              <Text as="p" variant="bodySm" fontWeight="semibold">{budgetPct}%</Text>
                            </InlineStack>
                            <ProgressBar
                              progress={budgetPct}
                              tone={budgetPct >= 100 ? "success" : "primary"}
                              size="small"
                            />
                          </BlockStack>
                        )}
                      </BlockStack>
                    </Card>
                  </div>
                );
              })}
            </div>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
