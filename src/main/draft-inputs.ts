import type { ExperienceSnapshot } from '../shared/experience'
import type { ProfileSnapshot } from '../shared/profile'
import type { GenerationItem } from './source-linked-generation'

export function prepareDraftInputs(profile: ProfileSnapshot, experience: ExperienceSnapshot): {
  items: GenerationItem[]
  lockedFields: {
    fullName: string
    headline?: string
    experience: Array<{ evidenceId: string; sourceIds: string[]; title: string; organization: string; startDate?: string; endDate?: string }>
    education: Array<{ evidenceId: string; title: string; institution?: string; startDate?: string; endDate?: string }>
    projects: Array<{ evidenceId: string; sourceIds: string[]; name: string }>
    certificates: Array<{ evidenceId: string; title: string; issuer?: string; year?: number }>
  }
} {
  const items: GenerationItem[] = [
    ...profile.education.map(item => ({ id: item.id, revision: item.revision, category: 'education' as const, snapshot: item as unknown as Record<string, unknown>, text: [item.title, item.field, item.description].filter(Boolean).join('. '), chronology: item.endDate ?? item.startDate })),
    ...experience.experience.flatMap(item => [{ id: item.id, revision: item.revision, category: 'experience' as const, snapshot: item as unknown as Record<string, unknown>, text: `${item.title}. ${item.description} ${(item.factualItems ?? []).map(fact => fact.text).join(' ')}`, chronology: item.endDate ?? item.startDate, parentId: item.id }, ...item.factualItems.map(fact => ({ id: fact.id, revision: fact.revision, category: 'experience' as const, snapshot: fact as unknown as Record<string, unknown>, text: fact.text, chronology: item.endDate ?? item.startDate, parentId: item.id }))]),
    ...experience.projects.map(item => ({ id: item.id, revision: item.revision, category: 'projects' as const, snapshot: item as unknown as Record<string, unknown>, text: `${item.name}. ${item.description} ${(item.factualItems ?? []).map(fact => fact.text).join(' ')}`, parentId: item.id })),
    ...profile.skills.map(item => ({ id: item.id, revision: item.revision, category: 'skills' as const, snapshot: item as unknown as Record<string, unknown>, text: `${item.name} (${item.category})` })),
    ...profile.certificates.map(item => ({ id: item.id, revision: item.revision, category: 'certificates' as const, snapshot: item as unknown as Record<string, unknown>, text: [item.title, item.description].filter(Boolean).join('. ') }))
  ]
  const lockedFields = {
    fullName: profile.contact?.fullName ?? '',
    ...(profile.contact?.headline ? { headline: profile.contact.headline } : {}),
    experience: experience.experience.map(item => ({ evidenceId: item.id, sourceIds: [item.id, ...item.factualItems.map(fact => fact.id)], title: item.title, organization: item.organization, ...(item.startDate ? { startDate: item.startDate } : {}), ...(item.endDate ? { endDate: item.endDate } : {}) })),
    education: profile.education.map(item => ({ evidenceId: item.id, title: item.title, ...(item.institution ? { institution: item.institution } : {}), ...(item.startDate ? { startDate: item.startDate } : {}), ...(item.endDate ? { endDate: item.endDate } : {}) })),
    projects: experience.projects.map(item => ({ evidenceId: item.id, sourceIds: [item.id, ...item.factualItems.map(fact => fact.id), ...item.technologies.map(technology => technology.id)], name: item.name })),
    certificates: profile.certificates.map(item => ({ evidenceId: item.id, title: item.title, ...(item.issuer ? { issuer: item.issuer } : {}), ...(item.year ? { year: item.year } : {}) }))
  }
  return { items, lockedFields }
}
