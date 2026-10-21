import { useEffect, useRef, useState } from 'react'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { RefreshCw } from 'lucide-react'

GlobalWorkerOptions.workerSrc = workerSrc

type DocumentPdf = { documentHash: string; pdfBase64: string }
type WorkbenchWithPdf = typeof window.workbench & { getDocumentPdf(jobId: string): Promise<DocumentPdf> }

export function PdfPreview({ jobId }: { jobId: string }) {
  const [attempt, setAttempt] = useState(0)
  const containerRefCurrent = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; hash: string; pages: number } | null>(null)

  useEffect(() => {
    let active = true
    let pdf: PDFDocumentProxy | undefined
    let loadingTask: PDFDocumentLoadingTask | undefined
    const renders: RenderTask[] = []
    setState({ status: 'loading' })
    const containerRef = containerRefCurrent
    const load = async () => {
      try {
        const result = await (window.workbench as WorkbenchWithPdf).getDocumentPdf(jobId)
        if (!active) return
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
          canvas.setAttribute('aria-label', `Compiled PDF page ${pageNumber}`)
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
        if (active) setState({ status: 'ready', hash: result.documentHash, pages: pdf.numPages })
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
  }, [jobId, attempt])

  return <section className="compiled-pdf-preview" aria-label="Compiled PDF preview" aria-busy={state?.status === 'loading'}>
    <header><strong>Compiled PDF</strong><span>{state?.status === 'ready' ? `${state.pages} page${state.pages === 1 ? '' : 's'}` : 'Export preview'}</span></header>
    {state?.status === 'loading' && <p role="status">Loading the compiled PDF…</p>}
    {state?.status === 'error' && <div role="alert"><p>{state.message}</p><button type="button" className="secondary-button" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={15} aria-hidden="true" />Retry preview</button></div>}
    <div className="compiled-pdf-pages" data-pdf-preview-pages ref={containerRefCurrent} />
    {state?.status === 'ready' && <span className="visually-hidden">PDF document {state.hash}</span>}
  </section>
}
