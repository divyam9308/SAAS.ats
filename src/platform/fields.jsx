import { useMemo } from 'react'

import { humanize } from './utils'

const INPUT_TYPES = {
  shortText: 'text', text: 'text', email: 'email', phone: 'tel', url: 'url', number: 'number', currency: 'number', date: 'date', datetimeLocal: 'datetime-local',
}

function optionsFor(field) {
  const options = field.options || field.choices || []
  return options.map((option) => typeof option === 'string' ? { value: option, label: option } : { value: option.value ?? option.id, label: option.label ?? option.name ?? option.value })
}

export function FieldControl({ field, value, onChange, disabled = false, idPrefix = 'field', error }) {
  const id = `${idPrefix}-${field.key || field.name}`
  const type = field.type || 'shortText'
  const options = useMemo(() => optionsFor(field), [field])
  const common = { id, name: field.key || field.name, required: Boolean(field.required), disabled, 'aria-invalid': Boolean(error), 'aria-describedby': error ? `${id}-error` : undefined }
  let control
  if (['longText', 'textarea'].includes(type)) {
    control = <textarea {...common} rows={field.rows || 4} value={value ?? ''} placeholder={field.placeholder || ''} onChange={(event) => onChange(event.target.value)} />
  } else if (['singleSelect', 'select'].includes(type)) {
    control = <select {...common} value={value ?? ''} onChange={(event) => onChange(event.target.value)}><option value="">Select {field.label?.toLowerCase() || 'an option'}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
  } else if (['multiSelect'].includes(type)) {
    const selected = Array.isArray(value) ? value : []
    control = <select {...common} multiple value={selected} onChange={(event) => onChange(Array.from(event.target.selectedOptions, (option) => option.value))}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
  } else if (['checkbox', 'boolean'].includes(type)) {
    control = <label className="platform-checkbox"><input {...common} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /><span>{field.checkboxLabel || field.label}</span></label>
  } else if (type === 'file') {
    control = <input {...common} type="file" accept={field.accept || undefined} onChange={(event) => onChange(event.target.files?.[0] || null)} />
  } else {
    const inputType = INPUT_TYPES[type] || 'text'
    control = <input {...common} type={inputType} step={type === 'currency' ? '0.01' : field.step} min={field.min} max={field.max} value={value ?? ''} placeholder={field.placeholder || ''} onChange={(event) => onChange(inputType === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value)} />
  }
  return <div className={`platform-field ${field.fullWidth ? 'platform-field--full' : ''}`}>
    {type !== 'checkbox' && type !== 'boolean' && <label htmlFor={id}>{field.label || humanize(field.key || field.name)}{field.required && <span className="platform-required"> *</span>}</label>}
    {field.helpText && <small>{field.helpText}</small>}
    {control}
    {error && <small className="platform-field-error" id={`${id}-error`}>{error}</small>}
  </div>
}

export function ConfiguredFields({ fields = [], values = {}, onChange, idPrefix }) {
  return <div className="platform-form-grid">{fields.filter((field) => field.enabled !== false && field.visible !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((field) => <FieldControl key={field.key || field.name} field={field} value={values[field.key || field.name]} onChange={(value) => onChange(field.key || field.name, value)} idPrefix={idPrefix} />)}</div>
}
