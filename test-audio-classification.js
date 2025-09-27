const WebSocket = require('ws');

function createMockAudioBuffer() {
    // Create a mock WAV audio buffer for testing
    const sampleRate = 16000;
    const duration = 1; // 1 second
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

    // Generate simple sine wave audio data (simulating a sound)
    for (let i = 0; i < samples; i++) {
        const amplitude = 0.3;
        const frequency = 440; // A4 note
        const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude;
        const intSample = Math.floor(sample * 32767);
        buffer.writeInt16LE(intSample, headerLength + i * 2);
    }

    return buffer;
}

function testAudioClassification() {
    console.log('Testing audio classification server...');

    const ws = new WebSocket('ws://localhost:3001');

    ws.on('open', () => {
        console.log('Connected to audio classification server');

        // Send mock audio data
        const audioBuffer = createMockAudioBuffer();
        console.log(`Sending mock audio data (${audioBuffer.length} bytes)`);
        ws.send(audioBuffer);
    });

    ws.on('message', (data) => {
        try {
            const response = JSON.parse(data.toString());
            console.log('Classification response:', response);

            if (response.classification) {
                console.log(`Sound: ${response.classification.sound}`);
                console.log(`Confidence: ${(response.classification.confidence * 100).toFixed(1)}%`);
                console.log(`Action: ${response.action}`);
            }
        } catch (error) {
            console.error('Error parsing response:', error);
        }

        ws.close();
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });

    ws.on('close', () => {
        console.log('Connection closed');
    });
}

// Run the test
testAudioClassification();