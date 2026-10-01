'use strict'

class PublicApplicantError extends Error {
  constructor(message, status = 422) {
    super(message)
    this.name = 'PublicApplicantError'
    this.status = status
  }
}

const clean = value => String(value ?? '').trim()
const lower = value => clean(value).toLowerCase()
const list = value => Array.isArray(value) ? value : []

/**
 * Prepare a public job application without looking up or attaching private
 * candidate records. Duplicate applications intentionally return the same
 * public shape and never identify the existing record.
 */
function preparePublicApplication({ input = {}, jobs = [], applications = [], now = new Date() } = {}) {
  const jobId = clean(input.jobId)
  const job = list(jobs).find(item => item.id === jobId && !['closed', 'cancelled', 'archived'].includes(lower(item.status)))
  if (!job) throw new PublicApplicantError('This job is unavailable.', 404)

  const details = input.candidateDetails || input
  const name = clean(details.name || [details.firstName, details.lastName].filter(Boolean).join(' '))
  const email = lower(details.email)
  if (!name || !email) throw new PublicApplicantError('Name and email are required.')

  const duplicate = list(applications).some(application =>
    application.jobId === jobId && lower(application.candidateEmail || application.email) === email
  )
  const submittedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  return {
    status: duplicate ? 'received' : 'received',
    duplicateReview: duplicate,
    candidateId: null,
    candidateDetails: {
      name,
      email,
      phone: clean(details.phone),
      profileUrl: clean(details.profileUrl || details.linkedin),
      resume: details.resume || null
    },
    jobId,
    jobTitle: job.title || '',
    source: 'Public application',
    sourceCategory: 'public_application',
    submittedAt
  }
}

module.exports = { PublicApplicantError, preparePublicApplication }
