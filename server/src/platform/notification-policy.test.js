'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { hasInAppChannel, notificationCategory, allowsAutomationNotification } = require('./notification-policy')

test('in-app remains enabled for legacy configs but honors explicit channel configuration', () => {
  assert.equal(hasInAppChannel({}), true)
  assert.equal(hasInAppChannel({ notifications: { channels: ['email'] } }), false)
  assert.equal(hasInAppChannel({ notifications: { channels: [] } }), false)
  assert.equal(hasInAppChannel({ notifications: { channels: { in_app: false } } }), false)
})

test('automation notification event/action types map to configured preference categories', () => {
  const cases = [
    [{ event: 'application.assigned' }, 'assignments'],
    [{ event: 'approval.requested' }, 'approvals'],
    [{ event: 'interview.scheduled' }, 'interviews'],
    [{ event: 'feedback.overdue' }, 'overdueFeedback'],
    [{ event: 'task.due' }, 'tasks'],
    [{ event: 'offer.sent' }, 'offers'],
    [{ event: 'onboarding.joining' }, 'joining'],
    [{ event: 'candidate.updated' }, 'automation'],
    [{ actionType: 'assign_owner', event: 'candidate.updated' }, 'assignments'],
  ]
  for (const [input, expected] of cases) assert.equal(notificationCategory(input), expected)
  assert.equal(notificationCategory({ actionConfig: { category: 'offers' }, event: 'candidate.updated' }), 'offers')
})

test('only an explicit false category preference suppresses that category', () => {
  assert.equal(allowsAutomationNotification({ notifications: { preferences: { offers: false } } }, { event: 'offer.sent' }).allowed, false)
  assert.equal(allowsAutomationNotification({ notifications: { preferences: { offers: true } } }, { event: 'offer.sent' }).allowed, true)
  assert.equal(allowsAutomationNotification({ notifications: { preferences: {} } }, { event: 'offer.sent' }).allowed, true)
})

test('disabled notifications module suppresses in-app delivery even when channels allow it', () => {
  for (const modules of [{ notifications: false }, { notifications: { enabled: false } }]) {
    const decision = allowsAutomationNotification({ modules, notifications: { channels: ['in_app'] } }, { event: 'offer.sent' })
    assert.equal(decision.allowed, false)
    assert.match(decision.reason, /module is disabled/)
  }
})

test('recipient-specific preferences can suppress an otherwise enabled category', () => {
  const config = { notifications: { channels: ['in_app'], preferences: { offers: true }, userPreferences: { 'user-off': { offers: false } } } }
  assert.equal(allowsAutomationNotification(config, { event: 'offer.sent', userId: 'user-on' }).allowed, true)
  const blocked = allowsAutomationNotification(config, { event: 'offer.sent', userId: 'user-off' })
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.category, 'offers')
})
