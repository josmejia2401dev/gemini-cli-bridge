const { chromium } = require('playwright');
const fs = require('fs');

class GeminiClient {
  constructor(sessionDir, chatUrlFile) {
    this.sessionDir = sessionDir;
    this.chatUrlFile = chatUrlFile;
    this.context = null;
    this.page = null;
  }

  async init(targetUrl) {
    this.context = await chromium.launchPersistentContext(this.sessionDir, {
      headless: false,
      channel: 'chrome',
      viewport: null,
      args: ['--disable-blink-features=AutomationControlled']
    });
    this.page = this.context.pages().length > 0 ? this.context.pages()[0] : await this.context.newPage();
    await this.page.goto(targetUrl);
    if (this.page.url().includes('accounts.google.com')) {
      console.log('📌 Por favor, inicia sesión en Google en la ventana del navegador.');
      await this.page.waitForURL('**/gemini.google.com/app**', { timeout: 0 });
      console.log('✅ Sesión iniciada correctamente.');
    }
  }

  async sendPrompt(prompt, filePath = null) {
    const inputBox = this.page.locator('div[contenteditable="true"]').first();
    await inputBox.waitFor({ state: 'visible' });
    let finalPrompt = prompt;

    if (filePath && fs.existsSync(filePath)) {
      console.log('📄 Adjuntando archivo de contexto...');
      try {
        let fileInput = this.page.locator('input[type="file"]').first();
        
        const isInputReady = await fileInput.isVisible({ timeout: 1000 }).catch(() => false);
        if (!isInputReady) {
          const plusBtn = this.page.locator('button[aria-label*="Subidas"], button[aria-label*="Upload"], button:has(mat-icon[data-mat-icon-name="plus"])').first();
          if (await plusBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await plusBtn.click();
            await this.page.waitForTimeout(500);
          }
        }

        fileInput = this.page.locator('input[type="file"]').first();
        await fileInput.setInputFiles(filePath);

        console.log('⏳ Procesando archivo en la interfaz...');
        await this.page.waitForTimeout(3000);
        console.log('✅ Archivo listo.');

      } catch (uploadError) {
        console.log('⚠️ Fallback a texto plano activado:', uploadError.message);
        const fallbackContext = fs.readFileSync(filePath, 'utf-8');
        finalPrompt = `${finalPrompt}\n\nCÓDIGO DEL PROYECTO ACTUAL:\n${fallbackContext}`;
      }
    }

    await inputBox.click();
    console.log('💬 Escribiendo instrucción...');
    await this.page.keyboard.insertText(finalPrompt);
    await this.page.waitForTimeout(500);
    await this.page.keyboard.press('Enter');

    console.log('⏳ Esperando inicio de generación...');
    
    const stopButtonSelector = 'button[aria-label*="Detener"], button[aria-label*="Stop"], button[aria-label*="detener"], button[aria-label*="stop"]';
    try {
      await this.page.waitForSelector(stopButtonSelector, { state: 'attached', timeout: 10000 });
      console.log('⚡ Generando respuesta...');
      await this.page.waitForSelector(stopButtonSelector, { state: 'detached', timeout: 180000 });
    } catch (e) {
      await this.page.waitForTimeout(6000);
    }

    await this.page.waitForTimeout(2000);

    const currentUrl = this.page.url();
    if (currentUrl.includes('/app/')) fs.writeFileSync(this.chatUrlFile, currentUrl, 'utf-8');

    const responseText = await this.page.evaluate(() => {
      const selectors = ['model-response', 'message-content', '.model-response-text', '.response-container-content'];
      let nodes = [];

      for (const sel of selectors) {
        const found = document.querySelectorAll(sel);
        if (found && found.length > 0) {
          nodes = found;
          break;
        }
      }

      if (!nodes.length) return '';

      const lastNode = nodes[nodes.length - 1];
      const clone = lastNode.cloneNode(true);

      const codeBlocks = clone.querySelectorAll('code-block, pre');
      codeBlocks.forEach(cb => {
        const langEl = cb.querySelector('.header, .code-block-header, [class*="lang"]');
        const lang = langEl ? langEl.innerText.trim() : '';
        const codeEl = cb.querySelector('code') || cb.querySelector('pre') || cb;
        const codeText = codeEl ? codeEl.innerText : cb.innerText;

        const replacement = document.createTextNode(`\n\`\`\`${lang}\n${codeText}\n\`\`\`\n`);
        if (cb.parentNode) {
          cb.parentNode.replaceChild(replacement, cb);
        }
      });

      return clone.innerText || clone.textContent || '';
    });

    return responseText;
  }

  async getChatHistory() {
    try {
      return await this.page.evaluate(() => {
        const nodes = document.querySelectorAll('message-content, model-response');
        if (nodes.length === 0) return 'No hay historial visible en este chat.';

        let historyText = '# Historial Completo de la Sesión\n\n';
        nodes.forEach((node, index) => {
          historyText += `## Intervención #${index + 1}\n\n${node.innerText}\n\n---\n\n`;
        });
        return historyText;
      });
    } catch (error) {
      return 'Error leyendo el historial: ' + error.message;
    }
  }

  async close() {
    if (this.context) {
      await this.context.close();
    }
  }
}

module.exports = GeminiClient;