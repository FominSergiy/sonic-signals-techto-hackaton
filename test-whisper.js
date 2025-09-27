const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// Test the Whisper classifier with mock audio data
async function testWhisperClassifier() {
    console.log('🧪 Testing Whisper Classifier...\n');

    // Create a WebSocket connection to the server
    const ws = new WebSocket('ws://localhost:3001');

    return new Promise((resolve, reject) => {
        ws.on('open', () => {
            console.log('📡 Connected to WebSocket server');

            // Generate test audio patterns
            const testAudio = generateTestAudio();

            console.log('🎵 Sending test audio data...');
            ws.send(testAudio);
        });

        ws.on('message', (data) => {
            try {
                const response = JSON.parse(data.toString());
                console.log('📥 Received response:');
                console.log(JSON.stringify(response, null, 2));

                ws.close();
                resolve(response);
            } catch (error) {
                console.error('❌ Error parsing response:', error);
                reject(error);
            }
        });

        ws.on('error', (error) => {
            console.error('❌ WebSocket error:', error);
            reject(error);
        });

        ws.on('close', () => {
            console.log('🔌 WebSocket connection closed');
        });
    });
}

function generateTestAudio() {
    // Generate a simple test audio pattern that simulates a clap
    const sampleRate = 16000;
    const duration = 0.5; // 500ms
    const samples = Math.floor(sampleRate * duration);

    const audioBuffer = Buffer.alloc(samples * 4); // 4 bytes per float32
    const view = new DataView(audioBuffer.buffer);

    // Generate a clap-like pattern: sharp attack, quick decay
    for (let i = 0; i < samples; i++) {
        let amplitude = 0;

        if (i < samples * 0.1) {
            // Sharp attack
            amplitude = Math.sin(i * 0.1) * (1 - i / (samples * 0.1)) * 0.8;
        } else if (i < samples * 0.3) {
            // Quick decay
            amplitude = Math.sin(i * 0.05) * Math.exp(-(i - samples * 0.1) / (samples * 0.05)) * 0.3;
        }

        // Add some noise for realism
        amplitude += (Math.random() - 0.5) * 0.1;

        view.setFloat32(i * 4, amplitude, true);
    }

    console.log(`🎶 Generated test audio: ${samples} samples, ${duration}s duration`);
    return audioBuffer;
}

// Run the test
async function main() {
    try {
        console.log('🚀 Starting Whisper classifier test...\n');

        // Wait a moment to ensure server is ready
        await new Promise(resolve => setTimeout(resolve, 1000));

        const result = await testWhisperClassifier();

        console.log('\n✅ Test completed successfully!');
        console.log(`🎯 Classification result: ${result.classification.sound} (${(result.classification.confidence * 100).toFixed(1)}% confidence)`);
        console.log(`📋 Method: ${result.classification.method || 'unknown'}`);

        if (result.classification.transcription) {
            console.log(`🗣️  Transcription: "${result.classification.transcription}"`);
        }

    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

// Check if server is running first
const http = require('http');

function checkServer() {
    return new Promise((resolve, reject) => {
        const req = http.get('http://localhost:3001/health', (res) => {
            if (res.statusCode === 200) {
                resolve(true);
            } else {
                reject(new Error(`Server returned status ${res.statusCode}`));
            }
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('Server health check timeout'));
        });
    });
}

checkServer()
    .then(() => {
        console.log('✅ Server is running, starting test...\n');
        return main();
    })
    .catch((error) => {
        console.error('❌ Server is not running or not responding:');
        console.error('   Make sure to start the server first with: yarn start');
        console.error(`   Error: ${error.message}`);
        process.exit(1);
    });