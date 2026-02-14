export type PollOption = {
  id: string;
  text: string;
  votes: number;
};

export type PollDetails = {
  id: string;
  code: string;
  question: string;
  isClosed: boolean;
  totalVotes: number;
  options: PollOption[];
};
