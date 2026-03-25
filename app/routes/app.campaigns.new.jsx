import { useMemo, useState } from "react";
import { Form, redirect, useActionData, useLoaderData, useNavigate } from "react-router";
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
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const PLATFORM_OPTIONS = [
  { label: "TikTok", value: "tiktok" },
  { label: "Instagram", value: "instagram" },
  { label: "YouTube", value: "youtube" },
  { label: "Other", value: "other" },
];

function createRow() {
  return { name: "", handle: "", platform: "instagram" };
}

function buildTrackingUrl(baseUrl, wfId) {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("wf_id", wfId);
    return url.toString();
  } catch {
    const sep = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${sep}wf_id=${wfId}`;
  }
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await db.store.findUnique({ where: { shop: session.shop } });
  if (!store) throw new Response("Store not found", { status: 404 });
  return { store };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await db.store.findUnique({ where: { shop: session.shop } });
  if (!store) throw new Response("Store not found", { status: 404 });

  const formData = await request.formData();
  const campaignName = String(formData.get("name") || "").trim();
  const startDate = String(formData.get("startDate") || "").trim();
  const endDate = String(formData.get("endDate") || "").trim();
  const budgetRaw = String(formData.get("budget") || "").trim();
  const storeUrlInput = String(formData.get("storeUrl") || "").trim();
  const influencersRaw = String(formData.get("influencers") || "[]");

  if (!campaignName) return { error: "Campaign name is required." };

  let influencers = [];
  try {
    const parsed = JSON.parse(influencersRaw);
    if (Array.isArray(parsed)) influencers = parsed;
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
      budget: budgetRaw ? parseFloat(budgetRaw) : null,
    },
  });

  const valid = influencers
    .map((i) => ({
      name: String(i?.name || "").trim(),
      handle: String(i?.handle || "").trim(),
      platform: String(i?.platform || "instagram"),
    }))
    .filter((i) => i.name && i.handle);

  for (const inf of valid) {
    const wfId = globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    await db.influencer.create({
      data: {
        campaignId: campaign.id,
        name: inf.name,
        handle: inf.handle,
        platform: inf.platform,
        wfId,
        targetUrl,
        trackingUrl: buildTrackingUrl(targetUrl, wfId),
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
  const [budget, setBudget] = useState("");
  const [storeUrl, setStoreUrl] = useState(`https://${store.shop}`);
  const [influencers, setInfluencers] = useState([createRow()]);

  const influencersPayload = useMemo(
    () => JSON.stringify(influencers),
    [influencers],
  );

  const update = (index, field, value) =>
    setInfluencers((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );

  return (
    <Page
      title="New Campaign"
      backAction={{ content: "Campaigns", onAction: () => navigate("/app/campaigns") }}
    >
      <ui-title-bar title="New Campaign" />
      <Card>
        <Form method="post">
          <BlockStack gap="400">
            {actionData?.error && (
              <Banner tone="critical" title={actionData.error} />
            )}
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
                type="number"
                label="Budget ($)"
                name="budget"
                value={budget}
                onChange={setBudget}
                autoComplete="off"
                placeholder="e.g. 5000"
                helpText="Optional — used to track budget utilisation on campaign cards"
                prefix="$"
              />
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
            <Text as="h2" variant="headingSm">
              Add influencers
            </Text>
            {influencers.map((inf, index) => (
              <Card key={index}>
                <BlockStack gap="300">
                  <FormLayout>
                    <TextField
                      label="Influencer name"
                      value={inf.name}
                      onChange={(v) => update(index, "name", v)}
                      autoComplete="off"
                    />
                    <TextField
                      label="Handle/username"
                      value={inf.handle}
                      onChange={(v) => update(index, "handle", v)}
                      autoComplete="off"
                      prefix="@"
                    />
                    <Select
                      label="Platform"
                      options={PLATFORM_OPTIONS}
                      value={inf.platform}
                      onChange={(v) => update(index, "platform", v)}
                    />
                  </FormLayout>
                  <InlineStack align="space-between">
                    <Button
                      variant="plain"
                      onClick={() =>
                        setInfluencers((p) => [...p, createRow()])
                      }
                    >
                      Add another influencer
                    </Button>
                    {index > 0 && (
                      <Button
                        tone="critical"
                        variant="plain"
                        onClick={() =>
                          setInfluencers((p) =>
                            p.filter((_, i) => i !== index),
                          )
                        }
                      >
                        Remove
                      </Button>
                    )}
                  </InlineStack>
                </BlockStack>
              </Card>
            ))}
            <input
              type="hidden"
              name="influencers"
              value={influencersPayload}
            />
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