# AI Interviewer

## Run the code

### Requirements

- Node.js 22 or newer
- npm

No API key, speech model, or external service is required for the offline demo
or a text-only interview.

### 1. Install and run the offline demo

```bash
npm install
npm run interview:demo
```

This runs a deterministic three-question interview using the sample resume and
answers in `data/fixtures/`. It does not use the network and does not save a
session. The generated feedback report is printed in the terminal.

### 2. Run an interactive interview

```bash
cp .env.example .env   # optional; the defaults support text mode
npm run doctor
npm run interview
```

The CLI asks for an optional resume, target role, seniority, focus areas,
answer mode, and interview length. For the simplest first run, leave the
resume blank and choose `text` mode.

You can also supply the setup on the command line:

```bash
npm run interview -- \
  --resume ./resume.pdf \
  --role backend \
  --seniority mid \
  --focus caching,reliability \
  --questions 3
```

Use these commands while an interview is running:

| Command | Effect |
|---|---|
| `/repeat` | Show the current question again |
| `/skip` | Skip the current question |
| `/end` | End the interview and generate feedback |
| `/help` | Show the available commands |

By default, completed sessions and reports are written to `data/sessions/`.
Add `--no-save` to keep the entire run in memory:

```bash
npm run interview -- --questions 3 --no-save
```

### 3. Run the transcription API

The API is a separate speech-to-text service. It is not required for text-mode
CLI interviews.

Start it with the fake provider for a no-credential wiring test:

```bash
STT_PROVIDER=fake STT_FALLBACK_PROVIDER=none npm run start:api
```

The server listens on `http://127.0.0.1:3001` by default. In another terminal:

```bash
curl http://127.0.0.1:3001/api/health
```

For development with automatic restart:

```bash
npm run dev:api
```

To transcribe real speech, configure ElevenLabs or whisper.cpp as described in
[Speech-to-text setup](#speech-to-text-setup).

## What this project does

AI Interviewer is a local-first mock interview system for backend, frontend,
product, and behavioral practice. It can:

- build a role- and seniority-aware interview from a validated 60-question bank;
- use optional resume signals to improve question selection;
- accept typed answers or audio-file answers;
- ask at most one targeted follow-up per main question by default;
- produce an evidence-grounded Markdown and JSON feedback report; and
- keep working in text mode when speech providers are unavailable.

This is practice software, not a hiring assessment. The deterministic evaluator
scores only what it can support from the committed transcript. It deliberately
leaves technical accuracy and other unsupported dimensions unassessed.

### Current interfaces

| Interface | Status | Purpose |
|---|---|---|
| Terminal interview | Complete | Runs the end-to-end interview and report pipeline |
| Local HTTP API | Complete | Health check and audio transcription |
| Browser voice modules | Library only | Recorder, transcription client, and editable-answer controller; no finished web UI yet |

## CLI reference

```text
npm run interview -- [options]
npm run interview -- delete <session-id>
```

| Option | Accepted values | Description |
|---|---|---|
| `--resume FILE` | `.txt`, `.md`, `.pdf`, `.docx` | Extract bounded professional signals from a resume |
| `--role ROLE` | `backend`, `frontend`, `product`, `behavioral` | Set the target interview role |
| `--seniority LEVEL` | `junior`, `mid`, `senior` | Set the target level |
| `--focus a,b` | Comma-separated text | Prioritize topics or skills |
| `--years N` | `0`–`60` | Set years of experience |
| `--mode MODE` | `text`, `voice` | Choose typed or audio-file answers |
| `--questions N` | `1`–`6` | Use a fixed number of main questions |
| `--duration N` | `5`, `10`, `15` | Use a time budget instead of a question count |
| `--tts PROVIDER` | `none`, `say`, `espeak`, `spd-say` | Read interviewer questions aloud |
| `--answers FILE` | JSON array of strings | Supply scripted answers for testing or demos |
| `--no-save` | Flag | Keep session state and reports in memory |
| `--yes` | Flag | Skip the consent prompt |
| `--help` | Flag | Print CLI help |

`--questions` and `--duration` are mutually exclusive.

### Voice-file answers

Start an interview in voice mode:

```bash
npm run interview -- --mode voice --questions 3
```

At an answer prompt, enter an audio file instead of text:

```text
/audio ./answer.wav
/audio ./answer.m4a 42
```

WAV duration is read from the file header. WebM, MP4/M4A, and Ogg files need a
duration in seconds. After transcription, the CLI shows a draft and lets you
correct it before committing the answer. Typing an answer remains available in
voice mode.

Supported audio extensions are `.wav`, `.webm`, `.mp4`, `.m4a`, and `.ogg`.
The default limits are 10 MB and 60 seconds.

### Saved output

A saved interview creates three files:

```text
data/sessions/
├── <session-id>.json
├── <session-id>.report.md
└── <session-id>.report.json
```

Delete all three files for a session with:

```bash
npm run interview -- delete iv_0123456789abcdef01234567
```

Session IDs are printed when an interview starts. `data/sessions/` is ignored
by Git because transcripts may contain personal information.

## Configuration

The application loads `.env` from the repository root when the file exists.
Copy the documented template before changing any defaults:

```bash
cp .env.example .env
npm run doctor
```

`npm run doctor` validates configuration, the question bank, Node.js support,
resume parsers, text-to-speech readiness, speech-to-text provider readiness,
and local tool paths. It never prints API keys or calls a paid API.

Important settings include:

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | API bind address |
| `PORT` | `3001` | API port |
| `STT_PROVIDER` | `elevenlabs` | Primary transcription provider |
| `STT_FALLBACK_PROVIDER` | `whisper-local` | Fallback provider; use `none` to disable |
| `MAX_AUDIO_UPLOAD_MB` | `10` | Maximum audio upload size |
| `MAX_UTTERANCE_SECONDS` | `60` | Maximum recording duration |
| `CLI_TTS_PROVIDER` | `none` | Default spoken-question provider |
| `INTERVIEW_DEFAULT_QUESTIONS` | `3` | Default main-question count |
| `INTERVIEW_MAX_FOLLOWUPS_PER_QUESTION` | `1` | Follow-up cap (`0` or `1`) |
| `INTERVIEW_SESSIONS_DIR` | `./data/sessions` | Local output directory |

See `.env.example` for every setting, accepted value, and limit.

## Speech-to-text setup

Provider order is controlled by `STT_PROVIDER` and
`STT_FALLBACK_PROVIDER`. The fallback runs for configuration, quota, rate
limit, network, timeout, and provider failures. Invalid audio and cancelled
requests are not retried on another provider.

| Provider | Value | Audio location | Required setup |
|---|---|---|---|
| ElevenLabs Scribe v2 | `elevenlabs` | Sent to ElevenLabs | `ELEVENLABS_API_KEY` |
| whisper.cpp | `whisper-local` | Remains on this machine | `whisper-cli`, `ffmpeg`, and a model |
| Fake | `fake` | Ignored | None; development only |

### ElevenLabs

Add your server-side key to `.env`:

```dotenv
STT_PROVIDER=elevenlabs
STT_FALLBACK_PROVIDER=whisper-local
ELEVENLABS_API_KEY=your-key-here
```

The key stays in the server process. It is not sent to browser code, printed by
the doctor, or included in application logs. ElevenLabs requests use account
credits and send the audio to a third party.

### Local whisper.cpp fallback

Nothing is downloaded automatically.

1. Install ffmpeg.
2. Install or build [whisper.cpp](https://github.com/ggml-org/whisper.cpp).
3. Download a whisper.cpp GGML model. The recommended English workshop model
   is `ggml-small.en.bin` (approximately 465 MB).
4. Put the model at `models/whisper/ggml-small.en.bin`, or set an absolute
   `WHISPER_MODEL_PATH` in `.env`.
5. Run `npm run doctor`.

Example macOS setup:

```bash
brew install ffmpeg whisper-cpp
git clone https://github.com/ggml-org/whisper.cpp /tmp/whisper.cpp
/tmp/whisper.cpp/models/download-ggml-model.sh small.en
mkdir -p models/whisper
cp /tmp/whisper.cpp/models/ggml-small.en.bin models/whisper/
npm run doctor
```

For a fully local configuration:

```dotenv
STT_PROVIDER=whisper-local
STT_FALLBACK_PROVIDER=none
WHISPER_CLI_PATH=whisper-cli
WHISPER_MODEL_PATH=./models/whisper/ggml-small.en.bin
WHISPER_LANGUAGE=en
FFMPEG_PATH=ffmpeg
```

Uploaded audio is converted to 16 kHz mono WAV in a private temporary
directory, transcribed, and deleted. Local models and binaries are ignored by
Git.

## HTTP API

The server uses Node's built-in HTTP stack and binds to loopback by default.
It currently exposes two routes.

### `GET /api/health`

Returns a secret-free configuration summary:

```bash
curl http://127.0.0.1:3001/api/health
```

### `POST /api/audio/transcribe`

Send `multipart/form-data` with exactly two fields:

| Field | Description |
|---|---|
| `audio` | One non-empty `audio/webm`, `audio/mp4`, `audio/ogg`, or `audio/wav` file |
| `durationSeconds` | Positive recording length no greater than `MAX_UTTERANCE_SECONDS` |

```bash
curl -s http://127.0.0.1:3001/api/audio/transcribe \
  -F "audio=@answer.webm;type=audio/webm" \
  -F "durationSeconds=12.4"
```

Successful responses include the normalized transcript, provider used, and a
summary of fallback attempts:

```json
{
  "transcript": {
    "text": "I would use a token bucket backed by Redis...",
    "languageCode": "en",
    "languageProbability": 0.98,
    "words": [],
    "segments": []
  },
  "noSpeechDetected": false,
  "provider": "elevenlabs",
  "fallback": {
    "used": false,
    "reason": null,
    "attempts": [{ "provider": "elevenlabs", "outcome": "succeeded" }]
  }
}
```

Errors use this shape:

```json
{
  "error": {
    "code": "audio_too_long",
    "message": "Recordings must be at most 60 seconds.",
    "retryable": false
  }
}
```

The response may also include `fallback` when all configured providers fail.

## How the interview pipeline works

```text
candidate setup
      │
      ├── optional resume ──► bounded professional signals
      │
      ▼
deterministic planner ──► lexical question retrieval ──► interview plan
      │
      ▼
question ──► committed answer ──► optional follow-up ──► next question
      │
      ▼
evidence extraction ──► conservative dimension scoring ──► MD + JSON reports
```

- Resume parsing supports text, Markdown, PDF, and DOCX. Raw resume text,
  filenames, paths, and contact details are not persisted.
- Resume-derived signals affect question selection only; they never increase a
  score.
- The question bank supplies expected signals, follow-up probes, and scoring
  anchors. Private assessment material is never part of the candidate prompt.
- The canonical answer is the text the candidate commits after any transcript
  correction.
- Every quoted report item is validated against a candidate transcript turn.
- The current evaluator is deterministic and offline. It measures observable
  coverage, relevance, structure, reasoning markers, examples, and similar
  evidence; it does not claim to verify technical correctness.

## Architecture

This is an npm workspace organized around shared runtime schemas:

```text
apps/
├── api/
│   ├── src/domain/          interview planning, turn logic, retrieval, evaluation
│   ├── src/providers/stt/   ElevenLabs, whisper.cpp, fake provider, failover
│   ├── src/resume/          TXT, Markdown, PDF, and DOCX parsing
│   ├── src/routes/          HTTP transcription route
│   └── test/                API, pipeline, persistence, and STT tests
├── cli/                     interactive terminal interview
└── web/src/voice/           framework-free browser voice modules
packages/
└── shared/                  Zod schemas, types, audio contracts, validation
data/
├── fixtures/                deterministic demo inputs
└── questions/               validated seed question bank
scripts/                     doctor and question-bank utilities
docs/                        workshop guide
```

Important design properties:

- Zod schemas are the runtime source of truth; TypeScript types are derived
  from them.
- The interview service owns the state machine and idempotent turn handling.
- Session writes are validated, serialized per session, and atomically renamed.
- Speech providers implement one normalized interface behind an explicit
  failover policy.
- Tests inject fake clocks, providers, process runners, and stores, so the test
  suite does not need network access or local speech binaries.

## Question-bank tools

Validate the committed seed bank:

```bash
npm run validate:questions
```

Inspect one complete record, including private expected signals and probes:

```bash
npm run questions:show -- backend_rate_limiter_01
```

Test retrieval and see why each question ranked where it did:

```bash
npm run questions:search -- \
  --role backend \
  --seniority mid \
  --focus caching \
  --top 5
```

The search command also supports repeatable `--competency`, `--exclude`, and
`--type` filters, plus `--text`, `--difficulty`, and `--json`.

To validate a separate bank without enforcing the fixed seed-bank size and
role distribution:

```bash
npm run validate:questions -- path/to/questions.json --no-seed-rules
```

## Development commands

| Command | Purpose |
|---|---|
| `npm run interview:demo` | Run the deterministic offline demo |
| `npm run interview` | Run an interactive interview |
| `npm run doctor` | Check configuration, tools, providers, parsers, and question data |
| `npm run start:api` | Start the API once |
| `npm run dev:api` | Start the API with file watching |
| `npm test` | Run the entire test suite |
| `npm run test:pipeline` | Run pipeline, persistence, resume, and CLI tests |
| `npm run test:stt` | Run API and browser speech-to-text tests |
| `npm run test:questions` | Run question validation and retrieval tests |
| `npm run typecheck` | Type-check Node and browser TypeScript targets |
| `npm run validate:questions` | Validate the question bank |
| `npm run questions:show -- ID` | Inspect one question record |
| `npm run questions:search -- ...` | Run an explained retrieval query |

Before submitting a change, run:

```bash
npm run typecheck
npm test
npm run validate:questions
```

## Privacy and safety boundaries

- The default API address, `127.0.0.1`, is not reachable from other machines.
- Raw resumes and audio are never saved by the application.
- Corrected answer text and bounded resume signals are saved unless
  `--no-save` is used.
- Audio uploads stay in memory. whisper.cpp temporary files are removed after
  each request.
- Logs contain operational metadata, not audio, transcript text, or keys.
- Cloud transcription sends audio to ElevenLabs and may consume account
  credits; local whisper.cpp transcription does neither.
- Delivery scoring uses measured timing only. The system does not assess
  accent, facial expression, emotion, protected traits, or job suitability.

## Troubleshooting

| Problem | Resolution |
|---|---|
| Node reports an unsupported version | Install Node.js 22 or newer, then reinstall dependencies |
| `503 stt_not_configured` | Set `ELEVENLABS_API_KEY`, configure whisper.cpp, or use typed answers |
| `502 stt_auth_failed` | Replace an invalid or revoked ElevenLabs key |
| `429 stt_quota_exceeded` | Add credits, enable the local fallback, or type the answer |
| `503 stt_provider_unavailable` | Check `WHISPER_CLI_PATH`, `WHISPER_MODEL_PATH`, and `FFMPEG_PATH` |
| `504 stt_timeout` with whisper.cpp | Use a smaller model, set `WHISPER_THREADS`, or raise `WHISPER_TIMEOUT_MS` |
| `422 stt_invalid_audio` | Confirm the file plays and its content matches its extension or MIME type |
| `415 unsupported_audio_type` with curl | Add the correct `;type=audio/...` to the file field |
| Non-WAV CLI audio has no duration | Add seconds after the path: `/audio answer.m4a 42` |
| No session files appear | Remove `--no-save` and check `INTERVIEW_SESSIONS_DIR` |
| Port 3001 is already in use | Stop the other process or set a different `PORT` in `.env` |

Start diagnosis with `npm run doctor`; warnings about optional voice providers
do not prevent text-mode interviews.

## Further documentation

- `docs/WORKSHOP.md` — hands-on implementation and extension exercises
- `CONTEXT.md` — detailed product and architecture blueprint
- `AI_INTERVIEWER_SKILL.md` — reusable project workflow guidance

## License

Licensed under the Apache License 2.0. See `LICENSE`.
