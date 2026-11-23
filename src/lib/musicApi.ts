// 兼容出口：音乐源已抽象为可配置体系（内置源 + MusicFree 插件），
// 实际路由在 ./source；保持既有 import 路径不变。
export {
  searchMusic, guessMusics, getPlayUrl, getTrackMeta, downloadTrack, defaultDownloadDir,
} from './source'
