'use strict'

const net = require('node:net')

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function isLoopbackHost(host) {
  const value = String(host || '').trim().toLowerCase()
  if (LOOPBACK_HOSTS.has(value)) return true
  // Accept the full 127/8 IPv4 loopback range.
  return net.isIP(value) === 4 && value.split('.')[0] === '127'
}

function resolveBindHost({ host, platformMode, localDemoMode } = {}) {
  const local = platformMode === true || localDemoMode === true
  if (!local) return host || undefined

  if (!host) return '127.0.0.1'
  if (!isLoopbackHost(host)) {
    throw new Error(`Local mode can only bind to a loopback address; received HOST=${host}`)
  }
  return host.trim()
}

module.exports = { isLoopbackHost, resolveBindHost }
