const WebSocket = require('ws');

function createClapAudioBuffer() {
    // Create a more realistic clap simulation
    const sampleRate = 16000;
    const duration = 0.5; // 0.5 seconds
    const samples = sampleRate * duration;

    // Create WAV header
    const headerLength = 44;
    const buffer = Buffer.alloc(headerLength + samples * 2);

    // WAV header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(headerLength + samples * 2 - 8, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // PCM chunk size
    buffer.writeUInt16LE(1, 20);  // PCM format
    buffer.writeUInt16LE(1, 22);  // Mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);  // Block align
    buffer.writeUInt16LE(16, 34); // Bits per sample
    buffer.write('data', 36);
    buffer.writeUInt32LE(samples * 2, 40);

    // Generate clap-like sound: sharp attack with noise burst
    for (let i = 0; i < samples; i++) {
        const t = i / sampleRate;
        let sample = 0;

        if (t < 0.01) {
            // Sharp attack phase - high frequency noise burst
            const amplitude = 0.8 * Math.exp(-t * 100); // Quick decay
            sample = amplitude * (Math.random() * 2 - 1); // White noise
        } else if (t < 0.05) {
            // Decay phase with some resonance
            const amplitude = 0.3 * Math.exp(-t * 20);
            sample = amplitude * (Math.random() * 2 - 1) * Math.sin(2 * Math.PI * 1200 * t);
        } else {
            // Silence or very quiet tail
            sample = 0.01 * (Math.random() * 2 - 1);
        }

        const intSample = Math.floor(sample * 32767);
        buffer.writeInt16LE(Math.max(-32768, Math.min(32767, intSample)), headerLength + i * 2);
    }

    return buffer;
}

function createSnapAudioBuffer() {
    // Create a more realistic snap simulation
    const sampleRate = 16000;
    const duration = 0.3; // 0.3 seconds
    const samples = sampleRate * duration;

    // Create WAV header
    const headerLength = 44;
    const buffer = Buffer.alloc(headerLength + samples * 2);

    // WAV header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(headerLength + samples * 2 - 8, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // PCM chunk size
    buffer.writeUInt16LE(1, 20);  // PCM format
    buffer.writeUInt16LE(1, 22);  // Mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);  // Block align
    buffer.writeUInt16LE(16, 34); // Bits per sample
    buffer.write('data', 36);
    buffer.writeUInt32LE(samples * 2, 40);

    // Generate snap-like sound: very sharp click with resonance
    for (let i = 0; i < samples; i++) {
        const t = i / sampleRate;
        let sample = 0;

        if (t < 0.001) {
            // Ultra-sharp attack - impulse
            sample = 0.9 * Math.sin(2 * Math.PI * 3000 * t) * Math.exp(-t * 1000);
        } else if (t < 0.02) {
            // Quick resonant decay
            const amplitude = 0.4 * Math.exp(-t * 150);
            sample = amplitude * Math.sin(2 * Math.PI * 2500 * t) * (Math.random() * 0.3 + 0.7);
        } else {
            // Silence
            sample = 0;
        }

        const intSample = Math.floor(sample * 32767);
        buffer.writeInt16LE(Math.max(-32768, Math.min(32767, intSample)), headerLength + i * 2);
    }

    return buffer;
}

function testSound(soundName, audioBuffer) {
    return new Promise((resolve, reject) => {
        console.log(`\\n--- Testing ${soundName.toUpperCase()} ---`);

        const ws = new WebSocket('ws://localhost:3001');

        ws.on('open', () => {
            console.log(`Connected to server for ${soundName} test`);
            console.log(`Sending ${soundName} audio data (${audioBuffer.length} bytes)`);
            ws.send(audioBuffer);
        });

        ws.on('message', (data) => {
            try {
                const response = JSON.parse(data.toString());
                console.log(`${soundName.toUpperCase()} Result:`, response.classification);

                if (response.classification) {
                    console.log(`  Sound: ${response.classification.sound}`);
                    console.log(`  Confidence: ${(response.classification.confidence * 100).toFixed(1)}%`);
                    console.log(`  Action: ${response.action}`);

                    // Check if detection was successful
                    const expectedSound = soundName.toLowerCase();
                    const detectedSound = response.classification.sound;
                    const success = detectedSound === expectedSound;

                    console.log(`  ✓ Detection ${success ? 'SUCCESS' : 'FAILED'} (expected: ${expectedSound}, got: ${detectedSound})`);
                }
            } catch (error) {
                console.error(`Error parsing ${soundName} response:`, error);
            }

            ws.close();
        });

        ws.on('error', (error) => {
            console.error(`${soundName} WebSocket error:`, error);
            reject(error);
        });

        ws.on('close', () => {
            console.log(`${soundName} test completed`);
            setTimeout(resolve, 500); // Small delay between tests
        });
    });
}

async function runTests() {
    console.log('Testing improved audio classification...');
    console.log('=====================================');

    try {
        // Test clap detection
        const clapBuffer = createClapAudioBuffer();
        await testSound('clap', clapBuffer);

        // Test snap detection
        const snapBuffer = createSnapAudioBuffer();
        await testSound('snap', snapBuffer);

        console.log('\\n=====================================');
        console.log('All tests completed!');
    } catch (error) {
        console.error('Test error:', error);
    }
}

// Run the tests
runTests();