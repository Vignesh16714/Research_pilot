"""
Optional upgrade-path voice endpoints. The frontend defaults to the
browser's built-in Web Speech API (SpeechRecognition / speechSynthesis)
for zero-setup STT/TTS. These two endpoints exist for the toggle to a
more accurate/natural experience via Groq's free tier, and are only
called when the user flips that toggle in the UI.
"""
from __future__ import annotations

import os

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.api.schemas import ApiError, SpeakRequest, TranscribeResponse

router = APIRouter(prefix="/api/voice")


def _groq_client():
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail=ApiError(
                kind="config_error",
                message="GROQ_API_KEY is not set — the voice upgrade path needs a free key from "
                "https://console.groq.com. The browser's built-in mic/speech toggle works without it.",
            ).model_dump(),
        )
    from groq import Groq

    return Groq(api_key=api_key)


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(audio: UploadFile = File(...)) -> TranscribeResponse:
    client = _groq_client()
    model = os.getenv("GROQ_WHISPER_MODEL", "whisper-large-v3-turbo")
    content = await audio.read()

    try:
        result = client.audio.transcriptions.create(
            file=(audio.filename or "audio.webm", content),
            model=model,
        )
    except Exception as exc:  # noqa: BLE001 - vendor SDK error shapes vary
        msg = str(exc)
        kind = "quota_exceeded" if "429" in msg or "rate" in msg.lower() else "internal_error"
        raise HTTPException(status_code=502, detail=ApiError(kind=kind, message=f"Transcription failed: {msg}").model_dump()) from exc

    return TranscribeResponse(text=result.text)


@router.post("/speak")
async def speak(body: SpeakRequest):
    client = _groq_client()
    model = os.getenv("GROQ_TTS_MODEL", "playai-tts")
    voice = body.voice or os.getenv("GROQ_TTS_VOICE", "Arista-PlayAI")

    try:
        response = client.audio.speech.create(
            model=model,
            voice=voice,
            input=body.text,
            response_format="wav",
        )
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        kind = "quota_exceeded" if "429" in msg or "rate" in msg.lower() else "internal_error"
        raise HTTPException(status_code=502, detail=ApiError(kind=kind, message=f"Speech synthesis failed: {msg}").model_dump()) from exc

    audio_bytes = response.read() if hasattr(response, "read") else response.content
    return StreamingResponse(iter([audio_bytes]), media_type="audio/wav")
