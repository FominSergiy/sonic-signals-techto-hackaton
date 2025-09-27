#!/usr/bin/env python3
"""
Persistent Whisper service that keeps the model loaded in memory.
This avoids the model loading time on each request.
"""

import sys
import json
import whisper
import argparse
import signal
import time
from pathlib import Path

class WhisperService:
    def __init__(self, model_name="tiny"):
        self.model_name = model_name
        self.model = None
        self.is_loaded = False

    def load_model(self):
        """Load the Whisper model once and keep it in memory."""
        if self.is_loaded:
            return True

        try:
            print(f"Loading Whisper model: {self.model_name}...", file=sys.stderr)
            start_time = time.time()

            self.model = whisper.load_model(self.model_name)

            end_time = time.time()
            print(f"Model loaded in {end_time - start_time:.1f}s", file=sys.stderr)
            self.is_loaded = True
            return True

        except Exception as e:
            print(f"Error loading model: {e}", file=sys.stderr)
            return False

    def transcribe_file(self, audio_file_path):
        """Transcribe a single audio file."""
        if not self.is_loaded:
            if not self.load_model():
                return {
                    "success": False,
                    "error": "Failed to load Whisper model",
                    "command": "unknown",
                    "confidence": 0.0
                }

        try:
            # Check if file exists
            if not Path(audio_file_path).exists():
                return {
                    "success": False,
                    "error": f"Audio file not found: {audio_file_path}",
                    "command": "unknown",
                    "confidence": 0.0
                }

            # Transcribe
            result = self.model.transcribe(
                audio_file_path,
                language="en",
                task="transcribe",
                temperature=0.0,
                initial_prompt="This audio contains voice commands like clap, snap, or other short words."
            )

            text = result.get("text", "").strip()

            # Calculate confidence
            segments = result.get("segments", [])
            total_confidence = 0.0
            segment_count = 0

            for segment in segments:
                if "avg_logprob" in segment:
                    confidence = min(1.0, max(0.0, 1.0 + segment["avg_logprob"]))
                    total_confidence += confidence
                    segment_count += 1

            avg_confidence = total_confidence / segment_count if segment_count > 0 else 0.5

            # Analyze for commands
            command_result = self.analyze_command(text)

            return {
                "success": True,
                "transcription": text,
                "transcription_confidence": avg_confidence,
                "command": command_result["command"],
                "command_confidence": command_result["confidence"],
                "matched_word": command_result["matched_word"],
                "language": result.get("language", "en"),
                "segments": len(segments)
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "command": "unknown",
                "confidence": 0.0
            }

    def analyze_command(self, text):
        """Analyze transcribed text for clap/snap commands."""
        text_lower = text.lower().strip()

        clap_words = ["clap", "clapping", "applause", "hand clap", "claps"]
        snap_words = ["snap", "snapping", "finger snap", "click", "snaps"]

        detected_command = "unknown"
        command_confidence = 0.0
        matched_word = None

        # Check for exact clap commands
        for word in clap_words:
            if word in text_lower:
                detected_command = "clap"
                command_confidence = 0.9 if word == "clap" else 0.8
                matched_word = word
                break

        # Check for exact snap commands
        if detected_command == "unknown":
            for word in snap_words:
                if word in text_lower:
                    detected_command = "snap"
                    command_confidence = 0.9 if word == "snap" else 0.8
                    matched_word = word
                    break

        # Fuzzy matching
        if detected_command == "unknown":
            words = text_lower.split()
            for word in words:
                # Partial clap matches
                if any(clap_word in word or word in clap_word for clap_word in clap_words):
                    detected_command = "clap"
                    command_confidence = 0.6
                    matched_word = word
                    break
                # Partial snap matches
                elif any(snap_word in word or word in snap_word for snap_word in snap_words):
                    detected_command = "snap"
                    command_confidence = 0.6
                    matched_word = word
                    break

        return {
            "command": detected_command,
            "confidence": command_confidence,
            "matched_word": matched_word
        }

def main():
    parser = argparse.ArgumentParser(description="Persistent Whisper service")
    parser.add_argument("audio_file", help="Audio file to transcribe")
    parser.add_argument("--model", default="tiny", choices=["tiny", "base", "small", "medium", "large"])
    parser.add_argument("--preload", action="store_true", help="Pre-load model and exit")

    args = parser.parse_args()

    service = WhisperService(args.model)

    if args.preload:
        # Just pre-load the model and exit
        success = service.load_model()
        if success:
            print(f"✅ Model '{args.model}' pre-loaded successfully", file=sys.stderr)
        else:
            print(f"❌ Failed to pre-load model '{args.model}'", file=sys.stderr)
        sys.exit(0 if success else 1)

    # Normal transcription
    result = service.transcribe_file(args.audio_file)
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()