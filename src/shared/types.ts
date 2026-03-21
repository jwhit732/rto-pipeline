// Core data types for the RTO outreach pipeline

export interface RtoInput {
  rto_code: string;
  rto_name: string;
  contact_email: string;
  contact_name: string;
  contact_position: string;
  industry: string;
  training_packages: string;
  location: string;
}

export interface RtoEnriched extends RtoInput {
  api_status: string;
  api_name: string;
  scope_count: string;
  scope_summary: string;
  enriched_at: string;
  enrichment_error: string;
}

export interface EmailDraft {
  rto_code: string;
  rto_name: string;
  contact_name: string;
  contact_email: string;
  contact_position: string;
  subject: string;
  body: string;       // plain text — used by review CLI and as send fallback
  body_html?: string; // HTML with clickable tracked link — used by send script
  tracked_url: string;
  generated_at: string;
  status: DraftStatus;
  skip_reason: string | null;
}

export type DraftStatus = 'pending' | 'approved' | 'skipped' | 'sent' | 'failed';

export interface SendLogEntry {
  rto_code: string;
  rto_name: string;
  contact_email: string;
  subject: string;
  sent_at: string;
  status: 'success' | 'failed';
  error: string;
  gws_message_id: string;
}

// training.gov.au API response shape (partial — only what we use)
export interface TgaOrganisation {
  organisationId: string;
  code: string;
  name: string;
  isRto: boolean;
  rtoStatus: string;
  tradingNames: string[];
  scopes: TgaScope[];
}

export interface TgaScope {
  trainingPackageCode: string;
  trainingPackageName: string;
  [key: string]: unknown;
}
