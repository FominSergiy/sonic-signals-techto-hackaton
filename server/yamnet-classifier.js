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
                350: 'Inside, large room or hall'
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

            // YAMNet expects 16kHz mono audio
            // Resample if necessary (simplified approach)
            const targetSampleRate = 16000;
            const targetLength = Math.floor(audioData.length * targetSampleRate / 44100); // Assume 44.1kHz input

            // Simple downsampling (in production, use proper resampling)
            const resampledAudio = new Float32Array(targetLength);
            const ratio = audioData.length / targetLength;

            for (let i = 0; i < targetLength; i++) {
                const sourceIndex = Math.floor(i * ratio);
                resampledAudio[i] = audioData[sourceIndex] || 0;
            }

            // Normalize audio to [-1, 1] range
            const maxAbs = Math.max(...resampledAudio.map(Math.abs));
            if (maxAbs > 0) {
                for (let i = 0; i < resampledAudio.length; i++) {
                    resampledAudio[i] /= maxAbs;
                }
            }

            // Convert to tensor
            const audioTensor = tf.tensor1d(resampledAudio);

            return audioTensor;

        } catch (error) {
            console.error('Error preprocessing audio:', error);
            throw error;
        }
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

        // Check each prediction for our target sounds
        for (const prediction of topPredictions) {
            const className = prediction.className.toLowerCase();

            // Check for clap
            if (this.isClap(className)) {
                if (prediction.confidence > bestMatch.confidence) {
                    bestMatch = {
                        sound: 'clap',
                        confidence: prediction.confidence,
                        details: {
                            className: prediction.className,
                            allPredictions: topPredictions
                        }
                    };
                }
            }

            // Check for snap
            if (this.isSnap(className)) {
                if (prediction.confidence > bestMatch.confidence) {
                    bestMatch = {
                        sound: 'snap',
                        confidence: prediction.confidence,
                        details: {
                            className: prediction.className,
                            allPredictions: topPredictions
                        }
                    };
                }
            }
        }

        // Print confidence levels for debugging
        console.log('Sound classification results:');
        topPredictions.forEach(pred => {
            console.log(`  ${pred.className}: ${(pred.confidence * 100).toFixed(1)}%`);
        });

        if (bestMatch.sound !== 'unknown') {
            console.log(`Detected ${bestMatch.sound} with ${(bestMatch.confidence * 100).toFixed(1)}% confidence`);
        }

        return bestMatch;
    }

    isClap(className) {
        const clapKeywords = ['clap', 'applause', 'clapping', 'hand clap'];
        return clapKeywords.some(keyword => className.includes(keyword));
    }

    isSnap(className) {
        const snapKeywords = ['snap', 'finger snap', 'clicking', 'finger clicking'];
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