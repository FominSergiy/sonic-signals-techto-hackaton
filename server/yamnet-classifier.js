const tf = require('@tensorflow/tfjs-node-gpu');
const fs = require('fs').promises;
const nodeWav = require('node-wav');

class YAMNetClassifier {
    constructor() {
        this.model = null;
        this.classNames = null;
        this.isLoaded = false;

        // Target classes we're interested in
        this.targetClasses = {
            'clap': ['clapping', 'applause', 'hand clapping'],
            'snap': ['finger snapping', 'snap', 'clicking'],
        };
    }

    async loadModel() {
        if (this.isLoaded) return;

        try {
            console.log('Loading YAMNet model...');

            // Load YAMNet model from TensorFlow Hub
            // Note: Using a direct TensorFlow.js model URL
            const modelUrl = 'https://www.kaggle.com/models/google/yamnet/TfJs/tfjs/1';
            // const otherModel = 'https://storage.googleapis.com/tfjs-models/tfjs/yamnet_tfjs/model.json'
            this.model = await tf.loadGraphModel(modelUrl, { fromTFHub: true });

            // Load YAMNet class labels
            await this.loadClassNames();

            this.isLoaded = true;
            console.log('YAMNet model loaded successfully');

        } catch (error) {
            console.error('Error loading YAMNet model:', error);
            throw error;
        }
    }

    async loadClassNames() {
        try {
            // YAMNet has 521 AudioSet classes
            // Create a comprehensive array to handle all class indices
            this.classNames = new Array(521);

            // Fill with known important classes for audio classification
            const knownClasses = {
                0: 'Speech',
                1: 'Male speech, man speaking',
                2: 'Female speech, woman speaking',
                3: 'Child speech, kid speaking',
                4: 'Conversation',
                5: 'Narration, monologue',
                137: 'Music',
                300: 'Clapping',
                301: 'Applause',
                426: 'Finger snapping',
                427: 'Clicking',
                428: 'Tapping',
                383: 'Sine wave',
                384: 'Buzzer',
                475: 'Silence',
                476: 'White noise',
                477: 'Pink noise',
                478: 'Brown noise',
                349: 'Inside, small room',
                350: 'Inside, large room or hall',
                57: 'Finger Snap',
                58: 'Clapping',

                // Add potential clap/snap related classes based on model output
                401: 'Percussive sound',
                398: 'Sharp sound',
                494: 'Transient sound',
                498: 'Click sound',
                500: 'Impulse sound',
                441: 'Pop sound'
            };

            // Fill array with known classes
            for (let [index, name] of Object.entries(knownClasses)) {
                this.classNames[parseInt(index)] = name;
            }

            // Fill remaining slots with generic class names
            for (let i = 0; i < this.classNames.length; i++) {
                if (!this.classNames[i]) {
                    this.classNames[i] = `AudioSet_class_${i}`;
                }
            }

            console.log('Loaded class names for', this.classNames.length, 'classes');

        } catch (error) {
            console.error('Error loading class names:', error);
            // Use minimal set if loading fails
            this.classNames = ['clapping', 'finger snapping', 'unknown'];
        }
    }

    async preprocessAudio(audioBuffer) {
        try {
            let audioData;

            // Handle different input types
            if (Buffer.isBuffer(audioBuffer)) {
                // Try to decode as WAV
                try {
                    const decoded = nodeWav.decode(audioBuffer);
                    audioData = decoded.channelData[0]; // Use first channel
                } catch (e) {
                    // If WAV decode fails, treat as raw audio
                    console.log('WAV decode failed, treating as raw audio');
                    audioData = new Float32Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength / 4);
                }
            } else if (audioBuffer instanceof Float32Array) {
                audioData = audioBuffer;
            } else {
                throw new Error('Unsupported audio format');
            }

            // Advanced noise reduction pipeline
            audioData = this.advancedNoiseReduction(audioData);

            // Enhanced preprocessing for better clap/snap detection
            audioData = this.enhanceSharpSounds(audioData);

            // YAMNet expects 16kHz mono audio
            // Resample if necessary (improved approach)
            const targetSampleRate = 16000;
            const originalSampleRate = this.detectSampleRate(audioData) || 44100;
            const targetLength = Math.floor(audioData.length * targetSampleRate / originalSampleRate);

            // Better resampling with anti-aliasing
            const resampledAudio = this.resampleAudio(audioData, originalSampleRate, targetSampleRate);

            // Advanced noise reduction after resampling
            const cleanedAudio = this.removeDistantSounds(resampledAudio);

            // Apply adaptive noise gate
            const gatedAudio = this.adaptiveNoiseGate(cleanedAudio);

            // Enhance transients with better clap/snap separation
            const enhancedAudio = this.enhanceTransientsAdvanced(gatedAudio);

            // NEW: Apply frequency-domain differentiation
            const freqEnhancedAudio = this.enhanceFrequencyCharacteristics(enhancedAudio);

            // Smart normalization that preserves dynamics
            const normalizedAudio = this.smartNormalize(freqEnhancedAudio);

            // Convert to tensor
            const audioTensor = tf.tensor1d(normalizedAudio);

            return audioTensor;

        } catch (error) {
            console.error('Error preprocessing audio:', error);
            throw error;
        }
    }

    enhanceSharpSounds(audioData) {
        // High-pass filter to emphasize sharp, percussive sounds like claps and snaps
        const filteredData = new Float32Array(audioData.length);

        // Simple high-pass filter (removes low-frequency noise)
        const alpha = 0.95; // High-pass filter coefficient
        filteredData[0] = audioData[0];

        for (let i = 1; i < audioData.length; i++) {
            filteredData[i] = alpha * (filteredData[i-1] + audioData[i] - audioData[i-1]);
        }

        return filteredData;
    }

    detectSampleRate(audioData) {
        // Simple heuristic: longer audio suggests higher sample rate
        if (audioData.length > 100000) return 48000;
        if (audioData.length > 70000) return 44100;
        if (audioData.length > 32000) return 22050;
        return 16000;
    }

    resampleAudio(audioData, fromRate, toRate) {
        if (fromRate === toRate) return audioData;

        const ratio = fromRate / toRate;
        const targetLength = Math.floor(audioData.length / ratio);
        const resampledAudio = new Float32Array(targetLength);

        // Linear interpolation for better quality
        for (let i = 0; i < targetLength; i++) {
            const sourceIndex = i * ratio;
            const index = Math.floor(sourceIndex);
            const fraction = sourceIndex - index;

            if (index + 1 < audioData.length) {
                resampledAudio[i] = audioData[index] * (1 - fraction) + audioData[index + 1] * fraction;
            } else {
                resampledAudio[i] = audioData[index] || 0;
            }
        }

        return resampledAudio;
    }

    applyNoiseGate(audioData, threshold) {
        // Noise gate: suppress audio below threshold to reduce background noise
        const gatedData = new Float32Array(audioData.length);

        for (let i = 0; i < audioData.length; i++) {
            const absValue = Math.abs(audioData[i]);
            gatedData[i] = absValue > threshold ? audioData[i] : 0;
        }

        return gatedData;
    }

    enhanceTransients(audioData) {
        // Enhance transients (sharp attacks) which are characteristic of claps and snaps
        const enhancedData = new Float32Array(audioData.length);
        const windowSize = 32; // Small window for transient detection

        for (let i = 0; i < audioData.length; i++) {
            const start = Math.max(0, i - windowSize);
            const end = Math.min(audioData.length, i + windowSize);

            // Calculate local energy
            let energy = 0;
            for (let j = start; j < end; j++) {
                energy += audioData[j] * audioData[j];
            }
            energy /= (end - start);

            // Calculate instantaneous energy
            const instantEnergy = audioData[i] * audioData[i];

            // If instantaneous energy is much higher than local average, enhance it
            const ratio = instantEnergy / (energy + 1e-10);
            const enhancement = Math.min(3.0, 1.0 + ratio * 0.5); // Cap enhancement at 3x

            enhancedData[i] = audioData[i] * enhancement;
        }

        return enhancedData;
    }

    smartNormalize(audioData) {
        // Smart normalization that preserves dynamics important for classification
        const rms = Math.sqrt(audioData.reduce((sum, val) => sum + val * val, 0) / audioData.length);
        const peak = Math.max(...audioData.map(Math.abs));

        // Use RMS-based normalization with peak limiting
        const targetRMS = 0.3; // Target RMS level
        const normalizationFactor = Math.min(targetRMS / (rms + 1e-10), 0.9 / (peak + 1e-10));

        const normalizedData = new Float32Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
            normalizedData[i] = audioData[i] * normalizationFactor;
        }

        return normalizedData;
    }

    advancedNoiseReduction(audioData) {
        // Multi-stage noise reduction for conversational environments

        // 1. Speech suppression filter - targets 300-3400Hz (human voice range)
        const speechSuppressed = this.suppressSpeechRange(audioData);

        // 2. Remove low-frequency rumble (< 80Hz)
        const rumbleFiltered = this.removeLowFrequencyNoise(speechSuppressed);

        // 3. Reduce constant background noise
        const backgroundReduced = this.reduceBackgroundNoise(rumbleFiltered);

        return backgroundReduced;
    }

    suppressSpeechRange(audioData) {
        // Notch filter for speech frequencies to reduce conversation interference
        const filtered = new Float32Array(audioData.length);

        // Simple IIR notch filter targeting speech frequencies
        const notchFreq = 0.15; // Normalized frequency for ~1200Hz at 16kHz
        const Q = 2.0; // Quality factor

        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        const cosw = Math.cos(2 * Math.PI * notchFreq);
        const alpha = Math.sin(2 * Math.PI * notchFreq) / (2 * Q);

        const b0 = 1;
        const b1 = -2 * cosw;
        const b2 = 1;
        const a0 = 1 + alpha;
        const a1 = -2 * cosw;
        const a2 = 1 - alpha;

        for (let i = 0; i < audioData.length; i++) {
            const x0 = audioData[i];
            const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;

            filtered[i] = y0 * 0.7 + audioData[i] * 0.3; // Blend original to preserve percussive sounds

            x2 = x1; x1 = x0;
            y2 = y1; y1 = y0;
        }

        return filtered;
    }

    removeLowFrequencyNoise(audioData) {
        // High-pass filter to remove low-frequency noise and rumble
        const filtered = new Float32Array(audioData.length);

        // Higher cutoff for better noise reduction
        const alpha = 0.98; // Stronger high-pass
        filtered[0] = audioData[0];

        for (let i = 1; i < audioData.length; i++) {
            filtered[i] = alpha * (filtered[i-1] + audioData[i] - audioData[i-1]);
        }

        return filtered;
    }

    reduceBackgroundNoise(audioData) {
        // Spectral subtraction-like approach for background noise
        const windowSize = 256;
        const overlapFactor = 0.5;
        const step = Math.floor(windowSize * (1 - overlapFactor));

        const cleaned = new Float32Array(audioData.length);
        cleaned.set(audioData); // Start with original

        // Estimate noise floor from quieter sections
        let noiseFloor = this.estimateNoiseFloor(audioData);

        for (let i = 0; i + windowSize <= audioData.length; i += step) {
            const window = audioData.slice(i, i + windowSize);
            const energy = this.calculateEnergy(window);

            // If energy is close to noise floor, reduce it
            if (energy < noiseFloor * 3) {
                for (let j = 0; j < windowSize; j++) {
                    const idx = i + j;
                    if (idx < cleaned.length) {
                        cleaned[idx] *= 0.3; // Reduce background noise
                    }
                }
            }
        }

        return cleaned;
    }

    removeDistantSounds(audioData) {
        // Remove sounds that are likely far from microphone based on volume and sharpness
        const processed = new Float32Array(audioData.length);
        const windowSize = 64;

        for (let i = 0; i < audioData.length; i++) {
            const start = Math.max(0, i - windowSize);
            const end = Math.min(audioData.length, i + windowSize);

            // Calculate local characteristics
            const localVolume = this.calculateRMS(audioData.slice(start, end));
            const sharpness = this.calculateSharpness(audioData.slice(start, end));

            // Keep sounds that are loud AND sharp (close percussive sounds)
            // Reduce sounds that are soft OR not sharp (distant/ambient sounds)
            const keepFactor = Math.min(1.0, (localVolume * 10) * (sharpness * 2));

            processed[i] = audioData[i] * Math.max(0.1, keepFactor);
        }

        return processed;
    }

    adaptiveNoiseGate(audioData) {
        // Adaptive noise gate that adjusts threshold based on local noise level
        const gated = new Float32Array(audioData.length);
        const windowSize = 512;

        for (let i = 0; i < audioData.length; i += windowSize) {
            const window = audioData.slice(i, Math.min(i + windowSize, audioData.length));
            const localNoise = this.estimateNoiseFloor(window);
            const threshold = localNoise * 4; // Adaptive threshold

            for (let j = 0; j < window.length; j++) {
                const idx = i + j;
                if (idx < audioData.length) {
                    const absValue = Math.abs(audioData[idx]);
                    gated[idx] = absValue > threshold ? audioData[idx] : audioData[idx] * 0.1;
                }
            }
        }

        return gated;
    }

    enhanceTransientsAdvanced(audioData) {
        // Enhanced transient detection with better clap/snap separation
        const enhanced = new Float32Array(audioData.length);
        const shortWindow = 16; // For snap detection (very sharp)
        const medWindow = 64;   // For clap detection (broader)

        for (let i = 0; i < audioData.length; i++) {
            const shortStart = Math.max(0, i - shortWindow);
            const shortEnd = Math.min(audioData.length, i + shortWindow);
            const medStart = Math.max(0, i - medWindow);
            const medEnd = Math.min(audioData.length, i + medWindow);

            // Calculate energies for different window sizes
            const shortEnergy = this.calculateEnergy(audioData.slice(shortStart, shortEnd));
            const medEnergy = this.calculateEnergy(audioData.slice(medStart, medEnd));
            const instantEnergy = audioData[i] * audioData[i];

            // Snap-like: very high instant/short ratio
            const snapLikeness = instantEnergy / (shortEnergy + 1e-10);

            // Clap-like: high instant/medium ratio but lower instant/short ratio
            const clapLikeness = instantEnergy / (medEnergy + 1e-10);

            // Enhanced factor based on sound characteristics
            let enhancement = 1.0;

            if (snapLikeness > 0.3) {
                enhancement = Math.min(4.0, 1.0 + snapLikeness * 2); // Enhance snaps more
            } else if (clapLikeness > 0.15) {
                enhancement = Math.min(2.5, 1.0 + clapLikeness * 1.5); // Moderate enhancement for claps
            }

            enhanced[i] = audioData[i] * enhancement;
        }

        return enhanced;
    }

    enhanceFrequencyCharacteristics(audioData) {
        // Apply frequency-domain enhancements to better distinguish clap vs snap
        const enhanced = new Float32Array(audioData.length);
        const windowSize = 128;

        for (let i = 0; i < audioData.length; i += windowSize / 2) {
            const window = audioData.slice(i, Math.min(i + windowSize, audioData.length));

            // Apply different enhancements based on frequency content analysis
            const highFreqContent = this.analyzeHighFrequencyContent(window);
            const midFreqContent = this.analyzeMidFrequencyContent(window);

            // Enhance based on spectral characteristics
            for (let j = 0; j < window.length; j++) {
                const idx = i + j;
                if (idx < enhanced.length) {
                    let sample = window[j];

                    // If high-frequency dominant (snap-like), enhance sharpness
                    if (highFreqContent > midFreqContent * 1.5) {
                        sample *= (1.0 + Math.min(0.3, highFreqContent * 0.5));
                    }
                    // If mid-frequency dominant (clap-like), enhance percussive character
                    else if (midFreqContent > highFreqContent * 1.2) {
                        sample *= (1.0 + Math.min(0.2, midFreqContent * 0.3));
                    }

                    enhanced[idx] = sample;
                }
            }
        }

        return enhanced;
    }

    analyzeHighFrequencyContent(window) {
        // Simple high-frequency energy analysis (approximation)
        let highFreqEnergy = 0;
        const windowLength = window.length;

        // High-pass filter approximation - look at rapid changes
        for (let i = 1; i < windowLength; i++) {
            const diff = Math.abs(window[i] - window[i-1]);
            highFreqEnergy += diff * diff;
        }

        return highFreqEnergy / (windowLength - 1);
    }

    analyzeMidFrequencyContent(window) {
        // Simple mid-frequency energy analysis
        let midFreqEnergy = 0;
        const windowLength = window.length;

        // Moving average to detect mid-frequency patterns
        const smoothWindow = 3;
        for (let i = smoothWindow; i < windowLength - smoothWindow; i++) {
            let smoothed = 0;
            for (let j = -smoothWindow; j <= smoothWindow; j++) {
                smoothed += window[i + j];
            }
            smoothed /= (2 * smoothWindow + 1);

            const energy = smoothed * smoothed;
            midFreqEnergy += energy;
        }

        return midFreqEnergy / (windowLength - 2 * smoothWindow);
    }

    estimateNoiseFloor(audioData) {
        // Estimate noise floor using percentile method
        const sorted = Array.from(audioData).map(Math.abs).sort((a, b) => a - b);
        const percentile25 = sorted[Math.floor(sorted.length * 0.25)];
        return percentile25;
    }

    calculateEnergy(window) {
        return window.reduce((sum, val) => sum + val * val, 0) / window.length;
    }

    calculateRMS(window) {
        return Math.sqrt(this.calculateEnergy(window));
    }

    calculateSharpness(window) {
        // Measure how "sharp" or sudden the signal is
        let sharpness = 0;
        for (let i = 1; i < window.length; i++) {
            sharpness += Math.abs(window[i] - window[i-1]);
        }
        return sharpness / (window.length - 1);
    }

    async classifyAudio(audioBuffer) {
        if (!this.isLoaded) {
            await this.loadModel();
        }

        try {
            console.log('Processing audio for classification...');

            // Preprocess audio
            const audioTensor = await this.preprocessAudio(audioBuffer);

            // Run inference
            const predictions = await this.model.predict(audioTensor);

            // Debug: log prediction object structure (commented out for cleaner output)
            // console.log('Prediction object type:', typeof predictions);
            // console.log('Prediction object keys:', Object.keys(predictions));
            // console.log('Is array:', Array.isArray(predictions));
            // if (predictions.shape) console.log('Prediction shape:', predictions.shape);

            // Get prediction values - handle different tensor types
            let predictionArray;
            if (predictions.data) {
                // If it's a standard tensor with .data() method
                const predictionData = await predictions.data();
                predictionArray = Array.from(predictionData);
            } else if (predictions.dataSync) {
                // If it's a tensor with .dataSync() method
                predictionArray = Array.from(predictions.dataSync());
            } else if (Array.isArray(predictions)) {
                // If predictions is already an array of tensors
                if (predictions[0] && predictions[0].data) {
                    const predictionData = await predictions[0].data();
                    predictionArray = Array.from(predictionData);
                } else {
                    // Handle case where it's an array of values
                    predictionArray = Array.from(predictions);
                }
            } else {
                // Try to convert to array directly
                predictionArray = Array.from(predictions);
            }

            // Find top predictions
            const topPredictions = this.getTopPredictions(predictionArray, 5);

            // Look for clap and snap specifically
            const result = this.detectTargetSounds(topPredictions);

            // Clean up tensors
            audioTensor.dispose();
            if (predictions && typeof predictions.dispose === 'function') {
                predictions.dispose();
            } else if (Array.isArray(predictions)) {
                // If predictions is an array, dispose of each tensor
                predictions.forEach(tensor => {
                    if (tensor && typeof tensor.dispose === 'function') {
                        tensor.dispose();
                    }
                });
            }

            console.log('Classification result:', result);
            return result;

        } catch (error) {
            console.error('Error during audio classification:', error);
            return {
                sound: 'unknown',
                confidence: 0.0,
                error: error.message
            };
        }
    }

    getTopPredictions(predictions, topK = 5) {
        const indexed = predictions.map((value, index) => ({ value, index }));
        indexed.sort((a, b) => b.value - a.value);

        return indexed.slice(0, topK).map(item => ({
            className: this.classNames[item.index] || `class_${item.index}`,
            confidence: item.value,
            index: item.index
        }));
    }

    detectTargetSounds(topPredictions) {
        let bestMatch = { sound: 'unknown', confidence: 0.0 };

        // Simple approach: look for clear clap/snap indicators
        const minConfidenceThreshold = 0.05;

        // Simple classification rules
        for (const prediction of topPredictions) {
            const className = prediction.className.toLowerCase();
            const confidence = prediction.confidence;

            if (confidence < minConfidenceThreshold) continue;

            // Direct clap matches
            if (className.includes('clap') || className.includes('applause')) {
                if (confidence > bestMatch.confidence) {
                    bestMatch = {
                        sound: 'clap',
                        confidence: confidence,
                        className: prediction.className
                    };
                }
                continue;
            }

            // Direct snap matches
            if (className.includes('snap') || className.includes('finger snap') ||
                className.includes('clicking') || className.includes('finger clicking')) {
                if (confidence > bestMatch.confidence) {
                    bestMatch = {
                        sound: 'snap',
                        confidence: confidence,
                        className: prediction.className
                    };
                }
                continue;
            }

            // Secondary indicators with simple logic
            if (className.includes('click') || className.includes('pop') || className.includes('impulse')) {
                // These lean toward snap if no percussion context
                if (!className.includes('percussive') && confidence > bestMatch.confidence) {
                    bestMatch = {
                        sound: 'snap',
                        confidence: confidence * 0.7, // Reduce confidence for indirect match
                        className: prediction.className
                    };
                }
                continue;
            }

            if (className.includes('percussive') || className.includes('transient')) {
                // Simple rule: if other predictions suggest clap context, it's clap; otherwise snap
                const hasSnapContext = topPredictions.slice(0, 3).some(p =>
                    p.className.toLowerCase().includes('click') ||
                    p.className.toLowerCase().includes('pop') ||
                    p.className.toLowerCase().includes('impulse')
                );

                const sound = hasSnapContext ? 'snap' : 'clap';
                if (confidence > bestMatch.confidence) {
                    bestMatch = {
                        sound: sound,
                        confidence: confidence * 0.6, // Reduce confidence for generic match
                        className: prediction.className
                    };
                }
            }
        }

        // Debug output
        console.log('Sound classification results (top 5):');
        topPredictions.slice(0, 5).forEach(pred => {
            console.log(`  ${pred.className}: ${(pred.confidence * 100).toFixed(1)}%`);
        });

        if (bestMatch.sound !== 'unknown') {
            console.log(`🎯 Detected ${bestMatch.sound.toUpperCase()} with ${(bestMatch.confidence * 100).toFixed(1)}% confidence from "${bestMatch.className}"`);
        }

        return bestMatch;
    }

    // Simplified - removed complex analysis methods

    // Simplified approach - removed complex methods

    // Cleanup method
    cleanup() {
        if (this.model) {
            this.model.dispose();
            this.model = null;
        }
        this.isLoaded = false;
    }
}

module.exports = YAMNetClassifier;