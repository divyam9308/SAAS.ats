'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { isLoopbackHost, resolveBindHost } = require('./bindHost')

test('local modes bind to IPv4 loopback by default', () => {
  assert.equal(resolveBindHost({ localDemoMode: true }), '127.0.0.1')
  assert.equal(resolveBindHost({ platformMode: true }), '127.0.0.1')
})

test('local modes allow loopback host overrides only', () => {
  for (const host of ['localhost', '127.0.0.1', '127.20.30.40', '::1']) {
    assert.equal(isLoopbackHost(host), true)
    assert.equal(resolveBindHost({ host, platformMode: true }), host)
  }
  for (const host of ['0.0.0.0', '192.168.1.10', 'example.com']) {
    assert.throws(() => resolveBindHost({ host, localDemoMode: true }), /only bind to a loopback address/)
  }
})

test('nonlocal binding preserves deploy host behavior', () => {
  assert.equal(resolveBindHost({}), undefined)
  assert.equal(resolveBindHost({ host: '0.0.0.0' }), '0.0.0.0')
})
