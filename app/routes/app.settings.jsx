import { useState } from "react";
import { Form, useActionData, useLoaderData } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  FormLayout,
  Icon,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { CheckCircleIcon } from "@shopify/polaris-icons";
import { boundary } from "@shopify/shopify-app-react-router/server";

const ROLE_OPTIONS = [
  { label: "Admin", value: "admin" },
  { label: "Viewer", value: "viewer" },
];

export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const { default: db } = await import("../db.server");

  const { session } = await authenticate.admin(request);
  const store = await db.store.findUnique({ where: { shop: session.shop } });
  if (!store) throw new Response("Store not found", { status: 404 });

  const eventCount = await db.event.count({ where: { storeId: store.id } }).catch(() => 0);
  const orderCount = await db.order.count({ where: { storeId: store.id } }).catch(() => 0);
  const teamMembers = await db.teamMember.findMany({
    where: { storeId: store.id },
    orderBy: { invitedAt: "asc" },
  }).catch(() => []);

  return {
    store: {
      id: store.id,
      shop: store.shop,
      pixelId: store.pixelId,
      createdAt: store.createdAt,
    },
    tracking: {
      hasPixel: !!store.pixelId,
      eventCount,
      orderCount,
    },
    teamMembers,
    ownerEmail: session?.onlineAccessInfo?.associated_user?.email || session.shop,
    ownerName: session?.onlineAccessInfo?.associated_user?.first_name
      ? `${session.onlineAccessInfo.associated_user.first_name} ${session.onlineAccessInfo.associated_user.last_name || ""}`.trim()
      : "Store Owner",
  };
};

export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const { default: db } = await import("../db.server");

  const { session } = await authenticate.admin(request);
  const store = await db.store.findUnique({ where: { shop: session.shop } });
  if (!store) throw new Response("Store not found", { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "invite") {
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const name = String(formData.get("memberName") || "").trim();
    const role = String(formData.get("role") || "viewer");

    if (!email) return { error: "Email is required." };
    if (!name) return { error: "Name is required." };
    if (!email.includes("@")) return { error: "Please enter a valid email." };

    try {
      await db.teamMember.create({
        data: { storeId: store.id, email, name, role },
      });
      return { success: `${name} has been invited as ${role}.` };
    } catch (err) {
      if (err?.code === "P2002") {
        return { error: "This email is already a team member." };
      }
      throw err;
    }
  }

  if (intent === "remove") {
    const memberId = String(formData.get("memberId") || "");
    await db.teamMember.delete({ where: { id: memberId } });
    return { success: "Team member removed." };
  }

  return {};
};

function TrackingStep({ title, description, active }) {
  return (
    <InlineStack gap="300" blockAlign="center" wrap={false}>
      <div style={{ color: active ? "#10B981" : "#94A3B8" }}>
        <Icon source={CheckCircleIcon} />
      </div>
      <BlockStack gap="050">
        <Text as="p" fontWeight="semibold">{title}</Text>
        <Text as="p" tone="subdued" variant="bodySm">{description}</Text>
      </BlockStack>
      <div style={{ marginLeft: "auto" }}>
        <Badge tone={active ? "success" : "attention"}>
          {active ? "Active" : "Pending"}
        </Badge>
      </div>
    </InlineStack>
  );
}

function roleTone(role) {
  if (role === "admin") return "info";
  return undefined;
}

function getInitials(name) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function SettingsPage() {
  const { store, tracking, teamMembers, ownerEmail, ownerName } = useLoaderData();
  const actionData = useActionData();

  const [email, setEmail] = useState("");
  const [memberName, setMemberName] = useState("");
  const [role, setRole] = useState("viewer");
  const [showInviteForm, setShowInviteForm] = useState(false);

  return (
    <Page title="Settings" subtitle="Store connection, tracking setup, and account">
      <ui-title-bar title="Settings" />
      <Layout>
        {/* Status banners */}
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

        {/* Theme App Extension Setup */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text variant="headingSm" as="h2">Theme App Extension setup</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    The Winfluencer App Embed must be enabled in your theme to capture influencer clicks on your storefront.
                  </Text>
                </BlockStack>
              </InlineStack>
              <Divider />
              <BlockStack gap="300">
                <Text as="p" fontWeight="semibold" variant="bodySm">How to enable the App Embed Block:</Text>
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="start">
                    <div style={{ width: "20px", height: "20px", borderRadius: "50%", backgroundColor: "#E8854A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Text as="p" variant="bodySm" fontWeight="bold" tone="text-inverse">1</Text>
                    </div>
                    <Text as="p" variant="bodySm">Click <strong>"Open Theme Editor"</strong> below — it opens directly to the App Embeds panel.</Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="start">
                    <div style={{ width: "20px", height: "20px", borderRadius: "50%", backgroundColor: "#E8854A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Text as="p" variant="bodySm" fontWeight="bold" tone="text-inverse">2</Text>
                    </div>
                    <Text as="p" variant="bodySm">In the left sidebar, find <strong>"Winfluencer"</strong> under App Embeds and toggle it <strong>on</strong>.</Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="start">
                    <div style={{ width: "20px", height: "20px", borderRadius: "50%", backgroundColor: "#E8854A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Text as="p" variant="bodySm" fontWeight="bold" tone="text-inverse">3</Text>
                    </div>
                    <Text as="p" variant="bodySm">Click <strong>"Save"</strong> in the top right corner of the theme editor.</Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="start">
                    <div style={{ width: "20px", height: "20px", borderRadius: "50%", backgroundColor: "#E8854A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Text as="p" variant="bodySm" fontWeight="bold" tone="text-inverse">4</Text>
                    </div>
                    <Text as="p" variant="bodySm">Return to Winfluencer and create your first campaign to generate <code>?wf_id=</code> tracking links.</Text>
                  </InlineStack>
                </BlockStack>
                <InlineStack gap="200">
                  <Button
                    url={`https://${store.shop}/admin/themes/current/editor?context=apps`}
                    external
                    variant="primary"
                  >
                    Open Theme Editor → App Embeds
                  </Button>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Tracking status */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingSm" as="h2">Tracking status</Text>
              <Divider />
              <BlockStack gap="400">
                <TrackingStep
                  title="Store connected via OAuth"
                  description={`${store.shop} \u00B7 Connected ${new Date(store.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
                  active={true}
                />
                <TrackingStep
                  title="Tracking snippet installed"
                  description="Injected into theme.liquid \u00B7 Capturing ?wf_id= parameters"
                  active={true}
                />
                <TrackingStep
                  title="Custom Pixel active"
                  description="page_viewed \u00B7 product_viewed \u00B7 add_to_cart \u00B7 checkout_started \u00B7 checkout_completed"
                  active={tracking.hasPixel}
                />
                <TrackingStep
                  title="Order webhook registered"
                  description="orders/create \u00B7 Server-side attribution \u00B7 90-day window"
                  active={true}
                />
                <TrackingStep
                  title="Cart attribute tracking"
                  description="wf_influencer_id persisting across browser switches \u00B7 IAB-proof"
                  active={true}
                />
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          {/* Store details */}
          <Card>
            <BlockStack gap="300">
              <Text variant="headingSm" as="h2">Store details</Text>
              <Divider />
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">Store URL</Text>
                  <Text as="p" fontWeight="semibold">{store.shop}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">Pixel ID</Text>
                  <Text as="p" fontWeight="semibold" variant="bodySm">{store.pixelId}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">Attribution model</Text>
                  <Text as="p" fontWeight="semibold">First touch &middot; 90 days</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">Events tracked</Text>
                  <Text as="p" fontWeight="semibold">{tracking.eventCount.toLocaleString()}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">Orders attributed</Text>
                  <Text as="p" fontWeight="semibold">{tracking.orderCount}</Text>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          {/* Team members */}
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingSm" as="h2">Team members</Text>
                <Button
                  variant="plain"
                  onClick={() => setShowInviteForm(!showInviteForm)}
                >
                  {showInviteForm ? "Cancel" : "Invite"}
                </Button>
              </InlineStack>
              <Divider />

              {/* Invite form */}
              {showInviteForm && (
                <Card>
                  <Form method="post">
                    <input type="hidden" name="intent" value="invite" />
                    <BlockStack gap="300">
                      <FormLayout>
                        <TextField
                          label="Name"
                          name="memberName"
                          value={memberName}
                          onChange={setMemberName}
                          autoComplete="off"
                        />
                        <TextField
                          label="Email"
                          name="email"
                          type="email"
                          value={email}
                          onChange={setEmail}
                          autoComplete="off"
                        />
                        <Select
                          label="Role"
                          name="role"
                          options={ROLE_OPTIONS}
                          value={role}
                          onChange={setRole}
                        />
                      </FormLayout>
                      <InlineStack align="end">
                        <Button submit variant="primary">
                          Send invite
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Form>
                </Card>
              )}

              {/* Owner */}
              <InlineStack gap="300" blockAlign="center">
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "50%",
                    background: "#FEF0EA",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: "700",
                    fontSize: "13px",
                    color: "#B8461A",
                    flexShrink: 0,
                  }}
                >
                  {getInitials(ownerName)}
                </div>
                <BlockStack gap="050">
                  <Text as="p" fontWeight="semibold">{ownerName}</Text>
                  <Text as="p" tone="subdued" variant="bodySm">{ownerEmail}</Text>
                </BlockStack>
                <div style={{ marginLeft: "auto" }}>
                  <Badge tone="attention">Owner</Badge>
                </div>
              </InlineStack>

              {/* Team members */}
              {teamMembers.map((member) => (
                <InlineStack gap="300" blockAlign="center" key={member.id}>
                  <div
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "50%",
                      background: "#DBEAFE",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: "700",
                      fontSize: "13px",
                      color: "#1E40AF",
                      flexShrink: 0,
                    }}
                  >
                    {getInitials(member.name)}
                  </div>
                  <BlockStack gap="050">
                    <Text as="p" fontWeight="semibold">{member.name}</Text>
                    <Text as="p" tone="subdued" variant="bodySm">{member.email}</Text>
                  </BlockStack>
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
                    <Badge tone={roleTone(member.role)}>{member.role}</Badge>
                    <Form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="intent" value="remove" />
                      <input type="hidden" name="memberId" value={member.id} />
                      <Button variant="plain" tone="critical" submit>
                        Remove
                      </Button>
                    </Form>
                  </div>
                </InlineStack>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
