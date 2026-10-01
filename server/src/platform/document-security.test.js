'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectDocument, localDocumentScanner } = require('./document-security');

const upload = (filename, mimeType, bytes) => inspectDocument({ filename, mimeType, contentBase64: Buffer.from(bytes).toString('base64') });

test('document inspection derives trusted MIME from extension and magic bytes', () => {
  const result = upload('../resume.pdf', 'application/pdf', Buffer.from('%PDF-1.7\ncontent'));
  assert.equal(result.filename, 'resume.pdf');
  assert.equal(result.mimeType, 'application/pdf');
});

test('document inspection rejects mismatched content, MIME, types, and malformed base64', () => {
  assert.throws(() => upload('resume.pdf', 'application/pdf', Buffer.from('not a pdf')), /does not match/);
  assert.throws(() => upload('resume.pdf', 'image/png', Buffer.from('%PDF-1.7')), /MIME type/);
  assert.throws(() => upload('resume.exe', 'application/octet-stream', Buffer.from('MZ')), /not allowed/);
  assert.throws(() => inspectDocument({ filename: 'resume.txt', contentBase64: '!!!!' }), /valid base64/);
});

test('local development scanner rejects the standard antivirus test marker', () => {
  assert.equal(localDocumentScanner({ bytes: Buffer.from('safe') }).clean, true);
  assert.equal(localDocumentScanner({ bytes: Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE') }).clean, false);
});
