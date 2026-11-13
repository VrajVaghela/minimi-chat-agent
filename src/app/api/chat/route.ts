import { handleTurn } from "@/lib/agent/orchestrator";
import { runtimeBits } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { conversationId?: unknown; message?: unknown };
  try {
    body = (await request.json()) as { conversationId?: unknown; message?: unknown };
  } catch {
    return Response.json({ error: "Send a JSON body with a message." }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return Response.json({ error: "Write a message first." }, { status: 400 });
  if (message.length > 8000) {
    return Response.json({ error: "That message is too long. Keep it under 8000 characters." }, { status: 400 });
  }
  const conversationId = typeof body.conversationId === "string" && body.conversationId ? body.conversationId : undefined;

  let bits: ReturnType<typeof runtimeBits>;
  try {
    bits = runtimeBits();
  } catch (error) {
    const text = error instanceof Error ? error.message : "Config failed.";
    return Response.json({ error: text }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        for await (const event of handleTurn({
          store: bits.store,
          search: bits.search,
          model: bits.model,
          now: Date.now(),
          timeZone: bits.config.timeZone,
          conversationId,
          message,
          signal: request.signal,
        })) {
          send(event.type, event.data);
        }
      } catch (error) {
        const text = error instanceof Error ? error.message : "Something went wrong.";
        send("error", { message: text });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
