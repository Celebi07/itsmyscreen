"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { PollDetails } from "@/lib/types";
import styles from "./room.module.css";

type RoomClientProps = {
  initialPoll: PollDetails;
};

export function RoomClient({ initialPoll }: RoomClientProps) {
  const [poll, setPoll] = useState(initialPoll);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [voteMessage, setVoteMessage] = useState<string | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [isVoting, setIsVoting] = useState(false);
  const [shareUrl, setShareUrl] = useState(`/room/${initialPoll.code}`);
  const [copied, setCopied] = useState(false);
  const [liveMessage, setLiveMessage] = useState<string | null>(null);
  const lastReconnectMessageAt = useRef(0);

  useEffect(() => {
    setShareUrl(`${window.location.origin}/room/${poll.code}`);
  }, [poll.code]);

  const fetchLatest = useCallback(
    async (showLiveBadge = false) => {
      try {
        const response = await fetch(`/api/polls/${poll.code}?t=${Date.now()}`, {
          cache: "no-store",
          next: { revalidate: 0 },
        });
        const payload = await response.json();
        if (!response.ok) {
          setVoteError(payload.error ?? "Could not refresh live results.");
          return;
        }

        setPoll(payload.data);
        if (showLiveBadge) {
          setLiveMessage("Updated live");
          setTimeout(() => setLiveMessage(null), 1200);
        }
      } catch (error) {
        console.error(error);
        setVoteError("Could not refresh live results.");
      }
    },
    [poll.code],
  );

  useEffect(() => {
    const channel = getSupabaseClient()
      .channel(`poll-${poll.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "votes", filter: `poll_id=eq.${poll.id}` },
        () => {
          void fetchLatest(true);
        },
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          const now = Date.now();
          if (now - lastReconnectMessageAt.current > 8000) {
            setLiveMessage("Reconnecting live updates...");
            lastReconnectMessageAt.current = now;
          }
        }
      });

    const intervalId = setInterval(() => {
      void fetchLatest(false);
    }, 5000);

    return () => {
      clearInterval(intervalId);
      void getSupabaseClient().removeChannel(channel);
    };
  }, [fetchLatest, poll.id]);

  const selectedOption = useMemo(
    () => poll.options.find((option) => option.id === selectedOptionId),
    [poll.options, selectedOptionId],
  );

  const totalVotes = useMemo(() => poll.options.reduce((sum, option) => sum + option.votes, 0), [poll.options]);

  const handleVote = async (optionId: string) => {
    setVoteError(null);
    setIsVoting(true);

    try {
      const response = await fetch(`/api/polls/${poll.code}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setVoteError(payload.error ?? "Vote failed.");
        return;
      }

      setSelectedOptionId(optionId);
      setVoteMessage("Vote recorded.");

      if (payload.data?.poll) {
        setPoll(payload.data.poll as PollDetails);
        setLiveMessage("Updated live");
        setTimeout(() => setLiveMessage(null), 1200);
      } else {
        await fetchLatest(true);
      }
    } catch (error) {
      console.error(error);
      setVoteError("Network error while voting.");
    } finally {
      setIsVoting(false);
    }
  };

  return (
    <section className={`card ${styles.card}`}>
      <div className={styles.headerRow}>
        <h1>{poll.question}</h1>
        <span className={`${styles.badge} ${poll.isClosed ? styles.closed : styles.live}`}>
          {poll.isClosed ? "Closed" : "Live"}
        </span>
      </div>

      <div className={styles.shareBox}>
        <input readOnly value={shareUrl} />
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(shareUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>

      <p className={styles.totalVotes}>Total votes: {totalVotes}</p>

      <div className={styles.voteList}>
        {poll.options.map((option) => (
          <button
            key={option.id}
            onClick={() => handleVote(option.id)}
            disabled={isVoting || Boolean(selectedOptionId) || poll.isClosed}
            className={selectedOptionId === option.id ? styles.selected : ""}
          >
            <span>{option.text}</span>
            <span>{totalVotes === 0 ? "0%" : `${Math.round((option.votes / totalVotes) * 100)}%`}</span>
          </button>
        ))}
      </div>

      {selectedOption && <p className={styles.voteMsg}>You voted for {selectedOption.text}</p>}
      {voteMessage && <p className={styles.liveFeedback}>{voteMessage}</p>}
      {voteError && <p className={styles.error}>{voteError}</p>}
      {liveMessage && <p className={styles.liveFeedback}>{liveMessage}</p>}

      <div className={styles.results}>
        <h2>Results</h2>
        <p className={styles.totalVotes}>Total votes: {totalVotes}</p>
        {totalVotes === 0 ? (
          <p>No votes yet</p>
        ) : (
          poll.options.map((option) => {
            const pct = totalVotes === 0 ? 0 : (option.votes / totalVotes) * 100;
            return (
              <div key={`result-${option.id}`} className={styles.resultRow}>
                <div className={styles.resultMeta}>
                  <span>{option.text}</span>
                  <span>{option.votes}</span>
                </div>
                <div className={styles.barTrack}>
                  <div className={styles.barFill} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
