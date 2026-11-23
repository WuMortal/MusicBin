import { invoke } from '@tauri-apps/api/core'
import type { DownloadResult, PlayResult, Track, TrackMeta } from '../../types'
import type { MusicSource, SourcePlayUrl } from './types'

export const BUILTIN_CODE = 'gequbao'

/** 内置源（歌曲宝 gequbao.com）：全部逻辑在 Rust music.rs */
export class BuiltinSource implements MusicSource {
  readonly code = BUILTIN_CODE
  readonly name = '内置源 · 歌曲宝'
  readonly builtIn = true

  search(keyword: string): Promise<Track[]> {
    return invoke<Track[]>('search_music', { keyword })
  }

  guess(keyword: string): Promise<Track[]> {
    return invoke<Track[]>('guess_musics', { keyword })
  }

  async getPlayUrl(track: Track): Promise<SourcePlayUrl> {
    const r = await invoke<PlayResult>('get_play_url', { id: track.id })
    return { url: r.url }
  }

  getTrackMeta(track: Track): Promise<TrackMeta | null> {
    return invoke<TrackMeta>('get_track_meta', { id: track.id })
  }

  download(track: Track, dir: string): Promise<DownloadResult> {
    return invoke<DownloadResult>('download_track_with_meta', { id: track.id, dir })
  }
}
