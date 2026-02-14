import { NextResponse } from "next/server";
import { fetchPollByCode } from "@/lib/pollData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_: Request, { params }: { params: { code: string } }) {
  try {
    const poll = await fetchPollByCode(params.code.toUpperCase());

    if (!poll) {
      return NextResponse.json({ error: "Poll not found.", code: "NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json({ data: poll }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/polls/[code] error", error);
    return NextResponse.json({ error: "Failed to load poll.", code: "SERVER_ERROR" }, { status: 500 });
  }
}
