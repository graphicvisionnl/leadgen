export type LeadStatus =
  | 'scraped'
  | 'no_email'
  | 'qualified'
  | 'disqualified'
  | 'redesigned'
  | 'deployed'
  | 'sent'
  | 'error'

export type CrmStatus =
  | 'not_contacted'
  | 'contacted'
  | 'replied'
  | 'interested'
  | 'closed'
  | 'rejected'

export type ReplyClassification =
  | 'interested'
  | 'question'
  | 'price_check'
  | 'busy_later'
  | 'not_interested'
  | 'out_of_office'
  | 'other'

export type LeadSegment =
  | 'no_website'
  | 'low_reviews'
  | 'ideal'
  | 'high_reviews'
  | 'high_rating'

export interface ScoreBreakdown {
  website_exists: boolean
  email_found: boolean
  phone_found: boolean
  mobile_friendly: boolean
  has_cta: boolean
  outdated_feel: boolean
  internal_link_count: number
}

export interface EmailVariant {
  label: 'A' | 'B' | 'C'
  subject: string
  body: string
}

export interface Lead {
  id: string
  company_name: string | null
  website_url: string | null
  email: string | null
  city: string | null
  niche: string | null
  segment: LeadSegment | null
  google_rating: number | null
  review_count: number | null
  status: LeadStatus
  qualify_reason: string | null
  screenshot_url: string | null
  preview_url: string | null
  preview_screenshot_url: string | null
  gmail_draft_id: string | null
  pipeline_run_id: string | null
  email_subject: string | null
  email_body: string | null
  created_at: string
  updated_at: string
  // Contact data
  phone: string | null
  whatsapp_url: string | null
  facebook_url: string | null
  instagram_url: string | null
  // Lead scoring
  lead_score: number | null
  hot_lead: boolean | null
  score_breakdown: ScoreBreakdown | null
  // CRM
  crm_status: CrmStatus | null
  // Email sequences
  email_sequence_index: number | null
  next_followup_at: string | null
  sequence_stopped: boolean | null
  email1_subject: string | null
  email1_body: string | null
  email2_subject: string | null
  email2_body: string | null
  email3_subject: string | null
  email3_body: string | null
  email4_subject: string | null
  email4_body: string | null
  email1_sent_at: string | null
  email2_sent_at: string | null
  email3_sent_at: string | null
  email4_sent_at: string | null
  email_variants: EmailVariant[] | null
  selected_variant: number | null
  // Email 1 A/B variant
  email1_variant_type: 'text_only' | 'painpoint_screenshot' | null
  painpoint_screenshot_url: string | null
  // Reply tracking
  reply_received_at: string | null
  reply_text: string | null
  reply_classification: ReplyClassification | null
  email2_draft_ready: boolean | null
}

export interface PipelineRun {
  id: string
  niche: string
  city: string
  scraped_count: number
  qualified_count: number
  deployed_count: number
  started_at: string
  completed_at: string | null
  status: 'running' | 'completed' | 'failed'
  error: string | null
}

export interface PipelineRunRequest {
  niche: string
  city: string
  maxLeads?: number
}

export interface ApifyBusinessResult {
  title: string
  website: string | null
  email: string | null
  city: string | null
  totalScore: number | null
  reviewsCount: number | null
  categoryName: string | null
  url: string | null
}

export interface QualificationResult {
  qualified: boolean
  reason: string
  score: number
}

export interface Settings {
  auto_mode?: 'manual' | 'auto_draft' | 'auto_send'
  cities_list?: string   // JSON array string
  niches_list?: string   // JSON array string
  city_rotation_index?: string
  niche_rotation_index?: string
  max_leads?: string
  email_signature?: string
  // Legacy fields kept for backwards compat
  default_niche?: string
  default_city?: string
}
