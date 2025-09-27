document.addEventListener('DOMContentLoaded', async function() {
    const commandsContainer = document.getElementById('commandsContainer');
    const addCommandBtn = document.getElementById('addCommandBtn');
    const saveBtn = document.getElementById('saveBtn');
    const resetBtn = document.getElementById('resetBtn');
    const exportBtn = document.getElementById('exportBtn');
    const importBtn = document.getElementById('importBtn');
    const importFile = document.getElementById('importFile');
    const testApiBtn = document.getElementById('testApiBtn');
    const apiEndpoint = document.getElementById('apiEndpoint');
    const apiKey = document.getElementById('apiKey');
    const statusMessage = document.getElementById('statusMessage');
    const apiStatus = document.getElementById('apiStatus');
  
    let commands = [];
    let recordingButton = null;
    let mediaRecorder = null;
    let recordedChunks = [];
  
    // Available actions
    const availableActions = [
      { value: 'scroll-up', text: 'Scroll Up' },
      { value: 'scroll-down', text: 'Scroll Down' },
      { value: 'scroll-top', text: 'Scroll to Top' },
      { value: 'scroll-bottom', text: 'Scroll to Bottom' },
      { value: 'new-tab', text: 'Open New Tab' },
      { value: 'close-tab', text: 'Close Current Tab' },
      { value: 'next-tab', text: 'Switch to Next Tab' },
      { value: 'prev-tab', text: 'Switch to Previous Tab' }
    ];
  
    // Load existing settings
    await loadSettings();
  
    // Event listeners
    addCommandBtn.addEventListener('click', addNewCommand);
    saveBtn.addEventListener('click', saveSettings);
    resetBtn.addEventListener('click', resetToDefaults);
    exportBtn.addEventListener('click', exportConfig);
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', importConfig);
    testApiBtn.addEventListener('click', testApiConnection);
  
    async function loadSettings() {
      try {
        const result = await chrome.storage.local.get(['soundCommands', 'apiEndpoint', 'apiKey']);
        
        commands = result.soundCommands || getDefaultCommands();
        apiEndpoint.value = result.apiEndpoint || '';
        apiKey.value = result.apiKey || '';
        
        renderCommands();
      } catch (error) {
        showStatus('Error loading settings: ' + error.message, 'error');
      }
    }
  
    function renderCommands() {
      commandsContainer.innerHTML = '';
      
      commands.forEach((command, index) => {
        const commandRow = createCommandRow(command, index);
        commandsContainer.appendChild(commandRow);
      });
    }
  
    function createCommandRow(command, index) {
      const row = document.createElement('div');
      row.className = 'command-row';
      
      row.innerHTML = `
        <div class="input-group">
          <label>Command Name</label>
          <input type="text" value="${command.name}" data-field="name" data-index="${index}" />
        </div>
        
        <div class="input-group">
          <label>Action</label>
          <select data-field="action" data-index="${index}">
            ${availableActions.map(action => 
              `<option value="${action.value}" ${action.value === command.action ? 'selected' : ''}>${action.text}</option>`
            ).join('')}
          </select>
        </div>
        
        <div class="input-group">
          <label>Sound Pattern</label>
          <div style="display: flex; gap: 5px;">
            <input type="text" value="${command.soundPattern || ''}" data-field="soundPattern" data-index="${index}" placeholder="Describe the sound" />
            <button class="record-button" data-index="${index}">🎤 Record</button>
          </div>
        </div>
        
        <div>
          <button class="button btn-danger" data-action="delete" data-index="${index}">Delete</button>
        </div>
      `;
  
      // Add event listeners
      const inputs = row.querySelectorAll('input, select');
      inputs.forEach(input => {
        input.addEventListener('change', updateCommand);
      });
  
      const deleteBtn = row.querySelector('[data-action="delete"]');
      deleteBtn.addEventListener('click', deleteCommand);
  
      const recordBtn = row.querySelector('.record-button');
      recordBtn.addEventListener('click', startRecording);
  
      return row;
    }
  
    function updateCommand(event) {
      const index = parseInt(event.target.dataset.index);
      const field = event.target.dataset.field;
      const value = event.target.value;
      
      if (commands[index]) {
        commands[index][field] = value;
      }
    }
  
    function deleteCommand(event) {
      const index = parseInt(event.target.dataset.index);
      commands.splice(index, 1);
      renderCommands();
    }
  
    function addNewCommand() {
      const newCommand = {
        name: `Command ${commands.length + 1}`,
        action: 'scroll-up',
        soundPattern: ''
      };
      
      commands.push(newCommand);
      renderCommands();
    }
  
    async function startRecording(event) {
      const button = event.target;
      const index = parseInt(button.dataset.index);
      
      if (recordingButton && recordingButton !== button) {
        // Stop any existing recording
        stopRecording();
      }
      
      if (button.classList.contains('recording')) {
        stopRecording();
        return;
      }
      
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        recordingButton = button;
        
        mediaRecorder.ondataavailable = event => {
          if (event.data.size > 0) {
            recordedChunks.push(event.data);
          }
        };
        
        mediaRecorder.onstop = () => {
          const audioBlob = new Blob(recordedChunks, { type: 'audio/wav' });
          processRecordedAudio(audioBlob, index);
          
          // Clean up
          stream.getTracks().forEach(track => track.stop());
          recordingButton.classList.remove('recording');
          recordingButton.textContent = '🎤 Record';
          recordingButton = null;
        };
        
        mediaRecorder.start();
        button.classList.add('recording');
        button.textContent = '⏹️ Stop';
        
        // Auto-stop after 5 seconds
        setTimeout(() => {
          if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
          }
        }, 5000);
        
      } catch (error) {
        showStatus('Error accessing microphone: ' + error.message, 'error');
      }
    }
  
    function stopRecording() {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    }
  
    async function processRecordedAudio(audioBlob, commandIndex) {
      // Convert audio to base64 for API transmission
      const reader = new FileReader();
      reader.onload = async function() {
        const base64Audio = reader.result.split(',')[1];
        
        // Store the audio pattern for this command
        if (commands[commandIndex]) {
          commands[commandIndex].audioData = base64Audio;
          commands[commandIndex].soundPattern = `Recorded audio (${Math.round(audioBlob.size / 1024)}KB)`;
          
          // Update the UI
          const patternInput = document.querySelector(`[data-field="soundPattern"][data-index="${commandIndex}"]`);
          if (patternInput) {
            patternInput.value = commands[commandIndex].soundPattern;
          }
          
          showStatus('Audio recorded successfully!', 'success');
        }
      };
      reader.readAsDataURL(audioBlob);
    }
  
    async function testApiConnection() {
      const endpoint = apiEndpoint.value.trim();
      const key = apiKey.value.trim();
      
      if (!endpoint) {
        showApiStatus('Please enter an API endpoint', 'error');
        return;
      }
      
      try {
        const response = await fetch(endpoint + '/test', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': key ? `Bearer ${key}` : ''
          },
          body: JSON.stringify({ test: true })
        });
        
        if (response.ok) {
          showApiStatus('API connection successful!', 'success');
        } else {
          showApiStatus(`API error: ${response.status} ${response.statusText}`, 'error');
        }
      } catch (error) {
        showApiStatus('Connection failed: ' + error.message, 'error');
      }
    }
  
    async function saveSettings() {
      try {
        await chrome.storage.local.set({
          soundCommands: commands,
          apiEndpoint: apiEndpoint.value.trim(),
          apiKey: apiKey.value.trim()
        });
        
        // Notify background script of changes
        chrome.runtime.sendMessage({
          action: 'settingsUpdated'
        });
        
        showStatus('Settings saved successfully!', 'success');
      } catch (error) {
        showStatus('Error saving settings: ' + error.message, 'error');
      }
    }
  
    function resetToDefaults() {
      if (confirm('Are you sure you want to reset all settings to defaults?')) {
        commands = getDefaultCommands();
        apiEndpoint.value = '';
        apiKey.value = '';
        renderCommands();
        showStatus('Settings reset to defaults', 'success');
      }
    }
  
    function exportConfig() {
      const config = {
        soundCommands: commands,
        apiEndpoint: apiEndpoint.value,
        apiKey: apiKey.value
      };
      
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = 'voice-commands-config.json';
      a.click();
      
      URL.revokeObjectURL(url);
      showStatus('Configuration exported successfully!', 'success');
    }
  
    function importConfig(event) {
      const file = event.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const config = JSON.parse(e.target.result);
          
          if (config.soundCommands) {
            commands = config.soundCommands;
          }
          if (config.apiEndpoint) {
            apiEndpoint.value = config.apiEndpoint;
          }
          if (config.apiKey) {
            apiKey.value = config.apiKey;
          }
          
          renderCommands();
          showStatus('Configuration imported successfully!', 'success');
        } catch (error) {
          showStatus('Error importing configuration: ' + error.message, 'error');
        }
      };
      reader.readAsText(file);
    }
  
    function getDefaultCommands() {
      return [
        { name: 'Scroll Up', action: 'scroll-up', soundPattern: 'Short whistle up' },
        { name: 'Scroll Down', action: 'scroll-down', soundPattern: 'Short whistle down' },
        { name: 'New Tab', action: 'new-tab', soundPattern: 'Finger snap' },
        { name: 'Close Tab', action: 'close-tab', soundPattern: 'Hand clap' },
        { name: 'Scroll to Top', action: 'scroll-top', soundPattern: 'High pitched whistle' },
        { name: 'Scroll to Bottom', action: 'scroll-bottom', soundPattern: 'Low pitched whistle' }
      ];
    }
  
    function showStatus(message, type) {
      statusMessage.className = `status-message status-${type}`;
      statusMessage.textContent = message;
      statusMessage.style.display = 'block';
      
      setTimeout(() => {
        statusMessage.style.display = 'none';
      }, 3000);
    }
  
    function showApiStatus(message, type) {
      apiStatus.className = `status-message status-${type}`;
      apiStatus.textContent = message;
      apiStatus.style.display = 'block';
      
      setTimeout(() => {
        apiStatus.style.display = 'none';
      }, 3000);
    }
  });