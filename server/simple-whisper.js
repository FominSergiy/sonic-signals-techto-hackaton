const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

/**
 * Simple Whisper integration with immediate fallback
 * This provides instant results while allowing Whisper to work in the background
 */
class SimpleWhisperClassifier {
    constructor() {
        this.isWhisperReady = false;
        this.checkWhisperAvailability();
    }

    async checkWhisperAvailability() {
        try {
            // Quick check if Whisper is available
            const result = await this.runCommand('python3', ['-c', 'import whisper; print("OK")'], 5000);
            this.isWhisperReady = result.success;
            console.log('Whisper availability check:', this.isWhisperReady ? 'Available' : 'Not available');
        } catch (error) {
            this.isWhisperReady = false;
            console.log('Whisper not available, using pattern analysis only');
        }
    }

    async classifyAudio(audioBuffer) {
        // If Whisper is available, try it with a short timeout
        if (this.isWhisperReady) {
            try {
                const whisperResult = await this.tryWhisperQuick(audioBuffer);
                if (whisperResult && whisperResult.sound !== 'unknown') {
                    return whisperResult;
                }
            } catch (error) {
                console.log('Whisper failed, using pattern analysis:', error.message);
            }
        }

        // Always fall back to pattern analysis
        return this.analyzePatterns(audioBuffer);
    }

    async tryWhisperQuick(audioBuffer) {
        return new Promise(async (resolve) => {
            // Set a 10-second timeout for Whisper
            const timeout = setTimeout(() => {
                resolve(null); // Timeout, use pattern analysis
            }, 10000);

            try {
                // Save audio to temp file
                const tempFile = path.join(__dirname, 'temp', `audio_${Date.now()}.wav`);
                await fs.promises.mkdir(path.dirname(tempFile), { recursive: true });
                await fs.promises.writeFile(tempFile, audioBuffer);

                // Try Whisper with tiny model
                const result = await this.runCommand('python3', [
                    '-c',
                    `
import whisper
import sys
try:
    model = whisper.load_model("tiny")
    result = model.transcribe("${tempFile}", language="en", temperature=0.0)
    text = result["text"].strip().lower()

    # Simple command detection
    if "clap" in text:
        print('{"command":"clap","confidence":0.9,"transcription":"' + text + '"}')
    elif "snap" in text:
        print('{"command":"snap","confidence":0.9,"transcription":"' + text + '"}')
    else:
        print('{"command":"unknown","confidence":0.0,"transcription":"' + text + '"}')
except Exception as e:
    print('{"command":"unknown","confidence":0.0,"error":"' + str(e) + '"}')
                    `
                ], 15000);

                clearTimeout(timeout);

                // Clean up temp file
                try {
                    await fs.promises.unlink(tempFile);
                } catch (e) {}

                if (result.success && result.stdout) {
                    try {
                        const parsed = JSON.parse(result.stdout.trim());
                        resolve({
                            sound: parsed.command,
                            confidence: parsed.confidence,
                            transcription: parsed.transcription,
                            method: 'quick_whisper'
                        });
                    } catch (e) {
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }

            } catch (error) {
                clearTimeout(timeout);
                resolve(null);
            }
        });
    }

    analyzePatterns(audioBuffer) {
        // Enhanced pattern analysis with better audio format handling
        try {
            let audioData;

            if (Buffer.isBuffer(audioBuffer)) {
                // Try to decode as WAV first
                try {
                    const nodeWav = require('node-wav');
                    const decoded = nodeWav.decode(audioBuffer);
                    audioData = decoded.channelData[0]; // Use first channel
                } catch (e) {
                    // If WAV decode fails, try to interpret as float data
                    try {
                        audioData = new Float32Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength / 4);
                    } catch (e2) {
                        // Last resort: convert bytes to normalized floats
                        audioData = new Float32Array(audioBuffer.length);
                        for (let i = 0; i < audioBuffer.length; i++) {
                            audioData[i] = (audioBuffer[i] - 128) / 128.0; // Convert from 0-255 to -1 to 1
                        }
                    }
                }
            } else {
                audioData = audioBuffer;
            }

            // Enhanced clap/snap detection
            const features = this.extractSimpleFeatures(audioData);

            console.log('Simple audio features:', {
                energy: features.energy.toFixed(4),
                sharpness: features.sharpness.toFixed(4),
                duration: features.duration.toFixed(3),
                peakRatio: features.peakRatio.toFixed(4)
            });

            let detected = 'unknown';
            let confidence = 0.0;

            // Enhanced classification using multiple features
            const snapScore = this.calculateSnapScore(features);
            const clapScore = this.calculateClapScore(features);
            const clickScore = this.calculateClickScore(features);

            console.log('Classification scores:', {
                snapScore: snapScore.toFixed(3),
                clapScore: clapScore.toFixed(3),
                clickScore: clickScore.toFixed(3)
            });

            // Much more sensitive thresholds
            const scores = [
                { type: 'snap', score: snapScore },
                { type: 'clap', score: clapScore },
                { type: 'click', score: clickScore }
            ];

            // Find the highest scoring detection
            const bestMatch = scores.reduce((best, current) =>
                current.score > best.score ? current : best
            );

            // Lower thresholds for better sensitivity
            if (bestMatch.score > 0.2) { // Much lower threshold
                detected = bestMatch.type;
                confidence = Math.min(0.95, Math.max(0.3, bestMatch.score));
            }

            return {
                sound: detected,
                confidence: confidence,
                method: 'pattern_analysis',
                features: features
            };

        } catch (error) {
            console.error('Pattern analysis error:', error);
            return {
                sound: 'unknown',
                confidence: 0.0,
                method: 'fallback',
                error: error.message
            };
        }
    }

    extractSimpleFeatures(audioData) {
        const energy = this.calculateEnergy(audioData);
        const sharpness = this.calculateSharpness(audioData);
        const duration = audioData.length / 16000; // Assuming 16kHz

        // Calculate peak ratio (max amplitude vs RMS)
        const rms = Math.sqrt(energy);
        const peak = Math.max(...audioData.map(Math.abs));
        const peakRatio = peak / (rms + 1e-10);

        // Additional features for better classification
        const zeroCrossings = this.calculateZeroCrossings(audioData);
        const spectralCentroid = this.calculateSpectralCentroid(audioData);
        const attackTime = this.calculateAttackTime(audioData);

        return {
            energy,
            sharpness,
            duration,
            peakRatio,
            rms,
            peak,
            zeroCrossings,
            spectralCentroid,
            attackTime
        };
    }

    calculateEnergy(audioData) {
        let sum = 0;
        for (let i = 0; i < audioData.length; i++) {
            sum += audioData[i] * audioData[i];
        }
        return sum / audioData.length;
    }

    calculateSharpness(audioData) {
        let sharpness = 0;
        for (let i = 1; i < audioData.length; i++) {
            sharpness += Math.abs(audioData[i] - audioData[i-1]);
        }
        return sharpness / audioData.length;
    }

    calculateZeroCrossings(audioData) {
        let crossings = 0;
        for (let i = 1; i < audioData.length; i++) {
            if ((audioData[i] >= 0) !== (audioData[i-1] >= 0)) {
                crossings++;
            }
        }
        return crossings / audioData.length;
    }

    calculateSpectralCentroid(audioData) {
        // Simple approximation using high-frequency content
        let highFreqEnergy = 0;
        let totalEnergy = 0;

        for (let i = 1; i < audioData.length; i++) {
            const diff = Math.abs(audioData[i] - audioData[i-1]);
            highFreqEnergy += diff * diff;
            totalEnergy += audioData[i] * audioData[i];
        }

        return totalEnergy > 0 ? highFreqEnergy / totalEnergy : 0;
    }

    calculateAttackTime(audioData) {
        // Find the time to reach peak amplitude
        const peak = Math.max(...audioData.map(Math.abs));
        const threshold = peak * 0.9;

        for (let i = 0; i < audioData.length; i++) {
            if (Math.abs(audioData[i]) >= threshold) {
                return i / audioData.length; // Normalized attack time
            }
        }
        return 1.0; // If no peak found, assume slow attack
    }

    calculateSnapScore(features) {
        let score = 0;

        // More sensitive snap detection
        if (features.sharpness > 0.001) score += 0.2; // Much lower threshold
        if (features.duration < 0.15) score += 0.4; // Strong bonus for very short sounds
        else if (features.duration < 0.3) score += 0.25;
        else if (features.duration < 0.5) score += 0.1; // Even longer sounds can be snaps
        if (features.peakRatio > 5.0) score += 0.4; // Lower peak ratio threshold
        else if (features.peakRatio > 3.0) score += 0.3;
        else if (features.peakRatio > 1.5) score += 0.1; // Even lower
        if (features.attackTime < 0.1) score += 0.2; // Fast attack
        else if (features.attackTime < 0.2) score += 0.1; // Moderate attack
        if (features.spectralCentroid > 0.3) score += 0.15; // Lower threshold
        if (features.energy > 0.001) score += 0.1; // Basic energy check

        return score;
    }

    calculateClapScore(features) {
        let score = 0;

        // More sensitive clap detection
        if (features.sharpness > 0.001) score += 0.25; // Much lower threshold
        else if (features.sharpness > 0.0005) score += 0.1; // Even quieter claps
        if (features.duration < 1.0) score += 0.2;
        else if (features.duration < 2.0) score += 0.1; // Longer claps
        if (features.peakRatio > 2.0) score += 0.25; // Lower peak ratio
        else if (features.peakRatio > 1.2) score += 0.15; // Even lower
        if (features.energy > 0.001) score += 0.2; // Much lower energy threshold
        else if (features.energy > 0.0001) score += 0.1; // Very quiet sounds
        if (features.attackTime < 0.3) score += 0.15; // Slower attack acceptable
        if (features.zeroCrossings > 0.01) score += 0.1; // Some variation in signal

        return score;
    }

    calculateClickScore(features) {
        let score = 0;

        // Clicks are very short and sharp, similar to snaps but even briefer
        if (features.sharpness > 0.001) score += 0.3; // Sharp transient
        if (features.duration < 0.05) score += 0.5; // Very brief
        else if (features.duration < 0.1) score += 0.3;
        else if (features.duration < 0.2) score += 0.1;
        if (features.peakRatio > 3.0) score += 0.3; // Good peak
        else if (features.peakRatio > 1.5) score += 0.2;
        if (features.attackTime < 0.05) score += 0.2; // Very fast attack
        else if (features.attackTime < 0.1) score += 0.1;
        if (features.spectralCentroid > 0.2) score += 0.1; // Some high frequency
        if (features.energy > 0.0001) score += 0.1; // Any energy at all

        return score;
    }

    async runCommand(command, args, timeout = 10000) {
        return new Promise((resolve) => {
            const process = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });

            let stdout = '';
            let stderr = '';

            const timeoutId = setTimeout(() => {
                process.kill('SIGTERM');
                resolve({ success: false, error: 'Timeout' });
            }, timeout);

            process.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            process.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            process.on('close', (code) => {
                clearTimeout(timeoutId);
                resolve({
                    success: code === 0,
                    stdout: stdout.trim(),
                    stderr: stderr.trim()
                });
            });

            process.on('error', (error) => {
                clearTimeout(timeoutId);
                resolve({ success: false, error: error.message });
            });
        });
    }
}

module.exports = SimpleWhisperClassifier;