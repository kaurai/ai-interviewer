# Provider contracts

Exact contracts the speech-to-text module implements. Change the code and this
file together.

## Normalized result

```ts
interface TranscriptionResult {
  text: string;                       // trimmed; may be "" for silence
  languageCode: string | null;        // "en", or null if unknown
  languageProbability: number | null; // ElevenLabs only
  words: TranscriptWord[];            // ElevenLabs: text, start/end s, kind, logprob, speakerId
  segments: TranscriptSegment[];      // whisper.cpp: text, start/end s
}
```

Fields a provider cannot supply are `null` or empty. Callers must not depend on
word timings being present.

## ElevenLabs Scribe v2 (batch)

| Item | Value |
|---|---|
| Request | `POST {ELEVENLABS_BASE_URL}/v1/speech-to-text` |
| Auth | `xi-api-key: <ELEVENLABS_API_KEY>`, server-side only |
| Body | `multipart/form-data`: `file` (Blob with the upload's MIME type, synthetic name `answer.<ext>`), `model_id=scribe_v2`, `tag_audio_events=<config>` |
| Never sent by default | `no_verbatim` (would strip "um" and "uh"), `keyterms` (billed extra) |
| Timeout | `ELEVENLABS_STT_TIMEOUT_MS` via `AbortSignal.timeout`, combined with the HTTP client's disconnect signal |

Response mapping:

| ElevenLabs field | Normalized |
|---|---|
| `text` | `text` (trimmed). A missing or non-string value is `upstream`. |
| `language_code` | `languageCode` |
| `language_probability` | `languageProbability` |
| `words[].type == "spacing"` | dropped |
| `words[].type == "word" / "audio_event"` | `kind: "word" / "audio_event"` |
| `words[].start`, `.end` | `startSeconds`, `endSeconds` |
| `words[].logprob` | `logprob` |
| `words[].speaker_id` | `speakerId` |

HTTP error mapping (`mapElevenLabsHttpError`):

| Upstream | Code |
|---|---|
| any status with `detail.status` containing `quota` | `quota_exceeded` |
| 401, 403 | `auth_failed` |
| 402 | `quota_exceeded` |
| 429 | `rate_limited` |
| 400, 413, 415, 422 | `invalid_audio` |
| 408 | `timeout` |
| other non-2xx | `upstream` |
| `fetch` rejects (own timeout) | `timeout` |
| `fetch` rejects (caller aborted) | `aborted` |
| `fetch` rejects (other) | `network` |
| no key configured | `not_configured` (no request is made) |

A 422 caused by a misconfigured `ELEVENLABS_STT_MODEL` also maps to
`invalid_audio` and does not fail over. The doctor prints the configured model
so this is easy to spot.

## whisper.cpp (local)

Pipeline per request, in `mkdtemp(os.tmpdir()/ai-interviewer-stt-*)`:

```text
input.<ext>  --ffmpeg-->  audio.wav  --whisper-cli-->  transcript.json
```

```text
ffmpeg -hide_banner -loglevel error -nostdin -y -i input.<ext> -t <MAX_UTTERANCE_SECONDS>
       -vn -ac 1 -ar 16000 -c:a pcm_s16le -f wav audio.wav
whisper-cli -m <WHISPER_MODEL_PATH> -f audio.wav -l <WHISPER_LANGUAGE> -oj -of transcript -np [-t <WHISPER_THREADS>]
```

Both run through `spawn(cmd, argsArray, { shell: false })`. The directory is
removed in `finally`.

`-oj` output: `{ result: { language }, transcription: [{ offsets: { from, to } (ms), text }] }`.
Segments that are only non-speech markers such as `[BLANK_AUDIO]` are dropped.
Fillers are kept.

| Failure | Code |
|---|---|
| model path unset or file missing | `not_configured` (nothing is spawned) |
| ffmpeg or whisper-cli cannot spawn (`ENOENT`, `EACCES`) | `provider_unavailable` |
| ffmpeg exits non-zero | `invalid_audio` |
| whisper-cli exits non-zero, no JSON, or invalid JSON | `upstream` |
| either process exceeds its timeout | `timeout` |
| client disconnects | `aborted` |

## Error taxonomy and failover

| Code | Fail over | Retryable | Final HTTP status |
|---|:-:|:-:|---|
| `invalid_audio` | no | no | 422 `stt_invalid_audio` |
| `aborted` | no | no | none (client gone) |
| `not_configured` | yes | no | 503 |
| `provider_unavailable` | yes | yes | 503 |
| `auth_failed` | yes | no | 502 |
| `quota_exceeded` | yes | no | 429 |
| `rate_limited` | yes | yes | 429 |
| `network` | yes | yes | 502 |
| `timeout` | yes | yes | 504 |
| `upstream` | yes | yes | 502 |

When every provider fails with eligible errors, the route returns the **last**
provider's code as `stt_<code>` along with all attempts. `auth_failed` returns
502, not 401, because the browser's credentials are not the problem.
Unexpected exceptions from a provider become `upstream`, so the fallback can
still run.

## HTTP API

`POST /api/audio/transcribe` (`multipart/form-data`)

| Field | Rule |
|---|---|
| `audio` | exactly one file; `audio/webm`, `audio/mp4`, `audio/ogg`, `audio/wav`, `audio/x-wav`, or `audio/wave` (codec parameters ignored); non-empty; at most `MAX_AUDIO_UPLOAD_MB` |
| `durationSeconds` | required number, greater than 0 and at most `MAX_UTTERANCE_SECONDS` |

| Status | Code |
|---|---|
| 200 | `{ transcript, noSpeechDetected, provider, fallback: { used, reason, attempts } }` |
| 400 | `audio_missing`, `too_many_files`, `audio_empty`, `duration_missing`, `duration_invalid`, `malformed_multipart` |
| 413 | `audio_too_large` (enforced while streaming, plus a file-size check) |
| 415 | `unsupported_audio_type`, `unsupported_content_type` |
| 422 | `audio_too_long`, `stt_invalid_audio` |
| 429, 502, 503, 504 | `stt_<code>` from the table above |
| 500 | `internal_error` (generic; only the error class name is logged) |

`GET /api/health` returns the configured provider order and limits. It makes
no provider calls.
