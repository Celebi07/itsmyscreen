import { NextRequest, NextResponse } from "next/server";
import { fetchPollByCode } from "@/lib/pollData";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  DEVICE_COOKIE,
  buildIpHash,
  buildVoterHash,
  ensureDeviceId,
  getIpAddress,
  normalizeClientDeviceId,
} from "@/lib/serverUtils";

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const supabaseAdmin = getSupabaseAdmin();
  try {
    const poll = await fetchPollByCode(params.code.toUpperCase());
    if (!poll) {
      return NextResponse.json({ error: "Poll not found.", code: "NOT_FOUND" }, { status: 404 });
    }

    if (poll.isClosed) {
      return NextResponse.json({ error: "This poll is closed.", code: "POLL_CLOSED" }, { status: 409 });
    }

    const body = await req.json();
    const optionId = body.optionId;
    if (typeof optionId !== "string") {
      return NextResponse.json({ error: "optionId is required.", code: "VALIDATION_ERROR" }, { status: 400 });
    }

    const selectedOption = poll.options.find((option) => option.id === optionId);
    if (!selectedOption) {
      return NextResponse.json(
        { error: "Selected option does not belong to this poll.", code: "INVALID_OPTION" },
        { status: 400 },
      );
    }

    const ipHash = buildIpHash(poll.id, getIpAddress(req));
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();

    const { count, error: rateError } = await supabaseAdmin
      .from("votes")
      .select("id", { count: "exact", head: true })
      .eq("poll_id", poll.id)
      .eq("ip_hash", ipHash)
      .gte("created_at", oneMinuteAgo);

    if (rateError) {
      console.error("Rate limit check error", rateError);
      return NextResponse.json({ error: "Failed to validate rate limit.", code: "SERVER_ERROR" }, { status: 500 });
    }

    if ((count ?? 0) >= 5) {
      return NextResponse.json(
        { error: "Too many votes from this IP. Try again shortly.", code: "RATE_LIMITED", retryAfterSeconds: 60 },
        { status: 429 },
      );
    }

    const immediateWindow = new Date(Date.now() - 45_000).toISOString();
    const { count: recentCount, error: recentIpError } = await supabaseAdmin
      .from("votes")
      .select("id", { count: "exact", head: true })
      .eq("poll_id", poll.id)
      .eq("ip_hash", ipHash)
      .gte("created_at", immediateWindow);

    if (recentIpError) {
      console.error("Recent IP vote check error", recentIpError);
      return NextResponse.json({ error: "Failed duplicate vote check.", code: "SERVER_ERROR" }, { status: 500 });
    }

    if ((recentCount ?? 0) > 0) {
      return NextResponse.json(
        { error: "A vote from this network was just recorded. Please wait briefly.", code: "DUPLICATE_IP_RECENT" },
        { status: 409 },
      );
    }

    const cookieDeviceId = req.cookies.get(DEVICE_COOKIE.key)?.value;
    const clientDeviceId = normalizeClientDeviceId(body.deviceId);
    const deviceId = ensureDeviceId(cookieDeviceId ?? clientDeviceId);
    const voterHash = buildVoterHash(poll.id, deviceId);

    const { error: voteError } = await supabaseAdmin.from("votes").insert({
      poll_id: poll.id,
      option_id: selectedOption.id,
      voter_hash: voterHash,
      ip_hash: ipHash,
    });

    if (voteError) {
      console.error("Insert vote error", voteError);
      if (voteError.code === "23505") {
        return NextResponse.json({ error: "This device already voted.", code: "ALREADY_VOTED" }, { status: 409 });
      }
      return NextResponse.json({ error: "Failed to cast vote.", code: "SERVER_ERROR" }, { status: 500 });
    }

    const refreshedPoll = await fetchPollByCode(params.code.toUpperCase());

    const response = NextResponse.json(
      { data: { ok: true, selectedOptionId: selectedOption.id, poll: refreshedPoll } },
      { status: 201 },
    );

    if (!cookieDeviceId || cookieDeviceId !== deviceId) {
      response.cookies.set({
        name: DEVICE_COOKIE.key,
        value: deviceId,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: DEVICE_COOKIE.maxAge,
      });
    }

    return response;
  } catch (error) {
    console.error("POST /api/polls/[code]/vote error", error);
    return NextResponse.json({ error: "Unexpected server error.", code: "SERVER_ERROR" }, { status: 500 });
  }
}
