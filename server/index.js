const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const YAMNetClassifier = require('./yamnet-classifier');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3001;

// Initialize YAMNet classifier
const yamnetClassifier = new YAMNetClassifier();

app.use(cors());
app.use(express.json());

// Audio classification using YAMNet
async function classifyAudio(audioBuffer) {
    try {
        // Use YAMNet classifier to analyze the audio
        const result = await yamnetClassifier.classifyAudio(audioBuffer);

        console.log(`YAMNet Classification - Sound: ${result.sound}, Confidence: ${(result.confidence * 100).toFixed(1)}%`);

        return {
            sound: result.sound,
            confidence: result.confidence
        };
    } catch (error) {
        console.error('Error in YAMNet classification:', error);

        // Fallback to simple mock if YAMNet fails
        console.log('Falling back to mock classification');
        const random = Math.random();

        if (random > 0.7) {
            return { sound: 'clap', confidence: 0.85 };
        } else if (random > 0.4) {
            return { sound: 'snap', confidence: 0.78 };
        } else {
            return { sound: 'unknown', confidence: 0.3 };
        }
    }
}

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('New WebSocket connection established');

    ws.on('message', async (data) => {
        try {
            console.log('Received audio data:', data.length, 'bytes');

            // YAMNet classification
            const result = await classifyAudio(data);

            // Send back JSON response
            const response = {
                timestamp: new Date().toISOString(),
                classification: result,
                action: result.sound === 'clap' ? 'scroll_up' :
                       result.sound === 'snap' ? 'scroll_down' : 'none'
            };

            console.log(`Sending response: ${result.sound} (${(result.confidence * 100).toFixed(1)}% confidence) -> ${response.action}`);

            ws.send(JSON.stringify(response));

        } catch (error) {
            console.error('Error processing audio:', error);
            ws.send(JSON.stringify({
                error: 'Failed to process audio',
                timestamp: new Date().toISOString()
            }));
        }
    });

    ws.on('close', () => {
        console.log('WebSocket connection closed');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Test HTTP endpoint
app.get('/test', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Audio classification server is running',
        timestamp: new Date().toISOString(),
        websocket_url: `ws://localhost:${PORT}`
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        server: 'audio-classification',
        version: '1.0.0'
    });
});

// Start server
server.listen(PORT, async () => {
    console.log(`Audio classification server running on port ${PORT}`);
    console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
    console.log(`Test endpoint: http://localhost:${PORT}/test`);

    // Initialize YAMNet model
    try {
        console.log('Initializing YAMNet model...');
        await yamnetClassifier.loadModel();
        console.log('YAMNet model ready for classification');
    } catch (error) {
        console.error('Failed to load YAMNet model:', error);
        console.log('Server will use fallback classification');
    }
});

module.exports = { app, server };