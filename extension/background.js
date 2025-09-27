// Background script for voice command extension (Manifest V3 compatible)
class VoiceCommandManager {
    constructor() {
      this.isListening = false;
      this.soundCommands = [];
      this.apiEndpoint = 'ws://localhost:3001';
      this.websocket = null;
      this.activeTabId = null;

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

          case 'audioData':
            // Handle audio data from content script
            await this.processAudioData(message.data);
            sendResponse({ success: true });
            break;

          case 'microphoneReady':
            // Microphone access granted from content script
            this.isListening = true;
            this.activeTabId = sender.tab?.id;
            this.notifyStatusChange(true);
            sendResponse({ success: true });
            break;

          case 'microphoneError':
            // Microphone access failed
            this.isListening = false;
            this.notifyStatusChange(false);
            sendResponse({ success: false, error: message.error });
            break;

          case 'classificationResult':
            // Handle classification result from content script
            const result = message.result;
            if (result.classification && result.action !== 'none') {
              await this.executeCommand(result.action, result.classification);
            }
            sendResponse({ success: true });
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
        { name: 'Scroll Up', action: 'scroll-up', soundPattern: 'clap' },
        { name: 'Scroll Down', action: 'scroll-down', soundPattern: 'snap' },
        { name: 'New Tab', action: 'new-tab', soundPattern: 'double-clap' },
        { name: 'Close Tab', action: 'close-tab', soundPattern: 'double-snap' }
      ];

      await chrome.storage.local.set({
        soundCommands: defaultCommands,
        microphoneActive: false,
        apiEndpoint: 'ws://localhost:3001'
      });
    }

    async loadSettings() {
      try {
        const result = await chrome.storage.local.get([
          'soundCommands',
          'apiEndpoint',
          'microphoneActive'
        ]);

        this.soundCommands = result.soundCommands || [];
        this.apiEndpoint = result.apiEndpoint || 'ws://localhost:3001';

        console.log('Settings loaded:', {
          commandsCount: this.soundCommands.length,
          apiEndpoint: this.apiEndpoint
        });
      } catch (error) {
        console.error('Error loading settings:', error);
      }
    }

    isRestrictedUrl(url) {
      if (!url) return true;

      const restrictedProtocols = [
        'chrome://',
        'chrome-extension://',
        'moz-extension://',
        'about:',
        'edge://',
        'opera://',
        'file://'
      ];

      return restrictedProtocols.some(protocol => url.startsWith(protocol));
    }

    async startListening() {
      if (this.isListening) {
        return { success: true, message: 'Already listening' };
      }

      try {
        // Get the active tab
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!activeTab) {
          throw new Error('No active tab found');
        }

        // Check if the current tab URL is accessible
        if (this.isRestrictedUrl(activeTab.url)) {
          throw new Error('Cannot access microphone on this page. Please navigate to a regular website (not chrome://, moz-extension://, or other browser pages)');
        }

        // Inject content script to handle microphone access
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ['audio-processor.js']
        });

        // Send message to content script to start listening
        const response = await chrome.tabs.sendMessage(activeTab.id, {
          action: 'startMicrophone',
          apiEndpoint: this.apiEndpoint
        });

        if (response && response.success) {
          this.activeTabId = activeTab.id;
          console.log('Voice recognition started');
          return { success: true, message: 'Listening started' };
        } else {
          throw new Error(response?.error || 'Failed to start microphone');
        }

      } catch (error) {
        console.error('Error starting voice recognition:', error);
        return { success: false, error: error.message };
      }
    }

    async stopListening() {
      if (!this.isListening) {
        return { success: true, message: 'Not listening' };
      }

      try {
        if (this.activeTabId) {
          // Send message to content script to stop listening
          await chrome.tabs.sendMessage(this.activeTabId, {
            action: 'stopMicrophone'
          });
        }

        this.isListening = false;
        this.activeTabId = null;
        this.notifyStatusChange(false);

        console.log('Voice recognition stopped');
        return { success: true, message: 'Listening stopped' };

      } catch (error) {
        console.error('Error stopping voice recognition:', error);
        return { success: false, error: error.message };
      }
    }

    async processAudioData(audioData) {
      // Send audio data to classification server via WebSocket
      if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
        await this.connectToServer();
      }

      if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
        this.websocket.send(audioData);
      }
    }

    async connectToServer() {
      return new Promise((resolve, reject) => {
        try {
          this.websocket = new WebSocket(this.apiEndpoint);

          this.websocket.onopen = () => {
            console.log('Connected to audio classification server');
            resolve();
          };

          this.websocket.onmessage = async (event) => {
            try {
              const result = JSON.parse(event.data);
              console.log('Classification result:', result);

              if (result.classification && result.action !== 'none') {
                await this.executeCommand(result.action, result.classification);
              }
            } catch (error) {
              console.error('Error processing server response:', error);
            }
          };

          this.websocket.onerror = (error) => {
            console.error('WebSocket error:', error);
            reject(error);
          };

          this.websocket.onclose = () => {
            console.log('WebSocket connection closed');
            this.websocket = null;
          };

        } catch (error) {
          console.error('Error connecting to server:', error);
          reject(error);
        }
      });
    }

    async executeCommand(action, classification) {
      console.log('Executing command:', action, 'for sound:', classification.sound);

      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!activeTab) {
          console.error('No active tab found');
          return;
        }

        switch (action) {
          case 'scroll_up':
            await chrome.scripting.executeScript({
              target: { tabId: activeTab.id },
              function: () => window.scrollBy(0, -300)
            });
            break;

          case 'scroll_down':
            await chrome.scripting.executeScript({
              target: { tabId: activeTab.id },
              function: () => window.scrollBy(0, 300)
            });
            break;

          case 'new-tab':
            await chrome.tabs.create({});
            break;

          case 'close-tab':
            await chrome.tabs.remove(activeTab.id);
            break;

          default:
            console.warn('Unknown command action:', action);
        }
      } catch (error) {
        console.error('Error executing command:', error);
      }
    }

    async testRecognition() {
      if (!this.isListening) {
        return { success: false, error: 'Not currently listening' };
      }

      console.log('Starting 5-second recognition test...');

      if (this.activeTabId) {
        try {
          await chrome.tabs.sendMessage(this.activeTabId, {
            action: 'testMicrophone',
            duration: 5000
          });
          return { success: true, message: 'Test started' };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }

      return { success: false, error: 'No active microphone session' };
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