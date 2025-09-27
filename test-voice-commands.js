require('dotenv').config();

const WebSocket = require('ws');
const fs = require('fs');
const nodeWav = require('node-wav');

// Test voice commands with OpenAI Whisper API
async function testVoiceCommands() {
    console.log('🎤 Testing Voice Command Detection with OpenAI Whisper...\n');

    // Check if API key is available
    if (!process.env.OPENAI_API_KEY) {
        console.log('❌ No OPENAI_API_KEY found in environment');
        console.log('   Make sure you have a .env file with your OpenAI API key');
        return;
    }

    console.log('✅ OpenAI API key found, testing voice command detection...\n');

    // Create WebSocket connection
    const ws = new WebSocket('ws://localhost:3001');

    return new Promise((resolve, reject) => {
        ws.on('open', async () => {
            console.log('📡 Connected to WebSocket server');

            try {
                // Test with different voice command scenarios
                const tests = [
                    { command: 'clap', description: 'Simulated "clap" voice command' },
                    { command: 'snap', description: 'Simulated "snap" voice command' },
                    { command: 'clapping hands', description: 'Longer "clapping hands" command' }
                ];

                for (let i = 0; i < tests.length; i++) {
                    const test = tests[i];
                    console.log(`\n🎵 Test ${i + 1}: ${test.description}`);

                    // Generate audio with voice-like characteristics
                    const voiceAudio = generateVoiceAudio(test.command);

                    console.log(`   Sending audio data...`);
                    ws.send(voiceAudio);

                    // Wait for response
                    await new Promise(resolve => {
                        const timeout = setTimeout(() => {
                            console.log('   ⏰ Timeout waiting for response');
                            resolve();
                        }, 15000); // 15 second timeout for API calls

                        ws.once('message', (data) => {
                            clearTimeout(timeout);
                            try {
                                const response = JSON.parse(data.toString());
                                console.log('   📥 Response received:');
                                console.log(`      Sound: ${response.classification.sound}`);
                                console.log(`      Confidence: ${(response.classification.confidence * 100).toFixed(1)}%`);
                                console.log(`      Method: ${response.classification.method}`);

                                if (response.classification.transcription) {
                                    console.log(`      Transcription: "${response.classification.transcription}"`);
                                }

                                if (response.classification.error) {
                                    console.log(`      Error: ${response.classification.error}`);
                                }
                            } catch (error) {
                                console.log('   ❌ Error parsing response:', error.message);
                            }
                            resolve();
                        });
                    });

                    // Small delay between tests
                    if (i < tests.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }

                ws.close();
                resolve();

            } catch (error) {
                console.error('❌ Error during testing:', error);
                reject(error);
            }
        });

        ws.on('error', (error) => {
            console.error('❌ WebSocket error:', error);
            reject(error);
        });

        ws.on('close', () => {
            console.log('\n🔌 WebSocket connection closed');
        });
    });
}

function generateVoiceAudio(command) {
    // Generate audio that simulates speech characteristics
    // This is a simplified simulation - real voice would be much more complex

    const sampleRate = 16000;
    const duration = command.length * 0.2 + 0.5; // Rough duration based on word length
    const samples = Math.floor(sampleRate * duration);

    console.log(`   🎶 Generating ${duration.toFixed(1)}s of simulated voice audio for "${command}"`);

    // Create more speech-like patterns
    const audioData = new Float32Array(samples);

    for (let i = 0; i < samples; i++) {
        let amplitude = 0;
        const t = i / sampleRate;

        // Simulate speech formants and patterns
        if (t < duration * 0.1) {
            // Speech onset
            amplitude = Math.sin(2 * Math.PI * 150 * t) * (t / (duration * 0.1)) * 0.3;
        } else if (t < duration * 0.8) {
            // Main speech content with formant-like frequencies
            const f1 = 500 + Math.sin(t * 10) * 100; // First formant variation
            const f2 = 1200 + Math.sin(t * 8) * 200; // Second formant variation

            amplitude = (
                Math.sin(2 * Math.PI * f1 * t) * 0.2 +
                Math.sin(2 * Math.PI * f2 * t) * 0.15 +
                Math.sin(2 * Math.PI * 100 * t) * 0.1  // Fundamental frequency
            ) * Math.sin(Math.PI * t / duration); // Envelope
        } else {
            // Speech decay
            const fadeout = 1 - (t - duration * 0.8) / (duration * 0.2);
            amplitude = Math.sin(2 * Math.PI * 200 * t) * fadeout * 0.1;
        }

        // Add some noise for realism
        amplitude += (Math.random() - 0.5) * 0.05;

        audioData[i] = Math.max(-1, Math.min(1, amplitude));
    }

    // Convert to WAV format
    const wavBuffer = nodeWav.encode([audioData], {
        sampleRate: sampleRate,
        float: false,
        bitDepth: 16
    });

    return wavBuffer;
}

// Check server and run test
async function main() {
    console.log('🚀 Starting Voice Command Test with OpenAI Whisper...\n');

    // Check if server is running
    const http = require('http');

    try {
        await new Promise((resolve, reject) => {
            const req = http.get('http://localhost:3001/health', (res) => {
                if (res.statusCode === 200) {
                    resolve();
                } else {
                    reject(new Error(`Server returned status ${res.statusCode}`));
                }
            });
            req.on('error', reject);
            req.setTimeout(5000, () => {
                req.destroy();
                reject(new Error('Server health check timeout'));
            });
        });

        console.log('✅ Server is running\n');
        await testVoiceCommands();
        console.log('\n🎉 Voice command testing completed!');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('\nMake sure:');
        console.error('1. Server is running (yarn start)');
        console.error('2. .env file contains valid OPENAI_API_KEY');
        console.error('3. You have internet connection for OpenAI API');
        process.exit(1);
    }
}

main();