export function prepareCreatePayload(values, fields) {
  const payload = { ...values }
  for (const field of fields) {
    const key = field.key || field.field || field.name
    if (key && !field.required && payload[key] === '') delete payload[key]
  }
  return payload
}
