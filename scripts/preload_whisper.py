#!/usr/bin/env python3
"""
Pre-load Whisper model to avoid download delays during runtime.
"""

import sys
import whisper
import time

def preload_model(model_name="tiny"):
    """Pre-load and cache Whisper model."""
    try:
        print(f"Pre-loading Whisper model: {model_name}...")
        start_time = time.time()

        # Load the model (this will download it if needed)
        model = whisper.load_model(model_name)

        end_time = time.time()
        print(f"✅ Model '{model_name}' loaded successfully in {end_time - start_time:.1f}s")
        print(f"Model cached at: ~/.cache/whisper/{model_name}.pt")
        return True

    except Exception as e:
        print(f"❌ Error loading model: {e}")
        return False

if __name__ == "__main__":
    model_name = sys.argv[1] if len(sys.argv) > 1 else "tiny"
    success = preload_model(model_name)
    sys.exit(0 if success else 1)