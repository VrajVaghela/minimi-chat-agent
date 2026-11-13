import { runtimeBits } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  try {
    const { store } = runtimeBits();
    const conversation = store.getConversation(id);
    if (!conversation) return Response.json({ error: "No conversation with that id." }, { status: 404 });
    return Response.json({ conversation, messages: store.getMessages(id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read that conversation.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  try {
    const { store } = runtimeBits();
    if (!store.getConversation(id)) return Response.json({ error: "No conversation with that id." }, { status: 404 });
    store.deleteConversation(id);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete that conversation.";
    return Response.json({ error: message }, { status: 500 });
  }
}
