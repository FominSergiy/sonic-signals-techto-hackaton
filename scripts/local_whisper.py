#!/usr/bin/env python3
"""
Local Whisper transcription script for voice command detection.
This script runs Whisper locally without API calls.
"""

import sys
import json
import os
import tempfile
import whisper
import argparse
from pathlib import Path

def transcribe_audio(audio_file_path, model_name="base"):
    """
    Transcribe audio file using local Whisper model.

    Args:
        audio_file_path (str): Path to audio file
        model_name (str): Whisper model size (tiny, base, small, medium, large)

    Returns:
        dict: Transcription result with text and confidence info
    """
    try:
        # Load Whisper model (will download if first time)
        print(f"Loading Whisper model: {model_name}...", file=sys.stderr)
        model = whisper.load_model(model_name)

        # Transcribe audio
        print(f"Transcribing audio file: {audio_file_path}...", file=sys.stderr)
        result = model.transcribe(
            audio_file_path,
            language="en",  # Force English for better clap/snap detection
            task="transcribe",
            temperature=0.0,  # Deterministic output
            initial_prompt="This audio contains voice commands like clap, snap, or other short words."
        )

        # Extract transcription text
        text = result.get("text", "").strip()

        # Calculate average confidence from segments
        segments = result.get("segments", [])
        total_confidence = 0.0
        segment_count = 0

        for segment in segments:
            if "avg_logprob" in segment:
                # Convert log probability to confidence (0-1)
                # avg_logprob is typically between -1 and 0
                confidence = min(1.0, max(0.0, 1.0 + segment["avg_logprob"]))
                total_confidence += confidence
                segment_count += 1

        avg_confidence = total_confidence / segment_count if segment_count > 0 else 0.5

        return {
            "success": True,
            "text": text,
            "confidence": avg_confidence,
            "segments": len(segments),
            "language": result.get("language", "en")
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "text": "",
            "confidence": 0.0
        }

def analyze_command(text):
    """
    Analyze transcribed text for clap/snap commands.

    Args:
        text (str): Transcribed text

    Returns:
        dict: Command analysis result
    """
    text_lower = text.lower().strip()

    # Define command patterns
    clap_words = ["clap", "clapping", "applause", "hand clap", "claps"]
    snap_words = ["snap", "snapping", "finger snap", "click", "snaps"]

    detected_command = "unknown"
    command_confidence = 0.0
    matched_word = None

    # Check for clap commands
    for word in clap_words:
        if word in text_lower:
            detected_command = "clap"
            command_confidence = 0.9 if word == "clap" else 0.8
            matched_word = word
            break

    # Check for snap commands (only if clap not found)
    if detected_command == "unknown":
        for word in snap_words:
            if word in text_lower:
                detected_command = "snap"
                command_confidence = 0.9 if word == "snap" else 0.8
                matched_word = word
                break

    # Fuzzy matching for partial words
    if detected_command == "unknown":
        words = text_lower.split()
        for word in words:
            # Check for partial clap matches
            if any(clap_word in word or word in clap_word for clap_word in clap_words):
                detected_command = "clap"
                command_confidence = 0.6
                matched_word = word
                break
            # Check for partial snap matches
            elif any(snap_word in word or word in snap_word for snap_word in snap_words):
                detected_command = "snap"
                command_confidence = 0.6
                matched_word = word
                break

    return {
        "command": detected_command,
        "confidence": command_confidence,
        "matched_word": matched_word,
        "original_text": text
    }

def main():
    parser = argparse.ArgumentParser(description="Local Whisper transcription for voice commands")
    parser.add_argument("audio_file", help="Path to audio file to transcribe")
    parser.add_argument("--model", default="base", choices=["tiny", "base", "small", "medium", "large"],
                       help="Whisper model size (default: base)")
    parser.add_argument("--output", default="json", choices=["json", "text"],
                       help="Output format (default: json)")

    args = parser.parse_args()

    # Check if audio file exists
    if not os.path.exists(args.audio_file):
        result = {
            "success": False,
            "error": f"Audio file not found: {args.audio_file}",
            "command": "unknown",
            "confidence": 0.0
        }
        print(json.dumps(result))
        sys.exit(1)

    # Transcribe audio
    transcription_result = transcribe_audio(args.audio_file, args.model)

    if not transcription_result["success"]:
        result = {
            "success": False,
            "error": transcription_result["error"],
            "command": "unknown",
            "confidence": 0.0
        }
        print(json.dumps(result))
        sys.exit(1)

    # Analyze for commands
    command_result = analyze_command(transcription_result["text"])

    # Combine results
    final_result = {
        "success": True,
        "transcription": transcription_result["text"],
        "transcription_confidence": transcription_result["confidence"],
        "command": command_result["command"],
        "command_confidence": command_result["confidence"],
        "matched_word": command_result["matched_word"],
        "language": transcription_result["language"],
        "segments": transcription_result["segments"]
    }

    if args.output == "json":
        print(json.dumps(final_result, indent=2))
    else:
        if final_result["command"] != "unknown":
            print(f"Command: {final_result['command']} (confidence: {final_result['command_confidence']:.1%})")
            print(f"Transcription: \"{final_result['transcription']}\"")
        else:
            print(f"No command detected. Transcription: \"{final_result['transcription']}\"")

if __name__ == "__main__":
    main()