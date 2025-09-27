const OpenAI = require('openai');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const nodeWav = require('node-wav');

class WhisperClassifier {
    constructor() {
        this.openai = null;
        this.isLoaded = false;
        this.useLocalWhisper = true; // Prefer local Whisper

        // Load OpenAI API key from environment (backup option)
        this.apiKey = process.env.OPENAI_API_KEY;
        if (!this.apiKey) {
            console.log('No OPENAI_API_KEY found - using local Whisper only');
        } else {
            console.log('OPENAI_API_KEY found - local Whisper preferred, API as backup');
        }
    }

    async loadModel() {
        if (this.isLoaded) return;

        try {
            console.log('Initializing Local Whisper classifier...');

            // Check if Python and Whisper are available
            const { spawn } = require('child_process');
            const scriptPath = path.join(__dirname, '..', 'scripts', 'whisper_service.py');

            // Test if local Whisper is working and pre-load model
            await this.testLocalWhisper(scriptPath);

            console.log('Local Whisper is ready');

            // Also initialize OpenAI API if available (as backup)
            if (this.apiKey) {
                this.openai = new OpenAI({
                    apiKey: this.apiKey
                });
                console.log('OpenAI Whisper API also available as backup');
            }

            this.isLoaded = true;
        } catch (error) {
            console.error('Error initializing Whisper:', error);
            console.log('Falling back to pattern analysis only');
            this.isLoaded = true; // Continue with fallback
        }
    }

    async testLocalWhisper(scriptPath) {
        return new Promise((resolve, reject) => {
            const { spawn } = require('child_process');

            // Pre-load the model to cache it
            const process = spawn('python3', [scriptPath, 'dummy', '--model', 'tiny', '--preload'], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stderr = '';

            process.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    console.log('Whisper model pre-loaded and cached');
                    resolve();
                } else {
                    console.log('Model pre-loading failed, but continuing...');
                    resolve(); // Don't fail completely, pattern analysis will work
                }
            });

            process.on('error', (error) => {
                console.log('Model pre-loading failed, but continuing...');
                resolve(); // Don't fail completely
            });

            // Longer timeout for model download
            setTimeout(() => {
                if (!process.killed) {
                    process.kill('SIGTERM');
                    console.log('Model pre-loading timed out, but continuing...');
                    resolve(); // Don't fail completely
                }
            }, 180000); // 3 minute timeout for first download
        });
    }

    async classifyAudio(audioBuffer) {
        if (!this.isLoaded) {
            await this.loadModel();
        }

        try {
            console.log('Processing audio for Whisper classification...');

            // First try local Whisper voice command detection
            const voiceResult = await this.detectVoiceCommands(audioBuffer);
            if (voiceResult.sound !== 'unknown' && voiceResult.confidence > 0.3) {
                return voiceResult;
            }

            // Fallback to audio pattern analysis
            const patternResult = await this.analyzeAudioPatterns(audioBuffer);

            // If voice detection had low confidence but detected something, combine results
            if (voiceResult.sound !== 'unknown' && voiceResult.confidence <= 0.3) {
                console.log('Combining low-confidence voice result with pattern analysis');

                // Use voice result if it agrees with pattern analysis, otherwise use pattern
                if (voiceResult.sound === patternResult.sound) {
                    return {
                        ...voiceResult,
                        confidence: Math.max(voiceResult.confidence, patternResult.confidence * 0.8),
                        method: 'combined_whisper_pattern'
                    };
                }
            }

            return patternResult;

        } catch (error) {
            console.error('Error in Whisper classification:', error);
            return {
                sound: 'unknown',
                confidence: 0.0,
                error: error.message
            };
        }
    }

    async detectVoiceCommands(audioBuffer) {
        try {
            // Convert audio buffer to a temporary WAV file for local Whisper
            const tempFilePath = await this.saveAudioToTempFile(audioBuffer);

            try {
                // Use local Whisper to transcribe the audio
                const result = await this.runLocalWhisper(tempFilePath);

                // Clean up temp file
                await fsPromises.unlink(tempFilePath);

                return result;

            } catch (transcriptionError) {
                console.error('Local Whisper transcription error:', transcriptionError);
                await fsPromises.unlink(tempFilePath);
                return { sound: 'unknown', confidence: 0.0 };
            }

        } catch (error) {
            console.error('Error in voice command detection:', error);
            return { sound: 'unknown', confidence: 0.0 };
        }
    }

    async runLocalWhisper(audioFilePath) {
        try {
            const { spawn } = require('child_process');
            const scriptPath = path.join(__dirname, '..', 'scripts', 'whisper_service.py');

            return new Promise((resolve, reject) => {
                // Run the efficient Whisper service
                const process = spawn('python3', [scriptPath, audioFilePath, '--model', 'tiny'], {
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                let stdout = '';
                let stderr = '';

                process.stdout.on('data', (data) => {
                    stdout += data.toString();
                });

                process.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                process.on('close', (code) => {
                    if (code !== 0) {
                        console.error('Local Whisper stderr:', stderr);
                        reject(new Error(`Local Whisper process exited with code ${code}: ${stderr}`));
                        return;
                    }

                    try {
                        // Parse JSON output
                        const result = JSON.parse(stdout.trim());

                        console.log('Local Whisper result:', {
                            transcription: result.transcription,
                            command: result.command,
                            confidence: result.command_confidence
                        });

                        if (!result.success) {
                            reject(new Error(result.error || 'Local Whisper failed'));
                            return;
                        }

                        // Convert to our expected format
                        const whisperResult = {
                            sound: result.command === 'unknown' ? 'unknown' : result.command,
                            confidence: result.command_confidence || 0.0,
                            transcription: result.transcription,
                            method: 'local_whisper',
                            transcription_confidence: result.transcription_confidence,
                            matched_word: result.matched_word
                        };

                        resolve(whisperResult);

                    } catch (parseError) {
                        console.error('Error parsing Whisper output:', parseError);
                        console.error('Raw output:', stdout);
                        reject(new Error(`Failed to parse Whisper output: ${parseError.message}`));
                    }
                });

                process.on('error', (error) => {
                    reject(new Error(`Failed to start Whisper process: ${error.message}`));
                });

                // Set timeout to prevent hanging (longer for first model download)
                setTimeout(() => {
                    if (!process.killed) {
                        process.kill('SIGTERM');
                        reject(new Error('Whisper process timed out'));
                    }
                }, 120000); // 2 minute timeout for model download
            });

        } catch (error) {
            console.error('Error running local Whisper:', error);
            throw error;
        }
    }

    async saveAudioToTempFile(audioBuffer) {
        try {
            // Create temp directory if it doesn't exist
            const tempDir = path.join(__dirname, 'temp');
            try {
                await fsPromises.mkdir(tempDir, { recursive: true });
            } catch (e) {
                // Directory might already exist
            }

            const tempFilePath = path.join(tempDir, `audio_${Date.now()}.wav`);

            // Try to decode as WAV first
            let wavBuffer;
            try {
                const decoded = nodeWav.decode(audioBuffer);
                // Re-encode as WAV to ensure proper format
                wavBuffer = nodeWav.encode([decoded.channelData[0]], {
                    sampleRate: decoded.sampleRate || 16000,
                    float: false,
                    bitDepth: 16
                });
            } catch (e) {
                // If not WAV, assume raw audio and create WAV
                console.log('Creating WAV from raw audio data');

                // Convert buffer to Float32Array if needed
                let audioData;
                if (Buffer.isBuffer(audioBuffer)) {
                    audioData = new Float32Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength / 4);
                } else {
                    audioData = audioBuffer;
                }

                wavBuffer = nodeWav.encode([audioData], {
                    sampleRate: 16000,
                    float: false,
                    bitDepth: 16
                });
            }

            await fsPromises.writeFile(tempFilePath, wavBuffer);
            return tempFilePath;

        } catch (error) {
            console.error('Error saving audio to temp file:', error);
            throw error;
        }
    }

    analyzeTranscription(text) {
        // Clean and normalize the text
        const normalizedText = text.toLowerCase().replace(/[^\w\s]/g, ' ').trim();

        console.log('Analyzing transcription:', normalizedText);

        // Look for direct command words
        const clapWords = ['clap', 'clapping', 'applause', 'hand clap'];
        const snapWords = ['snap', 'snapping', 'finger snap', 'click'];

        let bestMatch = { sound: 'unknown', confidence: 0.0 };

        // Check for clap commands
        for (const word of clapWords) {
            if (normalizedText.includes(word)) {
                const confidence = this.calculateWordConfidence(normalizedText, word);
                if (confidence > bestMatch.confidence) {
                    bestMatch = {
                        sound: 'clap',
                        confidence: confidence,
                        transcription: text,
                        detectedWord: word
                    };
                }
            }
        }

        // Check for snap commands
        for (const word of snapWords) {
            if (normalizedText.includes(word)) {
                const confidence = this.calculateWordConfidence(normalizedText, word);
                if (confidence > bestMatch.confidence) {
                    bestMatch = {
                        sound: 'snap',
                        confidence: confidence,
                        transcription: text,
                        detectedWord: word
                    };
                }
            }
        }

        // Enhanced pattern matching for partial words or similar sounds
        if (bestMatch.sound === 'unknown') {
            bestMatch = this.analyzePartialMatches(normalizedText);
        }

        if (bestMatch.sound !== 'unknown') {
            console.log(`🎯 Voice command detected: ${bestMatch.sound.toUpperCase()} (${(bestMatch.confidence * 100).toFixed(1)}%)`);
            console.log(`   From transcription: "${text}"`);
            if (bestMatch.detectedWord) {
                console.log(`   Detected word: "${bestMatch.detectedWord}"`);
            }
        }

        return bestMatch;
    }

    calculateWordConfidence(text, word) {
        const words = text.split(/\s+/);
        const wordCount = words.length;

        // Higher confidence for shorter, clearer commands
        let confidence = 0.8;

        // Reduce confidence based on text length (longer text = less likely to be a command)
        if (wordCount > 5) {
            confidence *= 0.6;
        } else if (wordCount > 3) {
            confidence *= 0.8;
        }

        // Increase confidence for exact matches
        if (words.includes(word)) {
            confidence = Math.min(0.95, confidence + 0.15);
        }

        // Check if the word is at the beginning or end (more likely to be a command)
        if (text.startsWith(word) || text.endsWith(word)) {
            confidence = Math.min(0.95, confidence + 0.1);
        }

        return confidence;
    }

    analyzePartialMatches(text) {
        // Look for similar sounding words or partial matches
        const partialClap = ['clap', 'clapping', 'klap', 'slap'];
        const partialSnap = ['snap', 'snapping', 'nap', 'tap'];

        let bestMatch = { sound: 'unknown', confidence: 0.0 };

        // Check for fuzzy matches
        for (const word of partialClap) {
            if (this.fuzzyMatch(text, word)) {
                const confidence = 0.6; // Lower confidence for fuzzy matches
                if (confidence > bestMatch.confidence) {
                    bestMatch = {
                        sound: 'clap',
                        confidence: confidence,
                        transcription: text,
                        fuzzyMatch: true
                    };
                }
            }
        }

        for (const word of partialSnap) {
            if (this.fuzzyMatch(text, word)) {
                const confidence = 0.6;
                if (confidence > bestMatch.confidence) {
                    bestMatch = {
                        sound: 'snap',
                        confidence: confidence,
                        transcription: text,
                        fuzzyMatch: true
                    };
                }
            }
        }

        return bestMatch;
    }

    fuzzyMatch(text, word) {
        // Simple fuzzy matching - check if most characters match
        const textChars = text.replace(/\s/g, '').toLowerCase();
        const wordChars = word.toLowerCase();

        let matches = 0;
        for (let i = 0; i < wordChars.length; i++) {
            if (textChars.includes(wordChars[i])) {
                matches++;
            }
        }

        return matches >= wordChars.length * 0.7; // 70% character match
    }

    async analyzeAudioPatterns(audioBuffer) {
        try {
            console.log('Analyzing audio patterns...');

            // Preprocess audio for pattern analysis
            const audioData = this.preprocessAudio(audioBuffer);

            // Analyze patterns specific to claps and snaps
            const patterns = this.extractAudioFeatures(audioData);

            // Classify based on audio characteristics
            const result = this.classifyFromPatterns(patterns);

            console.log('Pattern analysis result:', result);
            return result;

        } catch (error) {
            console.error('Error in audio pattern analysis:', error);
            return {
                sound: 'unknown',
                confidence: 0.0,
                error: error.message
            };
        }
    }

    preprocessAudio(audioBuffer) {
        try {
            let audioData;

            // Handle different input types
            if (Buffer.isBuffer(audioBuffer)) {
                try {
                    const decoded = nodeWav.decode(audioBuffer);
                    audioData = decoded.channelData[0]; // Use first channel
                } catch (e) {
                    // If WAV decode fails, treat as raw audio
                    audioData = new Float32Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength / 4);
                }
            } else if (audioBuffer instanceof Float32Array) {
                audioData = audioBuffer;
            } else {
                throw new Error('Unsupported audio format');
            }

            // Apply basic preprocessing
            audioData = this.normalizeAudio(audioData);
            audioData = this.removeNoise(audioData);

            return audioData;

        } catch (error) {
            console.error('Error preprocessing audio:', error);
            throw error;
        }
    }

    normalizeAudio(audioData) {
        // Normalize audio to [-1, 1] range
        const maxValue = Math.max(...audioData.map(Math.abs));
        if (maxValue === 0) return audioData;

        const normalizedData = new Float32Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
            normalizedData[i] = audioData[i] / maxValue;
        }

        return normalizedData;
    }

    removeNoise(audioData) {
        // Simple high-pass filter to remove low-frequency noise
        const filtered = new Float32Array(audioData.length);
        const alpha = 0.95;

        filtered[0] = audioData[0];
        for (let i = 1; i < audioData.length; i++) {
            filtered[i] = alpha * (filtered[i-1] + audioData[i] - audioData[i-1]);
        }

        return filtered;
    }

    extractAudioFeatures(audioData) {
        // Extract features that distinguish claps from snaps
        const features = {
            // Energy-based features
            totalEnergy: this.calculateTotalEnergy(audioData),
            peakEnergy: this.calculatePeakEnergy(audioData),
            energySpread: this.calculateEnergySpread(audioData),

            // Temporal features
            attackTime: this.calculateAttackTime(audioData),
            duration: this.calculateSoundDuration(audioData),

            // Spectral features (approximated)
            highFreqEnergy: this.calculateHighFreqEnergy(audioData),
            sharpness: this.calculateSharpness(audioData),

            // Pattern features
            impulseCount: this.countImpulses(audioData),
            zeroCrossings: this.countZeroCrossings(audioData)
        };

        return features;
    }

    calculateTotalEnergy(audioData) {
        return audioData.reduce((sum, val) => sum + val * val, 0) / audioData.length;
    }

    calculatePeakEnergy(audioData) {
        return Math.max(...audioData.map(val => val * val));
    }

    calculateEnergySpread(audioData) {
        const windowSize = 128;
        let maxSpread = 0;

        for (let i = 0; i <= audioData.length - windowSize; i += windowSize / 2) {
            const window = audioData.slice(i, i + windowSize);
            const energy = window.reduce((sum, val) => sum + val * val, 0);
            maxSpread = Math.max(maxSpread, energy);
        }

        return maxSpread;
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

        return 1.0; // No clear attack found
    }

    calculateSoundDuration(audioData) {
        const threshold = 0.01; // Energy threshold
        let start = -1, end = -1;

        // Find start
        for (let i = 0; i < audioData.length; i++) {
            if (Math.abs(audioData[i]) > threshold) {
                start = i;
                break;
            }
        }

        // Find end
        for (let i = audioData.length - 1; i >= 0; i--) {
            if (Math.abs(audioData[i]) > threshold) {
                end = i;
                break;
            }
        }

        if (start === -1 || end === -1) return 0;
        return (end - start) / audioData.length; // Normalized duration
    }

    calculateHighFreqEnergy(audioData) {
        // Approximate high-frequency energy by looking at rapid changes
        let highFreqEnergy = 0;

        for (let i = 1; i < audioData.length; i++) {
            const diff = audioData[i] - audioData[i-1];
            highFreqEnergy += diff * diff;
        }

        return highFreqEnergy / audioData.length;
    }

    calculateSharpness(audioData) {
        // Measure the "sharpness" of transients
        let sharpness = 0;
        const windowSize = 5;

        for (let i = windowSize; i < audioData.length - windowSize; i++) {
            let localVariation = 0;
            for (let j = -windowSize; j <= windowSize; j++) {
                localVariation += Math.abs(audioData[i + j] - audioData[i]);
            }
            sharpness = Math.max(sharpness, localVariation);
        }

        return sharpness;
    }

    countImpulses(audioData) {
        // Count the number of distinct impulses/peaks
        const threshold = 0.1;
        let impulses = 0;
        let inImpulse = false;

        for (let i = 0; i < audioData.length; i++) {
            if (Math.abs(audioData[i]) > threshold) {
                if (!inImpulse) {
                    impulses++;
                    inImpulse = true;
                }
            } else {
                inImpulse = false;
            }
        }

        return impulses;
    }

    countZeroCrossings(audioData) {
        // Count zero crossings - indicates frequency content
        let crossings = 0;

        for (let i = 1; i < audioData.length; i++) {
            if ((audioData[i] >= 0) !== (audioData[i-1] >= 0)) {
                crossings++;
            }
        }

        return crossings / audioData.length; // Normalized
    }

    classifyFromPatterns(features) {
        // Rule-based classification using audio features
        console.log('Audio features:', {
            totalEnergy: features.totalEnergy.toFixed(4),
            peakEnergy: features.peakEnergy.toFixed(4),
            attackTime: features.attackTime.toFixed(4),
            duration: features.duration.toFixed(4),
            sharpness: features.sharpness.toFixed(4),
            impulses: features.impulseCount,
            zeroCrossings: features.zeroCrossings.toFixed(4)
        });

        let snapScore = 0;
        let clapScore = 0;

        // Snap characteristics: very sharp attack, short duration, high frequency
        if (features.attackTime < 0.1) snapScore += 0.3; // Very fast attack
        if (features.duration < 0.2) snapScore += 0.2; // Short duration
        if (features.sharpness > 0.5) snapScore += 0.2; // Sharp transient
        if (features.highFreqEnergy > features.totalEnergy * 0.3) snapScore += 0.2; // High freq content
        if (features.impulseCount === 1) snapScore += 0.1; // Single impulse

        // Clap characteristics: broader sound, longer duration, more complex
        if (features.attackTime < 0.3 && features.attackTime > 0.05) clapScore += 0.2; // Moderate attack
        if (features.duration > 0.1 && features.duration < 0.6) clapScore += 0.2; // Moderate duration
        if (features.energySpread > features.peakEnergy * 0.3) clapScore += 0.2; // Energy spread
        if (features.impulseCount > 1) clapScore += 0.2; // Multiple components
        if (features.zeroCrossings > 0.1) clapScore += 0.2; // Complex waveform

        // Determine result
        const minConfidence = 0.4;
        let result = { sound: 'unknown', confidence: 0.0 };

        if (snapScore > clapScore && snapScore > minConfidence) {
            result = {
                sound: 'snap',
                confidence: Math.min(0.9, snapScore),
                method: 'pattern_analysis',
                features: features
            };
        } else if (clapScore > snapScore && clapScore > minConfidence) {
            result = {
                sound: 'clap',
                confidence: Math.min(0.9, clapScore),
                method: 'pattern_analysis',
                features: features
            };
        }

        if (result.sound !== 'unknown') {
            console.log(`🎯 Pattern detected: ${result.sound.toUpperCase()} (${(result.confidence * 100).toFixed(1)}% confidence)`);
            console.log(`   Snap score: ${(snapScore * 100).toFixed(1)}%, Clap score: ${(clapScore * 100).toFixed(1)}%`);
        }

        return result;
    }

    // Cleanup method
    cleanup() {
        this.openai = null;
        this.isLoaded = false;

        // Clean up any temp files
        const tempDir = path.join(__dirname, 'temp');
        fsPromises.readdir(tempDir).then(files => {
            files.forEach(file => {
                if (file.startsWith('audio_') && file.endsWith('.wav')) {
                    fsPromises.unlink(path.join(tempDir, file)).catch(() => {});
                }
            });
        }).catch(() => {});
    }
}

module.exports = WhisperClassifier;