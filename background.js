// Background script for voice command extension
class VoiceCommandManager {
    constructor() {
      this.isListening = false;
      this.audioContext = null;
      this.mediaRecorder = null;
      this.stream = null;
      this.soundCommands = [];
      this.apiEndpoint = '';
      this.apiKey = '';
      this.recognitionBuffer = [];
      this.lastProcessTime = 0;
      this.processingInterval = 2000; // Process every 2 seconds
      
      this.setupMessageHandlers();
      this.loadSettings();
    }
  
    setupMessageHandlers() {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        this.handleMessage(message, sender, sendResponse);
        return true; // Keep message channel open for async response
      });
  
      chrome.runtime.onStartup.addListener(() => {
        this.loadSettings();
      });
  
      chrome.runtime.onInstalled.addListener(() => {
        this.initializeDefaultSettings();
      });
    }
  
    async handleMessage(message, sender, sendResponse) {
      try {
        switch (message.action) {
          case 'startListening':
            const startResult = await this.startListening();
            sendResponse(startResult);
            break;
  
          case 'stopListening':
            const stopResult = await this.stopListening();
            sendResponse(stopResult);
            break;
  
          case 'testRecognition':
            const testResult = await this.testRecognition();
            sendResponse(testResult);
            break;
  
          case 'settingsUpdated':
            await this.loadSettings();
            sendResponse({ success: true });
            break;
  
          default:
            sendResponse({ success: false, error: 'Unknown action' });
        }
      } catch (error) {
        console.error('Error handling message:', error);
        sendResponse({ success: false, error: error.message });
      }
    }
  
    async initializeDefaultSettings() {
      const defaultCommands = [
        { name: 'Scroll Up', action: 'scroll-up', soundPattern: 'Short whistle up' },
        { name: 'Scroll Down', action: 'scroll-down', soundPattern: 'Short whistle down' },
        { name: 'New Tab', action: 'new-tab', soundPattern: 'Finger snap' },
        { name: 'Close Tab', action: 'close-tab', soundPattern: 'Hand clap' },
        { name: 'Scroll to Top', action: 'scroll-top', soundPattern: 'High pitched whistle' },
        { name: 'Scroll to Bottom', action: 'scroll-bottom', soundPattern: 'Low pitched whistle' }
      ];
  
      await chrome.storage.local.set({
        soundCommands: defaultCommands,
        microphoneActive: false,
        apiEndpoint: '',
        apiKey: ''
      });
    }
  
    async loadSettings() {
      try {
        const result = await chrome.storage.local.get([
          'soundCommands', 
          'apiEndpoint', 
          'apiKey',
          'microphoneActive'
        ]);
  
        this.soundCommands = result.soundCommands || [];
        this.apiEndpoint = result.apiEndpoint || '';
        this.apiKey = result.apiKey || '';
        
        // Restore listening state if it was active
        if (result.microphoneActive && !this.isListening) {
          this.startListening();
        }
  
        console.log('Settings loaded:', {
          commandsCount: this.soundCommands.length,
          hasApiEndpoint: !!this.apiEndpoint,
          hasApiKey: !!this.apiKey
        });
      } catch (error) {
        console.error('Error loading settings:', error);
      }
    }
  
    async startListening() {
      if (this.isListening) {
        return { success: true, message: 'Already listening' };
      }
  
      try {
        // Get microphone access
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 16000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true
          }
        });
  
        // Set up audio context for processing
        this.audioContext = new AudioContext({ sampleRate: 16000 });
        const source = this.audioContext.createMediaStreamSource(this.stream);
        
        // Set up audio worklet for real-time processing
        await this.setupAudioProcessing(source);
  
        this.isListening = true;
        
        // Notify popup of status change
        this.notifyStatusChange(true);
  
        console.log('Voice recognition started');
        return { success: true, message: 'Listening started' };
  
      } catch (error) {
        console.error('Error starting voice recognition:', error);
        await this.cleanup();
        return { success: false, error: error.message };
      }
    }
  
    async setupAudioProcessing(source) {
      // Create a script processor for audio analysis
      const processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      processor.onaudioprocess = (event) => {
        if (!this.isListening) return;
        
        const inputData = event.inputBuffer.getChannelData(0);
        this.processAudioChunk(inputData);
      };
  
      source.connect(processor);
      processor.connect(this.audioContext.destination);
      
      this.audioProcessor = processor;
    }
  
    processAudioChunk(audioData) {
      // Add to buffer for processing
      this.recognitionBuffer.push(new Float32Array(audioData));
      
      // Process buffer every few seconds
      const now = Date.now();
      if (now - this.lastProcessTime > this.processingInterval) {
        this.processRecognitionBuffer();
        this.lastProcessTime = now;
      }
    }
  
    async processRecognitionBuffer() {
      if (this.recognitionBuffer.length === 0) return;
  
      try {
        // Concatenate audio chunks
        const totalLength = this.recognitionBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
        const combinedAudio = new Float32Array(totalLength);
        
        let offset = 0;
        for (const chunk of this.recognitionBuffer) {
          combinedAudio.set(chunk, offset);
          offset += chunk.length;
        }
  
        // Convert to WAV format for API
        const audioBlob = this.audioDataToWav(combinedAudio, 16000);
        
        // Send to recognition API
        const recognition = await this.recognizeAudio(audioBlob);
        
        if (recognition && recognition.command) {
          await this.executeCommand(recognition.command);
        }
  
        // Clear buffer
        this.recognitionBuffer = [];
  
      } catch (error) {
        console.error('Error processing audio buffer:', error);
      }
    }
  
    async recognizeAudio(audioBlob) {
      if (!this.apiEndpoint) {
        // Fallback: simple pattern matching based on audio characteristics
        return this.basicAudioAnalysis(audioBlob);
      }
  
      try {
        const formData = new FormData();
        formData.append('audio', audioBlob, 'audio.wav');
        formData.append('commands', JSON.stringify(this.soundCommands));
  
        const response = await fetch(this.apiEndpoint + '/recognize', {
          method: 'POST',
          headers: {
            'Authorization': this.apiKey ? `Bearer ${this.apiKey}` : ''
          },
          body: formData
        });
  
        if (response.ok) {
          const result = await response.json();
          return result;
        } else {
          console.error('API recognition failed:', response.status, response.statusText);
          return null;
        }
      } catch (error) {
        console.error('Error calling recognition API:', error);
        return null;
      }
    }
  
    basicAudioAnalysis(audioBlob) {
      // Simple fallback analysis based on audio characteristics
      // This is a placeholder - in a real implementation, you'd use more sophisticated analysis
      
      const audioSize = audioBlob.size;
      const timestamp = Date.now();
      
      // Very basic pattern detection based on audio length and timing
      if (audioSize > 10000 && audioSize < 50000) {
        // Might be a short command like snap or clap
        const commands = this.soundCommands.filter(cmd => 
          cmd.soundPattern.toLowerCase().includes('snap') || 
          cmd.soundPattern.toLowerCase().includes('clap')
        );
        
        if (commands.length > 0) {
          return { command: commands[0].action, confidence: 0.5 };
        }
      }
      
      return null;
    }
  
    async executeCommand(commandAction) {
      console.log('Executing command:', commandAction);
  
      try {
        // Get the active tab
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!activeTab) {
          console.error('No active tab found');
          return;
        }
  
        switch (commandAction) {
          case 'scroll-up':
          case 'scroll-down':
          case 'scroll-top':
          case 'scroll-bottom':
            await chrome.scripting.executeScript({
              target: { tabId: activeTab.id },
              function: this.scrollPage,
              args: [commandAction]
            });
            break;
  
          case 'new-tab':
            await chrome.tabs.create({});
            break;
  
          case 'close-tab':
            await chrome.tabs.remove(activeTab.id);
            break;
  
          case 'next-tab':
            const nextIndex = (activeTab.index + 1) % (await chrome.tabs.query({ currentWindow: true })).length;
            const nextTab = (await chrome.tabs.query({ currentWindow: true, index: nextIndex }))[0];
            if (nextTab) await chrome.tabs.update(nextTab.id, { active: true });
            break;
  
          case 'prev-tab':
            const tabs = await chrome.tabs.query({ currentWindow: true });
            const prevIndex = activeTab.index === 0 ? tabs.length - 1 : activeTab.index - 1;
            const prevTab = tabs[prevIndex];
            if (prevTab) await chrome.tabs.update(prevTab.id, { active: true });
            break;
  
          default:
            console.warn('Unknown command action:', commandAction);
        }
      } catch (error) {
        console.error('Error executing command:', error);
      }
    }
  
    // This function will be injected into the page
    scrollPage(action) {
      const scrollAmount = 300;
      
      switch (action) {
        case 'scroll-up':
          window.scrollBy(0, -scrollAmount);
          break;
        case 'scroll-down':
          window.scrollBy(0, scrollAmount);
          break;
        case 'scroll-top':
          window.scrollTo(0, 0);
          break;
        case 'scroll-bottom':
          window.scrollTo(0, document.body.scrollHeight);
          break;
      }
    }
  
    async stopListening() {
      if (!this.isListening) {
        return { success: true, message: 'Not listening' };
      }
  
      await this.cleanup();
      this.notifyStatusChange(false);
      
      console.log('Voice recognition stopped');
      return { success: true, message: 'Listening stopped' };
    }
  
    async cleanup() {
      this.isListening = false;
  
      if (this.audioProcessor) {
        this.audioProcessor.disconnect();
        this.audioProcessor = null;
      }
  
      if (this.audioContext) {
        await this.audioContext.close();
        this.audioContext = null;
      }
  
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
      }
  
      this.recognitionBuffer = [];
    }
  
    async testRecognition() {
      if (!this.isListening) {
        return { success: false, error: 'Not currently listening' };
      }
  
      console.log('Starting 5-second recognition test...');
      
      // Record for 5 seconds and log what we detect
      const testBuffer = [];
      const originalProcessor = this.processAudioChunk;
      
      this.processAudioChunk = (audioData) => {
        testBuffer.push(new Float32Array(audioData));
      };
  
      setTimeout(async () => {
        this.processAudioChunk = originalProcessor;
        
        if (testBuffer.length > 0) {
          console.log(`Test recorded ${testBuffer.length} audio chunks`);
          // Process the test audio
          const totalLength = testBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
          const combinedAudio = new Float32Array(totalLength);
          
          let offset = 0;
          for (const chunk of testBuffer) {
            combinedAudio.set(chunk, offset);
            offset += chunk.length;
          }
  
          const audioBlob = this.audioDataToWav(combinedAudio, 16000);
          const recognition = await this.recognizeAudio(audioBlob);
          
          console.log('Test recognition result:', recognition);
        }
      }, 5000);
  
      return { success: true, message: 'Test started' };
    }
  
    audioDataToWav(audioData, sampleRate) {
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
  
    notifyStatusChange(isActive) {
      // Notify popup and other parts of the extension
      chrome.runtime.sendMessage({
        action: 'statusUpdate',
        isActive: isActive
      }).catch(() => {
        // Popup might not be open, that's fine
      });
    }
  }
  
  // Initialize the voice command manager
  const voiceManager = new VoiceCommandManager();