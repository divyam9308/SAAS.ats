'use strict'

const CATEGORY_KEYS = Object.freeze(['assignments', 'approvals', 'interviews', 'overdueFeedback', 'tasks', 'offers', 'joining', 'automation'])

function hasInAppChannel(config = {}) {
  const channels = config.notifications?.channels
  // Older tenant configs did not persist channels; retain the historical in-app default.
  if (channels === undefined || channels === null) return true
  if (Array.isArray(channels)) return channels.includes('in_app')
  if (typeof channels === 'object') return channels.in_app !== false
  return channels === 'in_app'
}

function hasNotificationsModule(config = {}) {
  const module = config.modules?.notifications
  if (module === false) return false
  if (module && typeof module === 'object' && module.enabled === false) return false
  return true
}

function notificationCategory({ actionConfig = {}, event = '', record = {}, actionType = '' } = {}) {
  if (CATEGORY_KEYS.includes(actionConfig.category)) return actionConfig.category
  const eventText = `${event} ${record.__kind || ''}`.toLowerCase().replace(/[^a-z]/g, '')
  const type = String(actionType || actionConfig.type || actionConfig.action || '').toLowerCase().replace(/[-\s]/g, '_')
  if (type === 'assign' || type === 'assign_owner' || /assign/.test(eventText)) return 'assignments'
  if (type === 'approval' || type === 'request_approval' || /approval/.test(eventText)) return 'approvals'
  if (/overduefeedback|feedbackoverdue/.test(eventText)) return 'overdueFeedback'
  if (/interview/.test(eventText)) return 'interviews'
  if (/offer/.test(eventText)) return 'offers'
  if (/onboarding|joining/.test(eventText)) return 'joining'
  if (/task/.test(eventText) || type === 'task' || type === 'create_task') return 'tasks'
  return 'automation'
}

function allowsAutomationNotification(config = {}, details = {}) {
  if (!hasNotificationsModule(config)) return { allowed: false, reason: 'notifications module is disabled', category: notificationCategory(details) }
  if (!hasInAppChannel(config)) return { allowed: false, reason: 'in_app channel is disabled', category: notificationCategory(details) }
  const category = notificationCategory(details)
  const userId = details.userId
  const userPreferences = userId
    ? config.notifications?.userPreferences?.[userId] || config.notifications?.preferences?.users?.[userId]
    : null
  if (config.notifications?.preferences?.[category] === false || userPreferences?.[category] === false) {
    return { allowed: false, reason: `notification category ${category} is disabled`, category }
  }
  return { allowed: true, category }
}

module.exports = { CATEGORY_KEYS, hasInAppChannel, hasNotificationsModule, notificationCategory, allowsAutomationNotification }
