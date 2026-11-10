# Operations: setup, diagnosis, privacy

## Setup checklist

1. `cp .env.example .env`. Only the user edits `.env`. Never write a key or a
   placeholder into it on their behalf.
2. ElevenLabs (optional): each student uses their own key. Set
   `ELEVENLABS_API_KEY`.
3. Local fallback (optional, nothing is downloaded automatically):
   - ffmpeg: `brew install ffmpeg` (macOS), `sudo apt install ffmpeg`
     (Debian/Ubuntu), or `winget install ffmpeg` (Windows).
   - whisper.cpp: build from <https://github.com/ggml-org/whisper.cpp>
     (`cmake -B build && cmake --build build -j --config Release`). The binary
     is `build/bin/whisper-cli`. Package managers also work, for example
     `brew install whisper-cpp`.
   - Model: `ggml-small.en.bin` is the recommended English default.
     `ggml-medium.en.bin` gives better accuracy at noticeably higher latency
     and memory use. Download the model yourself with whisper.cpp's
     `models/download-ggml-model.sh small.en` or from its documented model
     host. Put it at `models/whisper/`, which is gitignored, or set
     `WHISPER_MODEL_PATH`.
4. `npm run doctor`, then `npm run start:api`.

## Diagnosis matrix

Start with `npm run doctor`. Then reproduce with curl (see `README.md`) and read
the `error.code` and the `fallback.attempts` array.

| Symptom | Likely cause | Check or fix |
|---|---|---|
| `503 stt_not_configured`, attempts show `elevenlabs: not_configured` | No key, and no usable fallback | Set the key, or install whisper.cpp; typed answers still work |
| `fallback.reason: "quota_exceeded"` | ElevenLabs credits exhausted | Expected behavior; fallback served the request |
| `502 stt_auth_failed` | Wrong or revoked key | Regenerate the key; doctor checks presence only |
| `422 stt_invalid_audio` from ElevenLabs | Corrupt upload, or a wrong `ELEVENLABS_STT_MODEL` | Play the file locally; check the model ID in the doctor output |
| `422 stt_invalid_audio` from whisper | ffmpeg cannot decode the upload | `ffmpeg -i file` locally; check the MIME type matches the bytes |
| `503 stt_provider_unavailable` | `whisper-cli` or `ffmpeg` not on PATH | Set an absolute `WHISPER_CLI_PATH` / `FFMPEG_PATH` |
| `504 stt_timeout` on whisper | Model too large for the CPU | Use `small.en`, set `WHISPER_THREADS`, raise `WHISPER_TIMEOUT_MS` |
| Text in the wrong language with `*.en.bin` | `WHISPER_LANGUAGE` is not `en` | Doctor warns about this; use `en` or a multilingual model |
| `415 unsupported_audio_type` | Browser or curl sent an unexpected type | curl: `-F "audio=@a.webm;type=audio/webm"`; browser: check `selectRecordingMimeType` |
| `413 audio_too_large` / `422 audio_too_long` | Over `MAX_AUDIO_UPLOAD_MB` / `MAX_UTTERANCE_SECONDS` | Record shorter answers; raise the limits deliberately |
| Recorder `permission_denied` | Mic blocked, or a non-secure origin | Use `http://localhost` (a secure context); reset site permissions |
| `noSpeechDetected: true` | Silence or a muted mic | The UI asks to retry or type; this is not scored as a weak answer |

Do not "fix" a failure by adding `invalid_audio` to the failover set. A second
provider receiving the same bad audio only doubles latency and cost.

## Privacy and cost

- In ElevenLabs mode, audio leaves the device and uses the account's credits.
  The free tier is limited and can change. Tell candidates which provider is
  active.
- whisper.cpp mode is fully local. Temporary files live in a private temp
  directory and are deleted after every request.
- The server never logs raw audio, transcript text, the key, or auth headers.
  The doctor prints only whether a key is set.
- The API binds to `127.0.0.1` by default. Do not expose it to a LAN without
  adding authentication.
- Uploads are buffered in memory up to the limit and never written to the repo.
