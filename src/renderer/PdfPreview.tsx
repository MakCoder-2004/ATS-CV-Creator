import { useEffect, useRef, useState } from 'react'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { RefreshCw } from 'lucide-react'
import { canonicalDocumentTextParts, type CanonicalDocument } from '../shared/document'
import type { CanonicalCoverLetter } from '../shared/cover-letter-document'

GlobalWorkerOptions.workerSrc = workerSrc

type PreviewProps = { jobId: string } & ({ canonical: CanonicalDocument; letterId?: never; letterCanonical?: never } | { canonical?: never; letterId: string; letterCanonical: CanonicalCoverLetter })

export function PdfPreview({ jobId, canonical, letterId, letterCanonical }: PreviewProps) {
  const isLetter = Boolean(letterId)
  const revision = canonical?.revision ?? letterCanonical?.revision
  const [attempt, setAttempt] = useState(0)
  const containerRefCurrent = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; pages: number } | null>(null)

  useEffect(() => {
    let active = true
    let pdf: PDFDocumentProxy | undefined
    let loadingTask: PDFDocumentLoadingTask | undefined
    const renders: RenderTask[] = []
    setState({ status: 'loading' })
    containerRefCurrent.current?.replaceChildren()
    const containerRef = containerRefCurrent
    const load = async () => {
      try {
        const result = letterId ? await window.workbench.getCoverLetterPdf({ jobId, letterId }) : await window.workbench.getDocumentPdf(jobId)
        if (!active) return
        if ('ok' in result && !result.ok) throw new Error(result.message)
        if (!('pdfBase64' in result) || !result.pdfBase64) throw new Error('The compiled document is unavailable.')
        const binary = atob(result.pdfBase64)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
        loadingTask = getDocument({ data: bytes })
        pdf = await loadingTask.promise
        if (!active) return
        const container = containerRef.current
        if (!container) return
        container.replaceChildren()
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          const page = await pdf.getPage(pageNumber)
          if (!active) return
          const base = page.getViewport({ scale: 1 })
          const scale = Math.min(1.5, Math.max(0.65, (container.clientWidth || 612) / base.width))
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.setAttribute('aria-label', `Compiled ${isLetter ? 'cover letter ' : ''}PDF page ${pageNumber}`)
          canvas.setAttribute('role', 'img')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          canvas.style.width = '100%'
          canvas.style.height = 'auto'
          canvas.dataset.pdfPage = String(pageNumber)
          container.append(canvas)
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Canvas rendering is unavailable.')
          const task = page.render({ canvas, canvasContext: context, viewport })
          renders.push(task)
          await task.promise
        }
        if (active) setState({ status: 'ready', pages: pdf.numPages })
      } catch {
        if (active) setState({ status: 'error', message: 'The compiled PDF preview could not be loaded.' })
      }
    }
    void load()
    return () => {
      active = false
      for (const task of renders) task.cancel()
      void loadingTask?.destroy()
    }
  }, [jobId, letterId, revision, attempt, isLetter])

  return <section className="compiled-pdf-preview" aria-label={isLetter ? 'Compiled cover letter PDF preview' : 'Compiled PDF preview'} aria-busy={state?.status === 'loading'}>
    <header><strong>{isLetter ? 'Compiled cover letter PDF' : 'Compiled PDF'}</strong><span>{state?.status === 'ready' ? `${state.pages} page${state.pages === 1 ? '' : 's'}` : 'Export preview'}</span></header>
    {state?.status === 'loading' && <p role="status">Loading the compiled PDF…</p>}
    {state?.status === 'error' && <div role="alert"><p>{state.message}</p><button type="button" className="secondary-button" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={15} aria-hidden="true" />Retry preview</button></div>}
    <div className="compiled-pdf-pages" data-pdf-preview-pages ref={containerRefCurrent} />
    {state?.status === 'ready' && <div className="visually-hidden"><h3>{isLetter ? 'Cover letter text' : 'CV text'}</h3>{(canonical ? canonicalDocumentTextParts(canonical) : letterCanonical ? [letterCanonical.name, letterCanonical.date, letterCanonical.subject, letterCanonical.greeting, ...letterCanonical.paragraphs, letterCanonical.signature] : []).map((text, index) => <p key={index}>{text}</p>)}</div>}
  </section>
}
