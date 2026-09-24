const path = require('path');

class PathSecurity {
    static isSafePath(projectRoot, targetPath) {
        if (!projectRoot || !targetPath) return false;
        const resolvedRoot = path.resolve(projectRoot);
        const resolvedTarget = path.resolve(projectRoot, targetPath);
        const relative = path.relative(resolvedRoot, resolvedTarget);
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    }
}

module.exports = PathSecurity;