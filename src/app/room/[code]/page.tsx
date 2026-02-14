import { notFound } from "next/navigation";
import { RoomClient } from "@/components/RoomClient";
import { fetchPollByCode } from "@/lib/pollData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RoomPage({ params }: { params: { code: string } }) {
  try {
    const poll = await fetchPollByCode(params.code.toUpperCase());

    if (!poll) {
      notFound();
    }

    return (
      <main>
        <RoomClient initialPoll={poll} />
      </main>
    );
  } catch (error) {
    console.error(error);
    notFound();
  }
}
