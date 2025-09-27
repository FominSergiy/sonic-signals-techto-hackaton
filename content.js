// Content script for voice command extension
(function() {
    'use strict';
  
    class VoiceCommandContent {
      constructor() {
        this.setupMessageListener();
        this.setupVisualFeedback();
      }
  
      setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
          if (message.action === 'executeCommand') {
            this.executeCommand(message.command);
            sendResponse({ success: true });
          }
          return true;
        });
      }
  
      setupVisualFeedback() {
        // Create visual feedback element
        this.feedbackElement = document.createElement('div');
        this.feedbackElement.id = 'voice-command-feedback';
        this.feedbackElement.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: rgba(0, 123, 255, 0.9);
          color: white;
          padding: 10px 15px;
          border-radius: 5px;
          font-family: Arial, sans-serif;
          font-size: 14px;
          z-index: 10000;
          display: none;
          box-shadow: 0 2px 10px rgba(0,0,0,0.3);
          transition: all 0.3s ease;
        `;
        document.body.appendChild(this.feedbackElement);
      }
  
      executeCommand(commandAction) {
        console.log('Content script executing command:', commandAction);
        
        // Show visual feedback
        this.showFeedback(this.getCommandDisplayName(commandAction));
  
        switch (commandAction) {
          case 'scroll-up':
            this.smoothScroll(0, -400);
            break;
  
          case 'scroll-down':
            this.smoothScroll(0, 400);
            break;
  
          case 'scroll-top':
            this.smoothScrollTo(0, 0);
            break;
  
          case 'scroll-bottom':
            this.smoothScrollTo(0, document.documentElement.scrollHeight);
            break;
  
          case 'scroll-page-up':
            this.smoothScroll(0, -window.innerHeight * 0.8);
            break;
  
          case 'scroll-page-down':
            this.smoothScroll(0, window.innerHeight * 0.8);
            break;
  
          case 'focus-search':
            this.focusSearchBox();
            break;
  
          case 'go-back':
            window.history.back();
            break;
  
          case 'go-forward':
            window.history.forward();
            break;
  
          case 'refresh-page':
            window.location.reload();
            break;
  
          default:
            console.warn('Unknown command in content script:', commandAction);
        }
      }
  
      smoothScroll(deltaX, deltaY) {
        window.scrollBy({
          left: deltaX,
          top: deltaY,
          behavior: 'smooth'
        });
      }
  
      smoothScrollTo(x, y) {
        window.scrollTo({
          left: x,
          top: y,
          behavior: 'smooth'
        });
      }
  
      focusSearchBox() {
        // Try to find and focus search input
        const searchSelectors = [
          'input[type="search"]',
          'input[name*="search"]',
          'input[placeholder*="search"]',
          'input[placeholder*="Search"]',
          '#search',
          '.search-input',
          '[data-testid*="search"]'
        ];
  
        for (const selector of searchSelectors) {
          const element = document.querySelector(selector);
          if (element && element.offsetParent !== null) { // visible element
            element.focus();
            element.select();
            this.showFeedback('Search box focused');
            return;
          }
        }
  
        this.showFeedback('No search box found');
      }
  
      getCommandDisplayName(action) {
        const displayNames = {
          'scroll-up': 'Scroll Up',
          'scroll-down': 'Scroll Down',
          'scroll-top': 'Scroll to Top',
          'scroll-bottom': 'Scroll to Bottom',
          'scroll-page-up': 'Page Up',
          'scroll-page-down': 'Page Down',
          'new-tab': 'New Tab',
          'close-tab': 'Close Tab',
          'next-tab': 'Next Tab',
          'prev-tab': 'Previous Tab',
          'focus-search': 'Focus Search',
          'go-back': 'Go Back',
          'go-forward': 'Go Forward',
          'refresh-page': 'Refresh Page'
        };
  
        return displayNames[action] || action;
      }
  
      showFeedback(message) {
        if (!this.feedbackElement) return;
  
        this.feedbackElement.textContent = `🎤 ${message}`;
        this.feedbackElement.style.display = 'block';
  
        // Auto-hide after 2 seconds
        clearTimeout(this.feedbackTimeout);
        this.feedbackTimeout = setTimeout(() => {
          this.feedbackElement.style.display = 'none';
        }, 2000);
      }
  
      // Add keyboard shortcut for testing
      setupKeyboardShortcuts() {
        document.addEventListener('keydown', (event) => {
          // Ctrl+Shift+V to toggle voice commands (for testing)
          if (event.ctrlKey && event.shiftKey && event.key === 'V') {
            event.preventDefault();
            chrome.runtime.sendMessage({ action: 'toggleListening' });
          }
        });
      }
    }
  
    // Initialize content script
    const voiceContent = new VoiceCommandContent();
  
    // Export for potential debugging
    window.voiceCommandContent = voiceContent;
  
  })();