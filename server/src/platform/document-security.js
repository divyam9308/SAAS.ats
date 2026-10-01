'use strict';

const path = require('node:path');

class DocumentSecurityError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = 'DocumentSecurityError';
    this.status = status;
  }
}

const TYPES = [
  { extensions: ['.pdf'], mimeType: 'application/pdf', matches: bytes => bytes.subarray(0, 5).toString('ascii') === '%PDF-' },
  { extensions: ['.docx'], mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', matches: bytes => bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04 },
  { extensions: ['.png'], mimeType: 'image/png', matches: bytes => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) },
  { extensions: ['.jpg', '.jpeg'], mimeType: 'image/jpeg', matches: bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { extensions: ['.txt'], mimeType: 'text/plain', matches: bytes => !bytes.includes(0) },
];

function decodeBase64(value) {
  const encoded = String(value || '').replace(/\s+/g, '');
  if (!encoded || encoded.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new DocumentSecurityError('Document content is not valid base64');
  const bytes = Buffer.from(encoded, 'base64');
  const normalizedInput = encoded.replace(/=+$/, '');
  if (!bytes.length || bytes.toString('base64').replace(/=+$/, '') !== normalizedInput) throw new DocumentSecurityError('Document content is not valid base64');
  return bytes;
}

function inspectDocument({ filename, mimeType, contentBase64, maxFileSizeMb = 20 }) {
  const safeName = path.basename(String(filename || ''));
  const extension = path.extname(safeName).toLowerCase();
  const declaredType = String(mimeType || '').toLowerCase();
  const type = TYPES.find(candidate => candidate.extensions.includes(extension));
  if (!safeName || !type) throw new DocumentSecurityError('Document type is not allowed');
  const bytes = decodeBase64(contentBase64);
  const maximum = Number(maxFileSizeMb) || 20;
  if (bytes.length > maximum * 1024 * 1024) throw new DocumentSecurityError(`Document exceeds ${maximum} MB`, 413);
  if (!type.matches(bytes)) throw new DocumentSecurityError('Document content does not match its file extension');
  if (declaredType && declaredType !== 'application/octet-stream' && declaredType !== type.mimeType) throw new DocumentSecurityError('Document MIME type does not match its content');
  return { bytes, filename: safeName, mimeType: type.mimeType };
}

function localDocumentScanner({ bytes }) {
  // This catches the standard harmless antivirus test marker. Production mode
  // still requires an injected scanner adapter and does not present this as AV.
  if (bytes.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'))) return { clean: false, reason: 'Document failed malware screening' };
  return { clean: true, provider: 'local-development-screen' };
}

module.exports = { DocumentSecurityError, TYPES, decodeBase64, inspectDocument, localDocumentScanner };
