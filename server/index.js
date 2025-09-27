const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Simple audio classification mock (replace with actual YAMNet implementation)
function classifyAudio(audioBuffer) {
    // This is a mock implementation for demonstration
    // In a real implementation, this would use YAMNet or similar model
    const random = Math.random();

    if (random > 0.7) {
        return { sound: 'clap', confidence: 0.85 };
    } else if (random > 0.4) {
        return { sound: 'snap', confidence: 0.78 };
    } else {
        return { sound: 'unknown', confidence: 0.3 };
    }
}

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('New WebSocket connection established');

    ws.on('message', (data) => {
        try {
            console.log('Received audio data:', data.length, 'bytes');

            // Mock classification
            const result = classifyAudio(data);

            // Send back JSON response
            const response = {
                timestamp: new Date().toISOString(),
                classification: result,
                action: result.sound === 'clap' ? 'scroll_up' :
                       result.sound === 'snap' ? 'scroll_down' : 'none'
            };

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
server.listen(PORT, () => {
    console.log(`Audio classification server running on port ${PORT}`);
    console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
    console.log(`Test endpoint: http://localhost:${PORT}/test`);
});

module.exports = { app, server };