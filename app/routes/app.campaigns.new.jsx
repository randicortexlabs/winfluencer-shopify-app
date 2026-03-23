import { boundary } from "@shopify/shopify-app-react-router/server";
import { useMemo, useState } from "react";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigate,
} from "react-router";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  FormLayout,
  InlineStack,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const PLATFORM_OPTIONS = [
  { label: "TikTok", value: "tiktok" },
  { label: "Instagram", value: "instagram" },
  { label: "YouTube", value: "youtube" },
  { label: "Other", value: "other" },
];

function createInfluencerRow() {
  return {
    name: "",
    handle: "",
    platform: "instagram",
  };
}

function buildTrackingUrl(baseUrl, wfId) {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("wf_id", wfId);
    return url.toString();
  } catch {
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}wf_id=${wfId}`;
  }
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await db.store.findUnique({ where: { shop: session.shop } });

  if (!store) {
    throw new Response("Store not found", { status: 404 });
  }

  return { store };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await db.store.findUnique({ where: { shop: session.shop } });

  if (!store) {
    throw new Response("Store not found", { status: 404 });
  }

  const formData = await request.formData();
  const campaignName = String(formData.get("name") || "").trim();
  const startDate = String(formData.get("startDate") || "").trim();
  const endDate = String(formData.get("endDate") || "").trim();
  const storeUrlInput = String(formData.get("storeUrl") || "").trim();
  const influencersRaw = String(formData.get("influencers") || "[]");

  if (!campaignName) {
    return {
      error: "Campaign name is required.",
    };
  }

  let influencers = [];
  try {
    const parsed = JSON.parse(influencersRaw);
    if (Array.isArray(parsed)) {
      influencers = parsed;
    }
  } catch {
    influencers = [];
  }

  const targetUrl = storeUrlInput || `https://${store.shop}`;

  const campaign = await db.campaign.create({
    data: {
      storeId: store.id,
      name: campaignName,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
    },
  });

  const normalizedInfluencers = influencers
    .map((influencer) => ({
      name: String(influencer?.name || "").trim(),
      handle: String(influencer?.handle || "").trim(),
      platform: String(influencer?.platform || "instagram").trim() || "instagram",
    }))
    .filter((influencer) => influencer.name && influencer.handle);

  for (const influencer of normalizedInfluencers) {
    const wfId = globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const trackingUrl = buildTrackingUrl(targetUrl, wfId);

    await db.influencer.create({
      data: {
        campaignId: campaign.id,
        name: influencer.name,
        handle: influencer.handle,
        platform: influencer.platform,
        wfId,
        targetUrl,
        trackingUrl,
      },
    });
  }

  return redirect("/app/campaigns");
};

export default function NewCampaignPage() {
  const { store } = useLoaderData();
  const actionData = useActionData();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [storeUrl, setStoreUrl] = useState(`https://${store.shop}`);
  const [influencers, setInfluencers] = useState([createInfluencerRow()]);

  const influencersPayload = useMemo(
    () => JSON.stringify(influencers),
    [influencers],
  );

  const updateInfluencer = (index, field, value) => {
    setInfluencers((prev) =>
      prev.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    );
  };

  const addInfluencer = () => {
    setInfluencers((prev) => [...prev, createInfluencerRow()]);
  };

  const removeInfluencer = (index) => {
    setInfluencers((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
  };

  return (
    <Page
      title="New Campaign"
      backAction={{ content: "Campaigns", onAction: () => navigate("/app/campaigns") }}
      secondaryActions={[
        {
          content: "Cancel",
          onAction: () => navigate("/app/campaigns"),
        },
      ]}
    >
      <Card>
        <Form method="post">
          <BlockStack gap="400">
            {actionData?.error ? (
              <Banner tone="critical" title={actionData.error} />
            ) : null}

            <FormLayout>
              <TextField
                label="Campaign name"
                name="name"
                value={name}
                onChange={setName}
                autoComplete="off"
                requiredIndicator
              />
              <InlineStack gap="300" align="start">
                <TextField
                  type="date"
                  label="Start date"
                  name="startDate"
                  value={startDate}
                  onChange={setStartDate}
                  autoComplete="off"
                />
                <TextField
                  type="date"
                  label="End date"
                  name="endDate"
                  value={endDate}
                  onChange={setEndDate}
                  autoComplete="off"
                />
              </InlineStack>
              <TextField
                label="Store URL for tracking"
                name="storeUrl"
                value={storeUrl}
                onChange={setStoreUrl}
                placeholder="https://yourstore.com/products/..."
                autoComplete="off"
                helpText="Visitors from influencer links will be tracked on this URL"
              />
            </FormLayout>

            <Divider />

            <BlockStack gap="300">
              <Text as="h2" variant="headingSm">
                Add influencers
              </Text>

              {influencers.map((influencer, index) => (
                <Card key={`influencer-row-${index}`}>
                  <BlockStack gap="300">
                    <FormLayout>
                      <TextField
                        label="Influencer name"
                        value={influencer.name}
                        onChange={(value) =>
                          updateInfluencer(index, "name", value)
                        }
                        autoComplete="off"
                      />
                      <TextField
                        label="Handle/username"
                        value={influencer.handle}
                        onChange={(value) =>
                          updateInfluencer(index, "handle", value)
                        }
                        autoComplete="off"
                        prefix="@"
                      />
                      <Select
                        label="Platform"
                        options={PLATFORM_OPTIONS}
                        value={influencer.platform}
                        onChange={(value) =>
                          updateInfluencer(index, "platform", value)
                        }
                      />
                    </FormLayout>

                    <InlineStack align="space-between">
                      <Button variant="plain" onClick={addInfluencer}>
                        Add another influencer
                      </Button>
                      {index > 0 ? (
                        <Button
                          tone="critical"
                          variant="plain"
                          onClick={() => removeInfluencer(index)}
                        >
                          Remove
                        </Button>
                      ) : (
                        <span />
                      )}
                    </InlineStack>
                  </BlockStack>
                </Card>
              ))}
            </BlockStack>

            <input type="hidden" name="influencers" value={influencersPayload} />

            <InlineStack align="end">
              <Button submit variant="primary">
                Create campaign
              </Button>
            </InlineStack>
          </BlockStack>
        </Form>
      </Card>
    </Page>
  );
}
export const headers = (headersArgs) => boundary.headers(headersArgs);