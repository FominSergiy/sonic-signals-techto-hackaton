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

            // Enhanced preprocessing for better clap/snap detection
            audioData = this.enhanceSharpSounds(audioData);

            // YAMNet expects 16kHz mono audio
            // Resample if necessary (improved approach)
            const targetSampleRate = 16000;
            const originalSampleRate = this.detectSampleRate(audioData) || 44100;
            const targetLength = Math.floor(audioData.length * targetSampleRate / originalSampleRate);

            // Better resampling with anti-aliasing
            const resampledAudio = this.resampleAudio(audioData, originalSampleRate, targetSampleRate);

            // Apply noise gate to reduce background noise
            const gatedAudio = this.applyNoiseGate(resampledAudio, 0.02); // 2% threshold

            // Enhance transients (important for claps and snaps)
            const enhancedAudio = this.enhanceTransients(gatedAudio);

            // Smart normalization that preserves dynamics
            const normalizedAudio = this.smartNormalize(enhancedAudio);

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

        // Lower detection thresholds and add weighted scoring for related sounds
        const minConfidenceThreshold = 0.05; // Lower threshold for better sensitivity

        // Weighted scoring system for related sounds
        const soundWeights = {
            // Direct matches (highest weight)
            'clap': 1.0,
            'clapping': 1.0,
            'applause': 0.9,
            'finger snap': 1.0,
            'finger snapping': 1.0,
            'snap': 1.0,

            // Related percussive sounds (moderate weight)
            'click': 0.6,
            'clicking': 0.6,
            'tap': 0.5,
            'tapping': 0.5,
            'rimshot': 0.7,
            'pop': 0.6,
            'click sound': 0.7,
            'pop sound': 0.7,
            'impulse sound': 0.8,

            // Generic percussive/transient sounds (moderate weight)
            'percussive sound': 0.7,
            'sharp sound': 0.6,
            'transient sound': 0.8,

            // Contextual sounds that might indicate claps/snaps (lower weight)
            'applause': 0.8,
            'hand clap': 1.0,
            'finger clicking': 0.9
        };

        // Check each prediction with weighted scoring and smart differentiation
        let clapCandidates = [];
        let snapCandidates = [];

        for (const prediction of topPredictions) {
            const className = prediction.className.toLowerCase();

            // Collect clap candidates
            if (this.isClap(className)) {
                const weight = this.getSoundWeight(className, 'clap', soundWeights);
                const weightedConfidence = prediction.confidence * weight;

                if (prediction.confidence > minConfidenceThreshold) {
                    clapCandidates.push({
                        sound: 'clap',
                        confidence: weightedConfidence,
                        rawConfidence: prediction.confidence,
                        weight: weight,
                        className: className,
                        details: {
                            className: prediction.className,
                            allPredictions: topPredictions
                        }
                    });
                }
            }

            // Collect snap candidates
            if (this.isSnap(className)) {
                const weight = this.getSoundWeight(className, 'snap', soundWeights);
                const weightedConfidence = prediction.confidence * weight;

                if (prediction.confidence > minConfidenceThreshold) {
                    snapCandidates.push({
                        sound: 'snap',
                        confidence: weightedConfidence,
                        rawConfidence: prediction.confidence,
                        weight: weight,
                        className: className,
                        details: {
                            className: prediction.className,
                            allPredictions: topPredictions
                        }
                    });
                }
            }
        }

        // Smart differentiation logic
        bestMatch = this.chooseBestMatch(clapCandidates, snapCandidates, topPredictions);

        // Print confidence levels for debugging
        console.log('Sound classification results:');
        topPredictions.forEach(pred => {
            console.log(`  ${pred.className}: ${(pred.confidence * 100).toFixed(1)}%`);
        });

        if (bestMatch.sound !== 'unknown') {
            const displayConfidence = bestMatch.rawConfidence || bestMatch.confidence;
            console.log(`Detected ${bestMatch.sound} with ${(displayConfidence * 100).toFixed(1)}% confidence (weighted: ${(bestMatch.confidence * 100).toFixed(1)}%)`);
        }

        return bestMatch;
    }

    chooseBestMatch(clapCandidates, snapCandidates, topPredictions) {
        // If no candidates, return unknown
        if (clapCandidates.length === 0 && snapCandidates.length === 0) {
            return { sound: 'unknown', confidence: 0.0 };
        }

        // Get best candidate from each category
        const bestClap = clapCandidates.length > 0 ?
            clapCandidates.reduce((best, current) => current.confidence > best.confidence ? current : best) : null;

        const bestSnap = snapCandidates.length > 0 ?
            snapCandidates.reduce((best, current) => current.confidence > best.confidence ? current : best) : null;

        // Smart differentiation based on sound characteristics
        let clapScore = bestClap ? bestClap.confidence : 0;
        let snapScore = bestSnap ? bestSnap.confidence : 0;

        // Apply heuristics based on detected sound types
        for (const pred of topPredictions.slice(0, 3)) { // Check top 3 predictions
            const className = pred.className.toLowerCase();

            // Boost snap score for sounds more typical of snaps
            if (className.includes('click') || className.includes('impulse') || className.includes('pop')) {
                snapScore *= 1.3; // 30% boost for snap-like characteristics
            }

            // Boost clap score for sounds more typical of claps
            if (className.includes('percussive') && !className.includes('click')) {
                clapScore *= 1.2; // 20% boost for clap-like characteristics
            }

            // Higher transient score suggests snap (sharper, more sudden)
            if (className.includes('transient') && pred.confidence > 0.25) {
                snapScore *= 1.4; // 40% boost for high-confidence transient
            }
        }

        // Choose the best match
        if (snapScore > clapScore && bestSnap) {
            console.log(`Differentiation: Chose snap (${snapScore.toFixed(3)}) over clap (${clapScore.toFixed(3)})`);
            return bestSnap;
        } else if (bestClap) {
            console.log(`Differentiation: Chose clap (${clapScore.toFixed(3)}) over snap (${snapScore.toFixed(3)})`);
            return bestClap;
        }

        return { sound: 'unknown', confidence: 0.0 };
    }

    getSoundWeight(className, soundType, soundWeights) {
        // Get specific weight for the class name
        const exactWeight = soundWeights[className];
        if (exactWeight) return exactWeight;

        // Check for partial matches
        for (const [weightedSound, weight] of Object.entries(soundWeights)) {
            if (className.includes(weightedSound) || weightedSound.includes(className)) {
                return weight;
            }
        }

        // Default weight for unrecognized but categorized sounds
        return soundType === 'clap' ? 0.4 : 0.4;
    }

    isClap(className) {
        const clapKeywords = [
            'clap', 'applause', 'clapping', 'hand clap', 'handclap',
            'applaud', 'ovation', 'rhythmic clapping', 'percussive sound',
            'sharp sound', 'transient sound' // Added generic percussive sounds
        ];
        return clapKeywords.some(keyword => className.includes(keyword));
    }

    isSnap(className) {
        const snapKeywords = [
            'snap', 'finger snap', 'finger snapping', 'clicking', 'finger clicking',
            'click', 'pop', 'tick', 'snap of fingers', 'click sound', 'pop sound',
            'impulse sound', 'transient sound' // Added generic sharp sounds
        ];
        return snapKeywords.some(keyword => className.includes(keyword));
    }

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