const WebSocket = require('ws');

function createNoisyEnvironmentBuffer(soundType, noiseLevel = 0.3) {
    const sampleRate = 16000;
    const duration = 1.0; // 1 second
    const samples = sampleRate * duration;

    // Create WAV header
    const headerLength = 44;
    const buffer = Buffer.alloc(headerLength + samples * 2);

    // WAV header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(headerLength + samples * 2 - 8, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(samples * 2, 40);

    // Generate noisy environment with target sound
    for (let i = 0; i < samples; i++) {
        const t = i / sampleRate;
        let sample = 0;

        // Add background conversation noise (speech-like frequencies)
        const speechNoise = noiseLevel * 0.4 * (
            Math.sin(2 * Math.PI * 300 * t) * 0.3 +
            Math.sin(2 * Math.PI * 800 * t) * 0.4 +
            Math.sin(2 * Math.PI * 1500 * t) * 0.2 +
            Math.random() * 0.1
        );

        // Add room ambience (low frequency)
        const ambientNoise = noiseLevel * 0.2 * (
            Math.sin(2 * Math.PI * 60 * t) * 0.5 +
            Math.sin(2 * Math.PI * 120 * t) * 0.3 +
            Math.random() * 0.2
        );

        // Add distant sounds (mid-frequency)
        const distantNoise = noiseLevel * 0.1 * Math.random();

        // Create the target sound (clap or snap) around 0.3-0.4 seconds
        if (t >= 0.3 && t <= 0.4) {
            if (soundType === 'clap') {
                // Clap: broader frequency range, longer duration
                if (t <= 0.32) {
                    const amplitude = 0.9 * Math.exp(-(t - 0.3) * 80);
                    sample += amplitude * (Math.random() * 2 - 1); // Noise burst
                } else if (t <= 0.35) {
                    const amplitude = 0.4 * Math.exp(-(t - 0.32) * 20);
                    sample += amplitude * Math.sin(2 * Math.PI * 1000 * t) * (Math.random() * 0.5 + 0.5);
                } else {
                    const amplitude = 0.1 * Math.exp(-(t - 0.35) * 10);
                    sample += amplitude * (Math.random() * 2 - 1);
                }
            } else if (soundType === 'snap') {
                // Snap: very sharp, high frequency, short duration
                if (t <= 0.305) {
                    const amplitude = 0.95 * Math.exp(-(t - 0.3) * 200);
                    sample += amplitude * Math.sin(2 * Math.PI * 3500 * t);
                } else if (t <= 0.32) {
                    const amplitude = 0.3 * Math.exp(-(t - 0.305) * 100);
                    sample += amplitude * Math.sin(2 * Math.PI * 2800 * t) * (Math.random() * 0.3 + 0.7);
                }
            }
        }

        // Combine all sounds
        const totalSample = sample + speechNoise + ambientNoise + distantNoise;

        // Convert to 16-bit PCM
        const intSample = Math.floor(totalSample * 32767 * 0.8); // Reduce overall level
        buffer.writeInt16LE(Math.max(-32768, Math.min(32767, intSample)), headerLength + i * 2);
    }

    return buffer;
}

function testNoisyEnvironment(soundType, noiseLevel, testName) {
    return new Promise((resolve, reject) => {
        console.log(`\\n--- ${testName} ---`);

        const ws = new WebSocket('ws://localhost:3001');

        ws.on('open', () => {
            console.log(`Connected for ${testName}`);
            const audioBuffer = createNoisyEnvironmentBuffer(soundType, noiseLevel);
            console.log(`Sending noisy ${soundType} (noise level: ${(noiseLevel * 100).toFixed(0)}%, ${audioBuffer.length} bytes)`);
            ws.send(audioBuffer);
        });

        ws.on('message', (data) => {
            try {
                const response = JSON.parse(data.toString());
                console.log(`Result:`, response.classification);

                if (response.classification) {
                    console.log(`  Sound: ${response.classification.sound}`);
                    console.log(`  Confidence: ${(response.classification.confidence * 100).toFixed(1)}%`);
                    console.log(`  Action: ${response.action}`);

                    const expectedSound = soundType.toLowerCase();
                    const detectedSound = response.classification.sound;
                    const success = detectedSound === expectedSound;

                    console.log(`  ✓ Detection ${success ? 'SUCCESS' : 'FAILED'} (expected: ${expectedSound}, got: ${detectedSound})`);

                    if (success) {
                        console.log(`  🎯 Noise reduction EFFECTIVE`);
                    } else if (detectedSound === 'unknown') {
                        console.log(`  🔇 Signal lost in noise`);
                    } else {
                        console.log(`  🔀 Cross-detection issue`);
                    }
                }
            } catch (error) {
                console.error(`Error parsing ${testName} response:`, error);
            }

            ws.close();
        });

        ws.on('error', (error) => {
            console.error(`${testName} WebSocket error:`, error);
            reject(error);
        });

        ws.on('close', () => {
            console.log(`${testName} completed`);
            setTimeout(resolve, 500);
        });
    });
}

async function runNoisyEnvironmentTests() {
    console.log('Testing Audio Classification in Noisy Environments');
    console.log('====================================================');

    try {
        // Test 1: Low noise environment
        await testNoisyEnvironment('clap', 0.1, 'Low Noise Clap Test');
        await testNoisyEnvironment('snap', 0.1, 'Low Noise Snap Test');

        // Test 2: Medium noise (typical conversation level)
        await testNoisyEnvironment('clap', 0.3, 'Medium Noise Clap Test');
        await testNoisyEnvironment('snap', 0.3, 'Medium Noise Snap Test');

        // Test 3: High noise (noisy conversation environment)
        await testNoisyEnvironment('clap', 0.5, 'High Noise Clap Test');
        await testNoisyEnvironment('snap', 0.5, 'High Noise Snap Test');

        // Test 4: Very high noise (challenging environment)
        await testNoisyEnvironment('clap', 0.7, 'Very High Noise Clap Test');
        await testNoisyEnvironment('snap', 0.7, 'Very High Noise Snap Test');

        console.log('\\n====================================================');
        console.log('Noisy environment tests completed!');
        console.log('Check results for noise reduction effectiveness.');
    } catch (error) {
        console.error('Test error:', error);
    }
}

// Run the tests
runNoisyEnvironmentTests();