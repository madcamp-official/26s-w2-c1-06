import type { FactcodingApi } from './index'

declare global {
  interface Window {
    factcoding: FactcodingApi
  }
}
