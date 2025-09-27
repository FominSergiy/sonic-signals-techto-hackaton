// Content script for handling microphone access (Manifest V3 compatible)
(function() {
  let isListening = false;
  let audioContext = null;
  let mediaRecorder = null;
  let stream = null;
  let websocket = null;
  let audioBuffer = [];

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender, sendResponse);
    return true; // Keep message channel open for async response
  });

  async function handleMessage(message, sender, sendResponse) {
    try {
      switch (message.action) {
        case 'startMicrophone':
          const startResult = await startMicrophone(message.apiEndpoint);
          sendResponse(startResult);
          break;

        case 'stopMicrophone':
          const stopResult = await stopMicrophone();
          sendResponse(stopResult);
          break;

        case 'testMicrophone':
          const testResult = await testMicrophone(message.duration);
          sendResponse(testResult);
          break;

        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async function startMicrophone(apiEndpoint) {
    if (isListening) {
      return { success: true, message: 'Already listening' };
    }

    try {
      // Request microphone permission
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      // Set up audio context
      audioContext = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(stream);

      // Set up audio processing
      setupAudioProcessing(source, apiEndpoint);

      isListening = true;

      // Notify background script
      chrome.runtime.sendMessage({
        action: 'microphoneReady'
      });

      console.log('Microphone access granted and audio processing started');
      return { success: true, message: 'Microphone started' };

    } catch (error) {
      console.error('Error starting microphone:', error);
      await cleanup();

      // Notify background script of error
      chrome.runtime.sendMessage({
        action: 'microphoneError',
        error: error.message
      });

      return { success: false, error: error.message };
    }
  }

  function setupAudioProcessing(source, apiEndpoint) {
    // Create a script processor for audio analysis
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (event) => {
      if (!isListening) return;

      const inputData = event.inputBuffer.getChannelData(0);
      processAudioChunk(inputData, apiEndpoint);
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    window.audioProcessor = processor;
  }

  function processAudioChunk(audioData, apiEndpoint) {
    // Add to buffer
    audioBuffer.push(new Float32Array(audioData));

    // Process buffer every 2 seconds worth of audio
    const bufferDuration = audioBuffer.length * 4096 / 16000; // seconds
    if (bufferDuration >= 2.0) {
      sendAudioToServer(apiEndpoint);
      audioBuffer = []; // Clear buffer
    }
  }

  async function sendAudioToServer(apiEndpoint) {
    if (audioBuffer.length === 0) return;

    try {
      // Combine audio chunks
      const totalLength = audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
      const combinedAudio = new Float32Array(totalLength);

      let offset = 0;
      for (const chunk of audioBuffer) {
        combinedAudio.set(chunk, offset);
        offset += chunk.length;
      }

      // Convert to WAV format
      const audioBlob = audioDataToWav(combinedAudio, 16000);

      // Connect to WebSocket if not connected
      if (!websocket || websocket.readyState !== WebSocket.OPEN) {
        await connectToServer(apiEndpoint);
      }

      // Send audio data
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(audioBlob);
      }

    } catch (error) {
      console.error('Error sending audio to server:', error);
    }
  }

  async function connectToServer(apiEndpoint) {
    return new Promise((resolve, reject) => {
      try {
        websocket = new WebSocket(apiEndpoint);

        websocket.onopen = () => {
          console.log('Connected to audio classification server');
          resolve();
        };

        websocket.onmessage = (event) => {
          try {
            const result = JSON.parse(event.data);
            console.log('Audio classification result:', result);

            // Forward result to background script
            chrome.runtime.sendMessage({
              action: 'classificationResult',
              result: result
            });

          } catch (error) {
            console.error('Error processing server response:', error);
          }
        };

        websocket.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };

        websocket.onclose = () => {
          console.log('WebSocket connection closed');
          websocket = null;
        };

      } catch (error) {
        console.error('Error connecting to server:', error);
        reject(error);
      }
    });
  }

  async function stopMicrophone() {
    if (!isListening) {
      return { success: true, message: 'Not listening' };
    }

    await cleanup();
    return { success: true, message: 'Microphone stopped' };
  }

  async function testMicrophone(duration = 5000) {
    if (!isListening) {
      return { success: false, error: 'Microphone not active' };
    }

    console.log(`Starting ${duration}ms microphone test...`);

    // Collect audio for test duration
    const testBuffer = [];
    const originalProcessing = processAudioChunk;

    processAudioChunk = (audioData) => {
      testBuffer.push(new Float32Array(audioData));
    };

    setTimeout(() => {
      processAudioChunk = originalProcessing;

      if (testBuffer.length > 0) {
        console.log(`Test collected ${testBuffer.length} audio chunks`);

        // Combine and analyze test audio
        const totalLength = testBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
        const combinedAudio = new Float32Array(totalLength);

        let offset = 0;
        for (const chunk of testBuffer) {
          combinedAudio.set(chunk, offset);
          offset += chunk.length;
        }

        // Basic analysis
        const avgAmplitude = combinedAudio.reduce((sum, val) => sum + Math.abs(val), 0) / combinedAudio.length;
        const maxAmplitude = Math.max(...combinedAudio.map(Math.abs));

        console.log('Test results:', {
          duration: duration,
          avgAmplitude,
          maxAmplitude,
          hasActivity: avgAmplitude > 0.01
        });
      }
    }, duration);

    return { success: true, message: 'Test started' };
  }

  async function cleanup() {
    isListening = false;

    if (window.audioProcessor) {
      window.audioProcessor.disconnect();
      window.audioProcessor = null;
    }

    if (audioContext) {
      await audioContext.close();
      audioContext = null;
    }

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }

    if (websocket) {
      websocket.close();
      websocket = null;
    }

    audioBuffer = [];
  }

  function audioDataToWav(audioData, sampleRate) {
    const buffer = new ArrayBuffer(44 + audioData.length * 2);
    const view = new DataView(buffer);

    // WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + audioData.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, audioData.length * 2, true);

    // Convert float32 to int16
    let offset = 44;
    for (let i = 0; i < audioData.length; i++) {
      const sample = Math.max(-1, Math.min(1, audioData[i]));
      view.setInt16(offset, sample * 0x7FFF, true);
      offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  // Handle page unload
  window.addEventListener('beforeunload', cleanup);

})();