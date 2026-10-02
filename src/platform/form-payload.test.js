import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareCreatePayload } from './form-payload.js'

test('optional blank form fields are omitted instead of submitting invalid reference IDs or fictitious numeric zeroes', () => {
  const values = { name: 'Test client', ownerId: '', budget: '', status: '', active: false, openings: 0 }
  const fields = [{ key: 'name', required: true }, ...['ownerId', 'budget', 'status', 'active', 'openings'].map(key => ({ key }))]
  assert.deepEqual(prepareCreatePayload(values, fields), { name: 'Test client', active: false, openings: 0 })
  assert.equal(values.ownerId, '', 'form state stays editable')
})

test('required values remain available for validation and supplied ownership IDs are retained', () => {
  assert.deepEqual(prepareCreatePayload({ title: '', recruiterId: 'demo-recruiter' }, [{ key: 'title', required: true }, { key: 'recruiterId' }]), { title: '', recruiterId: 'demo-recruiter' })
})
