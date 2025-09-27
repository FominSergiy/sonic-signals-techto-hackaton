document.addEventListener('DOMContentLoaded', async function() {
    const micToggle = document.getElementById('micToggle');
    const status = document.getElementById('status');
    const optionsBtn = document.getElementById('optionsBtn');
    const testBtn = document.getElementById('testBtn');
    const commandsList = document.getElementById('commandsList');
  
    // Load current state
    await loadCurrentState();
    await loadCommands();
  
    // Toggle microphone access
    micToggle.addEventListener('change', async function() {
      const isEnabled = micToggle.checked;
      
      try {
        if (isEnabled) {
          // Request microphone permission and start listening
          const response = await chrome.runtime.sendMessage({
            action: 'startListening'
          });
          
          if (response.success) {
            updateStatus(true);
            await chrome.storage.local.set({ microphoneActive: true });
          } else {
            micToggle.checked = false;
            alert('Failed to start microphone: ' + response.error);
          }
        } else {
          // Stop listening
          await chrome.runtime.sendMessage({
            action: 'stopListening'
          });
          updateStatus(false);
          await chrome.storage.local.set({ microphoneActive: false });
        }
      } catch (error) {
        console.error('Error toggling microphone:', error);
        micToggle.checked = false;
        alert('Error: ' + error.message);
      }
    });
  
    // Open options page
    optionsBtn.addEventListener('click', function() {
      chrome.runtime.openOptionsPage();
    });
  
    // Test recognition
    testBtn.addEventListener('click', async function() {
      if (!micToggle.checked) {
        alert('Please enable microphone access first');
        return;
      }
      
      testBtn.textContent = 'Listening... (5s)';
      testBtn.disabled = true;
      
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'testRecognition'
        });
        
        setTimeout(() => {
          testBtn.textContent = 'Test Recognition';
          testBtn.disabled = false;
          
          if (response.success) {
            alert('Test completed. Check console for results.');
          } else {
            alert('Test failed: ' + response.error);
          }
        }, 5000);
      } catch (error) {
        testBtn.textContent = 'Test Recognition';
        testBtn.disabled = false;
        alert('Test error: ' + error.message);
      }
    });
  
    async function loadCurrentState() {
      try {
        const result = await chrome.storage.local.get(['microphoneActive']);
        const isActive = result.microphoneActive || false;
        micToggle.checked = isActive;
        updateStatus(isActive);
      } catch (error) {
        console.error('Error loading state:', error);
      }
    }
  
    async function loadCommands() {
      try {
        const result = await chrome.storage.local.get(['soundCommands']);
        const commands = result.soundCommands || getDefaultCommands();
        
        const commandsHtml = commands.map(cmd => 
          `<div class="command-item">"${cmd.name}" → ${cmd.action}</div>`
        ).join('');
        
        commandsList.innerHTML = commandsHtml || '<div class="command-item">No commands configured</div>';
      } catch (error) {
        console.error('Error loading commands:', error);
        commandsList.innerHTML = '<div class="command-item">Error loading commands</div>';
      }
    }
  
    function updateStatus(isActive) {
      if (isActive) {
        status.className = 'status active';
        status.textContent = 'Microphone Active - Listening for commands';
      } else {
        status.className = 'status inactive';
        status.textContent = 'Microphone Inactive';
      }
    }
  
    function getDefaultCommands() {
      return [
        { name: 'scroll up', action: 'Scroll Up', soundPattern: 'whistle-up' },
        { name: 'scroll down', action: 'Scroll Down', soundPattern: 'whistle-down' },
        { name: 'new tab', action: 'New Tab', soundPattern: 'snap' },
        { name: 'close tab', action: 'Close Tab', soundPattern: 'clap' },
        { name: 'scroll to top', action: 'Scroll to Top', soundPattern: 'whistle-high' },
        { name: 'scroll to bottom', action: 'Scroll to Bottom', soundPattern: 'whistle-low' }
      ];
    }
  
    // Listen for status updates from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'statusUpdate') {
        updateStatus(message.isActive);
        micToggle.checked = message.isActive;
      }
    });
  });