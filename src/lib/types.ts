export type CareerApplication = {
  number: number;
  date: string;
  company: string;
  role: string;
  status: string;
  score: number | null;
  scoreRaw: string;
  hasPDF: boolean;
  reportPath: string | null;
  reportNumber: string | null;
  notes: string;
  jobURL: string | null;
  archetype?: string;
  tldr?: string;
  remote?: string;
  compEstimate?: string;
};

export type PipelineMetrics = {
  total: number;
  byStatus: Record<string, number>;
  avgScore: number;
  topScore: number;
  withPDF: number;
  actionable: number;
};

export type FunnelStage = { label: string; count: number; pct: number };
export type ScoreBucket = { label: string; count: number };
export type WeekActivity = { week: string; count: number };

export type ProgressMetrics = {
  funnelStages: FunnelStage[];
  scoreBuckets: ScoreBucket[];
  weeklyActivity: WeekActivity[];
  responseRate: number;
  interviewRate: number;
  offerRate: number;
  avgScore: number;
  topScore: number;
  totalOffers: number;
  activeApps: number;
};

export type ReportSummary = {
  id: string;
  number: string;
  company: string;
  date: string;
  path: string;
};

export type ReportContent = ReportSummary & {
  markdown: string;
  url?: string;
  legitimacy?: string;
};

export type ProfileBundle = {
  cvMarkdown: string | null;
  soulMarkdown: string | null;
  configYaml: string | null;
  configParsed: unknown | null;
};

export type ReportMeta = {
  id: string;
  number: string;
  company: string;
  date: string;
  path: string;
};

export type PipelineItem = {
  checked: boolean;
  line: string;
};
