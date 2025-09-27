// Audio processing helper for voice command extension
class AudioProcessor {
    constructor() {
      this.sampleRate = 16000;
      this.bufferSize = 4096;
      this.analysisWindow = 2048;
      this.threshold = 0.01;
    }
  
    // Detect audio activity (voice activity detection)
    detectActivity(audioData) {
      let sum = 0;
      let maxAmplitude = 0;
      
      for (let i = 0; i < audioData.length; i++) {
        const abs = Math.abs(audioData[i]);
        sum += abs;
        maxAmplitude = Math.max(maxAmplitude, abs);
      }
      
      const average = sum / audioData.length;
      const hasActivity = average > this.threshold && maxAmplitude > this.threshold * 3;
      
      return {
        hasActivity,
        averageLevel: average,
        maxLevel: maxAmplitude,
        duration: audioData.length / this.sampleRate
      };
    }
  
    // Extract basic audio features for simple pattern matching
    extractFeatures(audioData) {
      const features = {
        energy: this.calculateEnergy(audioData),
        zeroCrossingRate: this.calculateZeroCrossingRate(audioData),
        spectralCentroid: this.calculateSpectralCentroid(audioData),
        duration: audioData.length / this.sampleRate,
        peak: this.findPeak(audioData)
      };
  
      // Classify based on features
      features.classification = this.classifySound(features);
      
      return features;
    }
  
    calculateEnergy(audioData) {
      let energy = 0;
      for (let i = 0; i < audioData.length; i++) {
        energy += audioData[i] * audioData[i];
      }
      return energy / audioData.length;
    }
  
    calculateZeroCrossingRate(audioData) {
      let crossings = 0;
      for (let i = 1; i < audioData.length; i++) {
        if ((audioData[i] >= 0) !== (audioData[i - 1] >= 0)) {
          crossings++;
        }
      }
      return crossings / audioData.length;
    }
  
    calculateSpectralCentroid(audioData) {
      // Simplified spectral centroid calculation
      const fft = this.simpleFFT(audioData);
      let numerator = 0;
      let denominator = 0;
      
      for (let i = 0; i < fft.length / 2; i++) {
        const magnitude = Math.sqrt(fft[i].real * fft[i].real + fft[i].imag * fft[i].imag);
        numerator += i * magnitude;
        denominator += magnitude;
      }
      
      return denominator > 0 ? numerator / denominator : 0;
    }
  
    findPeak(audioData) {
      let maxValue = 0;
      let peakIndex = 0;
      
      for (let i = 0; i < audioData.length; i++) {
        const abs = Math.abs(audioData[i]);
        if (abs > maxValue) {
          maxValue = abs;
          peakIndex = i;
        }
      }
      
      return {
        value: maxValue,
        position: peakIndex / audioData.length,
        time: peakIndex / this.sampleRate
      };
    }
  
    // Simple FFT implementation for basic frequency analysis
    simpleFFT(audioData) {
      const N = audioData.length;
      const result = [];
      
      for (let k = 0; k < N; k++) {
        let real = 0;
        let imag = 0;
        
        for (let n = 0; n < N; n++) {
          const angle = -2 * Math.PI * k * n / N;
          real += audioData[n] * Math.cos(angle);
          imag += audioData[n] * Math.sin(angle);
        }
        
        result.push({ real, imag });
      }
      
      return result;
    }
  
    // Basic sound classification based on features
    classifySound(features) {
      const { energy, zeroCrossingRate, spectralCentroid, duration, peak } = features;
      
      // Simple heuristic classification
      if (duration < 0.2 && energy > 0.001 && peak.value > 0.1) {
        if (zeroCrossingRate > 0.1) {
          return 'click'; // Like finger snap or tongue click
        } else {
          return 'thump'; // Like hand clap
        }
      } else if (duration > 0.3 && duration < 1.5) {
        if (spectralCentroid > 50 && zeroCrossingRate > 0.05) {
          return 'whistle'; // Whistle-like sound
        } else if (energy > 0.0005) {
          return 'voice'; // Voice command
        }
      } else if (duration < 0.1 && energy > 0.002) {
        return 'pop'; // Very short sharp sound
      }
      
      return 'unknown';
    }
  
    // Match extracted features against known command patterns
    matchCommand(features, commandPatterns) {
      let bestMatch = null;
      let bestScore = 0;
      
      for (const pattern of commandPatterns) {
        const score = this.calculateMatchScore(features, pattern);
        if (score > bestScore && score > 0.6) { // Threshold for matching
          bestScore = score;
          bestMatch = pattern;
        }
      }
      
      return bestMatch ? {
        command: bestMatch.action,
        confidence: bestScore,
        pattern: bestMatch
      } : null;
    }
  
    calculateMatchScore(features, pattern) {
      // Simple scoring based on feature similarity
      let score = 0;
      let weights = 0;
      
      // Duration matching
      if (pattern.expectedDuration) {
        const durationDiff = Math.abs(features.duration - pattern.expectedDuration);
        const durationScore = Math.max(0, 1 - (durationDiff / pattern.expectedDuration));
        score += durationScore * 0.3;
        weights += 0.3;
      }
      
      // Energy matching
      if (pattern.expectedEnergy) {
        const energyRatio = Math.min(features.energy, pattern.expectedEnergy) / 
                           Math.max(features.energy, pattern.expectedEnergy);
        score += energyRatio * 0.25;
        weights += 0.25;
      }
      
      // Classification matching
      if (pattern.expectedClassification && features.classification === pattern.expectedClassification) {
        score += 0.45;
        weights += 0.45;
      }
      
      return weights > 0 ? score / weights : 0;
    }
  
    // Create a command pattern from recorded audio
    createPattern(audioData, commandName, action) {
      const features = this.extractFeatures(audioData);
      
      return {
        name: commandName,
        action: action,
        expectedDuration: features.duration,
        expectedEnergy: features.energy,
        expectedClassification: features.classification,
        expectedZeroCrossingRate: features.zeroCrossingRate,
        expectedSpectralCentroid: features.spectralCentroid,
        createdAt: Date.now()
      };
    }
  
    // Process audio in real-time chunks
    processRealTimeAudio(audioChunk, callback) {
      const activity = this.detectActivity(audioChunk);
      
      if (activity.hasActivity) {
        const features = this.extractFeatures(audioChunk);
        callback({
          type: 'activity',
          features: features,
          activity: activity
        });
      }
    }
  }
  
  // Export for use in background script
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AudioProcessor;
  } else {
    window.AudioProcessor = AudioProcessor;
  }