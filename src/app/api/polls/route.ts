import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { canonicalizeOption, normalizeOption } from "@/lib/serverUtils";


const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateRoomCode() {
  return Array.from({ length: 6 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join("");
}

function validatePollInput(questionRaw: unknown, optionsRaw: unknown) {
  if (typeof questionRaw !== "string") {
    return "Question is required.";
  }

  const question = questionRaw.trim();
  if (question.length < 5 || question.length > 200) {
    return "Question must be between 5 and 200 characters.";
  }

  if (!Array.isArray(optionsRaw)) {
    return "Options are required.";
  }

  const options = optionsRaw.map((entry) => normalizeOption(String(entry ?? ""))).filter(Boolean);

  if (options.length < 2 || options.length > 8) {
    return "Please provide between 2 and 8 options.";
  }

  for (const option of options) {
    if (option.length < 1 || option.length > 80) {
      return `Option \"${option}\" must be between 1 and 80 characters.`;
    }
  }

  const seen = new Map<string, string>();
  for (const option of options) {
    const canonical = canonicalizeOption(option);
    if (seen.has(canonical)) {
      return `Duplicate option detected: \"${option}\" duplicates \"${seen.get(canonical)}\".`;
    }
    seen.set(canonical, option);
  }

  return { question, options };
}

export async function POST(req: Request) {
  const supabaseAdmin = getSupabaseAdmin();
  try {
    const body = await req.json();
    const validation = validatePollInput(body.question, body.options);

    if (typeof validation === "string") {
      return NextResponse.json({ error: validation, code: "VALIDATION_ERROR" }, { status: 400 });
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const roomCode = generateRoomCode();
      const { data: insertedPoll, error: pollError } = await supabaseAdmin
        .from("polls")
        .insert({ question: validation.question, room_code: roomCode })
        .select("id, room_code")
        .single();

      if (pollError) {
        if (pollError.code === "23505") {
          continue;
        }
        console.error("Create poll error", pollError);
        return NextResponse.json({ error: "Failed to create poll.", code: "SERVER_ERROR" }, { status: 500 });
      }

      const optionsPayload = validation.options.map((text) => ({ poll_id: insertedPoll.id, text }));
      const { error: optionsError } = await supabaseAdmin.from("poll_options").insert(optionsPayload);

      if (optionsError) {
        console.error("Create poll options error", optionsError);
        await supabaseAdmin.from("polls").delete().eq("id", insertedPoll.id);
        return NextResponse.json({ error: "Failed to create options.", code: "SERVER_ERROR" }, { status: 500 });
      }

      return NextResponse.json({ data: { code: insertedPoll.room_code } }, { status: 201 });
    }

    return NextResponse.json(
      { error: "Could not generate unique room code. Please retry.", code: "ROOM_CODE_COLLISION" },
      { status: 500 },
    );
  } catch (error) {
    console.error("POST /api/polls error", error);
    return NextResponse.json({ error: "Unexpected server error.", code: "SERVER_ERROR" }, { status: 500 });
  }
}
