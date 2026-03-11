#!/usr/bin/env python3
"""Seed a demo session in Firestore for AI Historian demos.

Usage: python -m backend.scripts.seed_demo
       GCP_PROJECT_ID=my-project python backend/scripts/seed_demo.py

Creates a complete session with agents, segments, and visual manifests.
DEMO_SESSION_ID: 'demo-fall-of-constantinople-2026'
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone

from google.cloud import firestore

DEMO_SESSION_ID = "demo-fall-of-constantinople-2026"
GCP_PROJECT = os.environ.get("GCP_PROJECT_ID", "")

# ---------------------------------------------------------------------------
# Seed data
# ---------------------------------------------------------------------------

SESSION_DOC: dict[str, object] = {
    "status": "ready",
    "gcsPath": "gs://historian-docs/demo/document.pdf",
    "language": "English",
    "persona": "professor",
    "visualBible": (
        "Byzantine architecture, Ottoman military, medieval maps. "
        "Warm ochre and deep crimson palette. "
        "Cinematic wide shots of Hagia Sophia and city walls."
    ),
    "createdAt": datetime.now(timezone.utc),
}

AGENTS: list[dict[str, object]] = [
    {
        "id": "scan_agent",
        "query": "Analyze document structure and key themes",
        "status": "done",
        "elapsed": 4200,
        "facts": ["Byzantine Empire", "1453", "Sultan Mehmed II"],
    },
    {
        "id": "research_0",
        "query": "Ottoman military strategy at Constantinople 1453",
        "status": "done",
        "elapsed": 22100,
        "facts": [
            "Urban cannon — the largest ever cast",
            "Double walls breached May 29",
            "54-day siege",
        ],
    },
    {
        "id": "research_1",
        "query": "Constantine XI and the last Byzantine defenders",
        "status": "done",
        "elapsed": 18400,
        "facts": [
            "Emperor died fighting on the walls",
            "7,000 defenders vs 80,000 Ottoman troops",
            "Venetian and Genoese mercenaries present",
        ],
    },
]

SEGMENTS: list[dict[str, object]] = [
    {
        "id": "segment_0",
        "sceneId": "scene_0",
        "title": "The Last Emperor",
        "script": (
            "On the morning of May 29, 1453, Constantine XI Palaiologos donned "
            "his imperial purple one final time. Around him, the great walls of "
            "Constantinople — fortified for a thousand years — were breached."
        ),
        "mood": "Tragic",
        "status": "complete",
        "imageUrls": [
            "https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/Hagia_Sophia_Mars_2013.jpg/640px-Hagia_Sophia_Mars_2013.jpg",
            "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Constantinople_1453_campaign_map-fr.svg/640px-Constantinople_1453_campaign_map-fr.svg.png",
        ],
        "sources": ["en.wikipedia.org/wiki/Fall_of_Constantinople"],
        "graphEdges": [],
        "parentSegmentId": None,
    },
    {
        "id": "segment_1",
        "sceneId": "scene_1",
        "title": "The Great Cannon",
        "script": (
            "Hungarian engineer Urban offered his cannon to both sides. "
            "Constantine could not pay. Mehmed II could. The resulting siege "
            "gun fired stone balls weighing 600 kilograms."
        ),
        "mood": "Tension",
        "status": "complete",
        "imageUrls": [
            "https://upload.wikimedia.org/wikipedia/commons/thumb/7/71/Romeyn_de_Hooghe%2C_Alliantie_Europees_-_Ottoman_Empire%2C_1684.jpg/640px-Romeyn_de_Hooghe%2C_Alliantie_Europees_-_Ottoman_Empire%2C_1684.jpg",
        ],
        "sources": ["en.wikipedia.org/wiki/Orban_(engineer)"],
        "graphEdges": [],
        "parentSegmentId": None,
    },
    {
        "id": "segment_2",
        "sceneId": "scene_2",
        "title": "The City Falls Silent",
        "script": (
            "By noon, the janissaries had raised Ottoman flags above the "
            "Blachernae Palace. The city that had survived Attila, the Avars, "
            "two Arab sieges, and the Fourth Crusade had finally fallen."
        ),
        "mood": "Solemn",
        "status": "complete",
        "imageUrls": [
            "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/Jean-Joseph_Benjamin-Constant_-_Entry_of_Mahomet_II_into_Constantinople.jpg/640px-Jean-Joseph_Benjamin-Constant_-_Entry_of_Mahomet_II_into_Constantinople.jpg",
        ],
        "sources": ["en.wikipedia.org/wiki/Mehmed_II"],
        "graphEdges": [],
        "parentSegmentId": None,
    },
]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main() -> None:
    """Seed the demo session, deleting any existing one first."""
    db = firestore.AsyncClient(project=GCP_PROJECT or None)

    session_ref = db.collection("sessions").document(DEMO_SESSION_ID)

    # 1. Delete existing demo session (idempotency)
    # Delete subcollections first
    for subcol_name in ("agents", "segments"):
        subcol_ref = session_ref.collection(subcol_name)
        async for doc in subcol_ref.stream():
            await doc.reference.delete()

    await session_ref.delete()
    print(f"Cleaned existing session: {DEMO_SESSION_ID}")

    # 2. Write session document
    await session_ref.set(SESSION_DOC)

    # 3. Write agents
    for agent in AGENTS:
        agent_id = str(agent["id"])
        await session_ref.collection("agents").document(agent_id).set(agent)

    # 4. Write segments
    for segment in SEGMENTS:
        segment_id = str(segment["id"])
        await session_ref.collection("segments").document(segment_id).set(segment)

    print(f"Demo session seeded: {DEMO_SESSION_ID}")


if __name__ == "__main__":
    asyncio.run(main())
