import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { Readable } from 'node:stream'

export type TtsVoiceId = 'ko-KR-InJoonNeural' | 'ko-KR-SunHiNeural'

export const DEFAULT_TTS_VOICE: TtsVoiceId = 'ko-KR-InJoonNeural'
export const TTS_MIME_TYPE = 'audio/mpeg'
const MAX_CHARS = 450

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function truncateForSpeech(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= MAX_CHARS) return cleaned
  return cleaned.slice(0, MAX_CHARS) + ' 이어서 설명합니다'
}

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks))
    }
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    stream.on('error', (err) => {
      if (settled) return
      settled = true
      reject(err)
    })
    stream.on('end', finish)
    stream.on('close', finish)
  })
}

// Electron main 전용. Edge Read Aloud Neural TTS — API 키 불필요.
// 렌더러에서 직접 호출하면 UA/WebSocket 헤더 제약으로 실패하므로 main에서만 합성.
export class EdgeTtsService {
  private client: MsEdgeTTS | null = null
  private readyVoice: string | null = null
  private chain: Promise<void> = Promise.resolve()

  async synthesize(text: string, voice: TtsVoiceId = DEFAULT_TTS_VOICE): Promise<Buffer> {
    const input = truncateForSpeech(escapeXml(text))
    if (!input) return Buffer.alloc(0)

    // 동시 합성 1개 — Edge 쪽 부하/레이스 완화
    const run = this.chain.then(() => this.synthesizeUnlocked(input, voice))
    this.chain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private async synthesizeUnlocked(input: string, voice: TtsVoiceId): Promise<Buffer> {
    if (!this.client || this.readyVoice !== voice) {
      this.client?.close()
      this.client = new MsEdgeTTS()
      await this.client.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
      this.readyVoice = voice
    }

    const { audioStream } = this.client.toStream(input)
    const buffer = await streamToBuffer(audioStream)
    if (buffer.length === 0) {
      throw new Error('TTS returned empty audio buffer')
    }
    return buffer
  }

  close(): void {
    this.client?.close()
    this.client = null
    this.readyVoice = null
  }
}
