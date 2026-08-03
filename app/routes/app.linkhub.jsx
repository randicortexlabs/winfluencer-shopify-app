import { useState, useCallback } from "react";
import { Form, useActionData, useLoaderData } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  Divider,
  FormLayout,
  InlineStack,
  Layout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const { default: db } = await import("../db.server");

  const { session } = await authenticate.admin(request);
  const store = await db.store.findUnique({ where: { shop: session.shop } });
  if (!store) throw new Response("Store not found", { status: 404 });

  // Upsert LinkHub so it always exists
  let linkHub = await db.linkHub.upsert({
    where: { storeId: store.id },
    create: { storeId: store.id },
    update: {},
  });

  // Load all influencers across all campaigns in this store
  const influencers = await db.influencer.findMany({
    where: { campaign: { storeId: store.id } },
    select: { wfId: true, name: true, handle: true, platform: true },
    orderBy: { name: "asc" },
  });

  return {
    shop: store.shop,
    linkHub: {
      enabled: linkHub.enabled,
      title: linkHub.title || "",
      destinations: Array.isArray(linkHub.destinations) ? linkHub.destinations : [],
      influencers: Array.isArray(linkHub.influencers) ? linkHub.influencers : [],
    },
    allInfluencers: influencers,
  };
};

export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const { default: db } = await import("../db.server");

  const { session } = await authenticate.admin(request);
  const store = await db.store.findUnique({ where: { shop: session.shop } });
  if (!store) throw new Response("Store not found", { status: 404 });

  const formData = await request.formData();

  const enabled = formData.get("enabled") === "true";
  const title = String(formData.get("title") || "").trim().slice(0, 120);

  let destinations = [];
  try {
    destinations = JSON.parse(formData.get("destinations") || "[]");
    if (!Array.isArray(destinations)) destinations = [];
    destinations = destinations
      .filter((d) => d.title && d.url)
      .map((d) => ({ title: String(d.title).slice(0, 80), url: String(d.url).slice(0, 500) }));
  } catch {}

  let influencers = [];
  try {
    influencers = JSON.parse(formData.get("influencers") || "[]");
    if (!Array.isArray(influencers)) influencers = [];
  } catch {}

  await db.linkHub.update({
    where: { storeId: store.id },
    data: { enabled, title: title || null, destinations, influencers },
  });

  return { success: "Link Hub settings saved." };
};

export default function LinkHubPage() {
  const { shop, linkHub, allInfluencers } = useLoaderData();
  const actionData = useActionData();

  const [enabled, setEnabled] = useState(linkHub.enabled);
  const [title, setTitle] = useState(linkHub.title);
  const [destinations, setDestinations] = useState(
    linkHub.destinations.length > 0
      ? linkHub.destinations
      : [{ title: "Shop Now", url: "/" }]
  );
  const [selectedWfIds, setSelectedWfIds] = useState(
    new Set((linkHub.influencers || []).map((inf) => inf.wfId))
  );
  const [copied, setCopied] = useState(false);

  const hubUrl = `https://${shop}/a/creators`;

  const addDestination = useCallback(() => {
    setDestinations((prev) => [...prev, { title: "", url: "" }]);
  }, []);

  const removeDestination = useCallback((i) => {
    setDestinations((prev) => prev.filter((_, idx) => idx !== i));
  }, []);

  const updateDestination = useCallback((i, field, value) => {
    setDestinations((prev) =>
      prev.map((d, idx) => (idx === i ? { ...d, [field]: value } : d))
    );
  }, []);

  const toggleInfluencer = useCallback((wfId, inf) => {
    setSelectedWfIds((prev) => {
      const next = new Set(prev);
      if (next.has(wfId)) {
        next.delete(wfId);
      } else {
        next.add(wfId);
      }
      return next;
    });
  }, []);

  const selectedInfluencers = allInfluencers
    .filter((inf) => selectedWfIds.has(inf.wfId))
    .map((inf) => ({ wfId: inf.wfId, name: inf.name, handle: inf.handle }));

  const copyLink = () => {
    navigator.clipboard.writeText(hubUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Page
      title="Link Hub"
      subtitle="A public page influencers share in their bio — visitors declare who brought them"
    >
      <ui-title-bar title="Link Hub" />
      <Layout>
        {actionData?.success && (
          <Layout.Section>
            <Banner tone="success" title={actionData.success} />
          </Layout.Section>
        )}
        {actionData?.error && (
          <Layout.Section>
            <Banner tone="critical" title={actionData.error} />
          </Layout.Section>
        )}

        <Form method="post">
          {/* Hidden fields for JSON payloads */}
          <input type="hidden" name="enabled" value={String(enabled)} />
          <input type="hidden" name="destinations" value={JSON.stringify(destinations)} />
          <input type="hidden" name="influencers" value={JSON.stringify(selectedInfluencers)} />

          {/* Hub status + link */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="headingSm" as="h2">Hub status</Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      When enabled, visitors can access your hub at the URL below.
                    </Text>
                  </BlockStack>
                  <Badge tone={enabled ? "success" : "attention"}>
                    {enabled ? "Live" : "Off"}
                  </Badge>
                </InlineStack>
                <Divider />
                <InlineStack gap="300" blockAlign="center">
                  <div style={{ flex: 1, background: "#F4F4F4", borderRadius: "8px", padding: "10px 14px", fontFamily: "monospace", fontSize: "13px", color: "#555", wordBreak: "break-all" }}>
                    {hubUrl}
                  </div>
                  <Button onClick={copyLink} variant="secondary">
                    {copied ? "Copied!" : "Copy link"}
                  </Button>
                </InlineStack>
                <InlineStack gap="200">
                  <Button
                    onClick={() => setEnabled(true)}
                    variant={enabled ? "primary" : "secondary"}
                  >
                    Enable
                  </Button>
                  <Button
                    onClick={() => setEnabled(false)}
                    variant={!enabled ? "primary" : "secondary"}
                    tone={!enabled ? "critical" : undefined}
                  >
                    Disable
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Title */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text variant="headingSm" as="h2">Hub title</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Shown at the top of the hub page. Defaults to your store name if blank.
                  </Text>
                </BlockStack>
                <Divider />
                <TextField
                  label="Title"
                  name="title"
                  value={title}
                  onChange={setTitle}
                  placeholder="e.g. Shop with your favorite creator"
                  autoComplete="off"
                  maxLength={120}
                  showCharacterCount
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Destinations */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="headingSm" as="h2">Destinations</Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      Buttons visitors see on the first screen. Add your key collections or pages.
                    </Text>
                  </BlockStack>
                  <Button onClick={addDestination} variant="plain">
                    + Add
                  </Button>
                </InlineStack>
                <Divider />
                <BlockStack gap="300">
                  {destinations.length === 0 && (
                    <Text as="p" tone="subdued" variant="bodySm">
                      No destinations yet. Add at least one so visitors can navigate.
                    </Text>
                  )}
                  {destinations.map((dest, i) => (
                    <InlineStack key={i} gap="200" blockAlign="end">
                      <div style={{ flex: 1 }}>
                        <FormLayout>
                          <FormLayout.Group condensed>
                            <TextField
                              label="Button label"
                              value={dest.title}
                              onChange={(v) => updateDestination(i, "title", v)}
                              placeholder="Shop Now"
                              autoComplete="off"
                            />
                            <TextField
                              label="URL"
                              value={dest.url}
                              onChange={(v) => updateDestination(i, "url", v)}
                              placeholder="/collections/all"
                              autoComplete="off"
                            />
                          </FormLayout.Group>
                        </FormLayout>
                      </div>
                      <div style={{ paddingBottom: "2px" }}>
                        <Button
                          variant="plain"
                          tone="critical"
                          onClick={() => removeDestination(i)}
                        >
                          Remove
                        </Button>
                      </div>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Influencers */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="headingSm" as="h2">Influencers on hub</Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      Select which influencers appear as name cards on the second screen.
                    </Text>
                  </BlockStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {selectedWfIds.size} selected
                  </Text>
                </InlineStack>
                <Divider />
                {allInfluencers.length === 0 ? (
                  <Text as="p" tone="subdued" variant="bodySm">
                    No influencers found. Add influencers to a campaign first.
                  </Text>
                ) : (
                  <BlockStack gap="200">
                    {allInfluencers.map((inf) => (
                      <InlineStack key={inf.wfId} gap="300" blockAlign="center">
                        <Checkbox
                          label=""
                          checked={selectedWfIds.has(inf.wfId)}
                          onChange={() => toggleInfluencer(inf.wfId, inf)}
                        />
                        <BlockStack gap="050">
                          <Text as="p" fontWeight="semibold">{inf.name}</Text>
                          <Text as="p" tone="subdued" variant="bodySm">
                            @{inf.handle} · {inf.platform}
                          </Text>
                        </BlockStack>
                      </InlineStack>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Save */}
          <Layout.Section>
            <InlineStack align="end">
              <Button submit variant="primary" size="large">
                Save settings
              </Button>
            </InlineStack>
          </Layout.Section>
        </Form>
      </Layout>
    </Page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
