// WebSocket Client for Chrome Extension
// Handles persistent connection to AI Audio Recognition Service

class AudioRecognitionClient {
    constructor() {
      this.ws = null;
      this.isConnected = false;
      this.reconnectAttempts = 0;
      this.maxReconnectAttempts = 5;
      this.reconnectDelay = 1000;
      this.serverUrl = 'ws://localhost:3001';
      
      // Audio handling
      this.mediaRecorder = null;
      this.stream = null;
      this.audioChunks = [];
      this.isRecording = false;
      this.recordingInterval = null;
      
      // Command queue for offline handling
      this.commandQueue = [];
      
      // Event handlers
      this.onCommandRecognized = null;
      this.onConnectionStatusChange = null;
      this.onError = null;
    }
  
    async connect(serverUrl = null) {
      if (serverUrl) {
        this.serverUrl = serverUrl;
      }
  
      try {
        console.log(`Connecting to audio recognition service: ${this.serverUrl}`);
        
        this.ws = new WebSocket(this.serverUrl);
        
        this.ws.onopen = () => {
          console.log('Connected to audio recognition service');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          
          if (this.onConnectionStatusChange) {
            this.onConnectionStatusChange(true);
          }
          
          // Process any queued commands
          this.processCommandQueue();
        };
  
        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleServerMessage(data);
          } catch (error) {
            console.error('Error parsing server message:', error);
          }
        };
  
        this.ws.onclose = () => {
          console.log('Disconnected from audio recognition service');
          this.isConnected = false;
          
          if (this.onConnectionStatusChange) {
            this.onConnectionStatusChange(false);
          }
          
          // Attempt to reconnect
          this.attemptReconnect();
        };
  
        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          if (this.onError) {
            this.onError(error);
          }
        };
  
      } catch (error) {
        console.error('Failed to connect to audio service:', error);
        if (this.onError) {
          this.onError(error);
        }
      }
    }
  
    disconnect() {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      this.isConnected = false;
      this.stopAudioStream();
    }
  
    attemptReconnect() {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
        
        setTimeout(() => {
          this.connect();
        }, delay);
      } else {
        console.log('Max reconnection attempts reached');
        if (this.onError) {
          this.onError(new Error('Failed to reconnect to audio service'));
        }
      }
    }
  
    handleServerMessage(data) {
      switch (data.type) {
        case 'connected':
          console.log('Audio service connected:', data.message);
          break;
  
        case 'recognition_result':
          this.handleRecognitionResult(data.result);
          break;
  
        case 'training_result':
          console.log('Command training result:', data.result);
          break;
  
        case 'commands_list':
          console.log('Available commands:', data.commands);
          break;
  
        case 'command_trained':
          console.log('New command trained:', data.command);
          break;
  
        case 'error':
          console.error('Server error:', data.error);
          if (this.onError) {
            this.onError(new Error(data.error));
          }
          break;
  
        default:
          console.log('Unknown message type:', data.type);
      }
    }
  
    handleRecognitionResult(result) {
      if (result.command && result.confidence > 0.7) {
        console.log(`Command recognized: ${result.command} (confidence: ${result.confidence})`);
        
        if (this.onCommandRecognized) {
          this.onCommandRecognized({
            command: result.command,
            confidence: result.confidence,
            source: result.source || 'unknown'
          });
        }
      } else {
        console.log('No command recognized or low confidence:', result);
      }
    }
  
    async startAudioStream() {
      try {
        // Request microphone access
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 16000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
  
        // Set up MediaRecorder for continuous streaming
        this.mediaRecorder = new MediaRecorder(this.stream, {
          mimeType: 'audio/webm;codecs=opus'
        });
  
        this.audioChunks = [];
  
        this.mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            this.audioChunks.push(event.data);
          }
        };
  
        this.mediaRecorder.onstop = () => {
          if (this.audioChunks.length > 0) {
            this.processAudioChunks();
          }
        };
  
        // Start recording in chunks
        this.startChunkedRecording();
        
        console.log('Audio streaming started');
        return { success: true };
  
      } catch (error) {
        console.error('Failed to start audio stream:', error);
        return { success: false, error: error.message };
      }
    }
  
    startChunkedRecording() {
      const chunkDuration = 2000; // 2 seconds per chunk
      
      this.recordingInterval = setInterval(() => {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
          this.mediaRecorder.stop();
        }
        
        if (this.mediaRecorder && this.mediaRecorder.state === 'inactive') {
          this.audioChunks = [];
          this.mediaRecorder.start();
        }
      }, chunkDuration);
  
      // Start first recording
      if (this.mediaRecorder) {
        this.mediaRecorder.start();
        this.isRecording = true;
      }
    }
  
    stopAudioStream() {
      if (this.recordingInterval) {
        clearInterval(this.recordingInterval);
        this.recordingInterval = null;
      }
  
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        this.mediaRecorder.stop();
      }
  
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
      }
  
      this.isRecording = false;
      console.log('Audio streaming stopped');
    }
  
    async processAudioChunks() {
      if (!this.isConnected || this.audioChunks.length === 0) {
        return;
      }
  
      try {
        // Combine audio chunks
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        
        // Convert to base64 for transmission
        const arrayBuffer = await audioBlob.arrayBuffer();
        const base64Audio = this.arrayBufferToBase64(arrayBuffer);
  
        // Send to server for recognition
        this.sendMessage({
          type: 'audio_stream',
          audioData: base64Audio,
          commands: await this.getCurrentCommands()
        });
  
      } catch (error) {
        console.error('Error processing audio chunks:', error);
      }
    }
  
    async getCurrentCommands() {
      // Get current commands from Chrome storage
      try {
        const result = await chrome.storage.local.get(['soundCommands']);
        return result.soundCommands || [];
      } catch (error) {
        console.error('Error getting commands:', error);
        return [];
      }
    }
  
    sendMessage(message) {
      if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(message));
      } else {
        // Queue message for when connection is restored
        this.commandQueue.push(message);
      }
    }
  
    processCommandQueue() {
      while (this.commandQueue.length > 0 && this.isConnected) {
        const message = this.commandQueue.shift();
        this.sendMessage(message);
      }
    }
  
    async trainCommand(audioBlob, commandName, action, description) {
      try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const base64Audio = this.arrayBufferToBase64(arrayBuffer);
  
        this.sendMessage({
          type: 'train_command',
          audioData: base64Audio,
          commandName: commandName,
          action: action,
          description: description
        });
  
        return { success: true };
      } catch (error) {
        console.error('Error training command:', error);
        return { success: false, error: error.message };
      }
    }
  
    getAvailableCommands() {
      this.sendMessage({
        type: 'get_commands'
      });
    }
  
    arrayBufferToBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }
  
    base64ToArrayBuffer(base64) {
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    }
  
    // Test connection to server
    async testConnection() {
      try {
        const response = await fetch('http://localhost:3001/health');
        if (response.ok) {
          const data = await response.json();
          return { success: true, data };
        } else {
          return { success: false, error: 'Server not responding' };
        }
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  
    // Get connection status
    getConnectionStatus() {
      return {
        connected: this.isConnected,
        recording: this.isRecording,
        reconnectAttempts: this.reconnectAttempts
      };
    }
  }
  
  // Export for use in Chrome extension
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AudioRecognitionClient;
  } else {
    window.AudioRecognitionClient = AudioRecognitionClient;
  }