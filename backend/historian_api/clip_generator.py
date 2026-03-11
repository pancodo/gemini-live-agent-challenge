"""Clip generator -- creates shareable MP4 clips from documentary segments.

Pipeline:
  1. Fetch segment data from Firestore (imageUrls, script, title)
  2. Download images from GCS (signed URLs already exist)
  3. Generate TTS narration via Gemini (non-live, audio output)
  4. ffmpeg: images slideshow + audio -> 720p MP4
  5. Upload MP4 to GCS -> generate signed download URL
  6. Update Firestore clip status doc
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
import wave
from datetime import timedelta
from pathlib import Path

import google.auth
import google.auth.transport.requests
import httpx
from google import genai
from google.cloud import firestore, storage
from google.genai import types as genai_types

logger = logging.getLogger(__name__)

GCS_BUCKET = os.environ.get("GCS_BUCKET_NAME", "historian-docs")
GCP_PROJECT = os.environ.get("GCP_PROJECT_ID", "")

# ---------------------------------------------------------------------------
# Singleton clients
# ---------------------------------------------------------------------------

_db: firestore.AsyncClient | None = None
_gcs: storage.Client | None = None


def _get_db() -> firestore.AsyncClient:
    global _db
    if _db is None:
        _db = firestore.AsyncClient()
    return _db


def _get_gcs() -> storage.Client:
    global _gcs
    if _gcs is None:
        _gcs = storage.Client()
    return _gcs


# ---------------------------------------------------------------------------
# Firestore helpers
# ---------------------------------------------------------------------------

async def _set_clip_status(
    session_id: str,
    clip_id: str,
    status: str,
    *,
    download_url: str | None = None,
    error_message: str | None = None,
) -> None:
    """Update the clip document in Firestore."""
    db = _get_db()
    data: dict[str, object] = {"status": status}
    if download_url is not None:
        data["downloadUrl"] = download_url
    if error_message is not None:
        data["errorMessage"] = error_message
    await (
        db.collection("sessions")
        .document(session_id)
        .collection("clips")
        .document(clip_id)
        .update(data)
    )


# ---------------------------------------------------------------------------
# Image download
# ---------------------------------------------------------------------------

async def _download_image(url: str, dest: Path) -> bool:
    """Download a single image URL to *dest*. Returns True on success."""
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0), follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            dest.write_bytes(resp.content)
            return True
    except Exception:
        logger.warning("Failed to download image %s", url, exc_info=True)
        return False


async def _download_images(image_urls: list[str], work_dir: Path) -> list[Path]:
    """Download all segment images concurrently. Returns list of local paths."""
    tasks = []
    paths: list[Path] = []
    for i, url in enumerate(image_urls):
        dest = work_dir / f"frame{i}.jpg"
        paths.append(dest)
        tasks.append(_download_image(url, dest))

    results = await asyncio.gather(*tasks)
    return [p for p, ok in zip(paths, results) if ok]


# ---------------------------------------------------------------------------
# TTS via Gemini
# ---------------------------------------------------------------------------

async def _generate_narration(script: str, dest: Path) -> bool:
    """Generate TTS narration WAV using Gemini 2.5 Flash with audio output.

    Returns True on success.
    """
    try:
        client = genai.Client(
            vertexai=True,
            project=GCP_PROJECT,
            location="us-central1",
        )

        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash-preview-tts",
            contents=script,
            config=genai_types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=genai_types.SpeechConfig(
                    voice_config=genai_types.VoiceConfig(
                        prebuilt_voice_config=genai_types.PrebuiltVoiceConfig(
                            voice_name="Kore",
                        ),
                    ),
                ),
            ),
        )

        # Extract audio bytes from response
        audio_data: bytes | None = None
        if response.candidates:
            for part in response.candidates[0].content.parts:
                if part.inline_data and part.inline_data.mime_type.startswith("audio/"):
                    audio_data = part.inline_data.data
                    break

        if not audio_data:
            logger.warning("No audio data in Gemini TTS response")
            return False

        # Write raw PCM to WAV (Gemini returns 24kHz 16-bit mono PCM)
        sample_rate = 24000
        with wave.open(str(dest), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(sample_rate)
            wf.writeframes(audio_data)

        return True
    except Exception:
        logger.warning("TTS generation failed", exc_info=True)
        return False


# ---------------------------------------------------------------------------
# ffmpeg composition
# ---------------------------------------------------------------------------

def _ffmpeg_available() -> bool:
    """Check whether ffmpeg is on PATH."""
    return shutil.which("ffmpeg") is not None


async def _compose_video(
    image_paths: list[Path],
    narration_path: Path | None,
    output_path: Path,
) -> bool:
    """Compose images + optional narration into an MP4 via ffmpeg.

    Returns True on success. Uses asyncio.create_subprocess_exec with
    a hardcoded argument list (no shell interpretation).
    """
    if not _ffmpeg_available():
        logger.warning("ffmpeg not found -- falling back to image-only clip")
        return False

    work_dir = image_paths[0].parent

    # Determine audio duration if narration exists
    audio_duration: float | None = None
    if narration_path and narration_path.exists():
        try:
            with wave.open(str(narration_path), "rb") as wf:
                frames = wf.getnframes()
                rate = wf.getframerate()
                audio_duration = frames / rate
        except Exception:
            audio_duration = None

    scale_filter = (
        "scale=1280:720:force_original_aspect_ratio=decrease,"
        "pad=1280:720:(ow-iw)/2:(oh-ih)/2"
    )

    if len(image_paths) == 1:
        # Single image: loop it for the audio duration (or 10s fallback)
        duration = audio_duration or 10.0
        cmd: list[str] = ["ffmpeg", "-y", "-loop", "1", "-i", str(image_paths[0])]
        if narration_path and narration_path.exists():
            cmd += ["-i", str(narration_path)]
        cmd += [
            "-t", f"{duration:.2f}",
            "-vf", scale_filter,
            "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p",
        ]
        if narration_path and narration_path.exists():
            cmd += ["-c:a", "aac", "-shortest"]
        cmd.append(str(output_path))
    elif len(image_paths) <= 2:
        # 2 images: use concat demuxer to fill time
        duration = audio_duration or 10.0
        frame_dur = duration / len(image_paths)

        # Create a concat file
        concat_file = work_dir / "concat.txt"
        lines: list[str] = []
        for p in image_paths:
            lines.append(f"file '{p}'")
            lines.append(f"duration {frame_dur:.2f}")
        # ffmpeg concat demuxer needs last file repeated without duration
        lines.append(f"file '{image_paths[-1]}'")
        concat_file.write_text("\n".join(lines))

        cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file)]
        if narration_path and narration_path.exists():
            cmd += ["-i", str(narration_path)]
        cmd += [
            "-vf", scale_filter,
            "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p",
        ]
        if narration_path and narration_path.exists():
            cmd += ["-c:a", "aac", "-shortest"]
        cmd.append(str(output_path))
    else:
        # 3+ images: slideshow at calculated framerate
        if audio_duration:
            framerate = len(image_paths) / audio_duration
        else:
            framerate = 0.5  # 2 seconds per image

        # Rename images sequentially for ffmpeg glob
        for i, p in enumerate(image_paths):
            target = work_dir / f"slide{i}.jpg"
            if p != target:
                p.rename(target)

        cmd = [
            "ffmpeg", "-y",
            "-framerate", f"{framerate:.4f}",
            "-i", str(work_dir / "slide%d.jpg"),
        ]
        if narration_path and narration_path.exists():
            cmd += ["-i", str(narration_path)]
        cmd += [
            "-vf", scale_filter,
            "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p",
        ]
        if narration_path and narration_path.exists():
            cmd += ["-c:a", "aac", "-shortest"]
        cmd.append(str(output_path))

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()

    if proc.returncode != 0:
        logger.error(
            "ffmpeg failed (rc=%d): %s",
            proc.returncode,
            stderr.decode(errors="replace")[:500],
        )
        return False

    return True


# ---------------------------------------------------------------------------
# GCS upload + signed URL
# ---------------------------------------------------------------------------

def _upload_to_gcs_sync(local_path: Path, blob_path: str) -> str:
    """Upload file to GCS and return a 24-hour signed GET URL (sync)."""
    client = _get_gcs()
    bucket = client.bucket(GCS_BUCKET)
    blob = bucket.blob(blob_path)
    blob.upload_from_filename(str(local_path), content_type="video/mp4")

    credentials, _ = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    signed_url: str = blob.generate_signed_url(
        credentials=credentials,
        version="v4",
        expiration=timedelta(hours=24),
        method="GET",
    )
    return signed_url


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def generate_clip(session_id: str, segment_id: str, clip_id: str) -> None:
    """Generate a shareable MP4 clip for a segment.

    This runs as a FastAPI background task. Updates Firestore with progress.
    """
    try:
        await _set_clip_status(session_id, clip_id, "generating")

        # 1. Fetch segment data from Firestore
        db = _get_db()
        seg_doc = await (
            db.collection("sessions")
            .document(session_id)
            .collection("segments")
            .document(segment_id)
            .get()
        )
        if not seg_doc.exists:
            raise ValueError(f"Segment {segment_id} not found")

        seg_data = seg_doc.to_dict() or {}
        image_urls: list[str] = seg_data.get("imageUrls", [])
        script: str = seg_data.get("script", "")
        title: str = seg_data.get("title", "Untitled")

        if not image_urls:
            raise ValueError("Segment has no images")

        # 2. Work in a temp directory
        with tempfile.TemporaryDirectory(prefix="clip_") as tmp:
            work_dir = Path(tmp)

            # 3. Download images
            local_images = await _download_images(image_urls, work_dir)
            if not local_images:
                raise ValueError("Could not download any segment images")

            # 4. Generate TTS narration
            narration_path = work_dir / "narration.wav"
            narration_text = f"{title}. {script}" if script else title
            has_narration = await _generate_narration(narration_text, narration_path)
            if not has_narration:
                narration_path = None

            # 5. Compose video via ffmpeg
            output_path = work_dir / "clip.mp4"
            composed = await _compose_video(
                local_images,
                narration_path,
                output_path,
            )

            if not composed or not output_path.exists():
                # Fallback: use first image as the clip (no hard failure)
                logger.info(
                    "ffmpeg unavailable or failed -- using image fallback for clip %s",
                    clip_id,
                )
                first_image_url = image_urls[0]
                await _set_clip_status(
                    session_id,
                    clip_id,
                    "ready",
                    download_url=first_image_url,
                )
                return

            # 6. Upload to GCS
            blob_path = f"{session_id}/clips/{clip_id}.mp4"
            download_url = await asyncio.to_thread(
                _upload_to_gcs_sync, output_path, blob_path
            )

            # 7. Update Firestore with ready status
            await _set_clip_status(
                session_id,
                clip_id,
                "ready",
                download_url=download_url,
            )

        logger.info("Clip %s generated successfully", clip_id)

    except Exception as exc:
        logger.exception("Clip generation failed for %s", clip_id)
        try:
            await _set_clip_status(
                session_id,
                clip_id,
                "error",
                error_message=str(exc)[:500],
            )
        except Exception:
            logger.exception("Failed to write error status for clip %s", clip_id)
        raise
