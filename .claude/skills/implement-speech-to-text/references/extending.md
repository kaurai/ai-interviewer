# Extending the STT module

## Add a provider

Example targets: `whisper-server` over localhost HTTP, faster-whisper in a
Python sidecar, or Groq Whisper (cloud; a separate vendor, so disclose it).

1. **ID**: add it to `STT_PROVIDER_IDS` in `providers/stt/types.ts`. Config
   validation and the factory then accept it.
2. **Adapter**: create `providers/stt/<name>.ts` that exports
   `create<Name>SttProvider(config, deps)`. Inject `fetch` or the process
   runner. Map every failure to an `STTError` code, and return the normalized
   `TranscriptionResult`.
3. **Config**: add variables to `config.ts` (validated, with defaults) and to
   `.env.example` (placeholders and comments). Secrets must appear in
   `describeSttConfig` only as `set` or `missing`.
4. **Factory**: add a `case` in `createSttProvider`. The `switch` is exhaustive,
   so TypeScript reports a missing case.
5. **Readiness**: implement `checkReadiness()` with local checks only. The
   doctor picks it up automatically.
6. **Tests**: copy the structure of `elevenlabs.test.ts` or
   `whisperLocal.test.ts`. Cover the request shape, normalization, each error
   mapping, missing configuration, and the no-leak assertions.
7. **Docs**: add a row to the README provider table and to the operations
   diagnosis matrix.

Do not let a free-tier provider fail over silently to a paid one. The fallback
is chosen explicitly in `.env`.

## Change failover behavior

Edit `STT_ERROR_POLICY` in `errors.ts`, which is the only source of truth, and
update the policy test in `orchestrator.test.ts` plus the table in
`provider-contracts.md`. For one-off behavior, inject a custom `FailoverPolicy`
into `createSttOrchestrator` instead.

## Mount in Express later

Route handlers take `(req, res, ctx)` on top of `node:http`. To move to Express:

```ts
const handler = createTranscribeHandler({ stt, limits });
app.post('/api/audio/transcribe', (req, res) =>
  handler(req, res, { requestId: crypto.randomUUID(), signal: abortOnClose(res), logger }));
```

`abortOnClose` is a small helper you would write: create an `AbortController`
and abort it when `res` emits `close` before finishing, as
`createRequestListener` in `http/router.ts` does. Do not add a body parser in
front of this route; it reads the multipart stream
itself and enforces the size limit.

## Out of scope here

- Realtime Scribe (`scribe_v2_realtime`, single-use tokens, WebSocket PCM).
  `CONTEXT.md` 11.2 treats this as a later phase. Its result must still feed
  the same editable-draft flow.
- Text-to-speech, interview planning, and scoring.
