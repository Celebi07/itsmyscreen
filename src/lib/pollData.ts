import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { PollDetails } from "@/lib/types";


export async function fetchPollByCode(code: string): Promise<PollDetails | null> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data: poll, error: pollError } = await supabaseAdmin
    .from("polls")
    .select("id, room_code, question, is_closed")
    .eq("room_code", code)
    .maybeSingle();

  if (pollError) {
    throw pollError;
  }
  if (!poll) {
    return null;
  }

  const [{ data: options, error: optionsError }, { data: groupedVotes, error: votesError }] =
    await Promise.all([
      supabaseAdmin
        .from("poll_options")
        .select("id, text")
        .eq("poll_id", poll.id)
        .order("created_at", { ascending: true }),
      supabaseAdmin.from("votes").select("option_id").eq("poll_id", poll.id),
    ]);

  if (optionsError) {
    throw optionsError;
  }
  if (votesError) {
    throw votesError;
  }

  const voteCountByOption = (groupedVotes ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.option_id] = (acc[row.option_id] ?? 0) + 1;
    return acc;
  }, {});

  const normalizedOptions = (options ?? []).map((option) => ({
    id: option.id,
    text: option.text,
    votes: voteCountByOption[option.id] ?? 0,
  }));

  return {
    id: poll.id,
    code: poll.room_code,
    question: poll.question,
    isClosed: poll.is_closed,
    totalVotes: (groupedVotes ?? []).length,
    options: normalizedOptions,
  };
}
