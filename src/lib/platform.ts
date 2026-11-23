// 音藏目前仅提供桌面端外壳；保留与玲珑 Bin 一致的平台探测接口，便于以后扩展。
export type PlatformKind = 'desktop' | 'mobile'

export interface PlatformInfo {
  kind: PlatformKind
}

export function getPlatformSync(): PlatformInfo {
  return { kind: 'desktop' }
}
