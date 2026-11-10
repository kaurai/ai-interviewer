# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React, TypeScript, and Vite in an npm workspace, with a local Express API and local-first persistence.

## Users

Job candidates preparing for technical, product, and behavioral interviews. They use the product alone, usually on a laptop with a microphone, to rehearse realistic interview conversations and improve before a real interview.

## Product Purpose

Provide a complete practice interview: collect relevant candidate context, run a natural voice-led interview one question at a time, preserve an editable transcript, and turn that evidence into specific feedback and practice exercises.

## Positioning

This is a face-led voice interview rehearsal with evidence-grounded coaching. It is not a generic chatbot, video call, hiring decision system, or automated screening tool.

## Operating Context

The candidate first selects a target role, seniority, duration, and focus areas, then provides a short professional summary or optional resume. During the interview, the interviewer is the primary visual focus while the transcript remains visible in a side panel. The candidate answers by voice, reviews transcription before committing it, and receives a detailed feedback report after the session.

## Capabilities and Constraints

- Voice is the default interaction when available, with text fallback when recording, transcription, or provider credits fail.
- The interviewer asks one question at a time and uses no more than one or two relevant follow-ups before advancing.
- The transcript is reviewable and correctable before an answer is submitted.
- Feedback distinguishes scored competencies from unassessed areas and cites transcript evidence.
- Resume upload is optional. For the first UI release, local file selection can populate candidate context while full PDF parsing remains outside the reliable MVP path.
- No login, cloud database, payment, webcam analysis, facial or emotion scoring, automated hiring decisions, or recruitment screening.
- Interview records and exports remain local.

## Evidence on Hand

- Full product and architecture brief: `CONTEXT.md`.
- Existing browser voice recorder and transcription controller: `apps/web/src/voice/`.
- Existing Express speech-to-text route and provider adapters: `apps/api/src/`.
- Existing role-aware question bank: `data/questions/seed-questions.json`.
- No testimonials, customer claims, production benchmarks, or established visual brand assets are available and none should be fabricated.

## Product Principles

1. Conversation first: the interviewer should feel present, attentive, and easy to talk to.
2. Candidate control: users can pause, correct transcripts, switch to typing, and end the session at any time.
3. Evidence before judgment: every score and recommendation should trace back to the interview transcript.
4. Graceful degradation: provider failure or exhausted credits must never end a practice session.
5. Calm focus: each screen should make the next action obvious without turning the experience into a dense dashboard.

## Accessibility & Inclusion

Keyboard interaction must cover every interview control. Voice is optional, transcript correction is always available, reduced motion is respected, and assessments must exclude protected traits and demographic profiling.
