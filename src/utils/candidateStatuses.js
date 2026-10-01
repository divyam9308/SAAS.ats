import { companyConfig } from '../config/companyConfig'

export const CANDIDATE_PIPELINE = companyConfig.pipeline.filter(stage => stage.enabled)
export const CANDIDATE_STATUS_KEYS = CANDIDATE_PIPELINE.map(stage => stage.key)
export const CANDIDATE_STATUSES = CANDIDATE_PIPELINE.map(stage => stage.label)

export const CANDIDATE_STATUS_OPTIONS = ['', ...CANDIDATE_STATUSES]
export const DASHBOARD_CANDIDATE_STATUSES = [...CANDIDATE_STATUSES, '-']
export const REQUIRED_CANDIDATE_STATUS_ERROR = "Please select a status other than '-'."

export const isCandidateStatusSelected = (value) => {
  const status = typeof value === 'string' ? value.trim() : ''
  return Boolean(status && status !== '-')
}

export const candidateStatusFormValue = (value) => {
  const status = typeof value === 'string' ? value.trim() : ''
  return status === '-' ? '' : status
}

export const CANDIDATE_STATUS_BADGE_MAP = {
  Interested: 'badge-interested',
  'In Discussion': 'badge-in-discussion',
  'Not Interested': 'badge-not-interested',
  Interview: 'badge-interview',
  'Client Submission': 'badge-client-submission',
  Offered: 'badge-offered',
  Hired: 'badge-hired',
  'Offer Declined': 'badge-offer-declined',
  Dropout: 'badge-dropout',
  'Rejected by Recruiter': 'badge-rejected-recruiter',
  'Rejected by Client': 'badge-rejected-client',
  '-': 'badge-status-unset',
  ...Object.fromEntries(CANDIDATE_PIPELINE.map(stage => [stage.label, `badge-${stage.key.replaceAll('_', '-')}`])),
}
