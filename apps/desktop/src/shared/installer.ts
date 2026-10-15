// What the installer window knows about the Premiere Pro panel's two builds: which Premiere
// versions each one suits, and which to recommend. The only place these rules live; the window
// and the tests read them from here. Dependency-free (the renderer imports it).

export type PanelBuild = 'cep' | 'uxp'
export const PANEL_BUILD_IDS: readonly PanelBuild[] = ['uxp', 'cep']

export interface PanelBuildInfo {
  id: PanelBuild
  label: string
  badge: 'Modern' | 'Legacy'
  summary: string
  /** The Premiere Pro versions it's meant for, in words. */
  versions: string
  /** Short, verified notes (each one a fact about this build). */
  notes: string[]
}

/** Premiere Pro reads drags from UXP panels from this major version (the 2027 release). */
export const UXP_DRAG_FROM_MAJOR = 27
/** The UXP plugin's manifest minimum (host minVersion). */
export const UXP_MIN_VERSION = '25.6'
/** The CEP build is meant for these majors; it was tested on 26.5. */
export const CEP_FROM_MAJOR = 24

export const PANEL_BUILDS: Record<PanelBuild, PanelBuildInfo> = {
  uxp: {
    id: 'uxp',
    label: 'UXP',
    badge: 'Modern',
    summary: 'For compatible newer versions of Premiere Pro.',
    versions: 'Premiere Pro 2027 (27.0) and later',
    notes: [
      "Adobe's current plugin system",
      'Drag assets onto the timeline from Premiere Pro 27',
      'Opens from Window → UXP Plugins'
    ]
  },
  cep: {
    id: 'cep',
    label: 'CEP',
    badge: 'Legacy',
    summary: 'For compatible older versions of Premiere Pro.',
    versions: 'Premiere Pro 2024 to 2026 (24 – 26), tested on 26.5',
    notes: [
      "Adobe's older extension system",
      'Drag assets onto the timeline',
      'Opens from Window → Extensions'
    ]
  }
}

export type BuildFit = 'recommended' | 'limited' | 'untested' | 'unsupported'

/** How well a build suits one Premiere Pro version, with the reason in words. */
export function buildFit(
  build: PanelBuild,
  premiereVersion: string
): { fit: BuildFit; reason: string } {
  const [major = 0, minor = 0] = premiereVersion.split('.').map((part) => Number(part) || 0)
  const name = `Premiere Pro ${major}.${minor}`
  if (build === 'uxp') {
    if (major >= UXP_DRAG_FROM_MAJOR) return { fit: 'recommended', reason: `Made for ${name}.` }
    const [minMajor = 0, minMinor = 0] = UXP_MIN_VERSION.split('.').map(Number)
    if (major > minMajor || (major === minMajor && minor >= minMinor)) {
      return {
        fit: 'limited',
        reason: `Opens in ${name}, but dragging onto the timeline needs Premiere Pro 27.`
      }
    }
    return { fit: 'unsupported', reason: `Needs Premiere Pro ${UXP_MIN_VERSION} or later.` }
  }
  if (major >= UXP_DRAG_FROM_MAJOR) {
    return { fit: 'untested', reason: `Not tested on ${name}. UXP is made for it.` }
  }
  if (major >= CEP_FROM_MAJOR) return { fit: 'recommended', reason: `Made for ${name}.` }
  return { fit: 'unsupported', reason: `Needs Premiere Pro ${CEP_FROM_MAJOR} or later.` }
}

/** The build each Premiere Pro version should get, or null when neither suits it. */
export function recommendedBuild(premiereVersion: string): PanelBuild | null {
  for (const build of PANEL_BUILD_IDS) {
    if (buildFit(build, premiereVersion).fit === 'recommended') return build
  }
  return null
}

/** The builds to install for every detected Premiere Pro version (one each, no duplicates). */
export function recommendedBuilds(premiereVersions: readonly string[]): PanelBuild[] {
  const builds = new Set<PanelBuild>()
  for (const version of premiereVersions) {
    const build = recommendedBuild(version)
    if (build) builds.add(build)
  }
  return PANEL_BUILD_IDS.filter((build) => builds.has(build))
}

/** Compares "0.4.1"-style versions: negative when a < b. Non-numeric parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const pb = b.split('.').map((part) => Number.parseInt(part, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export interface InstalledPanel {
  build: PanelBuild
  version: string
  /** The Premiere Pro versions that list it. */
  premiere: string[]
}

/** Every installed copy of the panel, one entry per build and version. */
export function installedPanels(
  premiere: readonly { version: string; cep: string[]; uxp: string[] }[]
): InstalledPanel[] {
  const found = new Map<string, InstalledPanel>()
  for (const host of premiere) {
    for (const build of PANEL_BUILD_IDS) {
      for (const version of host[build]) {
        const key = `${build}:${version}`
        const entry = found.get(key) ?? { build, version, premiere: [] }
        entry.premiere.push(host.version)
        found.set(key, entry)
      }
    }
  }
  return [...found.values()]
}

export type InstallState = 'not-installed' | 'installed' | 'update-available'

/** Whether a build is installed, and whether this app carries a newer copy of it. */
export function installState(
  installed: readonly InstalledPanel[],
  build: PanelBuild,
  bundledVersion: string | null
): InstallState {
  const copies = installed.filter((panel) => panel.build === build)
  if (copies.length === 0) return 'not-installed'
  if (bundledVersion && copies.some((panel) => compareVersions(panel.version, bundledVersion) < 0))
    return 'update-available'
  return 'installed'
}
