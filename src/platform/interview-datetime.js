function timeZoneFormatter(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })
  } catch {
    throw new RangeError('A valid IANA workspace timezone is required.')
  }
}

function partsInZone(date, formatter) {
  return Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]))
}

function wallParts(value) {
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?$/.exec(value || '')
  if (!match) throw new RangeError('Enter a valid local date and time.')
  const [year, month, day, hour, minute, second = 0] = match.slice(1).map(value => value == null ? 0 : Number(value))
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) {
    throw new RangeError('Enter a real local date and time.')
  }
  return { year, month, day, hour, minute, second }
}

function toInterviewISO(localDateTime, timeZone) {
  const target = wallParts(localDateTime)
  const formatter = timeZoneFormatter(timeZone)
  const targetAsUTC = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second)
  // Derive the offsets around the target wall-clock time. Testing every minute
  // in the resulting plausible UTC window catches gaps and repeated DST times.
  const offsets = new Set()
  for (const delta of [-36, -24, -12, 0, 12, 24, 36]) {
    const probe = new Date(targetAsUTC + delta * 3600000)
    const p = partsInZone(probe, formatter)
    const represented = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
    offsets.add(represented - probe.getTime())
  }
  const candidates = new Set([...offsets].map(offset => targetAsUTC - offset))
  const matches = [...candidates].filter(time => {
    const p = partsInZone(new Date(time), formatter)
    return +p.year === target.year && +p.month === target.month && +p.day === target.day && +p.hour === target.hour && +p.minute === target.minute && +p.second === target.second
  })
  if (matches.length !== 1) throw new RangeError(matches.length ? 'This local time is ambiguous in the workspace timezone.' : 'This local time does not exist in the workspace timezone.')
  return new Date(matches[0]).toISOString()
}

function fromInterviewISO(isoTimestamp, timeZone) {
  if (typeof isoTimestamp !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(isoTimestamp) || !Number.isFinite(Date.parse(isoTimestamp))) {
    throw new RangeError('A valid ISO timestamp with an explicit offset is required.')
  }
  const p = partsInZone(new Date(isoTimestamp), timeZoneFormatter(timeZone))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

export { toInterviewISO, fromInterviewISO }
