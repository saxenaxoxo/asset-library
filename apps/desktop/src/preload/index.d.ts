import type { AssetLibraryApi } from '../shared/api'

declare global {
  interface Window {
    assetLibrary: AssetLibraryApi
  }
}
