import { createHash } from 'node:crypto'

const passwordPadding = Buffer.from([
  0x28,0xbf,0x4e,0x5e,0x4e,0x75,0x8a,0x41,0x64,0x00,0x4e,0x56,0xff,0xfa,0x01,0x08,
  0x2e,0x2e,0x00,0xb6,0xd0,0x68,0x3e,0x80,0x2f,0x0c,0xa9,0xfe,0x64,0x53,0x69,0x7a
])
function padPassword(value: string) { return Buffer.concat([Buffer.from(value, 'latin1'), passwordPadding]).subarray(0, 32) }
function rc4(input: Buffer, key: Buffer) {
  const state = Array.from({ length: 256 }, (_, i) => i)
  let j = 0
  for (let i = 0; i < 256; i++) { j = (j + state[i] + key[i % key.length]) & 255; [state[i], state[j]] = [state[j], state[i]] }
  let i = 0; j = 0
  const output = Buffer.alloc(input.length)
  for (let index = 0; index < input.length; index++) { i = (i + 1) & 255; j = (j + state[i]) & 255; [state[i], state[j]] = [state[j], state[i]]; output[index] = input[index] ^ state[(state[i] + state[j]) & 255] }
  return output
}

/** A minimal PDF 1.4 Standard Security Handler (R2/40-bit RC4) fixture with no user password. */
export function makeEncryptedProfilePdf() {
  const fileId = Buffer.from('0123456789abcdef', 'ascii')
  const ownerKey = createHash('md5').update(padPassword('owner')).digest().subarray(0, 5)
  const ownerEntry = rc4(padPassword('user'), ownerKey)
  const permissions = Buffer.alloc(4); permissions.writeInt32LE(-4)
  const fileKey = createHash('md5').update(Buffer.concat([padPassword('user'), ownerEntry, permissions, fileId])).digest().subarray(0, 5)
  const userEntry = rc4(passwordPadding, fileKey)
  const content = Buffer.from('BT /F1 12 Tf 1 0 0 1 40 740 Tm (Password protected synthetic CV text) Tj ET', 'ascii')
  const objectKey = createHash('md5').update(Buffer.concat([fileKey, Buffer.from([4,0,0,0,0])])).digest().subarray(0, fileKey.length + 5)
  const encryptedContent = rc4(content, objectKey)
  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [5 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    Buffer.concat([Buffer.from(`<< /Length ${encryptedContent.length} >>\nstream\n`), encryptedContent, Buffer.from('\nendstream')]),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>'),
    Buffer.from(`<< /Filter /Standard /V 1 /R 2 /O <${ownerEntry.toString('hex')}> /U <${userEntry.toString('hex')}> /P -4 >>`)
  ]
  let output = Buffer.from('%PDF-1.4\n'), offsets = [0]
  objects.forEach((object, index) => { offsets.push(output.length); output = Buffer.concat([output, Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]) })
  const xref = output.length
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.slice(1).forEach(offset => { table += `${String(offset).padStart(10, '0')} 00000 n \n` })
  return Buffer.concat([output, Buffer.from(`${table}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 6 0 R /ID [<${fileId.toString('hex')}><${fileId.toString('hex')}>] >>\nstartxref\n${xref}\n%%EOF\n`)])
}
