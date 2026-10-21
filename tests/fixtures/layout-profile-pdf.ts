export function makeLayoutProfilePdf() {
  const lines = [
    'NAME: Ada Layout', 'SKILLS: SQL',
    'EXPERIENCE: Left Org | Analyst', 'EXPERIENCE: Right Org | Engineer',
    'FACT: Left responsibility', 'FACT: Right responsibility',
    'PROJECT: Left project | Python', 'PROJECT: Right project | Go',
    'FACT: Left project fact', 'FACT: Right project fact',
    'Repository'
  ]
  const objects: Array<Buffer | string> = []
  const add = (value: Buffer | string) => { objects.push(value); return objects.length }
  add(''); const pages = add(''); const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const positions = lines.map((_, index) => ({ x: index % 2 ? 330 : 36, y: 760 - Math.floor(index / 2) * 24 }))
  const commands = `BT /F1 10 Tf\n${lines.map((line,index) => `1 0 0 1 ${positions[index].x} ${positions[index].y} Tm (${line.replace(/[()\\]/g, '\\$&')}) Tj`).join('\n')}\nET`
  const content = add(`<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`)
  const linkPosition = positions[10]
  const annotation = add(`<< /Type /Annot /Subtype /Link /Rect [${linkPosition.x} ${linkPosition.y - 2} ${linkPosition.x + 120} ${linkPosition.y + 14}] /Border [0 0 0] /A << /S /URI /URI (https://example.test/repository) >> >>`)
  const page = add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R /Annots [${annotation} 0 R] >>`)
  objects[0] = `<< /Type /Catalog /Pages ${pages} 0 R >>`
  objects[pages - 1] = `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`
  let pdf = Buffer.from('%PDF-1.4\n'), offsets = [0]
  objects.forEach((object,index) => { offsets.push(pdf.length); pdf = Buffer.concat([pdf, Buffer.from(`${index + 1} 0 obj\n`), Buffer.isBuffer(object) ? object : Buffer.from(object), Buffer.from('\nendobj\n')]) })
  const xref = pdf.length
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.slice(1).forEach(offset => { table += `${String(offset).padStart(10, '0')} 00000 n \n` })
  return Buffer.concat([pdf, Buffer.from(`${table}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)])
}
