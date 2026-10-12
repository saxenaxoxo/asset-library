/** What kind of asset a file is, decided by its extension. Dependency-free. */
export type AssetKind = 'video' | 'audio' | 'image' | 'template'

const KIND_BY_EXTENSION: Record<string, AssetKind> = {
  // Video, including motion overlays (ProRes / alpha usually come as .mov)
  mp4: 'video',
  m4v: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  avi: 'video',
  mxf: 'video',
  mts: 'video',
  m2ts: 'video',
  // Audio
  wav: 'audio',
  aif: 'audio',
  aiff: 'audio',
  mp3: 'audio',
  m4a: 'audio',
  aac: 'audio',
  flac: 'audio',
  ogg: 'audio',
  // Images
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  tif: 'image',
  tiff: 'image',
  bmp: 'image',
  psd: 'image',
  // Adobe-native templates and presets: browse-only in v1
  mogrt: 'template',
  aep: 'template',
  ffx: 'template',
  prproj: 'template',
  prfpset: 'template',
  cube: 'template'
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot <= 0 ? '' : filename.slice(dot + 1).toLowerCase()
}

/** The asset kind for a file name, or null when the file isn't an asset we index. */
export function kindForFile(filename: string): AssetKind | null {
  return KIND_BY_EXTENSION[extensionOf(filename)] ?? null
}

export const SUPPORTED_EXTENSIONS = Object.keys(KIND_BY_EXTENSION)
