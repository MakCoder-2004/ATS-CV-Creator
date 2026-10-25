/** The exact public metadata query disclosed before the indexed search action. */
export function buildJobResearchQuery(selected: { host: string; roleId: string | null }): string | undefined {
  const host = selected.host.trim()
  if (!host || /[\s\x00-\x1f\x7f]/.test(host)) return undefined
  const roleId = selected.roleId?.trim() ?? ''
  if (selected.roleId !== null && (!roleId || /[\s\x00-\x1f\x7f]/.test(roleId))) return undefined
  return `job ${roleId ? `${roleId} ` : ''}site:${host}`
}
