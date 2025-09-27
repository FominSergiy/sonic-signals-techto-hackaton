#!/bin/bash

echo "Starting Audio Classification Server..."
echo "======================================="

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    yarn install
fi

echo "Starting server on port 3001..."
echo "WebSocket endpoint: ws://localhost:3001"
echo "Test endpoint: http://localhost:3001/test"
echo "Health check: http://localhost:3001/health"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

yarn start