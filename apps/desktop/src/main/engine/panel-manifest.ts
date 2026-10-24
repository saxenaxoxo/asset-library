import { z } from 'zod'
import { compareVersions, type PanelKind } from './panel-installer'

// The panel download list ("manifest"): which panel files exist to download, where, how big
// and with which SHA-256. Written by scripts/build-panel-manifest.mjs, published as a GitHub
// Release asset (docs/releasing-panels.md), read by the Hub. Pure: parsing and choosing only.

/** Asset Library's id in the manifest: the one product this Hub knows how to install. */
export const ASSET_LIBRARY_PRODUCT_ID = 'asset-library'
/** The manifest format this Hub reads. A newer format means the Hub needs updating. */
export const MANIFEST_SCHEMA = 1
/** Larger manifests are refused before parsing. */
export const MAX_MANIFEST_BYTES = 256 * 1024
/** Larger panel files are refused (today's are well under 5 MB). */
export const MAX_PANEL_BYTES = 200 * 1024 * 1024

const VERSION = /^\d+(\.\d+){1,3}$/
const PREMIERE_VERSION = /^\d+(\.\d+){0,3}$/

const ManifestPanelSchema = z.object({
  /** Stable product id, e.g. "asset-library". */
  product: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(64),
  /** The product's name, as shown in the Hub. */
  name: z.string().trim().min(1).max(80),
  build: z.enum(['cep', 'uxp']),
  version: z.string().regex(VERSION),
  /** The Premiere Pro versions that load this file: from `min`, up to (not including) `below`. */
  premiere: z.object({
    min: z.string().regex(PREMIERE_VERSION),
    below: z.string().regex(PREMIERE_VERSION).nullable()
  }),
  url: z.string().max(2048),
  size: z.number().int().positive().max(MAX_PANEL_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/)
})

export type ManifestPanel = z.infer<typeof ManifestPanelSchema>

const ManifestSchema = z.object({
  schema: z.number().int(),
  generatedAt: z.string().max(64).optional(),
  panels: z.array(z.unknown()).max(500)
})

export interface PanelManifest {
  panels: ManifestPanel[]
  /** Entries this Hub couldn't use (unknown build, bad hash, URL off the allowlist…). */
  skipped: number
}

export type ManifestParse = { ok: true; manifest: PanelManifest } | { ok: false; reason: string }

/**
 * Validates a downloaded manifest. The format must be one this Hub knows; each entry is checked
 * on its own, and entries that fail (including a URL `isAllowedUrl` refuses) are left out, so
 * the Hub only ever acts on entries it fully understands.
 */
export function parseManifest(
  data: unknown,
  isAllowedUrl: (url: string) => boolean
): ManifestParse {
  const top = ManifestSchema.safeParse(data)
  if (!top.success) return { ok: false, reason: "The download list isn't in the expected format." }
  if (top.data.schema > MANIFEST_SCHEMA) {
    return {
      ok: false,
      reason: 'The download list needs a newer version of Goated Panels Hub.'
    }
  }
  if (top.data.schema !== MANIFEST_SCHEMA) {
    return { ok: false, reason: "The download list isn't in the expected format." }
  }
  const panels: ManifestPanel[] = []
  let skipped = 0
  for (const raw of top.data.panels) {
    const entry = ManifestPanelSchema.safeParse(raw)
    if (entry.success && isAllowedUrl(entry.data.url)) panels.push(entry.data)
    else skipped += 1
  }
  return { ok: true, manifest: { panels, skipped } }
}

/** Whether Premiere Pro `version` loads a file made for `range`. */
export function premiereInRange(version: string, range: ManifestPanel['premiere']): boolean {
  if (compareVersions(version, range.min) < 0) return false
  return range.below === null || compareVersions(version, range.below) < 0
}

/** The newest entry of one product and build that suits at least one of `premiere` (any, if none known). */
export function newestPanel(
  panels: readonly ManifestPanel[],
  product: string,
  build: PanelKind,
  premiere: readonly string[]
): ManifestPanel | null {
  let best: ManifestPanel | null = null
  for (const panel of panels) {
    if (panel.product !== product || panel.build !== build) continue
    if (premiere.length > 0 && !premiere.some((v) => premiereInRange(v, panel.premiere))) continue
    if (!best || compareVersions(panel.version, best.version) > 0) best = panel
  }
  return best
}

export type PanelSource =
  { from: 'download'; version: string; panel: ManifestPanel } | { from: 'bundled'; version: string }

/**
 * Where a build comes from: a download when the manifest has a newer version than the copy
 * built into the Hub (or the Hub has none), else the built-in copy. Offline, `panels` is empty
 * and the built-in copy is used. Null when neither exists.
 */
export function choosePanelSource(
  bundledVersion: string | null,
  download: ManifestPanel | null
): PanelSource | null {
  if (download && (!bundledVersion || compareVersions(download.version, bundledVersion) > 0)) {
    return { from: 'download', version: download.version, panel: download }
  }
  return bundledVersion ? { from: 'bundled', version: bundledVersion } : null
}

/** Products in the manifest other than `known`, once each (for "needs a newer Hub"). */
export function otherProducts(
  panels: readonly ManifestPanel[],
  known: string
): { id: string; name: string }[] {
  const found = new Map<string, string>()
  for (const panel of panels) {
    if (panel.product !== known && !found.has(panel.product)) found.set(panel.product, panel.name)
  }
  return [...found].map(([id, name]) => ({ id, name }))
}
