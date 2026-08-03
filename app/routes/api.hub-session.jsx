const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Handle CORS preflight
export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  return new Response("Method not allowed", { status: 405 });
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  try {
    const { default: db } = await import("../db.server");
    const { sessionId, wfId, outcome, destination } = await request.json();

    if (!sessionId || !outcome) {
      return new Response(JSON.stringify({ ok: false, error: "Missing fields" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    await db.hubSession.update({
      where: { id: sessionId },
      data: {
        selectedWfId: wfId || null,
        destination: destination || null,
        outcome,
      },
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
};
