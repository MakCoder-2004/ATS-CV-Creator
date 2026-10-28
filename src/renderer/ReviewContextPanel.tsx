import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PanelRightClose, X } from 'lucide-react'

export function ReviewContextPanel({ open, onOpenChange, children, embedded = false, view = '', reveal = 0 }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode; embedded?: boolean; view?: string; reveal?: number }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const [wide, setWide] = useState(() => window.innerWidth >= 1350)
  useEffect(() => {
    if (embedded) return
    const stage = dialog.current?.closest('.review-stage')
    if (!stage) return
    let wasWide = window.innerWidth >= 1350
    const observer = new ResizeObserver(() => {
      const next = stage.getBoundingClientRect().width >= 1080
      if (wasWide && !next) onOpenChange(false)
      wasWide = next
      setWide(next)
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [embedded, onOpenChange])
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    const modal = element.matches(':modal')
    if (element.open && (!open || modal === wide)) element.close()
    if (open && !element.open) { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; if (wide) element.show(); else element.showModal() }
    if (open) element.scrollTop = 0
  }, [open, wide, embedded, view, reveal])
  function closeDetails() {
    onOpenChange(false)
    window.requestAnimationFrame(() => {
      const target = returnFocus.current
      if (target && target !== document.body && target.isConnected && target.getClientRects().length) target.focus({ preventScroll: true })
      else document.querySelector<HTMLButtonElement>('.review-details-toggle')?.focus({ preventScroll: true })
    })
  }
  if (embedded) return <>{children}</>
  return <dialog ref={dialog} className="review-context-dialog" role={wide ? 'complementary' : 'dialog'} aria-label="Review details" onCancel={event => { event.preventDefault(); closeDetails() }}>
    <header className="review-context-heading"><h2>Review details</h2><button className="icon-button" type="button" aria-label={wide ? 'Hide review details' : 'Close review details'} title={wide ? 'Hide review details' : 'Close review details'} onClick={closeDetails}>{wide ? <PanelRightClose size={20} aria-hidden="true" /> : <X size={20} aria-hidden="true" />}</button></header>
    {children}
  </dialog>
}
