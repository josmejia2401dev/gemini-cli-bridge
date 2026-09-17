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
      args: [
        '--disable-blink-features=AutomationControlled', 
        '--test-type' // Suprime advertencias de entorno de pruebas
      ],
      ignoreDefaultArgs: ['--enable-automation', '--no-sandbox'] // Bloquea los flags ruidosos de Playwright
    });

    this.page = this.context.pages().length > 0 ? this.context.pages()[0] : await this.context.newPage();
    await this.page.goto(targetUrl);
    if (this.page.url().includes('accounts.google.com')) {
      console.log('📌 Por favor, inicia sesión en Google en la ventana del navegador.');
      await this.page.waitForURL('**/gemini.google.com/app**', { timeout: 0 });
      console.log('✅ Sesión iniciada correctamente.');
    }
  }

  /*async sendPrompt(prompt, filePath = null) {
    const inputBox = this.page.locator('div[contenteditable="true"]').first();
    await inputBox.waitFor({ state: 'visible' });
    let finalPrompt = prompt;

    if (filePath && fs.existsSync(filePath)) {
      console.log('📄 Adjuntando archivo de contexto...');
      const stats = fs.statSync(filePath);
      const fileSizeKB = (stats.size / 1024).toFixed(2);
      console.log(`\n  [INFO] Empaquetando contexto de ${fileSizeKB} KB...`);

      try {
        console.log('⏳ Interceptando el explorador de archivos nativo...');

        // 1. Empezamos a escuchar el evento de "Abrir archivo" ANTES de hacer clic en nada
        const fileChooserPromise = this.page.waitForEvent('filechooser', { timeout: 8000 });

        // 2. Buscamos y hacemos clic en el botón de adjuntar (el "+" principal)
        const plusBtn = this.page.locator('button[aria-label*="Subidas"], button[aria-label*="Upload"], button[aria-label*="Subir"], button:has(mat-icon[data-mat-icon-name="plus"]), button:has(mat-icon[fonticon="add_circle"])').first();

        if (await plusBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await plusBtn.click();
          await this.page.waitForTimeout(800); // Dar tiempo a que el menú renderice
        }

        // 3. Hacemos clic en la opción "Subir archivos" del menú para disparar el diálogo
        const submenuBtn = this.page.locator('[data-test-id="local-images-files-uploader-button"], span:has-text("Subir archivos")').first();
        if (await submenuBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await submenuBtn.click();
        } else {
          // Si falla el botón del menú, intentamos forzar el clic en el input oculto
          const hiddenInput = this.page.locator('input[type="file"].hidden-file-input').first();
          await hiddenInput.click({ force: true });
        }

        // 4. Capturamos el diálogo de Windows y le inyectamos la ruta
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(filePath);

        console.log('✅ Archivo inyectado exitosamente a través del FileChooser.');
        await this.page.waitForTimeout(1000);

      } catch (uploadError) {
        console.log(`  [!] Fallback activado (La UI de Gemini cambió o no cargó el botón).`);
        console.log(`  [INFO] Inyectando los ${fileSizeKB} KB de código como texto directo al chat...`);
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
  }*/

  // --- MÉTODO 1: Flujo "Importar código > Subir carpeta" ---
  async tryImportCodeFlow() {
    console.log('⏳ Intentando flujo: Importar código > Subir carpeta...');
    try {
      const moreUploadsBtn = this.page.locator('button.more-upload-button, [data-test-id="more-tools-button"]').first();
      await moreUploadsBtn.click({ timeout: 1500 });
      await this.page.waitForTimeout(500);

      const importCodeBtn = this.page.locator('code-import button, span:has-text("Importar código")').first();
      await importCodeBtn.click({ timeout: 1500 });
      await this.page.waitForTimeout(500);

      const uploadFolderBtn = this.page.locator('[data-test-id="upload-code-folder-button"]').first();
      await uploadFolderBtn.click({ timeout: 1500 });
      return true; // Se completaron todos los clics
    } catch (e) {
      return false; // Si algún clic falla por timeout, aborta este flujo
    }
  }

  // --- MÉTODO 2: Flujo Clásico "Subir archivos" ---
  async tryUploadFilesFlow() {
    console.log('⏳ Intentando flujo clásico: Subir archivos...');
    try {
      const submenuBtn = this.page.locator('[data-test-id="local-images-files-uploader-button"]').first();
      await submenuBtn.click({ timeout: 1500 });
      return true;
    } catch (e) {
      return false;
    }
  }

  // --- MÉTODO 3: Flujo Móvil / Pantalla Pequeña "Archivos" ---
  // --- MÉTODO 3: Flujo Móvil / Pantalla Pequeña "Archivos" ---
  async tryMobileUploadFlow() {
    console.log('⏳ Intentando flujo móvil/responsivo: Archivos...');
    try {
      const selector = 'images-files-uploader[data-test-id="uploader-images-files-button-advanced"] button';

      // 1. Esperamos a que el elemento exista en el HTML (no le pedimos a Playwright que verifique si es "visible", solo que exista)
      await this.page.waitForSelector(selector, { state: 'attached', timeout: 2000 });

      // 2. Ejecutamos el clic mediante JavaScript nativo (Igual que en la consola del navegador)
      await this.page.evaluate((sel) => {
        document.querySelector(sel).click();
      }, selector);

      return true; // Si el evaluate pasa, el clic se ejecutó y abrirá el FileChooser
    } catch (e) {
      return false;
    }
  }


  // --- TU MÉTODO ACTUALIZADO ---
  async sendPrompt(prompt, filePath = null) {
    const inputBox = this.page.locator('div[contenteditable="true"]').first();
    await inputBox.waitFor({ state: 'visible' });
    let finalPrompt = prompt;

    if (filePath && fs.existsSync(filePath)) {
      console.log('📄 Adjuntando archivo de contexto...');
      const stats = fs.statSync(filePath);
      const fileSizeKB = (stats.size / 1024).toFixed(2);
      console.log(`\n  [INFO] Empaquetando contexto de ${fileSizeKB} KB...`);

      try {
        console.log('⏳ Interceptando el explorador de archivos nativo...');

        // 1. Escuchamos el evento de FileChooser
        const fileChooserPromise = this.page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);

        // 2. Abrimos el menú principal ("+") usando Try-Click
        try {
          const plusBtn = this.page.locator('button[aria-label*="Subidas"], button[aria-label*="Upload"], button[aria-label*="Subir"], button:has(mat-icon[data-mat-icon-name="plus"])').first();
          await plusBtn.click({ timeout: 2000 });
          await this.page.waitForTimeout(800);
        } catch (e) {
          console.log('  [!] No se pudo hacer clic en el botón +. Los flujos podrían fallar.');
        }

        // 3. Orquestación de Flujos (Prioridad: Importar código OR Subir archivos)
        let uploadTriggered = await this.tryImportCodeFlow();

        if (!uploadTriggered) {
          uploadTriggered = await this.tryUploadFilesFlow();
        }

        if (!uploadTriggered) {
          uploadTriggered = await this.tryMobileUploadFlow();
        }

        if (uploadTriggered) {
          // Si hicimos clic en un botón real, Playwright captura la ventana de Windows
          const fileChooser = await fileChooserPromise;
          if (fileChooser) {
            await fileChooser.setFiles(filePath);
            console.log('✅ Archivo inyectado exitosamente a través de la UI.');
          } else {
            throw new Error("El FileChooser nativo no se abrió a tiempo.");
          }
        } else {
          // 5. Fallback extremo: Inyección directa en el DOM (No abre ventana nativa)
          console.log('⏳ UI no detectada. Intentando inyección directa en DOM...');
          const hiddenInput = this.page.locator('input[type="file"].hidden-file-input, input[type="file"][accept*=".txt"]').first();
          if (await hiddenInput.count() > 0) {
            await hiddenInput.setInputFiles(filePath);
            console.log('✅ Archivo inyectado silenciosamente en el DOM.');
          } else {
            throw new Error("No se encontró ningún nodo de subida en la página.");
          }
        }

        await this.page.waitForTimeout(1000);

      } catch (uploadError) {
        console.log(`  [!] Fallback activado (La UI de Gemini cambió o no cargó el botón).`);
        console.log(`  [INFO] Inyectando los ${fileSizeKB} KB de código como texto directo al chat...`);
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

  // --- MÉTODO NUEVO: Detener generación en curso ---
  async stopGeneration() {
    try {
      const stopButtonSelector = 'button[aria-label*="Detener"], button[aria-label*="Stop"], button[aria-label*="detener"], button[aria-label*="stop"]';
      const stopBtn = this.page.locator(stopButtonSelector).first();

      if (await stopBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await stopBtn.click();
      }
    } catch (e) {
      // Ignoramos el error silenciosamente si el botón no está visible
    }
  }
}

module.exports = GeminiClient;