import { boundary } from "@shopify/shopify-app-react-router/server";
import { Link, useLoaderData, useNavigate } from "react-router";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IndexTable,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";

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
  return date.toLocaleDateString("en-US");
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await db.store.findUnique({ where: { shop: session.shop } });

  if (!store) {
    throw new Response("Store not found", { status: 404 });
  }

  const baseCampaigns = await db.campaign.findMany({
    where: { storeId: store.id },
    include: {
      _count: {
        select: {
          influencers: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const campaigns = await Promise.all(
    baseCampaigns.map(async (campaign) => {
      const ordersCount = await db.order.count({
        where: {
          influencer: {
            campaignId: campaign.id,
          },
        },
      });

      return {
        ...campaign,
        _count: {
          ...campaign._count,
          orders: ordersCount,
        },
      };
    }),
  );

  return { campaigns, store };
};

export default function CampaignsListPage() {
  const { campaigns } = useLoaderData();
  const navigate = useNavigate();

  return (
    <Page
      title="Campaigns"
      primaryAction={{ content: "New Campaign", onAction: () => navigate("/app/campaigns/new") }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            {campaigns.length === 0 ? (
              <EmptyState
                heading="No campaigns yet"
                action={{ content: "Create campaign", onAction: () => navigate("/app/campaigns/new") }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <Text as="p" tone="subdued">
                  Create your first campaign to start assigning influencers and
                  tracking attribution.
                </Text>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "campaign", plural: "campaigns" }}
                itemCount={campaigns.length}
                selectable={false}
                headings={[
                  { title: "Name" },
                  { title: "Status" },
                  { title: "Influencers" },
                  { title: "Orders" },
                  { title: "Start date" },
                  { title: "Actions" },
                ]}
              >
                {campaigns.map((campaign, index) => (
                  <IndexTable.Row
                    id={campaign.id}
                    key={campaign.id}
                    position={index}
                    onClick={() => navigate(`/app/campaigns/${campaign.id}`)}
                  >
                    <IndexTable.Cell>
                    <Text as="span" fontWeight="semibold">{campaign.name}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={statusTone(campaign.status)}>
                        {campaign.status}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{campaign._count.influencers}</IndexTable.Cell>
                    <IndexTable.Cell>{campaign._count.orders}</IndexTable.Cell>
                    <IndexTable.Cell>{formatDate(campaign.startDate)}</IndexTable.Cell>
                    <IndexTable.Cell>
                    <Button variant="plain" onClick={() => navigate(`/app/campaigns/${campaign.id}`)}>View</Button>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
export const headers = (headersArgs) => boundary.headers(headersArgs);