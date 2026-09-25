const { chromium } = require('playwright');
const fs = require('fs');
const ILLMClient = require('../contracts/ILLMClient');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class GeminiPlaywrightClient extends ILLMClient {
  constructor({ sessionDir = '', chatUrlFile = '' } = {}) {
    super();
    this.sessionDir = sessionDir;
    this.chatUrlFile = chatUrlFile;
    this.context = null;
    this.page = null;
    this.pendingWebGeneration = false;
    this.isProgrammaticSending = false;
  }

  sanitizeUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return 'https://gemini.google.com/app';
    const match = rawUrl.match(/https?:\/\/[^\s\)"'\]]+/i);
    return match ? match[0] : 'https://gemini.google.com/app';
  }

  async connect(targetUrl = 'https://gemini.google.com/app') {
    const cleanUrl = this.sanitizeUrl(targetUrl);

    this.context = await chromium.launchPersistentContext(this.sessionDir, {
      headless: false,
      channel: 'chrome',
      viewport: null,
      args: ['--disable-blink-features=AutomationControlled', '--test-type'],
      ignoreDefaultArgs: ['--enable-automation', '--no-sandbox']
    });

    this.page = this.context.pages().length > 0 ? this.context.pages()[0] : await this.context.newPage();

    try {
      await this.page.goto(cleanUrl, { waitUntil: 'domcontentloaded' });
    } catch (navError) {
      if (!navError.message.includes('ERR_ABORTED')) {
        throw navError;
      }
    }

    if (this.page.url().includes('accounts.google.com')) {
      console.log('📌 Por favor, inicia sesión en Google en la ventana del navegador.');
      await this.page.waitForURL('**/gemini.google.com/app**', { timeout: 0 });
      console.log('✅ Sesión iniciada correctamente.');
    }
  }

  async generate({ prompt = '', fileToUpload = null } = {}) {
    const text = await this.sendPrompt({ prompt, filePath: fileToUpload });
    return { text };
  }

  async openMenu() {
    try {
      const selector = [
        'button[aria-label*="Subidas y herramientas"]',
        'button[aria-label*="Upload and tools"]',
        'button[aria-label*="Subidas"]',
        'button[aria-label*="Upload"]',
        'button[aria-label*="Subir"]',
        'button:has(mat-icon[data-mat-icon-name="plus"])',
        'button:has(mat-icon[fonticon="plus"])'
      ].join(', ');

      const plusBtn = this.page.locator(selector).locator('visible=true').first();
      let clicked = false;

      if (await plusBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        try {
          await plusBtn.click({ timeout: 1500 });
          clicked = true;
        } catch (clickErr) {
          await plusBtn.click({ force: true, timeout: 1500 });
          clicked = true;
        }
      }

      if (!clicked) {
        clicked = await this.page.evaluate((sel) => {
          const btns = Array.from(document.querySelectorAll(sel));
          const visibleBtn = btns.find(b => b.offsetWidth > 0 && b.offsetHeight > 0);
          if (visibleBtn) {
            visibleBtn.click();
            return true;
          }
          return false;
        }, selector);
      }

      if (clicked) {
        await delay(1_000);
      } else {
        console.log('  [!] No se detectó botón + visible en pantalla.');
      }
    } catch (e) {
      console.log('  [!] No se pudo hacer clic en el botón +. Los flujos podrían fallar.');
    }
  }

  async tryImportCodeFlow() {
    console.log('⏳ Intentando flujo: Importar código > Subir carpeta...');
    try {
      const robustClick = async (selectorsArray, stepName) => {
        const selector = selectorsArray.join(', ');
        const target = this.page.locator(selector).locator('visible=true').first();
        let clicked = false;

        if (await target.isVisible({ timeout: 2000 }).catch(() => false)) {
          try {
            await target.click({ timeout: 1500 });
            clicked = true;
          } catch (err) {
            await target.click({ force: true, timeout: 1500 });
            clicked = true;
          }
        }

        if (!clicked) {
          clicked = await this.page.evaluate((sel) => {
            const elements = Array.from(document.querySelectorAll(sel));
            const visible = elements.find(el => el.offsetWidth > 0 && el.offsetHeight > 0);
            if (visible) {
              visible.click();
              return true;
            }
            return false;
          }, selector);
        }

        if (clicked) {
          await delay(600);
        } else {
          console.log(`  [!] No se pudo hacer clic en: ${stepName}`);
        }
        return clicked;
      };

      const step1Ok = await robustClick([
        'button.more-upload-button',
        '[data-test-id="more-tools-button"]',
        'button:has-text("Más subidas")',
        'button:has-text("More uploads")',
        'button:has(mat-icon[data-mat-icon-name="more_horiz"])',
        'button:has(mat-icon[fonticon="more_horiz"])'
      ], '"Más subidas"');

      if (!step1Ok) return false;

      const step2Ok = await robustClick([
        'code-import button',
        'button:has(span:has-text("Importar código"))',
        'button:has(span:has-text("Import code"))',
        'button:has(mat-icon[data-mat-icon-name="code"])',
        'button:has(mat-icon[fonticon="code"])'
      ], '"Importar código"');

      if (!step2Ok) return false;

      const step3Ok = await robustClick([
        '[data-test-id="upload-code-folder-button"]',
        'code-folder-uploader button',
        'button:has-text("Subir carpeta")',
        'button:has-text("Upload folder")',
        'button:has(span.mdc-button__label:has-text("Subir carpeta"))'
      ], '"Subir carpeta"');

      if (!step3Ok) return false;

      return true;
    } catch (e) {
      return false;
    }
  }

  async tryUploadFilesFlow() {
    console.log('⏳ Intentando flujo clásico: Subir archivos...');
    try {
      const selector = [
        'images-files-uploader button',
        '[data-test-id="local-images-files-uploader-button"]',
        'images-files-uploader[data-test-id="uploader-images-files-button-advanced"] button',
        'button[aria-label*="Subir archivos"]',
        'button[aria-label*="Upload files"]',
        'button:has(span:has-text("Subir archivos"))',
        'button:has(span:has-text("Upload files"))',
        'button:has(mat-icon[data-mat-icon-name="attach_file"])',
        'button:has(mat-icon[fonticon="attach_file"])'
      ].join(', ');

      const uploadBtn = this.page.locator(selector).locator('visible=true').first();
      let clicked = false;

      if (await uploadBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        try {
          await uploadBtn.click({ timeout: 1500 });
          clicked = true;
        } catch (clickErr) {
          await uploadBtn.click({ force: true, timeout: 1500 });
          clicked = true;
        }
      }

      if (!clicked) {
        clicked = await this.page.evaluate((sel) => {
          const btns = Array.from(document.querySelectorAll(sel));
          const visibleBtn = btns.find(b => b.offsetWidth > 0 && b.offsetHeight > 0);
          if (visibleBtn) {
            visibleBtn.click();
            return true;
          }
          return false;
        }, selector);
      }

      if (clicked) {
        await delay(1_000);
        return true;
      }

      return false;
    } catch (e) {
      return false;
    }
  }

  async tryMobileUploadFlow() {
    console.log('⏳ Intentando flujo móvil/responsivo: Archivos...');
    try {
      const selector = 'images-files-uploader[data-test-id="uploader-images-files-button-advanced"] button';
      await this.page.waitForSelector(selector, { state: 'attached', timeout: 2000 });

      await this.page.evaluate((sel) => {
        document.querySelector(sel).click();
      }, selector);

      return true;
    } catch (e) {
      return false;
    }
  }

  async sendPrompt({ prompt = '', filePath = null } = {}) {
    const usePendingWebGeneration = this.pendingWebGeneration;
    this.isProgrammaticSending = true;

    try {
      if (usePendingWebGeneration) {
        this.pendingWebGeneration = false;
      }

      const inputSelector = 'div[contenteditable="true"]';
      const inputBox = this.page.locator(inputSelector).first();
      await inputBox.waitFor({ state: 'visible' });
      let finalPrompt = prompt ? String(prompt) : '';

      if (!usePendingWebGeneration) {
        if (filePath && fs.existsSync(filePath)) {
          console.log('📄 Adjuntando archivo de contexto...');
          const stats = fs.statSync(filePath);
          const fileSizeKB = (stats.size / 1024).toFixed(2);
          console.log(`\n  [INFO] Empaquetando contexto de ${fileSizeKB} KB...`);

          try {
            console.log('⏳ Interceptando el explorador de archivos nativo...');

            const fileChooserPromise = this.page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);

            await this.openMenu();

            let uploadTriggered = await this.tryUploadFilesFlow();

            if (!uploadTriggered) {
              uploadTriggered = await this.tryMobileUploadFlow();
            }

            if (!uploadTriggered) {
              uploadTriggered = await this.tryImportCodeFlow();
            }

            if (uploadTriggered) {
              const fileChooser = await fileChooserPromise;
              if (fileChooser) {
                await fileChooser.setFiles(filePath);
                console.log('✅ Archivo inyectado exitosamente a través de la UI.');
              } else {
                throw new Error("El FileChooser nativo no se abrió a tiempo.");
              }
            } else {
              console.log('⏳ UI no detectada. Intentando inyección directa en DOM...');
              const hiddenInput = this.page.locator('input[type="file"].hidden-file-input, input[type="file"][accept*=".txt"]').first();
              if (await hiddenInput.count() > 0) {
                await hiddenInput.setInputFiles(filePath);
                console.log('✅ Archivo inyectado silenciosamente en el DOM.');
              } else {
                throw new Error("No se encontró ningún nodo de subida en la página.");
              }
            }

            await delay(1000);

          } catch (uploadError) {
            console.log(`  [!] Fallback activado (La UI de Gemini cambió o no cargó el botón).`);
            console.log(`  [INFO] Inyectando los ${fileSizeKB} KB de código como texto directo al chat...`);
            const fallbackContext = fs.readFileSync(filePath, 'utf-8');
            finalPrompt = `${finalPrompt}\n\nCÓDIGO DEL PROYECTO ACTUAL:\n${fallbackContext}`;
          }
        }

        console.log('💬 Escribiendo instrucción...');
        if (finalPrompt.length > 50) {
          await this.pasteFromClipboard(this.page, inputSelector, finalPrompt);
        } else {
          await this.typeHumanLike(this.page, inputSelector, finalPrompt);
        }

        await delay(1000);
        await this.page.keyboard.press('Enter');

      } else {
        console.log('🌐 Instrucción procesada directamente desde el navegador.');
      }

      console.log('⏳ Esperando inicio de generación...');

      const stopButtonSelector = 'button[aria-label*="Detener"], button[aria-label*="Stop"], button[aria-label*="detener"], button[aria-label*="stop"]';
      try {
        await this.page.waitForSelector(stopButtonSelector, { state: 'attached', timeout: 10000 });
        console.log('⚡ Generando respuesta...');
        await this.page.waitForSelector(stopButtonSelector, { state: 'detached', timeout: 180000 });
      } catch (e) {
        await delay(6000);
      }

      await delay(2000);

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

    } finally {
      await delay(500);
      this.isProgrammaticSending = false;
    }
  }

  async stopGeneration({ reason = 'USER_REQUEST' } = {}) {
    try {
      const stopButtonSelector = 'button[aria-label*="Detener"], button[aria-label*="Stop"], button[aria-label*="detener"], button[aria-label*="stop"]';
      const stopBtn = this.page.locator(stopButtonSelector).first();

      if (await stopBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await stopBtn.click();
      }
    } catch (e) {
      // Ignoramos el error silenciosamente
    }
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

  /**
   * Envía texto simulando el pegado desde el portapapeles del usuario.
   * Activa los eventos nativos 'paste' e 'input' del DOM.
   */
  async pasteFromClipboard(page = null, selector = '', text = '') {
    const locator = page.locator(selector).first();
    await locator.focus();

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.evaluate(async (content) => {
      await navigator.clipboard.writeText(content);
    }, text);

    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+V`);
  }

  /**
   * Escribe texto carácter por carácter simulando la velocidad de tecleo humana.
   */
  async typeHumanLike(page = null, selector = '', text = '') {
    const locator = page.locator(selector).first();
    await locator.focus();

    await locator.pressSequentially(text, {
      delay: Math.floor(Math.random() * 30) + 15
    });
  }

  async close() {
    try {
      if (this.context) await this.context.close();
    } catch (e) { }
  }


  async setupWebUIListener(onUserWebInputCallback = null) {
    this.webInputCallback = onUserWebInputCallback;
    if (!this.page) return;

    await this.attachWebObserver();

    this.page.on('domcontentloaded', async () => {
      await delay(1500);
      await this.attachWebObserver();
    });
  }

  async attachWebObserver() {
    try {
      await this.page.exposeFunction('__notifyAgentFromWeb', (userText) => {
        if (this.isProgrammaticSending) return;

        const cleanText = userText ? userText.trim() : '';
        if (!cleanText) return;

        // Elimina el filtro agresivo de caché y solo bloquea cabeceras internas del sistema
        if (
          cleanText.startsWith('[SUBTAREA ACTIVA:') ||
          cleanText.startsWith('[SISTEMA:') ||
          cleanText.startsWith('Hola. A partir de este momento')
        ) {
          return;
        }

        this.pendingWebGeneration = true;

        if (typeof this.webInputCallback === 'function') {
          this.webInputCallback(cleanText);
        }
      });
    } catch (e) {
      // Función previamente expuesta
    }

    try {
      await this.page.evaluate(() => {
        if (window.__geminiInputListenerAttached) return;
        window.__geminiInputListenerAttached = true;

        const notifyIfValid = (targetElement) => {
          if (!targetElement) return;
          const text = targetElement.innerText || targetElement.value || '';
          if (text.trim() && window.__notifyAgentFromWeb) {
            window.__notifyAgentFromWeb(text.trim());
          }
        };

        // 🎯 INTERCEPTOR 1: Detecta cuando presionas 'Enter' en la caja de texto
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            const target = e.target;
            const isInputBox = target.matches('div[contenteditable="true"], textarea, rich-textarea') ||
              target.closest('div[contenteditable="true"], textarea, rich-textarea');
            if (isInputBox) {
              notifyIfValid(target);
            }
          }
        }, { capture: true }); // Fase de captura: lee antes de que Gemini limpie la caja

        // 🎯 INTERCEPTOR 2: Detecta cuando haces clic en el botón de "Enviar" o "Actualizar"
        document.addEventListener('click', (e) => {
          const sendBtn = e.target.closest('button[aria-label*="enviar" i], button[aria-label*="send" i], button[aria-label*="guardar" i], button[aria-label*="update" i], [data-test-id="send-button"]');
          if (sendBtn) {
            const input = document.querySelector('div[contenteditable="true"], textarea, rich-textarea');
            notifyIfValid(input);
          }
        }, { capture: true });

        console.log('✅ Input Interceptor nativo conectado.');
      });
    } catch (err) { }
  }
}

module.exports = GeminiPlaywrightClient;