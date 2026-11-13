import { runtimeBits } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const { config, search } = runtimeBits();
    return Response.json({
      ok: true,
      timezone: config.timeZone,
      now: new Date().toISOString(),
      model: {
        enabled: config.model.mode === "openai",
        name: config.model.mode === "openai" ? config.model.model : null,
      },
      search: {
        provider: search.name,
        live: search.live,
        note: search.note ?? null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Config failed.";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
