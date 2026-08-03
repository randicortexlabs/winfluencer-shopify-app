export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");

  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  return new Response();
};
