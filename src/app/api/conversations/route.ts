import { runtimeBits } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const { store } = runtimeBits();
    return Response.json({ conversations: store.listConversations() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read conversations.";
    return Response.json({ error: message }, { status: 500 });
  }
}
