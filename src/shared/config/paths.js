const path = require('path');
const fs = require('fs');

// Centraliza todos los archivos de estado en gemini-cli-agent/.agent_data

const ROOT_DIR = path.resolve(__dirname, '../../../');

const DATA_DIR = path.join(__dirname, '../../../.agent_data');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

module.exports = {
    DATA_DIR,
    PACKAGE_JSON_FILE: path.join(ROOT_DIR, 'package.json'),
    BANNER_FILE: path.join(ROOT_DIR, 'src/shared/assets/banner.txt'),
    SESSION_DIR: path.join(DATA_DIR, 'browser_session'),
    CHAT_URL_FILE: path.join(DATA_DIR, 'chat_url.txt'),
    SAVED_CHATS_FILE: path.join(DATA_DIR, 'saved_chats.json'),
    REPO_PATH_FILE: path.join(DATA_DIR, 'repo_path.txt'),
    SQLITE_DB: path.join(DATA_DIR, 'memory.db'),
    LANCEDB_DIR: path.join(DATA_DIR, 'lancedb'),
    LOG_FILE: path.join(DATA_DIR, 'execution.log')
};