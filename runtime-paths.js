const fs = require('fs');
const path = require('path');

const isPkg = !!process.pkg;
const runtimeDir = isPkg ? process.cwd() : __dirname;

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function getDataDir() {
    const dataDir = path.join(runtimeDir, 'data');
    ensureDir(dataDir);
    return dataDir;
}

function getRuntimePath(...parts) {
    const target = path.join(runtimeDir, ...parts);
    ensureDir(path.dirname(target));
    return target;
}

module.exports = {
    getDataDir,
    getRuntimePath,
    isPkg
};
